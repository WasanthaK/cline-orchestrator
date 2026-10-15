#!/usr/bin/env node
import { spawn } from "node:child_process";
import { runManagedTaskCli, type ManagedTaskReview } from "./managed-task-cli.js";
import { scheduleManagedRunExitDiagnostic } from "./managed-exit-diagnostics.js";
import { exportOfflineSetupView } from "./offline-setup-view-export.js";
import { startInstalledPassiveViewer } from "./installed-passive-viewer.js";
import { checkLocalProvider } from "./local-provider-check.js";
import { saveNativeProviderConfig } from "./native-provider-config-save.js";
import { realpathSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import {
  assessFirstRun,
  type FirstRunAssessmentV1,
  type FirstRunWorkspaceObservationV1,
} from "./first-run-assessment.js";
import {
  type ProductConfigEnvironment,
  type ResolvedProductConfigV1,
} from "./product-config.js";
import { resolveProductConfigSource, readProductConfigFile, PRODUCT_CONFIG_SOURCE_CONTRACT } from "./product-config-source.js";
import { runConfigWriteSetup, type ConfigWriteReview } from "./config-write-setup.js";
import { runRegistrationSetup, RegistrationSetupError, type RegistrationSetupReview } from "./registration-setup.js";
import { createNativeProject, type NativeProjectReviewV1 } from "./native-project-setup.js";
import { listNativeProjects, registerNativeWorkspace, type NativeWorkspaceReviewV1 } from "./native-workspace-setup.js";
import { inspectNativeSetupReadiness } from "./native-setup-readiness.js";
import { projectNativeOperations } from "./native-operations.js";
import { inspectNativeSettings, updateNativeSettings, type NativeSettingsReviewV1 } from "./native-settings-update.js";
import { inspectNativeSettingsRecovery } from "./native-settings-recovery.js";
import { MachineOrchestratorService } from "./machine-orchestrator.js";
import { SafetyPlanService } from "./safety-plan.js";
import { createMachineDashboardSnapshotReader } from "./machine-dashboard-snapshot-reader.js";
import { createInstalledViewerMachineReader } from "./installed-passive-viewer.js";
import { runDaemonStartSetup, type DaemonStartSetupReview } from "./daemon-start-setup.js";
import { productExecutionEnvironment } from "./product-execution-config.js";
import { WorkspaceRegistry } from "./workspace-registry.js";

export const PRODUCT_CLI_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  executable: "cline-orchestrator" as const,
  stableProductCommands: [
    "diagnose",
    "config",
    "setup",
    "setup-view",
    "viewer",
    "check-provider",
    "setup-config-desktop",
    "setup-project-desktop",
    "list-projects-desktop",
    "readiness-desktop",
    "operations-desktop",
    "settings-desktop",
    "recovery-desktop",
    "update-settings-desktop",
    "setup-workspace-desktop",
    "setup-config",
    "setup-project",
    "setup-workspace",
    "setup-start",
    "managed-run",
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
  | { kind: "viewer" }
  | { kind: "provider_check"; providerId: string; modelId: string; baseUrl: string }
  | { kind: "desktop_config_save"; providerId: string; modelId: string; baseUrl: string }
  | { kind: "desktop_project_create"; displayName: string }
  | { kind: "desktop_project_list" }
  | { kind: "desktop_readiness" }
  | { kind: "desktop_operations" }
  | { kind: "desktop_settings_read" }
  | { kind: "desktop_recovery" }
  | { kind: "desktop_settings_update"; expectedRevision: string; providerId: string; modelId: string; baseUrl: string }
  | { kind: "desktop_workspace_create" }
  | { kind: "setup_view"; workspace: string; outputFile: string; configPath?: string }
  | { kind: "setup_start"; workspaceId: string; configPath?: string }
  | { kind: "managed_run"; workspaceId: string; goal: string; configPath?: string }
  | { kind: "setup_project"; displayName: string; configPath?: never }
  | { kind: "setup_workspace"; inputPath: string; configPath?: never }
  | { kind: "setup_config"; inputPath: string; targetPath: string; configPath?: never }
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
  confirmConfigWrite?(review: ConfigWriteReview): Promise<boolean>;
  confirmRegistration?(review: RegistrationSetupReview): Promise<boolean>;
  confirmDaemonStart?(review: DaemonStartSetupReview): Promise<boolean>;
  registrationRegistry?: WorkspaceRegistry;
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
    public readonly code: "usage_invalid" | "native_failed" | "legacy_failed" | "interactive_required",
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
    "  cline-orchestrator viewer  # explicit foreground, localhost-only read-only dashboard",
    "  cline-orchestrator check-provider <openai-compatible> <model-id> <http://127.0.0.1:port/v1>  # metadata-only loopback preflight",
    "  cline-orchestrator setup-config-desktop <provider> <model> <loopback-url>  # Windows local UI, confirmed create-only",
    "  cline-orchestrator setup-project-desktop <project-name>  # native Windows explicit local registry confirmation",
    "  cline-orchestrator list-projects-desktop  # read-only local project names for native selector",
    "  cline-orchestrator readiness-desktop  # read-only local setup snapshot and loopback model metadata check",
    "  cline-orchestrator operations-desktop  # read-only local setup and bounded task visibility",
    "  cline-orchestrator settings-desktop  # private native saved provider review",
    "  cline-orchestrator recovery-desktop  # verify previous versions without restoring anything",
    "  cline-orchestrator update-settings-desktop <revision> <provider> <model> <loopback-url>  # confirmed revision update",
    "  cline-orchestrator setup-workspace-desktop  # native Windows confirmed workspace/Safety registration over private stdio",
    "  cline-orchestrator [--config <file>] setup-view <workspace> <new-file.html>  # passive offline snapshot",
    "  cline-orchestrator setup-config <input.json> <new-output.json>  # interactive config creation",
    "  cline-orchestrator setup-project <display-name>  # interactive project registration",
    "  cline-orchestrator setup-workspace <input.json>  # interactive workspace/Safety registration",
    "  cline-orchestrator [--config <file>] setup-start <workspace-id>  # confirmed foreground daemon",
    "  cline-orchestrator [--config <file>] managed-run <workspace-id> <goal...>  # confirmed managed task (no daemon)",
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
    if ((route.kind !== "native" && route.kind !== "legacy" && route.kind !== "setup_start" && route.kind !== "setup_view" && route.kind !== "managed_run") || route.configPath !== undefined) {
      throw new ProductCliError(productCliUsage(), "usage_invalid");
    }
    return { ...route, configPath: filePath };
  }
  const [command, ...rest] = argv;
  if (!command) throw new ProductCliError(productCliUsage(), "usage_invalid");
  if (command === "viewer") {
    if (rest.length !== 0) throw new ProductCliError(productCliUsage(), "usage_invalid");
    return { kind: "viewer" };
  }
  if (command === "check-provider") {
    if (rest.length !== 3) throw new ProductCliError(productCliUsage(), "usage_invalid");
    return { kind: "provider_check", providerId: rest[0]!, modelId: rest[1]!, baseUrl: rest[2]! };
  }
  if (command === "setup-config-desktop") {
    if (rest.length !== 3) throw new ProductCliError(productCliUsage(), "usage_invalid");
    return { kind: "desktop_config_save", providerId: rest[0]!, modelId: rest[1]!, baseUrl: rest[2]! };
  }
  if (command === "setup-project-desktop") {
    if (rest.length !== 1) throw new ProductCliError(productCliUsage(), "usage_invalid");
    return { kind: "desktop_project_create", displayName: rest[0]! };
  }
  if (command === "settings-desktop" || command === "recovery-desktop") {
    if (rest.length !== 0) throw new ProductCliError(productCliUsage(), "usage_invalid");
    return { kind: command === "settings-desktop" ? "desktop_settings_read" : "desktop_recovery" };
  }
  if (command === "update-settings-desktop") {
    if (rest.length !== 4) throw new ProductCliError(productCliUsage(), "usage_invalid");
    return { kind: "desktop_settings_update", expectedRevision: rest[0]!,
      providerId: rest[1]!, modelId: rest[2]!, baseUrl: rest[3]! };
  }
  if (command === "readiness-desktop" || command === "operations-desktop") {
    if (rest.length !== 0) throw new ProductCliError(productCliUsage(), "usage_invalid");
    return { kind: command === "readiness-desktop" ? "desktop_readiness" : "desktop_operations" };
  }
  if (command === "list-projects-desktop" || command === "setup-workspace-desktop") {
    if (rest.length !== 0) throw new ProductCliError(productCliUsage(), "usage_invalid");
    return { kind: command === "list-projects-desktop" ? "desktop_project_list" : "desktop_workspace_create" };
  }
  if (command === "setup-view") {
    if (rest.length !== 2 || !rest[0]?.trim() || !rest[1]?.trim()) throw new ProductCliError(productCliUsage(), "usage_invalid");
    return { kind: "setup_view", workspace: rest[0], outputFile: rest[1] };
  }
  if (command === "managed-run") {
    if (rest.length < 2 || !rest[0]?.trim() || !rest.slice(1).join(" ").trim()) {
      throw new ProductCliError(productCliUsage(), "usage_invalid");
    }
    return { kind: "managed_run", workspaceId: rest[0]!, goal: rest.slice(1).join(" ") };
  }
  if (command === "setup-start") {
    if (rest.length !== 1) throw new ProductCliError(productCliUsage(), "usage_invalid");
    return { kind: "setup_start", workspaceId: rest[0]! };
  }
  if (command === "setup-project" || command === "setup-workspace") {
    if (rest.length !== 1) throw new ProductCliError(productCliUsage(), "usage_invalid");
    return command === "setup-project" ? { kind: "setup_project", displayName: rest[0]! }
      : { kind: "setup_workspace", inputPath: rest[0]! };
  }
  if (command === "setup-config") {
    if (rest.length !== 2) throw new ProductCliError(productCliUsage(), "usage_invalid");
    return { kind: "setup_config", inputPath: rest[0]!, targetPath: rest[1]! };
  }

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
  if (route.kind === "desktop_readiness" || route.kind === "desktop_operations") {
    const stateRoot = deps.env.LOCALAPPDATA;
    if (process.platform !== "win32" || typeof stateRoot !== "string"
      || !path.win32.isAbsolute(stateRoot)) {
      throw new ProductCliError("Windows local state is unavailable", "interactive_required");
    }
    const registry = deps.registrationRegistry ?? new WorkspaceRegistry();
    const snapshot = await inspectNativeSetupReadiness(stateRoot, registry);
    if (route.kind === "desktop_readiness") {
      process.stdout.write(JSON.stringify(snapshot) + "\n");
      return undefined;
    }
    // Only the existing passive viewer's five observation capabilities are
    // offered to the native aggregation path. No execution profile is resolved.
    const machine = new MachineOrchestratorService(registry, new SafetyPlanService(registry),
      () => { throw new Error("Native operations cannot resolve a worker"); });
    try {
      const reader = createMachineDashboardSnapshotReader(createInstalledViewerMachineReader(machine));
      let visual;
      try { visual = await reader.readSnapshot(); }
      catch { /* Failed task history is unknown, not an empty healthy result. */ }
      process.stdout.write(JSON.stringify(projectNativeOperations(snapshot, visual)) + "\n");
    } finally { await machine.close(); }
    return undefined;
  }
  if (route.kind === "desktop_settings_read" || route.kind === "desktop_settings_update"
    || route.kind === "desktop_recovery") {
    const stateRoot = deps.env.LOCALAPPDATA;
    if (process.platform !== "win32" || typeof stateRoot !== "string"
      || !path.win32.isAbsolute(stateRoot)) {
      throw new ProductCliError("Native settings require Windows local user state", "interactive_required");
    }
    const directory = path.win32.join(stateRoot, "ClineOrchestrator");
    if (route.kind === "desktop_settings_read") {
      process.stdout.write(JSON.stringify(await inspectNativeSettings(directory)) + "\n");
      return undefined;
    }
    if (route.kind === "desktop_recovery") {
      process.stdout.write(JSON.stringify(await inspectNativeSettingsRecovery(directory)) + "\n");
      return undefined;
    }
    // One exact private host confirmation; no browser access or config path args.
    const confirm = async (review: NativeSettingsReviewV1) => {
      process.stdout.write(JSON.stringify(review) + "\n");
      const terminal = createInterface({ input: process.stdin, crlfDelay: Infinity });
      try {
        const phrase = await terminal.question("", { signal: AbortSignal.timeout(55_000) });
        return phrase === "UPDATE CONFIG";
      } catch { return false; }
      finally { terminal.close(); }
    };
    const result = await updateNativeSettings({
      stateDirectory: directory, expectedRevision: route.expectedRevision,
      selection: { providerId: route.providerId, modelId: route.modelId, baseUrl: route.baseUrl },
    }, confirm);
    process.stdout.write(JSON.stringify(result) + "\n");
    return undefined;
  }
  if (route.kind === "desktop_project_list" || route.kind === "desktop_workspace_create") {
    if (process.platform !== "win32" || typeof deps.env.LOCALAPPDATA !== "string"
      || !path.win32.isAbsolute(deps.env.LOCALAPPDATA)) {
      throw new ProductCliError("Windows local registry is unavailable", "interactive_required");
    }
    const registry = deps.registrationRegistry ?? new WorkspaceRegistry();
    if (route.kind === "desktop_project_list") {
      process.stdout.write(JSON.stringify(await listNativeProjects(registry)) + "\n");
      return undefined;
    }
    // One bounded JSON line from the owned, redirected native-child stdin.
    // No arbitrary registry file, task/daemon command or browser mutation.
    const inputTerminal = createInterface({ input: process.stdin, crlfDelay: Infinity });
    let input: unknown;
    try {
      const line = await inputTerminal.question("", { signal: AbortSignal.timeout(25_000) });
      if (line.length > 20_000) throw new Error("too large");
      input = JSON.parse(line);
    } catch {
      throw new ProductCliError("Native workspace review input is invalid", "usage_invalid");
    } finally { inputTerminal.close(); }
    const confirm = async (review: NativeWorkspaceReviewV1) => {
      process.stdout.write(JSON.stringify(review) + "\n");
      const terminal = createInterface({ input: process.stdin, crlfDelay: Infinity });
      try {
        const phrase = await terminal.question("", { signal: AbortSignal.timeout(55_000) });
        return phrase === "REGISTER WORKSPACE";
      } catch { return false; }
      finally { terminal.close(); }
    };
    const result = await registerNativeWorkspace(input, confirm, registry);
    process.stdout.write(JSON.stringify(result) + "\n");
    return undefined;
  }
  if (route.kind === "desktop_project_create") {
    if (process.platform !== "win32" || typeof deps.env.LOCALAPPDATA !== "string"
      || !path.win32.isAbsolute(deps.env.LOCALAPPDATA)) {
      throw new ProductCliError("Windows local user registry is unavailable", "interactive_required");
    }
    // The project registry location is resolved by WorkspaceRegistry itself.
    // No selected path, browser route, task capability or implicit approval.
    const confirm = async (review: NativeProjectReviewV1) => {
      process.stdout.write(JSON.stringify(review) + "\n");
      const terminal = createInterface({ input: process.stdin, crlfDelay: Infinity });
      try {
        const phrase = await terminal.question("", { signal: AbortSignal.timeout(55_000) });
        return phrase === "REGISTER PROJECT";
      } catch { return false; }
      finally { terminal.close(); }
    };
    const result = await createNativeProject(route.displayName, confirm,
      deps.registrationRegistry ?? new WorkspaceRegistry());
    process.stdout.write(JSON.stringify(result) + "\n");
    return undefined;
  }
  if (route.kind === "desktop_config_save") {
    // Deliberately no HTTP route, generic target path, unattended switch, raw
    // secret, daemon or task capability. The native host must obtain local
    // consent after receiving the confirmed service review over stdio.
    const stateRoot = deps.env.LOCALAPPDATA;
    if (process.platform !== "win32" || typeof stateRoot !== "string" ||
      !path.win32.isAbsolute(stateRoot) || !stateRoot.trim()) {
      throw new ProductCliError("Windows local user state directory is unavailable", "interactive_required");
    }
    const destination = path.win32.join(stateRoot, "ClineOrchestrator");
    const confirm = async (review: Parameters<typeof saveNativeProviderConfig>[1] extends
      (review: infer T) => Promise<boolean> ? T : never) => {
      process.stdout.write(JSON.stringify(review) + "\n");
      const terminal = createInterface({ input: process.stdin, crlfDelay: Infinity });
      try {
        const phrase = await terminal.question("", { signal: AbortSignal.timeout(55_000) });
        return phrase === "CREATE CONFIG";
      } catch { return false; }
      finally { terminal.close(); }
    };
    const result = await saveNativeProviderConfig({
      providerId: route.providerId, modelId: route.modelId,
      baseUrl: route.baseUrl, stateDirectory: destination,
    }, confirm);
    process.stdout.write(JSON.stringify(result) + "\n");
    return undefined;
  }
  if (route.kind === "provider_check") {
    const result = await checkLocalProvider(route);
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return undefined;
  }
  if (route.kind === "viewer") {
    const viewer = await startInstalledPassiveViewer(deps.env);
    process.stdout.write(JSON.stringify({ command: "viewer", origin: viewer.origin,
      readOnly: true, grantsAuthority: false, browserAutoOpened: false,
      daemonStarted: false, serviceInstalled: false }, null, 2) + "\n");
    // Foreground listener: process exit/signals release the listening socket.
    return undefined;
  }
  if (route.kind === "setup_view") {
    const result = await runNativeProductCommand({ kind: "native", command: "diagnose", args: [route.workspace], configPath: route.configPath }, deps);
    const receipt = await exportOfflineSetupView(result.payload as FirstRunAssessmentV1, route.outputFile);
    process.stdout.write(JSON.stringify(receipt, null, 2) + "\n");
    return undefined;
  }
  if (route.kind === "managed_run") {
    const config = await resolveProductConfigSource(route.configPath ?? deps.env.ORCH_CONFIG_FILE, deps.env, deps.readConfigFile);
    const confirm = async (review: ManagedTaskReview) => {
      if (!process.stdin.isTTY || !process.stdout.isTTY) {
        throw new ProductCliError("Managed execution requires an interactive terminal", "interactive_required");
      }
      process.stdout.write("Review registered workspace and Safety Plan before starting Cline:\n"
        + JSON.stringify(review, null, 2) + "\n");
      const terminal = createInterface({ input: process.stdin, output: process.stdout });
      try { return await terminal.question("Type APPROVE TASK to start: ") === "APPROVE TASK"; }
      finally { terminal.close(); }
    };
    const result = await runManagedTaskCli({ workspaceId: route.workspaceId, goal: route.goal, config, env: deps.env }, { confirm });
    process.stdout.write(JSON.stringify({ command: "managed-run", ...result }, null, 2) + "\n");
    scheduleManagedRunExitDiagnostic(deps.env);
    return undefined;
  }
  if (route.kind === "setup_start") {
    const inherited = { ...deps.env };
    const config = await resolveProductConfigSource(route.configPath ?? inherited.ORCH_CONFIG_FILE,
      inherited, deps.readConfigFile);
    const confirm = deps.confirmDaemonStart ?? (async (review: DaemonStartSetupReview) => {
      if (!process.stdin.isTTY || !process.stdout.isTTY) {
        throw new ProductCliError("Daemon setup requires an interactive terminal", "interactive_required");
      }
      process.stdout.write(`${review.confirmationText}\n${JSON.stringify({ workspace: review.workspace, config: review.config }, null, 2)}\n`);
      const terminal = createInterface({ input: process.stdin, output: process.stdout });
      try { return await terminal.question("Type START DAEMON to run in the foreground: ") === "START DAEMON"; }
      finally { terminal.close(); }
    });
    const result = await runDaemonStartSetup(route.workspaceId, config, inherited, confirm,
      deps.dispatchLegacy ?? runLegacy, deps.registrationRegistry);
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return undefined;
  }
  if (route.kind === "setup_project" || route.kind === "setup_workspace") {
    let input: unknown = { displayName: route.kind === "setup_project" ? route.displayName : "" };
    if (route.kind === "setup_workspace") {
      try {
        const text = await (deps.readConfigFile ?? readProductConfigFile)(route.inputPath);
        if (Buffer.byteLength(text, "utf8") > PRODUCT_CONFIG_SOURCE_CONTRACT.maxFileBytes) throw new Error("oversized");
        input = JSON.parse(text);
      } catch { throw new RegistrationSetupError("input_invalid"); }
    }
    const confirm = deps.confirmRegistration ?? (async (review: RegistrationSetupReview) => {
      if (!process.stdin.isTTY || !process.stdout.isTTY) {
        throw new ProductCliError("Registration requires an interactive terminal", "interactive_required");
      }
      process.stdout.write(`${review.confirmationText}\nRegistry: ${review.registryPath}\n`
        + `${JSON.stringify(review.registration, null, 2)}\n`
        + (review.canonicalRoot ? `Canonical workspace root: ${review.canonicalRoot}\n` : ""));
      const phrase = review.action === "register_project" ? "REGISTER PROJECT" : "REGISTER WORKSPACE";
      const terminal = createInterface({ input: process.stdin, output: process.stdout });
      try { return await terminal.question(`Type ${phrase} to confirm: `) === phrase; }
      finally { terminal.close(); }
    });
    const result = await runRegistrationSetup(route.kind === "setup_project" ? "register_project" : "register_workspace",
      input, confirm, deps.registrationRegistry);
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return undefined;
  }
  if (route.kind === "setup_config") {
    const reader = deps.readConfigFile ?? readProductConfigFile;
    let text = "";
    await resolveProductConfigSource(route.inputPath, {}, async (file) => {
      text = await reader(file);
      return text;
    });
    const config: unknown = JSON.parse(text);
    const confirm = deps.confirmConfigWrite ?? (async (review: ConfigWriteReview) => {
      if (!process.stdin.isTTY || !process.stdout.isTTY) {
        throw new ProductCliError("Config creation requires an interactive terminal", "interactive_required");
      }
      process.stdout.write(`Create config at: ${review.targetPath}\n${JSON.stringify(review.config, null, 2)}\n`);
      const terminal = createInterface({ input: process.stdin, output: process.stdout });
      try { return await terminal.question("Type WRITE CONFIG to create this file: ") === "WRITE CONFIG"; }
      finally { terminal.close(); }
    });
    const result = await runConfigWriteSetup(route.targetPath, config, confirm);
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return undefined;
  }
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
  ? realpathSync(fileURLToPath(import.meta.url)) === realpathSync(path.resolve(process.argv[1]))
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
