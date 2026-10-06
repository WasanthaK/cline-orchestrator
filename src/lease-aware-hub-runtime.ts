import path from "node:path";
import type {
  ClineRuntime,
  ClineRuntimeCreateRequest,
  ClineRuntimeFactory,
} from "./cline-runtime.js";
import {
  createLeaseAwareHubSafetySessionContributions,
  type LeaseAwareHubSafetyOptions,
} from "./lease-aware-hub-safety-runtime.js";
import type { OrchestratorTask, WorkerConfig } from "./types.js";

export class LeaseAwareHubRuntimeError extends Error {
  readonly code = "lease_aware_hub_runtime_invalid";

  constructor(message: string) {
    super(message);
    this.name = "LeaseAwareHubRuntimeError";
  }
}

function normalizePath(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function inputObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LeaseAwareHubRuntimeError("Cline session start payload must be an object");
  }
  return value as Record<string, unknown>;
}

/**
 * Per-task runtime factory used by the scheduled writer path.
 *
 * ClineRunner still owns the session lifecycle, context rotation and recovery. This
 * wrapper only replaces the Hub start-time safety contributions with the reviewed
 * lease-aware variant. It cannot turn a local runtime into Hub mode and it cannot
 * redirect the task to another workspace.
 */
export class LeaseAwareHubRuntimeFactory implements ClineRuntimeFactory {
  constructor(
    private readonly baseFactory: ClineRuntimeFactory,
    private readonly task: OrchestratorTask,
    private readonly worker: WorkerConfig,
    private readonly safetyOptions: LeaseAwareHubSafetyOptions,
  ) {}

  async create(request: ClineRuntimeCreateRequest): Promise<ClineRuntime> {
    if (request.mode !== "hub") {
      throw new LeaseAwareHubRuntimeError("Scheduled write runtime requires Hub mode");
    }
    if (normalizePath(request.workspaceRoot) !== normalizePath(this.task.workspace)) {
      throw new LeaseAwareHubRuntimeError(
        "Scheduled write runtime workspace does not match the approved task workspace",
      );
    }

    const runtime = await this.baseFactory.create(request);
    return new LeaseAwareHubRuntime(
      runtime,
      this.task,
      request.workspaceRoot,
      this.worker,
      this.safetyOptions,
    );
  }
}

class LeaseAwareHubRuntime implements ClineRuntime {
  constructor(
    private readonly base: ClineRuntime,
    private readonly task: OrchestratorTask,
    private readonly workspaceRoot: string,
    private readonly worker: WorkerConfig,
    private readonly safetyOptions: LeaseAwareHubSafetyOptions,
  ) {}

  async start(input: unknown): Promise<any> {
    const original = inputObject(input);
    const safety = createLeaseAwareHubSafetySessionContributions(
      this.task,
      this.workspaceRoot,
      this.worker,
      this.safetyOptions,
    );
    const rawConfig = original.config;
    const config = rawConfig && typeof rawConfig === "object" && !Array.isArray(rawConfig)
      ? { ...(rawConfig as Record<string, unknown>), ...safety.configOverrides }
      : { ...safety.configOverrides };

    return await this.base.start({
      ...original,
      config,
      toolPolicies: safety.toolPolicies,
      capabilities: safety.capabilities,
      localRuntime: safety.localRuntime,
    });
  }

  async send(input: unknown): Promise<any> {
    return await this.base.send(input);
  }

  async abort(sessionId: string, reason?: Error): Promise<any> {
    return await this.base.abort(sessionId, reason);
  }

  subscribe(listener: (event: any) => void, options?: unknown): unknown {
    return this.base.subscribe(listener, options);
  }

  async get(sessionId: string): Promise<any> {
    if (typeof this.base.get !== "function") {
      throw new LeaseAwareHubRuntimeError("Wrapped Hub runtime does not expose session lookup");
    }
    return await this.base.get(sessionId);
  }

  async dispose(reason?: string): Promise<void> {
    await this.base.dispose(reason);
  }
}
