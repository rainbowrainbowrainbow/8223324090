param(
  [string]$InstallRoot = "$env:USERPROFILE\.eventgenix\viber-personal-bridge",
  [string]$SourceRoot,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

$ScriptPath = $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent (Split-Path -Parent $ScriptPath)

if (-not $SourceRoot) {
  $SourceRoot = Join-Path $RepoRoot 'docs\viber-personal-bridge\observer'
}

$SourceRoot = [System.IO.Path]::GetFullPath($SourceRoot)
$InstallRoot = [System.IO.Path]::GetFullPath($InstallRoot)
$RuntimeRoot = Join-Path $InstallRoot 'runtime'
$ConfigPath = Join-Path $InstallRoot 'connector.json'
$StatePath = Join-Path $InstallRoot 'bridge.sqlite'
$ManifestPath = Join-Path $RuntimeRoot 'runtime_manifest.json'

if (-not (Test-Path -LiteralPath $SourceRoot -PathType Container)) {
  throw "SOURCE_ROOT_NOT_FOUND"
}
if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) {
  throw "CONNECTOR_CONFIG_NOT_FOUND"
}

$files = Get-ChildItem -LiteralPath $SourceRoot -Filter '*.py' -File |
  Where-Object { $_.Name -notlike 'test_*' -and $_.Name -notin @('__init__.py') } |
  Sort-Object Name

$required = @(
  'p1_bridge_core.py',
  'p1_daemon.py',
  'p1_dispatcher.py',
  'p1_http_client.py',
  'p1_live_inbound.py',
  'p1_paired_queries.py',
  'p1_transport.py',
  'run_p1_daemon.py'
)

$names = @($files | ForEach-Object { $_.Name })
foreach ($name in $required) {
  if ($names -notcontains $name) {
    throw "RUNTIME_SOURCE_INCOMPLETE:$name"
  }
}

if (-not $DryRun) {
  New-Item -ItemType Directory -Force -Path $RuntimeRoot | Out-Null
}

$manifestFiles = @()
foreach ($file in $files) {
  $destination = Join-Path $RuntimeRoot $file.Name
  $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  $manifestFiles += [ordered]@{
    name = $file.Name
    sha256 = $hash
    bytes = $file.Length
  }
  if (-not $DryRun) {
    Copy-Item -LiteralPath $file.FullName -Destination $destination -Force
  }
}

$gitSha = $null
try {
  $gitSha = (git -C $RepoRoot rev-parse HEAD 2>$null).Trim()
} catch {
  $gitSha = $null
}

$manifest = [ordered]@{
  runtime = 'viber-personal-bridge'
  installedAt = (Get-Date).ToUniversalTime().ToString('o')
  sourceRoot = $SourceRoot
  installRoot = $InstallRoot
  gitSha = $gitSha
  configPresent = (Test-Path -LiteralPath $ConfigPath -PathType Leaf)
  statePresent = (Test-Path -LiteralPath $StatePath -PathType Leaf)
  files = $manifestFiles
}

if (-not $DryRun) {
  $manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $ManifestPath -Encoding UTF8
}

[ordered]@{
  ok = $true
  dryRun = [bool]$DryRun
  installRoot = $InstallRoot
  runtimeRoot = $RuntimeRoot
  manifestPath = $ManifestPath
  files = $manifestFiles.Count
  configPreserved = (Test-Path -LiteralPath $ConfigPath -PathType Leaf)
  statePreserved = (Test-Path -LiteralPath $StatePath -PathType Leaf)
} | ConvertTo-Json -Depth 4
