import type { ClineRuntime } from "./cline-runtime.js";

export type RecoverableClineRuntimeFailureKind =
  | "context_overflow"
  | "tool_arguments_invalid_json"
  | "tool_arguments_schema_invalid";

export interface RecoverableClineRuntimeFailure {
  kind: RecoverableClineRuntimeFailureKind;
  strategy: "replace_session" | "repair_same_session";
  requestedTokens?: number;
  availableTokens?: number;
}

export interface ClineRuntimeRecoveryOptions {
  maxToolProtocolRepairs?: number;
}

const DEFAULT_MAX_TOOL_PROTOCOL_REPAIRS = 2;
const MAX_TOOL_PROTOCOL_REPAIRS = 3;
const MAX_EVIDENCE_CHARS = 20_000;

export class ClineSessionReplacementRequiredError extends Error {
  readonly code = "session_not_found";
  readonly recoveryKind = "context_overflow";

  constructor(
    readonly sessionId: string,
    readonly requestedTokens?: number,
    readonly availableTokens?: number,
  ) {
    super(
      requestedTokens !== undefined && availableTokens !== undefined
        ? `Cline context overflow (${requestedTokens} > ${availableTokens} tokens); replace session ${sessionId}`
        : `Cline context overflow; replace session ${sessionId}`,
    );
    this.name = "ClineSessionReplacementRequiredError";
  }
}

function boundedText(value: string): string {
  return value.length <= MAX_EVIDENCE_CHARS
    ? value
    : value.slice(0, MAX_EVIDENCE_CHARS);
}

function collectFailureText(
  value: unknown,
  seen = new Set<unknown>(),
  depth = 0,
): string[] {
  if (depth > 4 || value === undefined || value === null || seen.has(value)) return [];
  if (typeof value === "string") return [boundedText(value)];
  if (value instanceof Error) {
    seen.add(value);
    return [
      boundedText(value.message),
      ...collectFailureText((value as Error & { cause?: unknown }).cause, seen, depth + 1),
    ];
  }
  if (typeof value !== "object" || Array.isArray(value)) return [];

  seen.add(value);
  const record = value as Record<string, unknown>;
  const fields = ["message", "code", "name", "error", "cause", "details", "reason"];
  return fields.flatMap((field) => collectFailureText(record[field], seen, depth + 1));
}

function numericToken(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

export function classifyRecoverableClineRuntimeFailure(
  error: unknown,
): RecoverableClineRuntimeFailure | undefined {
  const evidence = collectFailureText(error).join("\n");
  if (!evidence) return undefined;

  const exactOverflow = evidence.match(
    /request\s*\(\s*([\d,]+)\s*tokens?\s*\)\s*exceeds\s*the\s*available\s*context\s*size\s*\(\s*([\d,]+)\s*tokens?\s*\)/i,
  );
  if (exactOverflow) {
    return {
      kind: "context_overflow",
      strategy: "replace_session",
      requestedTokens: numericToken(exactOverflow[1]),
      availableTokens: numericToken(exactOverflow[2]),
    };
  }

  if (
    /context_length_exceeded/i.test(evidence)
    || /(?:maximum|available)\s+context\s+(?:length|size|window).*?(?:exceed|too\s+(?:large|long))/i.test(evidence)
    || /(?:context\s+(?:length|size|window)).*?(?:exceeded|too\s+(?:large|long))/i.test(evidence)
  ) {
    return { kind: "context_overflow", strategy: "replace_session" };
  }

  if (
    /tool\s+call.*?invalid\s+json\s+arguments/i.test(evidence)
    || /arguments?\s+could\s+not\s+be\s+parsed\s+as\s+json/i.test(evidence)
    || /invalid\s+json.*?(?:tool|arguments?)/i.test(evidence)
  ) {
    return {
      kind: "tool_arguments_invalid_json",
      strategy: "repair_same_session",
    };
  }

  const schemaFailure =
    /invalid\s+input\s*:\s*expected\b/i.test(evidence)
    || /expected\s+\w+(?:\s*\|\s*\w+)*\s*,\s*received\s+\w+/i.test(evidence);
  const toolFieldEvidence =
    /(?:\bat\s+path\b|\bnew_text\b|\bold_text\b|\bfile_path\b|\btool\s*call\b|\beditor\b|\barguments?\b)/i.test(evidence);
  if (schemaFailure && toolFieldEvidence) {
    return {
      kind: "tool_arguments_schema_invalid",
      strategy: "repair_same_session",
    };
  }

  return undefined;
}

export function buildToolProtocolRepairPrompt(
  failure: RecoverableClineRuntimeFailure,
): string {
  const problem = failure.kind === "tool_arguments_invalid_json"
    ? "invalid JSON tool arguments"
    : "tool arguments that failed input-schema validation";
  return [
    `The previous tool call was rejected before execution because it used ${problem}.`,
    "Treat that failed tool call as NOT executed.",
    "Reconstruct only the intended failed tool invocation from the existing task context and retry it with syntactically valid JSON and every required field using the correct type.",
    "Do not broaden scope, do not repeat earlier successful side effects, and do not invent a missing path/value.",
    "If any required argument cannot be determined confidently from the existing context, stop and explain what is missing instead of guessing.",
    "After the corrected tool call succeeds, continue the existing task within its already-approved scope.",
  ].join(" ");
}

function recoveryLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_MAX_TOOL_PROTOCOL_REPAIRS;
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_TOOL_PROTOCOL_REPAIRS) {
    throw new Error(`maxToolProtocolRepairs must be an integer between 0 and ${MAX_TOOL_PROTOCOL_REPAIRS}`);
  }
  return value;
}

