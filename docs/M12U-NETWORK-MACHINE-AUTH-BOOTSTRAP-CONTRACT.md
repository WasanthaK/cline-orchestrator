# M12U — Networked M12Q Machine Authentication Bootstrap Contract

Status: REVIEWED / DEFINED — NOT IMPLEMENTED
Date: 2026-10-02
Branch: `phase-1/bootstrap`

## Purpose

M12U is the network protocol wrapper around the already-proven M12Q Ed25519 possession-proof bootstrap.

Its purpose is only to let a pre-registered target machine that already possesses its pre-enrolled Ed25519 private key obtain a short-lived existing M12C bearer session over the same authenticated controller HTTPS origin used by M12S/M12T.

M12U MUST NOT:

- register a machine;
- create or rotate a machine identity;
- accept or provision a private key;
- create or update the controller-side authentication binding;
- expose M12C `issue()` directly;
- accept registration ID as sufficient session authority;
- grant task/filesystem/Safety/lease/credential/release authority;
- open a listener;
- provision/rotate TLS identity;
- perform controller push;
- start target runtime;
- implement distributed takeover/recovery.

## Security conclusions

1. **M12Q remains the cryptographic authority.** The network layer delegates challenge creation only to `DistributedMachineAuthenticationBootstrap.issueChallenge()` and proof completion only to `completeChallenge()`. It does not reimplement Ed25519 verification or session issuance.

2. **M12C remains the session authority.** Only successful M12Q completion may reach existing M12C `issue()`. There is no network endpoint corresponding directly to M12C `issue()`.

3. **Registration ID is a selector, not a credential.** A valid registration ID may request a challenge, but only proof with the exact current Ed25519 binding can produce a session.

4. **TLS authentication precedes machine authentication.** The target first authenticates the controller through the already-reviewed M12P policy (system CA + hostname + exact leaf-SPKI SHA-256 pin), then proves machine-key possession through M12Q.

5. **Private-key material never enters the protocol adapter.** The target client uses an injected signer interface that receives the canonical M12Q challenge payload and returns an Ed25519 signature. M12U accepts no raw private-key argument.

6. **M12U is not enrollment.** Controller-side machine registration, authentication binding creation, target private-key provisioning, and key rotation are separate local/admin processes and must be complete before physical bootstrap is enabled.

7. **No second listener.** M12U routes must ultimately share the same canonical HTTPS origin and listener as M12T. M12U implementation remains a socket-free route/client layer until a later reviewed shared-router/binding slice.

8. **Challenge issuance needs a network anti-exhaustion envelope.** Raw M12Q allows multiple active challenges and has a global process-local capacity. M12U adds request replay/idempotency, one outstanding challenge per registration, rate limits and concurrency bounds before calling M12Q.

9. **Challenge completion stays one-shot.** M12Q consumes a found challenge before signature/currentness/session-issuance checks. M12U MUST NOT automatically retry completion. If the response is lost after successful session issuance, that session may remain orphaned until its bounded M12C TTL expires; the target must begin a fresh challenge later.

10. **M12Q nonce canonicality is a prerequisite correction.** Before M12U implementation is considered complete, M12Q challenge validation must require the nonce to decode to exactly 32 bytes of canonical base64url, matching the existing `randomBytes(32).toString("base64url")` generator. The current “length >= 32” check is insufficiently exact for a network-visible signed structure.

## Physical/deployment ordering

The later real-network deployment order is fixed:

1. provision controller TLS certificate/private key through a separately authorized local/admin process;
2. verify certificate hostname and leaf-SPKI SHA-256 pin against the M12P profile targets will trust;
3. provision the target machine's Ed25519 private key locally and its matching controller-side M12Q authentication binding through a separately authorized enrollment process;
4. configure the target with the canonical controller HTTPS origin, M12P pins, registration ID and local signer reference;
5. compose M12T pull routes + M12U bootstrap routes under one unbound HTTPS server/router;
6. obtain explicit user authorization immediately before any real `listen()`/bind;
7. bind only to the explicitly reviewed address/port; never fall back to `0.0.0.0`, `::` or an implicit public bind;
8. prove TLS identity first;
9. prove M12U challenge/session bootstrap;
10. use the returned short-lived M12C bearer for the existing M12S → M12T pull path.

No physical bind, TLS credential provisioning, Ed25519 key provisioning or firewall/DNS/tunnel change is authorized by the M12U software review.

## Fixed HTTPS routes

M12U defines exactly two HTTP/1.1 POST routes on the canonical controller HTTPS origin:

- `POST /v1/distributed/auth/challenge`
- `POST /v1/distributed/auth/session`

No query string, absolute-form target or alternate path is accepted.

The routes are direct HTTPS only:

