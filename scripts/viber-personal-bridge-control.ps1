param(
  [ValidateSet('status','preflight','health','start','stop','restart','install','rollback-latest','once','enable-autostart','disable-autostart')]
  [string]$Action = 'status',
  [string]$InstallRoot = "$env:USERPROFILE\.eventgenix\viber-personal-bridge",
  [string]$PythonExe = "$env:LOCALAPPDATA\Programs\Python\Python313\python.exe",
  [string]$ConfigPath,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

$ScriptPath = $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent (Split-Path -Parent $ScriptPath)
$InstallerPath = Join-Path $RepoRoot 'scripts\install-viber-personal-bridge-runtime.ps1'

$InstallRoot = [System.IO.Path]::GetFullPath($InstallRoot)
if (-not $ConfigPath) {
  $ConfigPath = Join-Path $InstallRoot 'connector.json'
}
$ConfigPath = [System.IO.Path]::GetFullPath($ConfigPath)
$RuntimeRoot = Join-Path $InstallRoot 'runtime'
$EntryPoint = Join-Path $RuntimeRoot 'run_p1_daemon.py'
$ManifestPath = Join-Path $RuntimeRoot 'runtime_manifest.json'
$AutostartName = 'EventGenix Viber Personal Bridge.cmd'
$AutostartPath = Join-Path ([Environment]::GetFolderPath('Startup')) $AutostartName

function ConvertTo-SafeId {
  param([object]$Value)
  if (-not ($Value -is [string]) -or [string]::IsNullOrWhiteSpace($Value)) {
    return $null
  }
  if ($Value.Length -le 8) {
    return ('...' + $Value)
  }
  return ('...' + $Value.Substring($Value.Length - 8))
}

$script:ProcessQueryError = $null

function Get-BridgeProcess {
  param([string]$Config)
  $script:ProcessQueryError = $null
  $escaped = [Regex]::Escape($Config)
  try {
    @(Get-CimInstance Win32_Process |
      Where-Object { $_.CommandLine -match 'run_p1_daemon\.py' -and $_.CommandLine -match $escaped })
  } catch {
    $script:ProcessQueryError = 'PROCESS_ENUMERATION_FAILED'
    @()
  }
}

function Assert-ProcessEnumerationAvailable {
  $null = Get-BridgeProcess -Config $ConfigPath
  if ($script:ProcessQueryError) {
    throw $script:ProcessQueryError
  }
}

function Read-ConfigSummary {
  if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) {
    return [ordered]@{ present = $false }
  }
  try {
    $raw = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
  } catch {
    return [ordered]@{ present = $true; readable = $false; error = 'CONFIG_READ_FAILED' }
  }
  $live = $raw.live_inbound
  $sender = $raw.sender
  $statePath = if ($raw.state_path) { [string]$raw.state_path } else { $null }
  $journalPath = if ($live -and $live.journal_path) { [string]$live.journal_path } else { $null }
  $runtimeIdPath = if ($raw.runtime_id_path) { [string]$raw.runtime_id_path } elseif ($statePath) { [System.IO.Path]::ChangeExtension($statePath, $null) + $null } else { $null }
  if (-not $raw.runtime_id_path -and $statePath) {
    $runtimeIdPath = Join-Path (Split-Path -Parent $statePath) 'runtime_id.txt'
  }
  return [ordered]@{
    present = $true
    readable = $true
    crmBaseUrlPresent = [bool]$raw.crm_base_url
    bridgeId = ConvertTo-SafeId $raw.bridge_id
    accountId = ConvertTo-SafeId $raw.account_id
    accountEpoch = $raw.account_epoch
    businessContext = $raw.business_context
    tokenPresent = [bool]$raw.token
    statePathExists = if ($statePath) { Test-Path -LiteralPath $statePath -PathType Leaf } else { $false }
    runtimeIdPresent = if ($runtimeIdPath) { Test-Path -LiteralPath $runtimeIdPath -PathType Leaf } else { $false }
    liveInboundEnabled = [bool]($live -and $live.enabled -eq $true)
    liveSourceKind = if ($live) { $live.source_kind } else { $null }
    liveJournalPresent = if ($journalPath) { Test-Path -LiteralPath $journalPath -PathType Leaf } else { $false }
    referenceKeyPresent = [bool]($live -and $live.reference_key)
    phoneMarkerPresent = [bool]($live -and $live.phone_marker)
    desktopMarkerPresent = [bool]($live -and $live.desktop_marker)
    senderEnabled = [bool]($sender -and $sender.enabled -eq $true)
    senderAdapter = if ($sender) { $sender.adapter } else { $null }
    senderRunIdPresent = [bool]($sender -and $sender.run_id)
  }
}

