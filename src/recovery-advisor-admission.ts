/**
 * M19R3C — restart-safe admission ledger for one-shot advisor proposals.
 * Dormant library. It grants NO Cline execution, filesystem or network access.
 *
 * Only a trusted host can issue/revoke a grant after explicit operator
 * authorization. A matching grant can be consumed once to reserve a
 * conservative estimated cost; consuming does not send an HTTP request.
 */
import crypto from "node:crypto";
import { mkdir, lstat, readFile, readdir, rename, rm, stat, open } from "node:fs/promises";
import path from "node:path";

export interface AdvisorAdmissionPolicyV1 {
  schemaVersion: 1;
  directory: string;
  maxCallsPerHour: number;
  maxEstimatedCentsPerHour: number;
  maxGrantCents: number;
}
type GrantState = "pending" | "consumed" | "revoked";
interface GrantRecord {
  id: string; incidentId: string; issuedAtMs: number; expiresAtMs: number;
  maxEstimatedCents: number; state: GrantState; decidedAtMs?: number;
}
interface Reservation {
  grantId: string; atMs: number; estimatedCents: number;
}
interface Ledger {
  schemaVersion: 1; lastObservedAtMs: number;
  callsLimit: number; centsLimit: number;
  grants: GrantRecord[]; reservations: Reservation[];
}
export type AdvisorAdmissionErrorCode =
  "invalid_request" | "invalid_config" | "permission_denied" |
  "duplicate_incident" | "not_found" | "expired" | "already_decided" |
  "budget_exceeded" | "state_corrupt" | "state_busy" | "state_unavailable";
export class AdvisorAdmissionError extends Error {
  constructor(readonly code: AdvisorAdmissionErrorCode) {
    super(code); this.name = "AdvisorAdmissionError";
  }
}
export interface AdvisorGrantReceiptV1 {
  schemaVersion: 1; grantId: string; incidentId: string;
  expiresAtMs: number; state: "pending";
  grantsAuthority: false;
}
export interface AdvisorReservationV1 {
  schemaVersion: 1; reservation: "held";
  estimatedCents: number; grantsAuthority: false;
  retryAuthorized: false; skipExecutionPermitted: false;
}
export const ADVISOR_ADMISSION_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  networkCalls: false as const, connectedToClineRunner: false as const,
  autoRestoreStaleLocks: false as const, grantsAuthority: false as const,
});
const digest = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const integer = (v: unknown, min: number, max: number): v is number =>
  Number.isSafeInteger(v) && (v as number) >= min && (v as number) <= max;
function policyValid(v: AdvisorAdmissionPolicyV1): boolean {
  return !!v && v.schemaVersion === 1
    && typeof v.directory === "string" && v.directory.length < 500
    && path.isAbsolute(v.directory)
    && path.resolve(v.directory) !== path.parse(path.resolve(v.directory)).root
    && !/[\x00-\x1f\x7f]/.test(v.directory)
    && integer(v.maxCallsPerHour, 1, 12)
    && integer(v.maxEstimatedCentsPerHour, 1, 10000)
    && integer(v.maxGrantCents, 1, v.maxEstimatedCentsPerHour);
}
function recordValid(v: unknown): v is GrantRecord {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const g = v as Partial<GrantRecord>;
  return Object.keys(g).every(k => ["id","incidentId","issuedAtMs","expiresAtMs",
    "maxEstimatedCents","state","decidedAtMs"].includes(k))
    && uuid(g.id) && digest(g.incidentId)
    && integer(g.issuedAtMs,0,Number.MAX_SAFE_INTEGER)
    && integer(g.expiresAtMs,0,Number.MAX_SAFE_INTEGER)
    && g.expiresAtMs! > g.issuedAtMs! && g.expiresAtMs! - g.issuedAtMs! <= 900000
    && integer(g.maxEstimatedCents,1,10000)
    && ["pending","consumed","revoked"].includes(g.state ?? "")
    && (g.decidedAtMs === undefined || integer(g.decidedAtMs, g.issuedAtMs!, Number.MAX_SAFE_INTEGER))
    && ((g.state === "pending") === (g.decidedAtMs === undefined));
}
function ledgerValid(v: unknown): v is Ledger {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const s = v as Partial<Ledger>;
  if (Object.keys(s).sort().join(",") !== "callsLimit,centsLimit,grants,lastObservedAtMs,reservations,schemaVersion"
    || s.schemaVersion !== 1 || !integer(s.lastObservedAtMs,0,Number.MAX_SAFE_INTEGER)
    || !integer(s.callsLimit,1,12) || !integer(s.centsLimit,1,10000)
    || !Array.isArray(s.grants) || s.grants.length > 256
    || !s.grants.every(recordValid)
    || !Array.isArray(s.reservations) || s.reservations.length > 256) return false;
  const ids = new Set<string>(), incidents = new Set<string>();
  for (const g of s.grants) {
    if (ids.has(g.id) || incidents.has(g.incidentId) || g.issuedAtMs > s.lastObservedAtMs!) return false;
    ids.add(g.id); incidents.add(g.incidentId);
  }
  const reserved = new Set<string>();
  for (const raw of s.reservations) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
    const r = raw as Reservation;
    if (Object.keys(r).sort().join(",") !== "atMs,estimatedCents,grantId"
      || !uuid(r.grantId) || !integer(r.atMs,0,s.lastObservedAtMs!)
      || !integer(r.estimatedCents,1,10000) || reserved.has(r.grantId)) return false;
    const grant = s.grants.find(g=>g.id===r.grantId);
    if (!grant || grant.state !== "consumed" || r.atMs !== grant.decidedAtMs
      || r.estimatedCents > grant.maxEstimatedCents) return false;
    reserved.add(r.grantId);
  }
  for (const g of s.grants) if ((g.state === "consumed") !== reserved.has(g.id)) return false;
  return true;
}
async function authorized(check: () => Promise<boolean>): Promise<void> {
  if (typeof check !== "function") throw new AdvisorAdmissionError("permission_denied");
  let yes = false;
  try { yes = await check() === true; } catch { /* fail closed */ }
  if (!yes) throw new AdvisorAdmissionError("permission_denied");
}

