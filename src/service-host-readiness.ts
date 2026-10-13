import { previewLocalServiceInstall } from "./local-service-install-preview.js";
import type { LocalServiceSpecV1 } from "./local-service-lifecycle.js";

export interface ServiceHostReadiness {
  readonly manager: "systemd" | "windows-service";
  readonly ready: boolean;
  readonly reasons: readonly string[];
  readonly executesCommands: false;
  readonly grantsAuthority: false;
}
export function assessServiceHostReadiness(spec: LocalServiceSpecV1): ServiceHostReadiness {
  const preview = previewLocalServiceInstall(spec);
  const reasons = preview.manager === "windows-service"
    ? ["scm_host_not_proven", "disposable_lifecycle_not_proven"]
    : ["foreground_entrypoint_not_proven", "disposable_lifecycle_not_proven"];
  return Object.freeze({
    manager: preview.manager, ready: false, reasons: Object.freeze(reasons),
    executesCommands: false, grantsAuthority: false,
  });
}
