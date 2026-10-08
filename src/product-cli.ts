#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  assessFirstRun,
  type FirstRunAssessmentV1,
  type FirstRunWorkspaceObservationV1,
} from "./first-run-assessment.js";
import {
  type ProductConfigEnvironment,
  type ResolvedProductConfigV1,
} from "./product-config.js";
import { resolveProductConfigSource } from "./product-config-source.js";
import { productExecutionEnvironment } from "./product-execution-config.js";
import { WorkspaceRegistry } from "./workspace-registry.js";

export const PRODUCT_CLI_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  executable: "cline-orchestrator" as const,
  stableProductCommands: [
    "diagnose",
    "config",
    "setup",
    "start",
    "status",
    "tasks",
    "run",
    "events",
    "resume",
    "abort",
    "rollback",
    "legacy",
  ] as const,
  nativeCommandsAreReadOnly: true as const,
  legacyDelegatesExistingDispatcher: true as const,
  broadensAuthority: false as const,
  opensRemoteListener: false as const,
  grantsAuthority: false as const,
});

export type ProductCliRoute =
  | { kind: "native"; command: "diagnose" | "config" | "setup" | "daemon_status"; args: string[]; configPath?: string }
  | { kind: "legacy"; args: string[]; configPath?: string };

export interface ProductCliFetchResult {
  ok: boolean;
  status: number;
  payload?: unknown;
}

export interface ProductCliDependencies {
  env: ProductConfigEnvironment & Record<string, string | undefined>;
  runtime: {
    nodeVersion: string;
    platform: string;
    architecture: string;
  };
  readConfigFile?(filePath: string): Promise<string>;
  dispatchLegacy?(args: string[], env: Record<string, string | undefined>): Promise<void>;
  findWorkspace(root: string): Promise<FirstRunWorkspaceObservationV1>;
  fetchJson(url: string): Promise<ProductCliFetchResult>;
}

export interface ProductCliNativeResult {
  schemaVersion: 1;
  command: "diagnose" | "config" | "setup" | "status";
  payload: unknown;
  authority: "product_cli_observation_only";
  mutatesConfig: false;
  registersWorkspace: false;
  startsService: false;
  performsNetworkMutation: false;
  grantsAuthority: false;
}

export class ProductCliError extends Error {
  constructor(
    message: string,
    public readonly code: "usage_invalid" | "native_failed" | "legacy_failed",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ProductCliError";
  }
}

export function productCliUsage(): string {
  return [
    "Cline Orchestrator",
    "",
    "Usage:",
    "  cline-orchestrator [--config <file>] <command> [...args]",
    "  ORCH_CONFIG_FILE selects a file; --config takes precedence.",
    "  cline-orchestrator diagnose <workspace>",
    "  cline-orchestrator config",
    "  cline-orchestrator setup <workspace>        # read-only setup plan",
    "  cline-orchestrator start <workspace>",
    "  cline-orchestrator status <workspace> [task-id]",
    "  cline-orchestrator tasks <workspace>",
    "  cline-orchestrator run <workspace> <goal...>",
    "  cline-orchestrator events <workspace> <task-id>",
    "  cline-orchestrator resume <workspace> <task-id> <prompt...>",
    "  cline-orchestrator abort <workspace> <task-id> [reason...]",
    "  cline-orchestrator rollback <workspace> <task-id>",
    "  cline-orchestrator legacy <legacy-command> <workspace> [...args]",
    "",
    "Safety:",
    "  diagnose/config/setup/status are read-only product commands.",
    "  setup proposes actions only; mutations require separate explicit confirmation.",
    "  daemon/product configuration remains loopback-only by default.",
    "  task mutations delegate to the existing authority-enforcing dispatcher.",
  ].join("\n");
}

