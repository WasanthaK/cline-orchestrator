import { execFile as execFileCallback } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { hasLiveProofHubShutdownSurface } from "./live-proof-isolation.js";
import { gatewayWorkerConfigFromEnvironment } from "./mcp-main.js";

const execFile = promisify(execFileCallback);
const REQUIRED_BRANCH = "phase-1/bootstrap";
const DEFAULT_CLINE_HUB_PORT = 25463;
const SOCKET_TIMEOUT_MS = 1200;

export type Cr3PreflightCheckStatus = "pass" | "warn" | "fail";

export interface Cr3PreflightCheck {
  id: string;
  status: Cr3PreflightCheckStatus;
  summary: string;
}

export interface Cr3PreflightInput {
  nodeMajor: number;
  branch: string;
  head: string;
  gitDirty: boolean;
  expectedCoreVersion?: string;
  installedCoreVersion?: string;
  expectedSdkVersion?: string;
  installedSdkVersion?: string;
  hubShutdownSurfaceAvailable: boolean;
  providerId: string;
  providerBaseUrl?: string;
  providerIsLoopback: boolean;
  providerReachable: boolean;
  clineExtensionCandidates: string[];
  defaultClineHubReachable: boolean;
}

export interface Cr3PreflightReport {
  schemaVersion: 1;
  proof: "cr3-preflight";
  readOnly: true;
  overall: "ready" | "blocked";
  branch: string;
  head: string;
  checks: Cr3PreflightCheck[];
}

function check(
  id: string,
  status: Cr3PreflightCheckStatus,
  summary: string,
): Cr3PreflightCheck {
  return { id, status, summary };
}

function versionCheck(
  id: string,
  label: string,
  expected: string | undefined,
  installed: string | undefined,
): Cr3PreflightCheck {
  if (!expected) return check(id, "fail", `${label} is not pinned in package.json`);
  if (!installed) return check(id, "fail", `${label} is not installed under node_modules`);
  if (expected !== installed) {
    return check(id, "fail", `${label} version mismatch: expected ${expected}, installed ${installed}`);
  }
  return check(id, "pass", `${label} ${installed} matches the pinned version`);
}

/** Pure policy evaluation used by CI tests and the local collector. */
export function evaluateCr3Preflight(input: Cr3PreflightInput): Cr3PreflightReport {
  const checks: Cr3PreflightCheck[] = [];

  checks.push(
    input.nodeMajor >= 22
      ? check("node", "pass", `Node ${input.nodeMajor} satisfies the Node >=22 requirement`)
      : check("node", "fail", `Node ${input.nodeMajor} is too old; Node >=22 is required`),
  );
  checks.push(
    input.branch === REQUIRED_BRANCH
      ? check("branch", "pass", `Canonical branch ${REQUIRED_BRANCH} is checked out`)
      : check("branch", "fail", `Expected branch ${REQUIRED_BRANCH}, found ${input.branch || "unknown"}`),
  );
  checks.push(
    input.gitDirty
      ? check("git_clean", "fail", "The orchestrator checkout has uncommitted/untracked changes")
      : check("git_clean", "pass", "The orchestrator checkout is clean"),
  );
  checks.push(versionCheck("cline_core", "@cline/core", input.expectedCoreVersion, input.installedCoreVersion));
  checks.push(versionCheck("cline_sdk", "@cline/sdk", input.expectedSdkVersion, input.installedSdkVersion));
  checks.push(
    input.hubShutdownSurfaceAvailable
      ? check("hub_shutdown", "pass", "Pinned Cline exposes the reviewed graceful Hub shutdown surface")
      : check("hub_shutdown", "fail", "Pinned Cline does not expose the reviewed graceful Hub shutdown surface"),
  );
  checks.push(
    input.providerIsLoopback
      ? check("provider_scope", "pass", `Worker provider ${input.providerId} is configured on loopback only`)
      : check("provider_scope", "fail", "CR3 refuses a non-loopback worker provider endpoint"),
  );
  checks.push(
    input.providerIsLoopback && input.providerReachable
      ? check("provider_reachable", "pass", "Configured local worker provider endpoint is reachable")
      : input.providerIsLoopback
        ? check("provider_reachable", "fail", "Configured local worker provider endpoint is not reachable")
        : check("provider_reachable", "fail", "Provider reachability was not attempted because the endpoint is not loopback"),
  );
  checks.push(
    input.clineExtensionCandidates.length > 0
      ? check(
          "vscode_cline",
          "pass",
          `Detected VS Code Cline extension candidate(s): ${input.clineExtensionCandidates.join(", ")}`,
        )
      : check(
          "vscode_cline",
          "warn",
          "No Cline/claude-dev VS Code extension directory was detected; isolated CR3 can still run, but real-client presence is not independently confirmed",
        ),
  );
  checks.push(
    input.defaultClineHubReachable
      ? check(
          "default_hub",
          "pass",
          `Cline default Hub port ${DEFAULT_CLINE_HUB_PORT} is already reachable; CR3 will not attach to or stop it`,
        )
      : check(
          "default_hub",
          "warn",
          `Cline default Hub port ${DEFAULT_CLINE_HUB_PORT} is not currently reachable; CR3 will still use a separate isolated Hub port`,
        ),
  );

  return {
    schemaVersion: 1,
    proof: "cr3-preflight",
    readOnly: true,
    overall: checks.some((item) => item.status === "fail") ? "blocked" : "ready",
    branch: input.branch,
    head: input.head,
    checks,
  };
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await execFile("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    windowsHide: true,
  });
  return result.stdout.trim();
}

