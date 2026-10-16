# M19E4C — User-triggered native local inference probe

This source-integrated development slice adds **Test inference** to the
installed Windows local model connection form. It is only enabled after the
metadata checker verifies the selected literal-loopback model alias.

The native CLI command `test-local-inference` first reruns metadata
preflight, then sends a single, fixed harmless greeting request to
`/v1/chat/completions` with `max_tokens:12`, `temperature:0`,
`stream:false`, no credentials or redirects and a 20-second abort.
The response is limited to 8 KiB and only its bounded JSON shape and
nonempty assistant text are checked. Neither prompt content nor model
output is exposed in the CLI receipt or shown in the UI.

The user chooses the action. Metadata checking and configuration setup
continue to be **metadata-only unless the separate test button is
clicked**. No configuration, model process, task, daemon, registry,
workspace, browser or Windows service is started or modified by this probe.

The installed Windows CI smoke uses a **synthetic, disposable localhost
server** to demonstrate installed-CLI request scope, missing-alias refusal,
remote URL rejection, model-output redaction and zero user-state creation.
This deliberately does NOT attest a real llama.cpp response, independent
human pilot, task execution or M19E release acceptance.

The operator must still witness a real installed-model response, then
separately authorize one safe Cline task and verify task validation,
diff safety, task history, shutdown and preserved user state. PRs in the
M19 stack remain unmerged and the unsigned installer is not a release.
