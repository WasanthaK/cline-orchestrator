import http from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { OperatorVisualizationV1 } from "./operator-visualization.js";
import type { MachineOrchestratorService } from "./machine-orchestrator.js";
import { RemoteSessionGateway } from "./remote-session-gateway.js";

const MAX_BODY_BYTES = 64 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

export interface RemoteTaskValidationStatusV1 {
  schemaVersion: 1;
  taskId: string;
  workspaceId: string;
  status: string;
  updatedAt: string;
  runCount: number;
  validation: {
    configuredCommands: number;
    runCount: number;
    repairCount: number;
    lastPassed?: boolean;
    lastCompletedAt?: string;
  };
  diffSafety?: {
    checkedAt: string;
    passed: boolean;
    changedFiles: number;
    warningCount: number;
    failureCount: number;
  };
  waitingForHuman: boolean;
}

export interface RemoteSupervisorDecisionSummaryV1 {
  schemaVersion: 1;
  plannerProposals: number;
  reviewerPasses: number;
  reviewerRepairs: number;
  reviewerEscalations: number;
  pendingHumanEscalations: number;
}

export interface RemoteActiveWriterStatusV1 {
  schemaVersion: 1;
  writers: Array<{
    workspaceId: string;
    taskId: string;
    acquiredAt: string;
    expiresAt: string;
    leaseState: "active" | "expiring";
  }>;
}

export interface RemoteTransportReadService {
  getPassiveVisualization(): Promise<OperatorVisualizationV1>;
  getTaskValidationStatus(taskId: string): Promise<RemoteTaskValidationStatusV1>;
  getSupervisorDecisionSummary(): Promise<RemoteSupervisorDecisionSummaryV1>;
  getActiveWriterStatus(): Promise<RemoteActiveWriterStatusV1>;
}

export interface LoopbackRemoteTransportConfig {
  host: "127.0.0.1" | "localhost" | "::1";
  port: number;
  pathPrefix?: string;
}

export class RemoteTransportError extends Error {
  constructor(
    message: string,
    readonly code:
      | "bad_request"
      | "unauthorized"
      | "route_not_found"
      | "method_not_allowed"
      | "content_type_required"
      | "host_not_allowed"
      | "origin_not_allowed",
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "RemoteTransportError";
  }
}

function exactObject(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RemoteTransportError("JSON request body must be an object", "bad_request", 400);
  }
  const record = value as Record<string, unknown>;
  const extras = Object.keys(record).filter((key) => !allowed.includes(key));
  if (extras.length > 0) {
    throw new RemoteTransportError(`Unexpected request field(s): ${extras.join(", ")}`, "bad_request", 400);
  }
  return record;
}

function requireUuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new RemoteTransportError(`${field} must be an opaque UUID`, "bad_request", 400);
  }
  return value;
}

function bearer(req: IncomingMessage): string {
  const value = req.headers.authorization;
  if (!value || Array.isArray(value)) {
    throw new RemoteTransportError("Bearer authentication is required", "unauthorized", 401);
  }
  const match = value.match(/^Bearer ([A-Za-z0-9._~-]{32,512})$/);
  if (!match) {
    throw new RemoteTransportError("Bearer authentication is malformed", "unauthorized", 401);
  }
  return match[1]!;
}

function requestId(req: IncomingMessage): string {
  const value = req.headers["x-orchestrator-request-id"];
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new RemoteTransportError(
      "x-orchestrator-request-id must be an opaque UUID",
      "bad_request",
      400,
    );
  }
  return value;
}

function validateHost(req: IncomingMessage): void {
  const host = req.headers.host;
  if (typeof host !== "string" || !host.trim()) {
    throw new RemoteTransportError("Host header is required", "host_not_allowed", 403);
  }
  let parsed: URL;
  try {
    parsed = new URL(`http://${host}`);
  } catch {
    throw new RemoteTransportError("Host header is malformed", "host_not_allowed", 403);
  }
  if (!LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw new RemoteTransportError("Host header must identify loopback", "host_not_allowed", 403);
  }
}

function validateOrigin(req: IncomingMessage): void {
  const origin = req.headers.origin;
  if (origin === undefined) return;
  const values = Array.isArray(origin) ? origin : [origin];
  for (const value of values) {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new RemoteTransportError("Origin is malformed", "origin_not_allowed", 403);
    }
    if (!LOOPBACK_HOSTS.has(parsed.hostname)) {
      throw new RemoteTransportError("Browser-origin requests are limited to loopback", "origin_not_allowed", 403);
    }
  }
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const contentType = String(req.headers["content-type"] ?? "").toLowerCase();
  if (!contentType.startsWith("application/json")) {
    throw new RemoteTransportError("application/json is required", "content_type_required", 415);
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > MAX_BODY_BYTES) {
      throw new RemoteTransportError("Request body is too large", "bad_request", 413);
    }
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new RemoteTransportError("Request body must be valid JSON", "bad_request", 400);
  }
}

function json(res: ServerResponse, statusCode: number, value: unknown): void {
  const body = `${JSON.stringify(value)}\n`;
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(body);
}

