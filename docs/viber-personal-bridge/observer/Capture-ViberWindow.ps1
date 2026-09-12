$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public static class EgRect{[StructLayout(LayoutKind.Sequential)]public struct R{public int L,T,Right,Bottom;}[DllImport("user32.dll")]public static extern bool SetProcessDPIAware();[DllImport("user32.dll")]public static extern bool GetWindowRect(IntPtr h,out R r);}'
[void][EgRect]::SetProcessDPIAware()
$targets=@(Get-Process Viber -ErrorAction SilentlyContinue|Where-Object{$_.MainWindowHandle-ne 0})
if($targets.Count-ne 1){throw 'target'}
$rect=New-Object EgRect+R;if(-not [EgRect]::GetWindowRect($targets[0].MainWindowHandle,[ref]$rect)){throw 'bounds'}
$bitmap=New-Object Drawing.Bitmap ($rect.Right-$rect.L),($rect.Bottom-$rect.T)
$graphics=[Drawing.Graphics]::FromImage($bitmap)
try{$graphics.CopyFromScreen($rect.L,$rect.T,0,0,$bitmap.Size);$bitmap.Save((Join-Path $env:TEMP 'eventgenix-viber-current.png'),[Drawing.Imaging.ImageFormat]::Png)}finally{$graphics.Dispose();$bitmap.Dispose()}
'CAPTURED'
