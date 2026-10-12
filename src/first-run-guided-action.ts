import { buildGuidedSetupView } from "./first-run-guided-view.js";
import type { FirstRunAssessmentV1 } from "./first-run-assessment.js";
import { runConfigWriteSetup, type ConfigWriteReview } from "./config-write-setup.js";
import { runRegistrationSetup, type RegistrationSetupReview } from "./registration-setup.js";
import { runDaemonStartSetup, type DaemonStartSetupReview } from "./daemon-start-setup.js";
import type { FirstRunSetupAction, FirstRunSetupOptions } from "./first-run-setup.js";
import type { ResolvedProductConfigV1 } from "./product-config.js";
import { WorkspaceRegistry } from "./workspace-registry.js";

/**
 * UX-C2 is a trusted, in-process adapter ONLY. No HTTP route, browser handler,
 * generic driver, credential entry field or confirmation-token forwarding.
 * The underlying M18B3b/c/d services remain the only mutation boundary.
 */
export const GUIDED_SETUP_ACTION_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  clientMayExecuteWithoutHostConfirmation: false as const,
  browserExposure: "none" as const,
  transport: "trusted_local_host_only" as const,
  rawCredentialsInReview: false as const,
  rawPathsInReview: false as const,
  confirmationTokensInReview: false as const,
  grantsTaskAuthority: false as const,
  grantsFilesystemAuthority: false as const,
  grantsCredentialAuthority: false as const,
  grantsReleaseAuthority: false as const,
});

export type GuidedSetupCommandV1 =
  | { action: "write_config"; targetPath: string; config: unknown }
  | { action: "register_project"; registration: { displayName: string } }
  | { action: "register_workspace"; registration: unknown }
  | { action: "start_loopback_daemon"; workspaceId: string };

export interface GuidedSetupLocalReviewV1 {
  schemaVersion: 1;
  action: FirstRunSetupAction;
  confirmationText: string;
  expiresAt: string;
  // The operator already selected the target in the trusted host. Neither
  // private paths nor complete config/registration documents enter this review.
  scope: "new_local_config" | "local_project" | "registered_workspace" | "local_loopback_daemon";
  authority: "guided_setup_confirmation_request_only";
  grantsAuthority: false;
}

export interface GuidedSetupActionResultV1 {
  schemaVersion: 1;
  action: FirstRunSetupAction;
  outcome: "completed" | "cancelled";
  // Outcome is a receipt of the existing service, never a Safety or task grant.
  authority: "existing_first_run_service_result_only";
  grantsAuthority: false;
}

export interface GuidedSetupTrustedHostV1 {
  /**
   * Only a trusted, independently authenticated local UI/CLI may provide this
   * confirmation callback. A future browser route requires its own origin,
   * session, CSRF, exact-scope and interaction security acceptance.
   */
  confirmLocalReview(review: GuidedSetupLocalReviewV1): Promise<boolean>;
  registry?: WorkspaceRegistry;
  daemonConfig?: ResolvedProductConfigV1;
  inheritedEnvironment?: Record<string, string | undefined>;
  dispatchDaemon?: (args: string[], env: Record<string, string | undefined>) => Promise<void>;
  setupOptions?: FirstRunSetupOptions;
}

export class GuidedSetupActionError extends Error {
  constructor(public readonly code: "action_not_allowed" | "local_confirmation_required" | "service_failed") {
    super({
      action_not_allowed: "The current guided setup step does not allow this action",
      local_confirmation_required: "A trusted local confirmation service is required",
      service_failed: "The setup action was not verified; inspect current local state before retrying",
    }[code]);
    this.name = "GuidedSetupActionError";
  }
}

const permitted: Record<FirstRunSetupAction, readonly string[]> = {
  write_config: ["configure_provider", "use_loopback_daemon"],
  register_project: ["register_workspace"],
  register_workspace: ["register_workspace"],
  start_loopback_daemon: ["start_daemon"],
};

const scopes: Record<FirstRunSetupAction, GuidedSetupLocalReviewV1["scope"]> = {
  write_config: "new_local_config",
  register_project: "local_project",
  register_workspace: "registered_workspace",
  start_loopback_daemon: "local_loopback_daemon",
};

type ExistingReview = ConfigWriteReview | RegistrationSetupReview | DaemonStartSetupReview;

/**
 * The first-run assessment is UX eligibility evidence, NOT execution authority.
 * Every actual write/start goes through the existing trusted service, which
 * revalidates destination, registry, current Safety/daemon config, expiry and
 * one-shot confirmation. No automatic retry after an uncertain service failure.
 */
export async function runGuidedSetupAction(
  assessment: FirstRunAssessmentV1,
  command: GuidedSetupCommandV1,
  host: GuidedSetupTrustedHostV1,
): Promise<GuidedSetupActionResultV1> {
  if (!host || typeof host.confirmLocalReview !== "function") {
    throw new GuidedSetupActionError("local_confirmation_required");
  }
  let view: ReturnType<typeof buildGuidedSetupView>;
  try {
    view = buildGuidedSetupView(assessment);
  } catch {
    throw new GuidedSetupActionError("action_not_allowed");
  }
  const action = command?.action;
  if (!action || !Object.hasOwn(permitted, action)
    || !view.steps.some((step) => permitted[action].includes(step.code))
    || (action === "start_loopback_daemon" && (
      !assessment.nodeCompatible || !assessment.providerReady
      || !assessment.workspaceReady || !assessment.daemonSafe || assessment.daemonRunning
    ))) {
    throw new GuidedSetupActionError("action_not_allowed");
  }
  if (action === "start_loopback_daemon" && (!host.daemonConfig || !host.dispatchDaemon)) {
    throw new GuidedSetupActionError("action_not_allowed");
  }

  let confirmations = 0;
  const confirm = async (review: ExistingReview): Promise<boolean> => {
    if (++confirmations !== 1) throw new GuidedSetupActionError("service_failed");
    if (!review || typeof review.confirmationText !== "string" || typeof review.expiresAt !== "string") {
      throw new GuidedSetupActionError("service_failed");
    }
    const preview: GuidedSetupLocalReviewV1 = Object.freeze({
      schemaVersion: 1, action,
      confirmationText: review.confirmationText,
      expiresAt: review.expiresAt,
      scope: scopes[action],
      authority: "guided_setup_confirmation_request_only",
      grantsAuthority: false,
    });
    return (await host.confirmLocalReview(preview)) === true;
  };

  try {
    let completed = false;
    switch (action) {
      case "write_config": {
        const result = await runConfigWriteSetup(command.targetPath, command.config, confirm,
          host.setupOptions);
        completed = result.written;
        break;
      }
      case "register_project":
      case "register_workspace": {
        const result = await runRegistrationSetup(action, command.registration, confirm,
          host.registry ?? new WorkspaceRegistry(), host.setupOptions);
        completed = result.registered;
        break;
      }
      case "start_loopback_daemon": {
        const result = await runDaemonStartSetup(command.workspaceId, host.daemonConfig!,
          { ...(host.inheritedEnvironment ?? {}) }, confirm, host.dispatchDaemon!,
          host.registry ?? new WorkspaceRegistry(), host.setupOptions);
        completed = result.dispatched;
        break;
      }
    }
    return Object.freeze({
      schemaVersion: 1 as const, action, outcome: completed ? "completed" as const : "cancelled" as const,
      authority: "existing_first_run_service_result_only" as const,
      grantsAuthority: false as const,
    });
  } catch {
    // Never expose underlying filesystem paths, credentials, raw service errors,
    // dispatch/environment details or confirmation tokens to presentation code.
    throw new GuidedSetupActionError("service_failed");
  }
}
