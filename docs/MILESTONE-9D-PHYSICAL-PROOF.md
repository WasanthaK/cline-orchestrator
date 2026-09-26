# Milestone 9D — Disposable Physical Proof

This procedure checks the real pinned Cline Hub runtime while confining writes to
temporary Git repositories. It does not enable shared runtime concurrency or
change the operator's registered projects.

## Review before execution

- Use a machine with Node.js 22+, Git, installed dependencies (`npm install`),
  and a locally configured provider/model that has already passed the normal
  provider preflight. The proof uses the worker selected by `ORCH_PROVIDER`,
  `ORCH_MODEL`, `ORCH_BASE_URL`, and the other `ORCH_*` worker settings.
- Keep the user's shared Cline/Hub/VS Code process and workspaces untouched.
  The harness creates separate temporary Cline data, a separate loopback Hub
  port, an isolated registry, and disposable Git repositories.
- The master plan requires explicit user authorization immediately before any
  proof that would mutate or restart the shared local runtime. This procedure
  does not authorize such a proof.
- Do not put secrets in the model prompt or the proof output. The `.env` file
  in each disposable repository contains only a fixed synthetic sentinel.

## Run the isolated checks

First run `npm run typecheck` and `npm test`. Then, after choosing an available
local worker and deliberately opting into the disposable live proof:

For a `llama.cpp` server listening on `127.0.0.1:8080` with alias
`qwen38-27b-192k`, configure the repository's OpenAI-compatible worker in
PowerShell and check the server's reported model ID:

```powershell
$env:ORCH_PROVIDER = "ollama-openai"
$env:ORCH_BASE_URL = "http://127.0.0.1:8080"
$env:ORCH_MODEL = "qwen38-27b-192k"
(Invoke-RestMethod http://127.0.0.1:8080/v1/models).data.id
```

The reported ID must match `ORCH_MODEL`. The `ollama-openai` setting selects
the orchestrator's OpenAI-compatible provider and appends `/v1` to this base
URL. It does not start, stop, or reconfigure the model server.

```bash
ORCH_LIVE_PROOF_OPT_IN=CONFIRMED_DISPOSABLE_ONLY npm run proof:multi-workspace
ORCH_LIVE_PROOF_OPT_IN=CONFIRMED_DISPOSABLE_ONLY npm run proof:scheduled-restart
ORCH_LIVE_PROOF_OPT_IN=CONFIRMED_DISPOSABLE_ONLY npm run proof:owner-loss
```

PowerShell:

```powershell
$env:ORCH_LIVE_PROOF_OPT_IN = "CONFIRMED_DISPOSABLE_ONLY"
npm run proof:multi-workspace
npm run proof:scheduled-restart
npm run proof:owner-loss
Remove-Item Env:ORCH_LIVE_PROOF_OPT_IN
```

For a quieter terminal, save one proof's complete output and show its last
lines, including the exit code:

```powershell
$log = Join-Path $PWD "multi-workspace-proof.log"
npm run proof:multi-workspace *> $log
$proofExitCode = $LASTEXITCODE
Get-Content $log -Tail 60
"Proof exit code: $proofExitCode"
```

A zero exit code and the `"passed": true` result are both required. If
cleanup also fails, the final error includes the original proof failure.

The first command must print `"proof": "disposable-multi-workspace"` and
`"passed": true`. Its `parallel` evidence must show two simultaneous distinct
workspace leases, `overlappingHubSendsObserved: true`, distinct owner sessions,
passed validation and diff safety, and both rollbacks. It also checks that a
same-workspace competitor receives no runtime authority, that forced lease loss
aborts only its worker, and that the captured stale editor cannot write.

The scheduled restart command creates a real isolated Hub owner session,
interrupts only its proof-owned gateway child, waits for the old fence to
expire, and uses the scheduled restart reconciler to create a replacement
owner. Its output must show `"proof": "disposable-scheduled-gateway-restart"`,
`"passed": true`, a rejected old fence, a fresh owner session, validation,
diff safety and rollback.

The owner-loss command separately proves replacement session recovery,
validation, diff safety, and rollback through the machine service.

If a command fails, retain its error output and report whether a disposable
Hub/data directory was preserved. The harness intentionally refuses to delete
the isolated roots if it cannot confirm graceful Hub shutdown. Never use a
generic process kill against a shared Cline or Hub process to clean up a proof.

## Completion gate

Do not mark 9D complete or enable shared live runtime concurrency until all
three physical commands pass with reviewable evidence. Record the branch
HEAD, command output, provider/model identifier, and relevant CI run in the
master plan without recording Hub credentials or local secrets.

## 2026-09-26 Windows disposable proof evidence

- Code HEAD: `3fd26d6c05df701e5adfaf5a1cdf14abc85ae48b` on
  `phase-1/bootstrap`. Provider: local `llama.cpp` OpenAI-compatible server
  (`ORCH_PROVIDER=ollama-openai`, `ORCH_BASE_URL=http://127.0.0.1:8080`,
  `ORCH_MODEL=qwen38-27b-192k`). The user supplied the PowerShell output;
  each command ended with `$LASTEXITCODE = 0` after the JSON result.
- `proof:multi-workspace`: `passed: true`; two simultaneous distinct leases,
  overlapping Hub sends and distinct owner sessions; both tasks passed
  validation/diff safety and rolled back. The same-workspace competitor had
  no runtime authority. Forced lease loss left the faulted task `aborted`,
  blocked its stale write and allowed the healthy task to complete and roll
  back. Log: `orchestrator-multi-workspace-proof.log` in the operator's TEMP.
- `proof:scheduled-restart`: `passed: true`, task
  `bbcfe362-7f78-47f9-93ab-b7edcbaa6682`; old fence rejected, new owner
  session, checkpoint preserved, validation/diff safety passed and rollback
  completed. Log: `orchestrator-scheduled-restart-proof.log` in TEMP.
- `proof:owner-loss`: replacement owner completed with run count and session
  generation moving from 1 to 2, recovery count 1, validation/diff safety
  passed, and exact pre-proof contents restored by rollback. Log:
  `orchestrator-owner-loss-proof.log` in TEMP.
- CI `#666` (`36222404791`) on this code HEAD failed one test due to its
  rollback call racing with the workspace's transition to idle. The test
  now waits for the public idle state; local typecheck and 268 tests pass.
  Branch-head CI `#668` (`36226493586`) on
  `14e9991bd4312e51cbb02beb5403326d9d3fe522` completed successfully.
  The three disposable proof commands and the CI gate are complete. Shared
  runtime concurrency remains disabled pending separate authorization/review.
