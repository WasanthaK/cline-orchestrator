# M19E5A: read-only Windows operator preflight. No install, extraction,
# model calls, task starts, settings writes, or service actions.
[CmdletBinding()]
param(
 [Parameter(Mandatory=$true)][string]$ArtifactDirectory,
 [Parameter(Mandatory=$true)][ValidatePattern('^[a-fA-F0-9]{40}$')][string]$ExpectedCommit,
 [string]$ArtifactArchivePath,
 [ValidatePattern('^$|^[a-fA-F0-9]{64}$')][string]$ExpectedArtifactArchiveSha256 = ''
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
function Guard([bool]$ok,[string]$code) {
 if (-not $ok) { throw "M19E5A preflight refused ($code). No installation or state changes." }
}
function HashFile([string]$p) {
 Guard (Test-Path -LiteralPath $p -PathType Leaf) 'missing_file'
 $item=Get-Item -LiteralPath $p -Force
 Guard (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) 'file_alias'
 return (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant()
}
function Evidence([string]$p) {
 Guard (Test-Path -LiteralPath $p -PathType Leaf) 'missing_evidence'
 $item=Get-Item -LiteralPath $p -Force
 Guard ($item.Length -gt 5 -and $item.Length -le 16777216) 'oversized_evidence'
 Guard (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) 'evidence_alias'
 return (Get-Content -LiteralPath $p -Raw -Encoding UTF8 | ConvertFrom-Json)
}
function SafeName([string]$name) {
 if ([string]::IsNullOrWhiteSpace($name) -or $name.Contains('\') -or $name.StartsWith('/')) {return $false}
 foreach ($part in ($name -split '/')) {
  if ($part -eq '' -or $part -eq '.' -or $part -eq '..' -or
      $part.EndsWith(' ') -or $part.EndsWith('.') -or
      $part -cnotmatch '^[A-Za-z0-9._ @()+-]+$') {return $false}
 }
 return $true
}
function HashEntry($entry) {
 $stream=$entry.Open()
 $digest=[Security.Cryptography.SHA256]::Create()
 try{return ([BitConverter]::ToString($digest.ComputeHash($stream))).Replace('-','').ToLowerInvariant()}
 finally{$digest.Dispose();$stream.Dispose()}
}
Guard ($env:OS -eq 'Windows_NT') 'windows_only'
$root=[IO.Path]::GetFullPath($ArtifactDirectory)
Guard (Test-Path -LiteralPath $root -PathType Container) 'missing_artifact_directory'
Guard (((Get-Item -LiteralPath $root -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) 'directory_alias'
$sha=$ExpectedCommit.ToLowerInvariant()
$build=Evidence (Join-Path $root 'BUILD-EVIDENCE.json')
$inventory=Evidence (Join-Path $root 'BUNDLE-INVENTORY.json')
$setup=Join-Path $root 'ClineOrchestrator-Setup-unsigned.exe'
$zipFile=Join-Path $root 'ClineOrchestrator-win-x64-portable.zip'
Guard ($build.sourceCommit -ceq $sha -and $inventory.sourceCommit -ceq $sha) 'source_commit'
Guard ($build.installerBuilt -eq $true -and $build.nodeVersion -ceq '22.23.3' -and
  $build.serviceInstalled -eq $false -and $build.configModified -eq $false -and
  $build.taskLaunched -eq $false) 'unsafe_build_contract'
Guard ($inventory.schemaVersion -eq 1 -and $inventory.grantsAuthority -eq $false -and
  $inventory.releaseAuthorized -eq $false -and $inventory.bundleName -ceq 'ClineOrchestrator') 'inventory_contract'
Guard ((HashFile $setup) -ceq $build.installerSha256) 'installer_hash'
Guard ((HashFile $zipFile) -ceq $build.portableZipSha256) 'portable_hash'
Guard ((HashFile (Join-Path $root 'DEPENDENCY-SBOM.cdx.json')) -ceq $inventory.sbomSha256) 'sbom_hash'
if ($ExpectedArtifactArchiveSha256 -ne '') {
 Guard (-not [string]::IsNullOrWhiteSpace($ArtifactArchivePath)) 'download_zip_required'
 Guard ((HashFile $ArtifactArchivePath) -ceq $ExpectedArtifactArchiveSha256.ToLowerInvariant()) 'download_zip_hash'
}
$files=@($inventory.files)
Guard ($files.Count -gt 3 -and $files.Count -le 50000 -and
  $files.Count -eq $build.filesInBundle) 'file_count'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive=[IO.Compression.ZipFile]::OpenRead($zipFile)
try {
 $expected=@{}
 foreach ($record in $files) {
  $name=[string]$record.path
  Guard (SafeName $name) 'unsafe_inventory_name'
  Guard (-not $expected.ContainsKey($name)) 'duplicate_inventory'
  Guard ([string]$record.sha256 -cmatch '^[a-f0-9]{64}$') 'invalid_inventory_hash'
  $expected[$name]=$record
 }
 $seen=@{}
 foreach ($entry in $archive.Entries) {
  $name=$entry.FullName
  if ($name.EndsWith('/')) {Guard (SafeName $name.TrimEnd('/')) 'unsafe_zip_dir';continue}
  Guard (SafeName $name) 'unsafe_zip_file'
  Guard (-not $seen.ContainsKey($name)) 'duplicate_zip_file'
  Guard ($expected.ContainsKey($name)) 'unexpected_zip_file'
  Guard ($entry.Length -eq [long]$expected[$name].size) 'zip_file_size'
  Guard ((HashEntry $entry) -ceq $expected[$name].sha256) 'zip_file_hash'
  $seen[$name]=$true
 }
 Guard ($seen.Count -eq $expected.Count) 'missing_zip_file'
 $manifestEntry=$archive.GetEntry('app/product-manifest.json')
 Guard ($null -ne $manifestEntry -and $manifestEntry.Length -gt 0 -and
   $manifestEntry.Length -le 131072) 'embedded_manifest'
 $stream=$manifestEntry.Open()
 $reader=New-Object IO.StreamReader($stream,[Text.Encoding]::UTF8,$true)
 try{$manifest=$reader.ReadToEnd()|ConvertFrom-Json}finally{$reader.Dispose();$stream.Dispose()}
 Guard ($manifest.sourceCommit -ceq $sha -and $manifest.nodeVersion -ceq '22.23.3' -and
   $manifest.schemaVersion -eq 1 -and $manifest.grantsAuthority -eq $false -and
   $manifest.serviceInstalled -eq $false -and $manifest.providerLaunched -eq $false -and
   $manifest.distribution -ceq 'unsigned-windows-foreground-preview') 'manifest_contract'
 $nodeKey='runtime/node.exe'
 Guard ($manifest.sha256.$nodeKey -ceq '9c9245166b4a8e182e0b797da9c20136117ff24368eaff1fec8343a123c8db0e') 'pinned_node_hash'
 foreach($key in @('runtime/node.exe','launcher/ClineOrchestrator.exe',
   'app/node_modules/cline-orchestrator/dist/product-cli.js')) {
  Guard ($expected.ContainsKey($key) -and $expected[$key].sha256 -ceq $manifest.sha256.$key) 'component_hash'
 }
} finally {$archive.Dispose()}
$program=Test-Path -LiteralPath (Join-Path $env:LOCALAPPDATA 'Programs\ClineOrchestrator')
$state=Test-Path -LiteralPath (Join-Path $env:LOCALAPPDATA 'ClineOrchestrator')
[ordered]@{
 schemaVersion=1
 phase='M19E5A_operator_preflight'
 candidateCommit=$sha
 downloadArchiveChecked=($ExpectedArtifactArchiveSha256 -ne '')
 installerAndPortableVerified=$true
 allBundledFilesVerified=$true
 sbomVerified=$true
 cleanCurrentUserProfile=(-not $program -and -not $state)
 existingInstallDetected=[bool]$program
 existingUserStateDetected=[bool]$state
 realModelChecked=$false
 installationPerformed=$false
 taskStarted=$false
 releaseAuthorized=$false
 grantsAuthority=$false
} | ConvertTo-Json -Compress
