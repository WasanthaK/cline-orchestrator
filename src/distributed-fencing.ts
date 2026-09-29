import crypto from "node:crypto";
import {
  assertDistributedWriterCandidateAssignment,
  type DistributedWriterCandidateAssignmentV1,
} from "./distributed-control-contract.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MIN_FENCE_TTL_MS = 1_000;
const MAX_FENCE_TTL_MS = 60_000;
const DEFAULT_MAX_CAS_ATTEMPTS = 16;

export const DISTRIBUTED_FENCING_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  requiresLinearizableCompareExchange: true as const,
  requiresDurableMonotonicGeneration: true as const,
  requiresTargetWriteBoundaryRevalidation: true as const,
  requiresCurrentCandidateAssignment: true as const,
  composesWithLocalWriterLease: true as const,
  replacesLocalWriterLease: false as const,
  referenceBackendSingleProcessOnly: true as const,
  productionDistributedBackendConfigured: false as const,
  networkCommandDeliveryEnabled: false as const,
  taskExecutionEnabled: false as const,
  distributedWriteDispatchEnabled: false as const,
  distributedWriteExecutionEnabled: false as const,
  grantsTaskAuthority: false as const,
  grantsFilesystemAuthority: false as const,
  grantsSafetyPlanAuthority: false as const,
  grantsWriterLeaseAuthority: false as const,
  grantsCredentialAuthority: false as const,
  grantsReleaseAuthority: false as const,
});

export const DISTRIBUTED_FENCE_LIMITS = Object.freeze({
  minTtlMs: MIN_FENCE_TTL_MS,
  maxTtlMs: MAX_FENCE_TTL_MS,
});

export interface DistributedFenceClaimV1 {
  schemaVersion: 1;
  fenceId: string;
  workspaceId: string;
  taskId: string;
  machineId: string;
  machineRegistrationId: string;
  machineRegistrationRevision: number;
  placementId: string;
  placementRevision: number;
  candidateAssignmentId: string;
  generation: number;
  issuedAt: string;
  expiresAt: string;
  authority: "fencing_only";
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsSafetyPlanAuthority: false;
  grantsWriterLeaseAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}

export interface DistributedFenceStateV1 {
  schemaVersion: 1;
  workspaceId: string;
  revision: number;
  generation: number;
  activeFence?: DistributedFenceClaimV1;
  authority: "fencing_state_only";
}

/**
 * This is the only primitive a production M12 distributed fencing backend may
 * provide to the authority layer. compareExchange must be linearizable for one
 * workspace key across all participating machines/processes, and state must be
 * durable enough that a backend/client restart cannot reset or reuse generations.
 */
export interface DistributedFenceBackend {
  read(workspaceId: string): Promise<DistributedFenceStateV1 | undefined>;
  compareExchange(
    workspaceId: string,
    expectedRevision: number | null,
    next: DistributedFenceStateV1,
  ): Promise<boolean>;
}

export interface DistributedFenceCandidateValidator {
  assertCandidateCurrent(
    assignment: DistributedWriterCandidateAssignmentV1,
    observedNow?: Date,
  ): Promise<void>;
}

export interface DistributedFenceAcquireRequestV1 {
  assignment: DistributedWriterCandidateAssignmentV1;
  ttlMs: number;
}

export interface DistributedFenceAuthorityOptions {
  now?: () => Date;
  idFactory?: () => string;
  maxCasAttempts?: number;
}

export class DistributedFenceError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "request_invalid"
      | "candidate_not_current"
      | "backend_invalid"
      | "backend_unavailable"
      | "fence_conflict"
      | "fence_stale"
      | "fence_expired"
      | "generation_exhausted"
      | "contention_exhausted",
  ) {
    super(message);
    this.name = "DistributedFenceError";
  }
}

