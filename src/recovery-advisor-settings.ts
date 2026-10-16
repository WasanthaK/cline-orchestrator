/**
 * M19R3F: local operator settings for AI recovery guidance.
 *
 * These preferences are NOT transport authorization. The runtime is not
 * connected; any future consultation must reload current consent and pass
 * durable per-incident admission and the existing Safety/lease gates.
 */
import crypto from "node:crypto";
import { mkdir, lstat, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AdvisorPolicyMode, AdvisorStandingPolicyV1 } from "./recovery-advisor-policy.js";
import { DurableAdvisorStop, type AdvisorStopResultV1 } from "./recovery-advisor-stop.js";

export const ADVISOR_SETTINGS_CONTRACT = Object.freeze({
  schemaVersion: 1 as const, defaultMode: "off" as const,
  allowedDays: [7, 30] as const, allowedCents: [10, 50, 100, 500] as const,
  localOperatorOnly: true as const, defaultExternalCalls: false as const,
  browserTaskActions: false as const, grantsAuthority: false as const,
});
const MODES: readonly AdvisorPolicyMode[] =
  ["off", "ask_before_consulting", "automatic_advice"];
const OFF_REVISION = "0".repeat(64);
const isId = (s: unknown): s is string => typeof s === "string"
  && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(s);
const isRevision = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const validTime = (n: unknown): n is number =>
  Number.isSafeInteger(n) && (n as number) >= 0;

export class AdvisorSettingsError extends Error {
  constructor(readonly code: "invalid" | "unsafe" | "stale" | "busy") {
    super(code); this.name = "AdvisorSettingsError";
  }
}
export interface AdvisorSettingsViewV1 {
  schemaVersion: 1;
  projectId: string;
  mode: AdvisorPolicyMode;
  maxEstimatedCentsPerIncident: number;
  durationDays: 7 | 30;
  revision: string;
  consentExpiresAt?: string;
  expired: boolean;
  externalCallsEnabled: false;
  stopLatched: boolean;
  grantsAuthority: false;
}
export interface AdvisorSettingsEditV1 {
  expectedRevision: string;
  mode: AdvisorPolicyMode;
  maxEstimatedCentsPerIncident: number;
  durationDays: 7 | 30;
  acknowledgedExternalMetadata: boolean;
}
interface StoredSettings {
  schemaVersion: 1;
  policy: AdvisorStandingPolicyV1;
}
function exactKeys(v: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(v).sort().join("|") === keys.sort().join("|");
}
function validStored(raw: unknown, projectId: string): raw is StoredSettings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const s = raw as Record<string, unknown>;
  if (!exactKeys(s, ["schemaVersion","policy"]) || s.schemaVersion !== 1
    || !s.policy || typeof s.policy !== "object" || Array.isArray(s.policy)) return false;
  const p=s.policy as Record<string, unknown>;
  return exactKeys(p, ["schemaVersion","source","projectId","mode","destination","disclosure",
    "approvedAtMs","expiresAtMs","revision","allowedSignals",
    "maxEstimatedCentsPerIncident","operatorAcknowledgedExternalTransfer"])
    && p.schemaVersion===1 && p.source==="operator_approved_settings"
    && p.projectId===projectId && MODES.includes(p.mode as AdvisorPolicyMode)
    && p.destination==="openai_responses_api" && p.disclosure==="incident_metadata_only"
    && validTime(p.approvedAtMs) && validTime(p.expiresAtMs)
    && (p.expiresAtMs as number) > (p.approvedAtMs as number)
    && (p.expiresAtMs as number) - (p.approvedAtMs as number) <= 30*86400000
    && isRevision(p.revision) && p.revision!==OFF_REVISION
    && p.operatorAcknowledgedExternalTransfer === true
    && ADVISOR_SETTINGS_CONTRACT.allowedCents.includes(p.maxEstimatedCentsPerIncident as never)
    && Array.isArray(p.allowedSignals)
    && JSON.stringify(p.allowedSignals) === JSON.stringify(
      ["context_pressure","watchdog_stall","validation_failure"]);
}
export class AdvisorSettingsStore {
  constructor(
    private readonly directory: string,
    private readonly projectId: string,
    private readonly now: () => number = Date.now,
  ) {
    if (!path.isAbsolute(directory) || directory.includes("\0")
      || !isId(projectId) || path.resolve(directory) === path.parse(path.resolve(directory)).root) {
      throw new AdvisorSettingsError("unsafe");
    }
  }
  private dir() { return path.resolve(this.directory); }
  private file() { return path.join(this.dir(),"recovery-advisor-settings-v1.json"); }
  private lock() { return path.join(this.dir(),".recovery-advisor-settings-lock"); }
  private emergency() { return new DurableAdvisorStop(this.dir(),this.projectId); }
  /** Durable one-click stop independent of the consultation policy lease. */
  async stopNow(): Promise<AdvisorStopResultV1> { return this.emergency().stopNow(); }
  watchImmediateStop(intervalMs?:number):{signal:AbortSignal;close:()=>void} {
    return this.emergency().watch(intervalMs);
  }
  async isEmergencyStopped():Promise<boolean> { return this.emergency().isStopped(); }
  private async secureDirectory(): Promise<void> {
    try {
      await mkdir(this.dir(),{recursive:true,mode:0o700});
      const s=await lstat(this.dir());
      if (!s.isDirectory() || s.isSymbolicLink()
        || (process.platform!=="win32" && (s.mode & 0o077)!==0))
        throw new Error("unsafe-dir");
    } catch { throw new AdvisorSettingsError("unsafe"); }
  }
  private async load(): Promise<StoredSettings | undefined> {
    try {
      const s=await lstat(this.file());
      if (!s.isFile() || s.isSymbolicLink() || s.size>8192
        || (process.platform!=="win32" && (s.mode&0o077)!==0))
        throw new Error("invalid-file");
      const value:unknown=JSON.parse(await readFile(this.file(),"utf8"));
      if (!validStored(value,this.projectId)) throw new Error("invalid-policy");
      return value;
    } catch(e) {
      if ((e as NodeJS.ErrnoException)?.code==="ENOENT") return undefined;
      throw new AdvisorSettingsError("unsafe");
    }
  }
  /**
   * Trusted host only. Re-read the protected policy before each eligibility
   * assessment; a saved Off/expired policy cannot be reused from a UI view.
   * This is not an authorization token and must not be returned to browsers.
   */
  async readCurrentPolicy(): Promise<AdvisorStandingPolicyV1 | undefined> {
    await this.secureDirectory();
    if (await this.isEmergencyStopped()) return undefined;
    const data = await this.load();
    if (!data) return undefined;
    const at = this.now();
    if (!validTime(at)) throw new AdvisorSettingsError("unsafe");
    // Preserve the exact prior policy for explicit expired/Off classification.
    // Return a defensive copy so callers cannot mutate the in-memory evidence.
    return {
      ...data.policy,
      allowedSignals: [...data.policy.allowedSignals],
    };
  }

