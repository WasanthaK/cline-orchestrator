import crypto from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MachineOrchestratorService, PublicTaskView } from "./machine-orchestrator.js";
import type { SafetyPreview, SafetyPreviewRequest } from "./safety-plan.js";
import { RemoteRegistrationStore } from "./remote-registration-store.js";
import { RemoteSessionGateway } from "./remote-session-gateway.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_PROPOSALS = 256;
const MAX_GOAL_CHARS = 20_000;
const MAX_SCOPE_ITEMS = 100;
const MAX_PENDING_LOCAL_CONFIRMATIONS = 64;
const MAX_START_PERMITS = 64;
const LOCAL_CONFIRMATION_TTL_MS = 60_000;

export type RemoteTaskStartProposalStatus =
  | "pending"
  | "previewed"
  | "approved"
  | "rejected"
  | "started"
  | "start_failed";

export interface RemoteTaskStartProposalV1 {
  schemaVersion: 1;
  proposalId: string;
  registrationId: string;
  sessionId: string;
  remotePrincipalId: string;
  registrationRevision: number;
  requestId: string;
  workspaceId: string;
  goalDigest: string;
  goalChars: number;
  requestedScopeDigest: string;
  requestedScopeCount: number;
  revision: number;
  status: RemoteTaskStartProposalStatus;
  createdAt: string;
  previewedAt?: string;
  previewDigest?: string;
  approvedAt?: string;
  rejectedAt?: string;
  startedAt?: string;
  startFailedAt?: string;
  startedTaskId?: string;
}

interface RemoteTaskStartSnapshotV1 {
  schemaVersion: 1;
  proposals: RemoteTaskStartProposalV1[];
}

interface PendingLocalConfirmation {
  proposalId: string;
  proposalRevision: number;
  registrationId: string;
  registrationRevision: number;
  sessionId: string;
  previewDigest: string;
  planToken: string;
  planExpiresAtMs: number;
  confirmationExpiresAtMs: number;
}

interface PendingStartPermit {
  proposalId: string;
  proposalRevision: number;
  registrationId: string;
  registrationRevision: number;
  sessionId: string;
  remotePrincipalId: string;
  planToken: string;
  expiresAtMs: number;
}

export interface RemoteTaskStartLocalPreviewV1 {
  schemaVersion: 1;
  proposal: RemoteTaskStartProposalV1;
  safetyPreview: Omit<SafetyPreview, "planToken">;
  confirmationText: string;
  confirmationToken: string;
  expiresAt: string;
}

export interface RemoteTaskStartLocalApprovalV1 {
  schemaVersion: 1;
  proposal: RemoteTaskStartProposalV1;
  startPermit: string;
  expiresAt: string;
}

export interface RemoteTaskStartExecutionV1 {
  schemaVersion: 1;
  proposal: RemoteTaskStartProposalV1;
  task: Pick<PublicTaskView, "taskId" | "workspaceId" | "projectId" | "status" | "createdAt" | "updatedAt">;
}

export interface RemoteTaskStartBridgeOptions {
  now?: () => Date;
  idFactory?: () => string;
  confirmationFactory?: () => string;
  permitFactory?: () => string;
}

export class RemoteTaskStartBridgeError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "proposal_invalid"
      | "proposal_not_found"
      | "proposal_conflict"
      | "proposal_stale"
      | "proposal_material_unavailable"
      | "confirmation_invalid"
      | "confirmation_expired"
      | "permit_invalid"
      | "permit_expired"
      | "capacity_exceeded"
      | "store_corrupt",
  ) {
    super(message);
    this.name = "RemoteTaskStartBridgeError";
  }
}

function requireUuid(value: string, field: string): string {
  if (!UUID.test(value)) throw new RemoteTaskStartBridgeError(`${field} must be an opaque UUID`, "proposal_invalid");
  return value;
}

