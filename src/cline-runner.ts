import { ClineCore } from "@cline/sdk";
import {
  buildContextHandoffPrompt,
  createContextHandoff,
} from "./context-handoff.js";
import {
  ContextSupervisor,
  type ContextRotationDecision,
} from "./context-supervisor.js";
import type {
  OrchestratorTask,
  RunIterationMetrics,
  RunMetrics,
  SessionRecoveryReason,
  TaskStatus,
  WorkerConfig,
} from "./types.js";
import { TaskStore } from "./state.js";

const READ_TOOLS = new Set(["read_files", "search_codebase", "fetch_web_content"]);
const COMMAND_TOOLS = new Set(["run_commands", "execute_command"]);
const EDIT_TOOLS = new Set([
  "editor",
  "apply_patch",
  "replace_in_file",
  "write_to_file",
  "delete_file",
]);

class WatchdogStallError extends Error {
  readonly code = "watchdog_stall";

  constructor(
    readonly sessionId: string,
    readonly silenceMs: number,
  ) {
    super(`Cline produced no activity for ${silenceMs}ms; watchdog aborted session ${sessionId}`);
    this.name = "WatchdogStallError";
  }
}

class ContextRotationError extends Error {
  readonly code = "context_threshold";

  constructor(
    readonly sessionId: string,
    readonly inputTokens: number,
    readonly threshold: number,
  ) {
    super(
      `Cline request reached ${inputTokens} input tokens (rotation threshold ${threshold}); rotating session ${sessionId}`,
    );
    this.name = "ContextRotationError";
  }
}

class TaskStateError extends Error {
  readonly code = "invalid_task_state";

