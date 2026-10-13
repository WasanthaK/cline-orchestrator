import assert from "node:assert/strict";
import test from "node:test";
import {
  GITHUB_DELIVERY_AUTHORITY_ADMISSION_CONTRACT,
  GitHubDeliveryAuthorityAdmissionError,
  GitHubDeliveryAuthorityAdmissionService,
  type GitHubDeliveryAuthorityCurrentEvidenceV1,
} from "./github-delivery-authority-admission.js";
import type { GitHubDeliveryProposalV1 } from "./github-delivery-proposal.js";

const proposal: GitHubDeliveryProposalV1 = {
  schemaVersion: 1,
  proposalId: "11111111-1111-4111-8111-111111111111",
  createdAt: "2026-10-07T23:00:00.000Z",
  loopId: "22222222-2222-4222-8222-222222222222",
  loopRevision: 6,
  supervisorTaskId: "33333333-3333-4333-8333-333333333333",
  taskId: "44444444-4444-4444-8444-444444444444",
  projectId: "55555555-5555-4555-8555-555555555555",
  workspaceId: "66666666-6666-4666-8666-666666666666",
  workspaceRegistryRevision: 7,
  safetyPlanId: "77777777-7777-4777-8777-777777777777",
  safetyPolicyVersion: "policy-v1",
  safetyProfileId: "88888888-8888-4888-8888-888888888888",
  safetyProfileRevision: 9,
  workerProfileId: "default",
  observedRunCount: 2,
  completionCapturedAt: "2026-10-07T22:59:00.000Z",
  terminalGit: {
    schemaVersion: 1,
    taskId: "44444444-4444-4444-8444-444444444444",
    workspaceId: "66666666-6666-4666-8666-666666666666",
    capturedAt: "2026-10-07T22:59:30.000Z",
    available: true,
    fingerprintDigest: "a".repeat(64),
    branch: "feature/test",
    head: "0123456789abcdef0123456789abcdef01234567",
    authority: "current_terminal_git_evidence",
    grantsReleaseAuthority: false,
  },
  requestedActions: ["commit", "push", "pull_request"],
  authority: "github_delivery_proposal_evidence_only",
  mutatesGit: false,
  mutatesGitHub: false,
  usesCredentials: false,
  commitAuthorized: false,
  pushAuthorized: false,
  pullRequestAuthorized: false,
  mergeAuthorized: false,
  deployAuthorized: false,
  grantsTaskAuthority: false,
  grantsFilesystemAuthority: false,
  grantsSafetyPlanAuthority: false,
  grantsWriterLeaseAuthority: false,
  grantsCredentialAuthority: false,
  grantsReleaseAuthority: false,
};

function current(overrides: Partial<GitHubDeliveryAuthorityCurrentEvidenceV1> = {}): GitHubDeliveryAuthorityCurrentEvidenceV1 {
  return {
    schemaVersion: 1,
    proposalId: proposal.proposalId,
    taskId: proposal.taskId,
    workspaceId: proposal.workspaceId,
    workspaceRegistryRevision: proposal.workspaceRegistryRevision,
    safetyPlanId: proposal.safetyPlanId,
    safetyProfileId: proposal.safetyProfileId,
    safetyProfileRevision: proposal.safetyProfileRevision,
    observedRunCount: proposal.observedRunCount,
    terminalGitFingerprintDigest: proposal.terminalGit.fingerprintDigest,
    terminalGitHead: proposal.terminalGit.head,
    terminalGitBranch: proposal.terminalGit.branch,
    authority: "current_delivery_authority_evidence",
    grantsReleaseAuthority: false,
    ...overrides,
  };
}

function service(nowRef: { value: number }, evidence = () => current()) {
  let tokenCounter = 0;
  return new GitHubDeliveryAuthorityAdmissionService(
    {
      async load(id: string) {
        assert.equal(id, proposal.proposalId);
        return structuredClone(proposal);
      },
    },
    {
      async revalidateCurrent() {
        return evidence();
      },
    },
    {
      now: () => nowRef.value,
      tokenFactory: () => `token-${++tokenCounter}-${"x".repeat(40)}`,
      idFactory: () => "99999999-9999-4999-8999-999999999999",
    },
  );
}

test("M15B contract is explicit, one-action, one-shot and non-mutating", () => {
  assert.equal(GITHUB_DELIVERY_AUTHORITY_ADMISSION_CONTRACT.explicitHumanConfirmationRequired, true);
  assert.equal(GITHUB_DELIVERY_AUTHORITY_ADMISSION_CONTRACT.oneAction, true);
  assert.equal(GITHUB_DELIVERY_AUTHORITY_ADMISSION_CONTRACT.singleUse, true);
  assert.equal(GITHUB_DELIVERY_AUTHORITY_ADMISSION_CONTRACT.mutatesGit, false);
  assert.equal(GITHUB_DELIVERY_AUTHORITY_ADMISSION_CONTRACT.mutatesGitHub, false);
  assert.equal(GITHUB_DELIVERY_AUTHORITY_ADMISSION_CONTRACT.grantsReleaseAuthority, false);
});

