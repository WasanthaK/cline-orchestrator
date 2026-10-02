# M12S — Secure HTTPS Target-Pull Client Adapter Security Review and Contract

Status: REVIEWED / DEFINED — NOT IMPLEMENTED
Date: 2026-10-02
Branch: `phase-1/bootstrap`

## Purpose

M12S is the first Milestone 12 slice allowed to contain client-side DNS/TCP/TLS/HTTP code. It is deliberately target-client-only.

Its only job is to take an already-issued M12C bearer session plus a fresh request ID, make one bounded outbound HTTPS request to the controller origin configured by M12P, and return either:

- one strictly validated existing M12J `DistributedExecutionDeliveryBundleV1`; or
- `null` for an authenticated “no work” response.

M12S MUST NOT issue/refresh machine sessions, select work, execute work, open a listener, provide controller push, provision credentials, implement distributed takeover/recovery, or grant any task/filesystem/Safety/lease/credential/release authority.

## Security conclusions

1. **M12P remains configuration only.** Its `networkIoEnabled: false` value MUST remain false. M12S being invoked by trusted target-local composition is what performs I/O; a transport profile can never grant permission to connect or execute.
2. **M12Q/M12C remain target-authentication authorities.** M12S accepts an already-issued short-lived bearer. It MUST NOT accept a private key, create a bootstrap challenge, issue a bearer, refresh a bearer, or persist bearer material.
3. **M12R remains work-selection authority.** The target request MUST contain no task/workspace/dispatch/candidate/fence identifiers or selectors.
4. **M12J remains delivery schema authority.** A 200 response is accepted only after the existing M12J bundle validator succeeds. M12S MUST NOT define a second delivery schema.
5. **Network success is not execution authority.** M12S returns a bundle; it does not call M12H/M12I itself. Later trusted composition may pass the validated bundle only to the existing M12J target receiver.
6. **Ambiguous delivery is not retried automatically.** M12R claims work before response delivery. If the request outcome becomes ambiguous after the controller may have claimed work, M12S MUST fail with an explicit ambiguous-outcome classification and MUST NOT retry. Durable claim/ack/reconciliation is a later separately reviewed reliability slice.
7. **No real socket/listener proof is part of this definition.** Implementation tests for M12S must use injected/fake request transport until a separately authorized network proof is approved.

## Fixed wire contract

### Destination

- Source: validated `DistributedSecureTransportProfileV1.controllerOrigin` only.
- Scheme: HTTPS only.
- Method: `POST`.
- Fixed path: `/v1/distributed/execution/pull`.
- Query: none.
- Fragment: none.
- Caller-supplied URL/path/host/port/query/fragment: forbidden.
- Custom DNS `lookup` callback: forbidden.
- Environment proxy routing: forbidden for this adapter.
- Redirect following: forbidden.

The final request URL is constructed only as:

`new URL("/v1/distributed/execution/pull", profile.controllerOrigin)`

and must still have the exact origin from the validated M12P profile.

### Request inputs

Public client call shape:

```ts
pull(input: {
  profile: DistributedSecureTransportProfileV1;
  bearerToken: string;
  requestId: string;
}): Promise<DistributedExecutionDeliveryBundleV1 | null>
```

The method accepts no task ID, workspace ID, dispatch ID, assignment ID, fence ID, placement ID, prompt, command, filesystem path, Safety Plan, lease, release instruction, private key, client certificate, or arbitrary headers.

### Request headers

Exactly the adapter-owned security-relevant headers:

- `Authorization: Bearer <M12C token>`
- `X-Cline-Request-Id: <canonical UUID>`
- `Accept: application/json`
- `Accept-Encoding: identity`
- `Cache-Control: no-store`
- `Connection: close`
- `Content-Length: 0`

No cookies, proxy authorization, client-cert headers, forwarded identity headers, or caller-provided headers are accepted.

The request has no body.

## TLS/server-authentication contract

