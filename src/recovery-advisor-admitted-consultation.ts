/**
 * M19R3I: opt-in, one-shot standing-consent admission coordinator.
 * Deliberately NOT registered on runner, MCP task actions or scheduler.
 * Holding a project settings lease serializes "Off" writes against send.
 * No advice is interpreted as permission to execute/retry.
 */
import type { PublicTaskView } from "./machine-orchestrator.js";
import type { DurableRecoveryProjectionV1, DurableRecoveryIncidentV1 } from "./recovery-task-event-bridge.js";
import type { NativeAdvisorProjectBinding } from "./native-advisor-project-binding.js";
import type { AdvisorStandingPolicyV1 } from "./recovery-advisor-policy.js";
import { DurableAdvisorAdmissionLedger } from "./recovery-advisor-admission.js";
import { TrustedAdvisorRuntimeGate, type TrustedAdvisorRuntimeEvidence } from "./recovery-advisor-runtime-gate.js";
import { OneShotRecoveryAdvisor } from "./recovery-advisor-transport.js";
import { consultWithDurableGrant } from "./recovery-advisor-bridge.js";
import type { AdvisorDecisionV1, AdvisorRequestV1 } from "./recovery-advisor-contract.js";

type Outcome="review_required"|"disabled"|"operator_attention"|"already_handled"|"unavailable";
type Reason="advice_ready"|"consent_disabled"|"operator_review"|"duplicate_incident"|
  "budget_exceeded"|"permission_denied"|"trusted_evidence_changed"|
  "credential_unavailable"|"provider_unavailable"|"invalid_response"|"state_unavailable"|"consultation_cancelled";
export interface AdvisorAdmittedConsultationV1 {
  schemaVersion:1;
  outcome:Outcome;
  reason:Reason;
  contacted:boolean;
  suggestion?:AdvisorDecisionV1;
  readOnly:true;
  grantsAuthority:false;
  executionAuthorized:false;
  retryAuthorized:false;
}
export interface ProjectScopedAdmissionLedger {
  /** Exact canonical project identity; not an untrusted browser parameter. */
  projectId:string;
  ledger:DurableAdvisorAdmissionLedger;
}
export interface TrustedProjectLedgerResolver {
  forProject(projectId:string):Promise<ProjectScopedAdmissionLedger>;
}
export const ADVISOR_ADMITTED_CONSULTATION_CONTRACT=Object.freeze({
  schemaVersion:1 as const, requiresStandingConsent:true as const,
  requiresProjectScopedDurableGrant:true as const,
  checksAgainAfterCredentialResolution:true as const,
  registeredAsRuntimeTaskAction:false as const,
  autonomousCallsEnabled:false as const, grantsAuthority:false as const,
});
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const digest=/^[a-f0-9]{64}$/;
function answer(outcome:Outcome,reason:Reason,contacted=false,
  suggestion?:AdvisorDecisionV1):AdvisorAdmittedConsultationV1 {
  return Object.freeze({schemaVersion:1,outcome,reason,contacted,
    ...(suggestion?{suggestion}:{}),
    readOnly:true,grantsAuthority:false,executionAuthorized:false,retryAuthorized:false});
}
function taskState(task:PublicTaskView):AdvisorRequestV1["taskStatus"] {
  if(task.status==="stalled")return "stalled";
  if(task.status==="waiting_for_human")return "waiting_for_human";
  if(["failed","validation_failed","aborted"].includes(task.status))return "failed";
  if(["running","validating","repairing","safety_checking"].includes(task.status))return "running";
  return "unknown";
}
function signatureMatches(first:PublicTaskView,other:PublicTaskView):boolean {
  return other.taskId===first.taskId && other.projectId===first.projectId
    && other.workspaceId===first.workspaceId && other.status===first.status
    && other.updatedAt===first.updatedAt && other.runCount===first.runCount;
}
function currentOpenIncident(proof:DurableRecoveryProjectionV1,
  task:PublicTaskView,id:string,now:number):DurableRecoveryIncidentV1|undefined {
  if(proof.schemaVersion!==1 || proof.availability!=="available"
    || proof.readOnly!==true || proof.grantsAuthority!==false
    || proof.source!=="trusted_task_store" || proof.coverage!=="durable_events_only"
    || proof.taskId!==task.taskId || proof.taskStatus!==task.status
    || !Array.isArray(proof.incidents) || proof.incidents.length>40)return undefined;
  const captured=Date.parse(proof.capturedAt??"");
  if(!Number.isSafeInteger(captured) || captured>now || now-captured>60_000)return undefined;
  const matches=proof.incidents.filter(i=>i.incidentId===id && i.state==="open"
    && i.evidence==="durable_task_events" && i.grantsAuthority===false);
  if(matches.length!==1)return undefined;
  const seen=Date.parse(matches[0]!.lastSeenAt);
  if(!Number.isSafeInteger(seen)||seen>now||now-seen>60_000)return undefined;
  return matches[0];
}
const mappedSignal=(v:string):AdvisorRequestV1["signal"]|undefined=>{
  if(v==="context_pressure"||v==="watchdog_stall"||v==="validation_failure")return v;
  return undefined;
};
function policyCurrent(p:AdvisorStandingPolicyV1|undefined,
  projectId:string,now:number,cents:number):boolean {
  return !!p && p.schemaVersion===1 && p.source==="operator_approved_settings"
    && p.projectId===projectId && p.mode==="automatic_advice"
    && p.destination==="openai_responses_api" && p.disclosure==="incident_metadata_only"
    && p.operatorAcknowledgedExternalTransfer===true
    && now>=p.approvedAtMs && now<p.expiresAtMs
    && Number.isSafeInteger(cents) && cents>=1 && cents<=p.maxEstimatedCentsPerIncident;
}