test("M15B confirms and consumes exactly one commit authority permit", async () => {
  const now = { value: Date.parse("2026-10-07T23:01:00.000Z") };
  const subject = service(now);

  const preview = await subject.preview(proposal.proposalId, "commit");
  assert.equal(preview.action, "commit");
  assert.match(preview.confirmationText, /only one local Git commit/i);

  const { permit, permitToken } = await subject.confirm({
    proposalId: proposal.proposalId,
    action: "commit",
    confirmationToken: preview.confirmationToken,
    confirmed: true,
  });
  assert.equal(permit.action, "commit");
  assert.equal(permit.grantsReleaseAuthority, false);

  const receipt = await subject.consumePermit(
    permitToken,
    proposal.proposalId,
    "commit",
  );
  assert.equal(receipt.action, "commit");
  assert.equal(receipt.mutatesGit, false);
  assert.equal(receipt.grantsReleaseAuthority, false);

  await assert.rejects(
    () => subject.consumePermit(permitToken, proposal.proposalId, "commit"),
    (error: unknown) =>
      error instanceof GitHubDeliveryAuthorityAdmissionError
      && error.code === "permit_invalid",
  );
});

test("M15B does not let commit confirmation authorize push", async () => {
  const now = { value: Date.parse("2026-10-07T23:01:00.000Z") };
  const subject = service(now);
  const preview = await subject.preview(proposal.proposalId, "commit");
  const { permitToken } = await subject.confirm({
    proposalId: proposal.proposalId,
    action: "commit",
    confirmationToken: preview.confirmationToken,
    confirmed: true,
  });

  await assert.rejects(
    () => subject.consumePermit(permitToken, proposal.proposalId, "push"),
    (error: unknown) =>
      error instanceof GitHubDeliveryAuthorityAdmissionError
      && error.code === "permit_invalid",
  );
});

test("M15B burns confirmation before revalidation and rejects stale evidence", async () => {
  const now = { value: Date.parse("2026-10-07T23:01:00.000Z") };
  let stale = false;
  const subject = service(now, () =>
    stale ? current({ safetyProfileRevision: 10 }) : current()
  );

  const preview = await subject.preview(proposal.proposalId, "commit");
  stale = true;
  await assert.rejects(
    () => subject.confirm({
      proposalId: proposal.proposalId,
      action: "commit",
      confirmationToken: preview.confirmationToken,
      confirmed: true,
    }),
    (error: unknown) =>
      error instanceof GitHubDeliveryAuthorityAdmissionError
      && error.code === "authority_stale",
  );

  stale = false;
  await assert.rejects(
    () => subject.confirm({
      proposalId: proposal.proposalId,
      action: "commit",
      confirmationToken: preview.confirmationToken,
      confirmed: true,
    }),
    (error: unknown) =>
      error instanceof GitHubDeliveryAuthorityAdmissionError
      && error.code === "confirmation_invalid",
  );
});

test("M15B rejects expired confirmation and expired action permit", async () => {
  const now = { value: Date.parse("2026-10-07T23:01:00.000Z") };
  const subject = service(now);

  const preview = await subject.preview(proposal.proposalId, "commit");
  now.value += 60_000;
  await assert.rejects(
    () => subject.confirm({
      proposalId: proposal.proposalId,
      action: "commit",
      confirmationToken: preview.confirmationToken,
      confirmed: true,
    }),
    (error: unknown) =>
      error instanceof GitHubDeliveryAuthorityAdmissionError
      && error.code === "confirmation_expired",
  );

  now.value = Date.parse("2026-10-07T23:03:00.000Z");
  const preview2 = await subject.preview(proposal.proposalId, "commit");
  const { permitToken } = await subject.confirm({
    proposalId: proposal.proposalId,
    action: "commit",
    confirmationToken: preview2.confirmationToken,
    confirmed: true,
  });
  now.value += 60_000;
  await assert.rejects(
    () => subject.consumePermit(permitToken, proposal.proposalId, "commit"),
    (error: unknown) =>
      error instanceof GitHubDeliveryAuthorityAdmissionError
      && error.code === "permit_expired",
  );
});

test("M15B rejects action not present in the proposal", async () => {
  const now = { value: Date.parse("2026-10-07T23:01:00.000Z") };
  const subject = service(now);
  await assert.rejects(
    () => subject.preview(proposal.proposalId, "merge"),
    (error: unknown) =>
      error instanceof GitHubDeliveryAuthorityAdmissionError
      && error.code === "action_invalid",
  );
});
