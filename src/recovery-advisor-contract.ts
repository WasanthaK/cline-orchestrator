/**
 * M19R3A: pure advisor payload/response admission, with no outbound transport.
 * A model suggestion can never create task or safety authority.
 */
export const ADVISOR_CONTRACT = Object.freeze({
  schemaVersion: 1 as const, requiresExplicitOptIn: true as const,
  networkCalls: false as const, canExecuteRecovery: false as const,
  grantsAuthority: false as const,
});
export type AdvisorAction = "inspect_evidence" | "prepare_context_handoff" |
  "suggest_strategy_change" | "escalate_to_human" | "observe_only";
export interface AdvisorRequestV1 {
  schemaVersion: 1;
  incidentId: string;
  taskStatus: "running" | "waiting_for_human" | "stalled" | "failed" | "unknown";
  signal: "context_pressure" | "context_overflow" | "tool_protocol_failure" |
    "human_question" | "human_approval" | "watchdog_stall" |
    "repeated_attempt" | "validation_failure" | "unknown";
  attempts: number;
  consent: true;
  evidenceOnly: true;
}
export interface AdvisorDecisionV1 {
  schemaVersion: 1;
  decision: AdvisorAction;
  confidence: "low" | "medium" | "high";
  state: "review_required";
  advisorContacted: false;
  skipExecutionPermitted: false;
  retryAuthorized: false;
  grantsAuthority: false;
}
const digest = (s: unknown): s is string => typeof s === "string" && /^[a-f0-9]{64}$/.test(s);
const actions: AdvisorAction[] = ["inspect_evidence","prepare_context_handoff",
  "suggest_strategy_change","escalate_to_human","observe_only"];
const signals: AdvisorRequestV1["signal"][] = [
  "context_pressure","context_overflow","tool_protocol_failure","human_question",
  "human_approval","watchdog_stall","repeated_attempt","validation_failure","unknown"];
const statuses: AdvisorRequestV1["taskStatus"][] =
  ["running","waiting_for_human","stalled","failed","unknown"];
export function validateAdvisorRequest(raw: unknown): AdvisorRequestV1 | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const v=raw as Record<string,unknown>;
  if (Object.keys(v).sort().join(",") !== "attempts,consent,evidenceOnly,incidentId,schemaVersion,signal,taskStatus"
    || v.schemaVersion!==1 || !digest(v.incidentId)
    || !signals.includes(v.signal as AdvisorRequestV1["signal"])
    || !statuses.includes(v.taskStatus as AdvisorRequestV1["taskStatus"])
    || !Number.isSafeInteger(v.attempts) || (v.attempts as number)<0 || (v.attempts as number)>100000
    || v.consent!==true || v.evidenceOnly!==true) return undefined;
  return Object.freeze({...v}) as unknown as AdvisorRequestV1;
}
export function validateAdvisorSuggestion(raw: unknown): AdvisorDecisionV1 | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const v=raw as Record<string,unknown>;
  if (Object.keys(v).sort().join(",") !== "confidence,decision,schemaVersion"
    || v.schemaVersion!==1 || !actions.includes(v.decision as AdvisorAction)
    || !["low","medium","high"].includes(String(v.confidence))) return undefined;
  return Object.freeze({schemaVersion:1,decision:v.decision as AdvisorAction,
    confidence:v.confidence as AdvisorDecisionV1["confidence"],
    state:"review_required",advisorContacted:false,
    skipExecutionPermitted:false,retryAuthorized:false,grantsAuthority:false});
}
