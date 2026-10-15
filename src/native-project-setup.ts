import { runRegistrationSetup, type RegistrationSetupReview } from "./registration-setup.js";
import { WorkspaceRegistry } from "./workspace-registry.js";

/**
 * M19C2B1: trusted native first-run project creation. No browser route, no
 * selected registry path, no model invocation and no task permissions.
 */
export const NATIVE_PROJECT_SETUP_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  action: "register_project" as const,
  requiresExplicitReview: true as const,
  oneTimeConfirmation: true as const,
  fixedUserRegistry: true as const,
  hasBrowserRoute: false as const,
  launchesTask: false as const,
  startsDaemon: false as const,
  grantsAuthority: false as const,
});

export class NativeProjectSetupError extends Error {
  constructor(public readonly code: "input_invalid" | "registration_failed") {
    super(code === "input_invalid"
      ? "Project name is invalid"
      : "Project registration could not be verified; inspect current registry before retrying");
    this.name = "NativeProjectSetupError";
  }
}

export interface NativeProjectReviewV1 {
  schemaVersion: 1;
  kind: "project-review";
  action: "register_project";
  destination: "local_user_workspace_registry";
  projectName: string;
  expiresAt: string;
  confirmationText: string;
  requiresExactReply: "REGISTER PROJECT";
  grantsAuthority: false;
}

export interface NativeProjectResultV1 {
  schemaVersion: 1;
  kind: "project-result";
  outcome: "created" | "cancelled";
  projectId?: string;
  grantsAuthority: false;
}

export async function createNativeProject(
  inputName: string,
  confirm: (review: NativeProjectReviewV1) => Promise<boolean>,
  registry = new WorkspaceRegistry(),
): Promise<NativeProjectResultV1> {
  if (typeof inputName !== "string"
    || !/^[A-Za-z0-9][A-Za-z0-9 ._'()&+-]{0,119}$/.test(inputName)
    || inputName.trim().length > 120
    || typeof confirm !== "function") {
    throw new NativeProjectSetupError("input_invalid");
  }
  const displayName = inputName.trim();
  try {
    const result = await runRegistrationSetup("register_project", { displayName }, async (
      review: RegistrationSetupReview,
    ) => confirm(Object.freeze({
      schemaVersion: 1,
      kind: "project-review",
      action: "register_project",
      destination: "local_user_workspace_registry",
      projectName: displayName,
      expiresAt: review.expiresAt,
      confirmationText: review.confirmationText,
      requiresExactReply: "REGISTER PROJECT",
      grantsAuthority: false,
    })), registry);
    return Object.freeze({
      schemaVersion: 1,
      kind: "project-result",
      outcome: result.registered ? "created" : "cancelled",
      ...(result.registered && result.projectId ? { projectId: result.projectId } : {}),
      grantsAuthority: false,
    });
  } catch {
    throw new NativeProjectSetupError("registration_failed");
  }
}