M12S MUST use Node's `node:https` / `node:tls` primitives rather than global `fetch`, so redirect, proxy, trust-store, hostname and pinning behavior are explicit.

Required behavior:

1. `rejectUnauthorized: true`.
2. TLS minimum version: `TLSv1.2`.
3. Hostname verification MUST run through Node's `tls.checkServerIdentity(hostname, cert)`.
4. Only after hostname verification succeeds, hash the leaf peer certificate's `cert.pubkey` with SHA-256 and require an exact match with at least one M12P `serverSpkiSha256Pins` entry.
5. Pins are leaf-SPKI rotation pins only. Do not accept an issuer/intermediate/root SPKI match in place of the leaf.
6. No caller-supplied `ca`, `cert`, `key`, `pfx`, `servername`, `checkServerIdentity`, `ciphers`, `secureContext`, `lookup`, `createConnection`, agent, or proxy configuration.
7. Do not use `https.globalAgent`. Use a one-request connection (`agent: false`) and `Connection: close`; no connection pooling or TLS-session reuse is relied upon.
8. The adapter MUST explicitly obtain OS/system trust roots using supported Node TLS APIs and pass them as the request CA set. It MUST fail closed with `unsupported_runtime` / `system_ca_unavailable` rather than fall back to an unknown/default trust store.
9. M12S implementation must raise or enforce a runtime floor that actually supports the required system-CA APIs. The current package-wide `node >=22` declaration is insufficiently precise for this guarantee and must be tightened during implementation.

## Time bounds

M12P `connectTimeoutMs` remains authoritative for connection establishment.

M12S applies:

- connection/TLS-establishment deadline: `profile.connectTimeoutMs`;
- post-secure-connect response deadline: the same `profile.connectTimeoutMs`;
- therefore maximum intended request lifetime is bounded to approximately `2 * connectTimeoutMs`, excluding only synchronous local validation work.

Timeout expiration destroys the request/socket and produces a sanitized timeout error. No timeout path retries automatically.

## Response contract

Only these responses are valid:

### 204 No Content

Meaning: authenticated pull succeeded and controller selected no work.

Requirements:

- status exactly 204;
- response body exactly zero bytes;
- return `null`;
- no execution action.

### 200 OK

Meaning: controller returned one existing M12J delivery bundle.

Requirements:

- status exactly 200;
- `Content-Type` media type must be `application/json`; only absent charset or `charset=utf-8` is accepted;
- `Content-Encoding` must be absent or `identity`;
- if `Content-Length` is present and exceeds `profile.maxResponseBytes`, abort before buffering;
- actual streamed bytes are always counted and hard-limited to `profile.maxResponseBytes` regardless of `Content-Length`;
- UTF-8 JSON parsing must succeed;
- parsed value must pass existing `assertDistributedExecutionDeliveryBundle`;
- returned bundle must still match the target later when the existing M12J receiver performs target identity revalidation.

### All other statuses

- 3xx: `redirect_rejected`; never follow `Location`.
- 401/403: `authentication_rejected`.
- 409: `request_state_conflict` (including replay/state conflict); never retry automatically.
- any other status: `unexpected_status`.

Response bodies for error statuses are never trusted, parsed into authority, or copied into error messages/logs.

## Retry and ambiguity contract

M12S performs exactly one HTTP attempt per `requestId`.

Automatic retries are forbidden for:

- DNS errors;
- TCP/TLS failures;
- timeouts;
- connection reset;
- 3xx;
- 4xx/5xx;
- malformed/oversized responses;
- ambiguous disconnect after request transmission.

If the controller may have received the request but M12S did not receive a complete valid 200/204 response, the result is `ambiguous_outcome`.

A higher layer MUST NOT simply generate a fresh request ID and try again. Durable pending-work claim/ack/reconciliation, if required, is a future separately reviewed slice.

## Error contract

M12S errors are typed and sanitized. Allowed codes:

