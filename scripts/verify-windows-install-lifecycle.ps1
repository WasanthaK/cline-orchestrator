# M19E3A — disposable Windows CI lifecycle, never operator-machine use.
param(
  [Parameter(Mandatory=$true)]
  [ValidateSet('BeforeInstall','AfterInstall','AfterUninstall')]
  [string]$Phase,
  [Parameter(Mandatory=$true)][string]$InstallerPath,
  [Parameter(Mandatory=$true)][string]$InstallPrefix
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT' -or $env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
  throw 'Requires disposable GitHub-hosted Windows acceptance'
}
if (!(Test-Path -LiteralPath $InstallerPath -PathType Leaf)) { throw 'Review installer missing' }
$installer = (Resolve-Path -LiteralPath $InstallerPath).Path
$expectedPrefix = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Programs\ClineOrchestrator'))
$prefix = [IO.Path]::GetFullPath($InstallPrefix)
if ($prefix -ne $expectedPrefix) { throw 'Unexpected installation prefix' }
$userRoot = Join-Path $env:LOCALAPPDATA 'ClineOrchestrator'
$receiptPath = Join-Path $env:RUNNER_TEMP 'm19e3-lifecycle-receipt.json'
$files = @('config.json','workspace-registry.json','secrets\provider.ref','history\tasks.json')

function Hash-File([string]$file) {
  if (!(Test-Path -LiteralPath $file -PathType Leaf)) { throw 'Protected file missing' }
  return (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
}
function Verify-State {
  if (!(Test-Path -LiteralPath $receiptPath -PathType Leaf)) { throw 'Lifecycle receipt missing' }
  $receipt = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
  if ($receipt.schemaVersion -ne 1 -or $receipt.grantsAuthority -ne $false) { throw 'Invalid receipt' }
  foreach ($rel in $files) {
    $entry = $receipt.hashes.PSObject.Properties[$rel]
    if ($null -eq $entry) { throw 'Missing protected state digest' }
    if ((Hash-File (Join-Path $userRoot $rel)) -ne $entry.Value) {
      throw 'Installer lifecycle modified user-owned state'
    }
  }
}
function Run-RefusedInstaller {
  $p = Start-Process -FilePath $installer -ArgumentList '/S' -PassThru -WindowStyle Hidden
  try {
    if (!$p.WaitForExit(45000)) {
      $p.Kill()
      throw 'Occupied-target installer did not terminate'
    }
    if ($p.ExitCode -eq 0) { throw 'Installer accepted occupied target' }
  } finally { $p.Dispose() }
}
function Installed-Hashes {
  $manifestPath = Join-Path $prefix 'app\product-manifest.json'
  if (!(Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw 'Missing installed manifest' }
  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  if ($manifest.schemaVersion -ne 1 -or $manifest.grantsAuthority -ne $false -or $manifest.serviceInstalled -ne $false) {
    throw 'Unexpected authority in installed manifest'
  }
  $hashes = [ordered]@{}
  foreach ($rel in @('runtime\node.exe','launcher\ClineOrchestrator.exe','app\node_modules\cline-orchestrator\dist\product-cli.js')) {
    $actual = Hash-File (Join-Path $prefix $rel)
    $key = $rel.Replace('\','/')
    $declared = $manifest.sha256.PSObject.Properties[$key]
    if ($null -eq $declared -or $declared.Value -ne $actual) { throw 'Installed product manifest hash mismatch' }
    $hashes[$key] = $actual
  }
  return $hashes
}
switch ($Phase) {
  'BeforeInstall' {
    if (Test-Path -LiteralPath $receiptPath) { throw 'Existing lifecycle receipt cannot be replaced' }
    if (Test-Path -LiteralPath $userRoot) { throw 'Existing user data; refuse setup on nonempty runner' }
    if (Test-Path -LiteralPath $prefix) { throw 'Installer target must be absent' }
    New-Item -ItemType Directory -Path $prefix -ErrorAction Stop | Out-Null
    $marker = Join-Path $prefix 'not-product-owned.marker'
    try {
      [IO.File]::WriteAllText($marker,'M19E3_UNOWNED_SENTINEL')
      $original = Hash-File $marker
      Run-RefusedInstaller
      if ((Hash-File $marker) -ne $original) { throw 'Occupied-target sentinel changed' }
      if (Test-Path -LiteralPath (Join-Path $prefix 'launcher\ClineOrchestrator.exe')) { throw 'Installer overwrote occupied target' }
      if (Test-Path -LiteralPath (Join-Path $prefix 'Uninstall.exe')) { throw 'Installer registered uninstaller on refusal' }
    } finally {
      if (Test-Path -LiteralPath $marker -PathType Leaf) { Remove-Item -LiteralPath $marker -Force }
      if (Test-Path -LiteralPath $prefix -PathType Container) {
        if (@(Get-ChildItem -LiteralPath $prefix -Force).Count -ne 0) { throw 'Installer left unauthorized files in occupied target' }
        Remove-Item -LiteralPath $prefix
      }
    }
    $payloads = @(
      '{"schemaVersion":1,"provider":"PRESERVE_CONFIG"}',
      '{"schemaVersion":1,"projects":[],"workspaces":[],"preserve":"REGISTRY"}',
      'NON_SECRET_REFERENCE_PRESERVE',
      '{"events":[{"type":"PRESERVE_TASK_HISTORY"}]}'
    )
    $hashes = [ordered]@{}
    for ($i=0; $i -lt $files.Count; $i++) {
      $full = Join-Path $userRoot $files[$i]
      New-Item -ItemType Directory -Path (Split-Path -Parent $full) -Force | Out-Null
      [IO.File]::WriteAllText($full,$payloads[$i],[Text.UTF8Encoding]::new($false))
      $hashes[$files[$i]] = Hash-File $full
    }
    $receipt = [ordered]@{schemaVersion=1;hashes=$hashes;grantsAuthority=$false}
    [IO.File]::WriteAllText($receiptPath,($receipt | ConvertTo-Json -Depth 4),[Text.UTF8Encoding]::new($false))
    Verify-State
  }
  'AfterInstall' {
    Verify-State
    $before = Installed-Hashes
    Run-RefusedInstaller
    $after = Installed-Hashes
    foreach ($key in $before.Keys) {
      if ($before[$key] -ne $after[$key]) { throw 'Second installer modified installed binary' }
    }
    Verify-State
  }
  'AfterUninstall' {
    Verify-State
    foreach ($rel in @('runtime\node.exe','launcher\ClineOrchestrator.exe','app\node_modules\cline-orchestrator\dist\product-cli.js','Uninstall.exe')) {
      if (Test-Path -LiteralPath (Join-Path $prefix $rel)) { throw 'Uninstaller retained product executable' }
    }
  }
}
[ordered]@{
 schemaVersion=1;phase=$Phase;userStateProtected=$true;overwriteRefused=$true
 upgradeSupported=$false;binaryRollbackImplemented=$false;workstationInstall=$false
 signed=$false;releaseAuthorized=$false;grantsAuthority=$false
} | ConvertTo-Json -Compress
