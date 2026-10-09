$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_OS -ne 'Windows' -or $env:ORCH_TEMP_SCM_PROOF -ne 'I_AUTHORIZE_GITHUB_HOSTED_SCM') { throw 'Only explicitly opted-in GitHub hosted Windows runner is supported' }
$name = 'cline-orchestrator'
$serviceKey = "HKLM:\SYSTEM\CurrentControlSet\Services\$name"
if (Get-Service -Name $name -ErrorAction SilentlyContinue) { throw 'Service name conflict; refusing to alter existing service' }
$hostExe = (Resolve-Path 'native/windows-scm-host/bin/Release/net8.0-windows/WindowsScmHost.exe').Path
$entry = (Resolve-Path 'dist/index.js').Path
$node = (Get-Command node.exe).Source
$workspace = Join-Path $env:RUNNER_TEMP 'cline-orch-scm-workspace'
New-Item -ItemType Directory -Force $workspace | Out-Null
$registered = $false
try {
  & sc.exe create $name "binPath= `"$hostExe`"" 'start= demand' 'type= own'
  if ($LASTEXITCODE -ne 0) { throw 'SCM create failed' }
  $registered = $true
  New-ItemProperty -Path $serviceKey -Name Environment -PropertyType MultiString -Value @(
    "ORCH_SERVICE_NODE=$node",
    "ORCH_SERVICE_ENTRY=$entry",
    "ORCH_SERVICE_WORKSPACE=$workspace"
  ) -Force | Out-Null
  & sc.exe start $name
  if ($LASTEXITCODE -ne 0) { throw 'SCM start failed' }
  $running = $false
  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Seconds 1
    $s = Get-Service -Name $name -ErrorAction Stop
    if ($s.Status -eq 'Running') { $running = $true; break }
    if ($s.Status -eq 'Stopped') { break }
  }
  if (-not $running) { throw 'SCM never reached Running' }
  & sc.exe query $name
  & sc.exe stop $name
  if ($LASTEXITCODE -ne 0) { throw 'SCM stop failed' }
  $stopped = $false
  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Seconds 1
    if ((Get-Service -Name $name).Status -eq 'Stopped') { $stopped = $true; break }
  }
  if (-not $stopped) { throw 'SCM did not stop' }
  Write-Output 'PASS: real Windows SCM create/start/query/stop (removal in finally)'
}
finally {
  if ($registered) {
    try {
      $s = Get-Service -Name $name -ErrorAction SilentlyContinue
      if ($s -and $s.Status -ne 'Stopped') { & sc.exe stop $name | Out-Null; Start-Sleep -Seconds 3 }
    } catch { Write-Warning 'Failed to stop temporary service during cleanup' }
    & sc.exe delete $name
    if ($LASTEXITCODE -ne 0) { Write-Warning 'Temporary SCM delete failed' }
  }
  Remove-Item -LiteralPath $workspace -Recurse -Force -ErrorAction SilentlyContinue
}
