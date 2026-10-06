import http from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { SafetyPreviewRequest } from "./safety-plan.js";
import {
  RemoteTaskStartApprovalBridge,
  RemoteTaskStartBridgeError,
  type RemoteTaskStartProposalV1,
} from "./remote-task-start-bridge.js";

const MAX_BODY_BYTES = 64 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

export interface LoopbackRemoteTaskStartTransportConfig {
  host: "127.0.0.1" | "localhost" | "::1";
  port: number;
  pathPrefix?: string;
}

export class RemoteTaskStartTransportError extends Error {
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
    this.name = "RemoteTaskStartTransportError";
  }
}

function exactObject(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RemoteTaskStartTransportError("JSON request body must be an object", "bad_request", 400);
  }
  const record = value as Record<string, unknown>;
  const extras = Object.keys(record).filter((key) => !allowed.includes(key));
  if (extras.length > 0) {
    throw new RemoteTaskStartTransportError(`Unexpected request field(s): ${extras.join(", ")}`, "bad_request", 400);
  }
  return record;
}

function requireUuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new RemoteTaskStartTransportError(`${field} must be an opaque UUID`, "bad_request", 400);
  }
  return value;
}

function requireText(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") throw new RemoteTaskStartTransportError(`${field} must be a string`, "bad_request", 400);
  const text = value.trim();
  if (!text || text.includes("\0") || text.length > max) {
    throw new RemoteTaskStartTransportError(`${field} is empty or invalid`, "bad_request", 400);
  }
  return text;
}

function requireScope(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 100) {
    throw new RemoteTaskStartTransportError("requestedScope must be an array with at most 100 items", "bad_request", 400);
  }
  return value.map((item, index) => requireText(item, `requestedScope[${index}]`, 2_000));
}

function requirePermit(value: unknown): string {
  if (typeof value !== "string" || value.length < 32 || value.length > 512 || value.includes("\0")) {
    throw new RemoteTaskStartTransportError("startPermit is invalid", "bad_request", 400);
  }
  return value;
}

function bearer(req: IncomingMessage): string {
  const value = req.headers.authorization;
  if (!value || Array.isArray(value)) throw new RemoteTaskStartTransportError("Bearer authentication is required", "unauthorized", 401);
  const match = value.match(/^Bearer ([A-Za-z0-9._~-]{32,512})$/);
  if (!match) throw new RemoteTaskStartTransportError("Bearer authentication is malformed", "unauthorized", 401);
  return match[1]!;
}

function requestId(req: IncomingMessage): string {
  const value = req.headers["x-orchestrator-request-id"];
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new RemoteTaskStartTransportError("x-orchestrator-request-id must be an opaque UUID", "bad_request", 400);
  }
  return value;
}

