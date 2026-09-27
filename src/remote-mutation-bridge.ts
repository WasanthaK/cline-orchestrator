import crypto from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { OperatorMutationActionV1 } from "./operator-capabilities.js";
import { RemoteRegistrationStore } from "./remote-registration-store.js";
import {
  RemoteSessionGateway,
  type RemoteSessionAuthorizedRequestV1,
} from "./remote-session-gateway.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_PROPOSALS = 256;
const MAX_PAYLOAD_CHARS = 24_000;
const MAX_BRIDGE_PERMITS = 64;
const MAX_ACTION_BINDING_CHARS = 4_000;

export type RemoteMutationProposalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "executed"
  | "execution_failed";

export interface RemoteMutationProposalV1 {
  schemaVersion: 1;
  proposalId: string;
  registrationId: string;
  sessionId: string;
  remotePrincipalId: string;
  registrationRevision: number;
  requestId: string;
  action: OperatorMutationActionV1;
  targetId: string;
  payloadDigest: string;
  payloadChars: number;
  revision: number;
  status: RemoteMutationProposalStatus;
  createdAt: string;
  approvedAt?: string;
  rejectedAt?: string;
  executedAt?: string;
  executionFailedAt?: string;
  actionBinding?: string;
}

interface RemoteMutationProposalSnapshotV1 {
  schemaVersion: 1;
  proposals: RemoteMutationProposalV1[];
}

export interface RemoteMutationPreparedActionV1 {
  actionBinding: string;
  expiresAt: string;
  execute(): Promise<unknown>;
}

export interface RemoteMutationActionAdapter {
  prepare(input: {
    proposal: RemoteMutationProposalV1;
    payload: unknown;
  }): Promise<RemoteMutationPreparedActionV1>;
}

export interface RemoteMutationLocalApprovalV1 {
  schemaVersion: 1;
  proposal: RemoteMutationProposalV1;
  bridgePermit: string;
  expiresAt: string;
}

export interface RemoteMutationExecutionResultV1 {
  schemaVersion: 1;
  proposal: RemoteMutationProposalV1;
  result: unknown;
}

export interface RemoteMutationBridgeOptions {
  now?: () => Date;
  idFactory?: () => string;
  permitFactory?: () => string;
}

export class RemoteMutationBridgeError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "proposal_invalid"
      | "proposal_not_found"
      | "proposal_conflict"
      | "proposal_stale"
      | "proposal_material_unavailable"
      | "permit_invalid"
      | "permit_expired"
      | "capacity_exceeded"
      | "store_corrupt",
  ) {
    super(message);
    this.name = "RemoteMutationBridgeError";
  }
}

interface PendingPermit {
  proposalId: string;
  proposalRevision: number;
  registrationId: string;
  sessionId: string;
  remotePrincipalId: string;
  registrationRevision: number;
  action: OperatorMutationActionV1;
  payloadDigest: string;
  expiresAtMs: number;
  execute(): Promise<unknown>;
}

function requireUuid(value: string, field: string): string {
  if (!UUID.test(value)) {
    throw new RemoteMutationBridgeError(`${field} must be an opaque UUID`, "proposal_invalid");
  }
  return value;
}

function canonicalValue(value: unknown, depth = 0): unknown {
  if (depth > 20) throw new RemoteMutationBridgeError("mutation payload is too deeply nested", "proposal_invalid");
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new RemoteMutationBridgeError("mutation payload contains non-finite number", "proposal_invalid");
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => canonicalValue(item, depth + 1));
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      if (!key || key.includes("\0") || record[key] === undefined) {
        throw new RemoteMutationBridgeError("mutation payload contains invalid field", "proposal_invalid");
      }
      output[key] = canonicalValue(record[key], depth + 1);
    }
    return output;
  }
  throw new RemoteMutationBridgeError("mutation payload contains unsupported value", "proposal_invalid");
}

function payloadEvidence(payload: unknown): { canonical: string; digest: string; chars: number } {
  const canonical = JSON.stringify(canonicalValue(payload));
  if (canonical.length > MAX_PAYLOAD_CHARS) {
    throw new RemoteMutationBridgeError(`mutation payload exceeds ${MAX_PAYLOAD_CHARS} characters`, "proposal_invalid");
  }
  return {
    canonical,
    digest: crypto.createHash("sha256").update(canonical, "utf8").digest("hex"),
    chars: canonical.length,
  };
}

