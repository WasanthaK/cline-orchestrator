import path from "node:path";
import { pathToFileURL } from "node:url";
import { defaultContextRotateAtTokens } from "./context-supervisor.js";
import { type WorkerProfileResolver } from "./machine-orchestrator.js";
import { RestartAwareMachineOrchestratorService } from "./machine-recovery.js";
import {
  readMcpGatewayConfig,
  startMachineMcpHttpServer,
} from "./mcp-gateway.js";
import { localOperatorConfigFromEnvironment, startLocalOperatorControlServer } from "./local-operator-control.js";
import { SafetyPlanService } from "./safety-plan.js";
import type { ReasoningEffort, WorkerConfig } from "./types.js";
import { WorkspaceRegistry } from "./workspace-registry.js";

function readInt(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readReasoningEffort(): ReasoningEffort {
  const value = (process.env.ORCH_REASONING_EFFORT ?? "none").toLowerCase();
  if (["none", "low", "medium", "high", "xhigh"].includes(value)) {
    return value as ReasoningEffort;
  }
  return "none";
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export function gatewayWorkerConfigFromEnvironment(): WorkerConfig {
  const requestedProvider = process.env.ORCH_PROVIDER ?? "ollama-openai";
  const modelId = process.env.ORCH_MODEL ?? "qwen38-27b-192k:latest";
  const configuredBaseUrl = stripTrailingSlash(
    process.env.ORCH_BASE_URL ?? "http://localhost:11434",
  );
  const contextWindow = readInt("ORCH_CONTEXT_WINDOW", 196608);
  const maxInputTokens = readInt("ORCH_MAX_INPUT_TOKENS", 180000);
  const common = {
    modelId,
    contextWindow,
    maxInputTokens,
    maxTokensPerTurn: readInt(
      "ORCH_MAX_TOKENS_PER_TURN",
      readInt("ORCH_MAX_OUTPUT_TOKENS", 4096),
    ),
    contextRotateAtTokens: Math.max(
      0,
      readInt(
        "ORCH_CONTEXT_ROTATE_AT_TOKENS",
        defaultContextRotateAtTokens(contextWindow, maxInputTokens),
      ),
    ),
    maxContextRotations: Math.max(0, readInt("ORCH_MAX_CONTEXT_ROTATIONS", 8)),
    reasoningEffort: readReasoningEffort(),
    timeoutMs: readInt("ORCH_TIMEOUT_MS", 0),
    preflightTimeoutMs: Math.max(250, readInt("ORCH_PREFLIGHT_TIMEOUT_MS", 5000)),
    validationTimeoutMs: Math.max(1000, readInt("ORCH_VALIDATION_TIMEOUT_MS", 600000)),
    maxValidationOutputChars: Math.max(
      1000,
      readInt("ORCH_MAX_VALIDATION_OUTPUT_CHARS", 20000),
    ),
    maxValidationRepairs: Math.max(0, readInt("ORCH_MAX_VALIDATION_REPAIRS", 1)),
    checkpointMaxUntrackedFiles: Math.max(
      0,
      readInt("ORCH_CHECKPOINT_MAX_UNTRACKED_FILES", 10000),
    ),
    checkpointMaxUntrackedBytes: Math.max(
      0,
      readInt("ORCH_CHECKPOINT_MAX_UNTRACKED_BYTES", 268435456),
    ),
    maxIterations: readInt("ORCH_MAX_ITERATIONS", 0),
    stallTimeoutMs: readInt("ORCH_STALL_TIMEOUT_MS", 300000),
    maxRetries: Math.max(0, readInt("ORCH_MAX_RETRIES", 2)),
    retryDelayMs: Math.max(0, readInt("ORCH_RETRY_DELAY_MS", 5000)),
    autoApproveCommands: false,
    autoApproveEdits: false,
  };

  if (requestedProvider === "ollama-openai") {
    return {
      ...common,
      providerId: "openai-compatible",
      apiKey: process.env.ORCH_API_KEY || "ollama",
      baseUrl: configuredBaseUrl.endsWith("/v1")
        ? configuredBaseUrl
        : `${configuredBaseUrl}/v1`,
    };
  }

  return {
    ...common,
    providerId: requestedProvider,
    apiKey: process.env.ORCH_API_KEY,
    baseUrl: configuredBaseUrl,
  };
}

export function environmentWorkerProfileResolver(): WorkerProfileResolver {
  const configuredProfileId = (process.env.ORCH_WORKER_PROFILE_ID ?? "default").trim();
  const worker = gatewayWorkerConfigFromEnvironment();
  return (requestedProfileId) => {
    if (requestedProfileId !== configuredProfileId) {
      throw new Error(
        `Requested profile '${requestedProfileId}' is not the locally configured ORCH_WORKER_PROFILE_ID`,
      );
    }
    return worker;
  };
}

export function isDirectEntryPoint(
  moduleUrl: string,
  argv1: string | undefined,
  pathFlavor: "win32" | "posix" = process.platform === "win32" ? "win32" : "posix",
): boolean {
  if (!argv1) return false;
  const pathApi = pathFlavor === "win32" ? path.win32 : path.posix;
  const entryPath = pathApi.resolve(argv1);
  return pathToFileURL(entryPath, { windows: pathFlavor === "win32" }).href === moduleUrl;
}

async function main(): Promise<void> {
  const registry = new WorkspaceRegistry();
  const safetyPlans = new SafetyPlanService(registry);
  const service = new RestartAwareMachineOrchestratorService(
    registry,
    safetyPlans,
    environmentWorkerProfileResolver(),
  );
  const config = readMcpGatewayConfig();
  const operatorConfig = localOperatorConfigFromEnvironment();
  if (operatorConfig && operatorConfig.port === config.port && config.host !== "::1") {
    throw new Error("ORCH_OPERATOR_PORT must differ from the loopback MCP port");
  }
  const recovery = await service.recoverInterruptedTasks();
  const server = startMachineMcpHttpServer(service, config);
  const operatorServer = operatorConfig ? startLocalOperatorControlServer(service, operatorConfig) : undefined;

  if (recovery.scanned > 0) {
    process.stderr.write(
      `[cline-orchestrator MCP: restart reconciliation scanned=${recovery.scanned}; queued=${recovery.queued}; failedClosed=${recovery.failedClosed}]\n`,
    );
  }
  process.stderr.write(
    `[cline-orchestrator MCP: listening on ${config.host}:${config.port}${config.path}; tunnel=${config.tunnelPublicUrl ? "configured" : "not configured"}]\n`,
  );
  if (operatorConfig) process.stderr.write(`[cline-orchestrator operator: local control on ${operatorConfig.host}:${operatorConfig.port}/operator]\n`);

  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    process.stderr.write(`[cline-orchestrator MCP: shutting down after ${signal}]\n`);
    if (operatorServer) await new Promise<void>((resolve) => operatorServer.close(() => resolve()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await service.close();
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

if (isDirectEntryPoint(import.meta.url, process.argv[1])) {
  void main().catch((error) => {
    process.stderr.write(
      `[cline-orchestrator MCP fatal: ${error instanceof Error ? error.message : String(error)}]\n`,
    );
    process.exitCode = 1;
  });
}
