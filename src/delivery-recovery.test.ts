import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  DELIVERY_RECOVERY_CONTRACT,
  DeliveryRecoveryError,
  DeliveryRecoveryService,
  FileDeliveryConsumedIntentStore,
  type DeliveryConsumedIntentV1,
} from "./delivery-recovery.js";

const permitId = "11111111-1111-4111-8111-111111111111";
const proposalId = "22222222-2222-4222-8222-222222222222";
const taskId = "33333333-3333-4333-8333-333333333333";

async function writeIntent(
  root: string,
  dir: string,
  value: Record<string, unknown>,
) {
  const target = path.join(root, dir);
  await mkdir(target, { recursive: true });
  await writeFile(
    path.join(target, `${permitId}.json`),
    JSON.stringify({
      schemaVersion: 1,
      permitId,
      proposalId,
      taskId,
      burnedAt: "2026-10-08T05:00:00.000Z",
      ...value,
    }),
    "utf8",
  );
}

function observer(classification: "confirmed_applied" | "confirmed_not_applied" | "ambiguous") {
  return {
    async observe(intent: DeliveryConsumedIntentV1) {
      return {
        schemaVersion: 1 as const,
        permitId: intent.permitId,
        proposalId: intent.proposalId,
        taskId: intent.taskId,
        action: intent.action,
        classification,
        observedAt: "2026-10-08T05:10:00.000Z",
        summary: `observed ${classification}`,
        authority: "delivery_recovery_observation" as const,
        mutatesGit: false as const,
        mutatesGitHub: false as const,
        deploys: false as const,
        usesCredentials: false as const,
        grantsReleaseAuthority: false as const,
      };
    },
  };
}

test("M15G contract is observation-only and cannot replay or mint retry authority", () => {
  assert.equal(DELIVERY_RECOVERY_CONTRACT.observesOnly, true);
  assert.equal(DELIVERY_RECOVERY_CONTRACT.replaysMutation, false);
  assert.equal(DELIVERY_RECOVERY_CONTRACT.reusesConsumedPermit, false);
  assert.equal(DELIVERY_RECOVERY_CONTRACT.mintsRetryAuthority, false);
  assert.equal(DELIVERY_RECOVERY_CONTRACT.grantsReleaseAuthority, false);
});

test("M15G loads durable push intent after restart and classifies confirmed applied", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cline-orchestrator-m15g-push-"));
  try {
    await writeIntent(root, "github-push-consumed", {
      action: "push",
      commitSha: "a".repeat(40),
      remoteName: "origin",
      destinationRef: "refs/heads/feature/test",
    });

    const result = await new DeliveryRecoveryService(
      new FileDeliveryConsumedIntentStore(root),
      observer("confirmed_applied"),
    ).recover("push", permitId);

    assert.equal(result.classification, "confirmed_applied");
    assert.equal(result.consumedPermitReusable, false);
    assert.equal(result.retryRequiresNewExplicitAuthorization, true);
    assert.equal(result.grantsReleaseAuthority, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("M15G supports PR, merge and deploy recovery intents without mutation", async () => {
  const cases = [
    {
      action: "pull_request" as const,
      dir: "github-pr-consumed",
      extra: {
        repository: "WasanthaK/example",
        baseRef: "main",
        headRef: "feature/test",
        headSha: "a".repeat(40),
      },
    },
    {
      action: "merge" as const,
      dir: "github-merge-consumed",
      extra: {
        repository: "WasanthaK/example",
        pullRequestNumber: 42,
        expectedHeadSha: "a".repeat(40),
        baseRef: "main",
        mergeMethod: "squash",
      },
    },
    {
      action: "deploy" as const,
      dir: "deployment-consumed",
      extra: {
        provider: "example-cloud",
        application: "app",
        environment: "production",
        targetId: "primary",
        expectedRevision: "b".repeat(40),
      },
    },
  ];

  for (const item of cases) {
    const root = await mkdtemp(path.join(os.tmpdir(), `cline-orchestrator-m15g-${item.action}-`));
    try {
      await writeIntent(root, item.dir, { action: item.action, ...item.extra });
      const result = await new DeliveryRecoveryService(
        new FileDeliveryConsumedIntentStore(root),
        observer("confirmed_not_applied"),
      ).recover(item.action, permitId);

      assert.equal(result.classification, "confirmed_not_applied");
      assert.equal(result.retryRequiresNewExplicitAuthorization, true);
      assert.equal(result.consumedPermitReusable, false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("M15G permits fail-closed ambiguous commit recovery when durable intent cannot prove outcome", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cline-orchestrator-m15g-commit-"));
  try {
    await writeIntent(root, "github-local-commit-consumed", {
      action: "commit",
    });

    const result = await new DeliveryRecoveryService(
      new FileDeliveryConsumedIntentStore(root),
      observer("ambiguous"),
    ).recover("commit", permitId);

    assert.equal(result.classification, "ambiguous");
    assert.equal(result.retryRequiresNewExplicitAuthorization, true);
    assert.equal(result.consumedPermitReusable, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("M15G rejects malformed cross-bound durable recovery intent", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cline-orchestrator-m15g-invalid-"));
  try {
    await writeIntent(root, "github-push-consumed", {
      action: "push",
      remoteName: "origin",
      destinationRef: "refs/heads/feature/test",
      // missing commitSha
    });

    await assert.rejects(
      () => new DeliveryRecoveryService(
        new FileDeliveryConsumedIntentStore(root),
        observer("ambiguous"),
      ).recover("push", permitId),
      (error: unknown) =>
        error instanceof DeliveryRecoveryError
        && error.code === "intent_invalid",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("M15G rejects observer output that attempts authority widening", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cline-orchestrator-m15g-wide-"));
  try {
    await writeIntent(root, "github-push-consumed", {
      action: "push",
      commitSha: "a".repeat(40),
      remoteName: "origin",
      destinationRef: "refs/heads/feature/test",
    });

    await assert.rejects(
      () => new DeliveryRecoveryService(
        new FileDeliveryConsumedIntentStore(root),
        {
          async observe(intent) {
            return {
              schemaVersion: 1,
              permitId: intent.permitId,
              proposalId: intent.proposalId,
              taskId: intent.taskId,
              action: intent.action,
              classification: "confirmed_applied",
              observedAt: "2026-10-08T05:10:00.000Z",
              summary: "unsafe observer",
              authority: "delivery_recovery_observation",
              mutatesGit: false,
              mutatesGitHub: false,
              deploys: false,
              usesCredentials: false,
              grantsReleaseAuthority: true,
            } as any;
          },
        },
      ).recover("push", permitId),
      (error: unknown) =>
        error instanceof DeliveryRecoveryError
        && error.code === "observation_invalid",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
