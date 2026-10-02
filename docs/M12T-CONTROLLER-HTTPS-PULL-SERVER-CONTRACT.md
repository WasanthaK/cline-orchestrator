# M12T — Controller HTTPS Target-Pull Route / Unbound Server Contract

Status: REVIEWED / DEFINED — NOT IMPLEMENTED
Date: 2026-10-02
Branch: `phase-1/bootstrap`

## Purpose

M12T is the controller-side counterpart to the completed M12S target client.

It defines one HTTPS/HTTP/1.1 route:

`POST /v1/distributed/execution/pull`

The route receives only the existing M12C bearer and the existing request UUID, delegates exactly once to the existing M12R controller-owned selector, and returns either:

- `204 No Content` when M12R returns no work; or
- `200 OK` containing exactly one existing validated M12J `DistributedExecutionDeliveryBundleV1`.

M12T defines a server factory and request handler. The factory MUST return an **unbound** `https.Server`. It MUST NOT call `listen()`, bind a port, open a socket, mutate firewall/DNS, provision a TLS certificate/private key, expose M12Q bootstrap, perform controller push, start target execution, or grant any task/filesystem/Safety/lease/credential/release authority.

Actual listener binding remains a separately authorized physical/deployment action.

## Security-review conclusions

1. **M12R must be called exactly once.** `DistributedControllerPendingWorkSelector.pullNext(token, requestId)` already invokes M12C `authorize(..., "accept_writer_candidates")`, consumes M12C replay state, selects controller-owned work, revalidates candidate/fence currentness, and reuses the existing M12J delivery builder.

   M12T MUST NOT call M12C `authorize()` before M12R and then call M12R with the same request ID. That would create a second authentication path and would consume replay state twice.

2. **The target still selects nothing.** The HTTP request carries no task ID, workspace ID, placement ID, dispatch ID, candidate-assignment ID, fence ID, prompt, command, filesystem path, Safety Plan, lease, release instruction, or arbitrary JSON/body material.

3. **The route is transport composition only.** A successful request returns M12J transport/delivery evidence. It does not call M12H, M12I or any Cline/runtime start path.

4. **TLS server identity is pre-existing local deployment material.** M12T may consume already-provisioned controller-local certificate/private-key material through a trusted startup-only provider, but it MUST NOT generate, enroll, renew, fetch, persist or expose that material.

5. **Direct HTTPS only.** Reverse-proxy identity headers, forwarded headers, HTTP proxy mode, HTTP/2, WebSocket upgrade and CONNECT tunneling are outside M12T.

6. **Ambiguous/lost delivery remains unresolved by design.** M12R claims pending work before M12T sends the response. If the connection is lost after claim, M12T does not requeue or acknowledge the claim. M12S already refuses automatic retry. Durable claim/ack/reconciliation is a later separately reviewed reliability slice.

7. **M12Q bootstrap is still not networked.** This route accepts only an already-issued M12C bearer. It exposes no challenge/session-issuance endpoint.

## Protocol version and route

- Protocol: HTTPS carrying HTTP/1.1 only.
- TLS ALPN: `["http/1.1"]`.
- Method: exactly `POST`.
- Request target: exactly `/v1/distributed/execution/pull`.
- Query string: forbidden.
- Absolute-form request target: forbidden.
- Fragment: impossible on HTTP wire and never accepted from route configuration.
- HTTP version: exactly `1.1`.
- Controller push: forbidden.
- Request body: forbidden.

The expected HTTP `Host` authority is derived only from trusted controller-local deployment configuration for the canonical controller HTTPS origin. It is never task/model/request supplied.

## Request-header contract

M12T examines duplicate-preserving header data (`headersDistinct` and/or `rawHeaders`) rather than relying only on Node's merged `headers` object.

Every required header below must occur exactly once:

- `Host: <exact configured controller authority>`
- `Authorization: Bearer <M12C token>`
- `X-Cline-Request-Id: <canonical UUID>`
- `Accept: application/json`
- `Accept-Encoding: identity`
- `Cache-Control: no-store`
- `Connection: close`
- `Content-Length: 0`

No other request header is accepted.

Therefore the route also rejects, among others:

- `Transfer-Encoding`
- `Expect`
- `Upgrade`
- `Trailer`
- `Cookie`
- `Proxy-Authorization`
- `Forwarded`
- any `X-Forwarded-*`
- `Via`
- `Content-Type`
- duplicate `Authorization`, `Host`, `Content-Length`, request-ID or other fields.

The bearer value must use the same M12S-safe visible bearer alphabet, be between 32 and 4096 characters, and contain no whitespace/control/non-ASCII characters outside that alphabet.

The request ID must be a canonical UUID accepted by the existing transport boundary.

Malformed headers are rejected before M12R is called.

