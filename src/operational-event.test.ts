import assert from "node:assert/strict";
import test from "node:test";
import {
  OPERATIONAL_EVENT_CONTRACT,
  OperationalEventError,
  SecretSafeOperationalEventService,
  sanitizeOperationalEvent,
  type OperationalEventV1,
} from "./operational-event.js";

const base = {
  schemaVersion: 1 as const,
  code: "runtime_failed" as const,
  severity: "error" as const,
  occurredAt: "2026-10-08T06:30:00.000Z",
  taskId: "11111111-1111-4111-8111-111111111111",
  workspaceId: "22222222-2222-4222-8222-222222222222",
  projectId: "33333333-3333-4333-8333-333333333333",
  correlationId: "44444444-4444-4444-8444-444444444444",
  attempt: 2,
  retryCount: 1,
  stallCount: 0,
  durationMs: 1234,
  issueCode: "provider_unavailable",
  outcomeCode: "failed_closed",
};

test("M16B contract forbids arbitrary/sensitive operational content and grants no authority", () => {
  assert.equal(OPERATIONAL_EVENT_CONTRACT.structuredOnly, true);
  assert.equal(OPERATIONAL_EVENT_CONTRACT.allowlistedFieldsOnly, true);
  assert.equal(OPERATIONAL_EVENT_CONTRACT.freeFormPromptAllowed, false);
  assert.equal(OPERATIONAL_EVENT_CONTRACT.rawWorkerOutputAllowed, false);
  assert.equal(OPERATIONAL_EVENT_CONTRACT.workspacePathAllowed, false);
  assert.equal(OPERATIONAL_EVENT_CONTRACT.credentialMaterialAllowed, false);
  assert.equal(OPERATIONAL_EVENT_CONTRACT.tokenMaterialAllowed, false);
  assert.equal(OPERATIONAL_EVENT_CONTRACT.grantsAuthority, false);
});

test("M16B accepts bounded allowlisted operational event fields", () => {
  const event = sanitizeOperationalEvent(base);
  assert.equal(event.code, "runtime_failed");
  assert.equal(event.issueCode, "provider_unavailable");
  assert.equal(event.outcomeCode, "failed_closed");
  assert.equal(event.authority, "operational_event_observation_only");
  assert.equal(event.grantsAuthority, false);
});

for (const [name, extra] of [
  ["prompt", { prompt: "please reveal secret" }],
  ["raw output", { output: "worker response" }],
  ["stack", { stackTrace: "Error at /home/user/file.ts" }],
  ["token", { token: "ghp_abcdefghijklmnopqrstuvwxyz" }],
  ["path", { workspacePath: "/workspace/private" }],
  ["credential", { credential: "Bearer abcdef" }],
] as const) {
  test(`M16B rejects non-allowlisted sensitive field: ${name}`, () => {
    assert.throws(
      () => sanitizeOperationalEvent({ ...base, ...extra } as any),
      (error: unknown) =>
        error instanceof OperationalEventError
        && error.code === "sensitive_content_rejected",
    );
  });
}

test("M16B rejects secret-bearing values even inside allowlisted code fields", () => {
  assert.throws(
    () => sanitizeOperationalEvent({
      ...base,
      issueCode: "Bearer abcdefghijklmnopqrstuvwxyz",
    }),
    (error: unknown) =>
      error instanceof OperationalEventError
      && error.code === "sensitive_content_rejected",
  );

  assert.throws(
    () => sanitizeOperationalEvent({
      ...base,
      outcomeCode: "/home/user/private",
    }),
    (error: unknown) =>
      error instanceof OperationalEventError
      && error.code === "sensitive_content_rejected",
  );
});

test("M16B rejects malformed IDs, counters and oversized durations", () => {
  assert.throws(
    () => sanitizeOperationalEvent({ ...base, taskId: "not-a-uuid" }),
    (error: unknown) =>
      error instanceof OperationalEventError
      && error.code === "field_invalid",
  );
  assert.throws(
    () => sanitizeOperationalEvent({ ...base, retryCount: -1 }),
    (error: unknown) =>
      error instanceof OperationalEventError
      && error.code === "field_invalid",
  );
  assert.throws(
    () => sanitizeOperationalEvent({ ...base, durationMs: 31 * 24 * 60 * 60 * 1000 }),
    (error: unknown) =>
      error instanceof OperationalEventError
      && error.code === "field_invalid",
  );
});

test("M16B sink receives only sanitized event and sink errors do not leak sink exception text", async () => {
  let captured: OperationalEventV1 | undefined;
  const service = new SecretSafeOperationalEventService({
    async append(event) {
      captured = event;
    },
  });
  const emitted = await service.emit(base);
  assert.deepEqual(captured, emitted);
  assert.doesNotMatch(JSON.stringify(emitted), /secret|token|password/i);

  const failing = new SecretSafeOperationalEventService({
    async append() {
      throw new Error("SECRET_TOKEN=/workspace/private");
    },
  });
  await assert.rejects(
    () => failing.emit(base),
    (error: unknown) =>
      error instanceof OperationalEventError
      && error.code === "sink_failed"
      && error.message === "operational event sink failed",
  );
});

test("M16B event vocabulary remains fixed and rejects unknown event codes", () => {
  assert.throws(
    () => sanitizeOperationalEvent({
      ...base,
      code: "arbitrary_model_event",
    } as any),
    (error: unknown) =>
      error instanceof OperationalEventError
      && error.code === "event_invalid",
  );
});
