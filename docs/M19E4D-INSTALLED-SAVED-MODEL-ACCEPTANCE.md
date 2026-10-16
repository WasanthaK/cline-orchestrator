# M19E4D — Installed saved-model inference acceptance

The native **Edit saved model** screen offers **Test saved model** only for
the exact saved provider/model/loopback URL loaded from fixed local user state.
The compiled CLI rechecks the saved configuration revision and file identity
before and after a bounded harmless inference request, refusing stale or
unsafe settings.

A hosted, disposable Windows acceptance step executes the **installed
Node/product CLI** with a synthetic loopback model. It verifies valid
receipt fields, one fixed bounded prompt, no raw response or model details in
the receipt, no configuration changes or new files, refusal of stale
revisions before any network request, and refusal of remote targets.
This installed acceptance is separate from source unit tests.

This is **not** a real llama.cpp pilot: it does not start a model, Cline task,
daemon or service. Neither automated evidence nor a synthetic reply can pass
M19E4A's separately approved real Cline task and human review gate. The
Windows candidate remains unsigned and unmerged, and no operator-machine
installation, upgrade or release is authorized.
