import { realpath } from "node:fs/promises";
import path from "node:path";
import { ClineCore } from "@cline/sdk";
import { ensureClineHubDaemonEntryCompatibility } from "./cline-hub-compat.js";

export type ClineRuntimeMode = "local" | "hub";

export interface ClineRuntime {
  start(input: unknown): Promise<any>;
  send(input: unknown): Promise<any>;
  abort(sessionId: string, reason?: Error): Promise<any>;
  subscribe(listener: (event: any) => void, options?: unknown): unknown;
  get?(sessionId: string): Promise<any>;
  dispose(reason?: string): Promise<void>;
}

export interface ClineRuntimeCreateRequest {
  mode: ClineRuntimeMode;
  workspaceRoot: string;
}

export interface ClineRuntimeFactory {
  create(request: ClineRuntimeCreateRequest): Promise<ClineRuntime>;
}

export type ClineCoreCreator = (options: Record<string, unknown>) => Promise<ClineRuntime>;

function defaultCreator(options: Record<string, unknown>): Promise<ClineRuntime> {
  return ClineCore.create(options as any) as Promise<ClineRuntime>;
}

export class SdkClineRuntimeFactory implements ClineRuntimeFactory {
  constructor(private readonly createCore: ClineCoreCreator = defaultCreator) {}

  async create(request: ClineRuntimeCreateRequest): Promise<ClineRuntime> {
    if (request.mode === "local") {
      return await this.createCore({
        clientName: "cline-orchestrator",
        backendMode: "local",
      });
    }

    // @cline/core 0.0.83 publishes the daemon entry correctly but its bundled
    // launcher resolves a missing dist/entry.js. Prepare the exact pinned
    // compatibility entry before Cline performs its own Hub discovery, locking,
    // compatibility checks, and safe retirement logic.
    await ensureClineHubDaemonEntryCompatibility();

    return await this.createCore({
      clientName: "cline-orchestrator",
      backendMode: "hub",
      hub: {
        strategy: "require-hub",
        clientType: "cline-orchestrator",
        displayName: "Cline Orchestrator",
        workspaceRoot: request.workspaceRoot,
        cwd: request.workspaceRoot,
      },
    });
  }
}

export class RuntimeWorkspaceMismatchError extends Error {
  readonly code = "runtime_workspace_mismatch";

  constructor(
    readonly sessionId: string,
    readonly expectedWorkspace: string,
    readonly actualWorkspace?: string,
  ) {
    super(
      actualWorkspace
        ? `Runtime session ${sessionId} belongs to a different workspace`
        : `Runtime session ${sessionId} did not report a workspace root`,
    );
    this.name = "RuntimeWorkspaceMismatchError";
  }
}

function normalizeForCompare(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

/**
 * Fail-closed identity check used before resuming an existing Hub session.
 * A missing session is deliberately allowed to propagate as the SDK's
 * session_not_found error so ClineRunner can use its existing recovery path.
 */
export async function verifyRuntimeSessionWorkspace(
  runtime: ClineRuntime,
  sessionId: string,
  expectedWorkspace: string,
): Promise<void> {
  if (typeof runtime.get !== "function") {
    throw new RuntimeWorkspaceMismatchError(sessionId, expectedWorkspace);
  }

  const session = await runtime.get(sessionId);
  const actual = typeof session?.workspaceRoot === "string" ? session.workspaceRoot : undefined;
  if (!actual) {
    throw new RuntimeWorkspaceMismatchError(sessionId, expectedWorkspace);
  }

  const [expectedCanonical, actualCanonical] = await Promise.all([
    realpath(expectedWorkspace),
    realpath(actual),
  ]);
  if (normalizeForCompare(expectedCanonical) !== normalizeForCompare(actualCanonical)) {
    throw new RuntimeWorkspaceMismatchError(sessionId, expectedCanonical, actualCanonical);
  }
}