- no reverse-proxy trust;
- no forwarded identity headers;
- no HTTP/2;
- no WebSocket;
- no CONNECT;
- no Expect/100-continue;
- no cookies;
- no proxy authorization;
- no bearer Authorization header on either bootstrap request.

## Common request headers

Every bootstrap request must contain exactly one of each:

- `Host: <exact configured controller authority>`
- `X-Cline-Request-Id: <canonical UUID>`
- `Accept: application/json`
- `Accept-Encoding: identity`
- `Cache-Control: no-store`
- `Connection: close`
- `Content-Type: application/json; charset=utf-8`
- `Content-Encoding: identity`
- `Content-Length: <exact positive decimal body byte count>`

No other request headers are accepted.

Duplicate-preserving header validation is mandatory.

The following are explicitly forbidden:

- `Authorization`
- `Transfer-Encoding`
- `Expect`
- `Upgrade`
- `Trailer`
- `Cookie`
- `Proxy-Authorization`
- `Forwarded`
- any `X-Forwarded-*`
- `Via`
- caller-supplied client certificate identity headers.

## Canonical JSON requirement

Bootstrap request bodies are canonical UTF-8 JSON, not merely semantically equivalent JSON.

The server:

1. enforces the exact byte limit;
2. decodes UTF-8 with fatal invalid-sequence rejection;
3. parses one JSON value;
4. validates the exact schema;
5. canonicalizes the object with the defined field order;
6. requires the incoming bytes to equal the canonical encoding exactly.

This rejects:

- duplicate JSON keys;
- unsupported fields;
- alternate field ordering;
- insignificant whitespace;
- alternate escaping;
- unsorted capability arrays;
- ambiguous parser representations.

### Challenge request body

Exact wire schema/order:

```json
{"schemaVersion":1,"registrationId":"<uuid>","capabilities":["accept_writer_candidates"],"sessionTtlMs":60000}
```

Fields:

- `schemaVersion`: exactly `1`;
- `registrationId`: canonical UUID;
- `capabilities`: non-empty, unique, lexicographically sorted subset of existing M12C machine capabilities;
- `sessionTtlMs`: existing M12C min/max session TTL.

Maximum body: 1024 bytes.

The network adapter strips `schemaVersion` and delegates only:

```ts
bootstrap.issueChallenge({
  registrationId,
  capabilities,
  sessionTtlMs
})
```

### Session-completion request body

Exact wire schema/order:

```json
{"schemaVersion":1,"challengeId":"<uuid>","signatureBase64Url":"<canonical-ed25519-signature>"}
```

Fields:

- `schemaVersion`: exactly `1`;
- `challengeId`: canonical UUID;
- `signatureBase64Url`: canonical unpadded base64url encoding of exactly 64 signature bytes.

Maximum body: 512 bytes.

The network adapter strips `schemaVersion` and delegates only:

```ts
bootstrap.completeChallenge({
  challengeId,
  signatureBase64Url
})
```

## Challenge-issuance anti-exhaustion / replay envelope

M12U maintains only process-local, non-authorizing network coordination state. Restart loses this state, consistent with M12Q process-local challenge semantics.

### Request-ID idempotency

For a successful challenge issuance:

- cache `requestId → canonical request digest + returned challenge` only until that challenge expires;
- same request ID + byte-identical canonical body before expiry returns the same challenge and MUST NOT call M12Q again;
- same request ID + different body returns bodyless `409`;
- expired entries are pruned.

The challenge itself is authority-free and safe to return again.

### One active challenge per registration

The network envelope tracks one active challenge per registration:

- a second new request ID for the same registration while the first challenge is unexpired returns bodyless `409` without calling M12Q;
- the mapping is cleared when the challenge expires;
- the mapping is cleared after a completion attempt reaches M12Q, because M12Q consumes a found challenge before verification/currentness/session issuance.

This prevents one known registration from filling the M12Q global challenge store.

### Rate limits

Challenge issuance defaults:

- per direct peer address: 12 attempts per 60 seconds;
- per registration ID: 4 attempts per 60 seconds;
- global in-flight bootstrap handlers: 16.

Session completion defaults:

- per direct peer address: 24 attempts per 60 seconds;
- global in-flight bootstrap handlers shares the same 16-handler ceiling.

Hard configurable maxima:

- peer issue limit: 120/minute;
- registration issue limit: 30/minute;
- peer completion limit: 240/minute;
- concurrent bootstrap handlers: 32.

Limits are process-local defense-in-depth only. They grant no identity authority.

The server uses the direct socket peer address only. It never trusts `Forwarded` or `X-Forwarded-For`.

Rate-limit rejection is bodyless `429` with no machine/registration detail and no `Retry-After` value derived from attacker-controlled input.

## Challenge response

On successful new or idempotent challenge issuance:

