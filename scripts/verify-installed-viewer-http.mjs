import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";

/**
 * UX-E2c1: disposable installed binary lifecycle acceptance.
 * This launches the installed JavaScript entrypoint (not source/tsx) with a
 * short-lived viewing token, tests its actual local HTTP security boundary,
 * terminates the child and verifies that the listener is gone. The native npm
 * CLI shims are independently tested by verify-installed-package.mjs.
 *
 * No browser automation, daemon, task, SCM/systemd service or release action.
 */
const installedDir = process.argv[2];
assert.ok(typeof installedDir === "string" && path.isAbsolute(installedDir),
  "Absolute installed package directory required");
const binary = path.join(installedDir, "dist", "product-cli.js");
const token = randomBytes(32).toString("hex");
const reserved = createServer();
await new Promise((resolve, reject) => {
  reserved.once("error", reject);
  reserved.listen(0, "127.0.0.1", resolve);
});
const allocated = reserved.address();
assert.ok(allocated && typeof allocated !== "string" && allocated.port > 0);
const port = allocated.port;
await new Promise((resolve, reject) => reserved.close(err => err ? reject(err) : resolve()));
const origin = "http://127.0.0.1:" + port;

const env = { ...process.env,
  ORCH_VIEWER_TOKEN: token, ORCH_VIEWER_PORT: String(port),
};
for (const key of Object.keys(env)) {
  if (key.startsWith("ORCH_") && !["ORCH_VIEWER_TOKEN", "ORCH_VIEWER_PORT"].includes(key)) {
    delete env[key];
  }
}
const child = spawn(process.execPath, [binary, "viewer"], {
  env, cwd: installedDir, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
});
let stdout = "", stderr = "";
child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");
child.stdout.on("data", chunk => { stdout = (stdout + chunk).slice(-16_384); });
child.stderr.on("data", chunk => { stderr = (stderr + chunk).slice(-16_384); });

async function request(route, options) {
  return await fetch(origin + route, { redirect: "manual", signal: AbortSignal.timeout(3000), ...options });
}
async function ready() {
  for (let i = 0; i < 120; i++) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error("Installed viewer exited before readiness: " + stderr.slice(-500));
    }
    if (stdout.includes('"command": "viewer"') && stdout.includes('"serviceInstalled": false')) {
      const response = await request("/viewer");
      assert.equal(response.status, 200);
      return;
    }
    await delay(100);
  }
  throw new Error("Installed viewer did not announce bounded localhost readiness");
}
async function terminate() {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve, reject) => {
    const fallback = setTimeout(() => reject(new Error("Installed viewer child did not exit")), 5000);
    child.once("exit", () => { clearTimeout(fallback); resolve(); });
    if (!child.kill()) { clearTimeout(fallback); reject(new Error("Could not terminate disposable viewer child")); }
  });
}

try {
  await ready();
  assert.ok(stdout.includes(origin));
  assert.ok(!stdout.includes(token));
  assert.ok(!stderr.includes(token));
  assert.match(stdout, /"grantsAuthority": false/);
  assert.match(stdout, /"daemonStarted": false/);
  assert.match(stdout, /"browserAutoOpened": false/);

  const anon = await request("/viewer");
  assert.equal(anon.status, 200);
  assert.match(await anon.text(), /Read-only operator viewer/);
  assert.equal(anon.headers.get("cache-control"), "no-store, max-age=0");
  assert.equal(anon.headers.get("x-frame-options"), "DENY");

  const forged = await request("/viewer", { headers: { Origin: "http://evil.invalid" } });
  assert.equal(forged.status, 403);
  const noOrigin = await request("/viewer/login", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
  });
  assert.equal(noOrigin.status, 403);
  const badToken = await request("/viewer/login", {
    method: "POST", headers: { Origin: origin, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: "wrong" }),
  });
  assert.equal(badToken.status, 401);
  const login = await request("/viewer/login", {
    method: "POST", headers: { Origin: origin, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
  });
  assert.equal(login.status, 303);
  assert.equal(login.headers.get("location"), "/viewer");
  assert.doesNotMatch(await login.text(), /token|Signed in/i);
  const setCookie = login.headers.get("set-cookie") ?? "";
  assert.match(setCookie, /HttpOnly; SameSite=Strict; Path=\/viewer/);
  const cookie = setCookie.split(";")[0];
  assert.ok(cookie.startsWith("orch_viewer="));

  const dashboard = await request("/viewer", { headers: { Cookie: cookie } });
  assert.equal(dashboard.status, 200);
  const html = await dashboard.text();
  assert.match(html, /Read-only operator dashboard/);
  assert.match(html, /Source unavailable|Source quality is uncertain/);
  assert.match(html, /workflow|Workflow/i);
  assert.doesNotMatch(html, /<script\b|<form\b|<button\b|<input\b|onclick=|onload=/i);
  assert.match(dashboard.headers.get("content-security-policy") ?? "", /connect-src 'none'/);
  assert.match(dashboard.headers.get("content-security-policy") ?? "", /form-action 'none'/);
  assert.equal(dashboard.headers.get("cache-control"), "no-store, max-age=0");

  const forbidden = await request("/viewer", {
    method: "POST", headers: { Origin: origin, Cookie: cookie },
  });
  assert.equal(forbidden.status, 403);
  const missing = await request("/operator", { headers: { Cookie: cookie } });
  assert.equal(missing.status, 404);
  const unknownAction = await request("/viewer/approve", {
    method: "POST", headers: { Origin: origin, Cookie: cookie },
  });
  assert.ok(unknownAction.status >= 400);
  const crossOrigin = await request("/viewer", {
    headers: { Cookie: cookie, Origin: "http://attacker.invalid" },
  });
  assert.equal(crossOrigin.status, 403);
  assert.ok(!stderr.includes(token));
} finally {
  await terminate();
}
await delay(100);
let gone = false;
try {
  await request("/viewer");
} catch {
  gone = true;
}
assert.ok(gone, "Disposed installed viewer must release localhost listener");
console.log(JSON.stringify({
  slice: "M18E-UX-E2c1",
  platform: process.platform,
  installedBinaryLaunched: true,
  boundLoopback: true,
  unauthenticatedDenied: true,
  authenticatedReadOnlySnapshot: true,
  denyMutationMethods: true,
  strictCsp: true,
  viewerProcessStopped: true,
  portReleased: true,
  serviceInstalled: false,
  daemonStarted: false,
  browserAutomationDone: false,
  releaseAuthorized: false,
}));