function normalizeRequest(request: SafetyPreviewRequest): SafetyPreviewRequest {
  const goal = request.goal.trim();
  if (!goal || goal.includes("\0") || goal.length > MAX_GOAL_CHARS) {
    throw new RemoteTaskStartBridgeError("task goal is empty or invalid", "proposal_invalid");
  }
  const scope = request.requestedScope ?? [];
  if (scope.length > MAX_SCOPE_ITEMS) throw new RemoteTaskStartBridgeError("requested scope is too large", "proposal_invalid");
  const requestedScope = scope.map((value) => {
    if (typeof value !== "string" || !value.trim() || value.includes("\0")) {
      throw new RemoteTaskStartBridgeError("requested scope contains invalid item", "proposal_invalid");
    }
    return value.trim();
  });
  return {
    workspaceId: requireUuid(request.workspaceId, "workspaceId"),
    goal,
    requestedScope,
  };
}

function digest(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function requestEvidence(request: SafetyPreviewRequest) {
  const normalized = normalizeRequest(request);
  return {
    normalized,
    goalDigest: digest(normalized.goal),
    goalChars: normalized.goal.length,
    requestedScopeDigest: digest(normalized.requestedScope ?? []),
    requestedScopeCount: normalized.requestedScope?.length ?? 0,
  };
}

function previewEvidence(preview: Omit<SafetyPreview, "planToken">): string {
  return digest({
    workspaceId: preview.workspaceId,
    projectId: preview.projectId,
    workspaceRevision: preview.workspaceRevision,
    goal: preview.goal,
    branch: preview.branch,
    head: preview.head,
    dirty: preview.dirty,
    dirtyFingerprint: preview.dirtyFingerprint,
    requestedScope: preview.requestedScope,
    allowedPathPatterns: preview.allowedPathPatterns,
    protectedPathPatterns: preview.protectedPathPatterns,
    validationCommands: preview.validationCommands,
    policyVersion: preview.policyVersion,
    workerProfileId: preview.workerProfileId,
    expiresAt: preview.expiresAt,
  });
}

function publicPreview(preview: SafetyPreview): Omit<SafetyPreview, "planToken"> {
  const { planToken: _planToken, ...sanitized } = preview;
  return structuredClone(sanitized);
}

function validateProposal(value: RemoteTaskStartProposalV1): RemoteTaskStartProposalV1 {
  if (value.schemaVersion !== 1) throw new RemoteTaskStartBridgeError("unsupported task-start proposal schema", "store_corrupt");
  requireUuid(value.proposalId, "proposalId");
  requireUuid(value.registrationId, "registrationId");
  requireUuid(value.sessionId, "sessionId");
  requireUuid(value.remotePrincipalId, "remotePrincipalId");
  requireUuid(value.requestId, "requestId");
  requireUuid(value.workspaceId, "workspaceId");
  if (!Number.isSafeInteger(value.registrationRevision) || value.registrationRevision < 1
    || !Number.isSafeInteger(value.revision) || value.revision < 1
    || !Number.isSafeInteger(value.goalChars) || value.goalChars < 1 || value.goalChars > MAX_GOAL_CHARS
    || !Number.isSafeInteger(value.requestedScopeCount) || value.requestedScopeCount < 0 || value.requestedScopeCount > MAX_SCOPE_ITEMS) {
    throw new RemoteTaskStartBridgeError("task-start proposal numeric fields are invalid", "store_corrupt");
  }
  if (!/^[a-f0-9]{64}$/.test(value.goalDigest)
    || !/^[a-f0-9]{64}$/.test(value.requestedScopeDigest)
    || (value.previewDigest !== undefined && !/^[a-f0-9]{64}$/.test(value.previewDigest))) {
    throw new RemoteTaskStartBridgeError("task-start proposal digest is invalid", "store_corrupt");
  }
  const statuses: RemoteTaskStartProposalStatus[] = ["pending", "previewed", "approved", "rejected", "started", "start_failed"];
  if (!statuses.includes(value.status) || !Number.isFinite(Date.parse(value.createdAt))) {
    throw new RemoteTaskStartBridgeError("task-start proposal state is invalid", "store_corrupt");
  }
  if (value.startedTaskId) requireUuid(value.startedTaskId, "startedTaskId");
  return structuredClone(value);
}

export class RemoteTaskStartProposalStore {
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly rootDir: string,
    private readonly options: Pick<RemoteTaskStartBridgeOptions, "now" | "idFactory"> = {},
  ) {}

  private dir(): string { return path.join(this.rootDir, "remote-control"); }
  private file(): string { return path.join(this.dir(), "task-start-proposals.json"); }
  private tempFile(): string { return path.join(this.dir(), `.task-start-${process.pid}-${crypto.randomUUID()}.tmp`); }

  private nowIso(): string {
    const now = (this.options.now ?? (() => new Date()))();
    if (!Number.isFinite(now.getTime())) throw new RemoteTaskStartBridgeError("task-start clock is invalid", "proposal_invalid");
    return now.toISOString();
  }

  private async readSnapshot(): Promise<RemoteTaskStartSnapshotV1> {
    try {
      const parsed = JSON.parse(await readFile(this.file(), "utf8")) as RemoteTaskStartSnapshotV1;
      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.proposals) || parsed.proposals.length > MAX_PROPOSALS) {
        throw new RemoteTaskStartBridgeError("task-start proposal store schema is invalid", "store_corrupt");
      }
      const ids = new Set<string>();
      const proposals = parsed.proposals.map((raw) => {
        const proposal = validateProposal(raw);
        if (ids.has(proposal.proposalId)) throw new RemoteTaskStartBridgeError("duplicate task-start proposal id", "store_corrupt");
        ids.add(proposal.proposalId);
        return proposal;
      });
      return { schemaVersion: 1, proposals };
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return { schemaVersion: 1, proposals: [] };
      if (error instanceof RemoteTaskStartBridgeError) throw error;
      throw new RemoteTaskStartBridgeError("task-start proposal store is corrupt", "store_corrupt");
    }
  }

  private async writeSnapshot(snapshot: RemoteTaskStartSnapshotV1): Promise<void> {
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

  async create(input: Omit<RemoteTaskStartProposalV1, "schemaVersion" | "proposalId" | "revision" | "status" | "createdAt">): Promise<RemoteTaskStartProposalV1> {
    return await this.serialize(async () => {
      const snapshot = await this.readSnapshot();
      if (snapshot.proposals.length >= MAX_PROPOSALS) throw new RemoteTaskStartBridgeError("task-start proposal capacity exceeded", "capacity_exceeded");
      const proposal = validateProposal({
        schemaVersion: 1,
        proposalId: requireUuid((this.options.idFactory ?? (() => crypto.randomUUID()))(), "proposalId"),
        ...input,
        revision: 1,
        status: "pending",
        createdAt: this.nowIso(),
      });
      if (snapshot.proposals.some((item) => item.proposalId === proposal.proposalId)) {
        throw new RemoteTaskStartBridgeError("task-start proposal id already exists", "proposal_conflict");
      }
      snapshot.proposals.push(proposal);
      await this.writeSnapshot(snapshot);
      return structuredClone(proposal);
    });
  }

  async get(proposalId: string): Promise<RemoteTaskStartProposalV1> {
    proposalId = requireUuid(proposalId, "proposalId");
    const proposal = (await this.readSnapshot()).proposals.find((item) => item.proposalId === proposalId);
    if (!proposal) throw new RemoteTaskStartBridgeError("task-start proposal was not found", "proposal_not_found");
    return structuredClone(proposal);
  }

  async transition(
    proposalId: string,
    expectedRevision: number,
    expectedStatus: RemoteTaskStartProposalStatus,
    patch: Partial<Pick<RemoteTaskStartProposalV1,
      "status" | "previewedAt" | "previewDigest" | "approvedAt" | "rejectedAt" | "startedAt" | "startFailedAt" | "startedTaskId">>,
  ): Promise<RemoteTaskStartProposalV1> {
    proposalId = requireUuid(proposalId, "proposalId");
    return await this.serialize(async () => {
      const snapshot = await this.readSnapshot();
      const index = snapshot.proposals.findIndex((item) => item.proposalId === proposalId);
      if (index < 0) throw new RemoteTaskStartBridgeError("task-start proposal was not found", "proposal_not_found");
      const current = snapshot.proposals[index]!;
      if (current.revision !== expectedRevision || current.status !== expectedStatus) {
        throw new RemoteTaskStartBridgeError("task-start proposal changed", "proposal_conflict");
      }
      const next = validateProposal({ ...current, ...patch, revision: current.revision + 1 });
      snapshot.proposals[index] = next;
      await this.writeSnapshot(snapshot);
      return structuredClone(next);
    });
  }
}