function exactKeys(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
  label: string,
  code: DistributedFenceError["code"],
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DistributedFenceError(`${label} must be an object`, code);
  }
  const keys = Object.keys(value as Record<string, unknown>);
  const allowed = new Set([...required, ...optional]);
  if (
    required.some((key) => !keys.includes(key))
    || keys.some((key) => !allowed.has(key))
  ) {
    throw new DistributedFenceError(`${label} contains unsupported or missing fields`, code);
  }
}

function uuid(value: unknown, field: string, code: DistributedFenceError["code"]): string {
  if (typeof value !== "string" || !UUID.test(value.trim())) {
    throw new DistributedFenceError(`${field} must be an opaque UUID`, code);
  }
  return value.trim();
}

function positiveInteger(
  value: unknown,
  field: string,
  code: DistributedFenceError["code"],
): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new DistributedFenceError(`${field} must be a positive integer`, code);
  }
  return value;
}

function iso(value: unknown, field: string, code: DistributedFenceError["code"]): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new DistributedFenceError(`${field} must be an ISO timestamp`, code);
  }
  return new Date(Date.parse(value)).toISOString();
}

function ttl(value: unknown): number {
  if (
    typeof value !== "number"
    || !Number.isSafeInteger(value)
    || value < MIN_FENCE_TTL_MS
    || value > MAX_FENCE_TTL_MS
  ) {
    throw new DistributedFenceError(
      `ttlMs must be an integer between ${MIN_FENCE_TTL_MS} and ${MAX_FENCE_TTL_MS}`,
      "request_invalid",
    );
  }
  return value;
}

export function assertDistributedFenceClaim(
  value: unknown,
): asserts value is DistributedFenceClaimV1 {
  exactKeys(
    value,
    [
      "schemaVersion",
      "fenceId",
      "workspaceId",
      "taskId",
      "machineId",
      "machineRegistrationId",
      "machineRegistrationRevision",
      "placementId",
      "placementRevision",
      "candidateAssignmentId",
      "generation",
      "issuedAt",
      "expiresAt",
      "authority",
      "grantsTaskAuthority",
      "grantsFilesystemAuthority",
      "grantsSafetyPlanAuthority",
      "grantsWriterLeaseAuthority",
      "grantsCredentialAuthority",
      "grantsReleaseAuthority",
    ],
    [],
    "distributed fence claim",
    "fence_stale",
  );
  const claim = value as Record<string, unknown>;
  if (
    claim.schemaVersion !== 1
    || claim.authority !== "fencing_only"
    || claim.grantsTaskAuthority !== false
    || claim.grantsFilesystemAuthority !== false
    || claim.grantsSafetyPlanAuthority !== false
    || claim.grantsWriterLeaseAuthority !== false
    || claim.grantsCredentialAuthority !== false
    || claim.grantsReleaseAuthority !== false
  ) {
    throw new DistributedFenceError(
      "distributed fence claim cannot grant task or execution authority",
      "fence_stale",
    );
  }
  uuid(claim.fenceId, "fenceId", "fence_stale");
  uuid(claim.workspaceId, "workspaceId", "fence_stale");
  uuid(claim.taskId, "taskId", "fence_stale");
  uuid(claim.machineId, "machineId", "fence_stale");
  uuid(claim.machineRegistrationId, "machineRegistrationId", "fence_stale");
  positiveInteger(claim.machineRegistrationRevision, "machineRegistrationRevision", "fence_stale");
  uuid(claim.placementId, "placementId", "fence_stale");
  positiveInteger(claim.placementRevision, "placementRevision", "fence_stale");
  uuid(claim.candidateAssignmentId, "candidateAssignmentId", "fence_stale");
  positiveInteger(claim.generation, "generation", "fence_stale");
  const issuedAt = iso(claim.issuedAt, "issuedAt", "fence_stale");
  const expiresAt = iso(claim.expiresAt, "expiresAt", "fence_stale");
  if (Date.parse(expiresAt) <= Date.parse(issuedAt)) {
    throw new DistributedFenceError("distributed fence expiry must follow issuance", "fence_stale");
  }
  if (Date.parse(expiresAt) - Date.parse(issuedAt) > MAX_FENCE_TTL_MS) {
    throw new DistributedFenceError("distributed fence TTL exceeds the allowed maximum", "fence_stale");
  }
}