  /**
   * Protect the final consent check and one-shot consultation from a
   * concurrent settings change. Uses the same exclusive lock as save().
   * A Save during an active consultation fails busy, never silently changes
   * the policy after the final check but before provider submission.
   * No timeout or background retry is introduced.
   */
  async withCurrentPolicyLease<T>(
    use: (policy: AdvisorStandingPolicyV1 | undefined) => Promise<T>,
  ): Promise<T> {
    if (typeof use !== "function") throw new AdvisorSettingsError("invalid");
    await this.secureDirectory();
    let held = false;
    try {
      try { await mkdir(this.lock(), { mode: 0o700 }); held = true; }
      catch { throw new AdvisorSettingsError("busy"); }
      const data = await this.load();
      const stopped=await this.isEmergencyStopped();
      const policy = data && !stopped ? { ...data.policy, allowedSignals: [...data.policy.allowedSignals] } : undefined;
      return await use(policy);
    } finally {
      if (held) await rm(this.lock(), {recursive:true,force:true}).catch(()=>undefined);
    }
  }

  async inspect(): Promise<AdvisorSettingsViewV1> {
    await this.secureDirectory();
    const data=await this.load();
    const at=this.now();
    if (!validTime(at)) throw new AdvisorSettingsError("unsafe");
    const stopped=await this.isEmergencyStopped();
    const expired=!!data && data.policy.expiresAtMs<=at;
    return Object.freeze({
      schemaVersion:1, projectId:this.projectId,
      mode:stopped||expired?"off":data?.policy.mode ?? "off",
      maxEstimatedCentsPerIncident:data?.policy.maxEstimatedCentsPerIncident ?? 100,
      durationDays:data && data.policy.expiresAtMs-data.policy.approvedAtMs===7*86400000?7:30,
      revision:data?.policy.revision ?? OFF_REVISION,
      ...(data?{consentExpiresAt:new Date(data.policy.expiresAtMs).toISOString()}:{}),
      expired,stopLatched:stopped,externalCallsEnabled:false,grantsAuthority:false,
    });
  }
  /**
   * M19R3L: authenticated operator reset, not advisor re-authorization.
   * Locks out consultation, writes a NEW Off consent revision durably before
   * clearing Stop, and requires a subsequent fresh operator Save to opt in.
   * A crash before clearing Stop remains fail-closed.
   */
  async resetStop(expectedRevision:string):Promise<AdvisorSettingsViewV1> {
    if(!isRevision(expectedRevision))throw new AdvisorSettingsError("invalid");
    await this.secureDirectory();
    let held=false;
    try {
      try {await mkdir(this.lock(),{mode:0o700});held=true;}
      catch {throw new AdvisorSettingsError("busy");}
      const previous=await this.load();
      if((previous?.policy.revision ?? OFF_REVISION)!==expectedRevision)
        throw new AdvisorSettingsError("stale");
      if(!await this.isEmergencyStopped())throw new AdvisorSettingsError("stale");
      const now=this.now();
      if(!validTime(now))throw new AdvisorSettingsError("unsafe");
      const policy:AdvisorStandingPolicyV1={
        schemaVersion:1,source:"operator_approved_settings",
        projectId:this.projectId,mode:"off",destination:"openai_responses_api",
        disclosure:"incident_metadata_only",approvedAtMs:now,
        expiresAtMs:now+7*86400000,
        revision:crypto.randomBytes(32).toString("hex"),
        allowedSignals:["context_pressure","watchdog_stall","validation_failure"],
        maxEstimatedCentsPerIncident:previous?.policy.maxEstimatedCentsPerIncident ?? 100,
        operatorAcknowledgedExternalTransfer:true,
      };
      const temp=path.join(this.dir(),".advisor-off-"+crypto.randomUUID()+".tmp");
      let file:Awaited<ReturnType<typeof open>>|undefined;
      try {
        file=await open(temp,"wx",0o600);
        await file.writeFile(JSON.stringify({schemaVersion:1,policy}),"utf8");
        await file.sync();
        await file.close();file=undefined;
        await rename(temp,this.file());
      }catch {
        await file?.close().catch(()=>undefined);
        await rm(temp,{force:true}).catch(()=>undefined);
        throw new AdvisorSettingsError("unsafe");
      }
      // Never clear Stop if the protected Off commit failed. A concurrent
      // Stop cannot falsely return success during this transition.
      try {await this.emergency().clearAfterOffCommitted();}
      catch {throw new AdvisorSettingsError("unsafe");}
    }finally {
      if(held)await rm(this.lock(),{recursive:true,force:true}).catch(()=>undefined);
    }
    return this.inspect();
  }