/**
 * Separately invoked by trusted host only; installed application does not
 * register this service as a scheduled or externally callable capability.
 */
export class TrustedAdmittedAdvisorConsultation {
  constructor(
    private readonly machine:TrustedAdvisorRuntimeEvidence,
    private readonly projects:NativeAdvisorProjectBinding,
    private readonly gate:TrustedAdvisorRuntimeGate,
    private readonly scopedLedgers:TrustedProjectLedgerResolver,
    private readonly transport:OneShotRecoveryAdvisor,
    private readonly secret:()=>Promise<string>,
    private readonly clock:()=>number=Date.now,
  ) {}
  async consult(taskId:string,incidentId:string):Promise<AdvisorAdmittedConsultationV1> {
    if(!uuid.test(taskId)||!digest.test(incidentId))
      return answer("unavailable","state_unavailable");
    try {
      // No browser supplied project, cost, grant ID, model or payload.
      const original=await this.machine.getTask(taskId);
      if(original.taskId!==taskId||!uuid.test(original.projectId)||!uuid.test(original.workspaceId))
        return answer("unavailable","state_unavailable");
      const registered=await this.projects.resolveProject(original.projectId);
      const monitor=registered.store.watchImmediateStop();
      try {
      return await registered.store.withCurrentPolicyLease(async locked=>{
        if(monitor.signal.aborted || await registered.store.isEmergencyStopped())
          return answer("disabled","consent_disabled");
        const preliminary=await this.gate.evaluate(taskId,incidentId);
        if(preliminary.result==="disabled")return answer("disabled","consent_disabled");
        if(preliminary.result==="already_recorded")
          return answer("already_handled","duplicate_incident");
        if(preliminary.result==="notify_operator")return answer("operator_attention",
          preliminary.reason==="budget_review"||preliminary.reason==="budget_exceeded"
            ? "budget_exceeded":"operator_review");
        if(preliminary.result!=="eligible_for_admission"||!preliminary.estimatedCents)
          return answer("unavailable","state_unavailable");
        const cents=preliminary.estimatedCents;
        const initialNow=this.clock();
        const task=await this.machine.getTask(taskId);
        if(!signatureMatches(original,task)||!policyCurrent(locked,task.projectId,initialNow,cents))
          return answer("unavailable","trusted_evidence_changed");
        const proof=await this.machine.getTaskRecoveryEvidence(taskId);
        const evidence=currentOpenIncident(proof,task,incidentId,this.clock());
        const signal=evidence && mappedSignal(evidence.signal);
        if(!evidence||!signal)return answer("unavailable","trusted_evidence_changed");
        const request:AdvisorRequestV1={schemaVersion:1,incidentId,
          taskStatus:taskState(task),signal,attempts:task.runCount,
          evidenceOnly:true,consent:true};
        if(this.transport.quoteEstimatedCents(request)!==cents)
          return answer("unavailable","trusted_evidence_changed");
        const scope=await this.scopedLedgers.forProject(task.projectId);
        if(!scope||scope.projectId!==task.projectId||!scope.ledger)
          return answer("unavailable","state_unavailable");
        // A short grant is issued solely from locked, checked standing
        // consent. The durable ledger enforces duplicate/quotas and the
        // bridge consumes the grant before resolving credentials.
        let grant;
        try {grant=await scope.ledger.issue(incidentId,cents,30_000,async()=>true);}
        catch {return answer("unavailable","state_unavailable");}
        const finalEvidence=async():Promise<boolean>=>{
          try {
            if(monitor.signal.aborted || await registered.store.isEmergencyStopped())return false;
            const now=this.clock();
            if(!policyCurrent(locked,task.projectId,now,cents))return false;
            const [latest,latestProof,current]=await Promise.all([
              this.machine.getTask(taskId),
              this.machine.getTaskRecoveryEvidence(taskId),
              registered.store.readCurrentPolicy(),
            ]);
            if(!signatureMatches(task,latest)||!current||current.revision!==locked?.revision)
              return false;
            const active=currentOpenIncident(latestProof,latest,incidentId,this.clock());
            return !!active&&active.signal===evidence.signal
              && active.firstSeenAt===evidence.firstSeenAt
              && active.lastSeenAt===evidence.lastSeenAt
              && policyCurrent(current,task.projectId,this.clock(),cents);
          } catch {return false;}
        };
        const receipt=await consultWithDurableGrant(scope.ledger,this.transport,{
          grantId:grant.grantId,incident:request,
        },this.secret,finalEvidence,monitor.signal);
        if(receipt.status==="review_required"&&receipt.advice)
          return answer("review_required","advice_ready",receipt.contacted,receipt.advice);
        const reason:Reason=receipt.reason==="cancelled"?"consultation_cancelled"
          : receipt.reason==="permission_denied"
          ? "trusted_evidence_changed"
          : receipt.reason==="budget_exceeded"?"budget_exceeded"
          : receipt.reason==="credential_unavailable"?"credential_unavailable"
          : receipt.reason==="invalid_response"?"invalid_response"
          : receipt.contacted?"provider_unavailable":"state_unavailable";
        return answer("unavailable",reason,receipt.contacted);
      });
      } finally {monitor.close();}
    } catch {
      return answer("unavailable","state_unavailable");
    }
  }
}
