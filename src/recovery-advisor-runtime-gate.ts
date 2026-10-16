/**
 * M19R3H — trusted, read-only gate for advisor eligibility.
 *
 * Important: eligibility is not a one-shot grant. No network, grants, secrets,
 * task execution or scheduler registration is performed by this module.
 * Actual admission must re-evaluate current consent and atomically consume
 * a durable grant immediately before any separately approved consultation.
 */
import type { PublicTaskView } from "./machine-orchestrator.js";
import type { DurableRecoveryProjectionV1 } from "./recovery-task-event-bridge.js";
import type { NativeAdvisorProjectBinding } from "./native-advisor-project-binding.js";
import {
  evaluateStandingAdvisorPolicy, type AutoAdvisorSignal,
  type AdvisorPolicyDecisionV1, type AdvisorStandingPolicyV1,
} from "./recovery-advisor-policy.js";
import type { AdvisorRequestV1 } from "./recovery-advisor-contract.js";

export interface TrustedAdvisorRuntimeEvidence {
  /** Real MachineOrchestratorService: enforces task/workspace binding. */
  getTask(taskId: string): Promise<PublicTaskView>;
  getTaskRecoveryEvidence(taskId: string): Promise<DurableRecoveryProjectionV1>;
}
export interface AdvisorPriceQuote {
  /** Exact M19R3B serialization, no external call. */
  quoteEstimatedCents(request: AdvisorRequestV1): number | undefined;
}
export interface AdvisorBudgetReader {
  /** M19R3C read-only capacity check, not a budget reservation. */
  inspectAdmissionCapacity(
    projectId: string, incidentId: string, estimatedCents: number,
  ): Promise<"available" | "already_recorded" | "budget_exceeded">;
}
export interface AdvisorRuntimeGateV1 {
  schemaVersion: 1;
  result: "eligible_for_admission" | "notify_operator" |
    "disabled" | "already_recorded" | "unavailable";
  reason: "within_approved_scope" | "human_decision" | "operator_review_mode" |
    "outside_approved_scope" | "budget_review" | "consent_expired" |
    "consent_disabled" | "budget_exceeded" | "duplicate_incident" |
    "task_inactive" | "incident_not_open" | "stale_evidence" |
    "binding_changed" | "state_unavailable";
  /** Read-only policy outcome; no provider activity is implied. */
  policy?: AdvisorPolicyDecisionV1["decision"];
  estimatedCents?: number;
  readOnly: true;
  liveAdvisorConnected: false;
  admissionReserved: false;
  consultedAdvisor: false;
  autoResumePermitted: false;
  grantsAuthority: false;
}
export const ADVISOR_RUNTIME_GATE_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  rechecksCurrentSavedPolicy: true as const,
  requiresTrustedTaskAndIncident: true as const,
  requiresDurableBudgetCheck: true as const,
  liveAdvisorConnected: false as const,
  grantsAuthority: false as const,
});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const digest=/^[0-9a-f]{64}$/;
const allowedSignals = new Set<string>([
  "context_pressure", "watchdog_stall", "validation_failure",
]);
type GateReason=AdvisorRuntimeGateV1["reason"];
type GateResult=AdvisorRuntimeGateV1["result"];
function result(
  state: GateResult, reason: GateReason, policy?: AdvisorPolicyDecisionV1["decision"],
  cents?: number,
): AdvisorRuntimeGateV1 {
  return Object.freeze({
    schemaVersion:1,result:state,reason,
    ...(policy ? {policy} : {}),
    ...(cents !== undefined ? {estimatedCents:cents} : {}),
    readOnly:true,liveAdvisorConnected:false,admissionReserved:false,
    consultedAdvisor:false,autoResumePermitted:false,grantsAuthority:false,
  });
}
function incidentSignal(signal: string): AutoAdvisorSignal | "human_approval" | undefined {
  if (allowedSignals.has(signal)) return signal as AutoAdvisorSignal;
  if (signal === "human_approval") return "human_approval";
  return undefined;
}
function statusOf(task: PublicTaskView): AdvisorRequestV1["taskStatus"] {
  if (task.status==="stalled") return "stalled";
  if (task.status==="waiting_for_human") return "waiting_for_human";
  if (task.status==="failed" || task.status==="validation_failed") return "failed";
  if (["running","validating","repairing","safety_checking"].includes(task.status)) return "running";
  return "unknown";
}
function sameTask(first: PublicTaskView, second: PublicTaskView): boolean {
  return first.taskId===second.taskId && first.projectId===second.projectId
    && first.workspaceId===second.workspaceId && first.status===second.status
    && first.updatedAt===second.updatedAt && first.runCount===second.runCount;
}
function currentRevision(previous: AdvisorStandingPolicyV1|undefined,
  current: AdvisorStandingPolicyV1|undefined, now: number): boolean {
  if (!previous || !current || previous.revision!==current.revision
    || previous.projectId!==current.projectId || current.mode!=="automatic_advice"
    || now>=current.expiresAtMs || now<current.approvedAtMs) return false;
  return previous.mode===current.mode
    && previous.maxEstimatedCentsPerIncident===current.maxEstimatedCentsPerIncident
    && previous.expiresAtMs===current.expiresAtMs;
}
function evidenceTimestamp(value:unknown, now:number): boolean {
  if (typeof value!=="string") return false;
  const parsed=Date.parse(value);
  return Number.isSafeInteger(parsed) && parsed<=now && now-parsed<=60_000;
}

