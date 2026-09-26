import assert from "node:assert/strict";
import test from "node:test";
import {
  CONCURRENCY_BUDGET_LIMITS,
  ConcurrencyBudgetError,
  planWriterConcurrency,
  validateWriterConcurrencyBudget,
  type ActiveWriterEvidenceV1,
  type WriterConcurrencyBudgetV1,
} from "./concurrency-budget.js";

const IDS = {
  workspace1: "11111111-1111-4111-8111-111111111111",
  workspace2: "22222222-2222-4222-8222-222222222222",
  workspace3: "33333333-3333-4333-8333-333333333333",
  workspace4: "44444444-4444-4444-8444-444444444444",
  task1: "55555555-5555-4555-8555-555555555555",
  task2: "66666666-6666-4666-8666-666666666666",
  task3: "77777777-7777-4777-8777-777777777777",
  task4: "88888888-8888-4888-8888-888888888888",
  owner1: "99999999-9999-4999-8999-999999999999",
  lease1: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  fence1: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
};

const T0 = new Date("2026-09-25T08:30:00.000Z");

function budget(overrides: Partial<WriterConcurrencyBudgetV1> = {}): WriterConcurrencyBudgetV1 {
  return {
    schemaVersion: 1,
    maxActiveWriters: 3,
    maxStartsPerPass: 2,
    maxActiveWritersPerWorkspace: 1,
    ...overrides,
  };
}

function activeWriter(overrides: Partial<ActiveWriterEvidenceV1> = {}): ActiveWriterEvidenceV1 {
  return {
    workspaceId: IDS.workspace1,
    taskId: IDS.task1,
    ownerInstanceId: IDS.owner1,
    leaseId: IDS.lease1,
    fenceToken: IDS.fence1,
    expiresAt: "2026-09-25T08:31:00.000Z",
    ...overrides,
  };
}

test("budget is explicit, bounded and fixes one writer per workspace", () => {
  assert.deepEqual(validateWriterConcurrencyBudget(budget()), budget());
  const invalidBudgets: unknown[] = [
    budget({ maxActiveWriters: 0 }),
    budget({ maxActiveWriters: CONCURRENCY_BUDGET_LIMITS.maxActiveWriters + 1 }),
    budget({ maxStartsPerPass: 0 }),
    budget({ maxStartsPerPass: CONCURRENCY_BUDGET_LIMITS.maxStartsPerPass + 1 }),
    { ...budget(), maxActiveWritersPerWorkspace: 2 },
  ];
  for (const invalid of invalidBudgets) {
    assert.throws(
      () => validateWriterConcurrencyBudget(invalid as WriterConcurrencyBudgetV1),
      (error: unknown) => error instanceof ConcurrencyBudgetError && error.code === "budget_invalid",
    );
  }
});

test("planner admits only bounded cross-workspace starts and preserves coordination-only semantics", () => {
  const result = planWriterConcurrency(
    budget(),
    [activeWriter()],
    [
      { workspaceId: IDS.workspace2, taskId: IDS.task2 },
      { workspaceId: IDS.workspace3, taskId: IDS.task3 },
      { workspaceId: IDS.workspace4, taskId: IDS.task4 },
    ],
    T0,
  );

  assert.equal(result.activeWriterCount, 1);
  assert.equal(result.admittedCount, 2);
  assert.deepEqual(result.decisions.map((item) => [item.allowed, item.reason]), [
    [true, "admitted"],
    [true, "admitted"],
    [false, "global_budget_exhausted"],
  ]);
  assert.equal(result.authority, "coordination_only");
  assert.equal(result.decisions.every((item) => item.authority === "coordination_only"), true);

  const serialized = JSON.stringify(result);
  for (const forbidden of [
    "workspaceRoot",
    "allowedPathPatterns",
    "protectedPathPatterns",
    "validationCommands",
    "safetyPlanId",
    "workerProfileId",
    "hubSessionId",
    "apiKey",
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test("occupied or already-reserved workspaces are denied while another workspace can be admitted", () => {
  const result = planWriterConcurrency(
    budget({ maxActiveWriters: 4, maxStartsPerPass: 3 }),
    [activeWriter()],
    [
      { workspaceId: IDS.workspace1, taskId: IDS.task2 },
      { workspaceId: IDS.workspace2, taskId: IDS.task3 },
      { workspaceId: IDS.workspace2, taskId: IDS.task4 },
    ],
    T0,
  );

  assert.deepEqual(result.decisions.map((item) => item.reason), [
    "workspace_writer_conflict",
    "admitted",
    "workspace_writer_conflict",
  ]);
  assert.equal(result.admittedCount, 1);
});

test("per-pass start ceiling is independent from remaining global writer capacity", () => {
  const result = planWriterConcurrency(
    budget({ maxActiveWriters: 4, maxStartsPerPass: 1 }),
    [],
    [
      { workspaceId: IDS.workspace1, taskId: IDS.task1 },
      { workspaceId: IDS.workspace2, taskId: IDS.task2 },
    ],
    T0,
  );

  assert.deepEqual(result.decisions.map((item) => item.reason), [
    "admitted",
    "pass_start_budget_exhausted",
  ]);
});

test("expired, duplicated, over-budget or malformed active evidence fails closed", () => {
  assert.throws(
    () => planWriterConcurrency(
      budget(),
      [activeWriter({ expiresAt: "2026-09-25T08:30:00.000Z" })],
      [],
      T0,
    ),
    (error: unknown) => error instanceof ConcurrencyBudgetError && error.code === "evidence_invalid",
  );

  assert.throws(
    () => planWriterConcurrency(
      budget({ maxActiveWriters: 3 }),
      [
        activeWriter(),
        activeWriter({ taskId: IDS.task2 }),
      ],
      [],
      T0,
    ),
    (error: unknown) => error instanceof ConcurrencyBudgetError && error.code === "evidence_invalid",
  );

  assert.throws(
    () => planWriterConcurrency(
      budget({ maxActiveWriters: 1 }),
      [
        activeWriter(),
        activeWriter({
          workspaceId: IDS.workspace2,
          taskId: IDS.task2,
          ownerInstanceId: IDS.task3,
          leaseId: IDS.task4,
          fenceToken: IDS.workspace3,
        }),
      ],
      [],
      T0,
    ),
    (error: unknown) => error instanceof ConcurrencyBudgetError && error.code === "evidence_invalid",
  );

  assert.throws(
    () => planWriterConcurrency(
      budget(),
      [],
      [{ workspaceId: "../outside", taskId: IDS.task1 }],
      T0,
    ),
    (error: unknown) => error instanceof ConcurrencyBudgetError && error.code === "evidence_invalid",
  );
});

test("candidate tasks cannot be duplicated or already active", () => {
  assert.throws(
    () => planWriterConcurrency(
      budget(),
      [activeWriter()],
      [{ workspaceId: IDS.workspace2, taskId: IDS.task1 }],
      T0,
    ),
    (error: unknown) => error instanceof ConcurrencyBudgetError && error.code === "evidence_invalid",
  );

  assert.throws(
    () => planWriterConcurrency(
      budget(),
      [],
      [
        { workspaceId: IDS.workspace1, taskId: IDS.task1 },
        { workspaceId: IDS.workspace2, taskId: IDS.task1 },
      ],
      T0,
    ),
    (error: unknown) => error instanceof ConcurrencyBudgetError && error.code === "evidence_invalid",
  );
});
