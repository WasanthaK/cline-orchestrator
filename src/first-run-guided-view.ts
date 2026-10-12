import type { FirstRunAssessmentV1, FirstRunSetupStepV1 } from "./first-run-assessment.js";

export type GuidedSetupGateState = "ready" | "needs_attention" | "not_assessed";
export type GuidedSetupStepCode = FirstRunSetupStepV1["code"];

export interface GuidedSetupViewV1 {
  schemaVersion: 1;
  assessedAt: string;
  status: FirstRunAssessmentV1["status"];
  readOnly: true;
  actions: readonly [];
  gates: readonly {
    id: "runtime" | "provider" | "workspace" | "local_daemon" | "production";
    state: GuidedSetupGateState;
    title: string;
    detail: string;
  }[];
  steps: readonly {
    code: GuidedSetupStepCode;
    title: string;
    description: string;
    required: boolean;
  }[];
  grantsAuthority: false;
}

const STEP_DETAILS: Record<GuidedSetupStepCode, { title: string; description: string }> = {
  upgrade_node: {
    title: "Use a supported Node.js runtime",
    description: "Use Node.js 22 or later, then repeat the read-only assessment.",
  },
  configure_provider: {
    title: "Configure a model provider",
    description: "Choose a supported provider, model and endpoint using the existing explicitly confirmed setup workflow. No provider is assumed to be running.",
  },
  verify_provider: {
    title: "Verify model connectivity",
    description: "Run the existing provider preflight. A configured endpoint is not evidence that the model is reachable.",
  },
  register_workspace: {
    title: "Register a project and workspace",
    description: "Use the separately confirmed local project and workspace registration actions.",
  },
  configure_safety_profile: {
    title: "Review workspace Safety scope",
    description: "Review the approved path restrictions and protected files in the trusted Safety workflow before allowing tasks.",
  },
  configure_validation: {
    title: "Configure trusted validation",
    description: "Review validation commands under the approved workspace policy; a model suggestion is not approval.",
  },
  use_loopback_daemon: {
    title: "Restrict the daemon to loopback",
    description: "Use a validated loopback-only daemon configuration. Do not open a public or remote listener.",
  },
  start_daemon: {
    title: "Start the local daemon when needed",
    description: "Use the existing explicit local confirmation path, not this read-only page.",
  },
  resolve_production_readiness: {
    title: "Resolve production readiness findings",
    description: "Examine current security, reliability and observability evidence before claiming release readiness.",
  },
};

function gate(
  id: GuidedSetupViewV1["gates"][number]["id"],
  state: GuidedSetupGateState,
  title: string,
  detail: string,
): GuidedSetupViewV1["gates"][number] {
  return { id, state, title, detail };
}

function validDate(value: unknown): value is string {
  return typeof value === "string"
    && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)
    && !Number.isNaN(Date.parse(value))
    && new Date(value).toISOString() === value;
}

/**
 * Maps the *existing* trusted read-only first-run assessment to a bounded
 * presentation-only guide. It accepts no config files, endpoints, credential
 * values, task roots or browser action callbacks.
 */
export function buildGuidedSetupView(input: FirstRunAssessmentV1): GuidedSetupViewV1 {
  if (!input || input.schemaVersion !== 1
    || input.authority !== "first_run_assessment_observation_only"
    || input.readOnly !== true
    || input.writesConfig !== false
    || input.registersWorkspace !== false
    || input.startsService !== false
    || input.opensListener !== false
    || input.performsNetworkMutation !== false
    || input.usesCredentials !== false
    || input.grantsAuthority !== false
    || !["ready", "needs_setup", "blocked"].includes(input.status)
    || !validDate(input.assessedAt)
    || typeof input.nodeCompatible !== "boolean"
    || typeof input.providerReady !== "boolean"
    || typeof input.workspaceReady !== "boolean"
    || typeof input.daemonSafe !== "boolean"
    || typeof input.daemonRunning !== "boolean"
    || (input.productionReady !== undefined && typeof input.productionReady !== "boolean")
    || !Array.isArray(input.setupSteps)
    || input.setupSteps.length > 32) {
    throw new Error("guided setup requires a bounded, authority-free first-run assessment");
  }

  const seen = new Set<string>();
  const steps = input.setupSteps.map((step) => {
    if (!step || typeof step.code !== "string"
      || !Object.prototype.hasOwnProperty.call(STEP_DETAILS, step.code)
      || typeof step.required !== "boolean"
      || seen.has(step.code)) {
      throw new Error("guided setup contains an invalid or repeated setup step");
    }
    seen.add(step.code);
    const details = STEP_DETAILS[step.code as GuidedSetupStepCode];
    return Object.freeze({ code: step.code as GuidedSetupStepCode, ...details, required: step.required });
  });

  if (input.status === "ready" && (
    !input.nodeCompatible || !input.providerReady || !input.workspaceReady || !input.daemonSafe
    || steps.some((step) => step.required)
  )) {
    throw new Error("guided setup cannot advertise readiness against blocking assessment evidence");
  }

  const state = (valid: boolean): GuidedSetupGateState => valid ? "ready" : "needs_attention";
  return Object.freeze({
    schemaVersion: 1 as const,
    assessedAt: input.assessedAt,
    status: input.status,
    readOnly: true as const,
    actions: [] as const,
    gates: Object.freeze([
      gate("runtime", state(input.nodeCompatible), "Runtime", "Supported Node.js version"),
      gate("provider", state(input.providerReady), "Model provider", "Configuration and connectivity preflight"),
      gate("workspace", state(input.workspaceReady), "Workspace and Safety", "Registered workspace and trusted validation"),
      gate("local_daemon", !input.daemonSafe ? "needs_attention" : input.daemonRunning ? "ready" : "not_assessed",
        "Local daemon", "Loopback-only transport; running state shown separately"),
      gate("production", input.productionReady === undefined ? "not_assessed" : state(input.productionReady),
        "Production readiness", "Security, reliability and observability evidence"),
    ]),
    steps: Object.freeze(steps),
    grantsAuthority: false as const,
  });
}
