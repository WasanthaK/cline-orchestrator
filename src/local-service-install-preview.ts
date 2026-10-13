import path from "node:path";
import { LocalServiceLifecycleError, type LocalServiceSpecV1 } from "./local-service-lifecycle.js";

export interface ServiceInstallPreviewV1 {
  schemaVersion: 1;
  manager: "systemd" | "windows-service";
  serviceName: string;
  target: string;
  content?: string;
  command?: readonly string[];
  authority: "service_install_preview_only";
  mutatesServiceManager: false;
  grantsAuthority: false;
}

function requireSafeName(name: string): void {
  if (!/^[A-Za-z0-9._-]{1,96}$/.test(name) || name === "." || name === "..") {
    throw new LocalServiceLifecycleError("service name invalid", "spec_invalid");
  }
}
function requireAbsolute(s: string, platform: "linux" | "win32"): void {
  const valid = platform === "linux" ? path.posix.isAbsolute(s) : path.win32.isAbsolute(s);
  if (!valid || /[\r\n\0]/.test(s)) throw new LocalServiceLifecycleError("service path invalid", "spec_invalid");
}
function assertShared(spec: LocalServiceSpecV1): void {
  if (spec.schemaVersion !== 1 || spec.authority !== "local_service_specification_only"
    || spec.grantsAuthority !== false || spec.autoStart !== false
    || !["127.0.0.1","localhost","::1"].includes(spec.daemonHost)
    || !Number.isInteger(spec.daemonPort) || spec.daemonPort < 1 || spec.daemonPort > 65535
    || !Array.isArray(spec.args) || !Array.isArray(spec.secretReferenceNames)
    || spec.secretReferenceNames.length !== 0
    || spec.args.some(x => typeof x !== "string" || /[\r\n\0]/.test(x))) {
    throw new LocalServiceLifecycleError("service preview requires safe explicit specification without credential provisioning", "spec_invalid");
  }
  requireSafeName(spec.serviceName);
}
function systemdQuote(v: string): string {
  if (/[\r\n\0%]/.test(v)) throw new LocalServiceLifecycleError("unsafe systemd token", "spec_invalid");
  return '"' + v.replace(/\\/g,"\\\\").replace(/"/g,'\\"') + '"';
}

/** A non-executing, reviewable preview; never writes a unit or contacts the service manager. */
export function previewLocalServiceInstall(spec: LocalServiceSpecV1): ServiceInstallPreviewV1 {
  assertShared(spec);
  const common = { schemaVersion: 1 as const, serviceName: spec.serviceName,
    authority: "service_install_preview_only" as const, mutatesServiceManager: false as const,
    grantsAuthority: false as const };
  if (spec.manager === "systemd") {
    requireAbsolute(spec.executable,"linux");
    requireAbsolute(spec.workingDirectory,"linux");
    requireAbsolute(spec.configPath,"linux");
    if (spec.displayName.includes("\n") || spec.displayName.includes("\r")) throw new LocalServiceLifecycleError("invalid display name","spec_invalid");
    const content = [
      "[Unit]", "Description=" + spec.displayName.replace(/%/g,"%%"), "After=network.target",
      "[Service]", "Type=simple",
      "WorkingDirectory=" + systemdQuote(spec.workingDirectory),
      "ExecStart=" + [spec.executable, ...spec.args].map(systemdQuote).join(" "),
      "Restart=no", "NoNewPrivileges=true",
      "[Install]", "WantedBy=multi-user.target", ""
    ].join("\n");
    return Object.freeze({ ...common, manager:"systemd", target:spec.serviceName+".service", content });
  }
  if (spec.manager === "windows-service") {
    requireAbsolute(spec.executable,"win32");
    requireAbsolute(spec.workingDirectory,"win32");
    requireAbsolute(spec.configPath,"win32");
    if (spec.args.length || /["\r\n\0]/.test(spec.executable)) {
      throw new LocalServiceLifecycleError("Windows service preview requires a verified service-host executable with no arguments","spec_invalid");
    }
    return Object.freeze({ ...common, manager:"windows-service", target:spec.serviceName,
      command:Object.freeze(["sc.exe","create",spec.serviceName,"binPath=",spec.executable,"start=","demand"] ) });
  }
  throw new LocalServiceLifecycleError("unsupported platform", "spec_invalid");
}
