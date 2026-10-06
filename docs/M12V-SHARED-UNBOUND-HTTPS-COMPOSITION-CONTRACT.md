# M12V — Shared Unbound HTTPS Router + TLS Identity Preflight Contract

Status: REVIEWED / DEFINED — NOT IMPLEMENTED
Date: 2026-10-02
Branch: `phase-1/bootstrap`

## Purpose

M12V composes the completed M12T pull route and completed M12U machine-auth bootstrap routes under one canonical controller HTTPS origin and one **unbound** `https.Server`.

M12V is a composition/deployment-readiness slice only. It MUST NOT:

- call `listen()` or bind any address/port;
- provision, generate, enroll, rotate, fetch or persist TLS identity material;
- provision/rotate machine Ed25519 keys or M12Q bindings;
- add a reverse proxy/load balancer trust boundary;
- add HTTP/2, WebSocket, CONNECT or controller push;
- add a fourth application route;
- bypass or duplicate M12T/M12U authority checks;
- add delivery acknowledgement/reconciliation;
- call M12H/M12I or start Cline;
- grant task/filesystem/Safety/lease/credential/release authority.

## Exact shared route table

The shared router exposes exactly three application paths:

1. `POST /v1/distributed/execution/pull` → existing `DistributedControllerHttpsPullRoute` (M12T)
2. `POST /v1/distributed/auth/challenge` → existing `DistributedNetworkMachineAuthRoute` (M12U)
3. `POST /v1/distributed/auth/session` → existing `DistributedNetworkMachineAuthRoute` (M12U)

No fallback chaining is allowed.

The dispatcher matches the exact request-target string before delegation:

- the pull path is sent only to M12T;
- the two auth paths are sent only to M12U;
- every other path is bodyless `404` and is sent to neither route.

Wrong methods on a known route preserve that route's existing bodyless `405` behavior. Wrong HTTP version preserves the existing bodyless `400` behavior.

M12V does not reinterpret M12T bearer authorization or M12U Ed25519 possession proof.

## One canonical origin

M12V accepts exactly one validated M12P `DistributedSecureTransportProfileV1`.

The profile is the single source of truth for:

- canonical controller HTTPS origin;
- hostname/IP authority;
- leaf-SPKI SHA-256 pins;
- client-side server-authentication expectations.

M12V constructs both M12T and M12U routes using exactly `profile.controllerOrigin`.

There is no second route-local origin, alternate hostname, fallback URL, wildcard host or request-supplied authority.

## TLS identity input boundary

M12V consumes only already-provisioned process-local TLS identity material through a trusted startup provider.

The provider returns exactly:

```ts
{
  privateKey: KeyObject;        // type === "private"
  certificates: readonly (string | Buffer)[]; // leaf first, then intermediates
}
```

Requirements:

- `privateKey.type === "private"`;
- `certificates.length >= 1`;
- each certificate is non-empty PEM/DER material accepted by `X509Certificate`;
- the first certificate is the exact leaf certificate presented by the server;
- M12V accepts no passphrase field, key path, file path, secret name, PFX, JWK, raw task/model-supplied TLS options, `SNICallback`, client-CA policy, cipher override or ticket keys;
- M12V never serializes, logs, persists or returns private-key material.

TLS/key loading/provisioning remains a later local/admin concern.

## Mandatory local TLS identity preflight

Before constructing the shared server, M12V performs a pure local preflight against the same identity object whose verified private key/certificate chain will be used for `https.createServer`. Node's HTTPS server key option is PEM/Buffer based in the supported runtime contract, so only after successful preflight the exact verified private `KeyObject` is exported to an ephemeral unencrypted PKCS#8 PEM `Buffer` for synchronous server construction; that temporary buffer is zeroed immediately after the server builder returns.

The preflight MUST:

1. validate the M12P profile;
2. parse the first certificate with `X509Certificate`;
3. reject a leaf marked as a CA certificate;
4. validate current certificate time bounds against an injected/current clock;
5. require the leaf to match the canonical origin host:
   - DNS host → `x509.checkHost(hostname)`;
   - IP literal → `x509.checkIP(ip)`;
6. export the leaf public key as DER/SPKI, compute `sha256/<base64>`, and require an exact match with one M12P pin;
7. require `x509.checkPrivateKey(privateKey) === true`;
8. reject malformed/unsupported identity material before server construction.