/**
 * A trusted controller may invoke this to decide whether one recorded,
 * still-open incident qualifies for advisory review under current policy.
 * No user-supplied project, signal, model, budget or raw incident data enters.
 */
export class TrustedAdvisorRuntimeGate {
  constructor(
    private readonly machine: TrustedAdvisorRuntimeEvidence,
    private readonly projectBinding: NativeAdvisorProjectBinding,
    private readonly pricing: AdvisorPriceQuote,
    private readonly budgets: AdvisorBudgetReader,
    private readonly clock:()=>number=Date.now,
  ) {}

  async evaluate(taskId:string,incidentId:string):Promise<AdvisorRuntimeGateV1> {
    if (!uuid.test(taskId) || !digest.test(incidentId))
      return result("unavailable","state_unavailable");
    const now=this.clock();
    if (!Number.isSafeInteger(now) || now<0)
      return result("unavailable","state_unavailable");
    try {
      const task=await this.machine.getTask(taskId);
      if (task.taskId!==taskId || !uuid.test(task.projectId) || !uuid.test(task.workspaceId)
        || !Number.isSafeInteger(task.runCount) || task.runCount<0 || task.runCount>100_000)
        return result("unavailable","binding_changed");
      const binding=await this.projectBinding.resolveProject(task.projectId);
      const initial=await binding.store.readCurrentPolicy();
      if (!initial || initial.mode==="off")
        return result("disabled","consent_disabled");
      // Completed/aborted tasks have no active recovery consultation.
      if (["completed","aborted","rolled_back","created","waiting"].includes(task.status))
        return result("unavailable","task_inactive");
      const evidence=await this.machine.getTaskRecoveryEvidence(taskId);
      // Acquisition may take time; a legitimate trusted capturedAt can be
      // after the initial policy clock sample.
      const evidenceNow=this.clock();
      if (!Number.isSafeInteger(evidenceNow) || evidenceNow<now)
        return result("unavailable","state_unavailable");
      if (evidence.schemaVersion!==1 || evidence.readOnly!==true
        || evidence.grantsAuthority!==false || evidence.source!=="trusted_task_store"
        || evidence.coverage!=="durable_events_only"
        || evidence.availability!=="available" || evidence.taskId!==taskId
        || evidence.taskStatus!==task.status
        || !evidenceTimestamp(evidence.capturedAt,evidenceNow)
        || !Array.isArray(evidence.incidents) || evidence.incidents.length>40)
        return result("unavailable","state_unavailable");
      const matches=evidence.incidents.filter(i=>i.incidentId===incidentId);
      if (matches.length!==1 || matches[0]?.schemaVersion!==1
        || matches[0]?.evidence!=="durable_task_events"
        || matches[0]?.grantsAuthority!==false)
        return result("unavailable","incident_not_open");
      const incident=matches[0]!;
      if (incident.state!=="open") return result("unavailable","incident_not_open");
      if (!evidenceTimestamp(incident.lastSeenAt,evidenceNow))
        return result("unavailable","stale_evidence");
      const signal=incidentSignal(incident.signal);
      if (!signal) return result("unavailable","state_unavailable");
      if (task.status==="waiting_for_human" || signal==="human_approval")
        return result("notify_operator","human_decision");
      const request:AdvisorRequestV1={
        schemaVersion:1,incidentId,taskStatus:statusOf(task),signal,
        attempts:task.runCount,consent:true,evidenceOnly:true,
      };
      const cents=this.pricing.quoteEstimatedCents(request);
      if (!Number.isSafeInteger(cents) || cents===undefined || cents<1 || cents>10_000)
        return result("unavailable","state_unavailable");
      const classification=evaluateStandingAdvisorPolicy(initial,{
        schemaVersion:1,source:"trusted_task_store",
        projectId:task.projectId,incidentId,state:"open",signal,
        observedAtMs:Date.parse(incident.lastSeenAt),
        estimatedCents:cents,disclosure:"incident_metadata_only",
      },evidenceNow);
      if (classification.decision==="disabled")
        return result("disabled","consent_disabled",classification.decision);
      if (classification.decision==="insufficient_evidence")
        return result("unavailable","state_unavailable",classification.decision);
      if (classification.decision==="notify_operator") {
        const reasons={
          operator_review_mode:"operator_review_mode",
          human_decision:"human_decision",
          outside_approved_scope:"outside_approved_scope",
          budget_review:"budget_review",
          consent_expired:"consent_expired",
        } as const;
        const reason=classification.reason in reasons
          ? reasons[classification.reason as keyof typeof reasons] : "state_unavailable";
        return result("notify_operator",reason,classification.decision,cents);
      }
      const capacity=await this.budgets.inspectAdmissionCapacity(task.projectId,incidentId,cents);
      if (capacity==="already_recorded")
        return result("already_recorded","duplicate_incident",classification.decision,cents);
      if (capacity==="budget_exceeded")
        return result("notify_operator","budget_exceeded",classification.decision,cents);
      if (capacity!=="available")
        return result("unavailable","state_unavailable");
      // Re-read both authoritative records after asynchronous budget inspection.
      // This prevents a revoked/edited policy or changed task from yielding
      // a stale eligible decision. A future transport must check again.
      const [again,latest,proof]=await Promise.all([
        binding.store.readCurrentPolicy(),this.machine.getTask(taskId),
        this.machine.getTaskRecoveryEvidence(taskId),
      ]);
      // A task record can be unchanged while its append-only incident
      // history advances. Revalidate the exact still-open incident too.
      const active=proof.availability==="available" && proof.readOnly===true
        && proof.source==="trusted_task_store" && proof.taskId===taskId
        && proof.taskStatus===task.status && proof.grantsAuthority===false
        && Array.isArray(proof.incidents)
        ? proof.incidents.filter(i=>i.incidentId===incidentId) : [];
      if (active.length!==1 || active[0]?.state!=="open"
        || active[0]?.lastSeenAt!==incident.lastSeenAt
        || active[0]?.signal!==incident.signal)
        return result("unavailable","binding_changed");
      const finalNow=this.clock();
      if (!Number.isSafeInteger(finalNow) || finalNow<now
        || !currentRevision(initial,again,finalNow)
        || !sameTask(task,latest))
        return result("unavailable","binding_changed");
      return result("eligible_for_admission","within_approved_scope",
        classification.decision,cents);
    } catch {
      // Fail closed: never leak file paths, model output or secret details.
      return result("unavailable","state_unavailable");
    }
  }
}
