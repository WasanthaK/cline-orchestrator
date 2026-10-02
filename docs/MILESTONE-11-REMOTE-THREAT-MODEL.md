# Milestone 11 — Secure Remote ChatGPT Control Plane Threat Model

Status: Slice 11A contract; no remote listener implemented.

## Objective

Allow a remote ChatGPT control client to interact with the orchestrator without turning network connectivity into machine authority.

Remote access is **transport only**. It does not grant workspace authority, Safety Plan authority, human-confirmation authority, Hub/process/lease control, credentials, or release authority.

## Existing boundary that remains authoritative

Milestone 10 exposes a deliberately small operator capability set:

- `reject_escalation`
- `approve_escalation`
- `abort_task`
- `rollback_task`
- `continue_task`
- `resume_workflow`
- `recover_scheduled_writer`

Each mutating action uses its own bounded confirmation/service path. Reviewer output remains advisory. Standalone validation, generic process control, raw Hub control, lease management, credential access, shared-runtime control and release authority are intentionally absent.

Milestone 11 may project a subset of this capability set over a secure remote session. It must not manufacture a new operation or bypass an existing action-specific authority check.

## Protected assets

- registered machine/project/workspace identity;
- workspace canonical paths and local filesystem layout;
- approved Safety Plans and durable task envelopes;
- operator confirmation tokens;
- Cline Hub credentials/session ownership internals;
- provider/API credentials;
- writer lease/fence/owner internals;
- raw validation stdout/stderr and unrestricted commands;
- raw model prompts/output and sensitive project memory;
- release credentials and push/merge/deploy authority;
- shared local Cline/Hub/VS Code runtime state.

## Threat actors

1. An unauthenticated internet client probing a future remote endpoint.
2. A previously authorized remote client whose registration was revoked or reduced.
3. A valid remote client replaying an old request/session after expiry or reconnect.
4. A compromised remote client attempting to escalate from transport identity to task/machine authority.
5. Model-generated content attempting to self-register, self-confirm, broaden scope, admit commands, or obtain credentials.
6. A stale remote session surviving a local registration/capability revision.
7. A confused deputy using valid remote authentication to invoke an action on the wrong machine/task/workspace.

## Trust model

### Local registration is mandatory

A remote principal exists only after an explicit machine-local registration record is created. The registration binds:

- opaque `registrationId`;
- opaque `machineId`;
- opaque `remotePrincipalId`;
- monotonically increasing local registration revision;
- explicit subset of M10 mutation actions;
- explicit subset of read-only capabilities;
- local revocation state.

Remote content cannot create or broaden this registration.

### Short-lived session claims

A remote session is created from a current, non-revoked local registration. Session lifetime is bounded to at most 15 minutes in Slice 11A.

Claims bind the registration and revision and include only projected M10 capabilities. Claims explicitly state:

- `transportAuthority = authenticated_session_only`;
- `humanConfirmationAuthority = none`;
- `safetyPlanAuthority = none`;
- `credentialAuthority = none`;
- `releaseAuthority = none`.

The session must fail closed on expiry, revocation, registration revision change, principal/machine mismatch, or capability reduction.

### Transport authentication is not human approval

Remote authentication proves only which registered remote principal is speaking. It must never satisfy a local human-confirmation requirement by itself.

Safety Preview authorization and M10 action-specific confirmation remain separate capabilities. Future remote UX may carry a human-confirmation ceremony only after that ceremony is separately designed and tested; Slice 11A grants none.

### Task authority remains downstream

Even a valid remote session with a projected mutation capability still has to call the existing M10 action boundary. The underlying machine/workflow/recovery service independently revalidates current task, registry, Safety Plan, checkpoint, budget, lease and other applicable authority.

A remote session therefore cannot resurrect stale task authority after reconnect.

## Required controls before any remote listener

The first transport implementation must include all of the following before it may bind a non-loopback address or be placed behind an internet-facing relay:

- cryptographically strong authenticated session mechanism;
- short-lived credentials/claims;
- explicit local revocation;
- request replay protection using a nonce/idempotency mechanism;
- per-registration/session rate limiting;
- durable sanitized audit of authentication/session/action requests;
- exact machine/registration/session binding;
- capability projection from the M10 manifest only;
- bounded payload sizes;
- strict schema validation and unknown-field rejection;
- sanitized errors with no credentials, paths, Hub internals or raw task/model output;
- revalidation of current local registration on every mutating request;
- action-specific downstream authority checks unchanged;
- no storage or forwarding of Hub/provider credentials to the remote client.

## Reconnect and stale-session rule

Reconnect never resumes authority merely because the remote client presents an old session or remembers a task ID.

A new/current session must match the current local registration revision and current capability projection. Task actions then independently reload current durable task/registry/Safety Plan state.

Local revocation or capability reduction wins immediately over stale remote state.

## Data minimization

Remote responses should be based on already-sanitized public/operator views and opaque IDs.

Do not expose:

- canonical workspace roots;
- raw filesystem paths where aliases/opaque IDs suffice;
- Cline/Hub session IDs or credentials;
- provider/API keys;
- writer owner IDs, lease IDs or fence tokens;
- checkpoint backup paths/refs;
- raw validation stdout/stderr by default;
- unbounded task/model output;
- local environment variables;
- release/deployment credentials.

## Non-goals for Slice 11A

Slice 11A does **not**:

- open a network listener;
- create a tunnel or relay;
- implement OAuth, mTLS, WebSocket, SSE or remote MCP transport;
- let the remote client register itself;
- let remote authentication act as human confirmation;
- expose generic shell/filesystem/process/Hub/lease APIs;
- enable shared-runtime mutation;
- enable push/merge/deploy authority;
- enable native teams/subagents;
- make the single-gateway scheduler distributed.

## Slice 11A acceptance

- a machine-readable remote registration/session authority contract exists;
- session capabilities are a subset of locally registered M10 capabilities;
- sessions are short-lived and revocable;
- registration revision/capability reduction invalidates stale sessions;
- transport claims explicitly grant no human/Safety Plan/credential/release authority;
- replay protection, rate limiting and audit are mandatory requirements for the later transport slice;
- no listener or external network mutation is introduced.
