$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskOut = Join-Path $taskRoot 'output/education-ready/close05'
$taskMarker = Get-Content -Raw -LiteralPath (Join-Path $taskOut 'preview.json') | ConvertFrom-Json
if ($taskMarker.owner -ne 'EDU-CLOSE-05-v1' -or $taskMarker.database -ne 'eventgenix_education_close_devices' -or [IO.Path]::GetFullPath($taskMarker.worktree) -ne $taskRoot -or $taskMarker.appPort -ne 3015) { throw 'CLOSE05 ownership mismatch' }
if ($taskMarker.status -eq 'STOPPED') { Write-Output 'Owned preview already stopped.'; exit 0 }
$taskStarted = if ($taskMarker.startedAt -is [DateTime]) { $taskMarker.startedAt.ToUniversalTime() } else { [DateTimeOffset]::Parse($taskMarker.startedAt, [Globalization.CultureInfo]::InvariantCulture).UtcDateTime }
$taskProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$($taskMarker.serverPid)"
if (-not $taskProcess -or $taskProcess.Name -ne 'node.exe' -or -not $taskProcess.CommandLine.Replace('\','/').Contains((Join-Path $taskRoot 'server.js').Replace('\','/')) -or $taskProcess.CreationDate.ToUniversalTime() -gt $taskStarted) { throw 'Owned server PID missing/reused; no guessed stop' }
$taskListeners = @(Get-NetTCPConnection -State Listen -LocalPort 3015)
if ($taskListeners.Count -ne 1 -or $taskListeners[0].LocalAddress -ne '127.0.0.1' -or $taskListeners[0].OwningProcess -ne $taskMarker.serverPid) { throw 'Owned listener mismatch' }
Stop-Process -Id $taskMarker.serverPid
$taskDeadline = [DateTime]::UtcNow.AddSeconds(20)
while ([DateTime]::UtcNow -lt $taskDeadline -and (Get-Process -Id $taskMarker.parentPid -ErrorAction SilentlyContinue)) { Start-Sleep -Milliseconds 200 }
$taskCleanup = Get-Content -Raw -LiteralPath (Join-Path $taskOut 'cleanup.json') | ConvertFrom-Json
if ($taskCleanup.status -ne 'STOPPED' -or -not $taskCleanup.retainedUnchanged) { throw 'Cleanup/preservation proof incomplete' }
if (@(Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -in @(3015,3016) }).Count) { throw 'CLOSE05 listener remains' }
Write-Output 'Owned CLOSE05 app/gateway stopped; DB/evidence/manual data retained.'
