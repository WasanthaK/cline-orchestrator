import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  DISTRIBUTED_CANDIDATE_ROUTER_CONTRACT,
  DistributedCandidateRouter,
  DistributedCandidateRouterError,
  type DistributedCandidateRouteRequestV1,
} from "./distributed-candidate-router.js";
import { DistributedMachineTransportGateway } from "./distributed-machine-transport.js";
import { DistributedPlacementStore } from "./distributed-placement-store.js";
import { DistributedRegistrationStore } from "./distributed-registration-store.js";
import type { DistributedMachineCapabilityV1 } from "./distributed-control-contract.js";

const IDS = {
  registration: "11111111-1111-4111-8111-111111111111",
  machine: "22222222-2222-4222-8222-222222222222",
  placement: "33333333-3333-4333-8333-333333333333",
  workspace: "44444444-4444-4444-8444-444444444444",
  task: "55555555-5555-4555-8555-555555555555",
  session: "66666666-6666-4666-8666-666666666666",
  assignment: "77777777-7777-4777-8777-777777777777",
  statusRequest: "88888888-8888-4888-8888-888888888888",
};

const TOKEN = `dmt_${"a".repeat(48)}`;

interface Fixture {
  root: string;
  now: () => Date;
  advance(ms: number): void;
  registrations: DistributedRegistrationStore;
  placements: DistributedPlacementStore;
  transport: DistributedMachineTransportGateway;
  router: DistributedCandidateRouter;
  token: string;
}

async function createFixture(options: {
  capabilities?: DistributedMachineCapabilityV1[];
  reportStatus?: boolean;
  acceptingWriterCandidates?: boolean;
} = {}): Promise<Fixture> {
  const root = await mkdtemp(path.join(os.tmpdir(), "cline-m12d-"));
  let nowMs = Date.parse("2026-09-29T01:00:00.000Z");
  const now = () => new Date(nowMs);
  const advance = (ms: number) => { nowMs += ms; };
  const capabilities = options.capabilities ?? ["report_status", "accept_writer_candidates"];

  const registrations = new DistributedRegistrationStore(root, {
    now,
    idFactory: () => IDS.registration,
  });
  await registrations.create({
    machineId: IDS.machine,
    allowedCapabilities: capabilities,
  });

  const placements = new DistributedPlacementStore(root, registrations, {
    now,
    idFactory: () => IDS.placement,
  });
  await placements.create({
    workspaceId: IDS.workspace,
    machineRegistrationId: IDS.registration,
    expectedMachineRegistrationRevision: 1,
  });

  const transport = new DistributedMachineTransportGateway(registrations, {
    now,
    idFactory: () => IDS.session,
    tokenFactory: () => TOKEN,
  });
  const issue = await transport.issue(IDS.registration, {
    capabilities,
    ttlMs: 5 * 60_000,
  });

  if (options.reportStatus !== false) {
    await transport.reportStatus(issue.token, IDS.statusRequest, {
      status: "ready",
      acceptingWriterCandidates: options.acceptingWriterCandidates ?? capabilities.includes("accept_writer_candidates"),
    });
  }

  const router = new DistributedCandidateRouter(
    placements,
    registrations,
    transport,
    { now, idFactory: () => IDS.assignment },
  );

  return {
    root,
    now,
    advance,
    registrations,
    placements,
    transport,
    router,
    token: issue.token,
  };
}

