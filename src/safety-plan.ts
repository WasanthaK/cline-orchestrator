import crypto from "node:crypto";
import { checkpointLimitsFromEnvironment } from "./checkpoint-config.js";
import { captureWorkspaceFingerprint } from "./git-checkpoint.js";
import { captureGitSnapshot } from "./git-state.js";
import type { OrchestratorTask, WorkspaceFingerprint } from "./types.js";
import { WorkspaceRegistry } from "./workspace-registry.js";
import type { RegisteredWorkspace } from "./workspace-registry.js";

export interface SafetyPreviewRequest {
  workspaceId: string;
  goal: string;
  requestedScope?: string[];
}

export interface SafetyPlan {
  planId: string;
  tokenHash: string;
  workspaceId: string;
  workspaceRevision: number;
  projectId: string;
  goal: string;
  gitBranch?: string;
  gitHead?: string;
  dirtyFingerprint: string;
  policyVersion: string;
  allowedPathPatterns: string[];
  protectedPathPatterns: string[];
  validationCommands: string[];
  workerProfileId: string;
  safetyProfileId: string;
  safetyProfileRevision: number;
  maxChangedFiles: number;
  createdAt: string;
  expiresAt: string;
  consumedAt?: string;
}

export interface SafetyPreview {
  workspaceId: string;
  projectId: string;
  workspaceDisplayName: string;
  workspaceRevision: number;
  goal: string;
  branch?: string;
  head?: string;
  dirty: boolean;
  dirtyFingerprint: string;
  requestedScope: string[];
  allowedPathPatterns: string[];
  protectedPathPatterns: string[];
  validationCommands: string[];
  policyVersion: string;
  workerProfileId: string;
  planToken: string;
  expiresAt: string;
}

export interface DurableSafetyBinding {
  projectId: string;
  workspaceId: string;
  workspaceRegistryRevision: number;
  safetyPlanId: string;
  policyVersion: string;
  safetyProfileId: string;
  safetyProfileRevision: number;
  allowedPathPatterns: string[];
  protectedPathPatterns: string[];
  workerProfileId: string;
}

export class SafetyPlanError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "plan_invalid"
      | "plan_expired"
      | "plan_replayed"
      | "plan_stale"
      | "scope_invalid",
  ) {
    super(message);
    this.name = "SafetyPlanError";
  }
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

function clonePlan(plan: SafetyPlan): SafetyPlan {
  return {
    ...plan,
    allowedPathPatterns: [...plan.allowedPathPatterns],
    protectedPathPatterns: [...plan.protectedPathPatterns],
    validationCommands: [...plan.validationCommands],
  };
}

function normalizeScope(items: string[] | undefined): string[] {
  if (!items) return [];
  if (items.length > 100) throw new SafetyPlanError("requestedScope supports at most 100 items", "scope_invalid");
  const normalized = items.map((item, index) => {
    if (typeof item !== "string" || !item.trim()) {
      throw new SafetyPlanError(`requestedScope[${index}] must be a non-empty string`, "scope_invalid");
    }
    const value = item.trim().replace(/\\/g, "/");
    if (value.startsWith("/") || /^[A-Za-z]:\//.test(value) || value.split("/").includes("..")) {
      throw new SafetyPlanError(`requestedScope[${index}] must be workspace-relative`, "scope_invalid");
    }
    return value;
  });
  return [...new Set(normalized)];
}

function scopeAllowed(requested: string, allowed: string[]): boolean {
  if (allowed.length === 0) return false;
  const prefix = requested.replace(/\*.*$/, "").replace(/\/$/, "");
  return allowed.some((pattern) => {
    const allowedPrefix = pattern.replace(/\\/g, "/").replace(/\*.*$/, "").replace(/\/$/, "");
    return requested === pattern || requested.startsWith(`${allowedPrefix}/`) || prefix.startsWith(`${allowedPrefix}/`) || prefix === allowedPrefix;
  });
}

function validateRequestedScope(requestedScope: string[], workspace: RegisteredWorkspace): void {
  for (const requested of requestedScope) {
    if (!scopeAllowed(requested, workspace.safetyProfile.allowedPathPatterns)) {
      throw new SafetyPlanError(`Requested scope is outside the registered safety profile: ${requested}`, "scope_invalid");
    }
  }
}

