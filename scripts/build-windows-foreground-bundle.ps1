param(
    [Parameter(Mandatory = $true)] [string] $OutputDirectory,
    [switch] $Installer
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'M19B packaging is Windows only.' }
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$nodeVersion = '22.23.3'
$nodeSha256 = '9c9245166b4a8e182e0b797da9c20136117ff24368eaff1fec8343a123c8db0e'
$target = [System.IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $target) { throw 'Output already exists; choose a new location.' }
$parent = Split-Path -Parent $target
if (!(Test-Path -LiteralPath $parent -PathType Container)) { throw 'Output parent must exist.' }
$work = Join-Path $env:TEMP ('cline-m19b-' + [guid]::NewGuid().ToString('N'))
$bundle = Join-Path $target 'ClineOrchestrator'
$archive = Join-Path $target 'ClineOrchestrator-win-x64-portable.zip'
$artifact = Join-Path $target 'ClineOrchestrator-Setup-unsigned.exe'
New-Item -ItemType Directory -Path $target, $work, $bundle -ErrorAction Stop | Out-Null
try {
    $runtime = Join-Path $bundle 'runtime'
    $application = Join-Path $bundle 'app'
    $launcher = Join-Path $bundle 'launcher'
    New-Item -ItemType Directory -Path $runtime, $application, $launcher -ErrorAction Stop | Out-Null

    $nodeBin = Join-Path $runtime 'node.exe'
    $uri = "https://nodejs.org/dist/v$nodeVersion/win-x64/node.exe"
    Invoke-WebRequest -Uri $uri -OutFile $nodeBin -MaximumRedirection 2 -ErrorAction Stop
    if ((Get-FileHash -Algorithm SHA256 -LiteralPath $nodeBin).Hash.ToLowerInvariant() -ne $nodeSha256) {
        throw 'Pinned Node runtime integrity check failed.'
    }
    $reported = & $nodeBin --version
    if ($LASTEXITCODE -ne 0 -or $reported.Trim() -ne "v$nodeVersion") {
        throw 'Pinned Node binary failed version verification.'
    }

    Push-Location $root
    try {
        & npm ci --ignore-scripts --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'Source dependency installation failed.' }
        & npm run build
        if ($LASTEXITCODE -ne 0) { throw 'Runtime build failed.' }
        $tgz = Join-Path $work 'cline-orchestrator-0.1.0.tgz'
        & npm pack --ignore-scripts --pack-destination $work
        if ($LASTEXITCODE -ne 0 -or !(Test-Path -LiteralPath $tgz)) { throw 'Private package was not built.' }
    } finally { Pop-Location }

    & npm install --prefix $application --ignore-scripts --no-audit --no-fund --omit=dev $tgz
    if ($LASTEXITCODE -ne 0) { throw 'Consumer runtime dependency installation failed.' }

    $source = Join-Path $root 'native\windows-launcher\ClineOrchestrator.csproj'
    & dotnet publish $source --configuration Release --runtime win-x64 --self-contained true -p:PublishSingleFile=true -p:DebugType=None --output $launcher
    if ($LASTEXITCODE -ne 0) { throw 'Native launcher publish failed.' }

    $launcherFile = Join-Path $launcher 'ClineOrchestrator.exe'
    $entry = Join-Path $application 'node_modules\cline-orchestrator\dist\product-cli.js'
    if (!(Test-Path -LiteralPath $launcherFile) -or !(Test-Path -LiteralPath $entry)) {
        throw 'Installed launcher or runtime entry is missing.'
    }

    $revision = (& git -C $root rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0 -or $revision -notmatch '^[a-f0-9]{40}$') {
        throw 'Exact source revision required.'
    }
    $manifest = [ordered]@{
        schemaVersion = 1
        product = 'Cline Orchestrator'
        distribution = 'unsigned-windows-foreground-preview'
        sourceCommit = $revision
        nodeVersion = $nodeVersion
        appVersion = '0.1.0'
        serviceInstalled = $false
        providerLaunched = $false
        grantsAuthority = $false
        sha256 = [ordered]@{
            'runtime/node.exe' = (Get-FileHash -LiteralPath $nodeBin -Algorithm SHA256).Hash.ToLowerInvariant()
            'launcher/ClineOrchestrator.exe' = (Get-FileHash -LiteralPath $launcherFile -Algorithm SHA256).Hash.ToLowerInvariant()
            'app/node_modules/cline-orchestrator/dist/product-cli.js' = (Get-FileHash -LiteralPath $entry -Algorithm SHA256).Hash.ToLowerInvariant()
        }
    }
    [System.IO.File]::WriteAllText((Join-Path $application 'product-manifest.json'),
        ($manifest | ConvertTo-Json -Depth 6), [System.Text.UTF8Encoding]::new($false))

    $allFiles = @(Get-ChildItem -LiteralPath $bundle -File -Recurse)
    $allDirectories = @(Get-ChildItem -LiteralPath $bundle -Directory -Recurse)
    $safeName = '^[A-Za-z0-9._ @()+\-]+$'
    $relative = {
        param([string] $full)
        $name = $full.Substring($bundle.Length + 1).Replace('/', '\')
        foreach ($component in ($name -split '\\')) {
            if ($component -notmatch $safeName -or $component -eq '.' -or $component -eq '..' -or $component.EndsWith(' ') -or $component.EndsWith('.')) {
                throw 'Unsupported package path; refuse installation.'
            }
        }
        return $name
    }
    $deleteLines = [System.Collections.Generic.List[string]]::new()
    foreach ($file in $allFiles) {
        if (($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Package symlink forbidden.' }
        $name = & $relative $file.FullName
        $deleteLines.Add(('  Delete "$INSTDIR\{0}"' -f $name))
    }
    foreach ($dir in ($allDirectories | Sort-Object { $_.FullName.Length } -Descending)) {
        if (($dir.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Package symlink forbidden.' }
        $name = & $relative $dir.FullName
        $deleteLines.Add(('  RMDir "$INSTDIR\{0}"' -f $name))
    }
    $uninstallInclude = Join-Path $work 'payload-uninstall.nsh'
    [System.IO.File]::WriteAllLines($uninstallInclude, $deleteLines.ToArray(),
        [System.Text.UTF8Encoding]::new($false))
    Compress-Archive -Path (Join-Path $bundle '*') -DestinationPath $archive -CompressionLevel Optimal
    if ($Installer) {
        $nsisCmd = Get-Command makensis.exe -ErrorAction SilentlyContinue
        $makensis = if ($nsisCmd) { $nsisCmd.Source } else { 'C:\Program Files (x86)\NSIS\makensis.exe' }
        if (!(Test-Path -LiteralPath $makensis)) { throw 'NSIS 3 makensis.exe required.' }
        $nsisScript = Join-Path $root 'native\windows-installer\ClineOrchestrator.nsi'
        & $makensis "/DBUNDLE_DIR=$bundle" "/DOUTPUT_EXE=$artifact" "/DUNINSTALL_INCLUDE=$uninstallInclude" $nsisScript
        if ($LASTEXITCODE -ne 0 -or !(Test-Path -LiteralPath $artifact)) {
            throw 'Windows installer compilation failed.'
        }
    }
    $report = [ordered]@{
        sourceCommit = $revision
        nodeVersion = $nodeVersion
        filesInBundle = $allFiles.Count
        installerBuilt = [bool]$Installer
        portableZipSha256 = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
        serviceInstalled = $false
        configModified = $false
        taskLaunched = $false
    }
    if ($Installer) {
        $report['installerSha256'] = (Get-FileHash -LiteralPath $artifact -Algorithm SHA256).Hash.ToLowerInvariant()
    }
    [System.IO.File]::WriteAllText((Join-Path $target 'BUILD-EVIDENCE.json'),
        ($report | ConvertTo-Json -Depth 4), [System.Text.UTF8Encoding]::new($false))
    Write-Output ($report | ConvertTo-Json -Depth 4)
} catch {
    Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction SilentlyContinue
    throw
} finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
