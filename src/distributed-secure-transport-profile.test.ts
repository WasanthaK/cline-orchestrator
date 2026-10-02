import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  assertDistributedSecureTransportProfile,
  DISTRIBUTED_SECURE_TRANSPORT_PROFILE_CONTRACT,
  DistributedSecureTransportProfileError,
  type DistributedSecureTransportProfileV1,
} from "./distributed-secure-transport-profile.js";

const pinA = "sha256/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const pinB = "sha256/AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=";

function profile(): DistributedSecureTransportProfileV1 {
  return {
    schemaVersion: 1,
    profileId: crypto.randomUUID(),
    controllerOrigin: "https://controller.example.com",
    serverSpkiSha256Pins: [pinA, pinB],
    connectTimeoutMs: 5_000,
    maxResponseBytes: 64 * 1024,
    serverAuthentication: "system_ca_plus_spki_sha256_pin",
    authority: "transport_configuration_only",
    networkIoEnabled: false,
    grantsTaskAuthority: false,
    grantsFilesystemAuthority: false,
    grantsSafetyPlanAuthority: false,
    grantsWriterLeaseAuthority: false,
    grantsCredentialAuthority: false,
    grantsReleaseAuthority: false,
  };
}

function expectCode(
  action: () => void,
  code: DistributedSecureTransportProfileError["code"],
): void {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof DistributedSecureTransportProfileError);
    assert.equal(error.code, code);
    return true;
  });
}

test("M12P contract is configuration-only and includes no network or authority grant", () => {
  assert.deepEqual(DISTRIBUTED_SECURE_TRANSPORT_PROFILE_CONTRACT, {
    schemaVersion: 1,
    minConnectTimeoutMs: 1_000,
    maxConnectTimeoutMs: 30_000,
    minResponseBytes: 4 * 1024,
    maxResponseBytes: 1024 * 1024,
    maxServerIdentityPins: 3,
    requiresHttps: true,
    requiresSystemCaValidation: true,
    requiresServerSpkiSha256Pin: true,
    bearerTokenAllowedInProfile: false,
    credentialMaterialAllowedInProfile: false,
    taskOrExecutionMaterialAllowedInProfile: false,
    networkIoIncluded: false,
    listenerIncluded: false,
    dnsLookupIncluded: false,
    tlsHandshakeIncluded: false,
    httpRequestIncluded: false,
    controllerPushEnabled: false,
    distributedTakeoverEnabled: false,
    grantsTaskAuthority: false,
    grantsFilesystemAuthority: false,
    grantsSafetyPlanAuthority: false,
    grantsWriterLeaseAuthority: false,
    grantsCredentialAuthority: false,
    grantsReleaseAuthority: false,
  });

  const value = profile();
  assert.doesNotThrow(() => assertDistributedSecureTransportProfile(value));
});

test("M12P requires a canonical HTTPS controller origin only", () => {
  const invalidOrigins = [
    "http://controller.example.com",
    "https://controller.example.com/",
    "https://user@controller.example.com",
    "https://controller.example.com/v1",
    "https://controller.example.com?mode=pull",
    "https://controller.example.com#fragment",
    " https://controller.example.com",
    "not-a-url",
  ];

  for (const controllerOrigin of invalidOrigins) {
    expectCode(
      () => assertDistributedSecureTransportProfile({ ...profile(), controllerOrigin }),
      "endpoint_invalid",
    );
  }
});

test("M12P requires a small unique canonical SPKI SHA-256 pin set", () => {
  expectCode(
    () => assertDistributedSecureTransportProfile({ ...profile(), serverSpkiSha256Pins: [] }),
    "server_identity_invalid",
  );
  expectCode(
    () => assertDistributedSecureTransportProfile({
      ...profile(),
      serverSpkiSha256Pins: [pinA, pinA],
    }),
    "server_identity_invalid",
  );
  expectCode(
    () => assertDistributedSecureTransportProfile({
      ...profile(),
      serverSpkiSha256Pins: [pinA, pinB, pinA, pinB],
    }),
    "server_identity_invalid",
  );
  expectCode(
    () => assertDistributedSecureTransportProfile({
      ...profile(),
      serverSpkiSha256Pins: ["sha256/not-a-32-byte-digest="],
    }),
    "server_identity_invalid",
  );
});

test("M12P bounds connection timeout and response size before any future adapter can use them", () => {
  for (const connectTimeoutMs of [999, 30_001, 1.5]) {
    expectCode(
      () => assertDistributedSecureTransportProfile({ ...profile(), connectTimeoutMs }),
      "bounds_invalid",
    );
  }
  for (const maxResponseBytes of [4095, 1024 * 1024 + 1, 8192.5]) {
    expectCode(
      () => assertDistributedSecureTransportProfile({ ...profile(), maxResponseBytes }),
      "bounds_invalid",
    );
  }
});

test("M12P fails closed on authority weakening, network enablement, credentials or unknown fields", () => {
  expectCode(
    () => assertDistributedSecureTransportProfile({
      ...profile(),
      serverAuthentication: "system_ca_only",
    }),
    "authority_invalid",
  );
  expectCode(
    () => assertDistributedSecureTransportProfile({ ...profile(), networkIoEnabled: true }),
    "authority_invalid",
  );
  expectCode(
    () => assertDistributedSecureTransportProfile({ ...profile(), grantsCredentialAuthority: true }),
    "authority_invalid",
  );
  expectCode(
    () => assertDistributedSecureTransportProfile({ ...profile(), bearerToken: "secret" }),
    "profile_invalid",
  );
  expectCode(
    () => assertDistributedSecureTransportProfile({ ...profile(), clientPrivateKey: "secret" }),
    "profile_invalid",
  );
});