export function assertDistributedFenceState(
  value: unknown,
): asserts value is DistributedFenceStateV1 {
  exactKeys(
    value,
    ["schemaVersion", "workspaceId", "revision", "generation", "authority"],
    ["activeFence"],
    "distributed fence state",
    "backend_invalid",
  );
  const state = value as Record<string, unknown>;
  if (state.schemaVersion !== 1 || state.authority !== "fencing_state_only") {
    throw new DistributedFenceError("distributed fence state schema/authority is invalid", "backend_invalid");
  }
  const workspaceId = uuid(state.workspaceId, "workspaceId", "backend_invalid");
  positiveInteger(state.revision, "revision", "backend_invalid");
  const generation = positiveInteger(state.generation, "generation", "backend_invalid");
  if (state.activeFence !== undefined) {
    try {
      assertDistributedFenceClaim(state.activeFence);
    } catch (error) {
      throw new DistributedFenceError(
        `distributed fence state contains an invalid active claim: ${error instanceof Error ? error.message : String(error)}`,
        "backend_invalid",
      );
    }
    const active = state.activeFence as DistributedFenceClaimV1;
    if (active.workspaceId !== workspaceId || active.generation !== generation) {
      throw new DistributedFenceError(
        "active distributed fence does not match state workspace/generation",
        "backend_invalid",
      );
    }
  }
}

function claimMatchesAssignment(
  claim: DistributedFenceClaimV1,
  assignment: DistributedWriterCandidateAssignmentV1,
): boolean {
  return claim.workspaceId === assignment.workspaceId
    && claim.taskId === assignment.taskId
    && claim.machineId === assignment.machineId
    && claim.machineRegistrationId === assignment.machineRegistrationId
    && claim.machineRegistrationRevision === assignment.machineRegistrationRevision
    && claim.placementId === assignment.placementId
    && claim.placementRevision === assignment.placementRevision
    && claim.candidateAssignmentId === assignment.assignmentId;
}

function sameClaim(left: DistributedFenceClaimV1, right: DistributedFenceClaimV1): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function baseState(
  workspaceId: string,
  revision: number,
  generation: number,
  activeFence?: DistributedFenceClaimV1,
): DistributedFenceStateV1 {
  return {
    schemaVersion: 1,
    workspaceId,
    revision,
    generation,
    ...(activeFence ? { activeFence: structuredClone(activeFence) } : {}),
    authority: "fencing_state_only",
  };
}

/**
 * Deterministic proof backend used by M12E tests and local contract exercises only.
 * Its compareExchange operation is linearizable only among callers sharing this
 * exact in-process instance. It is deliberately NOT a production distributed
 * backend and must never be used to enable cross-machine writer execution.
 */
export class ReferenceLinearizableFenceBackend implements DistributedFenceBackend {
  private readonly states = new Map<string, DistributedFenceStateV1>();

  async read(workspaceIdInput: string): Promise<DistributedFenceStateV1 | undefined> {
    const workspaceId = uuid(workspaceIdInput, "workspaceId", "backend_invalid");
    const value = this.states.get(workspaceId);
    if (!value) return undefined;
    assertDistributedFenceState(value);
    return structuredClone(value);
  }