function stableFingerprint(fingerprint: WorkspaceFingerprint): string {
  if (!fingerprint.available || !fingerprint.digest) {
    throw new SafetyPlanError(
      `Workspace fingerprint unavailable: ${fingerprint.error ?? "unknown error"}`,
      "plan_invalid",
    );
  }
  return fingerprint.digest;
}

function sameString(left: string | undefined, right: string | undefined): boolean {
  return (left ?? "") === (right ?? "");
}

export class SafetyPlanStore {
  private readonly plans = new Map<string, SafetyPlan>();

  create(plan: Omit<SafetyPlan, "tokenHash">): { plan: SafetyPlan; token: string } {
    const token = crypto.randomBytes(32).toString("base64url");
    const stored: SafetyPlan = { ...plan, tokenHash: hashToken(token) };
    this.plans.set(stored.tokenHash, clonePlan(stored));
    return { plan: clonePlan(stored), token };
  }

  getByToken(token: string): SafetyPlan {
    const plan = this.plans.get(hashToken(token));
    if (!plan) throw new SafetyPlanError("Safety plan token is invalid", "plan_invalid");
    return clonePlan(plan);
  }

  consume(token: string, consumedAt: string): SafetyPlan {
    const hash = hashToken(token);
    const plan = this.plans.get(hash);
    if (!plan) throw new SafetyPlanError("Safety plan token is invalid", "plan_invalid");
    if (plan.consumedAt) throw new SafetyPlanError("Safety plan token has already been consumed", "plan_replayed");
    if (Date.parse(plan.expiresAt) <= Date.parse(consumedAt)) {
      throw new SafetyPlanError("Safety plan token has expired", "plan_expired");
    }
    const consumed = { ...plan, consumedAt };
    this.plans.set(hash, clonePlan(consumed));
    return clonePlan(consumed);
  }
}

export interface SafetyPlanServiceOptions {
  ttlMs?: number;
  now?: () => Date;
}

export class SafetyPlanService {
  private readonly ttlMs: number;
  private readonly now: () => Date;

  constructor(
    private readonly registry: WorkspaceRegistry,
    private readonly store = new SafetyPlanStore(),
    options: SafetyPlanServiceOptions = {},
  ) {
    this.ttlMs = options.ttlMs ?? 15 * 60 * 1000;
    this.now = options.now ?? (() => new Date());
    if (!Number.isFinite(this.ttlMs) || this.ttlMs <= 0) {
      throw new SafetyPlanError("Safety plan TTL must be positive", "plan_invalid");
    }
  }