  async save(input:AdvisorSettingsEditV1): Promise<AdvisorSettingsViewV1> {
    if (!input || !isRevision(input.expectedRevision) || !MODES.includes(input.mode)
      || !ADVISOR_SETTINGS_CONTRACT.allowedCents.includes(input.maxEstimatedCentsPerIncident as never)
      || !ADVISOR_SETTINGS_CONTRACT.allowedDays.includes(input.durationDays as never)
      || (input.mode!=="off" && input.acknowledgedExternalMetadata!==true)
      || typeof input.acknowledgedExternalMetadata!=="boolean") {
      throw new AdvisorSettingsError("invalid");
    }
    await this.secureDirectory();
    // A normal Save may not implicitly clear emergency revocation.
    if (await this.isEmergencyStopped()) {
      if(input.mode!=="off") throw new AdvisorSettingsError("unsafe");
      return this.inspect();
    }
    let acquired=false;
    try {
      try { await mkdir(this.lock(),{mode:0o700});acquired=true; }
      catch { throw new AdvisorSettingsError("busy"); }
      if (await this.isEmergencyStopped())throw new AdvisorSettingsError("unsafe");
      const previous=await this.load();
      if ((previous?.policy.revision ?? OFF_REVISION)!==input.expectedRevision)
        throw new AdvisorSettingsError("stale");
      const at=this.now();
      if (!validTime(at)) throw new AdvisorSettingsError("unsafe");
      const policy:AdvisorStandingPolicyV1={
        schemaVersion:1,source:"operator_approved_settings",
        projectId:this.projectId,mode:input.mode,
        destination:"openai_responses_api",disclosure:"incident_metadata_only",
        approvedAtMs:at,expiresAtMs:at+input.durationDays*86400000,
        revision:crypto.randomBytes(32).toString("hex"),
        allowedSignals:["context_pressure","watchdog_stall","validation_failure"],
        maxEstimatedCentsPerIncident:input.maxEstimatedCentsPerIncident,
        operatorAcknowledgedExternalTransfer:true,
      };
      const temporary=path.join(this.dir(),".recovery-advisor-"+crypto.randomUUID()+".tmp");
      try {
        await writeFile(temporary,JSON.stringify({schemaVersion:1,policy}),{
          encoding:"utf8",flag:"wx",mode:0o600,
        });
        await rename(temporary,this.file());
      } catch {
        await rm(temporary,{force:true}).catch(()=>undefined);
        throw new AdvisorSettingsError("unsafe");
      }
    } finally {
      if (acquired) await rm(this.lock(),{recursive:true,force:true}).catch(()=>undefined);
    }
    return this.inspect();
  }
}