export function routeProductCli(argv: string[]): ProductCliRoute {
  if (argv[0] === "--config") {
    const filePath = argv[1];
    if (!filePath?.trim() || filePath.startsWith("-") || filePath.includes("\0") || argv.length < 3) {
      throw new ProductCliError(productCliUsage(), "usage_invalid");
    }
    const route = routeProductCli(argv.slice(2));
    if (route.configPath !== undefined) {
      throw new ProductCliError(productCliUsage(), "usage_invalid");
    }
    return { ...route, configPath: filePath };
  }
  const [command, ...rest] = argv;
  if (!command) throw new ProductCliError(productCliUsage(), "usage_invalid");

  if (command === "diagnose" || command === "setup") {
    if (rest.length !== 1) throw new ProductCliError(productCliUsage(), "usage_invalid");
    return { kind: "native", command, args: rest };
  }
  if (command === "config") {
    if (rest.length !== 0) throw new ProductCliError(productCliUsage(), "usage_invalid");
    return { kind: "native", command, args: [] };
  }
  if (command === "start") {
    if (rest.length !== 1) throw new ProductCliError(productCliUsage(), "usage_invalid");
    return { kind: "legacy", args: ["daemon", ...rest] };
  }
  if (command === "tasks") {
    if (rest.length !== 1) throw new ProductCliError(productCliUsage(), "usage_invalid");
    return { kind: "legacy", args: ["list", ...rest] };
  }
  if (command === "status") {
    if (rest.length === 1) return { kind: "native", command: "daemon_status", args: rest };
    if (rest.length === 2) return { kind: "legacy", args: ["status", ...rest] };
    throw new ProductCliError(productCliUsage(), "usage_invalid");
  }
  if (["run", "events", "resume", "abort", "rollback"].includes(command)) {
    if (rest.length < 1) throw new ProductCliError(productCliUsage(), "usage_invalid");
    return { kind: "legacy", args: [command, ...rest] };
  }
  if (command === "legacy") {
    if (rest.length < 2) throw new ProductCliError(productCliUsage(), "usage_invalid");
    return { kind: "legacy", args: rest };
  }

  throw new ProductCliError(productCliUsage(), "usage_invalid");
}

function nativeResult(
  command: ProductCliNativeResult["command"],
  payload: unknown,
): ProductCliNativeResult {
  return Object.freeze({
    schemaVersion: 1,
    command,
    payload,
    authority: "product_cli_observation_only",
    mutatesConfig: false,
    registersWorkspace: false,
    startsService: false,
    performsNetworkMutation: false,
    grantsAuthority: false,
  });
}

function hostClass(config: ResolvedProductConfigV1): "loopback" {
  void config;
  return "loopback";
}

function providerObservation(
  config: ResolvedProductConfigV1,
  preflight?: ProductCliFetchResult,
) {
  const payload = preflight?.payload as { ok?: unknown } | undefined;
  return {
    schemaVersion: 1 as const,
    configured: true,
    providerId: config.provider.providerId,
    modelId: config.provider.modelId,
    endpointClass: config.provider.baseUrl.includes("localhost")
      || config.provider.baseUrl.includes("127.0.0.1")
      ? "loopback" as const
      : "remote" as const,
    preflightSupported: true,
    preflightOk: preflight?.ok === true && payload?.ok === true,
    authority: "first_run_provider_observation" as const,
    grantsAuthority: false as const,
  };
}

export async function runNativeProductCommand(
  route: Extract<ProductCliRoute, { kind: "native" }>,
  deps: ProductCliDependencies,
): Promise<ProductCliNativeResult> {
  const config = await resolveProductConfigSource(
    route.configPath ?? deps.env.ORCH_CONFIG_FILE,
    deps.env,
    deps.readConfigFile,
  );

  if (route.command === "config") {
    return nativeResult("config", config);
  }

  if (route.command === "daemon_status") {
    const health = await deps.fetchJson(`${config.daemon.url}/health`);
    return nativeResult("status", {
      reachable: health.ok,
      httpStatus: health.status,
      loopback: true,
    });
  }

  const workspaceRoot = path.resolve(route.args[0]!);
  const workspace = await deps.findWorkspace(workspaceRoot);

  let health: ProductCliFetchResult = { ok: false, status: 0 };
  let preflight: ProductCliFetchResult | undefined;
  try {
    health = await deps.fetchJson(`${config.daemon.url}/health`);
    if (health.ok) {
      preflight = await deps.fetchJson(`${config.daemon.url}/preflight`);
    }
  } catch {
    health = { ok: false, status: 0 };
  }

  const assessment: FirstRunAssessmentV1 = assessFirstRun({
    runtime: {
      schemaVersion: 1,
      nodeVersion: deps.runtime.nodeVersion,
      platform: deps.runtime.platform,
      architecture: deps.runtime.architecture,
      authority: "first_run_runtime_observation",
      grantsAuthority: false,
    },
    provider: providerObservation(config, preflight),
    workspace,
    daemon: {
      schemaVersion: 1,
      hostClass: hostClass(config),
      port: config.daemon.port,
      running: health.ok,
      authority: "first_run_daemon_observation",
      grantsAuthority: false,
    },
  });

  if (route.command === "diagnose") {
    return nativeResult("diagnose", assessment);
  }

  return nativeResult("setup", {
    assessment,
    proposedActions: assessment.setupSteps.map((step) => ({
      code: step.code,
      required: step.required,
    })),
    mutationPerformed: false,
    explicitM17CConfirmationRequiredForMutation: true,
  });
}

