import { lstat } from "node:fs/promises";
import {
  computePatchChanges,
  createDefaultExecutors,
  type RuntimeCapabilities,
} from "@cline/sdk";
import { HumanEscalationService } from "./human-escalation.js";
import type { ActionDescriptor, PreExecutionPolicyContext } from "./pre-execution-policy.js";
import { normalizeToolAction } from "./pre-execution-policy.js";
import { enforceSafeAction, SafeExecutorError } from "./safe-executors.js";
import type { DurableSafetyBinding } from "./safety-plan.js";
import { TaskStore } from "./state.js";
import type { OrchestratorTask, WorkerConfig } from "./types.js";

const PILOT_PROVIDER_IDS = new Set(["ollama", "openai-compatible"]);
const PILOT_TOOL_NAMES = new Set(["read_files", "search_codebase", "editor", "apply_patch", "submit_and_exit"]);
const OWNER_TARGETED_EXECUTOR_NAMES = ["applyPatch", "editor", "readFile", "search"] as const;
const OWNER_TARGETED_ENABLED_TOOL_NAMES = new Set([
  "read_files",
  "search_codebase",
  "editor",
  "apply_patch",
  "submit_and_exit",
]);

export class HubSafetyConfigurationError extends Error {
  readonly code = "hub_safety_configuration_invalid";

  constructor(message: string) {
    super(message);
    this.name = "HubSafetyConfigurationError";
  }
}

export interface HubSafetySessionContributions {
  localRuntime: {
    hooks: {
      beforeTool(context: any): Promise<{ skip?: boolean; stop?: boolean; reason?: string } | undefined>;
    };
    configExtensions: [];
  };
  capabilities: RuntimeCapabilities;
  toolPolicies: Record<string, { enabled?: boolean; autoApprove?: boolean }>;
  configOverrides: {
    disableMcpSettingsTools: true;
    enableSpawnAgent: false;
    enableAgentTeams: false;
    pluginPaths: [];
    agentPluginPaths: [];
  };
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new HubSafetyConfigurationError(`Approved task is missing ${field}`);
  }
  return value;
}

function requireStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new HubSafetyConfigurationError(`Approved task is missing ${field}`);
  }
  return [...value] as string[];
}

export function durableSafetyBindingFromTask(task: OrchestratorTask): DurableSafetyBinding {
  if (!Number.isInteger(task.workspaceRegistryRevision) || (task.workspaceRegistryRevision ?? 0) < 1) {
    throw new HubSafetyConfigurationError("Approved task is missing workspaceRegistryRevision");
  }
  if (!Number.isInteger(task.safetyProfileRevision) || (task.safetyProfileRevision ?? 0) < 1) {
    throw new HubSafetyConfigurationError("Approved task is missing safetyProfileRevision");
  }

  return {
    projectId: requireString(task.projectId, "projectId"),
    workspaceId: requireString(task.workspaceId, "workspaceId"),
    workspaceRegistryRevision: task.workspaceRegistryRevision!,
    safetyPlanId: requireString(task.safetyPlanId, "safetyPlanId"),
    policyVersion: requireString(task.safetyPolicyVersion, "safetyPolicyVersion"),
    safetyProfileId: requireString(task.safetyProfileId, "safetyProfileId"),
    safetyProfileRevision: task.safetyProfileRevision!,
    allowedPathPatterns: requireStringArray(task.approvedAllowedPathPatterns, "approvedAllowedPathPatterns"),
    protectedPathPatterns: requireStringArray(task.approvedProtectedPathPatterns, "approvedProtectedPathPatterns"),
    workerProfileId: requireString(task.workerProfileId, "workerProfileId"),
  };
}

export function assertFirstPilotWorkerSurface(worker: WorkerConfig): void {
  if (!PILOT_PROVIDER_IDS.has(worker.providerId)) {
    throw new HubSafetyConfigurationError(
      `Provider '${worker.providerId}' is not admitted by the first Hub write-pilot profile because provider-owned tool execution has not been proven interceptable`,
    );
  }
}

/**
 * Fail-closed invariant for the first write-capable Hub pilot.
 *
 * The owner session is the only admitted machine authority. Native agent spawning,
 * teams, plugins, or extra SDK executors could create execution paths that do not
 * pass through the owner-targeted safe executors below. Any future work that wants
 * one of those features must deliberately replace this invariant with a separately
 * reviewed adapter proving that every side effect still traverses current task /
 * Safety Plan authority (and, when concurrency is enabled, the current fenced
 * workspace lease). A config flip alone must therefore fail closed.
 */
