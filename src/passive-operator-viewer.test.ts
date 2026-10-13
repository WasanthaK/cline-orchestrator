import assert from "node:assert/strict";
import test from "node:test";
import { startPassiveOperatorViewer, PASSIVE_VIEWER_CONTRACT } from "./passive-operator-viewer.js";
import type { OperatorVisualizationV1 } from "./operator-visualization.js";

const token = "0123456789abcdef".repeat(4);
function snapshot(): OperatorVisualizationV1 {
  return {
    schemaVersion: 1, generatedAt: new Date().toISOString(), readOnly: true, actions: [],
    header: { health: "unknown", activeTasks: 0, activeWorkflows: 0, openIncidents: 0,
      waitingForHuman: 0, activeWriters: 0, staleSources: 1, unavailableSources: 1 },
    sourceNotices: [{ source: "tasks", available: false, stale: true, truncated: false }],
    attention: [], taskBoard: [], workflows: [], incidents: [], specialistTimeline: [], activeWriters: [],
    truncation: { handoffs: false, writers: false, attention: false, sourceNotices: false },
  };
}
test("UX-E2b opt-in localhost viewer requires sign-in; shows only trusted passive snapshots", async () => {
  let calls = 0;
  const host = await startPassiveOperatorViewer({ readSnapshot: async () => { calls++; return snapshot(); } },
    { host: "127.0.0.1", port: 0, token, testOnlyEphemeralPort: true });
  try {
    assert.equal(PASSIVE_VIEWER_CONTRACT.grantsTaskAuthority, false);
    assert.equal(new URL(host.origin).hostname, "127.0.0.1");
    const anonymous = await fetch(host.origin + "/viewer");
    assert.equal(anonymous.status, 200);
    assert.equal(anonymous.headers.get("referrer-policy"), "same-origin");
    assert.match(await anonymous.text(), /Sign in/);
    assert.equal(calls, 0);
    const nullOrigin = await fetch(host.origin + "/viewer/login", { method: "POST",
      headers: { Origin: "null", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }) });
    assert.equal(nullOrigin.status, 403);
    const wrong = await fetch(host.origin + "/viewer/login", { method: "POST",
      headers: { Origin: host.origin, "Content-Type": "application/x-www-form-urlencoded" },
      body: "token=incorrect" });
    assert.equal(wrong.status, 401);
    const signin = await fetch(host.origin + "/viewer/login", { method: "POST",
      headers: { Origin: host.origin, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }), redirect: "manual" });
    assert.equal(signin.status, 303);
    assert.equal(signin.headers.get("location"), "/viewer");
    assert.doesNotMatch(await signin.text(), /Signed in|token/i);
    const cookie = signin.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie?.startsWith("orch_viewer="));
    assert.match(signin.headers.get("set-cookie") ?? "", /HttpOnly; SameSite=Strict/);
    const loaded = await fetch(host.origin + "/viewer", { headers: { Cookie: cookie! } });
    assert.equal(loaded.status, 200);
    assert.equal(loaded.headers.get("referrer-policy"), "no-referrer");
    const html = await loaded.text();
    assert.match(html, /Read-only operator dashboard/);
    assert.match(html, /Source unavailable/);
    assert.doesNotMatch(html, /<form|<button|<script|<input|onload=|onclick=/i);
    assert.equal(calls, 1);
    assert.equal(loaded.headers.get("cache-control"), "no-store, max-age=0");
    assert.match(loaded.headers.get("content-security-policy") ?? "", /script-src 'none'/);
    const forbidden = await fetch(host.origin + "/viewer", { method: "POST",
      headers: { Origin: host.origin, Cookie: cookie! } });
    assert.equal(forbidden.status, 403);
    const badOrigin = await fetch(host.origin + "/viewer", { headers: { Origin: "http://evil.invalid", Cookie: cookie! } });
    assert.equal(badOrigin.status, 403);
    const unknown = await fetch(host.origin + "/operator", { headers: { Cookie: cookie! } });
    assert.equal(unknown.status, 404);
  } finally { await host.close(); }
});

test("UX-E2b refuses an authority-bearing snapshot rather than displaying it", async () => {
  const host = await startPassiveOperatorViewer({ readSnapshot: async () =>
    ({ ...snapshot(), actions: [{ action: "abort" }] } as unknown as OperatorVisualizationV1) },
    { host: "127.0.0.1", port: 0, token, testOnlyEphemeralPort: true });
  try {
    const signin = await fetch(host.origin + "/viewer/login", { method: "POST",
      headers: { Origin: host.origin, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }), redirect: "manual" });
    const cookie = signin.headers.get("set-cookie")?.split(";")[0]!;
    const denied = await fetch(host.origin + "/viewer", { headers: { Cookie: cookie } });
    assert.equal(denied.status, 503);
    assert.doesNotMatch(await denied.text(), /abort|approve|credential/i);
  } finally { await host.close(); }
});

