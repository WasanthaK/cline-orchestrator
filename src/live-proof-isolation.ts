import { mkdir, mkdtemp } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";

export interface LiveProofIsolation {
  root: string;
  registryPath: string;
  clineDir: string;
  clineDataDir: string;
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

export async function createLiveProofIsolation(): Promise<LiveProofIsolation> {
  const root = await mkdtemp(path.join(os.tmpdir(), "cline-orchestrator-owner-loss-"));
  const clineDir = path.join(root, ".cline");
  const clineDataDir = path.join(clineDir, "data");
  const registryPath = path.join(root, "workspace-registry.json");
  await mkdir(clineDataDir, { recursive: true });

  const port = await allocateLoopbackPort();
  const hubAddress = `127.0.0.1:${port}`;
  if (hubAddress === "127.0.0.1:25463") {
    throw new Error("Refusing to use Cline's default Hub address for an isolated proof");
  }

  return {
    root,
    registryPath,
    clineDir,
    clineDataDir,
    hubAddress,
    environment: {
      CLINE_DIR: clineDir,
      CLINE_DATA_DIR: clineDataDir,
      CLINE_HUB_ADDRESS: hubAddress,
      CLINE_SESSION_BACKEND_MODE: "hub",
    },
  };
}
