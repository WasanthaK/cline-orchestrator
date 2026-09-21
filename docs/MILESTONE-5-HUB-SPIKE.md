# Milestone 5 — Cline Hub / VS Code Technical Spike

Pinned upstream surface: `@cline/sdk` / `@cline/core` **0.0.83** (`cline/cline` tag `sdk/sdk/v0.0.83`).

This document records static research only. It does **not** start, stop, attach to, replace, or otherwise mutate the local Cline Hub, VS Code Cline runtime, or shared Ollama environment.

## 1. Hub discovery and local authentication

Status: **verified from the pinned 0.0.83 source**.

### Discovery model

The local Hub publishes a JSON discovery record containing:

- Hub ID and protocol compatibility metadata;
- core/build identity;
- host, port, and WebSocket URL;
- process ID and timestamps;
- a local `authToken`.

The record type is `HubServerDiscoveryRecord` in upstream `sdk/packages/core/src/hub/discovery/index.ts`.

The default endpoint is resolved from:

- host: `127.0.0.1`;
- pathname: `/hub`;
- port: Cline's shared Hub port constant (or development Hub port for development builds).

The endpoint can be overridden by:

- `CLINE_HUB_HOST`;
- `CLINE_HUB_PORT`;
- `CLINE_HUB_PATHNAME`.

The discovery file itself can be overridden with `CLINE_HUB_DISCOVERY_PATH`.

### Discovery ownership

The client chooses the default owner context according to Cline build environment:

- **production**: `resolveProductionHubOwnerContext()` uses owner ID `hub-production` and defaults to `<cline-data-dir>/locks/hub/production.json`;
- **development**: `resolveSharedHubOwnerContext()` uses a build-scoped owner label so different development builds do not fight over the same daemon. The generic owner record is stored below `<cline-data-dir>/locks/hub/owners/`.

This distinction matters for the orchestrator: it should consume Cline's owner/discovery helpers rather than inventing a separate discovery path or assuming a hard-coded port.

### Discovery publication

On Hub startup, 0.0.83 generates the authentication token with:

```ts
randomBytes(32).toString("hex")
```

That is 32 random bytes represented as 64 hexadecimal characters.

The discovery record is published only after the Hub listener and transport are ready. Publication uses a same-directory temporary file opened with mode `0o600`, fsyncs the file, renames it into place atomically, and then attempts a best-effort directory fsync. If discovery publication fails, Hub startup rolls back rather than leaving a listener running without a published authentication record.

### Native WebSocket authentication

The low-level `connectToHub()` path resolves authentication in this order:

1. an `authToken` query parameter on the supplied URL; the parameter is removed before the network connection is opened;
2. otherwise, when the URL matches the current discovered Hub endpoint, the token from the discovery record.

The WebSocket is then opened with the subprotocol:

```text
cline-hub-auth.<token>
```

`NodeHubClient` exposes the same mechanism explicitly through `HubClientOptions.authToken`. It rejects configuration that combines `authToken` with custom connection-header authentication.

The Hub validates the token using a constant-time comparison before accepting token-authenticated WebSocket upgrades.

### Local-browser exception

For a Hub bound to a loopback host, the server also accepts a WebSocket upgrade from a local browser origin (`localhost`, `127.0.0.1`, or loopback IPv6) without the token.

This is intentionally **not equivalent** to a token-authenticated native client. When the server attaches the browser socket, `allowRegisteredWorkspace` is true only when token authentication succeeded. Therefore the orchestrator should use the authenticated native-client path, not rely on the browser-origin exception.

### HTTP authentication surface

The local HTTP companion endpoints behave differently:

- `/health` — unauthenticated; exposes health/protocol/build/endpoint state but not the auth token;
- `/version` — unauthenticated build/protocol metadata;
- `/status` — requires `Authorization: Bearer <token>` and returns the full discovery/status record, including the auth token;
- `/drain` — authenticated Bearer token required;
- `/shutdown` — authenticated Bearer token required.

`probeHubServer(url, { authToken })` uses authenticated `/status`; without a token it uses unauthenticated `/health`.

### Security conclusions for Cline Orchestrator

1. **Do not invent or persist a second orchestrator Hub token.** Read/consume Cline's managed discovery/auth flow.
2. **Do not place the token in logs, task state, project memory, handoff artifacts, or Git.** It is a local runtime credential.
3. **Do not use unauthenticated browser-origin access for orchestration.** The orchestrator needs the native authenticated client path.
4. **Do not assume a fixed Hub port or discovery file.** Use the pinned Cline discovery helpers and owner context.
5. **Do not start or replace a Hub merely because discovery metadata exists.** Later spike steps must first determine the supported attach/list APIs and multi-client ownership semantics.
6. **Treat explicit endpoint overrides separately from managed discovery.** An explicit endpoint still needs an explicit or otherwise resolvable authentication token.

### Pinned upstream evidence

Inspected at `cline/cline` tag `sdk/sdk/v0.0.83`:

- `sdk/packages/core/src/hub/discovery/defaults.ts`
- `sdk/packages/core/src/hub/discovery/index.ts`
- `sdk/packages/core/src/hub/discovery/workspace.ts`
- `sdk/packages/core/src/hub/client/connect.ts`
- `sdk/packages/core/src/hub/client/index.ts`
- `sdk/packages/core/src/hub/server/hub-websocket-server.ts`
- `sdk/packages/core/src/hub/index.ts`
- `sdk/packages/core/package.json`
- `sdk/packages/sdk/src/index.ts`

## Remaining technical-spike items

These remain deliberately unresolved until their own plan units:

- exact supported imports at 0.0.83 and whether `@cline/core` must be a direct dependency;
- session list/attach/send/abort/event APIs;
- workspace/session identity and multi-client approval/tool-executor behavior;
- migration design from the orchestrator-owned `ClineCore` runtime to shared Hub attachment.