function normalizedPrefix(value: string | undefined): string {
  const raw = (value ?? "/remote/v1").trim();
  if (!raw.startsWith("/") || raw.includes("..") || raw.includes("?") || raw.includes("#")) {
    throw new Error("remote transport pathPrefix must be an absolute URL path");
  }
  return raw.length > 1 ? raw.replace(/\/+$/, "") : raw;
}

function errorResponse(error: unknown): { statusCode: number; code: string; message: string } {
  if (error instanceof RemoteTransportError) {
    return { statusCode: error.statusCode, code: error.code, message: error.message };
  }
  const code = typeof (error as { code?: unknown })?.code === "string"
    ? String((error as { code: string }).code)
    : "request_failed";
  if (["session_not_found", "session_expired", "session_stale", "registration_revoked"].includes(code)) {
    return { statusCode: 401, code, message: "Remote session is not current" };
  }
  if (["request_replayed", "rate_limited", "capacity_exceeded", "capability_not_allowed"].includes(code)) {
    return { statusCode: code === "rate_limited" ? 429 : 403, code, message: "Remote request was denied" };
  }
  return { statusCode: 500, code: "request_failed", message: "Remote request failed" };
}

/**
 * Minimal machine-backed implementation for the task-validation read capability.
 * The other read capabilities are deliberately supplied by already-sanitized
 * operator/dashboard sources rather than reconstructing those data here.
 */
export class MachineRemoteTaskValidationReader {
  constructor(private readonly service: Pick<MachineOrchestratorService, "getTask">) {}

  async getTaskValidationStatus(taskId: string): Promise<RemoteTaskValidationStatusV1> {
    const task = await this.service.getTask(taskId);
    return {
      schemaVersion: 1,
      taskId: task.taskId,
      workspaceId: task.workspaceId,
      status: task.status,
      updatedAt: task.updatedAt,
      runCount: task.runCount,
      validation: structuredClone(task.validation),
      diffSafety: task.diffSafety
        ? {
            checkedAt: task.diffSafety.checkedAt,
            passed: task.diffSafety.passed,
            changedFiles: task.diffSafety.changedFiles,
            warningCount: task.diffSafety.warningCount,
            failureCount: task.diffSafety.failureCount,
          }
        : undefined,
      waitingForHuman: task.status === "waiting_for_human" || task.pendingEscalation?.status === "pending",
    };
  }
}

export function createLoopbackRemoteTransportServer(
  sessions: RemoteSessionGateway,
  reads: RemoteTransportReadService,
  config: LoopbackRemoteTransportConfig,
): Server {
  if (!LOOPBACK_HOSTS.has(config.host)) {
    throw new Error("remote transport server may bind only to loopback");
  }
  if (!Number.isInteger(config.port) || config.port < 0 || config.port > 65535) {
    throw new Error("remote transport port is invalid");
  }
  const prefix = normalizedPrefix(config.pathPrefix);

  return http.createServer(async (req, res) => {
    try {
      validateHost(req);
      validateOrigin(req);
      const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
      if (!url.pathname.startsWith(`${prefix}/`)) {
        throw new RemoteTransportError("Remote route was not found", "route_not_found", 404);
      }
      if (req.method !== "POST") {
        throw new RemoteTransportError("Remote routes require POST", "method_not_allowed", 405);
      }

      const token = bearer(req);
      const id = requestId(req);
      const body = await readJson(req);

      if (url.pathname === `${prefix}/read/visualization`) {
        exactObject(body, []);
        await sessions.authorize(token, id, { kind: "read", capability: "passive_visualization" });
        json(res, 200, await reads.getPassiveVisualization());
        return;
      }

      if (url.pathname === `${prefix}/read/task-validation`) {
        const input = exactObject(body, ["taskId"]);
        const taskId = requireUuid(input.taskId, "taskId");
        await sessions.authorize(token, id, { kind: "read", capability: "task_validation_status" });
        json(res, 200, await reads.getTaskValidationStatus(taskId));
        return;
      }

      if (url.pathname === `${prefix}/read/supervisor-summary`) {
        exactObject(body, []);
        await sessions.authorize(token, id, { kind: "read", capability: "supervisor_decision_summary" });
        json(res, 200, await reads.getSupervisorDecisionSummary());
        return;
      }

      if (url.pathname === `${prefix}/read/active-writers`) {
        exactObject(body, []);
        await sessions.authorize(token, id, { kind: "read", capability: "active_writer_status" });
        json(res, 200, await reads.getActiveWriterStatus());
        return;
      }

      // There are intentionally no registration, session-issuance, mutation,
      // confirmation, shell, filesystem, Hub, process, lease or credential routes.
      throw new RemoteTransportError("Remote route was not found", "route_not_found", 404);
    } catch (error) {
      const response = errorResponse(error);
      json(res, response.statusCode, { error: response.message, code: response.code });
    }
  });
}

export async function listenLoopbackRemoteTransport(
  server: Server,
  config: LoopbackRemoteTransportConfig,
): Promise<{ host: string; port: number }> {
  if (!LOOPBACK_HOSTS.has(config.host)) {
    throw new Error("remote transport server may bind only to loopback");
  }
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(config.port, config.host);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("remote transport listener address unavailable");
  return { host: config.host, port: address.port };
}
