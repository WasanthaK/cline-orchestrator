import { ClineCore } from "@cline/sdk";
import type { OrchestratorTask, TaskStatus, WorkerConfig } from "./types.js";
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

export class ClineRunner {
  private readonly store: TaskStore;
  private lastActivityAt = Date.now();
  private streamedText = "";
  private cline: any | undefined;

  constructor(
    private readonly workspace: string,
    private readonly worker: WorkerConfig,
  ) {
    this.store = new TaskStore(workspace);
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
          process.stdout.write(`\n[cline iteration started: ${agentEvent?.iteration ?? "?"}]\n`);
        } else if (type === "iteration_end") {
          process.stdout.write(
            `\n[cline iteration ended: ${agentEvent?.iteration ?? "?"}; tools=${agentEvent?.toolCallCount ?? "?"}]\n`,
          );
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
      process.stdout.write(`\n[orchestrator heartbeat: waiting; last Cline event ${silentForSeconds}s ago]\n`);
    }, 15000);
  }

  private statusFromFinishReason(finishReason: string | undefined): TaskStatus {
    if (finishReason === "completed") return "completed";
    if (finishReason === "aborted") return "aborted";
    return "failed";
  }

  private async applyResult(task: OrchestratorTask, result: any): Promise<OrchestratorTask> {
    task.finishReason = result?.finishReason;
    task.lastOutput = typeof result?.text === "string" ? result.text : undefined;
    task.status = this.statusFromFinishReason(task.finishReason);

    if (task.lastOutput && this.streamedText.trim().length === 0) {
      process.stdout.write(`\n${task.lastOutput}\n`);
    }

    process.stdout.write(`\n[cline result: ${task.finishReason ?? "unknown"}]\n`);
    await this.store.save(task);
    return task;
  }

  async start(task: OrchestratorTask): Promise<OrchestratorTask> {
    const cline = await this.getCore();
    this.streamedText = "";
    task.status = "running";
    task.lastPrompt = task.goal;
    task.error = undefined;
    await this.store.save(task);

    try {
      const session = await cline.start({
        config: this.modelConfig(),
        prompt: undefined,
        interactive: true,
        toolPolicies: this.toolPolicies(),
        capabilities: this.capabilities(),
      });

      task.clineSessionId = session.sessionId;
      await this.store.save(task);
      process.stdout.write(`[cline session: ${session.sessionId}]\n`);

      const heartbeat = this.startHeartbeat();
      try {
        const result = await cline.send({
          sessionId: session.sessionId,
          prompt: task.goal,
        });

        return await this.applyResult(task, result);
      } finally {
        clearInterval(heartbeat);
      }
    } catch (error) {
      task.status = "failed";
      task.error = error instanceof Error ? error.message : String(error);
      await this.store.save(task);
      throw error;
    }
  }

  async resume(task: OrchestratorTask, prompt: string): Promise<OrchestratorTask> {
    if (!task.clineSessionId) {
      throw new Error(
        `Task ${task.id} has no Cline session ID. It was created by an older/broken run and cannot be resumed. Start a new task.`,
      );
    }

    const cline = await this.getCore();
    this.streamedText = "";
    task.status = "running";
    task.lastPrompt = prompt;
    task.error = undefined;
    await this.store.save(task);

    try {
      const heartbeat = this.startHeartbeat();
      try {
        const result = await cline.send({
          sessionId: task.clineSessionId,
          prompt,
        });

        return await this.applyResult(task, result);
      } finally {
        clearInterval(heartbeat);
      }
    } catch (error) {
      task.status = "failed";
      task.error = error instanceof Error ? error.message : String(error);
      await this.store.save(task);
      throw error;
    }
  }
}