async function withFixture(
  options: Parameters<typeof createFixture>[0],
  run: (fixture: Fixture) => Promise<void>,
): Promise<void> {
  const fixture = await createFixture(options);
  try {
    await run(fixture);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}

const routeRequest = (ttlMs = 60_000): DistributedCandidateRouteRequestV1 => ({
  taskId: IDS.task,
  workspaceId: IDS.workspace,
  ttlMs,
});

function hasRouterCode(code: DistributedCandidateRouterError["code"]) {
  return (error: unknown) => error instanceof DistributedCandidateRouterError && error.code === code;
}

test("M12D routing remains coordination-only and distributed execution stays disabled", () => {
  assert.equal(DISTRIBUTED_CANDIDATE_ROUTER_CONTRACT.requiresCurrentPlacement, true);
  assert.equal(DISTRIBUTED_CANDIDATE_ROUTER_CONTRACT.requiresCurrentMachineRegistration, true);
  assert.equal(DISTRIBUTED_CANDIDATE_ROUTER_CONTRACT.requiresFreshLiveness, true);
  assert.equal(DISTRIBUTED_CANDIDATE_ROUTER_CONTRACT.revalidatesAfterAssignmentCreation, true);
  assert.equal(DISTRIBUTED_CANDIDATE_ROUTER_CONTRACT.networkCommandDeliveryEnabled, false);
  assert.equal(DISTRIBUTED_CANDIDATE_ROUTER_CONTRACT.taskExecutionEnabled, false);
  assert.equal(DISTRIBUTED_CANDIDATE_ROUTER_CONTRACT.distributedWriteDispatchEnabled, false);
  assert.equal(DISTRIBUTED_CANDIDATE_ROUTER_CONTRACT.distributedWriteExecutionEnabled, false);
  assert.equal(DISTRIBUTED_CANDIDATE_ROUTER_CONTRACT.grantsTaskAuthority, false);
  assert.equal(DISTRIBUTED_CANDIDATE_ROUTER_CONTRACT.grantsWriterLeaseAuthority, false);
  assert.equal(DISTRIBUTED_CANDIDATE_ROUTER_CONTRACT.grantsReleaseAuthority, false);
});

test("routes one current placed live machine into the existing M12A coordination-only assignment", async () => {
  await withFixture({}, async ({ router }) => {
    const assignment = await router.routeCandidate(routeRequest());
    assert.equal(assignment.assignmentId, IDS.assignment);
    assert.equal(assignment.taskId, IDS.task);
    assert.equal(assignment.workspaceId, IDS.workspace);
    assert.equal(assignment.machineId, IDS.machine);
    assert.equal(assignment.machineRegistrationId, IDS.registration);
    assert.equal(assignment.machineRegistrationRevision, 1);
    assert.equal(assignment.placementId, IDS.placement);
    assert.equal(assignment.placementRevision, 1);
    assert.equal(assignment.authority, "coordination_only");
    assert.equal(assignment.grantsTaskAuthority, false);
    assert.equal(assignment.grantsFilesystemAuthority, false);
    assert.equal(assignment.grantsSafetyPlanAuthority, false);
    assert.equal(assignment.grantsWriterLeaseAuthority, false);
    assert.equal(assignment.grantsCredentialAuthority, false);
    assert.equal(assignment.grantsReleaseAuthority, false);

    const serialized = JSON.stringify(assignment);
    for (const forbidden of [
      "canonicalRoot",
      "workspacePath",
      "command",
      "safetyPlan",
      "credential",
      "hubToken",
      "writerLease",
      "releaseAuthority",
    ]) {
      assert.equal(serialized.includes(forbidden), false);
    }
  });
});

test("fails closed when the workspace has no active placement", async () => {
  await withFixture({}, async ({ router, placements }) => {
    await placements.disable(IDS.placement, { expectedRevision: 1 });
    await assert.rejects(
      router.routeCandidate(routeRequest()),
      hasRouterCode("placement_not_found"),
    );
  });
});

test("fails closed on unknown or stale liveness", async () => {
  await withFixture({ reportStatus: false }, async ({ router }) => {
    await assert.rejects(
      router.routeCandidate(routeRequest()),
      hasRouterCode("machine_not_live"),
    );
  });

  await withFixture({}, async ({ router, advance }) => {
    advance(30_000);
    await assert.rejects(
      router.routeCandidate(routeRequest()),
      hasRouterCode("machine_not_live"),
    );
  });
});

test("requires explicit writer-candidate acceptance and registered capability", async () => {
  await withFixture({ acceptingWriterCandidates: false }, async ({ router }) => {
    await assert.rejects(
      router.routeCandidate(routeRequest()),
      hasRouterCode("machine_not_accepting_candidates"),
    );
  });

  await withFixture({ capabilities: ["report_status"], acceptingWriterCandidates: false }, async ({ router }) => {
    await assert.rejects(
      router.routeCandidate(routeRequest()),
      hasRouterCode("capability_not_allowed"),
    );
  });
});

test("registration revision drift or revocation invalidates the placement before routing", async () => {
  await withFixture({}, async ({ router, registrations, advance }) => {
    advance(1_000);
    await registrations.update(IDS.registration, {
      expectedRevision: 1,
      allowedCapabilities: ["report_status", "accept_writer_candidates"],
    });
    await assert.rejects(
      router.routeCandidate(routeRequest()),
      hasRouterCode("registration_not_current"),
    );
  });

  await withFixture({}, async ({ router, registrations, advance }) => {
    advance(1_000);
    await registrations.revoke(IDS.registration, { expectedRevision: 1 });
    await assert.rejects(
      router.routeCandidate(routeRequest()),
      hasRouterCode("registration_not_current"),
    );
  });
});

test("issued candidate becomes invalid after placement disable, registration change, or assignment expiry", async () => {
  await withFixture({}, async ({ router, placements, advance }) => {
    const assignment = await router.routeCandidate(routeRequest());
    advance(1_000);
    await placements.disable(IDS.placement, { expectedRevision: 1 });
    await assert.rejects(
      router.assertCandidateCurrent(assignment),
      hasRouterCode("candidate_not_current"),
    );
  });

  await withFixture({}, async ({ router, registrations, advance }) => {
    const assignment = await router.routeCandidate(routeRequest());
    advance(1_000);
    await registrations.update(IDS.registration, {
      expectedRevision: 1,
      allowedCapabilities: ["report_status", "accept_writer_candidates"],
    });
    await assert.rejects(
      router.assertCandidateCurrent(assignment),
      hasRouterCode("candidate_not_current"),
    );
  });

  await withFixture({}, async ({ router, advance }) => {
    const assignment = await router.routeCandidate(routeRequest(1_000));
    advance(1_000);
    await assert.rejects(
      router.assertCandidateCurrent(assignment),
      hasRouterCode("candidate_not_current"),
    );
  });
});

test("post-creation revalidation rejects a route that changes during candidate selection", async () => {
  await withFixture({}, async ({ placements, registrations, transport, now }) => {
    const racingPlacements = {
      list: () => placements.list(),
      get: async (placementId: string) => {
        const current = await placements.get(placementId);
        return {
          ...current,
          revision: current.revision + 1,
          updatedAt: new Date(now().getTime() + 1).toISOString(),
        };
      },
    };
    const router = new DistributedCandidateRouter(
      racingPlacements,
      registrations,
      transport,
      { now, idFactory: () => IDS.assignment },
    );
    await assert.rejects(
      router.routeCandidate(routeRequest()),
      hasRouterCode("candidate_not_current"),
    );
  });
});

test("unexpected request fields cannot smuggle command, path, or authority material into routing", async () => {
  await withFixture({}, async ({ router }) => {
    await assert.rejects(
      router.routeCandidate({
        ...routeRequest(),
        command: "npm test",
      } as unknown as DistributedCandidateRouteRequestV1),
      hasRouterCode("request_invalid"),
    );
    await assert.rejects(
      router.routeCandidate({
        ...routeRequest(),
        canonicalRoot: "C:\\secret\\workspace",
      } as unknown as DistributedCandidateRouteRequestV1),
      hasRouterCode("request_invalid"),
    );
  });
});