Node exposes `X509Certificate.checkHost()`, `checkIP()`, `publicKey`, and `checkPrivateKey()` for these local checks.

This preflight does **not** claim full trust-chain validation. The later physical proof must still demonstrate that the target client accepts the served chain using its explicit system CA roots plus M12P hostname and leaf-SPKI policy.

### Preflight receipt

Successful preflight returns only non-secret process-local evidence:

```ts
{
  schemaVersion: 1,
  profileId: string,
  controllerOrigin: string,
  leafSpkiSha256Pin: string,
  certificateValidFrom: string,
  certificateValidTo: string,
  hostnameOrIpMatched: true,
  privateKeyMatched: true,
  authority: "deployment_readiness_evidence_only",
  grantsTaskAuthority: false,
  grantsFilesystemAuthority: false,
  grantsSafetyPlanAuthority: false,
  grantsWriterLeaseAuthority: false,
  grantsCredentialAuthority: false,
  grantsReleaseAuthority: false
}
```

The receipt contains no certificate bytes, private key, passphrase or M12C/M12Q credential.

## Shared HTTPS server construction

M12V creates exactly one `https.Server` using the preflighted identity.

Required server options/bounds remain at least as strict as M12T:

- TLS minimum: `TLSv1.2`;
- ALPN: exactly `["http/1.1"]`;
- `requestCert: false`;
- `insecureHTTPParser: false`;
- `joinDuplicateHeaders: false`;
- `maxHeaderSize: 8192`;
- `server.maxHeadersCount = 16`;
- `server.maxRequestsPerSocket = 1`;
- handshake timeout: 1–30 seconds, default 10 seconds;
- headers timeout: 1–30 seconds, default 10 seconds;
- request timeout: 1–30 seconds, default 10 seconds;
- socket timeout: 1–30 seconds, default 10 seconds.

The factory returns with `server.listening === false`.

The M12V production module MUST contain no `.listen(` call and no default host/port.

## Request dispatch and body handling

### Pull route

For exact `/v1/distributed/execution/pull`:

- M12V does not buffer or parse a body;
- it passes only `method`, `url`, `httpVersion`, and `rawHeaders` to existing M12T;
- M12T remains the sole validator for `Authorization`, request ID, exact headers, `Content-Length: 0`, M12C/M12R state and response semantics.

M12V MUST NOT pre-authorize with M12C or inspect/modify the bearer.

### Bootstrap routes

For exact M12U auth paths:

- for a non-POST request or non-HTTP/1.1 request, M12V delegates immediately with an empty body so M12U preserves its own 405/400 behavior;
- for POST + HTTP/1.1, M12V performs only a minimal resource/framing preflight before buffering:
  - exactly one decimal `Content-Length`;
  - no `Transfer-Encoding`;
  - challenge body length 1–1024 bytes;
  - session body length 1–512 bytes;
- this preflight grants no identity authority and does not parse JSON;
- M12V then buffers exactly the declared bytes;
- the completed body plus `request.socket.remoteAddress` is passed to M12U;
- M12U revalidates the entire exact header/body/canonical-JSON contract and remains the sole M12Q delegate.

If the body stream aborts/errors/closes early, exceeds the route maximum, or does not equal declared length:

- M12U is not called;
- the connection fails closed;
- no challenge/session state is created or consumed.

M12V never trusts `Forwarded` or `X-Forwarded-For`; only the direct socket peer address is forwarded to M12U.

## Body-collector resource bound

Because M12U's own concurrency guard runs only after the body has been collected, M12V adds a transport-only body-collector ceiling:

- default concurrent bootstrap body collectors: 16;
- hard maximum configurable collectors: 32;
- saturation returns bodyless `503` without calling M12U.

The server request/header/socket timeouts remain active while the body is being collected.

No body collector exists for M12T pull requests.

## Response handling

M12V writes only the already-produced M12T/M12U response object:

- status code;
- exact route-produced headers;
- exact route-produced body bytes.

It does not decorate successful responses with extra metadata and does not expose internal errors.

Unknown-route and transport-level failures are bodyless, `Cache-Control: no-store`, `Connection: close`.

## Special HTTP/TLS events

The one shared server fails closed on:

- `checkContinue` → bodyless 417, no route delegation;
- `upgrade` → destroy socket;
- `connect` → destroy socket;
- `clientError` → destroy/close without internal details;
- `tlsClientError` → destroy/close with sanitized local telemetry only.

