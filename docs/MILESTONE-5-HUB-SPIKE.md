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

## 2. Exact imports and dependency boundary

Status: **verified from the pinned 0.0.83 package exports and source entry points**.

### Package export chain

The current orchestrator declares only:

```json
"@cline/sdk": "0.0.83"
```

That is sufficient for the attach-only Hub research and the likely first adapter implementation.

At 0.0.83, `@cline/sdk` describes itself as the user-facing alias for `@cline/core`, exports only its package root (`.`), and its source root is:

```ts
export * from "@cline/core";
```

The `@cline/core` root in turn contains:

```ts
export * from "./hub";
```

and the Core package also explicitly publishes the public subpath:

```text
@cline/core/hub
```

Therefore the Hub symbols exported by `sdk/packages/core/src/hub/index.ts` are available through the existing public `@cline/sdk` root export. Importing those symbols from `@cline/sdk` does **not** require the orchestrator to reach through to an undeclared transitive package path.

### Supported Hub symbols confirmed at 0.0.83

The pinned Hub index publicly re-exports the client, connection, session-client, UI-client, daemon, discovery, runtime-host, and server Hub modules. For the orchestrator's attach-only path, the relevant confirmed public symbols include:

- `NodeHubClient` and `HubClientOptions`;
- `HubSessionClient` and `HubSessionClientOptions`;
- `HubSessionRow`, `HubStreamEvent`, and related session-client types;
- `HubUIClient` and `HubUIClientOptions`;
- `HubRuntimeHost` and `HubRuntimeHostOptions`;
- `connectToHub`, `resolveHubUrl`, `probeHubConnection`, and `sendHubCommand`;
- `readHubDiscovery`, `probeHubServer`, and Hub discovery record/types;
- `resolveProductionHubOwnerContext()` and `resolveSharedHubOwnerContext()`;
- Hub endpoint/default helpers re-exported by the Hub index.

`HubSessionClient` is itself built on `NodeHubClient` and is the higher-level session-oriented client. `HubUIClient` is a lighter UI/notification/client-tracking facade. `HubRuntimeHost` implements Cline's `RuntimeHost` interface over the Hub transport.

### Recommended import style for this repository

For Milestone 5 attach-only work, prefer the already-declared SDK facade:

```ts
import {
  HubRuntimeHost,
  HubSessionClient,
  NodeHubClient,
  readHubDiscovery,
  resolveProductionHubOwnerContext,
  resolveSharedHubOwnerContext,
} from "@cline/sdk";
```

Use type-only imports from the same package where applicable.

This keeps the orchestrator on Cline's documented user-facing alias, preserves the existing single pinned dependency, and avoids coupling the repository to Core-only package subpaths before that is necessary.

### When `@cline/core` should become a direct dependency

If future Milestone 5 implementation intentionally imports a Core subpath, then `@cline/core` must be declared directly and pinned to the exact same version as `@cline/sdk`.

For example, this import would require a direct Core dependency:

```ts
import { ... } from "@cline/core/hub";
```

and a future daemon-owner integration using:

```text
@cline/core/hub/daemon-entry
```

would also require direct `@cline/core` ownership in `package.json`.

The orchestrator must **not** import `@cline/core/hub` merely because `@cline/core` happens to be installed transitively under `@cline/sdk`. If we choose a Core subpath, we declare it ourselves.

### Dependency decision

**Decision for the current technical spike: keep `package.json` unchanged with only `@cline/sdk: 0.0.83`.**

Reasons:

1. the required Hub symbols are already on the public SDK root at this pinned release;
2. the SDK package is explicitly the user-facing alias for Core;
3. the planned first implementation is attach-only and does not require `hub/daemon-entry`;
4. one direct Cline dependency reduces package/version drift during the migration;
5. adding `@cline/core` later remains straightforward if a deliberately chosen Core-only subpath becomes necessary.

Both packages must remain version-aligned if `@cline/core` is later added; do not mix Hub/Core and SDK versions.

### Correction to the preliminary recommendation

The initial research note assumed that because `@cline/sdk` exposes only its root package path, Hub APIs would require a direct `@cline/core/hub` import. Inspection of the pinned Core root shows that assumption was incomplete: the Core root re-exports `./hub`, and the SDK root re-exports the Core root. The corrected recommendation is therefore to **use `@cline/sdk` directly and not add `@cline/core` yet**.

### Import-boundary rules for implementation

1. Prefer `@cline/sdk` root imports for the attach-only Hub adapter.
2. Do not import unpublished internal paths such as `@cline/core/dist/...` or source-tree paths.
3. Do not add `@cline/core` until an implementation actually requires one of its explicit Core-only subpaths.
4. If Core is added, pin both packages to exactly `0.0.83` during this milestone.
5. Do not use daemon/server ownership imports during the first attach-only proof.

## 3. Session-control API map

Status: **verified from the pinned 0.0.83 client, protocol, handler, and VS Code example sources**.

### Control layers available at 0.0.83

There are four useful public layers, with different tradeoffs:

1. **`NodeHubClient`** — authoritative command/reply plus raw Hub event-stream primitive. It is the only public client facade that exposes arbitrary Hub commands such as `session.attach` while keeping the same registered client identity for commands and subscriptions.
2. **`HubSessionClient`** — convenience wrapper over a private `NodeHubClient`. It covers create/send/get/list/search/messages/abort/detach and a normalized runtime-event stream, but it does **not** expose `session.attach`.
3. **`HubUIClient`** — useful for `client.list`, full `session.list` rows, session search, and session/client lifecycle notifications; it is not the run-control facade.
4. **`HubRuntimeHost`** — implements Cline's `RuntimeHost` contract over a private `NodeHubClient`, including normalized list/get/run/abort/detach and `CoreSessionEvent` translation. It is a valuable compatibility/reference implementation, but its private Hub client means callers cannot issue `session.attach` using that same registered client identity.

For the orchestrator's first shared-session adapter, the safest control primitive is therefore **one authenticated `NodeHubClient` owned by the adapter**, with a small orchestrator-side normalization layer. `HubRuntimeHost` should be treated as the reference for event and `RuntimeHost` behavior unless a later design proves that a second client identity is acceptable.

### List and inspect sessions

Raw protocol:

```ts
await client.command("session.list", { limit: 200 });
await client.command("session.get", { includeSnapshot: true }, sessionId);
```

`session.list` can also receive `rootOnly: true`. The server returns canonical Hub session records. `session.get` returns `session_not_found` for an unknown ID and can include the runtime snapshot when requested.

Convenience surfaces:

- `HubSessionClient.listSessions({ limit })` returns simplified `HubSessionRow` values (`sessionId`, parent/status/metadata/messages path). It does not preserve the full Hub `SessionRecord` workspace/participant shape.
- `HubSessionClient.getSession(sessionId)` returns the same simplified row and converts `session_not_found` into `undefined`.
- `HubUIClient.listSessions(limit)` returns full Hub `SessionRecord[]`, including `workspaceRoot`, status, creator, participants, runtime options, and usage.
- `HubRuntimeHost.listSessions(limit, { rootOnly })` and `getSession(sessionId)` normalize Hub records/snapshots to Cline Core `SessionRecord` values, including workspace root/cwd/status/model/source metadata.

**Do not select a session merely because it is the newest row.** The exact workspace/session identity rule is the next spike unit.

### Attach to an existing authoritative session

The protocol exposes:

```ts
await client.command(
  "session.attach",
  {
    sessionId,
    role: "participant",
    metadata: { source: "cline-orchestrator" },
  },
  sessionId,
);
```

`HubSessionAttachInput` declares `sessionId`, optional metadata, and optional participant role. In the pinned 0.0.83 server handler, however, `session.attach` currently registers the calling `clientId` as a **`participant`** and does not consume the optional role/metadata fields when creating the participant record. The handler then publishes `session.attached` and returns the updated session record.

This is a genuine attach operation, distinct from `session.get` or subscribing to events.

The pinned VS Code example follows the important ordering:

1. establish the event stream for the selected session;
2. issue `session.attach` for that session.

That ordering avoids missing lifecycle/run events that can arrive immediately around attachment.

`HubSessionClient` and `HubRuntimeHost` do not expose a public `attachSession()` method. Using a separate temporary `NodeHubClient` only for attach would create a **different Hub client identity**, so the first orchestrator adapter should not do that. If attachment is required, the same adapter-owned `NodeHubClient` should perform attach and subsequent commands/subscriptions.

### Send work to the attached/existing session

Two protocol command names reach the same Hub input handler:

```text
run.start
session.send_input
```

The server resolves the target by `sessionId`, verifies that the session exists, publishes `run.started`, executes the runtime turn, publishes terminal run evidence, and returns the result/snapshot. The pinned handler requires a nonblank prompt string.

Convenience surfaces:

- `HubSessionClient.sendRuntimeSession(sessionId, request)` uses `session.send_input` and supports prompt, mode, attachments, delivery, and timeout settings.
- `HubRuntimeHost.runTurn(input)` uses `run.start`, ensures a session-specific event subscription, and waits for the result.
- `NodeHubClient.command("session.send_input", payload, sessionId, { timeoutMs })` is the direct path.

For `run.start` and `session.send_input`, Cline's default Hub **command timeout is `null`**; long model turns are not failed by the normal 30-second command timeout. Runtime-level timeout settings remain separate.

The server does not require the calling client to be recorded as a session participant before accepting the send command. Even so, the orchestrator should explicitly attach for shared-session semantics and visible participant provenance rather than relying on that permissive behavior.

### Abort versus detach

These operations must remain separate in the orchestrator design.

**Abort the active run:**

```ts
await client.command("run.abort", { sessionId, reason }, sessionId);
```

Convenience equivalents:

- `HubSessionClient.abortRuntimeSession(sessionId)`;
- `HubRuntimeHost.abort(sessionId, reason)`.

`run.abort` cancels pending approvals/capability requests for the session and asks the runtime host to abort the active work. The handler returns `{ applied: true }`.

**Detach this client from the session:**

```ts
await client.command("session.detach", { sessionId }, sessionId);
```