function validateHost(req: IncomingMessage): void {
  const host = req.headers.host;
  if (typeof host !== "string" || !host.trim()) throw new RemoteTaskStartTransportError("Host header is required", "host_not_allowed", 403);
  let parsed: URL;
  try {
    parsed = new URL(`http://${host}`);
  } catch {
    throw new RemoteTaskStartTransportError("Host header is malformed", "host_not_allowed", 403);
  }
  if (!LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw new RemoteTaskStartTransportError("Host header must identify loopback", "host_not_allowed", 403);
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
      throw new RemoteTaskStartTransportError("Origin is malformed", "origin_not_allowed", 403);
    }
    if (!LOOPBACK_HOSTS.has(parsed.hostname)) {
      throw new RemoteTaskStartTransportError("Browser-origin requests are limited to loopback", "origin_not_allowed", 403);
    }
  }
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const contentType = String(req.headers["content-type"] ?? "").toLowerCase();
  if (!contentType.startsWith("application/json")) {
    throw new RemoteTaskStartTransportError("application/json is required", "content_type_required", 415);
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > MAX_BODY_BYTES) throw new RemoteTaskStartTransportError("Request body is too large", "bad_request", 413);
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as unknown;
  } catch {
    throw new RemoteTaskStartTransportError("Request body must be valid JSON", "bad_request", 400);
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

function publicProposal(proposal: RemoteTaskStartProposalV1): RemoteTaskStartProposalV1 {
  return structuredClone(proposal);
}

function normalizedPrefix(value: string | undefined): string {
  const raw = (value ?? "/remote/v1").trim();
  if (!raw.startsWith("/") || raw.includes("..") || raw.includes("?") || raw.includes("#")) {
    throw new Error("remote task-start transport pathPrefix must be an absolute URL path");
  }
  return raw.length > 1 ? raw.replace(/\/+$/, "") : raw;
}

function errorResponse(error: unknown): { statusCode: number; code: string; message: string } {
  if (error instanceof RemoteTaskStartTransportError) {
    return { statusCode: error.statusCode, code: error.code, message: error.message };
  }
  const code = typeof (error as { code?: unknown })?.code === "string" ? String((error as { code: string }).code) : "request_failed";
  if (["session_not_found", "session_expired", "session_stale", "registration_revoked"].includes(code)) {
    return { statusCode: 401, code, message: "Remote session is not current" };
  }
  if (["request_replayed", "rate_limited", "capacity_exceeded", "capability_not_allowed"].includes(code)) {
    return { statusCode: code === "rate_limited" ? 429 : 403, code, message: "Remote request was denied" };
  }
  if (error instanceof RemoteTaskStartBridgeError) {
    const statusCode = error.code === "proposal_not_found"
      ? 404
      : ["proposal_conflict", "proposal_stale", "proposal_material_unavailable", "confirmation_expired", "permit_expired"].includes(error.code)
        ? 409
        : ["confirmation_invalid", "permit_invalid"].includes(error.code)
          ? 403
          : 400;
    return { statusCode, code: error.code, message: "Remote task-start request was denied" };
  }
  return { statusCode: 500, code: "request_failed", message: "Remote task-start request failed" };
}

type RemoteTaskStartTransportBridge = Pick<RemoteTaskStartApprovalBridge, "propose" | "executeApproved">;

/**
 * Loopback-only new-task transport. The remote side may submit an exact proposal
 * and later redeem a locally-created one-shot start permit. There are deliberately
 * no remote Safety Preview, approval, confirmation, registration or session-issue
 * routes on this server.
 */
export function createLoopbackRemoteTaskStartServer(
  bridge: RemoteTaskStartTransportBridge,
  config: LoopbackRemoteTaskStartTransportConfig,
): Server {
  if (!LOOPBACK_HOSTS.has(config.host)) throw new Error("remote task-start server may bind only to loopback");
  if (!Number.isInteger(config.port) || config.port < 0 || config.port > 65535) throw new Error("remote task-start port is invalid");
  const prefix = normalizedPrefix(config.pathPrefix);

  return http.createServer(async (req, res) => {
    try {
      validateHost(req);
      validateOrigin(req);
      const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
      if (!url.pathname.startsWith(`${prefix}/task-start/`)) {
        throw new RemoteTaskStartTransportError("Remote task-start route was not found", "route_not_found", 404);
      }
      if (req.method !== "POST") throw new RemoteTaskStartTransportError("Remote task-start routes require POST", "method_not_allowed", 405);

      const token = bearer(req);
      const id = requestId(req);
      const body = await readJson(req);

      if (url.pathname === `${prefix}/task-start/propose`) {
        const input = exactObject(body, ["workspaceId", "goal", "requestedScope"]);
        const request: SafetyPreviewRequest = {
          workspaceId: requireUuid(input.workspaceId, "workspaceId"),
          goal: requireText(input.goal, "goal", 20_000),
          requestedScope: requireScope(input.requestedScope),
        };
        const proposal = await bridge.propose({ bearerToken: token, requestId: id, request });
        json(res, 202, { schemaVersion: 1, proposal: publicProposal(proposal), localSafetyPreviewRequired: true });
        return;
      }

      if (url.pathname === `${prefix}/task-start/execute`) {
        const input = exactObject(body, ["proposalId", "startPermit"]);
        const result = await bridge.executeApproved({
          bearerToken: token,
          requestId: id,
          proposalId: requireUuid(input.proposalId, "proposalId"),
          startPermit: requirePermit(input.startPermit),
        });
        json(res, 200, {
          schemaVersion: 1,
          proposal: publicProposal(result.proposal),
          task: structuredClone(result.task),
          started: result.proposal.status === "started",
        });
        return;
      }

      // Safety Preview generation, inspection and human confirmation remain local.
      throw new RemoteTaskStartTransportError("Remote task-start route was not found", "route_not_found", 404);
    } catch (error) {
      const response = errorResponse(error);
      json(res, response.statusCode, { error: response.message, code: response.code });
    }
  });
}

export async function listenLoopbackRemoteTaskStartServer(
  server: Server,
  config: LoopbackRemoteTaskStartTransportConfig,
): Promise<{ host: string; port: number }> {
  if (!LOOPBACK_HOSTS.has(config.host)) throw new Error("remote task-start server may bind only to loopback");
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => { server.off("listening", onListening); reject(error); };
    const onListening = () => { server.off("error", onError); resolve(); };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(config.port, config.host);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("remote task-start listener address unavailable");
  return { host: config.host, port: address.port };
}
