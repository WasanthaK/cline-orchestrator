import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createServer, request } from "node:http";
import test from "node:test";
import type { PublicTaskView } from "./machine-orchestrator.js";
import { localOperatorConfigFromEnvironment, startLocalOperatorControlServer } from "./local-operator-control.js";

const taskId = crypto.randomUUID();
const workspaceId = crypto.randomUUID();
const escalationId = crypto.randomUUID();
const secret = "operator-secret-" + "x".repeat(48);

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No loopback port");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

async function withServer(fn: (context: {
  base: string;
  current: PublicTaskView;
  decisions: string[];
  post(path: string, data: Record<string, string>, cookie?: string, origin?: string): Promise<Response>;
}) => Promise<void>): Promise<void> {
  const port = await availablePort();
  const base = `http://127.0.0.1:${port}`;
  const decisions: string[] = [];
  const current: PublicTaskView = {
    taskId, workspaceId, projectId: crypto.randomUUID(),
    goal: "A goal that should never appear in the page",
    status: "waiting_for_human", createdAt: "2026-09-26T00:00:00.000Z", updatedAt: "2026-09-26T00:00:00.000Z",
    runCount: 1, sessionGeneration: 1, recoveryCount: 0, contextRotationCount: 0,
    validation: { configuredCommands: 0, runCount: 0, repairCount: 0 },
    safety: { safetyPlanId: crypto.randomUUID(), policyVersion: "v1", workerProfileId: "test", allowedPathPatterns: ["src/**"], protectedPathPatterns: [] },
    pendingEscalation: { taskId, escalationId, status: "pending", requestedAt: "2026-09-26T00:00:00.000Z", reason: "private reason", actionKind: "edit", actionFingerprint: "test-fingerprint", reversible: true },
  };
  const service = {
    getTask: async (id: string) => {
      assert.equal(id, taskId);
      return current;
    },
    rejectEscalation: async (id: string, escalation: string) => {
      assert.equal(id, taskId);
      assert.equal(escalation, escalationId);
      decisions.push(escalation);
      current.status = "aborted";
      current.pendingEscalation!.status = "rejected";
      return current;
    },
  };
  const server = startLocalOperatorControlServer(service, { host: "127.0.0.1", port, token: secret });
  const post = (route: string, data: Record<string, string>, cookie?: string, origin = base) => fetch(base + route, {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/x-www-form-urlencoded",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: new URLSearchParams(data),
  });
  try {
    await fn({ base, current, decisions, post });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("operator control is opt-in, loopback-only and requires a strong separate token", () => {
  assert.equal(localOperatorConfigFromEnvironment({}), undefined);
  assert.deepEqual(localOperatorConfigFromEnvironment({ ORCH_OPERATOR_TOKEN: secret }), {
    host: "127.0.0.1", port: 4320, token: secret,
  });
  assert.throws(() => localOperatorConfigFromEnvironment({ ORCH_OPERATOR_TOKEN: "weak" }), /32/);
  assert.throws(() => localOperatorConfigFromEnvironment({ ORCH_OPERATOR_TOKEN: secret, ORCH_OPERATOR_PORT: "0" }), /PORT/);
});

test("local form requires authentication, origin, CSRF and an explicit one-time confirmation", async () => {
  await withServer(async ({ base, decisions, post }) => {
    const loginPage = await fetch(base + "/operator");
    assert.equal(loginPage.status, 200);
    assert.match(loginPage.headers.get("content-security-policy") ?? "", /script-src 'none'/);
    assert.match(loginPage.headers.get("content-security-policy") ?? "", /form-action 'self'/);
    assert.equal((await loginPage.text()).includes(secret), false);
    const wrongHost = await new Promise<number>((resolve, reject) => {
      const req = request(base + "/operator", { headers: { Host: "evil.invalid" } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on("error", reject).end();
    });
    assert.equal(wrongHost, 403);

    const unauthenticated = await post("/operator/preview", { task_id: taskId, csrf: "bad" });
    assert.equal(unauthenticated.status, 401);
    const crossOrigin = await post("/operator/login", { token: secret }, undefined, "http://evil.invalid");
    assert.equal(crossOrigin.status, 403);
    const wrongLogin = await post("/operator/login", { token: "bad" });
    assert.equal(wrongLogin.status, 401);
    assert.equal(decisions.length, 0);

    const login = await post("/operator/login", { token: secret });
    assert.equal(login.status, 200);
    const setCookie = login.headers.get("set-cookie") ?? "";
    assert.match(setCookie, /HttpOnly; SameSite=Strict; Path=\/operator/);
    const cookie = setCookie.split(";")[0]!;
    const control = await fetch(base + "/operator", { headers: { Cookie: cookie } });
    const html = await control.text();
    const csrf = html.match(/name="csrf" value="([0-9a-f]{64})"/)?.[1];
    assert.ok(csrf);
    assert.equal(html.includes(secret), false);

    const badCsrf = await post("/operator/preview", { task_id: taskId, csrf: "wrong" }, cookie);
    assert.equal(badCsrf.status, 403);
    const preview = await post("/operator/preview", { task_id: taskId, csrf }, cookie);
    assert.equal(preview.status, 200);
    const previewHtml = await preview.text();
    assert.match(previewHtml, /Reject escalation and close task/);
    assert.equal(previewHtml.includes("A goal that should never appear"), false);
    assert.equal(previewHtml.includes("private reason"), false);
    const token = previewHtml.match(/name="confirmation_token" value="([0-9a-f]{64})"/)?.[1];
    assert.ok(token);

    const secondLogin = await post("/operator/login", { token: secret });
    const otherCookie = (secondLogin.headers.get("set-cookie") ?? "").split(";")[0]!;
    const otherHtml = await (await fetch(base + "/operator", { headers: { Cookie: otherCookie } })).text();
    const otherCsrf = otherHtml.match(/name="csrf" value="([0-9a-f]{64})"/)?.[1]!;
    const crossSession = await post("/operator/confirm", { task_id: taskId, csrf: otherCsrf, confirmation_token: token, confirmed: "yes" }, otherCookie);
    assert.equal(crossSession.status, 403);
    assert.equal(decisions.length, 0);

    const noConfirmation = await post("/operator/confirm", { task_id: taskId, csrf, confirmation_token: token }, cookie);
    assert.equal(noConfirmation.status, 400);
    const confirmed = await post("/operator/confirm", { task_id: taskId, csrf, confirmation_token: token, confirmed: "yes" }, cookie);
    assert.equal(confirmed.status, 200);
    assert.equal(decisions.length, 1);
    const replay = await post("/operator/confirm", { task_id: taskId, csrf, confirmation_token: token, confirmed: "yes" }, cookie);
    assert.equal(replay.status, 403);
    assert.equal(decisions.length, 1);

    const logout = await post("/operator/logout", { csrf }, cookie);
    assert.equal(logout.status, 200);
    assert.equal((await fetch(base + "/operator", { headers: { Cookie: cookie } })).status, 200);
    assert.equal((await post("/operator/preview", { task_id: taskId, csrf }, cookie)).status, 401);
  });
});

test("task drift after preview refuses confirmation without calling the service action", async () => {
  await withServer(async ({ base, current, decisions, post }) => {
    const login = await post("/operator/login", { token: secret });
    const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0]!;
    const html = await (await fetch(base + "/operator", { headers: { Cookie: cookie } })).text();
    const csrf = html.match(/name="csrf" value="([0-9a-f]{64})"/)?.[1]!;
    const previewHtml = await (await post("/operator/preview", { task_id: taskId, csrf }, cookie)).text();
    const token = previewHtml.match(/name="confirmation_token" value="([0-9a-f]{64})"/)?.[1]!;
    current.updatedAt = "2026-09-26T00:01:00.000Z";
    const result = await post("/operator/confirm", { task_id: taskId, csrf, confirmation_token: token, confirmed: "yes" }, cookie);
    assert.equal(result.status, 409);
    assert.equal(decisions.length, 0);
  });
});
