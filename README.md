# Cline Orchestrator

Cline Orchestrator is a local-first supervisory layer for running long-lived Cline engineering work with durable task state, explicit workspace/Safety authority, validation, recovery, review, multi-agent delegation, Git delivery controls, and production-readiness checks.

The product is designed so that planning, observation, health, setup guidance and review do **not** silently become execution authority. Workspace write scope, runtime execution, remote transport, Git delivery, merge and deployment remain separately governed capabilities.

## Requirements

- Node.js 22+
- `npm install`
- a supported Cline model/provider
- at least one explicitly registered project/workspace before governed task execution

The packaged CLI is exposed as:

```text
cline-orchestrator
```

During development you can run the same façade with:

```bash
npm run cli -- <command>
```

## First run

Start with a read-only diagnosis:

```bash
cline-orchestrator diagnose /path/to/workspace
```

This checks the current runtime, provider/model readiness, workspace registration/Safety setup, and daemon state. It does not write configuration, register a workspace, start a service, open a listener, or grant authority.

See the setup plan without performing any mutation:

```bash
cline-orchestrator setup /path/to/workspace
```

The setup command is plan-only. Any later config write, project registration, workspace registration, or loopback-daemon start must pass through its own explicit, single-use confirmation boundary.

Inspect the resolved product configuration:

```bash
cline-orchestrator config
```

## Provider configuration

Product configuration is schema-versioned. Environment variables override file values, and absent values resolve through explicit defaults.

Select a JSON configuration file for product commands:

```bash
cline-orchestrator --config /path/to/product.json config
cline-orchestrator --config /path/to/product.json diagnose /path/to/workspace
cline-orchestrator --config /path/to/product.json setup /path/to/workspace
cline-orchestrator --config /path/to/product.json status /path/to/workspace
cline-orchestrator --config /path/to/product.json start /path/to/workspace
```

`ORCH_CONFIG_FILE` also selects the file; the leading `--config` option takes precedence. With no selector, the CLI reads no configuration file and uses environment values and defaults. Requested files must exist, contain valid schema-version-1 JSON and fit within 64 KiB. Invalid files fail even when environment values could override them. Errors do not print paths, file contents or underlying exceptions.

Example file:

```json
{
  "schemaVersion": 1,
  "provider": {
    "providerId": "ollama-openai",
    "modelId": "qwen38-27b-192k",
    "baseUrl": "http://127.0.0.1:8080/v1"
  },
  "daemon": { "host": "127.0.0.1", "port": 4317 }
}
```

Native observation commands and execution commands now use the same validated configuration. The CLI passes resolved provider/runtime/daemon settings to the existing dispatcher; it preserves existing diff-safety environment restrictions and removes stale raw-key, file-selector and output-token alias settings before dispatch. Task/workspace/Safety checks remain in the dispatcher.

Product daemon configuration supports loopback HTTP only. Embedded URL credentials, query strings, fragments and non-root daemon URL paths are rejected. Raw `ORCH_API_KEY` values are rejected by the product facade. The low-level developer dispatcher retains its existing compatibility path.

Current defaults:

```text
ORCH_PROVIDER=ollama-openai
ORCH_MODEL=qwen38-27b-192k:latest
ORCH_BASE_URL=http://localhost:11434
ORCH_DAEMON_HOST=127.0.0.1
ORCH_DAEMON_PORT=4317
```

Provider behavior:

- `ollama-openai` uses Cline's OpenAI-compatible provider path against an Ollama-compatible `/v1` endpoint.
- `ollama` uses Cline's native Ollama provider path.
- Other Cline provider IDs may be configured through the existing worker configuration path. If no metadata-only preflight exists for that provider, preflight reports that limitation rather than granting or denying broader authority.

Raw provider secrets are not part of the M17 product-config file. Use a named secret reference such as:

```text
ORCH_API_KEY_SECRET_REF=ORCH_PROVIDER_API_KEY
```

The product configuration stores the reference name, not the secret value.

For daemon start, provision the selected environment variable through your local secret-management process. The daemon child resolves exactly that name while assembling its in-memory provider configuration for the existing preflight/Cline consumers. Missing, empty, oversized or control-character-bearing values fail before startup. Observation and task-client commands do not resolve it. The key is not added to command arguments, product config files or credential-resolution diagnostics. Raw-key and self-referential names are rejected; credential lookup grants no task, workspace, filesystem or delivery authority.