type TaskStartService = Pick<MachineOrchestratorService, "previewTask" | "startTask">;

/**
 * Separates remote intent from local Safety Preview approval for brand-new write
 * tasks. Remote bearer auth may only create an exact proposal. A local operator
 * must inspect the trusted Safety Preview and explicitly confirm it before a
 * short-lived one-shot start permit exists. Plan tokens, goals and requested
 * scope stay process-local and are never persisted in the proposal store.
 */
export class RemoteTaskStartApprovalBridge {
  private readonly material = new Map<string, SafetyPreviewRequest>();
  private readonly confirmations = new Map<string, PendingLocalConfirmation>();
  private readonly permits = new Map<string, PendingStartPermit>();
  readonly proposals: RemoteTaskStartProposalStore;

  constructor(
    private readonly sessions: RemoteSessionGateway,
    private readonly registrations: RemoteRegistrationStore,
    private readonly service: TaskStartService,
    rootDir: string,
    private readonly options: RemoteTaskStartBridgeOptions = {},
  ) {
    this.proposals = new RemoteTaskStartProposalStore(rootDir, options);
  }

  private now(): Date {
    const now = (this.options.now ?? (() => new Date()))();
    if (!Number.isFinite(now.getTime())) throw new RemoteTaskStartBridgeError("task-start clock is invalid", "proposal_invalid");
    return now;
  }

