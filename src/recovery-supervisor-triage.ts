/**
 * M19R1: pure, non-executing triage of trusted bounded Cline observations.
 * Never accepts prompts, source text, raw tool arguments or authority.
 */
export type RecoverySignal = "context_pressure" | "context_overflow" |
  "tool_protocol_failure" | "human_question" | "human_approval" |
  "watchdog_stall" | "repeated_attempt" | "validation_failure" | "unknown";
export type RecoveryAdvice = "prepare_context_handoff" | "replace_session" |
  "bounded_tool_repair" | "answer_from_verified_evidence" |
  "escalate_to_human" | "inspect_worker_activity" | "change_strategy_review" |
  "inspect_validation" | "observe_only";
export interface RecoveryObservationV1 {
  schemaVersion: 1;
  signal: RecoverySignal;
  taskStatus: "running" | "waiting_for_human" | "stalled" | "failed" | "unknown";
  attemptCount: number;
  priorFingerprint?: string;
  currentFingerprint?: string;
  validatedNoProgress?: boolean;
  humanApprovalRequired?: boolean;
  questionEvidenceVerified?: boolean;
  contextTokens?: number;
  contextThreshold?: number;
  hasActiveTool?: boolean;
}
export interface RecoveryTriageV1 {
  schemaVersion: 1;
  signal: RecoverySignal;
  advice: RecoveryAdvice;
  state: "review" | "needs_human" | "insufficient_evidence";
  repeatedWithoutProgress: boolean;
  skipExecutionPermitted: false;
  retryAuthorized: false;
  taskStarted: false;
  advisorContacted: false;
  grantsAuthority: false;
}
const digest = (s: unknown): s is string => typeof s === "string" && /^[0-9a-f]{64}$/.test(s);
const count = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0 && (n as number) <= 100000;
const signals: RecoverySignal[] = ["context_pressure","context_overflow","tool_protocol_failure","human_question","human_approval","watchdog_stall","repeated_attempt","validation_failure","unknown"];
export function triageRecovery(input: unknown): RecoveryTriageV1 {
  const v = input && typeof input === "object" ? input as Partial<RecoveryObservationV1> : {};
  const valid = v.schemaVersion === 1 && signals.includes(v.signal as RecoverySignal)
    && ["running","waiting_for_human","stalled","failed","unknown"].includes(v.taskStatus ?? "")
    && count(v.attemptCount);
  const signal: RecoverySignal = valid ? v.signal! : "unknown";
  const repeated = valid && signal === "repeated_attempt" && v.attemptCount! >= 2
    && digest(v.priorFingerprint) && v.priorFingerprint === v.currentFingerprint
    && v.validatedNoProgress === true;
  let advice: RecoveryAdvice = "observe_only";
  let state: RecoveryTriageV1["state"] = "insufficient_evidence";
  if (valid) {
    switch (signal) {
      case "context_pressure":
        if (count(v.contextTokens) && count(v.contextThreshold) &&
            v.contextThreshold! > 0 && v.contextTokens! >= v.contextThreshold!) {
          advice = "prepare_context_handoff"; state = "review";
        }
        break;
      case "context_overflow": advice = "replace_session"; state = "review"; break;
      case "tool_protocol_failure": advice = "bounded_tool_repair"; state = "review"; break;
      case "human_approval": advice = "escalate_to_human"; state = "needs_human"; break;
      case "human_question":
        advice = v.humanApprovalRequired === true || v.questionEvidenceVerified !== true
          ? "escalate_to_human" : "answer_from_verified_evidence";
        state = advice === "escalate_to_human" ? "needs_human" : "review"; break;
      case "watchdog_stall":
        advice = v.hasActiveTool === true ? "inspect_worker_activity" : "change_strategy_review";
        state = "review"; break;
      case "repeated_attempt":
        if (repeated) { advice = "change_strategy_review"; state = "review"; }
        break;
      case "validation_failure": advice = "inspect_validation"; state = "review"; break;
    }
  }
  return Object.freeze({schemaVersion:1,signal,advice,state,
    repeatedWithoutProgress:Boolean(repeated),skipExecutionPermitted:false,
    retryAuthorized:false,taskStarted:false,advisorContacted:false,grantsAuthority:false});
}
