[CmdletBinding()]
param([switch]$LiveMismatch)
$ErrorActionPreference = 'Stop'
Add-Type -Path (Join-Path $PSScriptRoot 'LegacyProbe.cs')
$checks = @(
    [ViberObserver.LegacyProbe]::ValidPath([int[]]@())
    [ViberObserver.LegacyProbe]::ValidPath([int[]]@(0,1,2))
    ![ViberObserver.LegacyProbe]::ValidPath($null)
    ![ViberObserver.LegacyProbe]::ValidPath([int[]]@(-1))
    ![ViberObserver.LegacyProbe]::ValidPath([int[]]@(2000))
    ![ViberObserver.LegacyProbe]::ValidPath([int[]](0..16))
)
if ($checks -contains $false) { throw 'Native path bounds failed' }
# Must reject these before constructing any COM object or touching a window.
$invalid = [ViberObserver.LegacyProbe]::ReadNative([IntPtr]::Zero, [int[]]@(-1), [int[]]@(1), 0)
$missing = [ViberObserver.LegacyProbe]::ReadNative([IntPtr]::Zero, [int[]]@(), [int[]]@(), 0)
foreach ($result in @($invalid,$missing)) {
    if ($result.Status -ne 'invalid_target' -or $null -ne $result.Name -or $null -ne $result.Value) {
        throw 'Invalid target was not rejected before reading'
    }
}
if ($LiveMismatch) {
    $targets = @(Get-Process -Name Viber -ErrorAction SilentlyContinue | Where-Object {$_.MainWindowHandle -ne 0})
    if ($targets.Count -ne 1) { throw 'Live mismatch test needs exactly one Viber window' }
    $target = $targets[0]
    # A deliberately wrong synthetic RuntimeId must never permit Legacy text reads.
    $result = [ViberObserver.LegacyProbe]::ReadNative($target.MainWindowHandle, [int[]]@(), [int[]]@(-987654321), $target.Id)
    if ($result.Status -ne 'tree_target_mismatch' -or $result.SameProcess -ne $true -or $result.SameRuntimeId -ne $false -or $null -ne $result.Name -or $null -ne $result.Value) {
        throw 'Live wrong-runtime rejection failed'
    }
}
@{status='passed';synthetic_checks=8;live_wrong_runtime_checked=[bool]$LiveMismatch} | ConvertTo-Json
