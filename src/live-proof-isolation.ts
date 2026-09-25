import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

export interface LiveProofIsolation {
  root: string;
  registryPath: string;
  clineDir: string;
  clineDataDir: string;
  hubPort: number;
  hubAddress: string;
  environment: Record<string, string>;
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