  async compareExchange(
    workspaceIdInput: string,
    expectedRevision: number | null,
    nextInput: DistributedFenceStateV1,
  ): Promise<boolean> {
    const workspaceId = uuid(workspaceIdInput, "workspaceId", "backend_invalid");
    assertDistributedFenceState(nextInput);
    if (nextInput.workspaceId !== workspaceId) {
      throw new DistributedFenceError("fence backend key/state workspace mismatch", "backend_invalid");
    }

    const current = this.states.get(workspaceId);
    const currentRevision = current?.revision ?? null;
    if (currentRevision !== expectedRevision) return false;

    if (!current) {
      if (nextInput.revision !== 1 || nextInput.generation !== 1) {
        throw new DistributedFenceError(
          "initial fence state must start at revision/generation 1",
          "backend_invalid",
        );
      }
    } else {
      assertDistributedFenceState(current);
      if (nextInput.revision !== current.revision + 1) {
        throw new DistributedFenceError("fence backend revision must advance by one", "backend_invalid");
      }
      if (
        nextInput.generation < current.generation
        || nextInput.generation > current.generation + 1
      ) {
        throw new DistributedFenceError(
          "fence generation must never decrease, reset, or skip",
          "backend_invalid",
        );
      }
      if (
        nextInput.generation === current.generation + 1
        && !nextInput.activeFence
      ) {
        throw new DistributedFenceError(
          "a new fence generation requires an active claim",
          "backend_invalid",
        );
      }
    }

    this.states.set(workspaceId, structuredClone(nextInput));
    return true;
  }
}

/**
 * M12E fencing authority. It creates/revalidates only fencing evidence. Even a
 * valid claim grants no task, filesystem, Safety Plan, credential, local writer
 * lease, release, or execution authority. A future target-machine write boundary
 * must independently require: current immutable task/Safety/registry authority,
 * current local WorkspaceWriterClaimV1, AND validateCurrent() against a production
 * linearizable durable distributed backend immediately before each side effect.
 */
export class DistributedFenceAuthority {
  constructor(
    private readonly backend: DistributedFenceBackend,
    private readonly candidates: DistributedFenceCandidateValidator,
    private readonly options: DistributedFenceAuthorityOptions = {},
  ) {}

  private now(): Date {
    const value = (this.options.now ?? (() => new Date()))();
    if (!Number.isFinite(value.getTime())) {
      throw new DistributedFenceError("distributed fence clock is invalid", "request_invalid");
    }
    return value;
  }

  private newFenceId(): string {
    return uuid(
      (this.options.idFactory ?? (() => crypto.randomUUID()))(),
      "fenceId",
      "request_invalid",
    );
  }

  private maxCasAttempts(): number {
    const value = this.options.maxCasAttempts ?? DEFAULT_MAX_CAS_ATTEMPTS;
    if (!Number.isSafeInteger(value) || value < 1 || value > 128) {
      throw new DistributedFenceError("maxCasAttempts must be between 1 and 128", "request_invalid");
    }
    return value;
  }

  private async readState(workspaceId: string): Promise<DistributedFenceStateV1 | undefined> {
    let state: DistributedFenceStateV1 | undefined;
    try {
      state = await this.backend.read(workspaceId);
    } catch (error) {
      if (error instanceof DistributedFenceError) throw error;
      throw new DistributedFenceError(
        `distributed fence backend read failed: ${error instanceof Error ? error.message : String(error)}`,
        "backend_unavailable",
      );
    }
    if (state === undefined) return undefined;
    assertDistributedFenceState(state);
    if (state.workspaceId !== workspaceId) {
      throw new DistributedFenceError("distributed fence backend returned the wrong workspace", "backend_invalid");
    }
    return structuredClone(state);
  }

  private async cas(
    workspaceId: string,
    expectedRevision: number | null,
    next: DistributedFenceStateV1,
  ): Promise<boolean> {
    try {
      return await this.backend.compareExchange(workspaceId, expectedRevision, next);
    } catch (error) {
      if (error instanceof DistributedFenceError) throw error;
      throw new DistributedFenceError(
        `distributed fence backend compare-exchange failed: ${error instanceof Error ? error.message : String(error)}`,
        "backend_unavailable",
      );
    }
  }

