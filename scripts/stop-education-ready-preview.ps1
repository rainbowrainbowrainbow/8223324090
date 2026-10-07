param([switch]$StopPostgres)
$ErrorActionPreference = 'Stop'
$eduRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$eduOutput = Join-Path $eduRoot 'output/education-ready/02'
$eduPreview = Get-Content -LiteralPath (Join-Path $eduOutput 'preview.json') -Raw | ConvertFrom-Json
if ($eduPreview.owner -ne 'EDU-READY-02-v1' -or [IO.Path]::GetFullPath($eduPreview.worktree) -ne $eduRoot) {
    throw 'Preview ownership mismatch; no process will be stopped'
}
$eduProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$($eduPreview.serverPid)"
if ($eduProcess) {
    $eduExpectedServer = Join-Path $eduRoot 'server.js'
    if ($eduProcess.Name -ne 'node.exe' -or -not $eduProcess.CommandLine.Contains($eduExpectedServer)) {
        throw 'Preview PID was reused or command does not match this worktree; refusing to stop'
    }
    $eduListeners = @(Get-NetTCPConnection -State Listen -LocalPort 3012 -ErrorAction SilentlyContinue)
    if ($eduListeners.Count -eq 0 -or @($eduListeners | Where-Object { $_.OwningProcess -ne $eduPreview.serverPid -or $_.LocalAddress -ne '127.0.0.1' }).Count -gt 0) {
        throw 'Preview listener ownership mismatch; refusing to stop'
    }
    Stop-Process -Id $eduPreview.serverPid
}
if ($StopPostgres) {
    $eduMarker = Get-Content -LiteralPath (Join-Path $eduOutput 'cluster-owner.json') -Raw | ConvertFrom-Json
    $eduData = [IO.Path]::GetFullPath((Join-Path $eduOutput 'postgres-data'))
    if ($eduMarker.owner -ne 'EDU-READY-02-v1' -or $eduMarker.port -ne 55469 -or [IO.Path]::GetFullPath($eduMarker.dataDirectory) -ne $eduData) {
        throw 'PostgreSQL directory ownership mismatch'
    }
    $eduBin = if ($env:EDU_READY_PG_BIN) { $env:EDU_READY_PG_BIN } else { 'C:/Users/Plotva/AppData/Local/Temp/eventgenix-eduqa-20261001/native/bin' }
    & (Join-Path $eduBin 'pg_ctl.exe') -D $eduData -m fast -w stop
    if ($LASTEXITCODE -ne 0) { throw 'Owned PostgreSQL stop failed' }
}
Write-Output 'Owned local preview stopped. Data retained; no database or file deleted.'
