import crypto from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { MachineGatewayError, type MachineOrchestratorService } from "./machine-orchestrator.js";
import { OperatorActionError, OperatorActionService } from "./operator-action.js";

const COOKIE = "orch_operator";
const SESSION_MS = 15 * 60_000;
const MAX_SESSIONS = 8;
const MAX_BODY_BYTES = 4096;
const CSP = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; script-src 'none'; connect-src 'none'; frame-ancestors 'none'";

export interface LocalOperatorConfig {
  host: "127.0.0.1";
  port: number;
  token: string;
}

export function localOperatorConfigFromEnvironment(env: NodeJS.ProcessEnv = process.env): LocalOperatorConfig | undefined {
  if (env.ORCH_OPERATOR_TOKEN === undefined) return undefined;
  const token = env.ORCH_OPERATOR_TOKEN;
  if (token.length < 32 || token.length > 4096 || token.trim() !== token) {
    throw new Error("ORCH_OPERATOR_TOKEN must be a locally configured secret of 32–4096 characters");
  }
  const port = env.ORCH_OPERATOR_PORT === undefined ? 4320 : Number(env.ORCH_OPERATOR_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("ORCH_OPERATOR_PORT must be an integer from 1 to 65535");
  }
  return { host: "127.0.0.1", port, token };
}

function equalSecret(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>body{font:16px system-ui;max-width:650px;margin:3rem auto;padding:0 1rem;line-height:1.5}form{margin:1rem 0}input,button{font:inherit;padding:.5rem}input[type=text],input[type=password]{width:100%;box-sizing:border-box}button{cursor:pointer}.danger{background:#9b1c1c;color:white;border:0}code{overflow-wrap:anywhere}</style></head><body><main><h1>${escapeHtml(title)}</h1>${body}</main></body></html>`;
}

function respond(res: ServerResponse, status: number, body: string, cookie?: string): void {
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": CSP,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    ...(cookie ? { "Set-Cookie": cookie } : {}),
  });
  res.end(body);
}

