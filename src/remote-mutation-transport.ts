import http from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { OperatorMutationActionV1 } from "./operator-capabilities.js";
import {
  RemoteMutationApprovalBridge,
  RemoteMutationBridgeError,
  type RemoteMutationProposalV1,
} from "./remote-mutation-bridge.js";

const MAX_BODY_BYTES = 64 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const ACTIONS = new Set<OperatorMutationActionV1>([
  "reject_escalation",
  "approve_escalation",
  "abort_task",
  "rollback_task",
  "continue_task",
  "resume_workflow",
  "recover_scheduled_writer",
]);

export interface LoopbackRemoteMutationTransportConfig {
  host: "127.0.0.1" | "localhost" | "::1";
  port: number;
  pathPrefix?: string;
}

export class RemoteMutationTransportError extends Error {
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
    this.name = "RemoteMutationTransportError";
  }
}

function exactObject(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RemoteMutationTransportError("JSON request body must be an object", "bad_request", 400);
  }
  const record = value as Record<string, unknown>;
  const extras = Object.keys(record).filter((key) => !allowed.includes(key));
  if (extras.length > 0) {
    throw new RemoteMutationTransportError(`Unexpected request field(s): ${extras.join(", ")}`, "bad_request", 400);
  }
  return record;
}

function requireUuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new RemoteMutationTransportError(`${field} must be an opaque UUID`, "bad_request", 400);
  }
  return value;
}

function requireAction(value: unknown): OperatorMutationActionV1 {
  if (typeof value !== "string" || !ACTIONS.has(value as OperatorMutationActionV1)) {
    throw new RemoteMutationTransportError("action is not a supported bounded M10 mutation", "bad_request", 400);
  }
  return value as OperatorMutationActionV1;
}

function requirePermit(value: unknown): string {
  if (typeof value !== "string" || value.length < 32 || value.length > 512 || value.includes("\0")) {
    throw new RemoteMutationTransportError("bridgePermit is invalid", "bad_request", 400);
  }
  return value;
}

function bearer(req: IncomingMessage): string {
  const value = req.headers.authorization;
  if (!value || Array.isArray(value)) {
    throw new RemoteMutationTransportError("Bearer authentication is required", "unauthorized", 401);
  }
  const match = value.match(/^Bearer ([A-Za-z0-9._~-]{32,512})$/);
  if (!match) throw new RemoteMutationTransportError("Bearer authentication is malformed", "unauthorized", 401);
  return match[1]!;
}

function requestId(req: IncomingMessage): string {
  const value = req.headers["x-orchestrator-request-id"];
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new RemoteMutationTransportError("x-orchestrator-request-id must be an opaque UUID", "bad_request", 400);
  }
  return value;
}

