import { ClineCore } from "@cline/sdk";
import type { OrchestratorTask, WorkerConfig } from "./types.js";
import { TaskStore } from "./state.js";

export class ClineRunner {
  private readonly store: TaskStore;

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
      toolPolicies: {
        read_files: { autoApprove: true },
        search_codebase: { autoApprove: true },
        fetch_web_content: { autoApprove: true },
        run_commands: { autoApprove: this.worker.autoApproveCommands },
        apply_patch: { autoApprove: this.worker.autoApproveEdits },
        editor: { autoApprove: this.worker.autoApproveEdits },
      },
    });

    cline.subscribe((event: any) => {
      if (event?.type === "chunk" && event?.payload?.type === "text") {
        process.stdout.write(event.payload.text);
      }
      if (event?.type === "ended") {
        process.stdout.write(`\n[cline ended: ${event?.payload?.finishReason ?? "unknown"}]\n`);
      }
    });

    return cline;
  }

  private modelConfig() {
    return {
      providerId: this.worker.providerId,
      modelId: this.worker.modelId,
      apiKey: this.worker.apiKey ?? "",
      baseUrl: this.worker.baseUrl,
      cwd: this.workspace,
      workspaceRoot: this.workspace,
      enableTools: true,
      enableSpawnAgent: false,
      enableAgentTeams: false,
    };
  }

  async start(task: OrchestratorTask): Promise<OrchestratorTask> {
    const cline = await this.createCore();
    task.status = "running";
    task.lastPrompt = task.goal;
    await this.store.save(task);

    try {
      const session = await cline.start({
        prompt: task.goal,
        config: this.modelConfig(),
      });

      task.clineSessionId = session.sessionId;
      task.finishReason = session.result?.finishReason;
      task.status = session.result?.finishReason === "error" ? "failed" : "completed";
      await this.store.save(task);
      return task;
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
      throw new Error(`Task ${task.id} has no Cline session to resume.`);
    }

    const cline = await this.createCore();
    task.status = "running";
    task.lastPrompt = prompt;
    await this.store.save(task);

    try {
      const result = await cline.send({
        sessionId: task.clineSessionId,
        prompt,
      });

      task.finishReason = result.result?.finishReason;
      task.status = result.result?.finishReason === "error" ? "failed" : "completed";
      await this.store.save(task);
      return task;
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