function actionBindingEvidence(value: string): string {
  if (typeof value !== "string" || !value || value.includes("\0") || value.length > MAX_ACTION_BINDING_CHARS) {
    throw new RemoteMutationBridgeError("trusted action binding is invalid", "proposal_stale");
  }
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function cloneProposal(value: RemoteMutationProposalV1): RemoteMutationProposalV1 {
  return structuredClone(value);
}

function validateProposal(value: RemoteMutationProposalV1): RemoteMutationProposalV1 {
  if (value.schemaVersion !== 1) throw new RemoteMutationBridgeError("unsupported proposal schema", "store_corrupt");
  requireUuid(value.proposalId, "proposalId");
  requireUuid(value.registrationId, "registrationId");
  requireUuid(value.sessionId, "sessionId");
  requireUuid(value.remotePrincipalId, "remotePrincipalId");
  requireUuid(value.requestId, "requestId");
  requireUuid(value.targetId, "targetId");
  if (!Number.isSafeInteger(value.registrationRevision) || value.registrationRevision < 1
    || !Number.isSafeInteger(value.revision) || value.revision < 1) {
    throw new RemoteMutationBridgeError("proposal revisions are invalid", "store_corrupt");
  }
  if (!/^[a-f0-9]{64}$/.test(value.payloadDigest) || !Number.isSafeInteger(value.payloadChars) || value.payloadChars < 0) {
    throw new RemoteMutationBridgeError("proposal payload evidence is invalid", "store_corrupt");
  }
  if (value.actionBinding !== undefined && !/^[a-f0-9]{64}$/.test(value.actionBinding)) {
    throw new RemoteMutationBridgeError("proposal action binding evidence is invalid", "store_corrupt");
  }
  const allowedStatus: RemoteMutationProposalStatus[] = ["pending", "approved", "rejected", "executed", "execution_failed"];
  if (!allowedStatus.includes(value.status) || !Number.isFinite(Date.parse(value.createdAt))) {
    throw new RemoteMutationBridgeError("proposal state is invalid", "store_corrupt");
  }
  return cloneProposal(value);
}

export class RemoteMutationProposalStore {
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly rootDir: string,
    private readonly options: Pick<RemoteMutationBridgeOptions, "now" | "idFactory"> = {},
  ) {}

  private dir(): string {
    return path.join(this.rootDir, "remote-control");
  }

  private file(): string {
    return path.join(this.dir(), "mutation-proposals.json");
  }

  private tempFile(): string {
    return path.join(this.dir(), `.mutation-proposals-${process.pid}-${crypto.randomUUID()}.tmp`);
  }

  private nowIso(): string {
    const now = (this.options.now ?? (() => new Date()))();
    if (!Number.isFinite(now.getTime())) throw new RemoteMutationBridgeError("proposal clock is invalid", "proposal_invalid");
    return now.toISOString();
  }

  private async readSnapshot(): Promise<RemoteMutationProposalSnapshotV1> {
    try {
      const raw = await readFile(this.file(), "utf8");
      const parsed = JSON.parse(raw) as RemoteMutationProposalSnapshotV1;
      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.proposals) || parsed.proposals.length > MAX_PROPOSALS) {
        throw new RemoteMutationBridgeError("mutation proposal store schema is invalid", "store_corrupt");
      }
      const ids = new Set<string>();
      const proposals = parsed.proposals.map((proposal) => {
        const validated = validateProposal(proposal);
        if (ids.has(validated.proposalId)) throw new RemoteMutationBridgeError("duplicate mutation proposal id", "store_corrupt");
        ids.add(validated.proposalId);
        return validated;
      });
      return { schemaVersion: 1, proposals };
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return { schemaVersion: 1, proposals: [] };
      if (error instanceof RemoteMutationBridgeError) throw error;
      throw new RemoteMutationBridgeError("mutation proposal store is corrupt", "store_corrupt");
    }
  }

  private async writeSnapshot(snapshot: RemoteMutationProposalSnapshotV1): Promise<void> {
    await mkdir(this.dir(), { recursive: true });
    const temp = this.tempFile();
    await writeFile(temp, `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temp, this.file());
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationTail.then(operation, operation);
    this.mutationTail = result.then(() => undefined, () => undefined);
    return result;
  }

  async create(input: Omit<RemoteMutationProposalV1, "schemaVersion" | "proposalId" | "revision" | "status" | "createdAt">): Promise<RemoteMutationProposalV1> {
    return await this.serialize(async () => {
      const snapshot = await this.readSnapshot();
      if (snapshot.proposals.length >= MAX_PROPOSALS) throw new RemoteMutationBridgeError("mutation proposal capacity exceeded", "capacity_exceeded");
      const proposal = validateProposal({
        schemaVersion: 1,
        proposalId: requireUuid((this.options.idFactory ?? (() => crypto.randomUUID()))(), "proposalId"),
        ...input,
        revision: 1,
        status: "pending",
        createdAt: this.nowIso(),
      });
      if (snapshot.proposals.some((item) => item.proposalId === proposal.proposalId)) {
        throw new RemoteMutationBridgeError("mutation proposal id already exists", "proposal_conflict");
      }
      snapshot.proposals.push(proposal);
      await this.writeSnapshot(snapshot);
      return cloneProposal(proposal);
    });
  }

  async get(proposalId: string): Promise<RemoteMutationProposalV1> {
    proposalId = requireUuid(proposalId, "proposalId");
    const snapshot = await this.readSnapshot();
    const proposal = snapshot.proposals.find((item) => item.proposalId === proposalId);
    if (!proposal) throw new RemoteMutationBridgeError("mutation proposal was not found", "proposal_not_found");
    return cloneProposal(proposal);
  }

  async transition(
    proposalId: string,
    expectedRevision: number,
    expectedStatus: RemoteMutationProposalStatus,
    patch: Partial<Pick<RemoteMutationProposalV1, "status" | "approvedAt" | "rejectedAt" | "executedAt" | "executionFailedAt" | "actionBinding">>,
  ): Promise<RemoteMutationProposalV1> {
    proposalId = requireUuid(proposalId, "proposalId");
    return await this.serialize(async () => {
      const snapshot = await this.readSnapshot();
      const index = snapshot.proposals.findIndex((item) => item.proposalId === proposalId);
      if (index < 0) throw new RemoteMutationBridgeError("mutation proposal was not found", "proposal_not_found");
      const current = snapshot.proposals[index]!;
      if (current.revision !== expectedRevision || current.status !== expectedStatus) {
        throw new RemoteMutationBridgeError("mutation proposal changed", "proposal_conflict");
      }
      const next = validateProposal({ ...current, ...patch, revision: current.revision + 1 });
      snapshot.proposals[index] = next;
      await this.writeSnapshot(snapshot);
      return cloneProposal(next);
    });
  }
}

export class RemoteMutationApprovalBridge {
  private readonly material = new Map<string, unknown>();
  private readonly permits = new Map<string, PendingPermit>();
  readonly proposals: RemoteMutationProposalStore;

  constructor(
    private readonly sessions: RemoteSessionGateway,
    private readonly registrations: RemoteRegistrationStore,
    private readonly adapter: RemoteMutationActionAdapter,
    rootDir: string,
    private readonly options: RemoteMutationBridgeOptions = {},
  ) {
    this.proposals = new RemoteMutationProposalStore(rootDir, options);
  }

  private now(): Date {
    const now = (this.options.now ?? (() => new Date()))();
    if (!Number.isFinite(now.getTime())) throw new RemoteMutationBridgeError("bridge clock is invalid", "proposal_invalid");
    return now;
  }

  private prunePermits(nowMs: number): void {
    for (const [token, permit] of this.permits) if (permit.expiresAtMs <= nowMs) this.permits.delete(token);
  }

  async propose(input: {
    bearerToken: string;
    requestId: string;
    action: OperatorMutationActionV1;
    targetId: string;
    payload: unknown;
  }): Promise<RemoteMutationProposalV1> {
    const authorized = await this.sessions.authorize(
      input.bearerToken,
      input.requestId,
      { kind: "mutation", action: input.action },
    );
    const evidence = payloadEvidence(input.payload);
    const proposal = await this.proposals.create({
      registrationId: authorized.registrationId,
      sessionId: authorized.sessionId,
      remotePrincipalId: authorized.remotePrincipalId,
      registrationRevision: authorized.registrationRevision,
      requestId: authorized.requestId,
      action: input.action,
      targetId: requireUuid(input.targetId, "targetId"),
      payloadDigest: evidence.digest,
      payloadChars: evidence.chars,
    });
    this.material.set(proposal.proposalId, structuredClone(input.payload));
    return proposal;
  }

  async rejectLocally(proposalId: string, expectedRevision: number): Promise<RemoteMutationProposalV1> {
    this.material.delete(proposalId);
    return await this.proposals.transition(proposalId, expectedRevision, "pending", {
      status: "rejected",
      rejectedAt: this.now().toISOString(),
    });
  }

  async approveLocally(proposalId: string, expectedRevision: number): Promise<RemoteMutationLocalApprovalV1> {
    const proposal = await this.proposals.get(proposalId);
    if (proposal.revision !== expectedRevision || proposal.status !== "pending") {
      throw new RemoteMutationBridgeError("mutation proposal changed before approval", "proposal_conflict");
    }
    const registration = await this.registrations.getRegistration(proposal.registrationId);
    if (registration.revokedAt || registration.revision !== proposal.registrationRevision) {
      throw new RemoteMutationBridgeError("registration changed after mutation proposal", "proposal_stale");
    }
    const payload = this.material.get(proposalId);
    if (payload === undefined) {
      throw new RemoteMutationBridgeError("proposal payload is no longer available; submit a new proposal", "proposal_material_unavailable");
    }
    const evidence = payloadEvidence(payload);
    if (evidence.digest !== proposal.payloadDigest) throw new RemoteMutationBridgeError("proposal payload evidence changed", "proposal_stale");

    const now = this.now();
    this.prunePermits(now.getTime());
    if (this.permits.size >= MAX_BRIDGE_PERMITS) throw new RemoteMutationBridgeError("bridge permit capacity exceeded", "capacity_exceeded");
    const prepared = await this.adapter.prepare({ proposal, payload: structuredClone(payload) });
    const expiresAtMs = Date.parse(prepared.expiresAt);
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now.getTime()) {
      throw new RemoteMutationBridgeError("trusted action preview returned an invalid expiry", "proposal_stale");
    }
    const bridgePermit = (this.options.permitFactory ?? (() => `rmp_${crypto.randomBytes(32).toString("base64url")}`))();
    if (typeof bridgePermit !== "string" || bridgePermit.length < 32 || bridgePermit.includes("\0")) {
      throw new RemoteMutationBridgeError("bridge permit factory returned invalid permit", "permit_invalid");
    }
    const approved = await this.proposals.transition(proposalId, expectedRevision, "pending", {
      status: "approved",
      approvedAt: now.toISOString(),
      actionBinding: actionBindingEvidence(prepared.actionBinding),
    });
    this.permits.set(bridgePermit, {
      proposalId,
      proposalRevision: approved.revision,
      registrationId: approved.registrationId,
      sessionId: approved.sessionId,
      remotePrincipalId: approved.remotePrincipalId,
      registrationRevision: approved.registrationRevision,
      action: approved.action,
      payloadDigest: approved.payloadDigest,
      expiresAtMs,
      execute: prepared.execute,
    });
    return { schemaVersion: 1, proposal: approved, bridgePermit, expiresAt: new Date(expiresAtMs).toISOString() };
  }

  async executeApproved(input: {
    bearerToken: string;
    requestId: string;
    proposalId: string;
    bridgePermit: string;
    payload: unknown;
  }): Promise<RemoteMutationExecutionResultV1> {
    const proposal = await this.proposals.get(input.proposalId);
    const authorized: RemoteSessionAuthorizedRequestV1 = await this.sessions.authorize(
      input.bearerToken,
      input.requestId,
      { kind: "mutation", action: proposal.action },
    );
    const permit = this.permits.get(input.bridgePermit);
    if (!permit || permit.proposalId !== proposal.proposalId || permit.proposalRevision !== proposal.revision) {
      throw new RemoteMutationBridgeError("bridge permit is invalid or already used", "permit_invalid");
    }
    // Burn the human-approved permit before the first awaited mutation execution.
    this.permits.delete(input.bridgePermit);

    try {
      const now = this.now();
      if (now.getTime() >= permit.expiresAtMs) {
        throw new RemoteMutationBridgeError("bridge permit expired", "permit_expired");
      }
      if (proposal.status !== "approved"
        || authorized.registrationId !== permit.registrationId
        || authorized.sessionId !== permit.sessionId
        || authorized.remotePrincipalId !== permit.remotePrincipalId
        || authorized.registrationRevision !== permit.registrationRevision) {
        throw new RemoteMutationBridgeError("approved proposal no longer matches current remote session", "proposal_stale");
      }
      const evidence = payloadEvidence(input.payload);
      if (evidence.digest !== permit.payloadDigest || evidence.digest !== proposal.payloadDigest) {
        throw new RemoteMutationBridgeError("mutation payload does not match approved proposal", "proposal_stale");
      }

      const result = await permit.execute();
      const executed = await this.proposals.transition(proposal.proposalId, proposal.revision, "approved", {
        status: "executed",
        executedAt: this.now().toISOString(),
      });
      this.material.delete(proposal.proposalId);
      return { schemaVersion: 1, proposal: executed, result };
    } catch (error) {
      try {
        await this.proposals.transition(proposal.proposalId, proposal.revision, "approved", {
          status: "execution_failed",
          executionFailedAt: this.now().toISOString(),
        });
      } finally {
        this.material.delete(proposal.proposalId);
      }
      throw error;
    }
  }
}