function validateHost(req: IncomingMessage): void {
  const host = req.headers.host;
  if (typeof host !== "string" || !host.trim()) {
    throw new RemoteMutationTransportError("Host header is required", "host_not_allowed", 403);
  }
  let parsed: URL;
  try {
    parsed = new URL(`http://${host}`);
  } catch {
    throw new RemoteMutationTransportError("Host header is malformed", "host_not_allowed", 403);
  }
  if (!LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw new RemoteMutationTransportError("Host header must identify loopback", "host_not_allowed", 403);
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
      throw new RemoteMutationTransportError("Origin is malformed", "origin_not_allowed", 403);
    }
    if (!LOOPBACK_HOSTS.has(parsed.hostname)) {
      throw new RemoteMutationTransportError("Browser-origin requests are limited to loopback", "origin_not_allowed", 403);
    }
  }
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const contentType = String(req.headers["content-type"] ?? "").toLowerCase();
  if (!contentType.startsWith("application/json")) {
    throw new RemoteMutationTransportError("application/json is required", "content_type_required", 415);
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > MAX_BODY_BYTES) {
      throw new RemoteMutationTransportError("Request body is too large", "bad_request", 413);
    }
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(raw || "{}") as unknown;
  } catch {
    throw new RemoteMutationTransportError("Request body must be valid JSON", "bad_request", 400);
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

function publicProposal(proposal: RemoteMutationProposalV1): RemoteMutationProposalV1 {
  return structuredClone(proposal);
}

function normalizedPrefix(value: string | undefined): string {
  const raw = (value ?? "/remote/v1").trim();
  if (!raw.startsWith("/") || raw.includes("..") || raw.includes("?") || raw.includes("#")) {
    throw new Error("remote mutation transport pathPrefix must be an absolute URL path");
  }
  return raw.length > 1 ? raw.replace(/\/+$/, "") : raw;
}

function errorResponse(error: unknown): { statusCode: number; code: string; message: string } {
  if (error instanceof RemoteMutationTransportError) {
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
  if (error instanceof RemoteMutationBridgeError) {
    const statusCode = ["proposal_not_found"].includes(error.code)
      ? 404
      : ["proposal_conflict", "proposal_stale", "proposal_material_unavailable", "permit_expired"].includes(error.code)
        ? 409
        : error.code === "permit_invalid"
          ? 403
          : 400;
    return { statusCode, code: error.code, message: "Remote mutation request was denied" };
  }
  return { statusCode: 500, code: "request_failed", message: "Remote mutation request failed" };
}

/**
 * Loopback-only mutation transport. Remote callers may propose an exact mutation
 * and, after a distinct local human approval has produced a bridge permit, submit
 * that one-shot permit for execution. There is intentionally no remote approval
 * route and the raw M10 execution result is never returned.
 */
export function createLoopbackRemoteMutationServer(
  bridge: RemoteMutationApprovalBridge,
  config: LoopbackRemoteMutationTransportConfig,
): Server {
  if (!LOOPBACK_HOSTS.has(config.host)) throw new Error("remote mutation server may bind only to loopback");
  if (!Number.isInteger(config.port) || config.port < 0 || config.port > 65535) {
    throw new Error("remote mutation transport port is invalid");
  }
  const prefix = normalizedPrefix(config.pathPrefix);

  return http.createServer(async (req, res) => {
    try {
      validateHost(req);
      validateOrigin(req);
      const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
      if (!url.pathname.startsWith(`${prefix}/mutation/`)) {
        throw new RemoteMutationTransportError("Remote mutation route was not found", "route_not_found", 404);
      }
      if (req.method !== "POST") {
        throw new RemoteMutationTransportError("Remote mutation routes require POST", "method_not_allowed", 405);
      }

      const token = bearer(req);
      const id = requestId(req);
      const body = await readJson(req);

      if (url.pathname === `${prefix}/mutation/propose`) {
        const input = exactObject(body, ["action", "targetId", "payload"]);
        const proposal = await bridge.propose({
          bearerToken: token,
          requestId: id,
          action: requireAction(input.action),
          targetId: requireUuid(input.targetId, "targetId"),
          payload: input.payload ?? {},
        });
        json(res, 202, { schemaVersion: 1, proposal: publicProposal(proposal), localApprovalRequired: true });
        return;
      }

      if (url.pathname === `${prefix}/mutation/execute`) {
        const input = exactObject(body, ["proposalId", "bridgePermit", "payload"]);
        const result = await bridge.executeApproved({
          bearerToken: token,
          requestId: id,
          proposalId: requireUuid(input.proposalId, "proposalId"),
          bridgePermit: requirePermit(input.bridgePermit),
          payload: input.payload ?? {},
        });
        json(res, 200, {
          schemaVersion: 1,
          proposal: publicProposal(result.proposal),
          executed: result.proposal.status === "executed",
        });
        return;
      }

      // Approval/rejection of proposals is deliberately local-only. Bearer auth
      // cannot create the human-authority bridge permit.
      throw new RemoteMutationTransportError("Remote mutation route was not found", "route_not_found", 404);
    } catch (error) {
      const response = errorResponse(error);
      json(res, response.statusCode, { error: response.message, code: response.code });
    }
  });
}

export async function listenLoopbackRemoteMutationServer(
  server: Server,
  config: LoopbackRemoteMutationTransportConfig,
): Promise<{ host: string; port: number }> {
  if (!LOOPBACK_HOSTS.has(config.host)) throw new Error("remote mutation server may bind only to loopback");
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
  if (!address || typeof address === "string") throw new Error("remote mutation listener address unavailable");
  return { host: config.host, port: address.port };
}