async function form(req: IncomingMessage): Promise<URLSearchParams> {
  if (!/^application\/x-www-form-urlencoded(?:;\s*charset=utf-8)?$/i.test(req.headers["content-type"] ?? "")) {
    throw new Error("unsupported_form");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("form_too_large");
    chunks.push(Buffer.from(chunk));
  }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

interface Session { csrf: string; expiresAt: number }

/** An opt-in loopback-only browser surface for one confirmed service action. */
export function startLocalOperatorControlServer(
  service: Pick<MachineOrchestratorService, "getTask" | "rejectEscalation">,
  config: LocalOperatorConfig,
): Server {
  if (config.host !== "127.0.0.1" || !Number.isInteger(config.port) || config.port < 1 || config.port > 65535 || config.token.length < 32 || config.token.length > 4096 || config.token.trim() !== config.token) {
    throw new Error("Operator control must use a configured loopback address, port and strong token");
  }
  const origin = `http://127.0.0.1:${config.port}`;
  const actions = new OperatorActionService(service);
  const sessions = new Map<string, Session>();
  const confirmationOwners = new Map<string, string>();
  const server = createServer((req, res) => {
    void (async () => {
      if (req.headers.host !== `127.0.0.1:${config.port}` || req.headers.origin && req.headers.origin !== origin) {
        respond(res, 403, page("Forbidden", "<p>Invalid local origin.</p>"));
        return;
      }
      const url = new URL(req.url ?? "/", origin);
      const path = url.pathname;
      if (!["/operator", "/operator/login", "/operator/preview", "/operator/confirm", "/operator/logout"].includes(path)) {
        respond(res, 404, page("Not found", "<p>Unknown operator page.</p>"));
        return;
      }
      if (req.method !== "GET" && req.method !== "POST") {
        respond(res, 405, page("Method not allowed", "<p>Unsupported request.</p>"));
        return;
      }
      if (req.method === "POST" && req.headers.origin !== origin) {
        respond(res, 403, page("Forbidden", "<p>Local browser origin required.</p>"));
        return;
      }
      const cookie = req.headers.cookie?.split(";").map((part) => part.trim())
        .find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
      const session = cookie && /^[0-9a-f]{64}$/.test(cookie) ? sessions.get(cookie) : undefined;
      if (session && session.expiresAt <= Date.now()) sessions.delete(cookie!);
      const active = session && session.expiresAt > Date.now() ? session : undefined;

      if (path === "/operator" && req.method === "GET" && !active) {
        respond(res, 200, page("Local operator sign in", '<form method="post" action="/operator/login"><label>Operator token<input type="password" name="token" required autocomplete="off"></label><button>Sign in</button></form>'));
        return;
      }
      if (path === "/operator/login" && req.method === "POST") {
        const data = await form(req);
        if (!equalSecret(data.get("token") ?? "", config.token)) {
          respond(res, 401, page("Sign in failed", "<p>Invalid operator token.</p>"));
          return;
        }
        for (const [id, item] of sessions) if (item.expiresAt <= Date.now()) sessions.delete(id);
        if (sessions.size >= MAX_SESSIONS) {
          respond(res, 429, page("Sign in unavailable", "<p>Too many active sessions.</p>"));
          return;
        }
        const id = crypto.randomBytes(32).toString("hex");
        sessions.set(id, { csrf: crypto.randomBytes(32).toString("hex"), expiresAt: Date.now() + SESSION_MS });
        respond(res, 200, page("Signed in", '<p>Operator session started.</p><a href="/operator">Continue</a>'), `${COOKIE}=${id}; HttpOnly; SameSite=Strict; Path=/operator; Max-Age=900`);
        return;
      }
      if (!active) {
        respond(res, 401, page("Sign in required", '<p>Session expired.</p><a href="/operator">Sign in</a>'));
        return;
      }
      if (path === "/operator" && req.method === "GET") {
        respond(res, 200, page("Operator control", `<p>Reject a pending safety escalation. This closes the task and grants no wider scope.</p><form method="post" action="/operator/preview"><input type="hidden" name="csrf" value="${active.csrf}"><label>Task ID<input type="text" name="task_id" required pattern="[0-9a-fA-F-]{36}"></label><button>Review rejection</button></form><form method="post" action="/operator/logout"><input type="hidden" name="csrf" value="${active.csrf}"><button>Sign out</button></form>`));
        return;
      }
      if (req.method !== "POST") {
        respond(res, 405, page("Method not allowed", "<p>Unsupported request.</p>"));
        return;
      }
      const data = await form(req);
      if (!equalSecret(data.get("csrf") ?? "", active.csrf)) {
        respond(res, 403, page("Forbidden", "<p>Invalid confirmation session.</p>"));
        return;
      }
      if (path === "/operator/logout") {
        sessions.delete(cookie!);
        for (const [token, owner] of confirmationOwners) if (owner === cookie) confirmationOwners.delete(token);
        respond(res, 200, page("Signed out", '<a href="/operator">Sign in</a>'), `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/operator; Max-Age=0`);
        return;
      }
      const taskId = data.get("task_id") ?? "";
      if (path === "/operator/preview") {
        const preview = await actions.previewEscalationRejection(taskId);
        confirmationOwners.set(preview.confirmationToken, cookie!);
        respond(res, 200, page("Confirm escalation rejection", `<p>${escapeHtml(preview.confirmationText)}.</p><p>Task: <code>${escapeHtml(preview.taskId)}</code><br>Workspace: <code>${escapeHtml(preview.workspaceId)}</code><br>Expires: ${escapeHtml(preview.expiresAt)}</p><form method="post" action="/operator/confirm"><input type="hidden" name="csrf" value="${active.csrf}"><input type="hidden" name="task_id" value="${escapeHtml(preview.taskId)}"><input type="hidden" name="confirmation_token" value="${preview.confirmationToken}"><button class="danger" name="confirmed" value="yes">Reject escalation and close task</button></form><a href="/operator">Cancel</a>`));
        return;
      }
      if (path === "/operator/confirm" && data.get("confirmed") === "yes") {
        const token = data.get("confirmation_token") ?? "";
        if (confirmationOwners.get(token) !== cookie) {
          respond(res, 403, page("Forbidden", "<p>Confirmation belongs to another session.</p>"));
          return;
        }
        confirmationOwners.delete(token);
        const result = await actions.rejectEscalation({ taskId, confirmationToken: token, confirmed: true });
        respond(res, 200, page("Escalation rejected", `<p>Task <code>${escapeHtml(result.taskId)}</code> is ${escapeHtml(result.status)}. The decision was recorded by the machine service.</p><a href="/operator">Back</a>`));
        return;
      }
      respond(res, 400, page("Invalid confirmation", "<p>Explicit confirmation required.</p>"));
    })().catch((error: unknown) => {
      if (res.headersSent) { res.end(); return; }
      const status = error instanceof OperatorActionError || error instanceof MachineGatewayError
        ? 409
        : error instanceof Error && ["unsupported_form", "form_too_large"].includes(error.message) ? 400 : 500;
      respond(res, status, page("Action unavailable", "<p>The request could not be completed. Refresh the task and try again.</p>"));
    });
  });
  server.on("close", () => { sessions.clear(); confirmationOwners.clear(); });
  server.listen(config.port, config.host);
  return server;
}
