import { ClineCore } from "@cline/sdk";
import type { OrchestratorTask, WorkerConfig } from "./types.js";
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

  constructor(
    private readonly workspace: string,
    private readonly worker: WorkerConfig,
  ) {
    this.store = new TaskStore(workspace);
  }

  private async createCore() {
    const cline = await ClineCore.create({
      clientName: "cline-orchestrator",
      backendMode: "local",
    });

    cline.subscribe((event: any) => {
      this.lastActivityAt = Date.now();

      if (event?.type === "chunk") {
        if (event?.payload?.type === "text") {
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
          const iteration = agentEvent?.iteration ?? agentEvent?.index;
          process.stdout.write(`\n[cline iteration started${iteration !== undefined ? `: ${iteration}` : ""}]\n`);
        } else if (type === "content_start") {
          const content = agentEvent?.content ?? agentEvent?.part ?? agentEvent?.data;
          const contentType = content?.type ?? agentEvent?.contentType ?? "activity";
          const toolName =
            content?.toolName ??
            content?.name ??
            content?.tool?.name ??
            agentEvent?.toolName;
          process.stdout.write(
            `\n[cline content_start: ${contentType}${toolName ? `; tool=${toolName}` : ""}]\n`,
          );
        } else if (type === "content_update") {
          const content = agentEvent?.content ?? agentEvent?.part ?? agentEvent?.data;
          const toolName = content?.toolName ?? content?.name ?? agentEvent?.toolName;
          if (toolName) {
            process.stdout.write(`\n[cline tool update: ${toolName}]\n`);
          }
        } else if (type === "content_end") {
          const content = agentEvent?.content ?? agentEvent?.part ?? agentEvent?.data;
          const contentType = content?.type ?? agentEvent?.contentType ?? "activity";
          const toolName = content?.toolName ?? content?.name ?? agentEvent?.toolName;
          process.stdout.write(
            `\n[cline content_end: ${contentType}${toolName ? `; tool=${toolName}` : ""}]\n`,
          );
        } else if (type === "usage") {
          const usage = agentEvent?.usage ?? agentEvent?.data?.usage;
          const input = usage?.inputTokens ?? usage?.input_tokens;
          const output = usage?.outputTokens ?? usage?.output_tokens;
          process.stdout.write(
            `\n[cline usage${input !== undefined || output !== undefined ? `: input=${input ?? "?"}, output=${output ?? "?"}` : " updated"}]\n`,
          );
        } else if (type === "error") {
          process.stdout.write(`\n[cline agent error: ${agentEvent?.error?.message ?? agentEvent?.message ?? "unknown"}]\n`);
        }
        return;
      }

      if (event?.type === "hook") {
        process.stdout.write(`\n[cline tool hook: ${event?.payload?.toolName ?? event?.payload?.name ?? "unknown"}]\n`);
        return;
      }

      if (event?.type === "ended") {
        process.stdout.write(`\n[cline ended: ${event?.payload?.finishReason ?? "unknown"}]\n`);
      }
    });

    return cline;
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

  async start(task: OrchestratorTask): Promise<OrchestratorTask> {
    const cline = await this.createCore();
    task.status = "running";
    task.lastPrompt = task.goal;
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

        task.finishReason = result?.finishReason;
        task.status = result?.finishReason === "error" ? "failed" : "completed";
        await this.store.save(task);
        return task;
      } finally {
        clearInterval(heartbeat);
      }
    } catch (error) {
      task.status = "failed";
      task.error = error instanceof Error ? error.message : String(error);
      await this.store.save(task);
      throw error;
    } finally {
      await cline.dispose("orchestrator run finished");
    }
  }

  async resume(task: OrchestratorTask, prompt: string): Promise<OrchestratorTask> {
    if (!task.clineSessionId) {
      throw new Error(
        `Task ${task.id} has no Cline session ID. It was created by an older/broken run and cannot be resumed. Start a new task.`,
      );
    }

    const cline = await this.createCore();
    task.status = "running";
    task.lastPrompt = prompt;
    await this.store.save(task);

    try {
      const heartbeat = this.startHeartbeat();
      try {
        const result = await cline.send({
          sessionId: task.clineSessionId,
          prompt,
        });

        task.finishReason = result?.finishReason;
        task.status = result?.finishReason === "error" ? "failed" : "completed";
        await this.store.save(task);
        return task;
      } finally {
        clearInterval(heartbeat);
      }
    } catch (error) {
      task.status = "failed";
      task.error = error instanceof Error ? error.message : String(error);
      await this.store.save(task);
      throw error;
    } finally {
      await cline.dispose("orchestrator resume finished");
    }
  }
}
