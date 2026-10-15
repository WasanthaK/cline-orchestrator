import { runRegistrationSetup, type RegistrationSetupReview } from "./registration-setup.js";
import path from "node:path";
import { WorkspaceRegistry } from "./workspace-registry.js";

export const NATIVE_WORKSPACE_SETUP_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  fixedUserRegistry: true as const,
  requiresCanonicalRootReview: true as const,
  requiresFullSafetyReview: true as const,
  requiresExplicitConfirmation: true as const,
  noBrowserRoute: true as const,
  runsValidationCommands: false as const,
  launchesTask: false as const,
  startsDaemon: false as const,
  grantsAuthority: false as const,
});

export class NativeWorkspaceSetupError extends Error {
  constructor(public readonly code: "input_invalid" | "registration_failed") {
    super(code === "input_invalid" ? "Workspace and Safety inputs are invalid"
      : "Workspace registration could not be verified; inspect the current registry before retrying");
    this.name = "NativeWorkspaceSetupError";
  }
}

interface NativeSafetyFields {
  policyVersion: string;
  workerProfileId: string;
  maxChangedFiles: number;
  allowedPathPatterns: string[];
  protectedPathPatterns: string[];
  validationCommands: string[];
}

export interface NativeWorkspaceInput {
  projectId: string;
  displayName: string;
  root: string;
  safetyProfile: NativeSafetyFields;
}

export interface NativeWorkspaceReviewV1 {
  schemaVersion: 1;
  kind: "workspace-review";
  action: "register_workspace";
  destination: "local_user_workspace_registry";
  registration: NativeWorkspaceInput;
  canonicalRoot: string;
  expiresAt: string;
  requiresExactReply: "REGISTER WORKSPACE";
  grantsAuthority: false;
}

export interface NativeWorkspaceResultV1 {
  schemaVersion: 1;
  kind: "workspace-result";
  outcome: "registered" | "cancelled";
  workspaceId?: string;
  projectId?: string;
  grantsAuthority: false;
}

const safeLabel = /^[A-Za-z0-9][A-Za-z0-9 ._'()&+\-]{0,119}$/;
const safeId = /^[a-zA-Z0-9._:\-]{1,160}$/;
function validLines(lines: unknown): lines is string[] {
  return Array.isArray(lines) && lines.length > 0 && lines.length <= 16
    && lines.every(value => typeof value === "string"
      && value.length > 0 && value.length <= 280
      && !/[\x00-\x1f\x7f]/.test(value)
      && value.trim().length > 0);
}

function checkInput(value: unknown): asserts value is NativeWorkspaceInput {
  const fail = (): never => { throw new NativeWorkspaceSetupError("input_invalid"); };
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  const obj = value as Record<string, unknown>;
  if (Object.keys(obj).some(k => !["projectId", "displayName", "root", "safetyProfile"].includes(k))
    || typeof obj.projectId !== "string" || !/^[0-9a-fA-F-]{36}$/.test(obj.projectId)
    || typeof obj.displayName !== "string" || !safeLabel.test(obj.displayName)
    || typeof obj.root !== "string" || obj.root.length < 4 || obj.root.length > 1024
    || !path.isAbsolute(obj.root)
    || path.parse(obj.root).root === path.resolve(obj.root)
    || (process.platform === "win32" && !/^[A-Za-z]:[\\/]/.test(obj.root))
    || /[\x00-\x1f\x7f]/.test(obj.root)) fail();
  const safety = obj.safetyProfile;
  if (!safety || typeof safety !== "object" || Array.isArray(safety)) fail();
  const profile = safety as Record<string, unknown>;
  if (Object.keys(profile).some(k => !["policyVersion", "workerProfileId", "maxChangedFiles",
    "allowedPathPatterns", "protectedPathPatterns", "validationCommands"].includes(k))
    || typeof profile.policyVersion !== "string" || !safeId.test(profile.policyVersion)
    || typeof profile.workerProfileId !== "string" || !safeId.test(profile.workerProfileId)
    || !Number.isInteger(profile.maxChangedFiles)
    || (profile.maxChangedFiles as number) < 0
    || (profile.maxChangedFiles as number) > 100
    || !validLines(profile.allowedPathPatterns)
    || !validLines(profile.protectedPathPatterns)
    || !validLines(profile.validationCommands)
    || profile.allowedPathPatterns.some((p: string) => p.trim() === "**")) fail();
}

/** Observation-only project list: the same default registry as registration. */
export async function listNativeProjects(registry = new WorkspaceRegistry()) {
  try {
    const projects = await registry.listProjects();
    return Object.freeze({
      schemaVersion: 1,
      kind: "local-projects",
      projects: projects.filter(p => safeLabel.test(p.displayName)).slice(0, 100)
        .map(p => ({ projectId: p.projectId, displayName: p.displayName })),
      grantsAuthority: false,
    });
  } catch {
    throw new NativeWorkspaceSetupError("registration_failed");
  }
}

export async function registerNativeWorkspace(
  input: unknown,
  confirm: (review: NativeWorkspaceReviewV1) => Promise<boolean>,
  registry = new WorkspaceRegistry(),
): Promise<NativeWorkspaceResultV1> {
  checkInput(input);
  if (typeof confirm !== "function") throw new NativeWorkspaceSetupError("input_invalid");
  const selected = structuredClone(input);
  try {
    const result = await runRegistrationSetup("register_workspace", selected,
      async (review: RegistrationSetupReview) => {
        if (!review.canonicalRoot) throw new NativeWorkspaceSetupError("registration_failed");
        return confirm(Object.freeze({
          schemaVersion: 1, kind: "workspace-review",
          action: "register_workspace",
          destination: "local_user_workspace_registry",
          registration: structuredClone(review.registration) as unknown as NativeWorkspaceInput,
          canonicalRoot: review.canonicalRoot,
          expiresAt: review.expiresAt,
          requiresExactReply: "REGISTER WORKSPACE",
          grantsAuthority: false,
        }));
      }, registry);
    return Object.freeze({
      schemaVersion: 1, kind: "workspace-result",
      outcome: result.registered ? "registered" : "cancelled",
      ...(result.registered && result.workspaceId ? { workspaceId: result.workspaceId } : {}),
      ...(result.registered && result.projectId ? { projectId: result.projectId } : {}),
      grantsAuthority: false,
    });
  } catch {
    throw new NativeWorkspaceSetupError("registration_failed");
  }
}
