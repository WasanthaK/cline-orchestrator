/** M19R3D: dormant, explicitly invoked integration of admission and advisor. */
import { DurableAdvisorAdmissionLedger, AdvisorAdmissionError } from "./recovery-advisor-admission.js";
import { OneShotRecoveryAdvisor, type AdvisorTransportReceiptV1 } from "./recovery-advisor-transport.js";
import { validateAdvisorRequest } from "./recovery-advisor-contract.js";

export interface AdvisorBridgeRequestV1 {
  grantId: string;
  incident: unknown;
}
export type AdvisorBridgeReceiptV1 = AdvisorTransportReceiptV1;

/**
 * This method is not registered with any operator route or task runner.
 * Grants are consumed before any credential is resolved or network requested.
 * A failed request still burns the grant, preventing network duplicate calls.
 */
export async function consultWithDurableGrant(
  ledger: DurableAdvisorAdmissionLedger,
  advisor: OneShotRecoveryAdvisor,
  input: AdvisorBridgeRequestV1,
  resolveCredential: () => Promise<string>,
  beforeSend?: () => Promise<boolean>,
  cancellationSignal?: AbortSignal,
): Promise<AdvisorBridgeReceiptV1> {
  const unavailable = (reason: NonNullable<AdvisorBridgeReceiptV1["reason"]>): AdvisorBridgeReceiptV1 =>
    ({ schemaVersion:1,status:"unavailable",contacted:false,reason,
      retryAuthorized:false,skipExecutionPermitted:false,grantsAuthority:false });
  const incident = validateAdvisorRequest(input?.incident);
  if (!incident || typeof input?.grantId !== "string"
    || typeof resolveCredential !== "function") return unavailable("invalid_request");
  const cents = advisor.quoteEstimatedCents(incident);
  if (!cents) return unavailable("invalid_config");
  try {
    await ledger.reserveOnce(input.grantId,incident.incidentId,cents);
  } catch (error) {
    if (error instanceof AdvisorAdmissionError && error.code === "budget_exceeded")
      return unavailable("budget_exceeded");
    return unavailable("permission_denied");
  }
  return advisor.consult(incident, {
    // No permission callback can execute again here; durable reserveOnce
    // has atomically spent this exact grant before consulting the provider.
    authorizeOnce: async () => true,
    resolveCredential,
    ...(beforeSend ? { beforeSend } : {}),
    ...(cancellationSignal ? { cancellationSignal } : {}),
  });
}