  private async requireCandidate(
    assignment: DistributedWriterCandidateAssignmentV1,
    now: Date,
  ): Promise<void> {
    try {
      assertDistributedWriterCandidateAssignment(assignment);
      await this.candidates.assertCandidateCurrent(assignment, now);
    } catch {
      throw new DistributedFenceError(
        "writer candidate assignment is no longer current",
        "candidate_not_current",
      );
    }
  }

  async acquire(requestInput: DistributedFenceAcquireRequestV1): Promise<DistributedFenceClaimV1> {
    exactKeys(
      requestInput,
      ["assignment", "ttlMs"],
      [],
      "distributed fence acquire request",
      "request_invalid",
    );
    const duration = ttl(requestInput.ttlMs);
    const assignment = structuredClone(requestInput.assignment);
    const initialNow = this.now();
    await this.requireCandidate(assignment, initialNow);

    const assignmentExpiry = Date.parse(assignment.expiresAt);
    for (let attempt = 0; attempt < this.maxCasAttempts(); attempt += 1) {
      const now = this.now();
      await this.requireCandidate(assignment, now);
      const current = await this.readState(assignment.workspaceId);
      if (current?.activeFence && Date.parse(current.activeFence.expiresAt) > now.getTime()) {
        throw new DistributedFenceError(
          "workspace already has a live distributed fence holder",
          "fence_conflict",
        );
      }

      const generation = current ? current.generation + 1 : 1;
      if (!Number.isSafeInteger(generation) || generation < 1) {
        throw new DistributedFenceError(
          "distributed fence generation cannot advance safely",
          "generation_exhausted",
        );
      }
      const expiresAtMs = Math.min(now.getTime() + duration, assignmentExpiry);
      if (expiresAtMs <= now.getTime()) {
        throw new DistributedFenceError(
          "writer candidate expires before a distributed fence can be issued",
          "candidate_not_current",
        );
      }
      const claim: DistributedFenceClaimV1 = {
        schemaVersion: 1,
        fenceId: this.newFenceId(),
        workspaceId: assignment.workspaceId,
        taskId: assignment.taskId,
        machineId: assignment.machineId,
        machineRegistrationId: assignment.machineRegistrationId,
        machineRegistrationRevision: assignment.machineRegistrationRevision,
        placementId: assignment.placementId,
        placementRevision: assignment.placementRevision,
        candidateAssignmentId: assignment.assignmentId,
        generation,
        issuedAt: now.toISOString(),
        expiresAt: new Date(expiresAtMs).toISOString(),
        authority: "fencing_only",
        grantsTaskAuthority: false,
        grantsFilesystemAuthority: false,
        grantsSafetyPlanAuthority: false,
        grantsWriterLeaseAuthority: false,
        grantsCredentialAuthority: false,
        grantsReleaseAuthority: false,
      };
      assertDistributedFenceClaim(claim);
      const next = baseState(
        assignment.workspaceId,
        current ? current.revision + 1 : 1,
        generation,
        claim,
      );
      if (!await this.cas(assignment.workspaceId, current?.revision ?? null, next)) continue;

      try {
        await this.requireCandidate(assignment, this.now());
        await this.validateCurrent(claim, assignment);
      } catch (error) {
        try { await this.revoke(claim); } catch { /* preserve original failure */ }
        throw error;
      }
      return structuredClone(claim);
    }
    throw new DistributedFenceError(
      "distributed fence compare-exchange contention exceeded its bounded retry limit",
      "contention_exhausted",
    );
  }

