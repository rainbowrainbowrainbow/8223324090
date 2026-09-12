[CmdletBinding()]
param([ValidateRange(5,20)][int]$TimeoutSeconds=10, [switch]$Diagnostic, [switch]$Worker)
$ErrorActionPreference='Stop'; Set-StrictMode -Version 2
function Result($Status,$ComposerCount,$WritableCount,$ButtonCount,$InvokeCount,$BandWritable=0,$BandInvoke=0,$Candidates=@(),$DraftPresent=$false) {
    @{status=$Status;composer_count=$ComposerCount;writable_composer_count=$WritableCount
      send_button_count=$ButtonCount;invokable_send_button_count=$InvokeCount
      bottom_band_writable_count=$BandWritable;bottom_band_invoke_count=$BandInvoke
      diagnostic_candidates=$Candidates
      draft_present=[bool]$DraftPresent
      private_text_exported=$false;messages_sent=0;crm_contacted=$false}|ConvertTo-Json -Compress
}
if(!$Worker){
    $i=New-Object Diagnostics.ProcessStartInfo
    $i.FileName=Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $i.Arguments='-NoProfile -NonInteractive -File "'+$PSCommandPath+'" -Worker'+$(if($Diagnostic){' -Diagnostic'}else{''})
    $i.UseShellExecute=$false;$i.CreateNoWindow=$true;$i.RedirectStandardOutput=$true;$i.RedirectStandardError=$true
    $p=New-Object Diagnostics.Process;$p.StartInfo=$i;[void]$p.Start();$o=$p.StandardOutput.ReadToEndAsync();[void]$p.StandardError.ReadToEndAsync()
    if(!$p.WaitForExit($TimeoutSeconds*1000)){$p.Kill();$p.WaitForExit();Result 'timeout' 0 0 0 0;$p.Dispose();exit 2}
    if($p.ExitCode-ne 0){Result 'worker_failed' 0 0 0 0;$p.Dispose();exit 2}
    $v=$o.Result;$p.Dispose();Write-Output $v;exit 0
}
try{
    Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public static class EgInspectDpi{[DllImport("user32.dll")]public static extern bool SetProcessDPIAware();}'
    [void][EgInspectDpi]::SetProcessDPIAware()
    Add-Type -AssemblyName UIAutomationClient;Add-Type -AssemblyName UIAutomationTypes
    $t=@(Get-Process Viber -ErrorAction SilentlyContinue|Where-Object{$_.MainWindowHandle-ne 0})
    if($t.Count-ne 1){Result 'target_not_unique' 0 0 0 0 0 0;exit 0}
    $r=[Windows.Automation.AutomationElement]::FromHandle($t[0].MainWindowHandle)
    $rb=$r.Current.BoundingRectangle
    $c=$r.FindAll([Windows.Automation.TreeScope]::Descendants,(New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::AutomationIdProperty,'QQuickTextEdit')))
    $b=$r.FindAll([Windows.Automation.TreeScope]::Descendants,(New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::AutomationIdProperty,'SendToolbarButton')))
    $w=0;foreach($e in $c){$p=$null;if(!$e.Current.IsOffscreen-and $e.Current.IsEnabled-and $e.TryGetCurrentPattern([Windows.Automation.ValuePattern]::Pattern,[ref]$p)-and !$p.Current.IsReadOnly){$w++}}
    $n=0;foreach($e in $b){$p=$null;if(!$e.Current.IsOffscreen-and $e.Current.IsEnabled-and $e.TryGetCurrentPattern([Windows.Automation.InvokePattern]::Pattern,[ref]$p)){$n++}}
    $all=$r.FindAll([Windows.Automation.TreeScope]::Descendants,[Windows.Automation.Condition]::TrueCondition)
    $bw=0;$bi=0;$draft=$false;$candidates=New-Object 'System.Collections.Generic.List[object]'
    foreach($e in $all){
        $x=$e.Current;$q=$x.BoundingRectangle
        if($q.IsEmpty-or $x.IsOffscreen-or (-not $x.IsEnabled)-or $q.Top-lt ($rb.Top+$rb.Height*0.82)-or $q.Left-lt ($rb.Left+$rb.Width*0.15)-or $q.Right-gt ($rb.Left+$rb.Width*0.995)){continue}
        $writable=$false;$invokable=$false
        $p=$null;if($e.TryGetCurrentPattern([Windows.Automation.ValuePattern]::Pattern,[ref]$p)-and !$p.Current.IsReadOnly){$bw++;$writable=$true;if($x.ControlType.Id-eq 50004-and $q.Width-gt 200-and $p.Current.Value.Length-gt 0){$draft=$true}}
        $p=$null;if($e.TryGetCurrentPattern([Windows.Automation.InvokePattern]::Pattern,[ref]$p)){$bi++;$invokable=$true}
        if($Diagnostic -and ($writable -or $invokable)){$candidates.Add(@{type=$x.ControlType.Id;automation_id=$x.AutomationId;name=$(if($x.Name.Length-le 48){$x.Name}else{$x.Name.Substring(0,48)});x=[int]($q.Left-$rb.Left);y=[int]($q.Top-$rb.Top);w=[int]$q.Width;h=[int]$q.Height;writable=$writable;invokable=$invokable})}
    }
    $ready=($c.Count-eq 1-and $w-eq 1-and $b.Count-eq 1-and $n-eq 1)
    Result $(if($ready){'composer_ready'}elseif($bw-eq 1-and $bi-eq 1){'geometry_composer_ready'}else{'composer_unavailable'}) $c.Count $w $b.Count $n $bw $bi $candidates.ToArray() $draft
}catch{Result 'observer_error' 0 0 0 0;exit 2}
