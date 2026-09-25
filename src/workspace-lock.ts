import crypto from "node:crypto";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MIN_LEASE_MS = 1_000;
const MAX_LEASE_MS = 10 * 60_000;

export const WORKSPACE_LOCK_LIMITS = Object.freeze({
  minLeaseMs: MIN_LEASE_MS,
  maxLeaseMs: MAX_LEASE_MS,
});

export type WorkspaceAccessMode = "observe" | "write";

export interface WorkspaceWriterLeaseV1 {
  leaseId: string;
  fenceToken: string;
  taskId: string;
  ownerInstanceId: string;
  acquiredAt: string;
  expiresAt: string;
}

export interface WorkspaceLockStateV1 {
  schemaVersion: 1;
  workspaceId: string;
  revision: number;
  activeWriter?: WorkspaceWriterLeaseV1;
  coordination: {
    exclusiveWriter: true;
    observersRequireLease: false;
    grantsTaskAuthority: false;
    grantsFilesystemAuthority: false;
  };
}

export interface WorkspaceWriterClaimV1 {
  schemaVersion: 1;
  workspaceId: string;
  stateRevision: number;
  leaseId: string;
  fenceToken: string;
  taskId: string;
  ownerInstanceId: string;
  expiresAt: string;
  authority: "coordination_only";
}

export interface WorkspaceWriterAcquireRequest {
  workspaceId: string;
  taskId: string;
  ownerInstanceId: string;
  leaseMs: number;
}

export interface WorkspaceLockOptions {
  now?: () => Date;
  idFactory?: () => string;
}

export class WorkspaceLockError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "lock_invalid"
      | "writer_conflict"
      | "stale_claim"
      | "lease_expired",
  ) {
    super(message);
    this.name = "WorkspaceLockError";
  }
}

function opaqueUuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID.test(value.trim())) {
    throw new WorkspaceLockError(`${field} must be an opaque UUID`, "lock_invalid");
  }
  return value.trim();
}

function revision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new WorkspaceLockError("workspace lock revision must be a positive integer", "lock_invalid");
  }
  return value as number;
}

function leaseMs(value: unknown): number {
  if (
    !Number.isSafeInteger(value)
    || (value as number) < MIN_LEASE_MS
    || (value as number) > MAX_LEASE_MS
  ) {
    throw new WorkspaceLockError(
      `leaseMs must be an integer between ${MIN_LEASE_MS} and ${MAX_LEASE_MS}`,
      "lock_invalid",
    );
  }
  return value as number;
}

function iso(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new WorkspaceLockError(`${field} must be an ISO timestamp`, "lock_invalid");
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new WorkspaceLockError(`${field} must be an ISO timestamp`, "lock_invalid");
  }
  return new Date(parsed).toISOString();
}

function fixedCoordination(): WorkspaceLockStateV1["coordination"] {
  return {
    exclusiveWriter: true,
    observersRequireLease: false,
    grantsTaskAuthority: false,
    grantsFilesystemAuthority: false,
  };
}

export function workspaceAccessRequiresWriterLease(mode: WorkspaceAccessMode): boolean {
  return mode === "write";
}

export function createWorkspaceLockState(workspaceId: string): WorkspaceLockStateV1 {
  return {
    schemaVersion: 1,
    workspaceId: opaqueUuid(workspaceId, "workspaceId"),
    revision: 1,
    coordination: fixedCoordination(),
  };
}

export function assertWorkspaceLockState(value: unknown): asserts value is WorkspaceLockStateV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WorkspaceLockError("workspace lock state must be an object", "lock_invalid");
  }
  const state = value as Record<string, unknown>;
  const allowed = new Set(["schemaVersion", "workspaceId", "revision", "activeWriter", "coordination"]);
  if (Object.keys(state).some((key) => !allowed.has(key))) {
    throw new WorkspaceLockError("workspace lock state contains unsupported fields", "lock_invalid");
  }
  if (state.schemaVersion !== 1) {
    throw new WorkspaceLockError("workspace lock schemaVersion must be 1", "lock_invalid");
  }
  opaqueUuid(state.workspaceId, "workspaceId");
  revision(state.revision);

  if (!state.coordination || typeof state.coordination !== "object" || Array.isArray(state.coordination)) {
    throw new WorkspaceLockError("workspace lock coordination policy is invalid", "lock_invalid");
  }
  if (JSON.stringify(state.coordination) !== JSON.stringify(fixedCoordination())) {
    throw new WorkspaceLockError("workspace lock coordination policy cannot grant authority", "lock_invalid");
  }

  if (state.activeWriter !== undefined) {
    if (!state.activeWriter || typeof state.activeWriter !== "object" || Array.isArray(state.activeWriter)) {
      throw new WorkspaceLockError("activeWriter must be an object", "lock_invalid");
    }
    const writer = state.activeWriter as Record<string, unknown>;
    const keys = Object.keys(writer).sort().join(",");
    if (keys !== "acquiredAt,expiresAt,fenceToken,leaseId,ownerInstanceId,taskId") {
      throw new WorkspaceLockError("activeWriter contains unsupported fields", "lock_invalid");
    }
    opaqueUuid(writer.leaseId, "activeWriter.leaseId");
    opaqueUuid(writer.fenceToken, "activeWriter.fenceToken");
    opaqueUuid(writer.taskId, "activeWriter.taskId");
    opaqueUuid(writer.ownerInstanceId, "activeWriter.ownerInstanceId");
    const acquiredAt = iso(writer.acquiredAt, "activeWriter.acquiredAt");
    const expiresAt = iso(writer.expiresAt, "activeWriter.expiresAt");
    if (Date.parse(expiresAt) <= Date.parse(acquiredAt)) {
      throw new WorkspaceLockError("activeWriter expiry must follow acquisition", "lock_invalid");
    }
  }
}

