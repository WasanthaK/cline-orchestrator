/**
 * M19R3E: human-centered standing consent classification (no network or grants).
 *
 * The operator opts in once for a project and duration. An authorized host
 * must retrieve and verify this exact policy afresh for every consultation,
 * then use M19R3C for an independent, one-shot durable budget reservation.
 * Policy evaluation is NEVER a substitute for the durable admission gate.
 */
export type AdvisorPolicyMode = "off" | "ask_before_consulting" | "automatic_advice";
export type AutoAdvisorSignal = "context_pressure" | "watchdog_stall" |
  "validation_failure" | "repeated_attempt";
export interface AdvisorStandingPolicyV1 {
  schemaVersion: 1;
  source: "operator_approved_settings";
  projectId: string;
  mode: AdvisorPolicyMode;
  destination: "openai_responses_api";
  disclosure: "incident_metadata_only";
  approvedAtMs: number;
  expiresAtMs: number;
  /** Exact operator consent revision, not a password or authentication token. */
  revision: string;
  allowedSignals: AutoAdvisorSignal[];
  maxEstimatedCentsPerIncident: number;
  operatorAcknowledgedExternalTransfer: true;
}
export interface AdvisorPolicyIncidentV1 {
  schemaVersion: 1;
  source: "trusted_task_store";
  projectId: string;
  incidentId: string;
  state: "open";
  signal: AutoAdvisorSignal | "human_approval" | "human_question" | "unknown";
  observedAtMs: number;
  estimatedCents: number;
  disclosure: "incident_metadata_only";
}
export interface AdvisorPolicyDecisionV1 {
  schemaVersion: 1;
  decision: "automatic_advice_eligible" | "notify_operator" | "disabled" |
    "insufficient_evidence";
  reason: "within_preapproved_scope" | "operator_review_mode" | "human_decision" |
    "outside_approved_scope" | "budget_review" | "consent_expired" |
    "consent_disabled" | "invalid_policy_or_evidence";
  metadataOnly: true;
  reviewBeforeExecution: true;
  /** An eligibility decision cannot issue or spend a durable grant. */
  admissionReserved: false;
  contactedAdvisor: false;
  grantsAuthority: false;
  canExecuteRecovery: false;
}
export const ADVISOR_STANDING_POLICY_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  defaultMode: "off" as const,
  defaultDisclosure: "incident_metadata_only" as const,
  requiresOperatorOnboarding: true as const,
  requiresDurableAdmissionPerIncident: true as const,
  connectedToRuntime: false as const,
  networkCalls: false as const,
  grantsAuthority: false as const,
});
const safeId = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const digest = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
const integer = (v: unknown, low: number, high: number): v is number =>
  Number.isSafeInteger(v) && (v as number) >= low && (v as number) <= high;
const signals: readonly AutoAdvisorSignal[] =
  ["context_pressure", "watchdog_stall", "validation_failure", "repeated_attempt"];
const exact = (v: Record<string, unknown>, names: readonly string[]) =>
  Object.keys(v).sort().join("|") === [...names].sort().join("|");
function validPolicy(raw: unknown): raw is AdvisorStandingPolicyV1 {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const p = raw as Record<string, unknown>;
  if (!exact(p, ["schemaVersion","source","projectId","mode",
    "destination","disclosure","approvedAtMs","expiresAtMs",
    "revision","allowedSignals","maxEstimatedCentsPerIncident",
    "operatorAcknowledgedExternalTransfer"])) return false;
  if (p.schemaVersion!==1 || p.source!=="operator_approved_settings"
    || !safeId(p.projectId)
    || !["off","ask_before_consulting","automatic_advice"].includes(String(p.mode))
    || p.destination!=="openai_responses_api"
    || p.disclosure!=="incident_metadata_only"
    || !integer(p.approvedAtMs, 0, Number.MAX_SAFE_INTEGER)
    || !integer(p.expiresAtMs, 0, Number.MAX_SAFE_INTEGER)
    || (p.expiresAtMs as number) <= (p.approvedAtMs as number)
    || (p.expiresAtMs as number) - (p.approvedAtMs as number) > 30*24*60*60*1000
    || !digest(p.revision)
    || !Array.isArray(p.allowedSignals)
    || p.allowedSignals.length>signals.length
    || !p.allowedSignals.every(v=>signals.includes(v))
    || new Set(p.allowedSignals).size!==p.allowedSignals.length
    || !integer(p.maxEstimatedCentsPerIncident,1,10000)
    || p.operatorAcknowledgedExternalTransfer!==true) return false;
  return true;
}
function validIncident(raw: unknown): raw is AdvisorPolicyIncidentV1 {
  if (!raw || typeof raw!=="object" || Array.isArray(raw)) return false;
  const e=raw as Record<string, unknown>;
  return exact(e, ["schemaVersion","source","projectId","incidentId","state",
    "signal","observedAtMs","estimatedCents","disclosure"])
    && e.schemaVersion===1 && e.source==="trusted_task_store"
    && safeId(e.projectId) && digest(e.incidentId) && e.state==="open"
    && (signals.includes(e.signal as AutoAdvisorSignal)
      || ["human_approval","human_question","unknown"].includes(String(e.signal)))
    && integer(e.observedAtMs,0,Number.MAX_SAFE_INTEGER)
    && integer(e.estimatedCents,1,10000)
    && e.disclosure==="incident_metadata_only";
}
function decision(
  state: AdvisorPolicyDecisionV1["decision"],
  reason: AdvisorPolicyDecisionV1["reason"],
): AdvisorPolicyDecisionV1 {
  return Object.freeze({
    schemaVersion:1,decision:state,reason,
    metadataOnly:true,reviewBeforeExecution:true,
    admissionReserved:false,contactedAdvisor:false,
    grantsAuthority:false,canExecuteRecovery:false,
  });
}
/**
 * Read-only eligibility, not a token issuer. A trusted operator-controlled
 * policy store must enforce revocation, scope and expiry on each call;
 * M19R3C must still atomically reserve a separate per-incident grant.
 */
export function evaluateStandingAdvisorPolicy(
  rawPolicy: unknown, rawIncident: unknown, nowMs: number,
): AdvisorPolicyDecisionV1 {
  if (!validIncident(rawIncident) || !integer(nowMs,0,Number.MAX_SAFE_INTEGER)
    || rawIncident.observedAtMs>nowMs
    || nowMs-rawIncident.observedAtMs>60_000) {
    return decision("insufficient_evidence","invalid_policy_or_evidence");
  }
  if (!rawPolicy) return decision("disabled","consent_disabled");
  if (!validPolicy(rawPolicy)) return decision("insufficient_evidence","invalid_policy_or_evidence");
  if (rawPolicy.mode==="off") return decision("disabled","consent_disabled");
  if (nowMs<rawPolicy.approvedAtMs || nowMs>=rawPolicy.expiresAtMs)
    return decision("notify_operator","consent_expired");
  if (rawPolicy.projectId!==rawIncident.projectId)
    return decision("notify_operator","outside_approved_scope");
  if (rawIncident.signal==="human_question" || rawIncident.signal==="human_approval")
    return decision("notify_operator","human_decision");
  if (rawPolicy.mode==="ask_before_consulting")
    return decision("notify_operator","operator_review_mode");
  if (rawIncident.estimatedCents>rawPolicy.maxEstimatedCentsPerIncident)
    return decision("notify_operator","budget_review");
  if (!rawPolicy.allowedSignals.includes(rawIncident.signal as AutoAdvisorSignal))
    return decision("notify_operator","outside_approved_scope");
  return decision("automatic_advice_eligible","within_preapproved_scope");
}
