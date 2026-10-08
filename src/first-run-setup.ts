import crypto from "node:crypto";

export type FirstRunSetupAction =
  | "write_config"
  | "register_project"
  | "register_workspace"
  | "start_loopback_daemon";

export const FIRST_RUN_SETUP_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  authority: "first_run_setup_explicit_local_action" as const,
  explicitConfirmationRequired: true as const,
  oneActionPerConfirmation: true as const,
  singleUse: true as const,
  shortLived: true as const,
  remoteListenerAllowed: false as const,
  elevatedAuthorityAllowed: false as const,
  grantsTaskAuthority: false as const,
  grantsFilesystemAuthority: false as const,
  grantsCredentialAuthority: false as const,
  grantsReleaseAuthority: false as const,
});

export interface FirstRunSetupRequestV1 {
  schemaVersion: 1;
  action: FirstRunSetupAction;
  payload: Record<string, unknown>;
}

export interface FirstRunSetupPreviewV1 {
  schemaVersion: 1;
  action: FirstRunSetupAction;
  payloadDigest: string;
  confirmationText: string;
  expiresAt: string;
  confirmationToken: string;
  authority: "first_run_setup_preview_only";
  grantsAuthority: false;
}

export interface FirstRunSetupResultV1 {
  schemaVersion: 1;
  action: FirstRunSetupAction;
  payloadDigest: string;
  completedAt: string;
  authority: "first_run_setup_result";
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}

export interface FirstRunSetupDriver {
  writeConfig(payload: Record<string, unknown>): Promise<void>;
  registerProject(payload: Record<string, unknown>): Promise<void>;
  registerWorkspace(payload: Record<string, unknown>): Promise<void>;
  startLoopbackDaemon(payload: Record<string, unknown>): Promise<void>;
}

export interface FirstRunSetupOptions {
  now?: () => number;
  tokenFactory?: () => string;
}

export class FirstRunSetupError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "action_invalid"
      | "payload_invalid"
      | "confirmation_invalid"
      | "confirmation_expired"
      | "execution_failed"
      | "capacity_exceeded",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "FirstRunSetupError";
  }
}

interface PendingSetup {
  action: FirstRunSetupAction;
  payload: Record<string, unknown>;
  payloadDigest: string;
  expiresAtMs: number;
}

const TOKEN_LIFETIME_MS = 60_000;
const MAX_PENDING = 32;
const MAX_JSON_CHARS = 20_000;

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

function payloadDigest(payload: Record<string, unknown>): string {
  return crypto.createHash("sha256").update(stable(payload)).digest("hex");
}

function assertPlainPayload(action: FirstRunSetupAction, payload: Record<string, unknown>): void {
  const serialized = JSON.stringify(payload);
  if (
    !payload
    || typeof payload !== "object"
    || Array.isArray(payload)
    || serialized.length > MAX_JSON_CHARS
    || serialized.includes("\0")
  ) {
    throw new FirstRunSetupError("setup payload is invalid or oversized", "payload_invalid");
  }

  const text = serialized.toLowerCase();
  if (
    text.includes("apikey")
    || text.includes("api_key")
    || text.includes("password")
    || text.includes("credential")
    || text.includes("bearer ")
    || text.includes("token")
  ) {
    throw new FirstRunSetupError(
      "setup payload must not contain raw secret material",
      "payload_invalid",
    );
  }

  if (action === "start_loopback_daemon") {
    const host = payload.host;
    if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
      throw new FirstRunSetupError(
        "first-run daemon start is loopback-only",
        "payload_invalid",
      );
    }
  }
}

function confirmationText(action: FirstRunSetupAction): string {
  switch (action) {
    case "write_config":
      return "Write only the previewed local product configuration";
    case "register_project":
      return "Register only the previewed local project";
    case "register_workspace":
      return "Register only the previewed workspace and safety profile";
    case "start_loopback_daemon":
      return "Start only the previewed loopback daemon";
  }
}