  constructor(message: string) {
    super(message);
    this.name = "TaskStateError";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ClineRunner {
  private readonly store: TaskStore;
  private readonly contextSupervisor: ContextSupervisor;
  private lastActivityAt = Date.now();
  private streamedText = "";
  private cline: any | undefined;
  private currentRunMetrics: RunMetrics | undefined;
  private currentIteration = 0;
  private currentAttempt = 0;
  private runStartedAtMs = 0;
  private activeTask: OrchestratorTask | undefined;
  private readonly abortRequestedTaskIds = new Set<string>();
  private requestContextRotation: ((decision: ContextRotationDecision) => void) | undefined;
  private contextRotationsUsedThisRun = 0;
  private contextRotationLimitNotified = false;

  constructor(
    private readonly workspace: string,
    private readonly worker: WorkerConfig,
  ) {
    this.store = new TaskStore(workspace);
    this.contextSupervisor = new ContextSupervisor(
      worker.maxContextRotations > 0 ? worker.contextRotateAtTokens : 0,
    );
  }

  private getTurn(iteration: number): RunIterationMetrics | undefined {
    if (!this.currentRunMetrics) return undefined;

    const attempt = this.currentAttempt > 0 ? this.currentAttempt : 1;
    let turn = this.currentRunMetrics.turns.find(
      (item) => (item.attempt ?? 1) === attempt && item.iteration === iteration,
    );
    if (!turn) {
      turn = {
        attempt,
        iteration,
        toolCalls: 0,
        inputTokens: 0,
        outputTokens: 0,
      };
      this.currentRunMetrics.turns.push(turn);
      this.currentRunMetrics.turns.sort(
        (a, b) => (a.attempt ?? 1) - (b.attempt ?? 1) || a.iteration - b.iteration,
      );
      this.currentRunMetrics.iterations = this.currentRunMetrics.turns.length;
    }

    return turn;
  }

  private refreshMetricTotals() {
    if (!this.currentRunMetrics) return;
    this.currentRunMetrics.iterations = this.currentRunMetrics.turns.length;
    this.currentRunMetrics.toolCalls = this.currentRunMetrics.turns.reduce(
      (sum, turn) => sum + turn.toolCalls,
      0,
    );
    this.currentRunMetrics.totalInputTokens = this.currentRunMetrics.turns.reduce(
      (sum, turn) => sum + turn.inputTokens,
      0,
    );
    this.currentRunMetrics.totalOutputTokens = this.currentRunMetrics.turns.reduce(
      (sum, turn) => sum + turn.outputTokens,
      0,
    );
  }

  private beginRun(task: OrchestratorTask, prompt: string) {
    this.streamedText = "";
    this.currentIteration = 0;
    this.currentAttempt = 0;
    this.contextSupervisor.reset();
    this.contextRotationsUsedThisRun = 0;
    this.contextRotationLimitNotified = false;
    this.runStartedAtMs = Date.now();
    this.currentRunMetrics = {
      startedAt: new Date(this.runStartedAtMs).toISOString(),
      iterations: 0,
      toolCalls: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      attempts: 0,
      retries: 0,
      stalls: 0,
      turns: [],
    };

    task.runCount = (task.runCount ?? 0) + 1;
    task.lastRunMetrics = this.currentRunMetrics;
    task.status = "running";
    task.lastPrompt = prompt;
    task.finishReason = undefined;
    task.error = undefined;
  }

  private finishRunMetrics(task: OrchestratorTask) {
    if (!this.currentRunMetrics) return;

    this.refreshMetricTotals();
    const completedAtMs = Date.now();
    this.currentRunMetrics.completedAt = new Date(completedAtMs).toISOString();
    this.currentRunMetrics.durationMs = completedAtMs - this.runStartedAtMs;
    task.lastRunMetrics = this.currentRunMetrics;

    process.stdout.write(
      `\n[cline run metrics: attempts=${this.currentRunMetrics.attempts ?? 1}; retries=${this.currentRunMetrics.retries ?? 0}; stalls=${this.currentRunMetrics.stalls ?? 0}; iterations=${this.currentRunMetrics.iterations}; tools=${this.currentRunMetrics.toolCalls}; input=${this.currentRunMetrics.totalInputTokens}; output=${this.currentRunMetrics.totalOutputTokens}; duration=${this.currentRunMetrics.durationMs}ms]\n`,
    );
  }

  private async getCore() {
    if (this.cline) return this.cline;

    const cline = await ClineCore.create({
      clientName: "cline-orchestrator",
      backendMode: "local",
    });

    cline.subscribe((event: any) => {
      this.lastActivityAt = Date.now();

      if (event?.type === "chunk") {
        if (event?.payload?.type === "text" && event?.payload?.text) {
          this.streamedText += event.payload.text;
          process.stdout.write(event.payload.text);
        } else if (event?.payload?.type === "reasoning") {
          process.stdout.write("\n[cline reasoning activity]\n");
        }
        return;
      }

      if (event?.type === "status") {
        process.stdout.write(`\n[cline status: ${event?.payload?.status ?? "unknown"}]\n`);
        return;
      }

      if (event?.type === "agent_event") {
        const agentEvent = event?.payload?.event;
        const type = agentEvent?.type;

        if (type === "iteration_start") {
          const iteration = Number(agentEvent?.iteration ?? 0);
          if (iteration > 0) {
            this.currentIteration = iteration;
            this.getTurn(iteration);
          }
          process.stdout.write(
            `\n[cline iteration started: ${agentEvent?.iteration ?? "?"}; attempt=${this.currentAttempt || 1}]\n`,
          );
        } else if (type === "iteration_end") {
          const iteration = Number(agentEvent?.iteration ?? this.currentIteration ?? 0);
          const toolCalls = Number(agentEvent?.toolCallCount ?? 0);
          if (iteration > 0) {
            const turn = this.getTurn(iteration);
            if (turn) turn.toolCalls = toolCalls;
            this.refreshMetricTotals();
          }
          process.stdout.write(
            `\n[cline iteration ended: ${agentEvent?.iteration ?? "?"}; tools=${agentEvent?.toolCallCount ?? "?"}; attempt=${this.currentAttempt || 1}]\n`,
          );

          const rotation = this.contextSupervisor.consumeAfterIteration(toolCalls);
          if (rotation && this.requestContextRotation) {
            if (this.contextRotationsUsedThisRun < this.worker.maxContextRotations) {
              const requestRotation = this.requestContextRotation;
              this.requestContextRotation = undefined;
              requestRotation(rotation);
            } else if (!this.contextRotationLimitNotified) {
              this.contextRotationLimitNotified = true;
              process.stdout.write(
                `\n[orchestrator context rotation limit reached: ${this.worker.maxContextRotations}; continuing current session]\n`,
              );
            }
          }
        } else if (type === "content_start") {
          const contentType = agentEvent?.contentType ?? "activity";
          const toolName = agentEvent?.toolName;

          if (contentType === "text" && agentEvent?.text) {
            this.streamedText += agentEvent.text;
            process.stdout.write(agentEvent.text);
          } else if (contentType === "reasoning") {
            process.stdout.write("\n[cline reasoning activity]\n");
          } else {
            process.stdout.write(
              `\n[cline content_start: ${contentType}${toolName ? `; tool=${toolName}` : ""}]\n`,
            );
          }
        } else if (type === "content_update") {
          const toolName = agentEvent?.toolName;
          if (toolName) {
            process.stdout.write(`\n[cline tool update: ${toolName}]\n`);
          }
        } else if (type === "content_end") {
          const contentType = agentEvent?.contentType ?? "activity";
          const toolName = agentEvent?.toolName;
          if (contentType === "tool") {
            process.stdout.write(
              `\n[cline tool finished: ${toolName ?? "unknown"}${agentEvent?.durationMs !== undefined ? `; ${agentEvent.durationMs}ms` : ""}]\n`,
            );
          }
        } else if (type === "usage") {
          const iteration = this.currentIteration > 0 ? this.currentIteration : 1;
          const turn = this.getTurn(iteration);
          const inputTokens = Number(agentEvent?.inputTokens ?? 0);
          const outputTokens = Number(agentEvent?.outputTokens ?? 0);
          if (turn) {
            turn.inputTokens += Number.isFinite(inputTokens) ? inputTokens : 0;
            turn.outputTokens += Number.isFinite(outputTokens) ? outputTokens : 0;
            this.refreshMetricTotals();
            if (this.contextSupervisor.observeTurnInput(turn.inputTokens)) {
              process.stdout.write(
                `\n[orchestrator context threshold observed: input=${turn.inputTokens}; threshold=${this.worker.contextRotateAtTokens}]\n`,
              );
            }
          }
          process.stdout.write(
            `\n[cline usage: input=${agentEvent?.inputTokens ?? "?"}, output=${agentEvent?.outputTokens ?? "?"}, totalIn=${agentEvent?.totalInputTokens ?? "?"}, totalOut=${agentEvent?.totalOutputTokens ?? "?"}]\n`,
          );
        } else if (type === "notice") {
          process.stdout.write(`\n[cline notice: ${agentEvent?.message ?? "unknown"}]\n`);
        } else if (type === "done") {
          process.stdout.write(`\n[cline agent done: ${agentEvent?.reason ?? "unknown"}]\n`);
        } else if (type === "error") {
          process.stdout.write(`\n[cline agent error: ${agentEvent?.error?.message ?? "unknown"}]\n`);
        }
        return;
      }

      if (event?.type === "hook") {
        process.stdout.write(`\n[cline tool hook: ${event?.payload?.toolName ?? event?.payload?.name ?? "unknown"}]\n`);
        return;
      }

      if (event?.type === "ended") {
        const finishReason =
          event?.payload?.finishReason ??
          event?.payload?.result?.finishReason ??
          event?.finishReason ??
          event?.result?.finishReason ??
          "unknown";
        process.stdout.write(`\n[cline ended: ${finishReason}]\n`);
      }
    });

    this.cline = cline;
    return cline;
  }

  async close(reason = "orchestrator shutdown"): Promise<void> {
    if (!this.cline) return;
    const cline = this.cline;
    this.cline = undefined;
    await cline.dispose(reason);
  }

  async abort(taskId: string, reason = "Task aborted by user"): Promise<OrchestratorTask> {
    const persisted = await this.store.load(taskId);
    if (
      persisted.status === "completed" ||
      persisted.status === "failed" ||
      persisted.status === "aborted"
    ) {
      throw new TaskStateError(`Task ${taskId} is already ${persisted.status}`);
    }

    const requestedAt = new Date().toISOString();
    const task = this.activeTask?.id === taskId ? this.activeTask : persisted;
    task.abortRequestedAt = requestedAt;
    task.abortReason = reason;
    this.abortRequestedTaskIds.add(taskId);

    await this.store.appendEvent(taskId, "abort_requested", {
      status: task.status,
      message: reason,
      data: {
        sessionId: task.clineSessionId,
        requestedAt,
      },
    });

    if (this.activeTask?.id === taskId && this.cline && task.clineSessionId) {
      try {
        await this.cline.abort(task.clineSessionId, new Error(reason));
      } catch (error) {
        if (!this.isSessionNotFound(error)) {
          process.stdout.write(
            `\n[orchestrator abort warning: ${error instanceof Error ? error.message : String(error)}]\n`,
          );
        }
      }
    }

    const latest = this.activeTask?.id === taskId ? this.activeTask : await this.store.load(taskId);
    if (latest.status === "completed" || latest.status === "failed") {
      this.abortRequestedTaskIds.delete(taskId);
      return latest;
    }

    latest.abortRequestedAt = requestedAt;
    latest.abortReason = reason;
    latest.status = "aborted";
    latest.finishReason = "aborted";
    latest.error = undefined;
    await this.store.save(latest);
    process.stdout.write(`\n[orchestrator task aborted: ${taskId}; reason=${reason}]\n`);
    return latest;
  }

  private modelConfig() {
    const capabilities: Array<"tools" | "streaming" | "reasoning" | "reasoning-effort"> = [
      "tools",
      "streaming",
      "reasoning",
      "reasoning-effort",
    ];

    return {
      providerId: this.worker.providerId,
      modelId: this.worker.modelId,
      apiKey: this.worker.apiKey ?? "",
      baseUrl: this.worker.baseUrl,
      cwd: this.workspace,
      workspaceRoot: this.workspace,
      knownModels: {
        [this.worker.modelId]: {
          id: this.worker.modelId,
          name: this.worker.modelId,
          contextWindow: this.worker.contextWindow,
          maxInputTokens: this.worker.maxInputTokens,
          maxTokens: this.worker.maxTokensPerTurn,
          capabilities,
        },
      },
      thinking: this.worker.reasoningEffort !== "none",
      reasoningEffort: this.worker.reasoningEffort,
      maxTokensPerTurn: this.worker.maxTokensPerTurn,
      ...(this.worker.timeoutMs > 0 ? { timeoutMs: this.worker.timeoutMs } : {}),
      ...(this.worker.maxIterations > 0 ? { maxIterations: this.worker.maxIterations } : {}),
      enableTools: true,
      enableSpawnAgent: false,
      enableAgentTeams: false,
    };
  }

  private toolPolicies() {
    return {
      "*": { autoApprove: false },
      read_files: { enabled: true, autoApprove: true },
      search_codebase: { enabled: true, autoApprove: true },
      fetch_web_content: { enabled: true, autoApprove: true },
      run_commands: {
        enabled: this.worker.autoApproveCommands,
        autoApprove: this.worker.autoApproveCommands,
      },
      execute_command: {
        enabled: this.worker.autoApproveCommands,
        autoApprove: this.worker.autoApproveCommands,
      },
      editor: {
        enabled: this.worker.autoApproveEdits,
        autoApprove: this.worker.autoApproveEdits,
      },
      apply_patch: {
        enabled: this.worker.autoApproveEdits,
        autoApprove: this.worker.autoApproveEdits,
      },
      replace_in_file: {
        enabled: this.worker.autoApproveEdits,
        autoApprove: this.worker.autoApproveEdits,
      },
      write_to_file: {
        enabled: this.worker.autoApproveEdits,
        autoApprove: this.worker.autoApproveEdits,
      },
      delete_file: {
        enabled: this.worker.autoApproveEdits,
        autoApprove: this.worker.autoApproveEdits,
      },
    };
  }

  private capabilities() {
    return {
      requestToolApproval: async (request: any) => {
        const toolName = String(request?.toolName ?? "");
        const approved =
          READ_TOOLS.has(toolName) ||
          (COMMAND_TOOLS.has(toolName) && this.worker.autoApproveCommands) ||
          (EDIT_TOOLS.has(toolName) && this.worker.autoApproveEdits);

        process.stdout.write(`\n[tool ${approved ? "approved" : "denied"}: ${toolName || "unknown"}]\n`);
        return { approved };
      },
    };
  }

  private startHeartbeat() {
    this.lastActivityAt = Date.now();
    return setInterval(() => {
      const silentForSeconds = Math.round((Date.now() - this.lastActivityAt) / 1000);
      process.stdout.write(
        `\n[orchestrator heartbeat: waiting; last Cline event ${silentForSeconds}s ago]\n`,
      );
    }, 15000);
  }

  private statusFromFinishReason(finishReason: string | undefined): TaskStatus {
    if (finishReason === "completed") return "completed";
    if (finishReason === "aborted") return "aborted";
    return "failed";
  }

  private async startInteractiveSession(cline: any) {
    return cline.start({
      config: this.modelConfig(),
      prompt: undefined,
      interactive: true,
      toolPolicies: this.toolPolicies(),
      capabilities: this.capabilities(),
    });
  }

  private isSessionNotFound(error: unknown): boolean {
    const value = error as any;
    return value?.code === "session_not_found" || value?.name === "SessionNotFoundError";
  }

  private isWatchdogStall(error: unknown): error is WatchdogStallError {
    return error instanceof WatchdogStallError || (error as any)?.code === "watchdog_stall";
  }

  private isContextRotation(error: unknown): error is ContextRotationError {
    return error instanceof ContextRotationError || (error as any)?.code === "context_threshold";
  }

  private async recoverSession(
    cline: any,
    task: OrchestratorTask,
    continuation: string,
    previousPrompt: string | undefined,
    previousOutput: string | undefined,
    previousSessionId: string | undefined,
    reason: SessionRecoveryReason,
  ): Promise<{ sessionId: string; prompt: string }> {
    const previousGeneration = task.sessionGeneration ?? (previousSessionId ? 1 : 0);
    const targetGeneration = previousGeneration + 1;
    const handoff = await createContextHandoff(this.workspace, task, {
      reason,
      pendingAction: continuation,
      previousPrompt,
      recentWorkerOutput: previousOutput,
      sourceSessionId: previousSessionId,
      targetGeneration,
    });

    task.contextHandoffCount = (task.contextHandoffCount ?? 0) + 1;
    task.lastContextHandoff = handoff.reference;
    await this.store.save(task);
    await this.store.appendEvent(task.id, "context_handoff_created", {
      status: task.status,
      message: `Created durable context handoff for session generation ${targetGeneration}`,
      data: {
        handoffId: handoff.reference.id,
        path: handoff.reference.relativePath,
        reason,
        sourceSessionId: previousSessionId,
        sourceGeneration: handoff.reference.sourceGeneration,
        targetGeneration,
      },
    });

    const session = await this.startInteractiveSession(cline);
    task.lastRecoveredFromSessionId = previousSessionId;
    task.clineSessionId = session.sessionId;
    task.sessionGeneration = targetGeneration;
    task.recoveryCount = (task.recoveryCount ?? 0) + 1;
    task.lastRecoveryAt = new Date().toISOString();
    task.lastRecoveryReason = reason;
    await this.store.save(task);

    process.stdout.write(
      `\n[cline session recovered: ${previousSessionId ?? "none"} -> ${session.sessionId}; generation=${task.sessionGeneration}; reason=${reason}; handoff=${handoff.reference.relativePath}]\n`,
    );

    return {
      sessionId: session.sessionId,
      prompt: buildContextHandoffPrompt(handoff.artifact, handoff.reference),
    };
  }

  private async recordContextRotation(task: OrchestratorTask, error: ContextRotationError) {
    this.contextRotationsUsedThisRun += 1;
    task.contextRotationCount = (task.contextRotationCount ?? 0) + 1;
    task.lastContextRotationAt = new Date().toISOString();
    task.lastContextRotationInputTokens = error.inputTokens;
    task.lastContextRotationThreshold = error.threshold;
    await this.store.save(task);
    await this.store.appendEvent(task.id, "context_rotating", {
      status: task.status,
      message: `Rotating Cline session after ${error.inputTokens} input tokens crossed threshold ${error.threshold}`,
      data: {
        inputTokens: error.inputTokens,
        threshold: error.threshold,
        rotationCount: task.contextRotationCount,
        runRotationCount: this.contextRotationsUsedThisRun,
        previousSessionId: error.sessionId,
      },
    });
    process.stdout.write(
      `\n[orchestrator context rotation: input=${error.inputTokens}; threshold=${error.threshold}; runRotation=${this.contextRotationsUsedThisRun}/${this.worker.maxContextRotations}]\n`,
    );
  }

  private async recordStall(task: OrchestratorTask, silenceMs: number) {
    task.status = "stalled";
    task.stallCount = (task.stallCount ?? 0) + 1;
    task.lastStallAt = new Date().toISOString();
    task.lastStallSilenceMs = silenceMs;
    if (this.currentRunMetrics) {
      this.currentRunMetrics.stalls = (this.currentRunMetrics.stalls ?? 0) + 1;
      task.lastRunMetrics = this.currentRunMetrics;
    }
    await this.store.save(task);
    process.stdout.write(
      `\n[orchestrator watchdog: stalled after ${silenceMs}ms without Cline activity]\n`,
    );
  }

  private async recordRetry(task: OrchestratorTask) {
    task.status = "running";
    task.retryCount = (task.retryCount ?? 0) + 1;
    task.lastRetryAt = new Date().toISOString();
    task.lastRetryReason = "watchdog_stall";
    if (this.currentRunMetrics) {
      this.currentRunMetrics.retries = (this.currentRunMetrics.retries ?? 0) + 1;
      task.lastRunMetrics = this.currentRunMetrics;
    }
    await this.store.save(task);
    process.stdout.write(
      `\n[orchestrator retry: ${task.retryCount}; reason=watchdog_stall; delay=${this.worker.retryDelayMs}ms]\n`,
    );
  }

  private async sendWithWatchdog(
    cline: any,
    task: OrchestratorTask,
    sessionId: string,
    prompt: string,
  ): Promise<any> {
    this.currentAttempt += 1;
    this.currentIteration = 0;
    if (this.currentRunMetrics) {
      this.currentRunMetrics.attempts = this.currentAttempt;
      task.lastRunMetrics = this.currentRunMetrics;
      await this.store.save(task);
    }

    if (this.abortRequestedTaskIds.has(task.id)) {
      throw new Error(task.abortReason ?? "Task aborted by user");
    }

    this.lastActivityAt = Date.now();
    const sendPromise: Promise<any> = cline.send({ sessionId, prompt });

    let rejectRotation: (error: ContextRotationError) => void = () => undefined;
    const rotationPromise = new Promise<never>((_, reject) => {
      rejectRotation = reject;
    });
    const requestRotation = (decision: ContextRotationDecision) => {
      rejectRotation(
        new ContextRotationError(sessionId, decision.inputTokens, decision.threshold),
      );
    };
    this.requestContextRotation = requestRotation;

    if (this.worker.stallTimeoutMs <= 0) {
      try {
        return await Promise.race([sendPromise, rotationPromise]);
      } finally {
        if (this.requestContextRotation === requestRotation) {
          this.requestContextRotation = undefined;
        }
      }
    }

    let triggered = false;
    let rejectWatchdog: (error: WatchdogStallError) => void = () => undefined;
    const watchdogPromise = new Promise<never>((_, reject) => {
      rejectWatchdog = reject;
    });
    const checkEveryMs = Math.max(1000, Math.min(15000, Math.floor(this.worker.stallTimeoutMs / 4)));

    const watchdog = setInterval(() => {
      if (triggered) return;
      const silenceMs = Date.now() - this.lastActivityAt;
      if (silenceMs < this.worker.stallTimeoutMs) return;

      triggered = true;
      void (async () => {
        await this.recordStall(task, silenceMs);
        try {
          await cline.abort(sessionId, new Error(`orchestrator watchdog stall after ${silenceMs}ms`));
        } catch (abortError) {
          process.stdout.write(
            `\n[orchestrator watchdog abort warning: ${abortError instanceof Error ? abortError.message : String(abortError)}]\n`,
          );
        } finally {
          rejectWatchdog(new WatchdogStallError(sessionId, silenceMs));
        }
      })();
    }, checkEveryMs);

    try {
      return await Promise.race([sendPromise, rotationPromise, watchdogPromise]);
    } finally {
      clearInterval(watchdog);
      if (this.requestContextRotation === requestRotation) {
        this.requestContextRotation = undefined;
      }
    }
  }

  private async executePrompt(
    cline: any,
    task: OrchestratorTask,
    prompt: string,
    initialSessionId: string | undefined,
    previousPrompt: string | undefined,
    previousOutput: string | undefined,
  ): Promise<any> {
    let currentSessionId = initialSessionId;
    let currentPrompt = prompt;
    let sessionNotFoundRecoveries = 0;
    let retriesUsed = 0;

    if (!currentSessionId) {
      const recovered = await this.recoverSession(
        cline,
        task,
        prompt,
        previousPrompt,
        previousOutput,
        currentSessionId,
        "missing_session_id",
      );
      currentSessionId = recovered.sessionId;
      currentPrompt = recovered.prompt;
      sessionNotFoundRecoveries = 1;
    }

    while (true) {
      try {
        return await this.sendWithWatchdog(cline, task, currentSessionId, currentPrompt);
      } catch (error) {
        if (this.abortRequestedTaskIds.has(task.id)) throw error;

        if (this.isContextRotation(error)) {
          await this.recordContextRotation(task, error);
          try {
            await cline.abort(
              currentSessionId,
              new Error(
                `orchestrator context rotation after ${error.inputTokens} input tokens`,
              ),
            );
          } catch (abortError) {
            if (!this.isSessionNotFound(abortError)) {
              process.stdout.write(
                `\n[orchestrator context abort warning: ${abortError instanceof Error ? abortError.message : String(abortError)}]\n`,
              );
            }
          }

          const partialOutput = this.streamedText.trim();
          const recoveryOutput = partialOutput
            ? `${previousOutput ?? ""}\n\nWorker output before context rotation:\n${partialOutput}`
            : previousOutput;
          const recovered = await this.recoverSession(
            cline,
            task,
            prompt,
            previousPrompt,
            recoveryOutput,
            currentSessionId,
            "context_threshold",
          );
          currentSessionId = recovered.sessionId;
          currentPrompt = recovered.prompt;
          continue;
        }

        if (this.isSessionNotFound(error)) {
          if (sessionNotFoundRecoveries >= 1) throw error;
          sessionNotFoundRecoveries += 1;
          const recovered = await this.recoverSession(
            cline,
            task,
            prompt,
            previousPrompt,
            previousOutput,
            currentSessionId,
            "session_not_found",
          );
          currentSessionId = recovered.sessionId;
          currentPrompt = recovered.prompt;
          continue;
        }

        if (this.isWatchdogStall(error)) {
          if (retriesUsed >= this.worker.maxRetries) throw error;
          retriesUsed += 1;
          await this.recordRetry(task);
          if (this.worker.retryDelayMs > 0) {
            await sleep(this.worker.retryDelayMs);
          }
          if (this.abortRequestedTaskIds.has(task.id)) throw error;

          const partialOutput = this.streamedText.trim();
          const recoveryOutput = partialOutput
            ? `${previousOutput ?? ""}\n\nPartial output from interrupted attempt:\n${partialOutput}`
            : previousOutput;
          const recovered = await this.recoverSession(
            cline,
            task,
            prompt,
            previousPrompt,
            recoveryOutput,
            currentSessionId,
            "watchdog_stall",
          );
          currentSessionId = recovered.sessionId;
          currentPrompt = recovered.prompt;
          continue;
        }

        throw error;
      }
    }
  }

  private async applyResult(task: OrchestratorTask, result: any): Promise<OrchestratorTask> {
    task.finishReason = result?.finishReason;
    task.lastOutput = typeof result?.text === "string" ? result.text : undefined;
    task.status = this.statusFromFinishReason(task.finishReason);
    this.finishRunMetrics(task);

    if (task.lastOutput && this.streamedText.trim().length === 0) {
      process.stdout.write(`\n${task.lastOutput}\n`);
    }

    process.stdout.write(`\n[cline result: ${task.finishReason ?? "unknown"}]\n`);
    await this.store.save(task);
    return task;
  }

  async start(task: OrchestratorTask): Promise<OrchestratorTask> {
    const persisted = await this.store.load(task.id);
    if (persisted.status === "aborted") {
      this.abortRequestedTaskIds.delete(task.id);
      return persisted;
    }
    task = persisted;
    this.activeTask = task;

    try {
      const cline = await this.getCore();
      this.beginRun(task, task.goal);
      await this.store.save(task);

      try {
        const session = await this.startInteractiveSession(cline);
        task.clineSessionId = session.sessionId;
        task.sessionGeneration = (task.sessionGeneration ?? 0) + 1;
        await this.store.save(task);
        process.stdout.write(
          `[cline session: ${session.sessionId}; generation=${task.sessionGeneration}]\n`,
        );

        const heartbeat = this.startHeartbeat();
        try {
          const result = await this.executePrompt(
            cline,
            task,
            task.goal,
            session.sessionId,
            undefined,
            undefined,
          );
          return await this.applyResult(task, result);
        } finally {
          clearInterval(heartbeat);
        }
      } catch (error) {
        if (this.abortRequestedTaskIds.has(task.id) || task.status === "aborted") {
          task.status = "aborted";
          task.finishReason = "aborted";
          task.error = undefined;
          this.finishRunMetrics(task);
          await this.store.save(task);
          return task;
        }

        task.status = "failed";
        task.error = error instanceof Error ? error.message : String(error);
        this.finishRunMetrics(task);
        await this.store.save(task);
        throw error;
      }
    } finally {
      if (this.activeTask?.id === task.id) this.activeTask = undefined;
      this.abortRequestedTaskIds.delete(task.id);
    }
  }

  async resume(task: OrchestratorTask, prompt: string): Promise<OrchestratorTask> {
    const persisted = await this.store.load(task.id);
    if (persisted.status === "aborted") {
      this.abortRequestedTaskIds.delete(task.id);
      return persisted;
    }
    task = persisted;
    this.activeTask = task;

    const previousPrompt = task.lastPrompt;
    const previousOutput = task.lastOutput;
    const previousSessionId = task.clineSessionId;

    try {
      const cline = await this.getCore();
      this.beginRun(task, prompt);
      await this.store.save(task);

      try {
        const heartbeat = this.startHeartbeat();
        try {
          const result = await this.executePrompt(
            cline,
            task,
            prompt,
            previousSessionId,
            previousPrompt,
            previousOutput,
          );
          return await this.applyResult(task, result);
        } finally {
          clearInterval(heartbeat);
        }
      } catch (error) {
        if (this.abortRequestedTaskIds.has(task.id) || task.status === "aborted") {
          task.status = "aborted";
          task.finishReason = "aborted";
          task.error = undefined;
          this.finishRunMetrics(task);
          await this.store.save(task);
          return task;
        }

        task.status = "failed";
        task.error = error instanceof Error ? error.message : String(error);
        this.finishRunMetrics(task);
        await this.store.save(task);
        throw error;
      }
    } finally {
      if (this.activeTask?.id === task.id) this.activeTask = undefined;
      this.abortRequestedTaskIds.delete(task.id);
    }
  }
}
