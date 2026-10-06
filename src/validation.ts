import { spawn } from "node:child_process";
import type {
  OrchestratorTask,
  ValidationCommandResult,
  ValidationRun,
} from "./types.js";

export interface ValidationOptions {
  timeoutMs: number;
  maxOutputChars: number;
  signal?: AbortSignal;
}

function appendLimited(
  current: string,
  chunk: Buffer | string,
  maxChars: number,
): { value: string; truncated: boolean } {
  if (current.length >= maxChars) return { value: current, truncated: true };
  const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
  const remaining = Math.max(0, maxChars - current.length);
  if (text.length <= remaining) return { value: current + text, truncated: false };
  return { value: current + text.slice(0, remaining), truncated: true };
}

function clipped(value: string | undefined, maxChars: number): string {
  if (!value) return "(none)";
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n...[truncated by orchestrator]`;
}

export function failedValidationResult(
  validation: ValidationRun,
): ValidationCommandResult | undefined {
  return validation.results.find(
    (result) => result.aborted || result.timedOut || result.exitCode !== 0,
  );
}

export function validationFailureMessage(validation: ValidationRun): string {
  const failed = failedValidationResult(validation);
  if (!failed) return "Validation did not complete all requested commands";
  if (failed.aborted) return `Validation aborted while running: ${failed.command}`;
  if (failed.timedOut) return `Validation timed out while running: ${failed.command}`;
  return `Validation command failed with exit code ${failed.exitCode ?? "unknown"}: ${failed.command}`;
}

export function buildValidationRepairPrompt(
  task: OrchestratorTask,
  validation: ValidationRun,
): string {
  const failed = failedValidationResult(validation);
  const criteria = task.acceptanceCriteria?.length
    ? task.acceptanceCriteria.map((item, index) => `${index + 1}. ${item}`).join("\n")
    : "(none supplied)";

  const failureDetails = failed
    ? `Command: ${failed.command}\nExit code: ${failed.exitCode ?? "unknown"}\nTimed out: ${failed.timedOut ? "yes" : "no"}\nStdout:\n${clipped(failed.stdout, 6000)}\n\nStderr:\n${clipped(failed.stderr, 6000)}`
    : "The validation sequence did not complete all requested commands.";

  return `You are repairing an orchestrated coding task because its explicit validation gate failed.

Work from the current workspace state. Preserve existing valid work and do not revert or rewrite unrelated changes. Make the smallest change needed to address the validation failure.

Original task goal:
${clipped(task.goal, 6000)}

Acceptance criteria:
${clipped(criteria, 6000)}

Validation failure:
${failureDetails}

The orchestrator will rerun the configured validation commands after your repair. Re-inspect relevant files and failure output, make the necessary fix, and then report completion.`;
}

export async function runValidationCommand(
  workspace: string,
  command: string,
  options: ValidationOptions,
): Promise<ValidationCommandResult> {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  let stdout = "";
  let stderr = "";
  let outputTruncated = false;
  let timedOut = false;
  let aborted = false;

  return await new Promise<ValidationCommandResult>((resolve) => {
    let settled = false;
    const child = spawn(command, {
      cwd: workspace,
      shell: true,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const finish = (exitCode?: number, signal?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", onAbort);
      const completedAt = new Date().toISOString();
      resolve({
        command,
        startedAt,
        completedAt,
        durationMs: Date.now() - startedMs,
        exitCode,
        signal,
        timedOut,
        aborted,
        stdout,
        stderr,
        ...(outputTruncated ? { outputTruncated: true } : {}),
      });
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      const next = appendLimited(stdout, chunk, options.maxOutputChars);
      stdout = next.value;
      outputTruncated ||= next.truncated;
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      const next = appendLimited(stderr, chunk, options.maxOutputChars);
      stderr = next.value;
      outputTruncated ||= next.truncated;
    });

    child.once("error", (error) => {
      const next = appendLimited(stderr, error.message, options.maxOutputChars);
      stderr = next.value;
      outputTruncated ||= next.truncated;
      finish();
    });
    child.once("close", (code, signal) => {
      finish(code ?? undefined, signal ?? undefined);
    });

    const onAbort = () => {
      aborted = true;
      child.kill();
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });
    if (options.signal?.aborted) onAbort();

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, Math.max(1, options.timeoutMs));
  });
}

export async function runValidationCommands(
  workspace: string,
  commands: string[],
  options: ValidationOptions,
): Promise<ValidationRun> {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const results: ValidationCommandResult[] = [];

  for (const command of commands) {
    if (options.signal?.aborted) break;
    const result = await runValidationCommand(workspace, command, options);
    results.push(result);
    if (result.aborted || result.timedOut || result.exitCode !== 0) {
      break;
    }
  }

  const passed =
    results.length === commands.length &&
    results.every((result) => !result.aborted && !result.timedOut && result.exitCode === 0);

  return {
    startedAt,
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - startedMs,
    passed,
    commandsRequested: commands.length,
    commandsRun: results.length,
    results,
  };
}
