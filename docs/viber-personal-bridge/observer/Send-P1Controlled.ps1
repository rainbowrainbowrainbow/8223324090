[CmdletBinding()]
param(
 [Parameter(Mandatory=$true)][ValidatePattern('^[0-9A-F]{8}$')][string]$RunId,
 [Parameter(Mandatory=$true)][ValidatePattern('^[0-9A-F]{8}$')][string]$TestId,
 [ValidatePattern('^[0-9A-F]{8}$')][string]$AnchorTestId='',
 [switch]$PeerOpenedByAnchor,
 [ValidateLength(0,1000)][string]$ExpectedHeaderBase64='',
 [ValidateLength(0,3000)][string]$ReplyTextBase64=''
)
$ErrorActionPreference='Stop';Set-StrictMode -Version 2
function Out($Status,$Code,$Attempt){@{status=$Status;error_code=$Code;dispatch_count=$Attempt;delivery_verified=$false;private_text_exported=$false;crm_contacted=$false}|ConvertTo-Json -Compress}
$claim=$null;$attempt=0
try{
 Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public static class EgSendDpi{[DllImport("user32.dll")]public static extern bool SetProcessDPIAware();}'
 [void][EgSendDpi]::SetProcessDPIAware()
 Add-Type -AssemblyName UIAutomationClient;Add-Type -AssemblyName UIAutomationTypes;Add-Type -AssemblyName System.Windows.Forms
 Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public static class EgForeground{[DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();}'
 $t=@(Get-Process Viber -ErrorAction SilentlyContinue|Where-Object{$_.MainWindowHandle-ne 0})
 if($t.Count-ne 1){Out 'rejected' 'TARGET_NOT_UNIQUE' 0;exit 0}
 $root=[Windows.Automation.AutomationElement]::FromHandle($t[0].MainWindowHandle);$rb=$root.Current.BoundingRectangle
 if($rb.IsEmpty-or $root.Current.IsOffscreen){Out 'rejected' 'WINDOW_NOT_VISIBLE' 0;exit 0}
 $expectedHeader=''
 if($ExpectedHeaderBase64){
  try{$expectedHeader=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($ExpectedHeaderBase64))}catch{Out 'rejected' 'HEADER_ENCODING_INVALID' 0;exit 0}
  if($expectedHeader.Length-lt 1-or $expectedHeader.Length-gt 100-or $expectedHeader.Contains("`0")-or $expectedHeader.Contains("`r")-or $expectedHeader.Contains("`n")){Out 'rejected' 'HEADER_TEXT_INVALID' 0;exit 0}
 }
 $phone='EGXG3-'+$RunId+'-PHONE';$desktop='EGXG3-'+$RunId+'-DESKTOP';$continuity=$(if($AnchorTestId){'EGXP1-'+$RunId+'-'+$AnchorTestId+'-SEND'}else{''})
 $walker=[Windows.Automation.TreeWalker]::RawViewWalker;$q=New-Object 'Collections.Generic.Queue[object]';$q.Enqueue(@{e=$root;d=0})
 $fp=$false;$fd=$false;$fc=$false;$fh=$false;$visited=0
 while($q.Count-gt 0-and $visited-lt 700-and (-not(($fp-and $fd)-or $fc))){
  $i=$q.Dequeue();$visited++;$e=$i.e;$x=$e.Current
  if($x.ProcessId-ne $t[0].Id-or $x.IsPassword){continue}
  $r=$x.BoundingRectangle;$inside=((-not $r.IsEmpty)-and(-not $x.IsOffscreen)-and $r.Left-ge($rb.Left+$rb.Width*.25)-and $r.Right-le($rb.Left+$rb.Width*.78)-and $r.Top-ge($rb.Top+$rb.Height*.08)-and $r.Bottom-le($rb.Top+$rb.Height*.92))
  if($inside){
   $v=New-Object 'Collections.Generic.List[string]';if($x.Name.Length-le 64){$v.Add($x.Name)}
   $p=$null;if($e.TryGetCurrentPattern([Windows.Automation.ValuePattern]::Pattern,[ref]$p)){$s=$p.Current.Value;if($null-ne $s-and $s.Length-le 64){$v.Add($s)}}
   $p=$null;if($e.TryGetCurrentPattern([Windows.Automation.TextPattern]::Pattern,[ref]$p)){$s=$p.DocumentRange.GetText(65);if($null-ne $s-and $s.Length-le 64){$v.Add($s)}}
   if($v.Contains($phone)){$fp=$true};if($v.Contains($desktop)){$fd=$true}
   if($continuity-and $v.Contains($continuity)){$fc=$true}
  }
  if($expectedHeader-and(-not $r.IsEmpty)-and(-not $x.IsOffscreen)-and $r.Left-ge($rb.Left+$rb.Width*.15)-and $r.Top-ge$rb.Top-and $r.Bottom-le($rb.Top+$rb.Height*.18)){
   $hv=New-Object 'Collections.Generic.List[string]';if($x.Name.Length-le 128){$hv.Add($x.Name)}
   $p=$null;if($e.TryGetCurrentPattern([Windows.Automation.ValuePattern]::Pattern,[ref]$p)){$s=$p.Current.Value;if($null-ne $s-and $s.Length-le 128){$hv.Add($s)}}
   $p=$null;if($e.TryGetCurrentPattern([Windows.Automation.TextPattern]::Pattern,[ref]$p)){$s=$p.DocumentRange.GetText(129);if($null-ne $s-and $s.Length-le 128){$hv.Add($s)}}
   if($hv.Contains($expectedHeader)){$fh=$true}
  }
  if($i.d-lt 18){$c=$walker.GetFirstChild($e);while($null-ne $c-and($q.Count+$visited)-lt 700){$q.Enqueue(@{e=$c;d=($i.d+1)});$c=$walker.GetNextSibling($c)}}
 }
 if($expectedHeader-and(-not $fh)){Out 'rejected' 'EXPECTED_HEADER_NOT_FOUND' 0;exit 0}
 if(-not(($fp-and $fd)-or $fc-or $PeerOpenedByAnchor-or $fh)){Out 'rejected' 'ACTIVE_CHAT_UNVERIFIED' 0;exit 0}
 $all=$root.FindAll([Windows.Automation.TreeScope]::Descendants,[Windows.Automation.Condition]::TrueCondition)
 $edits=New-Object 'Collections.Generic.List[object]';$buttons=New-Object 'Collections.Generic.List[object]'
 foreach($e in $all){
  $x=$e.Current;$r=$x.BoundingRectangle
  if($r.IsEmpty-or $x.IsOffscreen-or(-not $x.IsEnabled)-or $r.Top-lt($rb.Top+$rb.Height*.82)){continue}
  $p=$null
  if($x.ControlType.Id-eq 50004-and $r.Width-gt 500-and $r.Left-ge($rb.Left+$rb.Width*.25)-and $r.Right-le($rb.Left+$rb.Width*.97)-and $e.TryGetCurrentPattern([Windows.Automation.ValuePattern]::Pattern,[ref]$p)-and(-not $p.Current.IsReadOnly)){$edits.Add(@{e=$e;p=$p})}
  $p=$null
  if($x.ControlType.Id-eq 50000-and $x.AutomationId.EndsWith('SendToolbarButton')-and $r.Width-ge 45-and $r.Height-ge 45-and $r.Left-ge($rb.Left+$rb.Width*.55)-and $r.Right-le($rb.Left+$rb.Width*.995)-and $e.TryGetCurrentPattern([Windows.Automation.InvokePattern]::Pattern,[ref]$p)){$buttons.Add(@{e=$e;p=$p})}
 }
 if($edits.Count-ne 1-or $buttons.Count-ne 1){Out 'rejected' 'COMPOSER_AMBIGUOUS' 0;exit 0}
 if($edits[0].p.Current.Value.Length-ne 0){Out 'rejected' 'DRAFT_PRESENT' 0;exit 0}
 $state=Join-Path $env:LOCALAPPDATA 'EventGenixViberBridgeRuntime';[IO.Directory]::CreateDirectory($state)|Out-Null
 $claimPath=Join-Path $state ('send-'+$RunId+'-'+$TestId+'.claim')
 try{$claim=[IO.File]::Open($claimPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)}catch [IO.IOException]{Out 'rejected' 'COMMAND_ALREADY_CLAIMED' 0;exit 0}
 $bytes=[Text.Encoding]::ASCII.GetBytes('dispatch_started');$claim.Write($bytes,0,$bytes.Length);$claim.Flush($true);$claim.Close();$claim=$null;$attempt=1
 if($ReplyTextBase64){
  try{$text=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($ReplyTextBase64))}catch{Out 'unknown' 'REPLY_ENCODING_INVALID' 1;exit 0}
  if($text.Length-lt 1-or $text.Length-gt 500-or $text.Contains("`0")-or $text.Contains("`r")-or $text.Contains("`n")){Out 'unknown' 'REPLY_TEXT_INVALID' 1;exit 0}
 }else{$text='EGXP1-'+$RunId+'-'+$TestId+'-SEND'}
 $edits[0].e.SetFocus();if($ReplyTextBase64){$edits[0].p.SetValue($text)}else{[Windows.Forms.SendKeys]::SendWait($text)}
 if($edits[0].p.Current.Value-ne $text){Out 'unknown' 'DRAFT_NOT_VERIFIED' 1;exit 0}
 if([EgForeground]::GetForegroundWindow()-ne $t[0].MainWindowHandle){Out 'unknown' 'FOREGROUND_NOT_VERIFIED' 1;exit 0}
 [Windows.Forms.SendKeys]::SendWait('{ENTER}');Start-Sleep -Milliseconds 250
 Out 'submitted_unconfirmed' '' 1
}catch{if($null-ne $claim){$claim.Close()};Out $(if($attempt-eq 1){'unknown'}else{'rejected'}) 'UI_OPERATION_FAILED' $attempt;exit 2}