function sessionIdFromSend(input: unknown): string | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const sessionId = (input as Record<string, unknown>).sessionId;
  return typeof sessionId === "string" && sessionId.trim() ? sessionId.trim() : undefined;
}

function repairInput(input: unknown, prompt: string): unknown | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const record = input as Record<string, unknown>;
  if (typeof record.sessionId !== "string" || !record.sessionId.trim()) return undefined;
  return { ...record, prompt };
}

function failedResultEvidence(result: unknown, observedAgentError: unknown): unknown {
  if (!result || typeof result !== "object" || Array.isArray(result)) return observedAgentError;
  const record = result as Record<string, unknown>;
  const finishReason = record.finishReason
    ?? (record.result && typeof record.result === "object" && !Array.isArray(record.result)
      ? (record.result as Record<string, unknown>).finishReason
      : undefined);
  if (finishReason === "completed" || finishReason === "aborted") return undefined;
  return record.error
    ?? (record.result && typeof record.result === "object" && !Array.isArray(record.result)
      ? (record.result as Record<string, unknown>).error
      : undefined)
    ?? observedAgentError;
}

/**
 * Decorates the pinned Cline runtime with narrowly bounded recovery for failures
 * that are known to occur before a write-capable tool executes.
 *
 * - malformed JSON / tool-schema input: retry in the SAME already-authorized
 *   session with a corrective prompt, at most two times by default;
 * - provider context overflow: abort the unusable physical session best-effort and
 *   emit the existing session-not-found signal so ClineRunner creates its durable
 *   context handoff and replacement session.
 *
 * It never retries command/edit execution failures, never expands task scope, and
 * never grants filesystem, Safety Plan, credential, network or release authority.
 */
export function createRecoveringClineRuntime(
  runtime: ClineRuntime,
  options: ClineRuntimeRecoveryOptions = {},
): ClineRuntime {
  const maxProtocolRepairs = recoveryLimit(options.maxToolProtocolRepairs);
  let observedAgentError: unknown;

  const trackingSubscription = runtime.subscribe((event: any) => {
    const agentEvent = event?.type === "agent_event" ? event?.payload?.event : undefined;
    if (agentEvent?.type === "error") {
      observedAgentError = agentEvent?.error ?? agentEvent?.message ?? agentEvent;
    }
  });

  const wrapped: ClineRuntime = {
    start: (input: unknown) => runtime.start(input),
    send: async (input: unknown) => {
      let currentInput = input;
      let repairsUsed = 0;

      while (true) {
        observedAgentError = undefined;
        try {
          const result = await runtime.send(currentInput);
          const resultEvidence = failedResultEvidence(result, observedAgentError);
          const resultFailure = classifyRecoverableClineRuntimeFailure(resultEvidence);
          if (!resultFailure) return result;
          throw Object.assign(new Error("Recoverable Cline runtime failure"), {
            recoveryEvidence: resultEvidence,
            recoveryDecision: resultFailure,
          });
        } catch (error) {
          const decorated = error as {
            recoveryEvidence?: unknown;
            recoveryDecision?: RecoverableClineRuntimeFailure;
          };
          const failure = decorated.recoveryDecision
            ?? classifyRecoverableClineRuntimeFailure(decorated.recoveryEvidence ?? error)
            ?? classifyRecoverableClineRuntimeFailure(observedAgentError);
          if (!failure) throw error;

          const sessionId = sessionIdFromSend(currentInput) ?? sessionIdFromSend(input);
          if (failure.strategy === "replace_session") {
            if (!sessionId) throw error;
            try {
              await runtime.abort(sessionId, new Error("orchestrator context overflow recovery"));
            } catch {
              // Replacement must not depend on a successful abort of the unusable session.
            }
            throw new ClineSessionReplacementRequiredError(
              sessionId,
              failure.requestedTokens,
              failure.availableTokens,
            );
          }

          if (repairsUsed >= maxProtocolRepairs) throw error;
          const nextInput = repairInput(input, buildToolProtocolRepairPrompt(failure));
          if (!nextInput) throw error;
          repairsUsed += 1;
          currentInput = nextInput;
          process.stdout.write(
            `\n[orchestrator runtime repair: kind=${failure.kind}; attempt=${repairsUsed}/${maxProtocolRepairs}]\n`,
          );
        }
      }
    },
    abort: (sessionId: string, reason?: Error) => runtime.abort(sessionId, reason),
    subscribe: (listener: (event: any) => void, subscribeOptions?: unknown) =>
      runtime.subscribe(listener, subscribeOptions),
    dispose: async (reason?: string) => {
      if (typeof trackingSubscription === "function") {
        try { trackingSubscription(); } catch { /* best-effort subscription cleanup */ }
      }
      await runtime.dispose(reason);
    },
  };

  if (typeof runtime.get === "function") {
    wrapped.get = (sessionId: string) => runtime.get!(sessionId);
  }

  return wrapped;
}
