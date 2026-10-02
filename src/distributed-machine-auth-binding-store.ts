import { lstat, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { atomicWriteUtf8 } from "./atomic-write.js";
import {
  assertDistributedMachineAuthenticationBinding,
  type DistributedMachineAuthenticationBindingLookup,
  type DistributedMachineAuthenticationBindingV1,
} from "./distributed-machine-auth-bootstrap.js";

const STORE_SCHEMA_VERSION = 1 as const;
const MAX_BINDINGS = 256;
const MAX_STORE_BYTES = 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface BindingSnapshotV1 {
  schemaVersion: 1;
  bindings: DistributedMachineAuthenticationBindingV1[];
}

export interface DistributedMachineAuthenticationBindingPutExpectation {
  absent?: true;
  publicKeyFingerprint?: string;
  registrationRevision?: number;
}

export interface DistributedMachineAuthenticationBindingDeleteExpectation {
  publicKeyFingerprint: string;
  registrationRevision: number;
}

export class DistributedMachineAuthenticationBindingStoreError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "binding_not_found"
      | "binding_conflict"
      | "store_corrupt"
      | "store_capacity_exceeded"
      | "store_path_invalid"
      | "store_permissions_invalid",
  ) {
    super(message);
    this.name = "DistributedMachineAuthenticationBindingStoreError";
  }
}

function requireUuid(value: unknown, field: string): string {
  if (typeof value !== "string" || value !== value.trim() || !UUID.test(value)) {
    throw new DistributedMachineAuthenticationBindingStoreError(
      `${field} must be a canonical UUID`,
      "binding_conflict",
    );
  }
  return value;
}

function exactRoot(value: unknown): BindingSnapshotV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DistributedMachineAuthenticationBindingStoreError(
      "binding store root is invalid",
      "store_corrupt",
    );
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    keys.length !== 2
    || !keys.includes("schemaVersion")
    || !keys.includes("bindings")
    || record.schemaVersion !== STORE_SCHEMA_VERSION
    || !Array.isArray(record.bindings)
  ) {
    throw new DistributedMachineAuthenticationBindingStoreError(
      "binding store schema is invalid",
      "store_corrupt",
    );
  }
  if (record.bindings.length > MAX_BINDINGS) {
    throw new DistributedMachineAuthenticationBindingStoreError(
      "binding store exceeds capacity",
      "store_corrupt",
    );
  }

  const seen = new Set<string>();
  const bindings: DistributedMachineAuthenticationBindingV1[] = [];
  try {
    for (const raw of record.bindings) {
      assertDistributedMachineAuthenticationBinding(raw);
      const binding = structuredClone(raw);
      if (seen.has(binding.registrationId)) {
        throw new DistributedMachineAuthenticationBindingStoreError(
          "binding store contains duplicate registration id",
          "store_corrupt",
        );
      }
      seen.add(binding.registrationId);
      bindings.push(binding);
    }
  } catch (error) {
    if (error instanceof DistributedMachineAuthenticationBindingStoreError) throw error;
    throw new DistributedMachineAuthenticationBindingStoreError(
      "binding store contains invalid binding",
      "store_corrupt",
    );
  }

  bindings.sort((a, b) => a.registrationId.localeCompare(b.registrationId));
  return { schemaVersion: 1, bindings };
}

function exactExpectation(
  value: unknown,
): DistributedMachineAuthenticationBindingPutExpectation {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DistributedMachineAuthenticationBindingStoreError(
      "binding write expectation is invalid",
      "binding_conflict",
    );
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  const allowed = ["absent", "publicKeyFingerprint", "registrationRevision"];
  if (keys.some((key) => !allowed.includes(key))) {
    throw new DistributedMachineAuthenticationBindingStoreError(
      "binding write expectation contains unsupported fields",
      "binding_conflict",
    );
  }
  if (record.absent === true) {
    if (keys.length !== 1) {
      throw new DistributedMachineAuthenticationBindingStoreError(
        "absent expectation cannot be combined with current-binding expectations",
        "binding_conflict",
      );
    }
    return { absent: true };
  }
  if (
    keys.length !== 2
    || typeof record.publicKeyFingerprint !== "string"
    || typeof record.registrationRevision !== "number"
    || !Number.isSafeInteger(record.registrationRevision)
    || record.registrationRevision < 1
  ) {
    throw new DistributedMachineAuthenticationBindingStoreError(
      "replacement requires current fingerprint and registration revision",
      "binding_conflict",
    );
  }
  return {
    publicKeyFingerprint: record.publicKeyFingerprint,
    registrationRevision: record.registrationRevision,
  };
}

