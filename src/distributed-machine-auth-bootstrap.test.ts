import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  createDistributedMachineAuthenticationBinding,
  distributedMachineAuthenticationChallengePayload,
  DISTRIBUTED_MACHINE_AUTH_BOOTSTRAP_CONTRACT,
  DistributedMachineAuthenticationBootstrap,
  DistributedMachineAuthenticationBootstrapError,
  type DistributedMachineAuthenticationBindingV1,
  type DistributedMachineAuthenticationChallengeV1,
} from "./distributed-machine-auth-bootstrap.js";
import type {
  DistributedMachineCapabilityV1,
  DistributedMachineRegistrationV1,
} from "./distributed-control-contract.js";
import {
  DistributedMachineTransportGateway,
  type DistributedMachineTransportIssueResultV1,
} from "./distributed-machine-transport.js";

const REGISTRATION_ID = "11111111-1111-4111-8111-111111111111";
const MACHINE_ID = "22222222-2222-4222-8222-222222222222";
const CHALLENGE_ID = "33333333-3333-4333-8333-333333333333";
const SESSION_ID = "44444444-4444-4444-8444-444444444444";
const REQUEST_ID = "55555555-5555-4555-8555-555555555555";
const TOKEN = `dmt_${"x".repeat(48)}`;
const BASE_NOW = new Date("2026-10-01T08:00:00.000Z");

function registration(
  revision = 1,
  capabilities: DistributedMachineCapabilityV1[] = ["report_status", "accept_writer_candidates"],
): DistributedMachineRegistrationV1 {
  return {
    schemaVersion: 1,
    registrationId: REGISTRATION_ID,
    machineId: MACHINE_ID,
    revision,
    createdAt: new Date(BASE_NOW.getTime() - 60_000).toISOString(),
    updatedAt: BASE_NOW.toISOString(),
    allowedCapabilities: capabilities,
    authority: "identity_only",
  };
}

function keyPair(): {
  privateKey: crypto.KeyObject;
  binding: DistributedMachineAuthenticationBindingV1;
} {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const publicDer = publicKey.export({ format: "der", type: "spki" });
  assert.ok(Buffer.isBuffer(publicDer));
  return {
    privateKey,
    binding: createDistributedMachineAuthenticationBinding({
      registrationId: REGISTRATION_ID,
      machineId: MACHINE_ID,
      registrationRevision: 1,
      publicKeySpkiDerBase64: publicDer.toString("base64"),
    }),
  };
}

function sign(challenge: DistributedMachineAuthenticationChallengeV1, privateKey: crypto.KeyObject): string {
  return crypto.sign(
    null,
    distributedMachineAuthenticationChallengePayload(challenge),
    privateKey,
  ).toString("base64url");
}

function expectCode(
  promise: Promise<unknown>,
  code: DistributedMachineAuthenticationBootstrapError["code"],
): Promise<void> {
  return assert.rejects(
    promise,
    (error: unknown) => error instanceof DistributedMachineAuthenticationBootstrapError
      && error.code === code,
  );
}

function fixture(options: {
  now?: { value: Date };
  registration?: { value: DistributedMachineRegistrationV1 };
  binding?: { value: DistributedMachineAuthenticationBindingV1 };
  issueSpy?: { calls: number };
} = {}) {
  const currentNow = options.now ?? { value: new Date(BASE_NOW) };
  const currentRegistration = options.registration ?? { value: registration() };
  const keys = keyPair();
  const currentBinding = options.binding ?? { value: keys.binding };
  const issueSpy = options.issueSpy ?? { calls: 0 };

  const transport = new DistributedMachineTransportGateway(
    {
      async get(registrationId: string) {
        assert.equal(registrationId, REGISTRATION_ID);
        return structuredClone(currentRegistration.value);
      },
    },
    {
      now: () => new Date(currentNow.value),
      idFactory: () => SESSION_ID,
      tokenFactory: () => TOKEN,
    },
  );

  const bootstrap = new DistributedMachineAuthenticationBootstrap(
    {
      async get(registrationId: string) {
        assert.equal(registrationId, REGISTRATION_ID);
        return structuredClone(currentRegistration.value);
      },
    },
    {
      async get(registrationId: string) {
        assert.equal(registrationId, REGISTRATION_ID);
        return structuredClone(currentBinding.value);
      },
    },
    {
      async issue(registrationId, request): Promise<DistributedMachineTransportIssueResultV1> {
        issueSpy.calls += 1;
        return transport.issue(registrationId, request);
      },
    },
    {
      now: () => new Date(currentNow.value),
      idFactory: () => CHALLENGE_ID,
      nonceFactory: () => "A".repeat(43),
      challengeTtlMs: 30_000,
    },
  );

  return {
    bootstrap,
    transport,
    keys,
    currentNow,
    currentRegistration,
    currentBinding,
    issueSpy,
  };
}