async function readPackageVersion(filePath: string): Promise<string | undefined> {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as { version?: unknown };
    return typeof parsed.version === "string" ? parsed.version : undefined;
  } catch {
    return undefined;
  }
}

async function detectClineExtensionCandidates(): Promise<string[]> {
  const roots = [
    path.join(os.homedir(), ".vscode", "extensions"),
    path.join(os.homedir(), ".vscode-insiders", "extensions"),
  ];
  const found = new Set<string>();
  for (const root of roots) {
    try {
      for (const entry of await readdir(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const name = entry.name.toLowerCase();
        if (name.includes("cline") || name.includes("claude-dev")) found.add(entry.name);
      }
    } catch {
      // VS Code or this extension root may simply not exist on the machine.
    }
  }
  return [...found].sort();
}

export function isLoopbackUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  } catch {
    return false;
  }
}

function portForUrl(value: string): { host: string; port: number } | undefined {
  try {
    const parsed = new URL(value);
    if (!isLoopbackUrl(value)) return undefined;
    const port = parsed.port
      ? Number.parseInt(parsed.port, 10)
      : parsed.protocol === "https:"
        ? 443
        : parsed.protocol === "http:"
          ? 80
          : Number.NaN;
    if (!Number.isInteger(port) || port < 1 || port > 65535) return undefined;
    return { host: parsed.hostname.replace(/^\[|\]$/g, ""), port };
  } catch {
    return undefined;
  }
}

export async function isTcpReachable(
  host: string,
  port: number,
  timeoutMs = SOCKET_TIMEOUT_MS,
): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

export async function collectCr3Preflight(cwd = process.cwd()): Promise<Cr3PreflightReport> {
  const rootPackagePath = path.join(cwd, "package.json");
  const rootPackage = JSON.parse(await readFile(rootPackagePath, "utf8")) as {
    dependencies?: Record<string, string>;
  };
  const dependencies = rootPackage.dependencies ?? {};
  const expectedCoreVersion = dependencies["@cline/core"];
  const expectedSdkVersion = dependencies["@cline/sdk"];
  const installedCoreVersion = await readPackageVersion(
    path.join(cwd, "node_modules", "@cline", "core", "package.json"),
  );
  const installedSdkVersion = await readPackageVersion(
    path.join(cwd, "node_modules", "@cline", "sdk", "package.json"),
  );

  const branch = await git(cwd, "rev-parse", "--abbrev-ref", "HEAD");
  const head = await git(cwd, "rev-parse", "HEAD");
  const gitDirty = (await git(cwd, "status", "--porcelain")).length > 0;
  const worker = gatewayWorkerConfigFromEnvironment();
  const providerBaseUrl = worker.baseUrl;
  const providerIsLoopback = isLoopbackUrl(providerBaseUrl);
  const providerSocket = providerBaseUrl ? portForUrl(providerBaseUrl) : undefined;
  const providerReachable = providerSocket
    ? await isTcpReachable(providerSocket.host, providerSocket.port)
    : false;

  return evaluateCr3Preflight({
    nodeMajor: Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10),
    branch,
    head,
    gitDirty,
    expectedCoreVersion,
    installedCoreVersion,
    expectedSdkVersion,
    installedSdkVersion,
    hubShutdownSurfaceAvailable: hasLiveProofHubShutdownSurface(),
    providerId: worker.providerId,
    providerBaseUrl,
    providerIsLoopback,
    providerReachable,
    clineExtensionCandidates: await detectClineExtensionCandidates(),
    defaultClineHubReachable: await isTcpReachable("127.0.0.1", DEFAULT_CLINE_HUB_PORT),
  });
}

export function renderCr3Preflight(report: Cr3PreflightReport): string {
  const lines = [
    `CR3 preflight: ${report.overall.toUpperCase()}`,
    `branch: ${report.branch}`,
    `head: ${report.head}`,
    "",
    ...report.checks.map((item) => `[${item.status.toUpperCase()}] ${item.id}: ${item.summary}`),
    "",
    "No files, Cline sessions, Hub processes, VS Code state, or provider state were modified.",
    `__ORCH_CR3_PREFLIGHT__${JSON.stringify(report)}`,
  ];
  return lines.join("\n");
}

async function main(): Promise<void> {
  try {
    const report = await collectCr3Preflight();
    process.stdout.write(`${renderCr3Preflight(report)}\n`);
    if (report.overall !== "ready") process.exitCode = 1;
  } catch (error) {
    process.stderr.write(
      `CR3 preflight failed before evaluation: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1]?.endsWith("cr3-preflight.ts") || process.argv[1]?.endsWith("cr3-preflight.js")) {
  void main();
}
