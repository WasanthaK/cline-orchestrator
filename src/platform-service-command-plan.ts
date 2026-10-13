import { previewLocalServiceInstall } from "./local-service-install-preview.js";
import { LocalServiceLifecycleError, type LocalServiceSpecV1 } from "./local-service-lifecycle.js";

export type PlatformServiceAction = "install" | "start" | "stop" | "status" | "uninstall";
export interface PlatformServiceCommandPlan {
  schemaVersion: 1;
  manager: "systemd" | "windows-service";
  action: PlatformServiceAction;
  serviceName: string;
  executable: "systemctl" | "sc.exe";
  argv: readonly string[];
  unitContent?: string;
  requiresExplicitLocalConfirmation: true;
  mutatesServiceManager: false;
  executesCommands: false;
  grantsAuthority: false;
  authority: "platform_service_command_plan_only";
}

/** No subprocess/OS access. Actual execution must be separately reviewed and authorized. */
export function planPlatformServiceAction(spec: LocalServiceSpecV1, action: PlatformServiceAction): PlatformServiceCommandPlan {
  const preview = previewLocalServiceInstall(spec);
  if (!["install", "start", "stop", "status", "uninstall"].includes(action)) {
    throw new LocalServiceLifecycleError("invalid platform service action", "action_invalid");
  }
  const name = spec.serviceName;
  let executable: "systemctl" | "sc.exe";
  let argv: readonly string[];
  if (preview.manager === "systemd") {
    executable = "systemctl";
    const unit = preview.target;
    if (action === "install") {
      // Unit file placement is deliberately NOT delegated to a generic shell command.
      argv = Object.freeze(["daemon-reload"]);
    } else if (action === "uninstall") {
      // Unit deletion is not implied; a future executor must own exact file paths.
      argv = Object.freeze(["daemon-reload"]);
    } else {
      argv = Object.freeze([action === "status" ? "is-active" : action, unit]);
    }
  } else {
    executable = "sc.exe";
    if (action === "install") argv = Object.freeze([...(preview.command?.slice(1) ?? [])]);
    else if (action === "uninstall") argv = Object.freeze(["delete", name]);
    else argv = Object.freeze([action === "status" ? "query" : action, name]);
  }
  return Object.freeze({
    schemaVersion: 1, manager:preview.manager, action, serviceName:name, executable,
    argv, ...(action === "install" && preview.content ? { unitContent:preview.content } : {}),
    requiresExplicitLocalConfirmation:true, mutatesServiceManager:false,
    executesCommands:false, grantsAuthority:false, authority:"platform_service_command_plan_only",
  });
}