- `profile_invalid`
- `bearer_invalid`
- `request_id_invalid`
- `unsupported_runtime`
- `system_ca_unavailable`
- `dns_or_connect_failed`
- `connect_timeout`
- `tls_validation_failed`
- `server_identity_mismatch`
- `response_timeout`
- `redirect_rejected`
- `authentication_rejected`
- `request_state_conflict`
- `unexpected_status`
- `response_headers_invalid`
- `response_encoding_rejected`
- `response_too_large`
- `response_json_invalid`
- `delivery_invalid`
- `ambiguous_outcome`

Errors MUST NOT contain:

- bearer token or Authorization header;
- response body;
- private-key/client-certificate material;
- raw peer certificate;
- task prompt/command;
- environment variables;
- proxy credentials.

## Logging/observability contract

Safe metadata only:

- transport profile ID;
- request ID;
- controller host/origin metadata already present in trusted local config;
- coarse phase: validation / connect / TLS / request / response / validation;
- HTTP status;
- response byte count;
- elapsed time;
- sanitized M12S error code.

Never log bearer tokens, Authorization headers, response bodies, certificate DER, private keys, task/workspace/dispatch/fence payloads, or arbitrary headers.

## Authority contract

M12S MUST export an immutable contract recording at minimum:

```ts
{
  schemaVersion: 1,
  direction: "target_to_controller",
  method: "POST",
  fixedPath: "/v1/distributed/execution/pull",
  requestContainsWorkSelectors: false,
  requiresValidatedM12PProfile: true,
  requiresM12CBearer: true,
  issuesOrRefreshesBearer: false,
  requiresSystemCaValidation: true,
  requiresHostnameValidation: true,
  requiresLeafSpkiSha256Pin: true,
  redirectsAllowed: false,
  environmentProxyAllowed: false,
  automaticRetryAllowed: false,
  connectionReuseAllowed: false,
  requestBodyAllowed: false,
  acceptsNoWork204: true,
  acceptsM12JBundle200: true,
  invokesTargetRuntime: false,
  listenerIncluded: false,
  controllerPushEnabled: false,
  credentialProvisioningIncluded: false,
  distributedTakeoverEnabled: false,
  grantsTaskAuthority: false,
  grantsFilesystemAuthority: false,
  grantsSafetyPlanAuthority: false,
  grantsWriterLeaseAuthority: false,
  grantsCredentialAuthority: false,
  grantsReleaseAuthority: false
}
```

## Implementation proof requirements

Before M12S can be marked complete, hosted CI must prove without opening a real listener/socket:

1. exact fixed URL/method/header construction;
2. no caller work selectors or arbitrary headers;
3. profile validation runs before any request factory is called;
4. invalid/missing bearer/request ID fail before I/O;
5. system CA unavailable fails before I/O;
6. hostname verification occurs before pin acceptance;
7. matching leaf SPKI pin succeeds; mismatched pin fails;
8. redirects are rejected;
9. only 200/204 accepted;
10. 204 with body fails;
11. JSON content type/UTF-8 rules enforced;
12. content encoding restriction enforced;
13. declared and actual body size limits enforced;
14. malformed JSON and invalid M12J bundle fail closed;
15. no automatic retry on any error;
16. ambiguous outcome is explicit;
17. error text/log records never contain bearer or response body;
18. adapter returns bundle/null only and never starts M12H/M12I;
19. no listener/server/controller-push code is introduced.

## Explicit non-goals / later slices

M12S does not include:

- network transport for M12Q challenge/session bootstrap;
- controller HTTPS route/server/listener;
- TLS certificate/private-key provisioning;
- DNS/firewall/port-forward/tunnel configuration;
- proxy support;
- client certificates / mTLS;
- durable controller pending-work queue;
- delivery acknowledgement or ambiguous-claim recovery;
- distributed takeover/recovery;
- runtime wiring that automatically starts distributed work;
- real cross-machine or loopback socket proof;
- release/push/merge/deploy authority.

Those remain separately reviewed and, where they touch real listeners/network/system configuration, separately authorized immediately before physical proof.