function Read-ManifestSummary {
  if (-not (Test-Path -LiteralPath $ManifestPath -PathType Leaf)) {
    return [ordered]@{ present = $false }
  }
  try {
    $manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
    $fileNames = @($manifest.files | ForEach-Object { $_.name })
    return [ordered]@{
      present = $true
      readable = $true
      gitSha = $manifest.gitSha
      installedAt = $manifest.installedAt
      fileCount = @($manifest.files).Count
      hasUiaSender = $fileNames -contains 'p1_uia_sender.py'
      hasSendScript = $fileNames -contains 'Send-P1Controlled.ps1'
      hasVerifyPeerScript = $fileNames -contains 'Verify-ActiveMarkerChat.ps1'
      hasComposerScript = $fileNames -contains 'Inspect-ViberComposer.ps1'
    }
  } catch {
    return [ordered]@{ present = $true; readable = $false; error = 'MANIFEST_READ_FAILED' }
  }
}

function Get-AutostartSummary {
  $present = Test-Path -LiteralPath $AutostartPath -PathType Leaf
  return [ordered]@{
    present = $present
    path = $AutostartPath
    userSession = $true
    session0 = $false
  }
}

function Write-AutostartLauncher {
  if (-not (Test-Path -LiteralPath $ScriptPath -PathType Leaf)) { throw 'CONTROL_SCRIPT_NOT_FOUND' }
  $content = @(
    '@echo off',
    'powershell -NoProfile -ExecutionPolicy Bypass -File "' + $ScriptPath + '" -Action start -InstallRoot "' + $InstallRoot + '" -PythonExe "' + $PythonExe + '" -ConfigPath "' + $ConfigPath + '"'
  ) -join "`r`n"
  if (-not $DryRun) {
    Set-Content -LiteralPath $AutostartPath -Value $content -Encoding ASCII
  }
}

function Remove-AutostartLauncher {
  if ((Test-Path -LiteralPath $AutostartPath -PathType Leaf) -and -not $DryRun) {
    Remove-Item -LiteralPath $AutostartPath -Force
  }
}

function Get-StatusPayload {
  $workers = Get-BridgeProcess -Config $ConfigPath
  return [ordered]@{
    ok = $true
    action = 'status'
    installRoot = $InstallRoot
    runtimePresent = Test-Path -LiteralPath $EntryPoint -PathType Leaf
    config = Read-ConfigSummary
    manifest = Read-ManifestSummary
    autostart = Get-AutostartSummary
    processQueryOk = -not [bool]$script:ProcessQueryError
    processQueryError = $script:ProcessQueryError
    workerCount = if ($script:ProcessQueryError) { $null } else { @($workers).Count }
    workerPids = if ($script:ProcessQueryError) { @() } else { @($workers | ForEach-Object { $_.ProcessId }) }
  }
}

function Get-HealthPayload {
  $status = Get-StatusPayload
  $preflight = $null
  $preflightOk = $false
  $preflightError = $null
  try {
    $preflight = Invoke-Preflight
    $preflightOk = $true
  } catch {
    $preflightError = $_.Exception.Message
  }
  $workerOk = ($status.processQueryOk -eq $true -and $status.workerCount -eq 1)
  return [ordered]@{
    ok = ($workerOk -and $preflightOk)
    action = 'health'
    workerOk = $workerOk
    preflightOk = $preflightOk
    preflightError = $preflightError
    nextAction = if (-not $workerOk) { 'Run start or restart from the user session.' } elseif (-not $preflightOk) { 'Run preflight and fix the reported blocker.' } else { 'Bridge runtime is present; proceed with controlled live QA.' }
    status = $status
    preflight = $preflight
  }
}

function Invoke-Preflight {
  if (-not (Test-Path -LiteralPath $EntryPoint -PathType Leaf)) {
    throw 'ENTRYPOINT_NOT_FOUND'
  }
  if (-not (Test-Path -LiteralPath $PythonExe -PathType Leaf)) {
    throw 'PYTHON_EXE_NOT_FOUND'
  }
  $raw = & $PythonExe -B $EntryPoint --config $ConfigPath --preflight
  if ($LASTEXITCODE -ne 0) {
    throw 'PREFLIGHT_FAILED'
  }
  return Protect-PreflightOutput ($raw | ConvertFrom-Json)
}

function Protect-PreflightOutput {
  param([object]$Preflight)
  if ($null -eq $Preflight) {
    return $null
  }
  if ($Preflight.PSObject.Properties.Name -contains 'bridge_id') {
    $Preflight.bridge_id = ConvertTo-SafeId $Preflight.bridge_id
  }
  if ($Preflight.PSObject.Properties.Name -contains 'account_id') {
    $Preflight.account_id = ConvertTo-SafeId $Preflight.account_id
  }
  return $Preflight
}

function Stop-BridgeWorker {
  Assert-ProcessEnumerationAvailable
  $workers = Get-BridgeProcess -Config $ConfigPath
  if (-not $DryRun) {
    foreach ($worker in $workers) {
      Stop-Process -Id $worker.ProcessId -Force
    }
  }
  return @($workers).Count
}