Convenience equivalents:

- `HubSessionClient.stopRuntimeSession(sessionId)`;
- `HubRuntimeHost.stopSession(sessionId)`.

`session.detach` removes the calling Hub client from the session participant set and cancels pending capability requests targeted to that client. It does **not** mean "abort the run" and it does not delete the session.

This distinction maps well to the orchestrator: user/task abort should call `run.abort`; orchestrator shutdown or intentional release of observation/control should detach.

### Session and run event streams

`NodeHubClient.subscribe(listener, { sessionId? })` is the complete client-side event primitive.

When a subscription becomes active it sends a `stream.subscribe` frame. Session-specific subscriptions filter by `sessionId`; a global subscription receives all Hub events. The client tracks the highest durable Hub event `sequence` per subscription key and supplies `sinceSequence` when re-subscribing after reconnect, allowing durable event-log replay where the Hub supports it.

Relevant raw event families include:

- lifecycle: `session.created`, `session.updated`, `session.attached`, `session.detached`;
- runs: `run.started`, `run.heartbeat`, `run.aborted`, `run.completed`, `run.failed`, `run.interrupted`;
- model loop: `iteration.started`, `iteration.finished`;
- output: `assistant.delta`, `assistant.media`, `assistant.finished`, reasoning events and notices;
- usage: `usage.updated`;
- tools: `tool.started`, `tool.updated`, `tool.finished`;
- human/capability flow: `approval.requested`, `approval.resolved`, `capability.requested`, `capability.resolved`.

`HubSessionClient.streamEvents()` deliberately maps only a subset into its `HubStreamEvent` vocabulary: iteration start/end, assistant text/media, usage, notices, tool start/update/end, approval requested, and run aborted/failed/completed (plus schedule terminal events). It does **not** expose session lifecycle events, `run.started`, or `run.heartbeat` through that normalized stream.

`HubUIClient.subscribeUI()` covers client registration/disconnection and session created/updated/detached lifecycle events, but not the complete runtime stream.

`HubRuntimeHost` subscribes per session and translates raw Hub events into the Core `RuntimeHost` / `CoreSessionEvent` model used by higher-level Cline code. This is useful reference behavior for preserving our existing watchdog, metrics, and streaming semantics.

### Recommended first adapter boundary

The current `ClineRunner` consumes a small effective subset of `ClineCore`: create/start an interactive session, send input by session ID, abort by session ID, receive streamed Core-style events, and dispose.

The pinned Hub source suggests the least risky migration path is:

```text
ClineRunner
    |
    v
Orchestrator Hub adapter
    |
    +-- one authenticated NodeHubClient
    |      - list/get
    |      - stream.subscribe
    |      - session.attach
    |      - session.send_input
    |      - run.abort
    |      - session.detach
    |
    +-- event normalization modeled on HubRuntimeHost
```

Do **not** create one `HubRuntimeHost` plus a separate `NodeHubClient` merely to gain `session.attach`; that would register two different Hub client identities and make participant/capability ownership harder to reason about.

The first proof should keep one native Hub client identity, subscribe before attach, attach explicitly, then control and observe the same session ID that VS Code sees. The adapter can normalize raw Hub events into the event shape already consumed by `ClineRunner`, using `HubRuntimeHost` as the pinned reference implementation.

### Session-control conclusions

1. `NodeHubClient` is the only public facade we need for a **single-identity attach/control/event** proof.
2. `session.attach` is explicit and should be used; `get` or `subscribe` alone is not attachment.
3. Subscribe before attach, following Cline's own VS Code example.
4. `session.send_input` / `run.start` target the existing session by ID and are long-running commands with no default command timeout.
5. `run.abort` and `session.detach` have different meanings and must never be conflated.
6. Raw `NodeHubClient.subscribe()` is required if we need complete lifecycle + run/watchdog evidence; `HubSessionClient.streamEvents()` alone is incomplete for orchestration supervision.
7. `HubRuntimeHost` is an important compatibility/reference implementation for event normalization and the RuntimeHost contract, but the first attach-only proof should avoid a second Hub client identity.
8. Session selection remains unresolved until workspace/session identity is analyzed in the next spike unit.

### Pinned upstream evidence for session control

Inspected at `cline/cline` tag `sdk/sdk/v0.0.83`:

- `sdk/packages/shared/src/hub.ts`
- `sdk/packages/core/src/hub/client/index.ts`
- `sdk/packages/core/src/hub/client/session-client.ts`
- `sdk/packages/core/src/hub/client/ui-client.ts`
- `sdk/packages/core/src/hub/runtime-host/hub-runtime-host.ts`
- `sdk/packages/core/src/hub/server/handlers/session-handlers.ts`
- `sdk/packages/core/src/hub/server/handlers/run-handlers.ts`
- `apps/examples/vscode/src/extension.ts`
- current orchestrator `src/cline-runner.ts`

## Pinned upstream evidence for discovery/authentication

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

- workspace/session identity and multi-client approval/tool-executor behavior;
- migration design from the orchestrator-owned `ClineCore` runtime to shared Hub attachment.