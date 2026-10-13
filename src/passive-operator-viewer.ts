import crypto from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { IncomingMessage, ServerResponse } from "node:http";
import { renderOperatorVisualizationHtml } from "./operator-visualization-html.js";
import type { OperatorVisualizationV1 } from "./operator-visualization.js";
import { renderTaskGroupHtml, renderTaskDetailHtml } from "./operator-task-drilldown-html.js";
import { taskGroup, safeTaskHref } from "./operator-task-groups.js";

const COOKIE = "orch_viewer";
const SESSION_MS = 10 * 60_000;
const MAX_SESSIONS = 8;
const MAX_LOGIN_BYTES = 4096;
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const LOGIN_CSP = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; script-src 'none'; connect-src 'none'; frame-ancestors 'none'; base-uri 'none'";
const VIEW_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; connect-src 'none'; script-src 'none'; form-action 'none'; base-uri 'none'";

export const PASSIVE_VIEWER_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  host: "127.0.0.1" as const,
  explicitlyOptIn: true as const,
  sessionRequired: true as const,
  readOnlySnapshot: true as const,
  browserMutationActions: false as const,
  startsDaemon: false as const,
  installsService: false as const,
  grantsTaskAuthority: false as const,
  grantsFilesystemAuthority: false as const,
  grantsCredentialAuthority: false as const,
  grantsReleaseAuthority: false as const,
});

export interface PassiveViewerConfig {
  host: "127.0.0.1";
  port: number;
  token: string;
  /** Disposable tests only, not an operator configuration value. */
  testOnlyEphemeralPort?: true;
}
export interface TrustedPassiveSnapshotReader {
  /** Already-sanitized bounded view from trusted in-process code only. */
  readSnapshot(): Promise<OperatorVisualizationV1>;
}
export class PassiveViewerError extends Error {
  constructor(public readonly code: "config_invalid" | "snapshot_invalid") {
    super(code === "config_invalid" ? "Invalid local viewer configuration"
      : "Current sanitized operator snapshot is unavailable");
    this.name = "PassiveViewerError";
  }
}
export interface PassiveViewerServerHandle {
  server: Server;
  /** Never contains a token. */
  origin: string;
  close(): Promise<void>;
}

