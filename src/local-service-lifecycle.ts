export type LocalServiceManager = "windows-service" | "systemd";
export type LocalServiceLifecycleAction = "install" | "start" | "stop" | "status";

export const LOCAL_SERVICE_LIFECYCLE_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  authority: "local_service_lifecycle_explicit_action" as const,
  supportedManagers: ["windows-service", "systemd"] as const,
  explicitMutationRequired: true as const,
  statusReadOnly: true as const,
  loopbackOnlyDefault: true as const,
  embedsSecretMaterial: false as const,
  opensRemoteListener: false as const,
  grantsTaskAuthority: false as const,
  grantsFilesystemAuthority: false as const,
  grantsCredentialAuthority: false as const,
  grantsReleaseAuthority: false as const,
});

export interface LocalServiceSpecV1 {
  schemaVersion: 1;
  manager: LocalServiceManager;
  serviceName: string;
  displayName: string;
  executable: string;
  args: string[];
  workingDirectory: string;
  configPath: string;
  secretReferenceNames: string[];
  daemonHost: "127.0.0.1" | "localhost" | "::1";
  daemonPort: number;
  autoStart: false;
  authority: "local_service_specification_only";
  grantsAuthority: false;
}

export interface LocalServiceStatusV1 {
  schemaVersion: 1;
  serviceName: string;
  installed: boolean;
  running: boolean;
  manager: LocalServiceManager;
  authority: "local_service_status_observation";
  grantsAuthority: false;
}

export interface LocalServiceLifecycleDriver {
  install(spec: LocalServiceSpecV1): Promise<void>;
  start(spec: LocalServiceSpecV1): Promise<void>;
  stop(spec: LocalServiceSpecV1): Promise<void>;
  status(spec: LocalServiceSpecV1): Promise<LocalServiceStatusV1>;
}

export interface LocalServiceLifecycleResultV1 {
  schemaVersion: 1;
  action: LocalServiceLifecycleAction;
  serviceName: string;
  manager: LocalServiceManager;
  completedAt: string;
  status?: LocalServiceStatusV1;
  authority: "local_service_lifecycle_result";
  opensRemoteListener: false;
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}

export interface LocalServiceLifecycleOptions {
  now?: () => Date;
}

export class LocalServiceLifecycleError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "spec_invalid"
      | "action_invalid"
      | "driver_failed"
      | "status_invalid",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "LocalServiceLifecycleError";
  }
}

const SAFE_NAME = /^[A-Za-z0-9._-]{1,96}$/;
const SAFE_SECRET_REF = /^[A-Z][A-Z0-9_]{2,127}$/;

function assertSpec(spec: LocalServiceSpecV1): void {
  if (
    spec.schemaVersion !== 1
    || !["windows-service", "systemd"].includes(spec.manager)
    || !SAFE_NAME.test(spec.serviceName)
    || !spec.displayName.trim()
    || !spec.executable.trim()
    || !spec.workingDirectory.trim()
    || !spec.configPath.trim()
    || !Array.isArray(spec.args)
    || spec.args.some((arg) => typeof arg !== "string" || arg.includes("\0"))
    || spec.secretReferenceNames.some((item) => !SAFE_SECRET_REF.test(item))
    || !["127.0.0.1", "localhost", "::1"].includes(spec.daemonHost)
    || !Number.isSafeInteger(spec.daemonPort)
    || spec.daemonPort < 1
    || spec.daemonPort > 65535
    || spec.autoStart !== false
    || spec.authority !== "local_service_specification_only"
    || spec.grantsAuthority !== false
  ) {
    throw new LocalServiceLifecycleError(
      "local service specification is invalid or authority-widened",
      "spec_invalid",
    );
  }

  const serialized = JSON.stringify(spec).toLowerCase();
  if (
    serialized.includes("apikey")
    || serialized.includes("api_key")
    || serialized.includes("password")
    || serialized.includes("bearer ")
    || serialized.includes("credential")
  ) {
    throw new LocalServiceLifecycleError(
      "local service specification must reference secrets by name only",
      "spec_invalid",
    );
  }
}

function assertStatus(spec: LocalServiceSpecV1, status: LocalServiceStatusV1): void {
  if (
    status.schemaVersion !== 1
    || status.serviceName !== spec.serviceName
    || status.manager !== spec.manager
    || typeof status.installed !== "boolean"
    || typeof status.running !== "boolean"
    || status.authority !== "local_service_status_observation"
    || status.grantsAuthority !== false
  ) {
    throw new LocalServiceLifecycleError(
      "local service status is invalid or cross-bound",
      "status_invalid",
    );
  }
}

export class LocalServiceLifecycleService {
  constructor(
    private readonly driver: LocalServiceLifecycleDriver,
    private readonly options: LocalServiceLifecycleOptions = {},
  ) {}

  async execute(
    action: LocalServiceLifecycleAction,
    specInput: LocalServiceSpecV1,
  ): Promise<LocalServiceLifecycleResultV1> {
    const spec = structuredClone(specInput);
    assertSpec(spec);

    if (!["install", "start", "stop", "status"].includes(action)) {
      throw new LocalServiceLifecycleError(
        "local service lifecycle action is invalid",
        "action_invalid",
      );
    }

    let status: LocalServiceStatusV1 | undefined;
    try {
      switch (action) {
        case "install":
          await this.driver.install(spec);
          break;
        case "start":
          await this.driver.start(spec);
          break;
        case "stop":
          await this.driver.stop(spec);
          break;
        case "status":
          status = await this.driver.status(spec);
          assertStatus(spec, status);
          break;
      }
    } catch (error) {
      if (error instanceof LocalServiceLifecycleError) throw error;
      throw new LocalServiceLifecycleError(
        "local service lifecycle driver failed",
        "driver_failed",
        { cause: error },
      );
    }

    const now = (this.options.now ?? (() => new Date()))();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
      throw new LocalServiceLifecycleError(
        "local service lifecycle clock is invalid",
        "driver_failed",
      );
    }

    return Object.freeze({
      schemaVersion: 1,
      action,
      serviceName: spec.serviceName,
      manager: spec.manager,
      completedAt: now.toISOString(),
      ...(status ? { status } : {}),
      authority: "local_service_lifecycle_result",
      opensRemoteListener: false,
      grantsTaskAuthority: false,
      grantsFilesystemAuthority: false,
      grantsCredentialAuthority: false,
      grantsReleaseAuthority: false,
    });
  }
}