- status: `200`;
- `Cache-Control: no-store`;
- `Pragma: no-cache`;
- `Connection: close`;
- `Content-Type: application/json; charset=utf-8`;
- `Content-Encoding: identity`;
- exact `Content-Length`;
- `X-Content-Type-Options: nosniff`;
- body: exactly one validated existing `DistributedMachineAuthenticationChallengeV1`;
- response body hard limit: 4096 bytes.

Before serialization the network layer reruns `assertDistributedMachineAuthenticationChallenge`.

The response contains no private key, no bearer token and no additional registration data beyond the existing signed challenge.

## Session response

On successful M12Q completion:

- status: `200`;
- `Cache-Control: no-store`;
- `Pragma: no-cache`;
- `Connection: close`;
- `Content-Type: application/json; charset=utf-8`;
- `Content-Encoding: identity`;
- exact `Content-Length`;
- `X-Content-Type-Options: nosniff`;
- body hard limit: 8192 bytes.

Exact response schema/order:

```json
{"schemaVersion":1,"token":"<short-lived-M12C-bearer>","claims":{...}}
```

Validation before serialization:

- exact top-level keys `schemaVersion`, `token`, `claims`;
- schema version exactly 1;
- token uses the existing visible bearer-safe alphabet and bounded length;
- `claims` passes existing `assertDistributedMachineTransportSessionClaims`;
- token is never logged, hashed into telemetry, cached in an HTTP replay cache, persisted by M12U or returned anywhere except this successful TLS response.

## Error mapping and anti-enumeration

All error responses are bodyless, `Cache-Control: no-store`, `Connection: close`, and expose no controller exception text.

### Protocol/request errors

- wrong path → `404`;
- wrong method on exact route → `405` with `Allow: POST`;
- wrong HTTP version, Host, duplicate/unknown headers, framing/content-type/encoding violation, malformed or non-canonical JSON → `400`;
- rate/concurrency limit → `429` or `503` as applicable;
- request-ID replay with different challenge request body → `409`;
- second active challenge for same registration → `409`.

### Challenge issuance M12Q errors

To reduce registration/binding enumeration, these valid-shaped challenge requests all map to the same bodyless `404`:

- `registration_not_current`;
- `binding_invalid`;
- `binding_not_current`;
- `capability_not_allowed`.

Other mappings:

- `request_invalid` → `400`;
- `capacity_exceeded` → `503`;
- unknown/untyped failure → `500`.

### Session-completion M12Q errors

These all map to the same bodyless `401` authentication failure:

- `challenge_not_found`;
- `challenge_expired`;
- `challenge_replayed`;
- `signature_invalid`;
- `registration_not_current`;
- `binding_invalid`;
- `binding_not_current`;
- `capability_not_allowed`.

Other mappings:

- `request_invalid` → `400`;
- `capacity_exceeded` → `503`;
- `session_issue_failed` with nested M12C capacity exhaustion → `503`;
- all other `session_issue_failed` / unknown failures → `500`.

No error response says whether a registration, binding, challenge, machine, key or capability exists.

## Target bootstrap client contract

The target-side M12U client accepts only trusted local inputs:

```ts
bootstrapSession({
  profile,
  registrationId,
  capabilities,
  sessionTtlMs,
  signer
}): Promise<DistributedMachineTransportIssueResultV1>
```

The signer interface is:

```ts
interface DistributedMachineBootstrapSigner {
  publicKeyFingerprint: string;
  sign(payload: Buffer): Promise<Buffer>;
}
```

The client never accepts raw private-key bytes.

### Target flow

1. validate M12P profile;
2. validate registration ID, canonical capabilities, requested session TTL and signer fingerprint;
3. make one M12P-authenticated HTTPS challenge request to the fixed challenge path;
4. validate the returned existing M12Q challenge;
5. require returned registration ID, capabilities and session TTL to exactly match the request;
6. require returned `publicKeyFingerprint` to exactly match `signer.publicKeyFingerprint`;
7. compute the signature payload only through existing `distributedMachineAuthenticationChallengePayload(challenge)`;
8. invoke `signer.sign(payload)`;
9. require exactly 64 signature bytes and canonical base64url-encode them;
10. make one M12P-authenticated HTTPS completion request to the fixed session path;
11. validate the exact M12C issue-result response;
12. require claims registration ID and capabilities to match the requested bootstrap;
13. return the short-lived token + claims to trusted local composition.

The client:

- does not persist the token;
- does not log the token/signature/challenge payload;
- does not auto-refresh;
- does not auto-retry session completion;
- does not fall back to an unpinned/untrusted origin;
- does not accept redirects/proxy routing/custom CA/client certificates;
- does not start M12S polling automatically.