export class FirstRunSetupService {
  private readonly pending = new Map<string, PendingSetup>();

  constructor(
    private readonly driver: FirstRunSetupDriver,
    private readonly options: FirstRunSetupOptions = {},
  ) {}

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  private token(): string {
    return (this.options.tokenFactory ?? (() => crypto.randomBytes(32).toString("hex")))();
  }

  private prepare(now: number): void {
    for (const [token, entry] of this.pending) {
      if (entry.expiresAtMs <= now) this.pending.delete(token);
    }
    if (this.pending.size >= MAX_PENDING) {
      throw new FirstRunSetupError("too many pending setup confirmations", "capacity_exceeded");
    }
  }

  async preview(request: FirstRunSetupRequestV1): Promise<FirstRunSetupPreviewV1> {
    if (
      request.schemaVersion !== 1
      || !["write_config", "register_project", "register_workspace", "start_loopback_daemon"].includes(request.action)
    ) {
      throw new FirstRunSetupError("setup action is invalid", "action_invalid");
    }
    const payload = structuredClone(request.payload);
    assertPlainPayload(request.action, payload);

    const now = this.now();
    this.prepare(now);
    const token = this.token();
    if (typeof token !== "string" || token.length < 32 || token.includes("\0")) {
      throw new FirstRunSetupError("setup confirmation token is invalid", "confirmation_invalid");
    }
    const digest = payloadDigest(payload);
    const expiresAtMs = now + TOKEN_LIFETIME_MS;
    this.pending.set(token, {
      action: request.action,
      payload,
      payloadDigest: digest,
      expiresAtMs,
    });

    return {
      schemaVersion: 1,
      action: request.action,
      payloadDigest: digest,
      confirmationText: confirmationText(request.action),
      expiresAt: new Date(expiresAtMs).toISOString(),
      confirmationToken: token,
      authority: "first_run_setup_preview_only",
      grantsAuthority: false,
    };
  }

  async execute(input: {
    action: FirstRunSetupAction;
    payloadDigest: string;
    confirmationToken: string;
    confirmed: true;
  }): Promise<FirstRunSetupResultV1> {
    if (input.confirmed !== true) {
      throw new FirstRunSetupError("explicit setup confirmation is required", "confirmation_invalid");
    }

    const entry = this.pending.get(input.confirmationToken);
    if (
      !entry
      || entry.action !== input.action
      || entry.payloadDigest !== input.payloadDigest
    ) {
      throw new FirstRunSetupError(
        "setup confirmation is invalid or already used",
        "confirmation_invalid",
      );
    }

    // Burn before first await so replay/concurrent confirmation cannot execute twice.
    this.pending.delete(input.confirmationToken);

    const now = this.now();
    if (now >= entry.expiresAtMs) {
      throw new FirstRunSetupError("setup confirmation expired", "confirmation_expired");
    }

    try {
      switch (entry.action) {
        case "write_config":
          await this.driver.writeConfig(structuredClone(entry.payload));
          break;
        case "register_project":
          await this.driver.registerProject(structuredClone(entry.payload));
          break;
        case "register_workspace":
          await this.driver.registerWorkspace(structuredClone(entry.payload));
          break;
        case "start_loopback_daemon":
          await this.driver.startLoopbackDaemon(structuredClone(entry.payload));
          break;
      }
    } catch (error) {
      throw new FirstRunSetupError(
        "first-run setup action failed after confirmation was consumed",
        "execution_failed",
        { cause: error },
      );
    }

    return Object.freeze({
      schemaVersion: 1,
      action: entry.action,
      payloadDigest: entry.payloadDigest,
      completedAt: new Date(now).toISOString(),
      authority: "first_run_setup_result",
      grantsTaskAuthority: false,
      grantsFilesystemAuthority: false,
      grantsCredentialAuthority: false,
      grantsReleaseAuthority: false,
    });
  }
}