  private prune(nowMs: number): void {
    for (const [token, pending] of this.confirmations) if (pending.confirmationExpiresAtMs <= nowMs) this.confirmations.delete(token);
    for (const [token, permit] of this.permits) if (permit.expiresAtMs <= nowMs) this.permits.delete(token);
  }

  async propose(input: {
    bearerToken: string;
    requestId: string;
    request: SafetyPreviewRequest;
  }): Promise<RemoteTaskStartProposalV1> {
    const authorized = await this.sessions.authorize(input.bearerToken, input.requestId, {
      kind: "control",
      capability: "propose_new_task",
    });
    const evidence = requestEvidence(input.request);
    const proposal = await this.proposals.create({
      registrationId: authorized.registrationId,
      sessionId: authorized.sessionId,
      remotePrincipalId: authorized.remotePrincipalId,
      registrationRevision: authorized.registrationRevision,
      requestId: authorized.requestId,
      workspaceId: evidence.normalized.workspaceId,
      goalDigest: evidence.goalDigest,
      goalChars: evidence.goalChars,
      requestedScopeDigest: evidence.requestedScopeDigest,
      requestedScopeCount: evidence.requestedScopeCount,
    });
    this.material.set(proposal.proposalId, structuredClone(evidence.normalized));
    return proposal;
  }

  async rejectLocally(proposalId: string, expectedRevision: number): Promise<RemoteTaskStartProposalV1> {
    this.material.delete(proposalId);
    return await this.proposals.transition(proposalId, expectedRevision, "pending", {
      status: "rejected",
      rejectedAt: this.now().toISOString(),
    });
  }

