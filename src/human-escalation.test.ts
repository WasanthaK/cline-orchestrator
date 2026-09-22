import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import "./safety-task-augmentation.js";
import { HumanEscalationService } from "./human-escalation.js";
import { TaskStore } from "./state.js";
import type { OrchestratorTask } from "./types.js";

test("persists escalation and moves task to waiting_for_human", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "orch-escalation-"));
  const store = new TaskStore(root);
  const now = new Date().toISOString();
  const task: OrchestratorTask = {
    id: "task-1",
    goal: "change one source file",
    workspace: root,
    status: "created",
    createdAt: now,
    updatedAt: now,
    safetyPolicyVersion: "policy-1",
  };
  await store.save(task);

  const service = new HumanEscalationService(store);
  const escalation = await service.request(
    task.id,
    { kind: "edit", paths: ["docs/outside.md"], operation: "modify" },
    "Requested write is outside the approved Safety Plan scope",
  );

  const persisted = await store.load(task.id);
  assert.equal(persisted.status, "waiting_for_human");
  assert.equal(persisted.pendingEscalation?.escalationId, escalation.escalationId);
  assert.equal(persisted.pendingEscalation?.status, "pending");
  assert.equal(persisted.pendingEscalation?.safetyPolicyVersion, "policy-1");
  assert.match(persisted.pendingEscalation?.actionFingerprint ?? "", /^[a-f0-9]{64}$/);

  const events = await store.events(task.id);
  const requested = events.find((event) => event.type === "human_escalation_requested");
  assert.ok(requested);
  assert.equal(requested.status, "waiting_for_human");
});

test("repeated escalation requests do not replace an already-pending grant boundary", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "orch-escalation-repeat-"));
  const store = new TaskStore(root);
  const now = new Date().toISOString();
  await store.save({ id: "task-2", goal: "goal", workspace: root, status: "created", createdAt: now, updatedAt: now });
  const service = new HumanEscalationService(store);

  const first = await service.request("task-2", { kind: "edit", paths: ["docs/a.md"], operation: "modify" }, "outside scope");
  const second = await service.request("task-2", { kind: "edit", paths: ["docs/b.md"], operation: "modify" }, "another request");
  assert.equal(second.escalationId, first.escalationId);

  const events = await store.events("task-2");
  assert.equal(events.filter((event) => event.type === "human_escalation_requested").length, 1);
});
