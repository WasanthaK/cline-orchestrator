# M18E Windows managed-run exit diagnostics (experimental)

The real installed Windows/llama.cpp pilot at `c08e540` completed a bounded Cline task, persisted independent passing validation/diff-safety and released its single-writer lock, but the Node foreground process reportedly stayed alive without returning to PowerShell.

Issue: https://github.com/WasanthaK/cline-orchestrator/issues/47

The actual cause remains unknown. Source review confirms `MachineOrchestratorService.close()` awaits `ClineRunner.close()` and SDK `dispose()` before `runProductCli` prints its JSON receipt. SDK completion is **not proof of zero active Node handles**.

## Diagnostic (off by default)

For a future, explicitly authorized disposable `managed-run` test on a newly installed candidate:

```powershell
$env:ORCH_MANAGED_EXIT_DIAGNOSTICS = "1"
# Invoke the ordinary registered-workspace, TTY-confirmed managed-run command.
```

If the Node process remains alive for two seconds after the CLI receipt, it prints one `[managed-run exit diagnostic]` line to **stderr**, with a bounded count by Node active resource **type** (such as `Timeout` or `TCPWRAP`). No PID, file path, socket address, session token, prompt or credential value is collected. The timer calls `unref()`, so the diagnostic cannot hold the process open by itself.

An active resource type alone does not identify the leak or authorize termination. This diagnostic **does not fix** the issue, call `process.exit`, kill subprocesses, close runtime handles, mutate tasks or expand the existing Safety/browser authority.

The separate M18E acceptance gates for real task, safety and dashboard history have passed on the disposable pilot; clean native process exit **remains an open acceptance concern**, and M18D service-manager acceptance/M18F release remain separately gated.