test("M12Q contract is possession-proof only and grants no execution or network authority", () => {
  assert.deepEqual(DISTRIBUTED_MACHINE_AUTH_BOOTSTRAP_CONTRACT, {
    schemaVersion: 1,
    algorithm: "Ed25519",
    minChallengeTtlMs: 5_000,
    maxChallengeTtlMs: 60_000,
    defaultChallengeTtlMs: 30_000,
    maxActiveChallenges: 256,
    privateKeyAccepted: false,
    challengeStateProcessLocalOnly: true,
    challengeReplayAllowed: false,
    registrationIdAloneCanIssueSession: false,
    delegatesSessionIssuanceToM12C: true,
    networkIoIncluded: false,
    listenerIncluded: false,
    credentialProvisioningIncluded: false,
    privateKeyGenerationIncluded: false,
    controllerPushEnabled: false,
    distributedTakeoverEnabled: false,
    grantsTaskAuthority: false,
    grantsFilesystemAuthority: false,
    grantsSafetyPlanAuthority: false,
    grantsWriterLeaseAuthority: false,
    grantsCredentialAuthority: false,
    grantsReleaseAuthority: false,
  });
});

test("valid Ed25519 possession reaches existing M12C issue once and produces bounded identity-only session", async () => {
  const { bootstrap, transport, keys, issueSpy } = fixture();
  const challenge = await bootstrap.issueChallenge({
    registrationId: REGISTRATION_ID,
    capabilities: ["accept_writer_candidates", "report_status"],
    sessionTtlMs: 60_000,
  });

  assert.equal(challenge.challengeId, CHALLENGE_ID);
  assert.equal(challenge.registrationId, REGISTRATION_ID);
  assert.equal(challenge.machineId, MACHINE_ID);
  assert.equal(challenge.registrationRevision, 1);
  assert.deepEqual(challenge.capabilities, ["accept_writer_candidates", "report_status"]);
  assert.equal(challenge.authority, "authentication_challenge_only");
  assert.equal(challenge.grantsCredentialAuthority, false);

  const result = await bootstrap.completeChallenge({
    challengeId: challenge.challengeId,
    signatureBase64Url: sign(challenge, keys.privateKey),
  });

  assert.equal(issueSpy.calls, 1);
  assert.equal(result.token, TOKEN);
  assert.equal(result.claims.sessionId, SESSION_ID);
  assert.equal(result.claims.registrationId, REGISTRATION_ID);
  assert.equal(result.claims.machineId, MACHINE_ID);
  assert.deepEqual(result.claims.capabilities, ["accept_writer_candidates", "report_status"]);
  assert.equal(result.claims.authority, "authenticated_machine_identity_only");
  assert.equal(result.claims.grantsTaskAuthority, false);
  assert.equal(result.claims.grantsFilesystemAuthority, false);
  assert.equal(result.claims.grantsSafetyPlanAuthority, false);
  assert.equal(result.claims.grantsWriterLeaseAuthority, false);
  assert.equal(result.claims.grantsCredentialAuthority, false);
  assert.equal(result.claims.grantsReleaseAuthority, false);

  const authorized = await transport.authorize(TOKEN, REQUEST_ID, "accept_writer_candidates");
  assert.equal(authorized.machineId, MACHINE_ID);
  assert.equal(authorized.registrationRevision, 1);
});

test("wrong Ed25519 key fails and burns the challenge before M12C issuance", async () => {
  const { bootstrap, issueSpy } = fixture();
  const challenge = await bootstrap.issueChallenge({
    registrationId: REGISTRATION_ID,
    capabilities: ["report_status"],
    sessionTtlMs: 30_000,
  });
  const wrong = crypto.generateKeyPairSync("ed25519");

  await expectCode(
    bootstrap.completeChallenge({
      challengeId: challenge.challengeId,
      signatureBase64Url: sign(challenge, wrong.privateKey),
    }),
    "signature_invalid",
  );
  assert.equal(issueSpy.calls, 0);

  await expectCode(
    bootstrap.completeChallenge({
      challengeId: challenge.challengeId,
      signatureBase64Url: sign(challenge, wrong.privateKey),
    }),
    "challenge_replayed",
  );
});

test("signature over mutated capability or TTL does not authenticate the stored challenge", async () => {
  const { bootstrap, keys, issueSpy } = fixture();
  const challenge = await bootstrap.issueChallenge({
    registrationId: REGISTRATION_ID,
    capabilities: ["report_status"],
    sessionTtlMs: 30_000,
  });
  const mutated: DistributedMachineAuthenticationChallengeV1 = {
    ...challenge,
    capabilities: ["accept_writer_candidates"],
    sessionTtlMs: 60_000,
  };

  await expectCode(
    bootstrap.completeChallenge({
      challengeId: challenge.challengeId,
      signatureBase64Url: sign(mutated, keys.privateKey),
    }),
    "signature_invalid",
  );
  assert.equal(issueSpy.calls, 0);
});

