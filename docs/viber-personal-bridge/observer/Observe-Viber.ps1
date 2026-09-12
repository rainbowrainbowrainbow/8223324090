[CmdletBinding()]
param(
    [ValidateSet('Header','Profile')][string]$Region = 'Header',
    [ValidateRange(20,2000)][int]$MaxNodes = 500,
    [ValidateRange(5,60)][int]$TimeoutSeconds = 25,
    [switch]$SelfTest,
    [switch]$Worker
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2

function Measure-PrivateText($Value) {
    if ($null -eq $Value) { return @{ state='unavailable'; phone_like=$false } }
    if ($Value -isnot [string]) { return @{ state='unsupported'; phone_like=$false } }
    # A presence hint only; neither validity nor ownership of a number is inferred.
    $phone = [regex]::IsMatch($Value, '(?<!\d)\+[1-9](?:[\s().-]*\d){6,14}(?!\d)')
    return @{ state=$(if ($Value.Length -eq 0) {'empty'} else {'present'}); phone_like=$phone }
}

if ($SelfTest) {
    $checks = @(
        (Measure-PrivateText $null).state -eq 'unavailable'
        (Measure-PrivateText '').state -eq 'empty'
        (Measure-PrivateText 'synthetic name').phone_like -eq $false
        (Measure-PrivateText '+1 (202) 555-0100').phone_like -eq $true
        (Measure-PrivateText '2025550100').phone_like -eq $false
        (Measure-PrivateText 123).state -eq 'unsupported'
    )
    $serialized = Measure-PrivateText 'PRIVATE_TEXT +1 (202) 555-0100' | ConvertTo-Json -Compress
    if ($checks -contains $false -or $serialized.Contains('PRIVATE_TEXT') -or $serialized.Contains('202')) {
        throw 'Observer privacy self-test failed'
    }
    @{ status='passed'; checks=7; touches_viber=$false } | ConvertTo-Json
    exit 0
}

# A separate process bounds a blocked provider call. Never return partial output as success.
if (!$Worker) {
    $info = New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $info.Arguments = '-NoProfile -NonInteractive -File "' + $PSCommandPath + '" -Worker -Region ' + $Region + ' -MaxNodes ' + $MaxNodes
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $info
    [void]$process.Start()
    $stdout = $process.StandardOutput.ReadToEndAsync()
    $stderr = $process.StandardError.ReadToEndAsync()
    if (!$process.WaitForExit($TimeoutSeconds * 1000)) {
        $process.Kill()
        $process.WaitForExit()
        @{ status='observer_timeout'; complete=$false; verified_recipient=$false } | ConvertTo-Json
        $process.Dispose()
        exit 2
    }
    if ($process.ExitCode -ne 0) {
        # Do not echo PowerShell/provider errors, which may include source or UI values.
        @{ status='worker_failed'; complete=$false; verified_recipient=$false } | ConvertTo-Json
        $process.Dispose()
        exit 2
    }
    $result = $stdout.Result
    $process.Dispose()
    Write-Output $result
    exit 0
}

try {
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
    Add-Type -Path (Join-Path $PSScriptRoot 'LegacyProbe.cs')
    $targets = @(Get-Process -Name Viber -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 })
    if ($targets.Count -ne 1) {
        @{ status='target_not_unique'; count=$targets.Count; complete=$false; verified_recipient=$false } | ConvertTo-Json
        exit 0
    }
    $target = $targets[0]
    $root = [System.Windows.Automation.AutomationElement]::FromHandle($target.MainWindowHandle)
    $bounds = $root.Current.BoundingRectangle
    if ($bounds.IsEmpty -or $bounds.Width -le 0 -or $bounds.Height -le 0 -or $root.Current.IsOffscreen) {
        @{ status='window_not_visible'; complete=$false; verified_recipient=$false } | ConvertTo-Json
        exit 0
    }
    $walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
    $queue = New-Object 'System.Collections.Generic.Queue[object]'
    $queue.Enqueue(@{ element=$root; depth=0; path=[int[]]@() })
    $records = New-Object 'System.Collections.Generic.List[object]'
    $visited = 0; $pruned = 0; $errors = 0; $enumerationLimited = $false
    while ($queue.Count -gt 0 -and $visited -lt $MaxNodes) {
        $item = $queue.Dequeue()
        $visited++
        try {
            $element = $item.element
            $current = $element.Current
            if ($current.ProcessId -ne $target.Id) { $pruned++; continue }
            $automationId = $current.AutomationId
            # Prune known message, chat-list and composer branches before reading text.
            if ($automationId -match 'FeedDelegate|delegateLoader|QQuickTextEdit|SendToolbar|utnDelegate') { $pruned++; continue }
            $rect = $current.BoundingRectangle
            $hasRect = !$rect.IsEmpty -and $rect.Width -gt 0 -and $rect.Height -gt 0
            $left = $rect.Left - $bounds.Left; $top = $rect.Top - $bounds.Top
            $inside = $hasRect -and !$current.IsOffscreen -and !$current.IsPassword -and $rect.Height -le 100
            if ($Region -eq 'Header') {
                $inside = $inside -and $left -ge ($bounds.Width * 0.27) -and $top -ge 25 -and ($top + $rect.Height) -le ($bounds.Height * 0.20)
            } else {
                $inside = $inside -and $left -ge 0 -and ($left + $rect.Width) -le ($bounds.Width * 0.30) -and $top -ge 65 -and ($top + $rect.Height) -le ($bounds.Height * 0.24)
            }
            $child = $walker.GetFirstChild($element)
            # Read leaf fields only: parent TextPattern can aggregate unrelated descendants.
            if ($inside -and $null -eq $child) {
                $pattern = $null
                $valueSummary = @{ state='unsupported'; phone_like=$false }
                if ($element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) {
                    $valueSummary = Measure-PrivateText $pattern.Current.Value
                }
                $pattern = $null
                $textSummary = @{ state='unsupported'; phone_like=$false }
                if ($element.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$pattern)) {
                    $textSummary = Measure-PrivateText ($pattern.DocumentRange.GetText(256))
                }
                $legacy = [ViberObserver.LegacyProbe]::ReadNative($target.MainWindowHandle, [int[]]$item.path, $element.GetRuntimeId(), $target.Id)
                $records.Add(@{
                    node=$visited; depth=$item.depth; control_type_id=$current.ControlType.Id
                    automation_id=Measure-PrivateText $automationId
                    name=Measure-PrivateText $current.Name
                    value_pattern=$valueSummary; text_pattern=$textSummary
                    legacy_status=$legacy.Status
                    legacy_same_process=$legacy.SameProcess
                    legacy_same_runtime_id=$legacy.SameRuntimeId
                    legacy_name=Measure-PrivateText $legacy.Name
                    legacy_value=Measure-PrivateText $legacy.Value
                })
            }
            if ($item.depth -ge 16 -and $null -ne $child) { $enumerationLimited=$true; continue }
            $siblingIndex = 0
            while ($null -ne $child) {
                if (($queue.Count + $visited) -ge $MaxNodes) { $enumerationLimited=$true; break }
                $queue.Enqueue(@{ element=$child; depth=($item.depth+1); path=[int[]](@($item.path) + $siblingIndex) })
                $child = $walker.GetNextSibling($child)
                $siblingIndex++
            }
        } catch { $errors++ }
    }
    $legacyUnresolved = @($records | Where-Object { $_.legacy_status -notin @('read','unsupported') }).Count
    $incomplete = $queue.Count -gt 0 -or $enumerationLimited -or $errors -gt 0 -or $legacyUnresolved -gt 0 -or $records.Count -eq 0
    @{
        protocol='viber-uia-observer/1'; captured_at=[DateTime]::UtcNow.ToString('o')
        legacy_lookup='native_raw_tree_path'
        status=$(if ($incomplete) {'partial'} else {'observed'})
        complete=(!$incomplete); region=$Region; visited=$visited; pruned=$pruned; errors=$errors
        legacy_unresolved=$legacyUnresolved; enumeration_limited=$enumerationLimited
        region_is_heuristic=$true; verified_recipient=$false; text_limit=256
        nodes=$records.ToArray()
    } | ConvertTo-Json -Depth 8
} catch {
    @{ status='observer_error'; complete=$false; verified_recipient=$false } | ConvertTo-Json
    exit 2
}
