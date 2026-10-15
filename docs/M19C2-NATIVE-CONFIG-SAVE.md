# M19C2A — Confirmed native model configuration save

Status: source implementation candidate. Prerequisite M19C1 model connection is merged at PR #52.

**User journey:** From the native Windows **Connect local model** screen, enter a literal loopback HTTP `/v1` model endpoint and press **Check connection**. A successful fresh check enables **Save verified settings**. Clicking Save creates the external user-owned directory `%LOCALAPPDATA%\\ClineOrchestrator` if necessary and invokes a separate installed Node command `setup-config-desktop`. This command rechecks the model against a metadata-only loopback endpoint, then obtains a 60-second, single-use confirmation from the existing `runConfigWriteSetup` service. A review message presents the exact provider/model/endpoint and the fixed `config.json` destination to the native UI; only an explicit user choice **Yes** submits `CREATE CONFIG` on private child-process stdin. No web endpoint or browser privileged route is added. Cancel sends `CANCEL`.

The resulting file contains provider ID, model ID, base URL, the safe loopback daemon host, and **disabled** automatic command/edit approvals. It contains **no raw API key**, token, task mandate, service installation or release authority. It is stored outside the installed app so uninstall preserves it. **Existing config files/symlinks cannot be replaced.** Setup failure does not auto-retry. Editing an existing config is a separate, future, revision-controlled settings flow.

**Important limitation:** Creating a config file does not automatically configure future task execution or start a model/daemon; the existing supervised task flow must explicitly load a selected config and get its normal authorization. M19C2B project/workspace registration and the unified first-run readiness screen remain outstanding.

Validation: unit tests for decline, successful create, existing-file/symlink refusal, local-only provider restrictions and no authority. Dedicated Windows installer CI builds the native GUI and verifies actual installed CLI in a synthetic loopback model test for create, cancel and replacement refusal. It **does not** execute any live model or task, or install a Windows service.

M18D persistent service acceptance, M18F signed release and M19E clean end-user machine review remain separate gates.