## Workspace and Safety authority

A raw filesystem path is not sufficient to give ChatGPT, the planner, or Cline write authority.

Governed work is bound to an explicitly registered project/workspace and Safety profile. That binding carries the approved workspace identity, allowed/protected paths, validation commands, worker profile and policy revisions. Scope expansion and stale bindings fail closed.

The first-run diagnostic reports whether the workspace is registered and whether its Safety profile and validation commands are configured.

## Daemon and local surfaces

The product configuration is loopback-only by default:

```text
127.0.0.1:4317
```

Start the orchestrator daemon for a workspace:

```bash
cline-orchestrator start /path/to/workspace
```

Check daemon reachability:

```bash
cline-orchestrator status /path/to/workspace
```

The first-run/product config does not permit `0.0.0.0`, LAN, or public daemon binding. Remote/distributed transport, MCP, operator control and public bindings are separate capabilities with their own authentication, fencing and safety boundaries; product setup does not silently enable them.

## Task commands

Run a supervised task:

```bash
cline-orchestrator run /path/to/workspace "Inspect the authentication flow and propose the smallest safe change"
```

List tasks:

```bash
cline-orchestrator tasks /path/to/workspace
```

Inspect a task:

```bash
cline-orchestrator status /path/to/workspace <task-id>
```

Inspect events:

```bash
cline-orchestrator events /path/to/workspace <task-id>
```

Resume:

```bash
cline-orchestrator resume /path/to/workspace <task-id> "Continue with the approved bounded objective"
```

Abort:

```bash
cline-orchestrator abort /path/to/workspace <task-id> "operator requested stop"
```

Rollback to the authorized checkpoint:

```bash
cline-orchestrator rollback /path/to/workspace <task-id>
```

The packaged façade delegates task mutations to the existing authority-enforcing dispatcher rather than reimplementing those controls.

## Production readiness

Production-hardening checks cover security controls, durable/recovery/fencing health, observability and resource saturation. Readiness is observation-only.

Loss of a required control, stale evidence, corruption, observability blindness or hard resource saturation fails closed and surfaces sanitized operator evidence. Health/readiness status never becomes task, filesystem, credential, Git-delivery or deployment authority.

## Service lifecycle

M17 service packaging defines explicit lifecycle actions for supported local service managers:

- Windows Service
- systemd

Install, start and stop are explicit operations. Status is read-only. Service definitions remain loopback-only and use secret references rather than embedded secret material.

## Install/uninstall ownership

Installer manifests distinguish product-owned artifacts from user-owned data.

Product-owned examples:
- packaged binaries
- product service registrations

User-owned data preserved by default:
- product configuration
- workspace registry
- secret references/material managed outside the product package
- durable task/orchestration state

Default uninstall planning removes product-owned artifacts only. Destructive deletion of user-owned state is not implied by uninstall and would require a separate explicit confirmation path.

## Safety model

Important boundaries:

- Planner/model output is advisory until admitted through trusted authority boundaries.
- One writer may own a workspace at a time.
- Workspace/Safety drift invalidates execution authority.
- Remote sessions, distributed fencing and public bindings are separately authenticated and fail closed.
- Autonomous engineering-loop success does not authorize Git delivery.
- Commit, push, pull request, merge and deploy each require their own explicit, single-use delivery authority.
- Production readiness, alerts and operator status are observation-only.
- Installer/setup convenience is not an authority source.

## Developer compatibility

The original low-level dispatcher is retained for compatibility:

```bash
npm run dev -- daemon <workspace>
npm run dev -- run <workspace> <goal...>
npm run dev -- list <workspace>
npm run dev -- status <workspace> <task-id>
npm run dev -- events <workspace> <task-id>
npm run dev -- resume <workspace> <task-id> <prompt...>
npm run dev -- abort <workspace> <task-id> [reason...]
npm run dev -- rollback <workspace> <task-id>
```

The packaged CLI should be preferred for normal product use.

## Canonical development plan

The source of truth for current milestone status and security constraints is:

```text
docs/ORCHESTRATOR-MASTER-PLAN.md
```

Do not infer current authority or milestone status from older milestone/phase documents.
