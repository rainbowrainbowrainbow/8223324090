[CmdletBinding()]
param(
    [ValidateSet('en-US','ru')][string]$Language='en-US',
    [ValidateSet(1,2,3)][int]$Scale=1
)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null=[Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime]
$null=[Windows.Globalization.Language, Windows.Globalization, ContentType=WindowsRuntime]
$null=[Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType=WindowsRuntime]
$null=[Windows.Graphics.Imaging.SoftwareBitmap, Windows.Foundation, ContentType=WindowsRuntime]

function Await-OcrOperation($Operation, [Type]$ResultType) {
    $method = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetGenericArguments().Count -eq 1 -and
        $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    } | Select-Object -First 1
    $task = $method.MakeGenericMethod($ResultType).Invoke($null,@($Operation))
    if (!$task.Wait(10000)) { throw 'Local OCR operation timed out' }
    return $task.Result
}

function Get-StrictCandidate([string]$Text) {
    # No O/0 or I/1 substitution. Ambiguous/malformed lines are not repaired.
    $candidates = @([regex]::Matches($Text,'(?m)^\s*\+[1-9][0-9 ()-]{6,24}\s*$') | ForEach-Object {
        $digits = $_.Value -replace '[\s()-]',''
        if ($digits -match '^\+[1-9][0-9]{6,14}$') { $digits }
    })
    if ($candidates.Count -ne 1) { return $null }
    return $candidates[0]
}

# Independent fail-closed extraction checks. These are synthetic reserved examples.
$parserChecks = @(
    (Get-StrictCandidate '+1 (202) 555-0100') -eq '+12025550100'
    $null -eq (Get-StrictCandidate "+12025550100`n+12025550101")
    $null -eq (Get-StrictCandidate '+1202555O100')
    $null -eq (Get-StrictCandidate '12025550100')
    $null -eq (Get-StrictCandidate 'hello +12025550100')
)
if ($parserChecks -contains $false) { throw 'Strict candidate parser tests failed' }

$available = @([Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages | ForEach-Object {$_.LanguageTag})
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new($Language))
if ($null -eq $engine) {
    @{status='language_unavailable';available_languages=$available;verified_recipient=$false} | ConvertTo-Json
    exit 2
}
$cases = New-Object 'System.Collections.Generic.List[object]'
foreach ($theme in @('dark','light')) {
    foreach ($size in @(12,16,24)) {
        foreach ($peer in @('A','B')) {
            $expected = if ($peer -eq 'A') {'+12025550100'} else {'+12025550101'}
            $cases.Add(@{id="$theme-$size-$peer";size=$size;theme=$theme;lines=@('Synthetic contact',$expected);expected=$expected})
        }
    }
}
$cases.Add(@{id='two_numbers';size=16;theme='dark';lines=@('+12025550100','+12025550101');expected=$null})
$cases.Add(@{id='no_number';size=16;theme='dark';lines=@('Synthetic contact','Online');expected=$null})
$cases.Add(@{id='missing_plus';size=16;theme='dark';lines=@('Synthetic contact','12025550100');expected=$null})
$cases.Add(@{id='clipped_number';size=16;theme='dark';lines=@('Synthetic contact','+12025550100');expected=$null;clip=$true})
$results=New-Object 'System.Collections.Generic.List[object]'
foreach ($case in $cases) {
    $bitmap=$null; $graphics=$null; $font=$null; $brush=$null; $stream=$null; $random=$null; $software=$null
    try {
        $bitmap=New-Object System.Drawing.Bitmap 480,120
        $graphics=[System.Drawing.Graphics]::FromImage($bitmap)
        $bg=if($case.theme -eq 'dark'){[System.Drawing.Color]::FromArgb(30,30,30)}else{[System.Drawing.Color]::White}
        $fg=if($case.theme -eq 'dark'){[System.Drawing.Color]::White}else{[System.Drawing.Color]::Black}
        $graphics.Clear($bg)
        $graphics.TextRenderingHint=[System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
        $font=[System.Drawing.Font]::new('Segoe UI',[single]$case.size,[System.Drawing.FontStyle]::Regular,[System.Drawing.GraphicsUnit]::Pixel)
        $brush=[System.Drawing.SolidBrush]::new($fg)
        $y=12
        foreach($line in $case.lines) {
            $graphics.DrawString($line,$font,$brush,[single]12,[single]$y)
            $y+=36
        }
        if ($case.clip) {
            $cover=[System.Drawing.SolidBrush]::new($bg)
            try { $graphics.FillRectangle($cover,100,45,380,50) } finally { $cover.Dispose() }
        }
        if ($Scale -gt 1) {
            $scaled=[System.Drawing.Bitmap]::new($bitmap.Width*$Scale,$bitmap.Height*$Scale)
            $resizer=[System.Drawing.Graphics]::FromImage($scaled)
            try {
                $resizer.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                $resizer.DrawImage($bitmap,0,0,$scaled.Width,$scaled.Height)
            } finally {$resizer.Dispose()}
            $graphics.Dispose(); $graphics=$null
            $bitmap.Dispose(); $bitmap=$scaled
        }
        $stream=[System.IO.MemoryStream]::new()
        $bitmap.Save($stream,[System.Drawing.Imaging.ImageFormat]::Png)
        $stream.Position=0
        $random=[System.IO.WindowsRuntimeStreamExtensions]::AsRandomAccessStream($stream)
        $decoder=Await-OcrOperation ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($random)) ([Windows.Graphics.Imaging.BitmapDecoder])
        $software=Await-OcrOperation ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
        $ocr=Await-OcrOperation ($engine.RecognizeAsync($software)) ([Windows.Media.Ocr.OcrResult, Windows.Foundation, ContentType=WindowsRuntime])
        $text=(@($ocr.Lines | ForEach-Object {$_.Text}) -join "`n")
        $candidate=Get-StrictCandidate $text
        $passed=if($null -eq $case.expected){$null -eq $candidate}else{$candidate -ceq $case.expected}
        $results.Add(@{case_id=$case.id;passed=[bool]$passed;expected_candidate=($null -ne $case.expected);candidate_present=($null -ne $candidate);exact_match=($null -ne $case.expected -and $passed)})
    } catch {
        # Do not emit OCR text, image bytes, candidate values or exception details.
        $results.Add(@{case_id=$case.id;passed=$false;error='ocr_case_failed'})
    } finally {
        foreach($disposable in @($software,$random,$stream,$brush,$font,$graphics,$bitmap)) {
            if($null -ne $disposable){$disposable.Dispose()}
        }
    }
}
$failed=@($results | Where-Object {!$_.passed}).Count
@{protocol='local-ocr-feasibility/1';status=$(if($failed -eq 0){'synthetic_pass'}else{'synthetic_fail'});language=$Language;scale=$Scale;available_languages=$available;parser_checks=5;cases=$results.ToArray();total=$results.Count;failed=$failed;touches_viber=$false;images_written=$false;verified_recipient=$false} | ConvertTo-Json -Depth 5
if($failed -gt 0){exit 1}