Challenge issuance may be manually/retried with the **same request ID and exact body** because the controller route is idempotent for that case. Automatic retry remains disabled in the reference client.

## TLS policy

Both bootstrap requests use the same M12P server-authentication policy already required by M12S:

- exact canonical HTTPS origin;
- explicit OS/system CA roots;
- `rejectUnauthorized: true`;
- normal hostname validation;
- exact leaf-SPKI SHA-256 pin;
- TLS >=1.2;
- no redirects;
- no environment proxy;
- no connection pooling/reuse relied upon;
- `Connection: close`;
- bounded connect/response timeouts;
- bounded response bytes.

M12U MUST NOT invent a weaker bootstrap TLS mode.

A safe implementation may refactor the narrow M12S HTTPS primitive for reuse only if all existing M12S semantics/tests remain unchanged.

## Authority contract

M12U MUST export immutable contracts recording at minimum:

```ts
{
  schemaVersion: 1,
  routes: [
    "/v1/distributed/auth/challenge",
    "/v1/distributed/auth/session"
  ],
  protocol: "https_http_1_1",
  sharesCanonicalControllerOriginWithM12T: true,
  registrationIdIsCredential: false,
  requiresExistingMachineRegistration: true,
  requiresExistingEd25519Binding: true,
  privateKeyAcceptedByAdapter: false,
  privateKeyProvisioningIncluded: false,
  delegatesChallengeToM12Q: true,
  delegatesCompletionToM12Q: true,
  exposesM12CIssueDirectly: false,
  challengeRequestIdempotentUntilExpiry: true,
  oneActiveChallengePerRegistration: true,
  completionReplayAllowed: false,
  automaticCompletionRetryAllowed: false,
  networkedEnrollmentIncluded: false,
  automaticListen: false,
  tlsIdentityProvisioningIncluded: false,
  controllerPushEnabled: false,
  invokesTargetRuntime: false,
  grantsTaskAuthority: false,
  grantsFilesystemAuthority: false,
  grantsSafetyPlanAuthority: false,
  grantsWriterLeaseAuthority: false,
  grantsCredentialAuthority: false,
  grantsReleaseAuthority: false
}
```

## Implementation proof requirements

Before M12U can be marked complete, hosted CI must remain socket/listener-free and prove:

1. M12Q nonce validation requires exact canonical 32-byte base64url;
2. exact two fixed paths/method/HTTP-version rules;
3. exact Host and duplicate-preserving header validation;
4. Authorization/Transfer-Encoding/Expect/Upgrade/forwarded/proxy/cookie headers rejected;
5. bounded Content-Length and fatal UTF-8 parsing;
6. non-canonical JSON, duplicate-key representations and unsupported fields rejected;
7. challenge request maps to exactly one M12Q `issueChallenge()` call;
8. same request ID + identical body returns the same challenge without a second M12Q call;
9. same request ID + different body fails 409;
10. second active challenge for a registration fails before M12Q;
11. peer/registration rate limits and global concurrency fail before M12Q;
12. challenge response is revalidated and bounded;
13. challenge enumeration-sensitive errors collapse to bodyless 404;
14. completion maps to exactly one M12Q `completeChallenge()` call;
15. completion attempt clears the network active-challenge mapping consistently with M12Q one-shot consumption;
16. completion authentication failures collapse to bodyless 401;
17. successful session response validates claims and never logs/caches/persists bearer token;
18. target client rejects challenge registration/capability/TTL/fingerprint mismatch before signer call;
19. target client signer receives only canonical existing M12Q payload bytes;
20. target client accepts only exactly 64 Ed25519 signature bytes;
21. target client validates M12C issue result and exact requested registration/capabilities;
22. no automatic completion retry;
23. no raw private key accepted anywhere;
24. no direct M12C `issue()` route;
25. no listener/server `listen()` call;
26. no M12H/M12I runtime start;
27. no controller push/takeover/release authority;
28. existing M12S/M12T tests remain green.

## Explicit non-goals / later slices

M12U does not include:

- generating/provisioning the target Ed25519 private key;
- creating/updating M12Q controller authentication bindings;
- key rotation/recovery;
- TLS certificate/private-key provisioning or ACME;
- calling `listen()`;
- bind-address/port selection;
- DNS/firewall/NAT/tunnel changes;
- reverse proxy/load balancer trust;
- HTTP/2/mTLS;
- durable challenge state across controller restart;
- plaintext M12C token recovery after lost completion response;
- delivery acknowledgement/reconciliation;
- M12S polling scheduler;
- target runtime auto-start;
- distributed takeover/recovery;
- real loopback/private-network/cross-machine proof;
- push/merge/deploy/release authority.

Those remain separately reviewed and, where they touch real credentials/listeners/network/system state, separately authorized immediately before physical action.