  async preview(request: SafetyPreviewRequest): Promise<SafetyPreview> {
    const goal = request.goal.trim();
    if (!goal) throw new SafetyPlanError("Task goal must not be empty", "plan_invalid");
    const workspace = await this.registry.resolveVerifiedWorkspace(request.workspaceId);
    const requestedScope = normalizeScope(request.requestedScope);
    validateRequestedScope(requestedScope, workspace);

    const [snapshot, fingerprint] = await Promise.all([
      captureGitSnapshot(workspace.canonicalRoot),
      captureWorkspaceFingerprint(workspace.canonicalRoot, checkpointLimitsFromEnvironment()),
    ]);
    if (!snapshot.available) {
      throw new SafetyPlanError(`Git snapshot unavailable: ${snapshot.error ?? "unknown error"}`, "plan_invalid");
    }

    const createdAt = this.now();
    const expiresAt = new Date(createdAt.getTime() + this.ttlMs);
    const { token } = this.store.create({
      planId: crypto.randomUUID(),
      workspaceId: workspace.workspaceId,
      workspaceRevision: workspace.revision,
      projectId: workspace.projectId,
      goal,
      gitBranch: snapshot.branch,
      gitHead: snapshot.head,
      dirtyFingerprint: stableFingerprint(fingerprint),
      policyVersion: workspace.safetyProfile.policyVersion,
      allowedPathPatterns: requestedScope.length > 0 ? requestedScope : [...workspace.safetyProfile.allowedPathPatterns],
      protectedPathPatterns: [...workspace.safetyProfile.protectedPathPatterns],
      validationCommands: [...workspace.safetyProfile.validationCommands],
      workerProfileId: workspace.safetyProfile.workerProfileId,
      safetyProfileId: workspace.safetyProfile.profileId,
      safetyProfileRevision: workspace.safetyProfile.revision,
      maxChangedFiles: workspace.safetyProfile.maxChangedFiles,
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });

    return {
      workspaceId: workspace.workspaceId,
      projectId: workspace.projectId,
      workspaceDisplayName: workspace.displayName,
      workspaceRevision: workspace.revision,
      goal,
      branch: snapshot.branch,
      head: snapshot.head,
      dirty: snapshot.dirty ?? false,
      dirtyFingerprint: stableFingerprint(fingerprint),
      requestedScope,
      allowedPathPatterns: requestedScope.length > 0 ? requestedScope : [...workspace.safetyProfile.allowedPathPatterns],
      protectedPathPatterns: [...workspace.safetyProfile.protectedPathPatterns],
      validationCommands: [...workspace.safetyProfile.validationCommands],
      policyVersion: workspace.safetyProfile.policyVersion,
      workerProfileId: workspace.safetyProfile.workerProfileId,
      planToken: token,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async consumeForTask(planToken: string): Promise<{
    plan: SafetyPlan;
    workspace: RegisteredWorkspace;
    binding: DurableSafetyBinding;
  }> {
    const candidate = this.store.getByToken(planToken);
    const now = this.now();
    if (Date.parse(candidate.expiresAt) <= now.getTime()) {
      throw new SafetyPlanError("Safety plan token has expired", "plan_expired");
    }

    const workspace = await this.registry.resolveVerifiedWorkspace(candidate.workspaceId);
    if (workspace.revision !== candidate.workspaceRevision) {
      throw new SafetyPlanError("Workspace registry changed after Safety Preview", "plan_stale");
    }
    const profile = workspace.safetyProfile;
    if (
      profile.profileId !== candidate.safetyProfileId ||
      profile.revision !== candidate.safetyProfileRevision ||
      profile.policyVersion !== candidate.policyVersion ||
      profile.workerProfileId !== candidate.workerProfileId
    ) {
      throw new SafetyPlanError("Workspace safety policy changed after Safety Preview", "plan_stale");
    }

    const [snapshot, fingerprint] = await Promise.all([
      captureGitSnapshot(workspace.canonicalRoot),
      captureWorkspaceFingerprint(workspace.canonicalRoot, checkpointLimitsFromEnvironment()),
    ]);
    if (!snapshot.available) {
      throw new SafetyPlanError(`Git snapshot unavailable: ${snapshot.error ?? "unknown error"}`, "plan_stale");
    }
    if (!sameString(snapshot.branch, candidate.gitBranch) || !sameString(snapshot.head, candidate.gitHead)) {
      throw new SafetyPlanError("Git branch or HEAD changed after Safety Preview", "plan_stale");
    }
    if (stableFingerprint(fingerprint) !== candidate.dirtyFingerprint) {
      throw new SafetyPlanError("Workspace dirty state changed after Safety Preview", "plan_stale");
    }

    const consumed = this.store.consume(planToken, now.toISOString());
    return {
      plan: consumed,
      workspace,
      binding: {
        projectId: consumed.projectId,
        workspaceId: consumed.workspaceId,
        workspaceRegistryRevision: consumed.workspaceRevision,
        safetyPlanId: consumed.planId,
        policyVersion: consumed.policyVersion,
        safetyProfileId: consumed.safetyProfileId,
        safetyProfileRevision: consumed.safetyProfileRevision,
        allowedPathPatterns: [...consumed.allowedPathPatterns],
        protectedPathPatterns: [...consumed.protectedPathPatterns],
        workerProfileId: consumed.workerProfileId,
      },
    };
  }
}

export function bindTaskToSafetyPlan(
  task: OrchestratorTask,
  binding: DurableSafetyBinding,
): OrchestratorTask {
  return {
    ...task,
    projectId: binding.projectId,
    workspaceId: binding.workspaceId,
    workspaceRegistryRevision: binding.workspaceRegistryRevision,
    safetyPlanId: binding.safetyPlanId,
    safetyPolicyVersion: binding.policyVersion,
    safetyProfileId: binding.safetyProfileId,
    safetyProfileRevision: binding.safetyProfileRevision,
    approvedAllowedPathPatterns: [...binding.allowedPathPatterns],
    approvedProtectedPathPatterns: [...binding.protectedPathPatterns],
    workerProfileId: binding.workerProfileId,
  };
}
