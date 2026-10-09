import type { ProductionReadinessSummaryV1 } from "./production-readiness.js";

export type FirstRunAssessmentStatus = "ready" | "needs_setup" | "blocked";

export const FIRST_RUN_ASSESSMENT_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  authority: "first_run_assessment_observation_only" as const,
  readOnly: true as const,
  writesConfig: false as const,
  registersWorkspace: false as const,
  startsService: false as const,
  opensListener: false as const,
  performsNetworkMutation: false as const,
  usesCredentials: false as const,
  grantsAuthority: false as const,
});

export interface FirstRunRuntimeObservationV1 {
  schemaVersion: 1;
  nodeVersion: string;
  platform: string;
  architecture: string;
  authority: "first_run_runtime_observation";
  grantsAuthority: false;
}

export interface FirstRunProviderObservationV1 {
  schemaVersion: 1;
  configured: boolean;
  providerId?: string;
  modelId?: string;
  endpointClass?: "loopback" | "private" | "remote" | "default";
  preflightSupported: boolean;
  preflightOk?: boolean;
  authority: "first_run_provider_observation";
  grantsAuthority: false;
}

export interface FirstRunWorkspaceObservationV1 {
  schemaVersion: 1;
  registered: boolean;
  workspaceId?: string;
  projectId?: string;
  rootAlias?: string;
  safetyProfileConfigured: boolean;
  validationCommandsConfigured: boolean;
  authority: "first_run_workspace_observation";
  grantsAuthority: false;
}

export interface FirstRunDaemonObservationV1 {
  schemaVersion: 1;
  hostClass: "loopback" | "private" | "public" | "unknown";
  port: number;
  running: boolean;
  authority: "first_run_daemon_observation";
  grantsAuthority: false;
}

export interface FirstRunAssessmentInputV1 {
  runtime: FirstRunRuntimeObservationV1;
  provider: FirstRunProviderObservationV1;
  workspace: FirstRunWorkspaceObservationV1;
  daemon: FirstRunDaemonObservationV1;
  readiness?: ProductionReadinessSummaryV1;
}

export interface FirstRunSetupStepV1 {
  code:
    | "upgrade_node"
    | "configure_provider"
    | "verify_provider"
    | "register_workspace"
    | "configure_safety_profile"
    | "configure_validation"
    | "use_loopback_daemon"
    | "start_daemon"
    | "resolve_production_readiness";
  required: boolean;
}

export interface FirstRunAssessmentV1 {
  schemaVersion: 1;
  assessedAt: string;
  status: FirstRunAssessmentStatus;
  nodeCompatible: boolean;
  providerReady: boolean;
  workspaceReady: boolean;
  daemonSafe: boolean;
  daemonRunning: boolean;
  productionReady?: boolean;
  setupSteps: FirstRunSetupStepV1[];
  summaryCodes: string[];
  authority: "first_run_assessment_observation_only";
  readOnly: true;
  writesConfig: false;
  registersWorkspace: false;
  startsService: false;
  opensListener: false;
  performsNetworkMutation: false;
  usesCredentials: false;
  grantsAuthority: false;
}

export interface FirstRunAssessmentOptions {
  now?: () => Date;
  minimumNodeMajor?: number;
  maxSteps?: number;
}