  async previewLocalApproval(proposalId: string, expectedRevision: number): Promise<RemoteTaskStartLocalPreviewV1> {
    const proposal = await this.proposals.get(proposalId);
    if (proposal.revision !== expectedRevision || proposal.status !== "pending") {
      throw new RemoteTaskStartBridgeError("task-start proposal changed before Safety Preview", "proposal_conflict");
    }
    const registration = await this.registrations.getRegistration(proposal.registrationId);
    if (registration.revokedAt
      || registration.revision !== proposal.registrationRevision
      || !(registration.allowedControlCapabilities ?? []).includes("propose_new_task")) {
      throw new RemoteTaskStartBridgeError("registration changed after task-start proposal", "proposal_stale");
    }
    const material = this.material.get(proposalId);
    if (!material) throw new RemoteTaskStartBridgeError("task-start proposal material is unavailable; submit again", "proposal_material_unavailable");
    const evidence = requestEvidence(material);
    if (evidence.goalDigest !== proposal.goalDigest || evidence.requestedScopeDigest !== proposal.requestedScopeDigest) {
      throw new RemoteTaskStartBridgeError("task-start proposal material changed", "proposal_stale");
    }

    const preview = await this.service.previewTask(structuredClone(material));
    const sanitized = publicPreview(preview);
    const previewDigest = previewEvidence(sanitized);
    const now = this.now();
    this.prune(now.getTime());
    if (this.confirmations.size >= MAX_PENDING_LOCAL_CONFIRMATIONS) {
      throw new RemoteTaskStartBridgeError("too many pending local task-start confirmations", "capacity_exceeded");
    }
    const confirmationToken = (this.options.confirmationFactory ?? (() => `rtc_${crypto.randomBytes(32).toString("base64url")}`))();
    if (typeof confirmationToken !== "string" || confirmationToken.length < 32 || confirmationToken.includes("\0")) {
      throw new RemoteTaskStartBridgeError("local confirmation token is invalid", "confirmation_invalid");
    }
    const confirmationExpiresAtMs = Math.min(Date.parse(preview.expiresAt), now.getTime() + LOCAL_CONFIRMATION_TTL_MS);
    if (!Number.isFinite(confirmationExpiresAtMs) || confirmationExpiresAtMs <= now.getTime()) {
      throw new RemoteTaskStartBridgeError("Safety Preview already expired", "proposal_stale");
    }
    const previewed = await this.proposals.transition(proposalId, expectedRevision, "pending", {
      status: "previewed",
      previewedAt: now.toISOString(),
      previewDigest,
    });
    this.confirmations.set(confirmationToken, {
      proposalId,
      proposalRevision: previewed.revision,
      registrationId: previewed.registrationId,
      registrationRevision: previewed.registrationRevision,
      sessionId: previewed.sessionId,
      previewDigest,
      planToken: preview.planToken,
      planExpiresAtMs: Date.parse(preview.expiresAt),
      confirmationExpiresAtMs,
    });
    return {
      schemaVersion: 1,
      proposal: previewed,
      safetyPreview: sanitized,
      confirmationText: "Approve this exact Safety Preview to create a one-shot permit for starting the new task",
      confirmationToken,
      expiresAt: new Date(confirmationExpiresAtMs).toISOString(),
    };
  }