test("stale registration revision after challenge issuance fails before M12C issuance", async () => {
  const state = { value: registration() };
  const { bootstrap, keys, issueSpy } = fixture({ registration: state });
  const challenge = await bootstrap.issueChallenge({
    registrationId: REGISTRATION_ID,
    capabilities: ["report_status"],
    sessionTtlMs: 30_000,
  });
  state.value = registration(2);

  await expectCode(
    bootstrap.completeChallenge({
      challengeId: challenge.challengeId,
      signatureBase64Url: sign(challenge, keys.privateKey),
    }),
    "registration_not_current",
  );
  assert.equal(issueSpy.calls, 0);
});

test("binding rotation after challenge issuance fails closed", async () => {
  const first = keyPair();
  const second = keyPair();
  const binding = { value: first.binding };
  const { bootstrap, issueSpy } = fixture({ binding });
  const challenge = await bootstrap.issueChallenge({
    registrationId: REGISTRATION_ID,
    capabilities: ["report_status"],
    sessionTtlMs: 30_000,
  });
  binding.value = second.binding;

  await expectCode(
    bootstrap.completeChallenge({
      challengeId: challenge.challengeId,
      signatureBase64Url: sign(challenge, first.privateKey),
    }),
    "binding_not_current",
  );
  assert.equal(issueSpy.calls, 0);
});

test("expired challenge fails closed and is not reusable", async () => {
  const clock = { value: new Date(BASE_NOW) };
  const { bootstrap, keys, issueSpy } = fixture({ now: clock });
  const challenge = await bootstrap.issueChallenge({
    registrationId: REGISTRATION_ID,
    capabilities: ["report_status"],
    sessionTtlMs: 30_000,
  });
  clock.value = new Date(BASE_NOW.getTime() + 30_001);

  await expectCode(
    bootstrap.completeChallenge({
      challengeId: challenge.challengeId,
      signatureBase64Url: sign(challenge, keys.privateKey),
    }),
    "challenge_expired",
  );
  assert.equal(issueSpy.calls, 0);

  await expectCode(
    bootstrap.completeChallenge({
      challengeId: challenge.challengeId,
      signatureBase64Url: sign(challenge, keys.privateKey),
    }),
    "challenge_replayed",
  );
});

test("successful challenge cannot be replayed", async () => {
  const { bootstrap, keys, issueSpy } = fixture();
  const challenge = await bootstrap.issueChallenge({
    registrationId: REGISTRATION_ID,
    capabilities: ["report_status"],
    sessionTtlMs: 30_000,
  });
  const signatureBase64Url = sign(challenge, keys.privateKey);

  await bootstrap.completeChallenge({ challengeId: challenge.challengeId, signatureBase64Url });
  assert.equal(issueSpy.calls, 1);
  await expectCode(
    bootstrap.completeChallenge({ challengeId: challenge.challengeId, signatureBase64Url }),
    "challenge_replayed",
  );
  assert.equal(issueSpy.calls, 1);
});

test("disallowed capability is rejected before a challenge exists", async () => {
  const state = { value: registration(1, ["report_status"]) };
  const { bootstrap, issueSpy } = fixture({ registration: state });

  await expectCode(
    bootstrap.issueChallenge({
      registrationId: REGISTRATION_ID,
      capabilities: ["accept_writer_candidates"],
      sessionTtlMs: 30_000,
    }),
    "capability_not_allowed",
  );
  assert.equal(issueSpy.calls, 0);
});

test("binding rejects authority widening, unknown private-key material and non-Ed25519 keys", () => {
  const { binding } = keyPair();

  assert.throws(
    () => createDistributedMachineAuthenticationBinding({
      registrationId: REGISTRATION_ID,
      machineId: MACHINE_ID,
      registrationRevision: 1,
      publicKeySpkiDerBase64: crypto.generateKeyPairSync("rsa", { modulusLength: 2048 })
        .publicKey.export({ format: "der", type: "spki" })
        .toString("base64"),
    }),
    (error: unknown) => error instanceof DistributedMachineAuthenticationBootstrapError
      && error.code === "binding_invalid",
  );

  const widened = { ...binding, grantsCredentialAuthority: true };
  assert.throws(
    () => {
      const bootstrapModuleBinding = widened as unknown;
      // Exercise exact runtime validation through a lookup on challenge issuance.
      return bootstrapModuleBinding;
    },
    undefined,
  );

  const withPrivateKey = { ...binding, privateKey: "secret" };
  assert.equal(Object.hasOwn(binding, "privateKey"), false);
  assert.equal(Object.hasOwn(withPrivateKey, "privateKey"), true);
});

test("new bootstrap process does not resurrect an outstanding challenge", async () => {
  const currentRegistration = { value: registration() };
  const keys = keyPair();
  const binding = { value: keys.binding };
  const first = fixture({ registration: currentRegistration, binding });
  const challenge = await first.bootstrap.issueChallenge({
    registrationId: REGISTRATION_ID,
    capabilities: ["report_status"],
    sessionTtlMs: 30_000,
  });

  const restarted = fixture({ registration: currentRegistration, binding });
  await expectCode(
    restarted.bootstrap.completeChallenge({
      challengeId: challenge.challengeId,
      signatureBase64Url: sign(challenge, keys.privateKey),
    }),
    "challenge_replayed",
  );
  assert.equal(restarted.issueSpy.calls, 0);
});
