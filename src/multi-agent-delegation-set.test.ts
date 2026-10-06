import assert from "node:assert/strict";
import test from "node:test";
import {
  createMultiAgentDelegationSet,
  MultiAgentDelegationSetError,
  MULTI_AGENT_DELEGATION_SET_CONTRACT,
} from "./multi-agent-delegation-set.js";
import type { MultiAgentDelegationEnvelopeV1 } from "./multi-agent-delegation-contract.js";

function child(
  delegationId: string,
  objective: string,
  allowedPathPatterns: string[],
): MultiAgentDelegationEnvelopeV1 {
  return {
    schemaVersion: 1,
    delegationId,
    createdAt: "2026-10-06T03:00:00.000Z",
    parentSupervisorTaskId: "11111111-1111-4111-8111-111111111111",
    taskId: "22222222-2222-4222-8222-222222222222",
    projectId: "33333333-3333-4333-8333-333333333333",
    workspaceId: "44444444-4444-4444-8444-444444444444",
    workspaceRegistryRevision: 2,
    safetyPlanId: "55555555-5555-4555-8555-555555555555",
    safetyProfileId: "66666666-6666-4666-8666-666666666666",
    safetyProfileRevision: 3,
    workerProfileId: "default",
    objective,
    acceptanceCriteria: [],
    allowedPathPatterns,
    protectedPathPatterns: [".env*", ".git/**"],
    authority: "delegation_envelope_only",
    constraints: {
      scopeExpansion: "stop_and_escalate",
      exactParentPathSelectionOnly: true,
      validationRunsExternally: true,
      subdelegationAllowed: false,
      agentTeamsAllowed: false,
      shellAllowed: false,
      networkAllowed: false,
      mcpAllowed: false,
      pluginsAllowed: false,
    },
    grantsTaskAuthority: false,
    grantsFilesystemAuthority: false,
    grantsSafetyPlanAuthority: false,
    grantsWriterLeaseAuthority: false,
    grantsCredentialAuthority: false,
    grantsReleaseAuthority: false,
  };
}

const a=child("77777777-7777-4777-8777-777777777777","Implement A",["src/a.ts"]);
const b=child("88888888-8888-4888-8888-888888888888","Implement B",["src/b.ts"]);

test("M13B set remains validation evidence only", () => {
  assert.equal(MULTI_AGENT_DELEGATION_SET_CONTRACT.maxDelegations, 8);
  assert.equal(MULTI_AGENT_DELEGATION_SET_CONTRACT.createsWorkers, false);
  assert.equal(MULTI_AGENT_DELEGATION_SET_CONTRACT.schedulesWorkers, false);
  assert.equal(MULTI_AGENT_DELEGATION_SET_CONTRACT.startsCline, false);
  assert.equal(MULTI_AGENT_DELEGATION_SET_CONTRACT.acquiresWriterLease, false);
  assert.equal(MULTI_AGENT_DELEGATION_SET_CONTRACT.grantsTaskAuthority, false);
  assert.equal(MULTI_AGENT_DELEGATION_SET_CONTRACT.grantsReleaseAuthority, false);
});

test("disjoint siblings may form bounded parallel validation set", () => {
  const set=createMultiAgentDelegationSet([a,b],{
    coordinationMode:"parallel_disjoint",
    now:()=>new Date("2026-10-06T03:01:00.000Z"),
    idFactory:()=> "99999999-9999-4999-8999-999999999999",
  });
  assert.equal(set.coordinationMode,"parallel_disjoint");
  assert.deepEqual(set.delegationIds,[a.delegationId,b.delegationId]);
  assert.deepEqual(set.overlappingDelegationPairs,[]);
  assert.equal(set.authority,"delegation_set_evidence_only");
});

test("overlapping sibling scope fails parallel but is visible in serialized evidence", () => {
  const overlapping=child("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","Implement shared",["src/a.ts"]);
  assert.throws(
    ()=>createMultiAgentDelegationSet([a,overlapping],{coordinationMode:"parallel_disjoint"}),
    (error:unknown)=>error instanceof MultiAgentDelegationSetError && error.code==="scope_overlap",
  );
  const serialized=createMultiAgentDelegationSet([a,overlapping],{
    coordinationMode:"serialized",
    idFactory:()=> "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  });
  assert.equal(serialized.overlappingDelegationPairs.length,1);
});

test("static-prefix overlap is treated conservatively", () => {
  const broad=child("cccccccc-cccc-4ccc-8ccc-cccccccccccc","Broad",["src/**"]);
  const nested=child("dddddddd-dddd-4ddd-8ddd-dddddddddddd","Nested",["src/a.ts"]);
  assert.throws(
    ()=>createMultiAgentDelegationSet([broad,nested],{coordinationMode:"parallel_disjoint"}),
    (error:unknown)=>error instanceof MultiAgentDelegationSetError && error.code==="scope_overlap",
  );
});

test("mismatched parent binding is rejected", () => {
  const wrong={...b,workspaceId:"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"};
  assert.throws(
    ()=>createMultiAgentDelegationSet([a,wrong],{coordinationMode:"serialized"}),
    (error:unknown)=>error instanceof MultiAgentDelegationSetError && error.code==="parent_binding_mismatch",
  );
});

test("duplicate delegation ids and normalized objectives are rejected", () => {
  const duplicateId={...b,delegationId:a.delegationId};
  assert.throws(
    ()=>createMultiAgentDelegationSet([a,duplicateId],{coordinationMode:"serialized"}),
    (error:unknown)=>error instanceof MultiAgentDelegationSetError && error.code==="duplicate_delegation",
  );

  const duplicateObjective={...b,objective:"  IMPLEMENT   A  "};
  assert.throws(
    ()=>createMultiAgentDelegationSet([a,duplicateObjective],{coordinationMode:"serialized"}),
    (error:unknown)=>error instanceof MultiAgentDelegationSetError && error.code==="duplicate_objective",
  );
});

test("delegation set is bounded to eight children", () => {
  const children=Array.from({length:9},(_,index)=>
    child(
      `${String(index+1).padStart(8,"0")}-1111-4111-8111-111111111111`,
      `Child ${index}`,
      [`src/${index}.ts`],
    )
  );
  assert.throws(
    ()=>createMultiAgentDelegationSet(children,{coordinationMode:"parallel_disjoint"}),
    (error:unknown)=>error instanceof MultiAgentDelegationSetError && error.code==="set_invalid",
  );
});