function exactDeleteExpectation(
  value: unknown,
): DistributedMachineAuthenticationBindingDeleteExpectation {
  const parsed = exactExpectation(value);
  if (
    parsed.absent
    || parsed.publicKeyFingerprint === undefined
    || parsed.registrationRevision === undefined
  ) {
    throw new DistributedMachineAuthenticationBindingStoreError(
      "delete requires current fingerprint and registration revision",
      "binding_conflict",
    );
  }
  return {
    publicKeyFingerprint: parsed.publicKeyFingerprint,
    registrationRevision: parsed.registrationRevision,
  };
}

export class FileDistributedMachineAuthenticationBindingStore
implements DistributedMachineAuthenticationBindingLookup {
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {
    if (
      typeof filePath !== "string"
      || !path.isAbsolute(filePath)
      || path.normalize(filePath) !== filePath
      || path.basename(filePath) !== "machine-auth-bindings.json"
    ) {
      throw new DistributedMachineAuthenticationBindingStoreError(
        "binding store path must be an absolute canonical machine-auth-bindings.json path",
        "store_path_invalid",
      );
    }
  }

  private async assertParent(): Promise<void> {
    let info;
    try {
      info = await stat(path.dirname(this.filePath));
    } catch {
      throw new DistributedMachineAuthenticationBindingStoreError(
        "binding store parent directory is unavailable",
        "store_path_invalid",
      );
    }
    if (!info.isDirectory()) {
      throw new DistributedMachineAuthenticationBindingStoreError(
        "binding store parent must already be a directory",
        "store_path_invalid",
      );
    }
  }

  private async existingFileInfo(): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
    try {
      const info = await lstat(this.filePath);
      if (info.isSymbolicLink() || !info.isFile()) {
        throw new DistributedMachineAuthenticationBindingStoreError(
          "binding store path must be a regular non-symlink file",
          "store_path_invalid",
        );
      }
      if (info.size > MAX_STORE_BYTES) {
        throw new DistributedMachineAuthenticationBindingStoreError(
          "binding store exceeds byte limit",
          "store_corrupt",
        );
      }
      if (process.platform !== "win32" && (info.mode & 0o022) !== 0) {
        throw new DistributedMachineAuthenticationBindingStoreError(
          "binding store must not be writable by group or others",
          "store_permissions_invalid",
        );
      }
      return info;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return undefined;
      throw error;
    }
  }

  private async readSnapshot(): Promise<BindingSnapshotV1> {
    await this.assertParent();
    const info = await this.existingFileInfo();
    if (!info) return { schemaVersion: 1, bindings: [] };
    let raw: Buffer;
    try {
      raw = await readFile(this.filePath);
    } catch {
      throw new DistributedMachineAuthenticationBindingStoreError(
        "failed to read binding store",
        "store_corrupt",
      );
    }
    if (raw.length > MAX_STORE_BYTES) {
      throw new DistributedMachineAuthenticationBindingStoreError(
        "binding store exceeds byte limit",
        "store_corrupt",
      );
    }
    try {
      return exactRoot(JSON.parse(raw.toString("utf8")) as unknown);
    } catch (error) {
      if (error instanceof DistributedMachineAuthenticationBindingStoreError) throw error;
      throw new DistributedMachineAuthenticationBindingStoreError(
        "binding store is not valid JSON",
        "store_corrupt",
      );
    }
  }

  private async writeSnapshot(snapshot: BindingSnapshotV1): Promise<void> {
    await this.assertParent();
    await this.existingFileInfo();
    const canonical = exactRoot(snapshot);
    const body = `${JSON.stringify(canonical, null, 2)}\n`;
    if (Buffer.byteLength(body, "utf8") > MAX_STORE_BYTES) {
      throw new DistributedMachineAuthenticationBindingStoreError(
        "binding store exceeds capacity",
        "store_capacity_exceeded",
      );
    }
    try {
      await atomicWriteUtf8(this.filePath, body, { mode: 0o600 });
    } catch {
      throw new DistributedMachineAuthenticationBindingStoreError(
        "failed to atomically write binding store",
        "store_corrupt",
      );
    }
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationTail.then(operation, operation);
    this.mutationTail = result.then(() => undefined, () => undefined);
    return result;
  }

  async get(registrationId: string): Promise<DistributedMachineAuthenticationBindingV1> {
    registrationId = requireUuid(registrationId, "registrationId");
    const snapshot = await this.readSnapshot();
    const binding = snapshot.bindings.find((item) => item.registrationId === registrationId);
    if (!binding) {
      throw new DistributedMachineAuthenticationBindingStoreError(
        "machine authentication binding was not found",
        "binding_not_found",
      );
    }
    return structuredClone(binding);
  }

  async list(): Promise<DistributedMachineAuthenticationBindingV1[]> {
    const snapshot = await this.readSnapshot();
    return snapshot.bindings.map((item) => structuredClone(item));
  }

  async put(
    binding: DistributedMachineAuthenticationBindingV1,
    expected?: DistributedMachineAuthenticationBindingPutExpectation,
  ): Promise<DistributedMachineAuthenticationBindingV1> {
    assertDistributedMachineAuthenticationBinding(binding);
    const nextBinding = structuredClone(binding);
    const expectation = exactExpectation(expected);

    return this.serialize(async () => {
      const snapshot = await this.readSnapshot();
      const index = snapshot.bindings.findIndex(
        (item) => item.registrationId === nextBinding.registrationId,
      );
      if (expectation.absent) {
        if (index >= 0) {
          throw new DistributedMachineAuthenticationBindingStoreError(
            "machine authentication binding already exists",
            "binding_conflict",
          );
        }
        if (snapshot.bindings.length >= MAX_BINDINGS) {
          throw new DistributedMachineAuthenticationBindingStoreError(
            "binding store capacity exceeded",
            "store_capacity_exceeded",
          );
        }
        snapshot.bindings.push(nextBinding);
      } else {
        if (index < 0) {
          throw new DistributedMachineAuthenticationBindingStoreError(
            "machine authentication binding was not found",
            "binding_not_found",
          );
        }
        const current = snapshot.bindings[index]!;
        if (
          current.publicKeyFingerprint !== expectation.publicKeyFingerprint
          || current.registrationRevision !== expectation.registrationRevision
        ) {
          throw new DistributedMachineAuthenticationBindingStoreError(
            "machine authentication binding changed",
            "binding_conflict",
          );
        }
        snapshot.bindings[index] = nextBinding;
      }
      await this.writeSnapshot(snapshot);
      return structuredClone(nextBinding);
    });
  }

  async delete(
    registrationId: string,
    expected: DistributedMachineAuthenticationBindingDeleteExpectation,
  ): Promise<void> {
    registrationId = requireUuid(registrationId, "registrationId");
    const expectation = exactDeleteExpectation(expected);
    await this.serialize(async () => {
      const snapshot = await this.readSnapshot();
      const index = snapshot.bindings.findIndex((item) => item.registrationId === registrationId);
      if (index < 0) {
        throw new DistributedMachineAuthenticationBindingStoreError(
          "machine authentication binding was not found",
          "binding_not_found",
        );
      }
      const current = snapshot.bindings[index]!;
      if (
        current.publicKeyFingerprint !== expectation.publicKeyFingerprint
        || current.registrationRevision !== expectation.registrationRevision
      ) {
        throw new DistributedMachineAuthenticationBindingStoreError(
          "machine authentication binding changed",
          "binding_conflict",
        );
      }
      snapshot.bindings.splice(index, 1);
      await this.writeSnapshot(snapshot);
    });
  }
}