  async validateCurrent(
    claimInput: DistributedFenceClaimV1,
    assignmentInput: DistributedWriterCandidateAssignmentV1,
    observedNow?: Date,
  ): Promise<void> {
    assertDistributedFenceClaim(claimInput);
    try {
      assertDistributedWriterCandidateAssignment(assignmentInput);
    } catch {
      throw new DistributedFenceError("writer candidate assignment is invalid", "candidate_not_current");
    }
    if (!claimMatchesAssignment(claimInput, assignmentInput)) {
      throw new DistributedFenceError(
        "distributed fence claim no longer matches its writer candidate assignment",
        "fence_stale",
      );
    }
    const now = observedNow ?? this.now();
    if (!Number.isFinite(now.getTime())) {
      throw new DistributedFenceError("distributed fence validation clock is invalid", "request_invalid");
    }
    await this.requireCandidate(assignmentInput, now);
    if (Date.parse(claimInput.expiresAt) <= now.getTime()) {
      throw new DistributedFenceError("distributed fence claim has expired", "fence_expired");
    }
    const state = await this.readState(claimInput.workspaceId);
    if (
      !state
      || state.generation !== claimInput.generation
      || !state.activeFence
      || !sameClaim(state.activeFence, claimInput)
    ) {
      throw new DistributedFenceError(
        "distributed fence claim is no longer the current workspace generation/holder",
        "fence_stale",
      );
    }
  }

  async renew(
    claimInput: DistributedFenceClaimV1,
    assignmentInput: DistributedWriterCandidateAssignmentV1,
    ttlMsInput: number,
  ): Promise<DistributedFenceClaimV1> {
    const duration = ttl(ttlMsInput);
    assertDistributedFenceClaim(claimInput);
    const assignment = structuredClone(assignmentInput);
    const claim = structuredClone(claimInput);

    for (let attempt = 0; attempt < this.maxCasAttempts(); attempt += 1) {
      const now = this.now();
      await this.validateCurrent(claim, assignment, now);
      const state = await this.readState(claim.workspaceId);
      if (!state?.activeFence || !sameClaim(state.activeFence, claim)) {
        throw new DistributedFenceError("distributed fence claim changed before renewal", "fence_stale");
      }
      const expiresAtMs = Math.min(now.getTime() + duration, Date.parse(assignment.expiresAt));
      if (expiresAtMs <= now.getTime()) {
        throw new DistributedFenceError("writer candidate expires before fence renewal", "candidate_not_current");
      }
      const renewed: DistributedFenceClaimV1 = {
        ...claim,
        issuedAt: now.toISOString(),
        expiresAt: new Date(expiresAtMs).toISOString(),
      };
      assertDistributedFenceClaim(renewed);
      const next = baseState(
        claim.workspaceId,
        state.revision + 1,
        state.generation,
        renewed,
      );
      if (!await this.cas(claim.workspaceId, state.revision, next)) continue;
      try {
        await this.requireCandidate(assignment, this.now());
        await this.validateCurrent(renewed, assignment);
      } catch (error) {
        try { await this.revoke(renewed); } catch { /* preserve original failure */ }
        throw error;
      }
      return structuredClone(renewed);
    }
    throw new DistributedFenceError(
      "distributed fence renewal contention exceeded its bounded retry limit",
      "contention_exhausted",
    );
  }

  async revoke(claimInput: DistributedFenceClaimV1): Promise<void> {
    assertDistributedFenceClaim(claimInput);
    const claim = structuredClone(claimInput);
    for (let attempt = 0; attempt < this.maxCasAttempts(); attempt += 1) {
      const state = await this.readState(claim.workspaceId);
      if (
        !state
        || state.generation !== claim.generation
        || !state.activeFence
        || !sameClaim(state.activeFence, claim)
      ) {
        throw new DistributedFenceError(
          "only the exact current distributed fence may be revoked",
          "fence_stale",
        );
      }
      const next = baseState(
        claim.workspaceId,
        state.revision + 1,
        state.generation,
      );
      if (await this.cas(claim.workspaceId, state.revision, next)) return;
    }
    throw new DistributedFenceError(
      "distributed fence revocation contention exceeded its bounded retry limit",
      "contention_exhausted",
    );
  }
}