## Request-body / request-smuggling boundary

M12T accepts only `Content-Length: 0` and forbids `Transfer-Encoding`.

The server uses Node's strict HTTP parser:

- `insecureHTTPParser: false`
- `joinDuplicateHeaders: false`
- bounded `maxHeaderSize`
- one request per socket
- `Connection: close`

M12T never parses JSON/form/body content. The route passes only the extracted bearer token and request ID to M12R.

Any `Expect: 100-continue`, protocol upgrade, WebSocket upgrade or CONNECT attempt is rejected/closed without entering M12R.

## Controller-side call graph

The only successful route call graph is:

`HTTPS request validation`
→ `M12R DistributedControllerPendingWorkSelector.pullNext(token, requestId)`
→ inside M12R: `M12C authorize`
→ controller-owned pending-work claim
→ candidate currentness
→ fence currentness
→ M12J `deliverAuthorized`
→ M12T response serialization

M12T MUST NOT:

- invoke M12C separately before M12R;
- call the pending-work queue directly;
- accept target-selected evidence;
- call M12J with request-supplied dispatch/assignment/fence data;
- call M12H/M12I;
- issue/refresh an M12C session;
- create/answer an M12Q challenge.

## Response contract

All responses set:

- `Cache-Control: no-store`
- `Connection: close`

M12T does not echo the bearer, request headers, request body, internal exception message or controller state into response bodies.

### 204 — no work

When M12R returns `null`:

- status: exactly `204`;
- zero response-body bytes;
- no `Content-Type`;
- no task/work/evidence material.

### 200 — one M12J delivery

Before serialization, M12T re-runs the existing `assertDistributedExecutionDeliveryBundle` validator as defense in depth.

Then:

- serialize exactly one compact JSON value;
- UTF-8 encode once;
- hard-limit serialized bytes to at most 1 MiB;
- status: `200`;
- `Content-Type: application/json; charset=utf-8`;
- `Content-Encoding: identity`;
- `Content-Length`: exact encoded byte count;
- `X-Content-Type-Options: nosniff`;
- body: only the validated M12J bundle.

No streaming/chunked response is used for a successful delivery.

### Error responses

Errors are bodyless, non-authorizing and connection-closing.

Route/protocol failures:

- wrong path → `404`
- wrong method on the exact route → `405` with `Allow: POST`
- malformed/duplicate/unsupported headers, wrong Host, wrong HTTP version, body framing violation → `400`

M12R/M12C failures are mapped only from trusted typed error codes:

- underlying M12C `request_replayed` → `409`
- underlying M12C `request_invalid` → `400`
- underlying M12C `capability_not_allowed` → `403`
- underlying M12C `session_not_found`, `session_invalid`, `session_expired`, `session_stale`, or `registration_not_current` → `401`
- underlying M12C `capacity_exceeded` → `503`
- M12R `candidate_not_current` or `fence_not_current` → `409`
- M12R `capacity_exceeded` → `503`
- M12R invariant failures such as `pending_work_invalid`, `pending_work_target_mismatch` or `delivery_failed` → `500`
- unknown/untyped exceptions → `500`

No response exposes which machine, registration, workspace, task, candidate or fence caused a failure.

M12S treats 401/403 as authentication rejection, 409 as request/state conflict, and all other non-200/204 statuses as non-retriable failure. M12T does not add retry hints.

## HTTPS/TLS server-construction contract

M12T implementation may construct an `https.Server` with already-provisioned TLS identity material but MUST NOT bind it.

Required HTTPS/TLS settings:

- minimum TLS: `TLSv1.2`
- ALPN: `["http/1.1"]`
- no HTTP/2
- `requestCert: false` (M12C bearer possession, not mTLS, authenticates the machine)
- no PSK
- no task/request supplied TLS settings
- no caller supplied `SNICallback`, cipher list, secure context, ticket keys or client-CA policy through the pull route.

The trusted startup identity provider may supply only the already-provisioned certificate chain and matching private key needed to construct the controller HTTPS server. M12T never logs, serializes, returns or persists private-key material.

Before later physical binding, a local deployment preflight must verify that the leaf certificate hostname and leaf-SPKI SHA-256 fingerprint correspond to the canonical controller origin / M12P pins that targets are configured to trust. Full client-observed system-CA validation remains part of the later physical proof.

## HTTP parser / resource bounds

Implementation defaults/bounds:

- `maxHeaderSize`: 8192 bytes
- `server.maxHeadersCount`: 16
- `server.maxRequestsPerSocket`: 1
- handshake timeout: trusted local config, 1–30 seconds, default 10 seconds
- headers timeout: trusted local config, 1–30 seconds, default 10 seconds
- request timeout: trusted local config, 1–30 seconds, default 10 seconds
- socket timeout: trusted local config, 1–30 seconds, default 10 seconds
- maximum concurrent in-flight pull handlers: 32
- hard maximum configurable concurrent handlers: 64

