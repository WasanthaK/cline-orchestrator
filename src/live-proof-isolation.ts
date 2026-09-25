import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import * as ClineHub from "@cline/core/hub";

const execFile = promisify(execFileCallback);

export const LIVE_PROOF_OPT_IN_ENV = "ORCH_LIVE_PROOF_OPT_IN";
export const LIVE_PROOF_OPT_IN_VALUE = "CONFIRMED_DISPOSABLE_ONLY";

export interface LiveProofIsolation {
  root: string;
  registryPath: string;
  clineDir: string;
  clineDataDir: string;
  hubPort: number;
  hubAddress: string;
  environment: Record<string, string>;
}

type ClineHubLifecycleSurface = {
  stopLocalHubServerGracefully?: () => Promise<boolean>;
};

/**
 * Defense-in-depth guard for scripts that may start an isolated local Hub/runtime.
 * This deliberately does not represent user authorization by itself; callers must
 * still obtain the externally required authorization before executing a physical
 * proof. The opt-in only prevents accidental invocation from a shell/CI job.
 */
export function assertLiveProofOptIn(
  environment: NodeJS.ProcessEnv = process.env,
): void {
  if (environment[LIVE_PROOF_OPT_IN_ENV] !== LIVE_PROOF_OPT_IN_VALUE) {
    throw new Error(
      `Physical live proof is disabled. Set ${LIVE_PROOF_OPT_IN_ENV}=${LIVE_PROOF_OPT_IN_VALUE} only for an explicitly authorized disposable proof.`,
    );
  }
}

/**
 * Use only Cline's reviewed local-Hub lifecycle boundary for proof cleanup. Because
 * the proof installs an isolated CLINE_DIR/data dir/address into process.env before
 * Hub creation, Cline's default owner context resolves to the disposable proof Hub.
 * Never fall back to process enumeration or generic kill commands.
 */
export async function stopLiveProofHubGracefully(): Promise<void> {
  const stop = (ClineHub as unknown as ClineHubLifecycleSurface).stopLocalHubServerGracefully;
  if (typeof stop !== "function") {
    throw new Error(
      "Pinned @cline/core Hub surface does not expose stopLocalHubServerGracefully; refusing unsafe live-proof cleanup",
    );
  }
  const stopped = await stop();
  if (!stopped) {
    throw new Error(
      "Cline did not confirm graceful shutdown of the isolated live-proof Hub; refusing to remove its data directory",
    );
  }
}

export function hasLiveProofHubShutdownSurface(): boolean {
  return typeof (ClineHub as unknown as ClineHubLifecycleSurface).stopLocalHubServerGracefully === "function";
}

async function allocateLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  try {
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Could not allocate an isolated loopback Hub port");
    }
    return address.port;
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await execFile("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    windowsHide: true,
  });
  return result.stdout.trimEnd();
}

export function assertDisposableWorkspaceRoot(root: string): string {
  const resolved = path.resolve(root);
  const base = path.basename(resolved).toLowerCase();
  if (!base.startsWith("orchestrator-live-proof-")) {
    throw new Error(
      "Live proof workspace root must be a disposable orchestrator-live-proof-* directory",
    );
  }
  return resolved;
}

export async function createDisposableProofWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "orchestrator-live-proof-"));
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "src", "demo.ts"), "export const value = 1;\n", "utf8");
  await writeFile(path.join(root, ".env"), "PROOF_SECRET=isolated-test-value\n", "utf8");
  await writeFile(path.join(root, "outside.txt"), "protected baseline\n", "utf8");

  await git(root, "init");
  await git(root, "config", "user.name", "Cline Orchestrator Proof");
  await git(root, "config", "user.email", "proof@example.invalid");
  // Keep this disposable repository independent from the operator's global
  // checkout policy. On Windows, core.autocrlf=true would make `git reset
  // --hard` restore committed LF content as CRLF, which is Git-equivalent but
  // defeats the proof's byte-exact rollback assertion.
  await git(root, "config", "core.autocrlf", "false");
  await git(root, "add", ".");
  await git(root, "commit", "-m", "isolated owner-loss proof baseline");

  return assertDisposableWorkspaceRoot(root);
}

export async function createLiveProofIsolation(): Promise<LiveProofIsolation> {
  const root = await mkdtemp(path.join(os.tmpdir(), "cline-orchestrator-owner-loss-"));
  const clineDir = path.join(root, ".cline");
  const clineDataDir = path.join(clineDir, "data");
  const registryPath = path.join(root, "workspace-registry.json");
  await mkdir(clineDataDir, { recursive: true });

  const hubPort = await allocateLoopbackPort();
  const hubAddress = `127.0.0.1:${hubPort}`;
  if (hubPort === 25463) {
    throw new Error("Refusing to use Cline's default Hub port for an isolated proof");
  }

  return {
    root,
    registryPath,
    clineDir,
    clineDataDir,
    hubPort,
    hubAddress,
    environment: {
      CLINE_DIR: clineDir,
      CLINE_DATA_DIR: clineDataDir,
      CLINE_HUB_PORT: String(hubPort),
      CLINE_HUB_ADDRESS: hubAddress,
      CLINE_SESSION_BACKEND_MODE: "hub",
    },
  };
}
