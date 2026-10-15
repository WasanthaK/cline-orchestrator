# M19C1 — Native local model connection preflight (read-only)

Status: **implementation candidate**. Target: `milestone-13/delegation` via independent review PR.

The installed Windows launcher now offers a **Connect local model** dialog. It guides the user through provider selection, model ID and a local HTTP `/v1` endpoint (default `http://127.0.0.1:8080/v1` for existing `llama.cpp` configurations). The user explicitly clicks **Check connection**.

The native dialog invokes the bundled Node CLI's new `check-provider <provider> <model> <url>` command, which reuses the existing `preflightProvider` metadata probe. Only literal `127.0.0.1` or `[::1]` HTTP URLs with an explicit port and exact `/v1` path are accepted. URL credentials, queries, fragments, remote hosts, redirects, model prompts, provider keys and arbitrary routes are not allowed. The result includes only bounded model identities and status codes: upstream errors, raw paths, network endpoints and credential material never reach the dialog.

The feature is **observation only**. No provider configuration is persisted, no daemon/model/task is started, and no workspace or Safety authority is created. The model-check child is bounded and stopped on failure/timeout; it cannot kill another process. The existing browser viewer stays read-only.

## Verification

- New unit tests exercise model discovery, missing model, malformed/remote/credential-bearing URLs, redirect refusal, and sanitized error behavior.
- Installed-package acceptance refuses a remote `check-provider` request.
- Windows self-contained launcher compile and NSIS installer build use the existing dedicated installer acceptance workflow. The dialog is native, not a browser mutation route.

## Next slice — M19C2

Create a separate **trusted, explicitly confirmed** native setup bridge to existing `runConfigWriteSetup` and `runRegistrationSetup` services, first for create-only provider configuration, then project/workspace/Safety registration. Security acceptance must address reviewing exact destination and contents, expiry, one-shot confirmation, cancel/replay, file/symlink conflicts and preservation of externally owned state. Do not hide these behind an optimistic Save button or expose browser mutation routes without Origin/CSRF/session review.

M18D persistent service and M18F release remain gated; this change alone is not a full configuration wizard or signed distributable.