function equalSecret(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
function headers(csp: string): Record<string, string> {
  return {
    "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": csp,
    "Cache-Control": "no-store, max-age=0", "Pragma": "no-cache",
    "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY",
    // Chrome can send Origin: null for normal HTML form POSTs when the
    // originating page has Referrer-Policy: no-referrer. Keep same-origin
    // form navigation functional WITHOUT relaxing the strict Host/Origin gate.
    // The authenticated passive dashboard continues to send no-referrer.
    "Referrer-Policy": csp === LOGIN_CSP ? "same-origin" : "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Vary": "Cookie",
  };
}
function send(res: ServerResponse, code: number, html: string, csp = LOGIN_CSP, cookie?: string): void {
  res.writeHead(code, { ...headers(csp), ...(cookie ? { "Set-Cookie": cookie } : {}) });
  res.end(html);
}
function loginPage(message: string): string {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>Read-only operator viewer</title>'
    + '<style>:root{color-scheme:light dark;font:16px/1.5 system-ui}'
    + 'body{color:CanvasText;background:Canvas;max-width:560px;margin:3rem auto;padding:0 1rem}'
    + 'label,input,button{display:block;margin:10px 0}input{width:100%;box-sizing:border-box;padding:9px}'
    + 'button{padding:9px 16px;font:inherit}*:focus-visible{outline:3px solid Highlight}</style>'
    + '</head><body><main><h1>Read-only operator viewer</h1><p>' + message
    + '</p><p>Nothing here can execute or approve tasks.</p>'
    + '<form method="post" action="/viewer/login"><label for="local-token">Local viewing token</label>'
    + '<input id="local-token" type="password" name="token" autocomplete="off" required maxlength="4096">'
    + '<button>Sign in</button></form></main></body></html>';
}
function statusPage(label: string): string {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1"><title>' + label
    + '</title></head><body><main><h1>' + label
    + '</h1><p>No operator actions are available.</p></main></body></html>';
}
function validConfig(config: PassiveViewerConfig): boolean {
  return config?.host === "127.0.0.1" && Number.isInteger(config.port)
    && ((config.port >= 1 && config.port <= 65535)
      || (config.port === 0 && config.testOnlyEphemeralPort === true))
    && typeof config.token === "string"
    && config.token.length >= 32 && config.token.length <= 4096
    && config.token.trim() === config.token
    && !/[\x00-\x1f\x7f]/.test(config.token);
}
async function readLogin(req: IncomingMessage): Promise<string> {
  if (!/^application\/x-www-form-urlencoded(?:;\s*charset=utf-8)?$/i.test(req.headers["content-type"] ?? "")) {
    throw new Error("bad-login");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += Buffer.byteLength(chunk);
    if (size > MAX_LOGIN_BYTES) throw new Error("bad-login");
    chunks.push(Buffer.from(chunk));
  }
  const data = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
  if ([...data.keys()].some(key => key !== "token") || data.getAll("token").length !== 1) {
    throw new Error("bad-login");
  }
  return data.get("token") ?? "";
}

/**
 * Opt-in, token-gated 127.0.0.1 browser view. Never starts a daemon,
 * discovers machine authority, changes tasks or exposes an action endpoint.
 * The host must supply an independently sanitized snapshot reader. Reloading
 * /viewer asks the host for a fresh view. Separate from /operator sessions.
 */
export async function startPassiveOperatorViewer(
  reader: TrustedPassiveSnapshotReader,
  config: PassiveViewerConfig,
): Promise<PassiveViewerServerHandle> {
  if (!validConfig(config) || !reader || typeof reader.readSnapshot !== "function") {
    throw new PassiveViewerError("config_invalid");
  }
  const sessions = new Map<string, number>();
  let origin = "";
  let hostname = "";
  const server = createServer((req, res) => {
    void (async () => {
      if (req.headers.host !== hostname
        || (req.headers.origin !== undefined && req.headers.origin !== origin)
        || req.headers["x-forwarded-host"] !== undefined
        || req.headers.forwarded !== undefined) {
        send(res, 403, statusPage("Invalid local origin"), VIEW_CSP);
        return;
      }
      const url = new URL(req.url ?? "/", origin);
      const statusSlug = /^\/viewer\/status\/([a-z-]+)$/.exec(url.pathname)?.[1];
      const detailId = /^\/viewer\/task\/([a-f0-9-]+)$/.exec(url.pathname)?.[1];
      const readPage = url.pathname === "/viewer" || Boolean(statusSlug && taskGroup(statusSlug))
        || Boolean(detailId && safeTaskHref(detailId));
      if (url.search !== "" || !(readPage || url.pathname === "/viewer/login")) {
        send(res, 404, statusPage("Not found"), VIEW_CSP);
        return;
      }
      if (req.method !== "GET" && req.method !== "POST") {
        send(res, 405, statusPage("Method not allowed"), VIEW_CSP);
        return;
      }
      if (req.method === "POST" && (url.pathname !== "/viewer/login" || req.headers.origin !== origin)) {
        send(res, 403, statusPage("Local browser origin required"), VIEW_CSP);
        return;
      }
      const cookies = (req.headers.cookie ?? "").split(";").map(s => s.trim())
        .filter(s => s.startsWith(COOKIE + "="));
      const id = cookies.length === 1 ? cookies[0]!.slice(COOKIE.length + 1) : "";
      const expires = /^[a-f0-9]{64}$/.test(id) ? sessions.get(id) : undefined;
      if (expires !== undefined && expires <= Date.now()) sessions.delete(id);
      const authenticated = expires !== undefined && expires > Date.now();
      if (req.method === "GET" && readPage) {
        if (!authenticated) {
          send(res, 200, loginPage("Sign in with your separately provisioned local viewing token."));
          return;
        }
        try {
          const view = await reader.readSnapshot();
          if (!view || view.schemaVersion !== 1 || view.readOnly !== true
            || !Array.isArray(view.actions) || view.actions.length !== 0) {
            throw new PassiveViewerError("snapshot_invalid");
          }
          let html: string;
          try {
            html = statusSlug ? renderTaskGroupHtml(view, statusSlug)
              : detailId ? renderTaskDetailHtml(view, detailId)
              : renderOperatorVisualizationHtml(view);
          } catch {
            send(res, 404, statusPage("Task not found in current snapshot"), VIEW_CSP);
            return;
          }
          if (Buffer.byteLength(html, "utf8") > MAX_HTML_BYTES) {
            throw new PassiveViewerError("snapshot_invalid");
          }
          send(res, 200, html, VIEW_CSP);
        } catch {
          send(res, 503, statusPage("Sanitized snapshot unavailable"), VIEW_CSP);
        }
        return;
      }
      if (req.method === "POST" && url.pathname === "/viewer/login") {
        let token = "";
        try { token = await readLogin(req); }
        catch {
          send(res, 400, loginPage("Invalid local sign-in request."));
          return;
        }
        if (!equalSecret(token, config.token)) {
          send(res, 401, loginPage("Sign in failed."));
          return;
        }
        for (const [session, expiry] of sessions) if (expiry <= Date.now()) sessions.delete(session);
        if (sessions.size >= MAX_SESSIONS) {
          send(res, 429, statusPage("Too many local sessions"), VIEW_CSP);
          return;
        }
        const session = crypto.randomBytes(32).toString("hex");
        sessions.set(session, Date.now() + SESSION_MS);
        const cookie = COOKIE + "=" + session
          + "; HttpOnly; SameSite=Strict; Path=/viewer; Max-Age=600";
        // Post/Redirect/Get: load the authenticated snapshot immediately without
        // sending a success page or leaking the viewing token into a URL/body.
        res.writeHead(303, { ...headers(VIEW_CSP), "Location": "/viewer", "Set-Cookie": cookie });
        res.end();
        return;
      }
      send(res, 405, statusPage("Method not allowed"), VIEW_CSP);
    })().catch(() => {
      if (!res.headersSent) send(res, 503, statusPage("Read-only viewer unavailable"), VIEW_CSP);
      else res.end();
    });
  });
  server.on("close", () => sessions.clear());
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(config.port, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
    const addr = server.address() as AddressInfo | null;
    if (!addr || addr.address !== "127.0.0.1") throw new PassiveViewerError("config_invalid");
    hostname = "127.0.0.1:" + addr.port;
    origin = "http://" + hostname;
    return {
      server,
      origin,
      close: () => new Promise<void>((resolve, reject) =>
        server.close(err => err ? reject(err) : resolve())),
    };
  } catch (error) {
    server.close();
    throw error;
  }
}