export function assertOwnerTargetedHubSafetyBoundary(
  safety: HubSafetySessionContributions,
): void {
  const config = safety.configOverrides;
  if (
    config.disableMcpSettingsTools !== true ||
    config.enableSpawnAgent !== false ||
    config.enableAgentTeams !== false ||
    config.pluginPaths.length !== 0 ||
    config.agentPluginPaths.length !== 0
  ) {
    throw new HubSafetyConfigurationError(
      "Delegated Hub execution surfaces are disabled until an owner-targeted safe-executor adapter is separately reviewed",
    );
  }

  if (safety.localRuntime.configExtensions.length !== 0) {
    throw new HubSafetyConfigurationError(
      "Hub runtime config extensions are disabled because they could introduce an unreviewed execution surface",
    );
  }
  if (typeof safety.localRuntime.hooks.beforeTool !== "function") {
    throw new HubSafetyConfigurationError("Hub beforeTool owner safety gate is required");
  }

  const executorNames = Object.keys(safety.capabilities.toolExecutors ?? {}).sort();
  const expectedExecutorNames = [...OWNER_TARGETED_EXECUTOR_NAMES].sort();
  if (
    executorNames.length !== expectedExecutorNames.length ||
    executorNames.some((name, index) => name !== expectedExecutorNames[index])
  ) {
    throw new HubSafetyConfigurationError(
      "Hub capabilities must expose exactly the owner-targeted safe executor set",
    );
  }

  const wildcard = safety.toolPolicies["*"];
  if (!wildcard || wildcard.enabled !== false || wildcard.autoApprove !== false) {
    throw new HubSafetyConfigurationError("Hub tool policies must default deny");
  }

  for (const [toolName, policy] of Object.entries(safety.toolPolicies)) {
    if (toolName === "*") continue;
    const enabled = policy.enabled === true || policy.autoApprove === true;
    if (enabled && !OWNER_TARGETED_ENABLED_TOOL_NAMES.has(toolName)) {
      throw new HubSafetyConfigurationError(
        `Hub tool '${toolName}' is not admitted by the owner-targeted first-pilot boundary`,
      );
    }
  }
}

function readPathsFromSdkInput(input: unknown): string[] | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const record = input as Record<string, unknown>;
  const files = record.files;
  const values = Array.isArray(files) ? files : files !== undefined ? [files] : [];
  if (values.length === 0) return undefined;
  const paths = values.map((value) => {
    if (typeof value === "string") return value;
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const item = value as Record<string, unknown>;
    const candidate = item.path ?? item.file_path ?? item.filePath;
    return typeof candidate === "string" ? candidate : undefined;
  });
  return paths.every((value): value is string => typeof value === "string" && Boolean(value.trim())) ? paths : undefined;
}

function networkUrlsFromSdkInput(input: unknown): string[] {
  if (!input || typeof input !== "object" || Array.isArray(input)) return [];
  const requests = (input as Record<string, unknown>).requests;
  if (!Array.isArray(requests)) return [];
  return requests.flatMap((request) => {
    if (!request || typeof request !== "object" || Array.isArray(request)) return [];
    const url = (request as Record<string, unknown>).url;
    return typeof url === "string" ? [url] : [];
  });
}

type PatchPreviewChange = { type: unknown; movePath?: string };

async function previewPatchAction(patchText: string, workspaceRoot: string): Promise<ActionDescriptor> {
  const { changes } = await computePatchChanges(patchText, workspaceRoot);
  const paths: string[] = [];
  const operations: string[] = [];
  for (const [sourcePath, change] of Object.entries(changes as Record<string, PatchPreviewChange>)) {
    paths.push(sourcePath);
    operations.push(String(change.type));
    if (change.movePath) {
      paths.push(change.movePath);
      operations.push("move_destination");
    }
  }
  if (paths.length === 0) {
    return { kind: "unknown", toolName: "apply_patch", reason: "Patch preview did not identify any affected paths" };
  }
  return { kind: "patch", paths, operations };
}

