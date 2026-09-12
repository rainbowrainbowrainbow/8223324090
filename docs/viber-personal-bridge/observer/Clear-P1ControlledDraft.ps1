[CmdletBinding()]
param([Parameter(Mandatory=$true)][ValidatePattern('^[0-9A-F]{8}$')][string]$RunId,[Parameter(Mandatory=$true)][ValidatePattern('^[0-9A-F]{8}$')][string]$TestId)
$ErrorActionPreference='Stop';Set-StrictMode -Version 2
function Out($s,$c){@{status=$s;error_code=$c;draft_cleared=($s-eq'cleared');messages_sent=0;private_text_exported=$false}|ConvertTo-Json -Compress}
try{
 Add-Type -AssemblyName UIAutomationClient;Add-Type -AssemblyName UIAutomationTypes;Add-Type -AssemblyName System.Windows.Forms
 $t=@(Get-Process Viber -ErrorAction SilentlyContinue|Where-Object{$_.MainWindowHandle-ne 0});if($t.Count-ne 1){Out 'rejected' 'TARGET_NOT_UNIQUE';exit 0}
 $root=[Windows.Automation.AutomationElement]::FromHandle($t[0].MainWindowHandle);$rb=$root.Current.BoundingRectangle
 $all=$root.FindAll([Windows.Automation.TreeScope]::Descendants,[Windows.Automation.Condition]::TrueCondition);$found=New-Object 'Collections.Generic.List[object]'
 foreach($e in $all){$x=$e.Current;$r=$x.BoundingRectangle;$p=$null;if($x.ControlType.Id-eq 50004-and(-not $r.IsEmpty)-and(-not $x.IsOffscreen)-and $x.IsEnabled-and $r.Top-ge($rb.Top+$rb.Height*.82)-and $r.Width-gt 200-and $e.TryGetCurrentPattern([Windows.Automation.ValuePattern]::Pattern,[ref]$p)-and(-not $p.Current.IsReadOnly)){$found.Add(@{e=$e;p=$p})}}
 if($found.Count-ne 1){Out 'rejected' 'COMPOSER_AMBIGUOUS';exit 0}
 $expected='EGXP1-'+$RunId+'-'+$TestId+'-SEND';if($found[0].p.Current.Value-ne $expected){Out 'rejected' 'DRAFT_NOT_OWNED';exit 0}
 $found[0].e.SetFocus();[Windows.Forms.SendKeys]::SendWait('^a{DEL}');Start-Sleep -Milliseconds 100
 if($found[0].p.Current.Value.Length-ne 0){Out 'failed' 'CLEAR_NOT_VERIFIED';exit 2};Out 'cleared' ''
}catch{Out 'failed' 'CLEAR_FAILED';exit 2}