function lockNow(options: WorkspaceLockOptions): Date {
  const now = (options.now ?? (() => new Date()))();
  if (!Number.isFinite(now.getTime())) {
    throw new WorkspaceLockError("lock clock returned an invalid timestamp", "lock_invalid");
  }
  return now;
}

function newOpaqueId(options: WorkspaceLockOptions, field: string): string {
  return opaqueUuid((options.idFactory ?? (() => crypto.randomUUID()))(), field);
}

function currentWriterExpired(state: WorkspaceLockStateV1, at: Date): boolean {
  return state.activeWriter !== undefined
    && Date.parse(state.activeWriter.expiresAt) <= at.getTime();
}

function claimFrom(state: WorkspaceLockStateV1): WorkspaceWriterClaimV1 {
  const writer = state.activeWriter;
  if (!writer) {
    throw new WorkspaceLockError("workspace has no active writer", "stale_claim");
  }
  return {
    schemaVersion: 1,
    workspaceId: state.workspaceId,
    stateRevision: state.revision,
    leaseId: writer.leaseId,
    fenceToken: writer.fenceToken,
    taskId: writer.taskId,
    ownerInstanceId: writer.ownerInstanceId,
    expiresAt: writer.expiresAt,
    authority: "coordination_only",
  };
}

/**
 * Pure conflict/fencing policy. The returned state still grants no task or
 * filesystem authority: a future scheduler/executor must independently revalidate
 * the durable task/Safety Plan before any write and must validate this claim again
 * immediately before a coordinated side effect.
 */
export function acquireWorkspaceWriter(
  rawState: WorkspaceLockStateV1,
  request: WorkspaceWriterAcquireRequest,
  options: WorkspaceLockOptions = {},
): { state: WorkspaceLockStateV1; claim: WorkspaceWriterClaimV1; replacedExpiredLease: boolean } {
  assertWorkspaceLockState(rawState);
  const state = structuredClone(rawState);
  const workspaceId = opaqueUuid(request.workspaceId, "workspaceId");
  if (workspaceId !== state.workspaceId) {
    throw new WorkspaceLockError("acquire request workspace does not match lock state", "lock_invalid");
  }
  const taskId = opaqueUuid(request.taskId, "taskId");
  const ownerInstanceId = opaqueUuid(request.ownerInstanceId, "ownerInstanceId");
  const duration = leaseMs(request.leaseMs);
  const now = lockNow(options);

  const expired = currentWriterExpired(state, now);
  if (state.activeWriter && !expired) {
    throw new WorkspaceLockError(
      `workspace already has an active writer lease for task ${state.activeWriter.taskId}`,
      "writer_conflict",
    );
  }

  state.revision += 1;
  state.activeWriter = {
    leaseId: newOpaqueId(options, "leaseId"),
    fenceToken: newOpaqueId(options, "fenceToken"),
    taskId,
    ownerInstanceId,
    acquiredAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + duration).toISOString(),
  };
  return {
    state,
    claim: claimFrom(state),
    replacedExpiredLease: expired,
  };
}

function assertClaimShape(claim: WorkspaceWriterClaimV1): void {
  if (claim.schemaVersion !== 1 || claim.authority !== "coordination_only") {
    throw new WorkspaceLockError("writer claim schema/authority is invalid", "stale_claim");
  }
  opaqueUuid(claim.workspaceId, "claim.workspaceId");
  revision(claim.stateRevision);
  opaqueUuid(claim.leaseId, "claim.leaseId");
  opaqueUuid(claim.fenceToken, "claim.fenceToken");
  opaqueUuid(claim.taskId, "claim.taskId");
  opaqueUuid(claim.ownerInstanceId, "claim.ownerInstanceId");
  iso(claim.expiresAt, "claim.expiresAt");
}

function claimMatchesCurrent(state: WorkspaceLockStateV1, claim: WorkspaceWriterClaimV1): boolean {
  const writer = state.activeWriter;
  return Boolean(
    writer
    && claim.workspaceId === state.workspaceId
    && claim.stateRevision === state.revision
    && claim.leaseId === writer.leaseId
    && claim.fenceToken === writer.fenceToken
    && claim.taskId === writer.taskId
    && claim.ownerInstanceId === writer.ownerInstanceId
    && claim.expiresAt === writer.expiresAt,
  );
}

export function validateWorkspaceWriterClaim(
  state: WorkspaceLockStateV1,
  claim: WorkspaceWriterClaimV1,
  now: Date = new Date(),
): void {
  assertWorkspaceLockState(state);
  assertClaimShape(claim);
  if (!Number.isFinite(now.getTime())) {
    throw new WorkspaceLockError("claim clock is invalid", "lock_invalid");
  }
  if (!claimMatchesCurrent(state, claim)) {
    throw new WorkspaceLockError("writer claim is stale or belongs to another owner", "stale_claim");
  }
  if (Date.parse(claim.expiresAt) <= now.getTime()) {
    throw new WorkspaceLockError("writer lease has expired", "lease_expired");
  }
}

export function releaseWorkspaceWriter(
  rawState: WorkspaceLockStateV1,
  claim: WorkspaceWriterClaimV1,
): WorkspaceLockStateV1 {
  assertWorkspaceLockState(rawState);
  assertClaimShape(claim);
  if (!claimMatchesCurrent(rawState, claim)) {
    throw new WorkspaceLockError("only the current fenced writer may release the lease", "stale_claim");
  }
  const state = structuredClone(rawState);
  delete state.activeWriter;
  state.revision += 1;
  return state;
}