async function actionFromHubTool(toolName: string, input: unknown, workspaceRoot: string): Promise<ActionDescriptor> {
  if (toolName === "read_files") {
    const paths = readPathsFromSdkInput(input);
    return paths?.length
      ? { kind: "read", paths }
      : { kind: "unknown", toolName, reason: "Malformed read_files payload" };
  }
  if (toolName === "apply_patch") {
    const patchText = input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>).input
      : undefined;
    if (typeof patchText !== "string" || !patchText.trim()) {
      return { kind: "unknown", toolName, reason: "Malformed apply_patch payload" };
    }
    try {
      return await previewPatchAction(patchText, workspaceRoot);
    } catch (error) {
      return {
        kind: "unknown",
        toolName,
        reason: `Patch preview failed closed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
  if (toolName === "fetch_web_content") {
    return { kind: "network", urls: networkUrlsFromSdkInput(input) };
  }
  return normalizeToolAction(toolName, input);
}

async function editorOperation(filePath: string): Promise<"create" | "modify"> {
  try {
    await lstat(filePath);
    return "modify";
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return "create";
    throw error;
  }
}

export function createHubSafetySessionContributions(
  task: OrchestratorTask,
  workspaceRoot: string,
  worker: WorkerConfig,
): HubSafetySessionContributions {
  assertFirstPilotWorkerSurface(worker);
  const binding = durableSafetyBindingFromTask(task);
  const policyContext: PreExecutionPolicyContext = { workspaceRoot, binding };
  const escalations = new HumanEscalationService(new TaskStore(workspaceRoot));
  const onEscalation = async (action: ActionDescriptor, reason: string) => {
    await escalations.request(task.id, action, reason);
  };
  const defaults = createDefaultExecutors();
  if (!defaults.readFile || !defaults.search || !defaults.editor || !defaults.applyPatch) {
    throw new HubSafetyConfigurationError("Pinned SDK did not expose all required first-pilot filesystem executors");
  }

  const readFile = defaults.readFile;
  const search = defaults.search;
  const editor = defaults.editor;
  const applyPatch = defaults.applyPatch;

  const capabilities: RuntimeCapabilities = {
    requestToolApproval: async (request: any) => ({
      approved: PILOT_TOOL_NAMES.has(String(request?.toolName ?? "")),
    }),
    toolExecutors: {
      readFile: async (request: any, context: any) => {
        const pathValue = typeof request?.path === "string" ? request.path : "";
        await enforceSafeAction({ kind: "read", paths: [pathValue] }, policyContext, onEscalation);
        return await readFile(request, context);
      },
      search: async (query: string, _cwd: string, context: any) => {
        await enforceSafeAction(
          { kind: "search", workspaceRoot, queries: [query] },
          policyContext,
          onEscalation,
        );
        return await search(query, workspaceRoot, context);
      },
      editor: async (input: any, _cwd: string, context: any) => {
        const pathValue = typeof input?.path === "string" ? input.path : "";
        let operation: "create" | "modify";
        try {
          operation = await editorOperation(pathValue);
        } catch (error) {
          throw new SafeExecutorError(
            `Editor path inspection failed closed: ${error instanceof Error ? error.message : String(error)}`,
            "DENY",
          );
        }
        await enforceSafeAction({ kind: "edit", paths: [pathValue], operation }, policyContext, onEscalation);
        return await editor(input, workspaceRoot, context);
      },
      applyPatch: async (input: any, _cwd: string, context: any) => {
        const patchText = typeof input?.input === "string" ? input.input : "";
        let action: ActionDescriptor;
        try {
          action = await previewPatchAction(patchText, workspaceRoot);
        } catch (error) {
          throw new SafeExecutorError(
            `Patch preview failed closed: ${error instanceof Error ? error.message : String(error)}`,
            "DENY",
          );
        }
        await enforceSafeAction(action, policyContext, onEscalation);
        return await applyPatch(input, workspaceRoot, context);
      },
    },
  };

  const safety: HubSafetySessionContributions = {
    localRuntime: {
      hooks: {
        beforeTool: async (context: any) => {
          const toolName = String(context?.toolCall?.toolName ?? context?.tool?.name ?? "");
          const action = await actionFromHubTool(toolName, context?.input, workspaceRoot);
          try {
            await enforceSafeAction(action, policyContext, onEscalation);
            return undefined;
          } catch (error) {
            if (error instanceof SafeExecutorError) {
              if (error.decision === "ESCALATE_AND_STOP") {
                return { stop: true, reason: error.message };
              }
              return { skip: true, reason: error.message };
            }
            return {
              stop: true,
              reason: `Hub beforeTool safety gate failed closed: ${error instanceof Error ? error.message : String(error)}`,
            };
          }
        },
      },
      configExtensions: [],
    },
    capabilities,
    toolPolicies: {
      "*": { enabled: false, autoApprove: false },
      read_files: { enabled: true, autoApprove: true },
      search_codebase: { enabled: true, autoApprove: true },
      editor: { enabled: true, autoApprove: true },
      apply_patch: { enabled: true, autoApprove: true },
      submit_and_exit: { enabled: true, autoApprove: true },
      run_commands: { enabled: false, autoApprove: false },
      fetch_web_content: { enabled: false, autoApprove: false },
      skills: { enabled: false, autoApprove: false },
      ask_question: { enabled: false, autoApprove: false },
    },
    configOverrides: {
      disableMcpSettingsTools: true,
      enableSpawnAgent: false,
      enableAgentTeams: false,
      pluginPaths: [],
      agentPluginPaths: [],
    },
  };

  assertOwnerTargetedHubSafetyBoundary(safety);
  return safety;
}