function Start-BridgeWorker {
  Assert-ProcessEnumerationAvailable
  if (-not (Test-Path -LiteralPath $EntryPoint -PathType Leaf)) {
    throw 'ENTRYPOINT_NOT_FOUND'
  }
  if (-not (Test-Path -LiteralPath $PythonExe -PathType Leaf)) {
    throw 'PYTHON_EXE_NOT_FOUND'
  }
  $existing = Get-BridgeProcess -Config $ConfigPath
  if (@($existing).Count -gt 0) {
    return @($existing).Count
  }
  if (-not $DryRun) {
    Start-Process -FilePath $PythonExe -ArgumentList @('-B', $EntryPoint, '--config', $ConfigPath) -WorkingDirectory $RuntimeRoot -WindowStyle Hidden
    Start-Sleep -Seconds 3
  }
  return @((Get-BridgeProcess -Config $ConfigPath)).Count
}

try {
  switch ($Action) {
    'status' {
      Get-StatusPayload | ConvertTo-Json -Depth 8
    }
    'preflight' {
      [ordered]@{ ok = $true; action = 'preflight'; status = Get-StatusPayload; preflight = Invoke-Preflight } | ConvertTo-Json -Depth 12
    }
    'health' {
      Get-HealthPayload | ConvertTo-Json -Depth 12
    }
    'stop' {
      $stopped = Stop-BridgeWorker
      [ordered]@{ ok = $true; action = 'stop'; dryRun = [bool]$DryRun; stoppedWorkers = $stopped; status = Get-StatusPayload } | ConvertTo-Json -Depth 8
    }
    'start' {
      $count = Start-BridgeWorker
      [ordered]@{ ok = $true; action = 'start'; dryRun = [bool]$DryRun; workerCount = $count; status = Get-StatusPayload } | ConvertTo-Json -Depth 8
    }
    'restart' {
      $stopped = Stop-BridgeWorker
      $count = Start-BridgeWorker
      [ordered]@{ ok = $true; action = 'restart'; dryRun = [bool]$DryRun; stoppedWorkers = $stopped; workerCount = $count; status = Get-StatusPayload } | ConvertTo-Json -Depth 8
    }
    'install' {
      $args = @('-NoProfile','-ExecutionPolicy','Bypass','-File',$InstallerPath,'-InstallRoot',$InstallRoot,'-PythonExe',$PythonExe)
      if ($DryRun) { $args += '-DryRun' }
      $raw = & powershell @args
      if ($LASTEXITCODE -ne 0) { throw 'INSTALL_FAILED' }
      [ordered]@{ ok = $true; action = 'install'; dryRun = [bool]$DryRun; installer = ($raw | ConvertFrom-Json); status = Get-StatusPayload } | ConvertTo-Json -Depth 10
    }
    'enable-autostart' {
      Write-AutostartLauncher
      [ordered]@{ ok = $true; action = 'enable-autostart'; dryRun = [bool]$DryRun; autostart = Get-AutostartSummary; status = Get-StatusPayload } | ConvertTo-Json -Depth 8
    }
    'disable-autostart' {
      Remove-AutostartLauncher
      [ordered]@{ ok = $true; action = 'disable-autostart'; dryRun = [bool]$DryRun; autostart = Get-AutostartSummary; status = Get-StatusPayload } | ConvertTo-Json -Depth 8
    }
    'rollback-latest' {
      $args = @('-NoProfile','-ExecutionPolicy','Bypass','-File',$InstallerPath,'-InstallRoot',$InstallRoot,'-PythonExe',$PythonExe,'-RollbackLatest')
      if ($DryRun) { $args += '-DryRun' }
      $raw = & powershell @args
      if ($LASTEXITCODE -ne 0) { throw 'ROLLBACK_FAILED' }
      [ordered]@{ ok = $true; action = 'rollback-latest'; dryRun = [bool]$DryRun; installer = ($raw | ConvertFrom-Json); status = Get-StatusPayload } | ConvertTo-Json -Depth 10
    }
    'once' {
      if (-not (Test-Path -LiteralPath $EntryPoint -PathType Leaf)) { throw 'ENTRYPOINT_NOT_FOUND' }
      if (-not (Test-Path -LiteralPath $PythonExe -PathType Leaf)) { throw 'PYTHON_EXE_NOT_FOUND' }
      $raw = & $PythonExe -B $EntryPoint --config $ConfigPath --once
      $exit = $LASTEXITCODE
      [ordered]@{ ok = ($exit -eq 0); action = 'once'; exitCode = $exit; result = ($raw | ConvertFrom-Json); status = Get-StatusPayload } | ConvertTo-Json -Depth 10
      if ($exit -ne 0) { exit $exit }
    }
  }
} catch {
  [ordered]@{
    ok = $false
    action = $Action
    error = $_.Exception.Message
    status = Get-StatusPayload
  } | ConvertTo-Json -Depth 8
  exit 1
}
