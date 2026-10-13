import path from "node:path";
import { LocalServiceLifecycleError, type LocalServiceSpecV1 } from "./local-service-lifecycle.js";
import { planPlatformServiceAction } from "./platform-service-command-plan.js";

export interface WindowsScmHostEvidenceV1 {
  schemaVersion: 1;
  hostPath: string;
  sha256: string;
  serviceMainVerified: true;
  stopControlVerified: true;
  disposableLifecycleVerified: true;
  evidenceId: string;
}
export interface WindowsScmInstallReviewV1 {
  schemaVersion: 1;
  serviceName: string;
  hostPath: string;
  sha256: string;
  evidenceId: string;
  command: readonly string[];
  authority: "windows_scm_install_review_only";
  requiresExplicitConfirmation: true;
  executesCommands: false;
  grantsAuthority: false;
}

/** Precondition review, not an SCM driver or an authentication of external evidence. */
export function reviewWindowsScmHostInstall(
  spec: LocalServiceSpecV1,
  evidence: WindowsScmHostEvidenceV1 | undefined,
): WindowsScmInstallReviewV1 {
  if (spec.manager !== "windows-service" || !evidence) {
    throw new LocalServiceLifecycleError("verified Windows service host is required", "spec_invalid");
  }
  const plan = planPlatformServiceAction(spec, "install");
  if (evidence.schemaVersion !== 1 || evidence.serviceMainVerified !== true
    || evidence.stopControlVerified !== true || evidence.disposableLifecycleVerified !== true
    || !/^[a-f0-9]{64}$/i.test(evidence.sha256)
    || !/^[A-Za-z0-9._-]{8,128}$/.test(evidence.evidenceId)
    || !path.win32.isAbsolute(evidence.hostPath)
    || path.win32.normalize(evidence.hostPath).toLowerCase() !== path.win32.normalize(spec.executable).toLowerCase()
    || !/\.exe$/i.test(evidence.hostPath)
    || /[\r\n\0"]/u.test(evidence.hostPath)
    || /(?:\\|\/)product-cli(?:\.js|\.cmd)?$/i.test(evidence.hostPath)) {
    throw new LocalServiceLifecycleError("Windows service host evidence is incomplete or mismatched", "spec_invalid");
  }
  return Object.freeze({
    schemaVersion: 1, serviceName: spec.serviceName, hostPath: evidence.hostPath,
    sha256: evidence.sha256.toLowerCase(), evidenceId: evidence.evidenceId,
    command: Object.freeze([...plan.argv]),
    authority: "windows_scm_install_review_only", requiresExplicitConfirmation: true,
    executesCommands: false, grantsAuthority: false,
  });
}
