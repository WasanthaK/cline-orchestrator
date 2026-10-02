# Milestone 10 local operator control

The MCP gateway can optionally serve a separate browser page for one bounded action: reject a pending safety escalation and close its task. The page calls the existing machine service. The service rechecks the pending escalation and writes its durable decision event. Other task and workflow actions are not exposed here.

## Start on the operator's PC

The page is off by default. Configure a separate random browser token before starting the gateway in PowerShell:

```powershell
$env:ORCH_OPERATOR_TOKEN = & node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))"
$env:ORCH_OPERATOR_PORT = '4320' # optional; must differ from ORCH_MCP_PORT
npm run mcp
```

The MCP gateway still requires its existing `ORCH_MCP_BEARER_TOKEN` and other normal configuration. Open `http://127.0.0.1:4320/operator` on the same PC and enter the operator token. Keep that token in the local process environment; do not paste it into a task, log, screenshot or remote tunnel. The page is bound only to `127.0.0.1`, on a separate port from the MCP gateway. Do not forward or proxy the browser port.

## Reject an escalation

Enter the task ID, select **Review rejection**, and check the task and workspace IDs on the confirmation page. Select **Reject escalation and close task** within 60 seconds. The confirmation is single-use, tied to the signed-in browser session and the current task and safety snapshot. A changed task, expired preview or replay is refused; refresh and review again if needed. Sign out when finished. Browser sessions expire after 15 minutes.

The page never renders the task goal, escalation reason, credentials or raw worker output. It requires a local origin, a separate operator token, an HttpOnly session cookie, a CSRF value and a final explicit confirmation. The passive operator visualization remains available as before; this optional page does not enable shared live-runtime concurrency.
