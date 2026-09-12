param(
  [string]$InstallRoot = "$env:USERPROFILE\.eventgenix\viber-personal-bridge",
  [string]$SourceRoot,
  [switch]$DryRun,
  [switch]$Restart,
  [switch]$RollbackLatest,
  [string]$PythonExe = "$env:LOCALAPPDATA\Programs\Python\Python313\python.exe"
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
$BackupRoot = Join-Path $InstallRoot 'runtime_backups'
$ConfigPath = Join-Path $InstallRoot 'connector.json'
$StatePath = Join-Path $InstallRoot 'bridge.sqlite'
$ManifestPath = Join-Path $RuntimeRoot 'runtime_manifest.json'

if (-not (Test-Path -LiteralPath $SourceRoot -PathType Container)) {
  throw "SOURCE_ROOT_NOT_FOUND"
}
if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) {
  throw "CONNECTOR_CONFIG_NOT_FOUND"
}

function Get-BridgeProcess {
  param([string]$Config)
  $escaped = [Regex]::Escape($Config)
  Get-CimInstance Win32_Process |
    Where-Object { $_.CommandLine -match 'run_p1_daemon\.py' -and $_.CommandLine -match $escaped }
}

function Stop-BridgeProcess {
  param([string]$Config)
  $processes = @(Get-BridgeProcess -Config $Config)
  foreach ($proc in $processes) {
    Stop-Process -Id $proc.ProcessId -Force
  }
  return $processes.Count
}

function Start-BridgeProcess {
  param([string]$Runtime, [string]$Config, [string]$Python)
  if (-not (Test-Path -LiteralPath $Python -PathType Leaf)) {
    throw "PYTHON_EXE_NOT_FOUND"
  }
  $entrypoint = Join-Path $Runtime 'run_p1_daemon.py'
  if (-not (Test-Path -LiteralPath $entrypoint -PathType Leaf)) {
    throw "ENTRYPOINT_NOT_FOUND"
  }
  Start-Process -FilePath $Python -ArgumentList @('-B', $entrypoint, '--config', $Config) -WorkingDirectory $Runtime -WindowStyle Hidden
  Start-Sleep -Seconds 3
  return @(Get-BridgeProcess -Config $Config).Count
}

if ($RollbackLatest) {
  $latest = Get-ChildItem -LiteralPath $BackupRoot -Directory -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending |
    Select-Object -First 1
  if (-not $latest) {
    throw "RUNTIME_BACKUP_NOT_FOUND"
  }
  if (-not $DryRun) {
    New-Item -ItemType Directory -Force -Path $RuntimeRoot | Out-Null
    Get-ChildItem -LiteralPath $latest.FullName -File | ForEach-Object {
      Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $RuntimeRoot $_.Name) -Force
    }
  }
  $stopped = 0
  $workers = @(Get-BridgeProcess -Config $ConfigPath).Count
  if ($Restart -and -not $DryRun) {
    $stopped = Stop-BridgeProcess -Config $ConfigPath
    $workers = Start-BridgeProcess -Runtime $RuntimeRoot -Config $ConfigPath -Python $PythonExe
  }
  [ordered]@{
    ok = $true
    action = 'rollback'
    dryRun = [bool]$DryRun
    restoredFrom = $latest.FullName
    configPreserved = (Test-Path -LiteralPath $ConfigPath -PathType Leaf)
    statePreserved = (Test-Path -LiteralPath $StatePath -PathType Leaf)
    stoppedWorkers = $stopped
    workerCount = $workers
  } | ConvertTo-Json -Depth 4
  exit 0
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

$backupPath = $null
if (-not $DryRun) {
  New-Item -ItemType Directory -Force -Path $RuntimeRoot | Out-Null
  if (Test-Path -LiteralPath $RuntimeRoot -PathType Container) {
    New-Item -ItemType Directory -Force -Path $BackupRoot | Out-Null
    $backupPath = Join-Path $BackupRoot (Get-Date -Format 'yyyyMMdd-HHmmss')
    New-Item -ItemType Directory -Force -Path $backupPath | Out-Null
    Get-ChildItem -LiteralPath $RuntimeRoot -File | ForEach-Object {
      Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $backupPath $_.Name) -Force
    }
  }
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

$stoppedWorkers = 0
$workerCount = @(Get-BridgeProcess -Config $ConfigPath).Count
if ($Restart -and -not $DryRun) {
  $stoppedWorkers = Stop-BridgeProcess -Config $ConfigPath
  $workerCount = Start-BridgeProcess -Runtime $RuntimeRoot -Config $ConfigPath -Python $PythonExe
}

[ordered]@{
  ok = $true
  dryRun = [bool]$DryRun
  installRoot = $InstallRoot
  runtimeRoot = $RuntimeRoot
  manifestPath = $ManifestPath
  backupPath = $backupPath
  files = $manifestFiles.Count
  configPreserved = (Test-Path -LiteralPath $ConfigPath -PathType Leaf)
  statePreserved = (Test-Path -LiteralPath $StatePath -PathType Leaf)
  stoppedWorkers = $stoppedWorkers
  workerCount = $workerCount
} | ConvertTo-Json -Depth 4