  async confirmLocalApproval(input: {
    proposalId: string;
    confirmationToken: string;
    confirmed: true;
  }): Promise<RemoteTaskStartLocalApprovalV1> {
    if (input.confirmed !== true) throw new RemoteTaskStartBridgeError("explicit local confirmation is required", "confirmation_invalid");
    const pending = this.confirmations.get(input.confirmationToken);
    if (!pending || pending.proposalId !== input.proposalId) {
      throw new RemoteTaskStartBridgeError("local confirmation is invalid or already used", "confirmation_invalid");
    }
    this.confirmations.delete(input.confirmationToken);
    const now = this.now();
    if (now.getTime() >= pending.confirmationExpiresAtMs || now.getTime() >= pending.planExpiresAtMs) {
      throw new RemoteTaskStartBridgeError("local task-start confirmation expired", "confirmation_expired");
    }
    const proposal = await this.proposals.get(pending.proposalId);
    if (proposal.status !== "previewed" || proposal.revision !== pending.proposalRevision || proposal.previewDigest !== pending.previewDigest) {
      throw new RemoteTaskStartBridgeError("task-start proposal changed after Safety Preview", "proposal_stale");
    }
    const registration = await this.registrations.getRegistration(proposal.registrationId);
    if (registration.revokedAt
      || registration.revision !== proposal.registrationRevision
      || !(registration.allowedControlCapabilities ?? []).includes("propose_new_task")) {
      throw new RemoteTaskStartBridgeError("registration changed after Safety Preview", "proposal_stale");
    }
    this.prune(now.getTime());
    if (this.permits.size >= MAX_START_PERMITS) throw new RemoteTaskStartBridgeError("task-start permit capacity exceeded", "capacity_exceeded");
    const startPermit = (this.options.permitFactory ?? (() => `rtp_${crypto.randomBytes(32).toString("base64url")}`))();
    if (typeof startPermit !== "string" || startPermit.length < 32 || startPermit.includes("\0")) {
      throw new RemoteTaskStartBridgeError("task-start permit is invalid", "permit_invalid");
    }
    const approved = await this.proposals.transition(proposal.proposalId, proposal.revision, "previewed", {
      status: "approved",
      approvedAt: now.toISOString(),
    });
    this.permits.set(startPermit, {
      proposalId: approved.proposalId,
      proposalRevision: approved.revision,
      registrationId: approved.registrationId,
      registrationRevision: approved.registrationRevision,
      sessionId: approved.sessionId,
      remotePrincipalId: approved.remotePrincipalId,
      planToken: pending.planToken,
      expiresAtMs: pending.planExpiresAtMs,
    });
    return { schemaVersion: 1, proposal: approved, startPermit, expiresAt: new Date(pending.planExpiresAtMs).toISOString() };
  }

  async executeApproved(input: {
    bearerToken: string;
    requestId: string;
    proposalId: string;
    startPermit: string;
  }): Promise<RemoteTaskStartExecutionV1> {
    const proposal = await this.proposals.get(input.proposalId);
    const authorized = await this.sessions.authorize(input.bearerToken, input.requestId, {
      kind: "control",
      capability: "propose_new_task",
    });
    const permit = this.permits.get(input.startPermit);
    if (!permit || permit.proposalId !== proposal.proposalId || permit.proposalRevision !== proposal.revision) {
      throw new RemoteTaskStartBridgeError("task-start permit is invalid or already used", "permit_invalid");
    }
    this.permits.delete(input.startPermit);
    const failClosed = async (code: RemoteTaskStartBridgeError["code"], message: string): Promise<never> => {
      try {
        await this.proposals.transition(proposal.proposalId, proposal.revision, "approved", {
          status: "start_failed",
          startFailedAt: this.now().toISOString(),
        });
      } finally {
        this.material.delete(proposal.proposalId);
      }
      throw new RemoteTaskStartBridgeError(message, code);
    };
    const now = this.now();
    if (now.getTime() >= permit.expiresAtMs) return await failClosed("permit_expired", "task-start permit expired");
    if (proposal.status !== "approved"
      || authorized.registrationId !== permit.registrationId
      || authorized.registrationRevision !== permit.registrationRevision
      || authorized.sessionId !== permit.sessionId
      || authorized.remotePrincipalId !== permit.remotePrincipalId) {
      return await failClosed("proposal_stale", "approved task-start proposal no longer matches the remote session");
    }

    try {
      const task = await this.service.startTask(permit.planToken);
      const started = await this.proposals.transition(proposal.proposalId, proposal.revision, "approved", {
        status: "started",
        startedAt: this.now().toISOString(),
        startedTaskId: task.taskId,
      });
      this.material.delete(proposal.proposalId);
      return {
        schemaVersion: 1,
        proposal: started,
        task: {
          taskId: task.taskId,
          workspaceId: task.workspaceId,
          projectId: task.projectId,
          status: task.status,
          createdAt: task.createdAt,
          updatedAt: task.updatedAt,
        },
      };
    } catch (error) {
      try {
        await this.proposals.transition(proposal.proposalId, proposal.revision, "approved", {
          status: "start_failed",
          startFailedAt: this.now().toISOString(),
        });
      } finally {
        this.material.delete(proposal.proposalId);
      }
      throw error;
    }
  }
}
