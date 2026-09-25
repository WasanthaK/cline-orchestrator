import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { atomicWriteUtf8 } from "./atomic-write.js";
import {
  acquireWorkspaceWriter,
  assertWorkspaceLockState,
  createWorkspaceLockState,
  releaseWorkspaceWriter,
  validateWorkspaceWriterClaim,
  WorkspaceLockError,
  type WorkspaceLockOptions,
  type WorkspaceLockStateV1,
  type WorkspaceWriterAcquireRequest,
  type WorkspaceWriterClaimV1,
} from "./workspace-lock.js";

const mutationTails = new Map<string, Promise<void>>();

async function serializeMutation<T>(key: string, mutate: () => Promise<T>): Promise<T> {
  const previous = mutationTails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.catch(() => undefined).then(() => gate);
  mutationTails.set(key, tail);

  await previous.catch(() => undefined);
  try {
    return await mutate();
  } finally {
    release();
    if (mutationTails.get(key) === tail) mutationTails.delete(key);
  }
}

function cloneState(state: WorkspaceLockStateV1): WorkspaceLockStateV1 {
  return structuredClone(state);
}

/**
 * Machine-local persistence for workspace writer coordination.
 *
 * The store deliberately persists opaque workspace/task/owner/lease/fence IDs only.
 * A stored lease is coordination evidence, never task, filesystem, Safety Plan, Hub,
 * command, network or model authority. Callers must independently revalidate the
 * durable task/Safety Plan before any write-capable execution.
 *
 * Mutations are serialized across store instances in this Node process. This is a
 * single-gateway coordination primitive, not a distributed lock service; enabling
 * multiple independent gateway processes requires a separately reviewed fencing
 * backend rather than weakening these semantics.
 */
export class WorkspaceLockStore {
  constructor(private readonly rootDir: string) {}

  private locksDir(): string {
    return path.join(this.rootDir, "workspace-locks");
  }

  private lockPath(workspaceId: string): string {
    const id = createWorkspaceLockState(workspaceId).workspaceId;
    return path.join(this.locksDir(), `${id}.json`);
  }

  private async readState(workspaceId: string): Promise<WorkspaceLockStateV1> {
    const filePath = this.lockPath(workspaceId);
    try {
      const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
      assertWorkspaceLockState(parsed);
      const state = parsed as WorkspaceLockStateV1;
      if (state.workspaceId !== workspaceId) {
        throw new WorkspaceLockError(
          "Persisted workspace lock identity does not match its storage key",
          "lock_invalid",
        );
      }
      return cloneState(state);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
        return createWorkspaceLockState(workspaceId);
      }
      if (error instanceof WorkspaceLockError) throw error;
      throw new WorkspaceLockError("Persisted workspace lock state is unreadable or invalid", "lock_invalid");
    }
  }

  private async writeState(state: WorkspaceLockStateV1): Promise<void> {
    assertWorkspaceLockState(state);
    await mkdir(this.locksDir(), { recursive: true });
    await atomicWriteUtf8(
      this.lockPath(state.workspaceId),
      `${JSON.stringify(state, null, 2)}\n`,
    );
  }

  async load(workspaceId: string): Promise<WorkspaceLockStateV1> {
    return this.readState(workspaceId);
  }

  async acquire(
    request: WorkspaceWriterAcquireRequest,
    options: WorkspaceLockOptions = {},
  ): Promise<{ state: WorkspaceLockStateV1; claim: WorkspaceWriterClaimV1; replacedExpiredLease: boolean }> {
    const key = this.lockPath(request.workspaceId);
    return serializeMutation(key, async () => {
      const current = await this.readState(request.workspaceId);
      const acquired = acquireWorkspaceWriter(current, request, options);
      await this.writeState(acquired.state);
      return {
        state: cloneState(acquired.state),
        claim: structuredClone(acquired.claim),
        replacedExpiredLease: acquired.replacedExpiredLease,
      };
    });
  }

  async validate(claim: WorkspaceWriterClaimV1, now: Date = new Date()): Promise<WorkspaceLockStateV1> {
    const state = await this.readState(claim.workspaceId);
    validateWorkspaceWriterClaim(state, claim, now);
    return cloneState(state);
  }

  async release(claim: WorkspaceWriterClaimV1): Promise<WorkspaceLockStateV1> {
    const key = this.lockPath(claim.workspaceId);
    return serializeMutation(key, async () => {
      const current = await this.readState(claim.workspaceId);
      const released = releaseWorkspaceWriter(current, claim);
      await this.writeState(released);
      return cloneState(released);
    });
  }
}