async function defaultFindWorkspace(root: string): Promise<FirstRunWorkspaceObservationV1> {
  const registry = new WorkspaceRegistry();
  const records = await registry.listWorkspaces();
  const normalized = path.resolve(root);
  for (const record of records) {
    const workspace = await registry.getWorkspace(record.workspaceId);
    const candidate = path.resolve(workspace.canonicalRoot);
    const same = process.platform === "win32"
      ? candidate.toLowerCase() === normalized.toLowerCase()
      : candidate === normalized;
    if (!same) continue;
    return {
      schemaVersion: 1,
      registered: true,
      workspaceId: workspace.workspaceId,
      projectId: workspace.projectId,
      rootAlias: path.basename(workspace.canonicalRoot),
      safetyProfileConfigured: Boolean(workspace.safetyProfile.policyVersion),
      validationCommandsConfigured: workspace.safetyProfile.validationCommands.length > 0,
      authority: "first_run_workspace_observation",
      grantsAuthority: false,
    };
  }

  return {
    schemaVersion: 1,
    registered: false,
    safetyProfileConfigured: false,
    validationCommandsConfigured: false,
    authority: "first_run_workspace_observation",
    grantsAuthority: false,
  };
}

async function defaultFetchJson(url: string): Promise<ProductCliFetchResult> {
  try {
    const response = await fetch(url, { method: "GET" });
    const text = await response.text();
    let payload: unknown;
    try {
      payload = text ? JSON.parse(text) : undefined;
    } catch {
      payload = undefined;
    }
    return { ok: response.ok, status: response.status, payload };
  } catch {
    return { ok: false, status: 0 };
  }
}

function defaultDependencies(): ProductCliDependencies {
  return {
    env: process.env as ProductCliDependencies["env"],
    runtime: {
      nodeVersion: process.version,
      platform: process.platform,
      architecture: process.arch,
    },
    findWorkspace: defaultFindWorkspace,
    fetchJson: defaultFetchJson,
  };
}

async function runLegacy(args: string[], env: Record<string, string | undefined>): Promise<void> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const fromSource = fileURLToPath(import.meta.url).endsWith(".ts");
  const entry = path.join(here, fromSource ? "index.ts" : "index.js");
  const code = await new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, [...(fromSource ? process.execArgv : []), entry, ...args], {
      stdio: "inherit",
      env,
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (value) => resolve(value ?? 1));
  }).catch((error) => {
    throw new ProductCliError("legacy command could not be started", "legacy_failed", { cause: error });
  });
  if (code !== 0) {
    throw new ProductCliError(`legacy command exited with code ${code}`, "legacy_failed");
  }
}

export async function runProductCli(
  argv: string[],
  deps: ProductCliDependencies = defaultDependencies(),
): Promise<ProductCliNativeResult | undefined> {
  const route = routeProductCli(argv);
  if (route.kind === "legacy") {
    const config = await resolveProductConfigSource(
      route.configPath ?? deps.env.ORCH_CONFIG_FILE, deps.env, deps.readConfigFile,
    );
    const childEnv = productExecutionEnvironment(config, deps.env);
    if (route.args[0] === "daemon" && config.provider.apiKeySecretRef) {
      childEnv.ORCH_API_KEY_SECRET_REF = config.provider.apiKeySecretRef;
    }
    await (deps.dispatchLegacy ?? runLegacy)(route.args, childEnv);
    return undefined;
  }

  const result = await runNativeProductCommand(route, deps);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

const isMain = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isMain) {
  runProductCli(process.argv.slice(2)).catch((error) => {
    if (error instanceof ProductCliError) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = error.code === "usage_invalid" ? 2 : 1;
      return;
    }
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
