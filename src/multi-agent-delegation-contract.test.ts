import assert from "node:assert/strict";
import test from "node:test";
import {
  createMultiAgentDelegationEnvelope,
  MultiAgentDelegationError,
  MULTI_AGENT_DELEGATION_CONTRACT,
} from "./multi-agent-delegation-contract.js";
import type { SupervisorTaskV1 } from "./supervisor-task.js";

const parent: SupervisorTaskV1 = {
  schemaVersion: 1,
  supervisorTaskId: "11111111-1111-4111-8111-111111111111",
  createdAt: "2026-10-06T00:00:00.000Z",
  taskId: "22222222-2222-4222-8222-222222222222",
  objective: "Implement approved changes",
  acceptanceCriteria: ["Tests pass"],
  trustedValidationCommands: ["npm test"],
  authority: {
    projectId: "33333333-3333-4333-8333-333333333333",
    workspaceId: "44444444-4444-4444-8444-444444444444",
    workspaceRegistryRevision: 2,
    safetyPlanId: "55555555-5555-4555-8555-555555555555",
    safetyPolicyVersion: "policy-v1",
    safetyProfileId: "66666666-6666-4666-8666-666666666666",
    safetyProfileRevision: 3,
    workerProfileId: "default",
    allowedPathPatterns: ["src/a.ts", "src/b.ts"],
    protectedPathPatterns: [".env*", ".git/**"],
  },
  constraints: {
    scopeExpansion: "stop_and_escalate",
    repositoryInstructionsGrantAuthority: false,
    modelShellAllowed: false,
    modelNetworkAllowed: false,
    modelMcpAllowed: false,
    modelPluginsAllowed: false,
    subagentsAllowed: false,
    agentTeamsAllowed: false,
    validationRunsExternally: true,
    completionRequiresOrchestratorValidation: true,
    completionRequiresDiffSafety: true,
  },
};

test("M13A contract is envelope-only and grants no execution authority", () => {
  assert.equal(MULTI_AGENT_DELEGATION_CONTRACT.createsWorker, false);
  assert.equal(MULTI_AGENT_DELEGATION_CONTRACT.startsCline, false);
  assert.equal(MULTI_AGENT_DELEGATION_CONTRACT.invokesRuntime, false);
  assert.equal(MULTI_AGENT_DELEGATION_CONTRACT.allowsSubdelegation, false);
  assert.equal(MULTI_AGENT_DELEGATION_CONTRACT.allowsAgentTeams, false);
  assert.equal(MULTI_AGENT_DELEGATION_CONTRACT.allowsShell, false);
  assert.equal(MULTI_AGENT_DELEGATION_CONTRACT.allowsNetwork, false);
  assert.equal(MULTI_AGENT_DELEGATION_CONTRACT.grantsTaskAuthority, false);
  assert.equal(MULTI_AGENT_DELEGATION_CONTRACT.grantsFilesystemAuthority, false);
  assert.equal(MULTI_AGENT_DELEGATION_CONTRACT.grantsReleaseAuthority, false);
});

test("bounded child envelope inherits immutable authority and may select exact parent scope", () => {
  const envelope = createMultiAgentDelegationEnvelope(
    parent,
    {
      objective: "Implement only the A portion",
      acceptanceCriteria: ["A behavior is correct"],
      allowedPathPatterns: ["src/a.ts"],
    },
    {
      now: () => new Date("2026-10-06T00:01:00.000Z"),
      idFactory: () => "77777777-7777-4777-8777-777777777777",
    },
  );

  assert.equal(envelope.delegationId, "77777777-7777-4777-8777-777777777777");
  assert.equal(envelope.parentSupervisorTaskId, parent.supervisorTaskId);
  assert.equal(envelope.taskId, parent.taskId);
  assert.equal(envelope.projectId, parent.authority.projectId);
  assert.equal(envelope.workspaceId, parent.authority.workspaceId);
  assert.equal(envelope.safetyPlanId, parent.authority.safetyPlanId);
  assert.equal(envelope.workerProfileId, parent.authority.workerProfileId);
  assert.deepEqual(envelope.allowedPathPatterns, ["src/a.ts"]);
  assert.deepEqual(envelope.protectedPathPatterns, parent.authority.protectedPathPatterns);
  assert.equal(envelope.authority, "delegation_envelope_only");
  assert.equal(envelope.grantsTaskAuthority, false);
});

test("delegation cannot invent a narrower-looking path not explicitly approved by parent", () => {
  assert.throws(
    () => createMultiAgentDelegationEnvelope(parent, {
      objective: "Edit nested file",
      allowedPathPatterns: ["src/a/nested.ts"],
    }),
    (error: unknown) => error instanceof MultiAgentDelegationError
      && error.code === "scope_widening",
  );
});

test("delegation cannot widen outside parent scope", () => {
  assert.throws(
    () => createMultiAgentDelegationEnvelope(parent, {
      objective: "Change configuration",
      allowedPathPatterns: ["config/**"],
    }),
    (error: unknown) => error instanceof MultiAgentDelegationError
      && error.code === "scope_widening",
  );
});

test("parent must retain disabled subagent/team/tool constraints", () => {
  const widenedParent: SupervisorTaskV1 = {
    ...parent,
    constraints: {
      ...parent.constraints,
      subagentsAllowed: true as false,
    },
  };
  assert.throws(
    () => createMultiAgentDelegationEnvelope(widenedParent, {
      objective: "Unsafe child",
      allowedPathPatterns: ["src/a.ts"],
    }),
    (error: unknown) => error instanceof MultiAgentDelegationError
      && error.code === "parent_invalid",
  );
});

test("delegation rejects duplicate scope patterns and invalid ids", () => {
  assert.throws(
    () => createMultiAgentDelegationEnvelope(parent, {
      objective: "Duplicate",
      allowedPathPatterns: ["src/a.ts", "src/a.ts"],
    }),
    (error: unknown) => error instanceof MultiAgentDelegationError
      && error.code === "request_invalid",
  );

  assert.throws(
    () => createMultiAgentDelegationEnvelope(
      parent,
      { objective: "Valid", allowedPathPatterns: ["src/a.ts"] },
      { idFactory: () => "not-a-uuid" },
    ),
    (error: unknown) => error instanceof MultiAgentDelegationError
      && error.code === "request_invalid",
  );
});