No WebSocket, tunnel, protocol-upgrade, HTTP/2 or proxy mode is installed.

## Route isolation / authority preservation

M12V MUST prove:

- M12T receives no M12U challenge/session request;
- M12U receives no M12T pull request;
- unknown paths hit neither route;
- M12T's selector dependency is unavailable to M12U;
- M12U's bootstrap dependency is unavailable to M12T;
- M12V never calls M12C `authorize()`, M12C `issue()`, M12Q `issueChallenge()` or `completeChallenge()` directly;
- all such authority remains inside the already-reviewed M12T/M12U routes.

## Immutable M12V contract

M12V MUST export an immutable contract recording at minimum:

```ts
{
  schemaVersion: 1,
  routes: [
    "/v1/distributed/execution/pull",
    "/v1/distributed/auth/challenge",
    "/v1/distributed/auth/session"
  ],
  protocol: "https_http_1_1",
  singleCanonicalOrigin: true,
  consumesM12PProfile: true,
  reusesM12TRoute: true,
  reusesM12URoute: true,
  fallbackRouteChainingAllowed: false,
  duplicatesM12CAuthorization: false,
  exposesM12CIssueDirectly: false,
  performsM12QDirectly: false,
  localTlsIdentityPreflightRequired: true,
  verifiesTlsHostnameOrIp: true,
  verifiesLeafSpkiPin: true,
  verifiesPrivateKeyMatchesLeaf: true,
  fullSystemCaChainValidationClaimed: false,
  reverseProxyTrustEnabled: false,
  http2Enabled: false,
  automaticListen: false,
  publicBindDefault: false,
  tlsIdentityProvisioningIncluded: false,
  machineKeyProvisioningIncluded: false,
  deliveryAcknowledgementIncluded: false,
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

## Hosted implementation proof requirements

Before M12V can be marked complete, hosted CI must remain listener/socket-free and prove:

1. exactly the three reviewed application paths exist;
2. pull requests reach only M12T;
3. challenge/session requests reach only M12U;
4. unknown paths reach neither;
5. known-route wrong method/version preserves route behavior;
6. pull path performs no body buffering and no bearer/auth duplication;
7. bootstrap framing preflight rejects duplicate/missing/non-decimal/oversized Content-Length and Transfer-Encoding before body collection/M12U;
8. bootstrap collector buffers exactly declared bytes;
9. aborted/error/early-close/oversized body never reaches M12U;
10. direct socket peer address, not forwarded headers, is supplied to M12U;
11. collector saturation returns 503 before M12U;
12. M12T/M12U response status/headers/body are passed through exactly;
13. shared special events fail closed;
14. M12P profile is the sole canonical origin;
15. TLS leaf DNS/IP match is locally verified;
16. leaf-SPKI SHA-256 pin must match M12P;
17. leaf/private-key consistency is locally verified;
18. expired/not-yet-valid/CA/malformed leaf fails before server construction;
19. preflight receipt contains no credential material;
20. the certificate chain supplied to the server builder is the exact preflighted chain, and the server private key is an ephemeral PKCS#8 PEM export of the exact preflighted KeyObject whose bytes are zeroed immediately after synchronous construction;
21. shared server is HTTP/1.1-only, strict-parser, bounded, one-request-per-socket;
22. server returns unbound and production contains zero `.listen(` calls;
23. production contains zero direct M12C authorize/issue calls and zero direct M12Q challenge/completion calls;
24. no M12H/M12I target-runtime dependency is introduced;
25. all existing M12S/M12T/M12U tests remain green.

## Explicit non-goals / later slices

M12V does not include:

- reading TLS keys/certificates from disk, secret manager or environment;
- issuing or renewing TLS certificates;
- provisioning/rotating target Ed25519 keys or controller M12Q bindings;
- calling `listen()`;
- choosing a production bind address or port;
- firewall/NAT/DNS/tunnel mutation;
- reverse proxy/load balancer support;
- target discovery;
- real loopback/private-network/cross-machine TLS traffic;
- delivery acknowledgement/reconciliation;
- M12S polling scheduler;
- target runtime auto-start;
- distributed takeover/recovery;
- push/merge/deploy/release authority.

Those remain separately reviewed. Any real listener, credential provisioning, network mutation or physical cross-machine proof requires explicit user authorization immediately before the physical action.