/**
 * mkdir lock is exclusive across processes. An orphaned lock deliberately
 * halts advisor issuance until independently reviewed administrative repair.
 * No fallback to unsafe unlocked writes.
 */
export class DurableAdvisorAdmissionLedger {
  constructor(
    private readonly config: AdvisorAdmissionPolicyV1,
    private readonly now: () => number = Date.now,
  ) {}
  private dir() { return path.resolve(this.config.directory); }
  private file() { return path.join(this.dir(), "admission-v1.json"); }
  private lock() { return path.join(this.dir(), ".admission.lock"); }

  private async prepare(): Promise<void> {
    if (!policyValid(this.config)) throw new AdvisorAdmissionError("invalid_config");
    try {
      await mkdir(this.dir(), {recursive: true, mode: 0o700});
      const s = await lstat(this.dir());
      if (!s.isDirectory() || s.isSymbolicLink()) throw new AdvisorAdmissionError("state_unavailable");
      if (process.platform !== "win32" && (s.mode & 0o077) !== 0)
        throw new AdvisorAdmissionError("state_unavailable");
    } catch (e) {
      if (e instanceof AdvisorAdmissionError) throw e;
      throw new AdvisorAdmissionError("state_unavailable");
    }
  }
  private async load(at: number): Promise<Ledger> {
    try {
      const st = await lstat(this.file());
      if (!st.isFile() || st.isSymbolicLink() || st.size > 65536)
        throw new AdvisorAdmissionError("state_corrupt");
      if (process.platform !== "win32" && (st.mode & 0o077) !== 0)
        throw new AdvisorAdmissionError("state_corrupt");
      const value: unknown = JSON.parse(await readFile(this.file(),"utf8"));
      if (!ledgerValid(value)) throw new AdvisorAdmissionError("state_corrupt");
      return value;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return {
        schemaVersion:1, lastObservedAtMs:at,
        callsLimit:this.config.maxCallsPerHour,
        centsLimit:this.config.maxEstimatedCentsPerHour,
        grants:[],reservations:[],
      };
      if (e instanceof AdvisorAdmissionError) throw e;
      throw new AdvisorAdmissionError("state_corrupt");
    }
  }
  private async save(s: Ledger): Promise<void> {
    if (!ledgerValid(s)) throw new AdvisorAdmissionError("state_corrupt");
    const tmp = path.join(this.dir(),".admission-"+crypto.randomUUID()+".tmp");
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(tmp,"wx",0o600);
      await handle.writeFile(JSON.stringify(s), "utf8");
      await handle.sync();
      await handle.close(); handle=undefined;
      await rename(tmp,this.file());
    } catch {
      await handle?.close().catch(()=>undefined);
      await rm(tmp,{force:true}).catch(()=>undefined);
      throw new AdvisorAdmissionError("state_unavailable");
    }
  }
  private async transaction<T>(action: (s: Ledger,at:number) => Promise<T>): Promise<T> {
    await this.prepare();
    let acquired=false;
    try {
      try { await mkdir(this.lock(),{mode:0o700}); acquired=true; }
      catch { throw new AdvisorAdmissionError("state_busy"); }
      const at=this.now();
      if (!integer(at,0,Number.MAX_SAFE_INTEGER))
        throw new AdvisorAdmissionError("state_unavailable");
      const s=await this.load(at);
      if (at<s.lastObservedAtMs) throw new AdvisorAdmissionError("state_unavailable");
      // Persist monotonic time and the strictest policy ever admitted.
      s.lastObservedAtMs=at;
      s.callsLimit=Math.min(s.callsLimit,this.config.maxCallsPerHour);
      s.centsLimit=Math.min(s.centsLimit,this.config.maxEstimatedCentsPerHour);
      return await action(s,at);
    } finally {
      if (acquired) await rm(this.lock(),{recursive:true,force:true}).catch(()=>undefined);
    }
  }

  /**
   * Read-only capacity preflight for an already validated incident.
   * This is a hint only: concurrent reservations can change capacity.
   * The actual quota/duplicate enforcement is still reserveOnce() under
   * its exclusive durable transaction; no grant is issued here.
   */
  async inspectAdmissionCapacity(
    incidentId: string, estimatedCents: number,
  ): Promise<"available" | "already_recorded" | "budget_exceeded"> {
    if (!digest(incidentId) || !integer(estimatedCents,1,10000))
      throw new AdvisorAdmissionError("invalid_request");
    return this.transaction(async (s,at) => {
      if (s.grants.some(g => g.incidentId === incidentId))
        return "already_recorded";
      if (s.grants.length >= 256 || s.reservations.length >= 256)
        return "budget_exceeded";
      const recent = s.reservations.filter(r => at - r.atMs < 3_600_000);
      const total = recent.reduce((sum,r) => sum + r.estimatedCents, 0);
      if (recent.length >= s.callsLimit || total + estimatedCents > s.centsLimit
        || estimatedCents > this.config.maxGrantCents) return "budget_exceeded";
      return "available";
    });
  }

  /** Only a trusted operator-capability boundary may call this. */
  async issue(
    incidentId: string, maxEstimatedCents: number, ttlMs: number,
    approveOperator: () => Promise<boolean>,
  ): Promise<AdvisorGrantReceiptV1> {
    if (!digest(incidentId) || !integer(maxEstimatedCents,1,10000)
      || !integer(ttlMs,1000,900000)) throw new AdvisorAdmissionError("invalid_request");
    await authorized(approveOperator);
    return await this.transaction(async (s,at)=>{
      if (s.grants.length>=256) throw new AdvisorAdmissionError("budget_exceeded");
      if (s.grants.some(g=>g.incidentId===incidentId))
        throw new AdvisorAdmissionError("duplicate_incident");
      if (maxEstimatedCents>this.config.maxGrantCents || maxEstimatedCents>s.centsLimit)
        throw new AdvisorAdmissionError("budget_exceeded");
      const grant: GrantRecord={
        id:crypto.randomUUID(),incidentId,issuedAtMs:at,expiresAtMs:at+ttlMs,
        maxEstimatedCents,state:"pending",
      };
      s.grants.push(grant); await this.save(s);
      return Object.freeze({schemaVersion:1,grantId:grant.id,incidentId,
        expiresAtMs:grant.expiresAtMs,state:"pending",grantsAuthority:false});
    });
  }
  /**
   * Caller must match an approved incident digest and the grant identifier.
   * Reservation burns one use even if the external consultation later fails.
   */
  async reserveOnce(
    grantId: string, incidentId: string, estimatedCents: number,
  ): Promise<AdvisorReservationV1> {
    if (!uuid(grantId) || !digest(incidentId) || !integer(estimatedCents,1,10000))
      throw new AdvisorAdmissionError("invalid_request");
    return await this.transaction(async (s,at)=>{
      const g=s.grants.find(x=>x.id===grantId && x.incidentId===incidentId);
      if (!g) throw new AdvisorAdmissionError("not_found");
      if (g.state!=="pending") throw new AdvisorAdmissionError("already_decided");
      if (at>=g.expiresAtMs) throw new AdvisorAdmissionError("expired");
      if (estimatedCents>g.maxEstimatedCents) throw new AdvisorAdmissionError("budget_exceeded");
      const recent=s.reservations.filter(r=>at-r.atMs<3_600_000);
      const total=recent.reduce((sum,r)=>sum+r.estimatedCents,0);
      if (recent.length>=s.callsLimit || total+estimatedCents>s.centsLimit
        || s.reservations.length>=256) throw new AdvisorAdmissionError("budget_exceeded");
      g.state="consumed";g.decidedAtMs=at;
      s.reservations.push({grantId,atMs:at,estimatedCents});
      await this.save(s);
      return Object.freeze({schemaVersion:1,reservation:"held",estimatedCents,
        grantsAuthority:false,retryAuthorized:false,skipExecutionPermitted:false});
    });
  }

  async revoke(
    grantId: string, approveOperator: () => Promise<boolean>,
  ): Promise<void> {
    if (!uuid(grantId)) throw new AdvisorAdmissionError("invalid_request");
    await authorized(approveOperator);
    await this.transaction(async (s,at)=>{
      const g=s.grants.find(x=>x.id===grantId);
      if (!g) throw new AdvisorAdmissionError("not_found");
      if (g.state!=="pending") throw new AdvisorAdmissionError("already_decided");
      g.state="revoked";g.decidedAtMs=at;await this.save(s);
    });
  }
  async revokeAllPending(approveOperator: () => Promise<boolean>): Promise<number> {
    await authorized(approveOperator);
    return await this.transaction(async (s,at)=>{
      let count=0;
      for (const g of s.grants) if(g.state==="pending") {
        g.state="revoked";g.decidedAtMs=at;count++;
      }
      await this.save(s);return count;
    });
  }
}