export class FirstRunAssessmentError extends Error {
  constructor(
    message: string,
    public readonly code: "input_invalid" | "configuration_invalid" | "clock_invalid",
  ) {
    super(message);
    this.name = "FirstRunAssessmentError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const SAFE_ALIAS = /^[A-Za-z0-9._ -]{1,128}$/;

function nodeMajor(version: string): number | undefined {
  const match = /^v?(\d+)(?:\.\d+){0,2}$/.exec(version.trim());
  if (!match) return undefined;
  const parsed = Number.parseInt(match[1]!, 10);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function validOpaqueId(value: string | undefined): boolean {
  return value === undefined || UUID.test(value);
}

function validateInput(input: FirstRunAssessmentInputV1): void {
  if (
    input.runtime.schemaVersion !== 1
    || input.runtime.authority !== "first_run_runtime_observation"
    || input.runtime.grantsAuthority !== false
    || !input.runtime.platform.trim()
    || !input.runtime.architecture.trim()
    || input.provider.schemaVersion !== 1
    || input.provider.authority !== "first_run_provider_observation"
    || input.provider.grantsAuthority !== false
    || input.workspace.schemaVersion !== 1
    || input.workspace.authority !== "first_run_workspace_observation"
    || input.workspace.grantsAuthority !== false
    || input.daemon.schemaVersion !== 1
    || input.daemon.authority !== "first_run_daemon_observation"
    || input.daemon.grantsAuthority !== false
    || !Number.isSafeInteger(input.daemon.port)
    || input.daemon.port < 1
    || input.daemon.port > 65535
    || !validOpaqueId(input.workspace.workspaceId)
    || !validOpaqueId(input.workspace.projectId)
    || (input.workspace.rootAlias !== undefined && !SAFE_ALIAS.test(input.workspace.rootAlias))
    || (input.provider.providerId !== undefined && !SAFE_ID.test(input.provider.providerId))
    || (input.provider.modelId !== undefined && !SAFE_ID.test(input.provider.modelId))
  ) {
    throw new FirstRunAssessmentError(
      "first-run assessment input is invalid or authority-widened",
      "input_invalid",
    );
  }

  if (
    input.readiness
    && (
      input.readiness.schemaVersion !== 1
      || input.readiness.authority !== "production_readiness_observation_only"
      || input.readiness.readOnly !== true
      || input.readiness.sanitized !== true
      || input.readiness.grantsReleaseAuthority !== false
    )
  ) {
    throw new FirstRunAssessmentError(
      "first-run production readiness evidence is invalid",
      "input_invalid",
    );
  }
}

export function assessFirstRun(
  input: FirstRunAssessmentInputV1,
  options: FirstRunAssessmentOptions = {},
): FirstRunAssessmentV1 {
  validateInput(input);

  const minimumNodeMajor = options.minimumNodeMajor ?? 22;
  const maxSteps = options.maxSteps ?? 12;
  if (
    !Number.isSafeInteger(minimumNodeMajor)
    || minimumNodeMajor < 18
    || minimumNodeMajor > 100
    || !Number.isSafeInteger(maxSteps)
    || maxSteps < 1
    || maxSteps > 32
  ) {
    throw new FirstRunAssessmentError(
      "first-run assessment configuration is invalid",
      "configuration_invalid",
    );
  }

  const now = (options.now ?? (() => new Date()))();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new FirstRunAssessmentError(
      "first-run assessment clock is invalid",
      "clock_invalid",
    );
  }

  const major = nodeMajor(input.runtime.nodeVersion);
  const nodeCompatible = major !== undefined && major >= minimumNodeMajor;
  const providerReady =
    input.provider.configured
    && input.provider.preflightSupported
    && input.provider.preflightOk === true;
  const workspaceReady =
    input.workspace.registered
    && input.workspace.safetyProfileConfigured
    && input.workspace.validationCommandsConfigured;
  const daemonSafe = input.daemon.hostClass === "loopback";
  const daemonRunning = input.daemon.running;
  const productionReady = input.readiness?.ready;

  const setupSteps: FirstRunSetupStepV1[] = [];
  const summaryCodes: string[] = [];

  const add = (code: FirstRunSetupStepV1["code"], required = true) => {
    setupSteps.push({ code, required });
  };

  if (!nodeCompatible) {
    add("upgrade_node");
    summaryCodes.push("runtime_incompatible");
  }
  if (!input.provider.configured) {
    add("configure_provider");
    summaryCodes.push("provider_not_configured");
  } else if (!providerReady) {
    add("verify_provider");
    summaryCodes.push("provider_not_ready");
  }
  if (!input.workspace.registered) {
    add("register_workspace");
    summaryCodes.push("workspace_not_registered");
  } else {
    if (!input.workspace.safetyProfileConfigured) {
      add("configure_safety_profile");
      summaryCodes.push("safety_profile_missing");
    }
    if (!input.workspace.validationCommandsConfigured) {
      add("configure_validation");
      summaryCodes.push("validation_missing");
    }
  }
  if (!daemonSafe) {
    add("use_loopback_daemon");
    summaryCodes.push("daemon_not_loopback");
  }
  if (daemonSafe && !daemonRunning) {
    add("start_daemon", false);
    summaryCodes.push("daemon_not_running");
  }
  if (input.readiness && !input.readiness.ready) {
    add("resolve_production_readiness");
    summaryCodes.push("production_not_ready");
  }

  const blocked =
    !nodeCompatible
    || !daemonSafe
    || (input.readiness !== undefined && input.readiness.observabilityReady === false);
  const status: FirstRunAssessmentStatus =
    blocked ? "blocked" : setupSteps.length > 0 ? "needs_setup" : "ready";

  return Object.freeze({
    schemaVersion: 1,
    assessedAt: now.toISOString(),
    status,
    nodeCompatible,
    providerReady,
    workspaceReady,
    daemonSafe,
    daemonRunning,
    ...(productionReady !== undefined ? { productionReady } : {}),
    setupSteps: Object.freeze(setupSteps.slice(0, maxSteps)) as FirstRunSetupStepV1[],
    summaryCodes: Object.freeze(summaryCodes.slice(0, maxSteps)) as string[],
    authority: "first_run_assessment_observation_only",
    readOnly: true,
    writesConfig: false,
    registersWorkspace: false,
    startsService: false,
    opensListener: false,
    performsNetworkMutation: false,
    usesCredentials: false,
    grantsAuthority: false,
  });
}