test("UX-E2b rejects public/invalid listener configuration before binding", async () => {
  for (const config of [
    { host: "0.0.0.0", port: 8080, token },
    { host: "127.0.0.1", port: 0, token },
    { host: "127.0.0.1", port: 8080, token: "short" },
  ]) {
    await assert.rejects(startPassiveOperatorViewer({ readSnapshot: async () => snapshot() },
      config as never), { code: "config_invalid" });
  }
});

test("UX-2 read-only status and task drilldown require a session and expose only sanitized evidence", async () => {
 const taskId = "11111111-2222-3333-4444-555555555555";
 const state = snapshot();
 state.taskBoard = [{ taskId, projectId: "project-safe", workspaceId: "workspace-safe",
   status: "failed", updatedAt: new Date().toISOString(), runCount: 3, recoveryCount: 1,
   waitingForHuman: false, validationPassed: false, diffSafetyPassed: undefined }];
 state.sourceNotices = [];
 const viewer = await startPassiveOperatorViewer({readSnapshot: async () => state},
   {host:"127.0.0.1",port:0,token,testOnlyEphemeralPort:true});
 try {
   const anon = await fetch(viewer.origin + "/viewer/status/failed");
   assert.equal(anon.status,200);
   assert.match(await anon.text(),/Sign in/);
   const sign = await fetch(viewer.origin + "/viewer/login", {method:"POST",redirect:"manual",
     headers:{Origin:viewer.origin,"Content-Type":"application/x-www-form-urlencoded"},
     body:new URLSearchParams({token})});
   const cookie=sign.headers.get("set-cookie")!.split(";")[0]!;
   const filtered=await fetch(viewer.origin + "/viewer/status/failed",{headers:{Cookie:cookie}});
   assert.equal(filtered.status,200);
   const filteredHtml=await filtered.text();
   assert.match(filteredHtml,/1 matching records/);
   assert.match(filteredHtml,/11111111-2222-3333-4444-555555555555/);
   const detail=await fetch(viewer.origin + "/viewer/task/" + taskId,{headers:{Cookie:cookie}});
   assert.equal(detail.status,200);
   const html=await detail.text();
   assert.match(html,/Independent evidence/);
   assert.match(html,/Execution timeline/);
   assert.match(html,/Not available/);
   assert.doesNotMatch(html,/<script|<form|<button|<input|goal|credential/i);
   const missing=await fetch(viewer.origin + "/viewer/task/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",{headers:{Cookie:cookie}});
   assert.equal(missing.status,404);
   const bogus=await fetch(viewer.origin + "/viewer/status/everything",{headers:{Cookie:cookie}});
   assert.equal(bogus.status,404);
   const forged=await fetch(viewer.origin + "/viewer/status/failed",{headers:{Cookie:cookie,Origin:"http://evil.invalid"}});
   assert.equal(forged.status,403);
   const post=await fetch(viewer.origin + "/viewer/status/failed",{method:"POST",headers:{Cookie:cookie,Origin:viewer.origin}});
   assert.equal(post.status,403);
 } finally {await viewer.close();}
});

test("UX-2C signed-in detail shows allowlisted timeline without leaking raw event messages", async () => {
  const id = "11111111-2222-3333-4444-555555555555";
  const state = snapshot();
  state.taskBoard = [{ taskId:id, projectId:"p1",workspaceId:"w1",status:"completed",
    updatedAt:"2026-10-13T01:00:00.000Z",runCount:1,recoveryCount:0,waitingForHuman:false }];
  let timelineCalls=0;
  const viewer=await startPassiveOperatorViewer({
    readSnapshot: async()=>state,
    readTaskTimeline: async(identity)=> {
      timelineCalls++;
      assert.equal(identity.taskId,id);
      return {schemaVersion:1,readOnly:true,availability:"available",truncated:false,totalObserved:1,
        capturedAt:"2026-10-13T01:00:00.000Z",
        events:[{type:"run_started",label:"Run started",at:"2026-10-13T00:59:00.000Z"}]};
    },
  }, {host:"127.0.0.1",port:0,token,testOnlyEphemeralPort:true});
  try {
    await fetch(viewer.origin+"/viewer/task/"+id);
    assert.equal(timelineCalls,0);
    const sign=await fetch(viewer.origin+"/viewer/login",{method:"POST",redirect:"manual",
      headers:{Origin:viewer.origin,"Content-Type":"application/x-www-form-urlencoded"},
      body:new URLSearchParams({token})});
    const cookie=sign.headers.get("set-cookie")!.split(";")[0]!;
    await fetch(viewer.origin+"/viewer",{headers:{Cookie:cookie}});
    assert.equal(timelineCalls,0);
    const detail=await fetch(viewer.origin+"/viewer/task/"+id,{headers:{Cookie:cookie}});
    assert.equal(detail.status,200);
    assert.equal(timelineCalls,1);
    const html=await detail.text();
    assert.match(html,/Run started/);
    assert.match(html,/2026-10-13T00:59:00.000Z/);
    assert.doesNotMatch(html,/<script|<button|<form/);
  } finally {await viewer.close();}
});
