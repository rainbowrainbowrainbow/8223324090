[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][ValidatePattern('^[0-9A-F]{8}$')][string]$RunId,
    [ValidateRange(50,1000)][int]$MaxNodes = 600,
    [ValidateRange(5,30)][int]$TimeoutSeconds = 15,
    [switch]$Worker
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2

function Result($Status, $Phone, $Desktop, $Complete) {
    @{
        status=$Status; phone_marker_visible=[bool]$Phone
        desktop_marker_visible=[bool]$Desktop; same_active_feed=[bool]($Phone -and $Desktop)
        complete=[bool]$Complete; private_text_exported=$false; identifiers_exported=$false
        messages_sent=0; crm_contacted=$false
    }
}

if (!$Worker) {
    $info = New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $info.Arguments = '-NoProfile -NonInteractive -File "' + $PSCommandPath + '" -Worker -RunId ' + $RunId + ' -MaxNodes ' + $MaxNodes
    $info.UseShellExecute = $false; $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true; $info.RedirectStandardError = $true
    $process = New-Object System.Diagnostics.Process; $process.StartInfo = $info
    [void]$process.Start(); $stdout = $process.StandardOutput.ReadToEndAsync()
    [void]$process.StandardError.ReadToEndAsync()
    if (!$process.WaitForExit($TimeoutSeconds * 1000)) {
        $process.Kill(); $process.WaitForExit(); Result 'timeout' $false $false $false | ConvertTo-Json -Compress
        $process.Dispose(); exit 2
    }
    if ($process.ExitCode -ne 0) {
        Result 'worker_failed' $false $false $false | ConvertTo-Json -Compress
        $process.Dispose(); exit 2
    }
    $value = $stdout.Result; $process.Dispose(); Write-Output $value; exit 0
}

try {
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
    $targets = @(Get-Process -Name Viber -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 })
    if ($targets.Count -ne 1) { Result 'target_not_unique' $false $false $false | ConvertTo-Json -Compress; exit 0 }
    $root = [System.Windows.Automation.AutomationElement]::FromHandle($targets[0].MainWindowHandle)
    $bounds = $root.Current.BoundingRectangle
    if ($bounds.IsEmpty -or $root.Current.IsOffscreen) { Result 'window_not_visible' $false $false $false | ConvertTo-Json -Compress; exit 0 }
    $phone = 'EGXG3-' + $RunId + '-PHONE'; $desktop = 'EGXG3-' + $RunId + '-DESKTOP'
    $walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
    $queue = New-Object 'System.Collections.Generic.Queue[object]'; $queue.Enqueue(@{element=$root;depth=0})
    $foundPhone = $false; $foundDesktop = $false; $visited = 0; $errors = 0
    while ($queue.Count -gt 0 -and $visited -lt $MaxNodes -and (-not ($foundPhone -and $foundDesktop))) {
        $item = $queue.Dequeue(); $visited++
        try {
            $element = $item.element; $current = $element.Current
            if ($current.ProcessId -ne $targets[0].Id -or $current.IsPassword) { continue }
            $rect = $current.BoundingRectangle
            $insideFeed = ((-not $rect.IsEmpty) -and (-not $current.IsOffscreen) -and $rect.Left -ge ($bounds.Left + $bounds.Width * 0.25) -and $rect.Right -le ($bounds.Left + $bounds.Width * 0.78) -and $rect.Top -ge ($bounds.Top + $bounds.Height * 0.08) -and $rect.Bottom -le ($bounds.Top + $bounds.Height * 0.92))
            if ($insideFeed) {
                $values = New-Object 'System.Collections.Generic.List[string]'
                if ($current.Name.Length -le 64) { $values.Add($current.Name) }
                $pattern = $null
                if ($element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) {
                    $value = $pattern.Current.Value; if ($null -ne $value -and $value.Length -le 64) { $values.Add($value) }
                }
                $pattern = $null
                if ($element.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$pattern)) {
                    $value = $pattern.DocumentRange.GetText(65); if ($null -ne $value -and $value.Length -le 64) { $values.Add($value) }
                }
                if ($values.Contains($phone)) { $foundPhone = $true }
                if ($values.Contains($desktop)) { $foundDesktop = $true }
            }
            if ($item.depth -lt 18) {
                $child = $walker.GetFirstChild($element)
                while ($null -ne $child -and ($queue.Count + $visited) -lt $MaxNodes) {
                    $queue.Enqueue(@{element=$child;depth=($item.depth+1)})
                    $child = $walker.GetNextSibling($child)
                }
            }
        } catch { $errors++ }
    }
    $complete = ($queue.Count -eq 0 -or ($foundPhone -and $foundDesktop)) -and $errors -eq 0
    Result $(if ($foundPhone -and $foundDesktop) {'active_marker_chat_verified'} else {'markers_not_visible'}) $foundPhone $foundDesktop $complete | ConvertTo-Json -Compress
} catch {
    Result 'observer_error' $false $false $false | ConvertTo-Json -Compress
    exit 2
}
