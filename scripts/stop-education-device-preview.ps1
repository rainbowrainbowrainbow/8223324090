$ErrorActionPreference = 'Stop'
$deviceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$deviceOut = Join-Path $deviceRoot 'output/education-ready/08C'
$deviceMarker = Get-Content -LiteralPath (Join-Path $deviceOut 'preview.json') -Raw | ConvertFrom-Json
if ($deviceMarker.owner -ne 'EDU-READY-08C-v1' -or [IO.Path]::GetFullPath($deviceMarker.worktree) -ne $deviceRoot -or $deviceMarker.database -ne 'eventgenix_education_ready_devices' -or $deviceMarker.appPort -ne 3013) { throw 'Device preview ownership mismatch' }
$deviceStartedUtc = if ($deviceMarker.startedAt -is [DateTime]) { $deviceMarker.startedAt.ToUniversalTime() } else { [DateTimeOffset]::Parse($deviceMarker.startedAt, [Globalization.CultureInfo]::InvariantCulture).UtcDateTime }
foreach ($deviceTarget in @(@{id=$deviceMarker.serverPid;file='server.js';port=3013;host='127.0.0.1'},@{id=$deviceMarker.parentPid;file='scripts/start-education-device-preview.js';port=$deviceMarker.lanPort;host=$deviceMarker.lanHost})) {
    $deviceProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$($deviceTarget.id)"
    if (-not $deviceProcess) { continue }
    $deviceFile = Join-Path $deviceRoot $deviceTarget.file
    if ($deviceProcess.Name -ne 'node.exe' -or -not $deviceProcess.CommandLine.Replace('\','/').Contains($deviceFile.Replace('\','/'))) { throw 'PID reused or outside owned device preview; refusing to stop' }
    if ($deviceProcess.CreationDate.ToUniversalTime() -gt $deviceStartedUtc) { throw 'Process started after ownership marker; PID may have been reused' }
    if ($deviceTarget.port) {
        $deviceListeners = @(Get-NetTCPConnection -State Listen -LocalPort $deviceTarget.port -ErrorAction SilentlyContinue)
        if ($deviceTarget.file -eq 'server.js' -and $deviceListeners.Count -eq 0) { throw 'Owned app listener missing; refusing to guess process identity' }
        if (@($deviceListeners | Where-Object { $_.OwningProcess -ne $deviceTarget.id -or $_.LocalAddress -ne $deviceTarget.host }).Count -gt 0) { throw 'Listener ownership mismatch' }
    }
    Stop-Process -Id $deviceTarget.id
    if ($deviceTarget.file -eq 'server.js') {
        # Let the verified app-exit handler close its gateway and record preservation proof.
        $deviceStopDeadline = [DateTime]::UtcNow.AddSeconds(5)
        while ([DateTime]::UtcNow -lt $deviceStopDeadline -and (Get-Process -Id $deviceMarker.parentPid -ErrorAction SilentlyContinue)) { Start-Sleep -Milliseconds 200 }
    }
}
$deviceRemaining = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -eq 3013 -or ($deviceMarker.lanPort -and $_.LocalPort -eq $deviceMarker.lanPort) })
if ($deviceRemaining.Count) { throw 'A device preview listener remains; inspect it' }
$deviceMarker.status = 'STOPPED'
$deviceMarker | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $deviceOut 'preview.json') -Encoding UTF8
@{owner='EDU-READY-08C-v1';status='STOPPED';lanListenerClosed=$true;appStopped=$true;stoppedAt=[DateTime]::UtcNow.ToString('o');databaseRetained=$true;postgresAndManualPreviewUntouched=$true} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $deviceOut 'cleanup.json') -Encoding UTF8
Write-Output 'Owned device preview listeners stopped; device DB, manual preview and PostgreSQL retained.'