When the concurrency bound is exhausted, the route returns bodyless `503` without entering M12R.

Timeouts and parser errors never produce controller exception bodies.

## Special server events

The server factory must explicitly fail closed on:

- `checkContinue`: reject bodyless and close; never emit `100 Continue`;
- `upgrade`: destroy/close socket;
- `connect`: destroy/close socket;
- `clientError`: close with no internal error disclosure;
- `tlsClientError`: close/log only sanitized error classification.

No WebSocket, HTTP tunnel or protocol-upgrade handler is installed.

## Binding contract

M12T implementation MUST return an unbound server:

- `server.listening === false` after construction;
- no internal call to `server.listen()`;
- no default bind host/port;
- no `0.0.0.0` / `::` / public-bind fallback;
- no port-forward, tunnel, firewall or DNS configuration.

A later deployment/binding step must receive explicit user authorization immediately before opening a listener. The bind address and port must come only from trusted local deployment configuration, never from a task, model output, HTTP request or M12R work item.

## Logging / audit contract

Safe route telemetry may contain:

- sanitized route identifier;
- validated request ID;
- HTTP status;
- coarse phase;
- elapsed milliseconds;
- response byte count;
- sanitized M12T/M12R/M12C error code category;
- concurrency saturation signal.

Never log:

- bearer/Authorization;
- raw headers;
- cookies/proxy headers;
- certificate or private-key bytes;
- response bundle/body;
- task/workspace/dispatch/candidate/fence contents;
- internal exception stack in normal remote-facing audit output.

## Authority contract

M12T MUST export an immutable contract recording at minimum:

```ts
{
  schemaVersion: 1,
  protocol: "https_http_1_1",
  method: "POST",
  fixedPath: "/v1/distributed/execution/pull",
  directConnectionOnly: true,
  requestBodyAllowed: false,
  requestContainsWorkSelectors: false,
  duplicateCriticalHeadersAllowed: false,
  transferEncodingAllowed: false,
  expectContinueAllowed: false,
  protocolUpgradeAllowed: false,
  requiresM12CBearer: true,
  delegatesExactlyOnceToM12R: true,
  separatelyPreauthorizesWithM12C: false,
  returnsOnlyM12JBundleOrNoWork: true,
  invokesTargetRuntime: false,
  http2Enabled: false,
  automaticListen: false,
  publicBindDefault: false,
  certificateProvisioningIncluded: false,
  privateKeyGenerationIncluded: false,
  networkedM12QBootstrapIncluded: false,
  deliveryAcknowledgementIncluded: false,
  controllerPushEnabled: false,
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

Before M12T can be marked complete, hosted CI must remain listener/socket-free and prove:

1. exact POST/path/HTTP-version validation;
2. exact Host validation from trusted local origin;
3. required singleton headers accepted;
4. duplicate critical headers rejected using duplicate-preserving input;
5. unknown headers rejected;
6. Transfer-Encoding / Expect / Upgrade / CONNECT rejected before M12R;
7. nonzero/malformed Content-Length rejected before M12R;
8. invalid bearer/request UUID rejected before M12R;
9. exactly one M12R call per valid request;
10. no separate M12C authorization call in the route;
11. no target work selectors/body accepted;
12. null M12R result produces zero-byte 204;
13. delivery result is revalidated with existing M12J validator before serialization;
14. 200 response headers and exact Content-Length are correct;
15. oversized serialized bundle fails closed;
16. typed M12C/M12R errors map to the defined bodyless statuses;
17. unknown errors produce bodyless 500;
18. concurrency saturation returns 503 without M12R;
19. bearer/raw headers/internal response material never enter logs or response bodies;
20. constructed server is not listening and no code path calls `listen()`;
21. upgrade/CONNECT/checkContinue/clientError/tlsClientError paths fail closed;
22. no M12Q issuance, M12H/M12I start, controller push, takeover or release authority is introduced.

## Explicit non-goals / later slices

M12T does not include:

- calling `server.listen()` or opening a real port;
- certificate/private-key issuance, enrollment, storage design or rotation;
- DNS, firewall, NAT or port-forward changes;
- reverse proxy / load balancer / forwarded-header trust;
- HTTP/2;
- mTLS;
- networked M12Q challenge/session issuance;
- durable M12R pending-work queue;
- delivery acknowledgement / claim reconciliation / lost-response recovery;
- automatic retry;
- target runtime auto-start wiring;
- distributed takeover/recovery;
- real loopback or cross-machine TLS proof;
- push/merge/deploy/release authority.

Those remain separately reviewed and, where they involve real listener/network/system/credential changes, separately authorized immediately before the physical action.
