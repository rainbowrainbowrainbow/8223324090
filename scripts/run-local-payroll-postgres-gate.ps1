# Runs the payroll PostgreSQL integration gate against a disposable local Docker PostgreSQL 16.
# This helper intentionally wraps the canonical npm runner instead of replacing scripts/test-db-safety.js.

[CmdletBinding()]
param(
    [int]$HealthTimeoutSeconds = 120
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:ContainerName = "eventgenix-payroll-pg-$((New-Guid).ToString('N').Substring(0, 12))"
$script:ContainerCreated = $false
$script:CleanupFailed = $false
$script:ExitCode = 0
$script:DockerPath = $null

$PostgresImage = 'postgres:16'
$DatabaseName = 'eventgenix_disposable_test'
$DatabaseUser = 'postgres'
$ResetConfirmation = 'RESET_DISPOSABLE_TEST_DATABASE'
$DisposableLabelKey = 'com.eventgenix.disposable'
$DisposableLabel = "$DisposableLabelKey=true"
$PurposeLabelKey = 'com.eventgenix.purpose'
$PurposeLabelValue = 'local-payroll-postgres-gate'
$PurposeLabel = "$PurposeLabelKey=$PurposeLabelValue"

function New-DisposablePassword {
    $bytes = New-Object byte[] 24
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $rng.GetBytes($bytes)
    } finally {
        $rng.Dispose()
    }
    return ([Convert]::ToBase64String($bytes).TrimEnd('=') -replace '\+', '-' -replace '/', '_')
}

function Resolve-RequiredTool {
    param([string[]]$Names, [string]$FriendlyName)
    foreach ($name in $Names) {
        $command = Get-Command $name -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($command) {
            return $command.Source
        }
    }
    throw "$FriendlyName is required but was not found on PATH. Install or start it outside this helper, then retry."
}

function Join-ProcessArguments {
    param([string[]]$Arguments)
    $quoted = @()
    foreach ($argument in $Arguments) {
        $value = [string]$argument
        if ($value -match '^[A-Za-z0-9_./:=+@,-]+$') {
            $quoted += $value
        } else {
            $quoted += '"' + ($value -replace '\\', '\\' -replace '"', '\"') + '"'
        }
    }
    return ($quoted -join ' ')
}

function Remove-SensitiveEnvironment {
    param([System.Collections.Specialized.StringDictionary]$Environment)
    $keys = @($Environment.Keys)
    foreach ($key in $keys) {
        $isProtectedConnection = $key -in @('DATABASE_URL', 'PRODUCTION_DATABASE_URL', 'LIVE_DATABASE_URL')
        $isSensitive = $key -match '(TOKEN|SECRET|API[_-]?KEY|WEBHOOK|SMTP|SENDGRID|TWILIO|STRIPE|OPENAI|ANTHROPIC|GEMINI|PINATA|CLOUDINARY|S3_|AWS_|OMNI|TELEGRAM|REPORT_BOT|KLESHNYA)'
        if (($key -match '^RAILWAY_') -or $isProtectedConnection -or $isSensitive) {
            [void]$Environment.Remove($key)
        }
    }
}

function Invoke-ProcessWithEnvironment {
    param(
        [string]$FilePath,
        [string[]]$Arguments,
        [hashtable]$ExtraEnvironment = @{},
        [switch]$SanitizeSensitiveEnvironment
    )

    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $FilePath
    $startInfo.Arguments = Join-ProcessArguments -Arguments $Arguments
    $startInfo.WorkingDirectory = (Get-Location).Path
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardOutput = $false
    $startInfo.RedirectStandardError = $false
    $startInfo.CreateNoWindow = $false

    if ($SanitizeSensitiveEnvironment) {
        Remove-SensitiveEnvironment -Environment $startInfo.EnvironmentVariables
    }
    foreach ($key in $ExtraEnvironment.Keys) {
        $startInfo.EnvironmentVariables[$key] = [string]$ExtraEnvironment[$key]
    }

    $process = [System.Diagnostics.Process]::Start($startInfo)
    $process.WaitForExit()
    return $process.ExitCode
}

function Invoke-CheckedProcess {
    param(
        [string]$FilePath,
        [string[]]$Arguments,
        [string]$Description
    )
    $exitCode = Invoke-ProcessWithEnvironment -FilePath $FilePath -Arguments $Arguments -SanitizeSensitiveEnvironment
    if ($exitCode -ne 0) {
        throw "$Description failed with exit code $exitCode"
    }
}

function Assert-LocalExecutionEnvironment {
    if ($env:NODE_ENV -eq 'production' -or $env:RAILWAY_ENVIRONMENT -or $env:RAILWAY_PROJECT_ID -or $env:RAILWAY_SERVICE_ID) {
        throw 'Local payroll PostgreSQL gate is blocked when production/Railway environment markers are present.'
    }
}

function Assert-DockerReady {
    $script:DockerPath = Resolve-RequiredTool -Names @('docker.exe', 'docker') -FriendlyName 'Docker CLI'
    & $script:DockerPath info --format '{{.ServerVersion}}' *> $null
    if ($LASTEXITCODE -ne 0) {
        throw 'Docker daemon is not reachable. Start Docker Desktop and wait until it is running, then retry.'
    }
}

function Get-DockerLabelValue {
    param([string]$LabelKey)
    $json = & $script:DockerPath inspect --format '{{json .Config.Labels}}' $script:ContainerName 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw "Could not inspect disposable container $script:ContainerName"
    }
    $labels = ($json | Select-Object -First 1) | ConvertFrom-Json
    $property = $labels.PSObject.Properties[$LabelKey]
    if (-not $property) {
        return ''
    }
    return ([string]$property.Value).Trim()
}

function Get-PostgresHostPort {
    $mapping = & $script:DockerPath port $script:ContainerName '5432/tcp' 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw "Could not read mapped PostgreSQL port for $script:ContainerName"
    }
    $line = @($mapping | Where-Object { $_ })[0]
    if (-not $line -or $line -notmatch '^127\.0\.0\.1:(\d+)$') {
        throw "PostgreSQL port must be bound only to 127.0.0.1; got '$line'"
    }
    return $Matches[1]
}

function Wait-DisposablePostgresHealth {
    $deadline = (Get-Date).AddSeconds($HealthTimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $status = & $script:DockerPath inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' $script:ContainerName 2>$null
        if ($LASTEXITCODE -ne 0) {
            throw "Could not inspect health for $script:ContainerName"
        }
        $status = ([string]$status).Trim()
        if ($status -eq 'healthy') {
            return
        }
        if ($status -eq 'exited' -or $status -eq 'dead') {
            throw "Disposable PostgreSQL container exited before becoming healthy."
        }
        Start-Sleep -Seconds 2
    }
    throw "Disposable PostgreSQL did not become healthy within $HealthTimeoutSeconds seconds."
}

function Remove-CreatedContainer {
    if (-not $script:ContainerCreated) {
        return
    }
    try {
        $disposable = Get-DockerLabelValue -LabelKey $DisposableLabelKey
        $purpose = Get-DockerLabelValue -LabelKey $PurposeLabelKey
        if ($disposable -ne 'true' -or $purpose -ne $PurposeLabelValue) {
            throw "Refusing cleanup: $script:ContainerName does not have the expected EventGenix disposable labels."
        }
        & $script:DockerPath rm --force --volumes $script:ContainerName *> $null
        if ($LASTEXITCODE -ne 0) {
            throw "docker rm failed for $script:ContainerName"
        }
        Write-Host '[local-payroll-postgres-gate] Disposable PostgreSQL container removed.'
    } catch {
        $script:CleanupFailed = $true
        [Console]::Error.WriteLine("[local-payroll-postgres-gate] Cleanup failed: $($_.Exception.Message)")
    }
}

try {
    Assert-LocalExecutionEnvironment
    $npmPath = Resolve-RequiredTool -Names @('npm.cmd', 'npm') -FriendlyName 'npm'

    Write-Host '[local-payroll-postgres-gate] Checking Node/npm runtime...'
    Invoke-CheckedProcess -FilePath $npmPath -Arguments @('run', 'check:runtime') -Description 'npm run check:runtime'

    Write-Host '[local-payroll-postgres-gate] Checking Docker CLI and daemon...'
    Assert-DockerReady

    $databasePassword = New-DisposablePassword
    Write-Host "[local-payroll-postgres-gate] Starting disposable PostgreSQL $PostgresImage on 127.0.0.1 with a random host port..."
    $dockerRunArgs = @(
        'run',
        '--detach',
        '--name', $script:ContainerName,
        '--label', $DisposableLabel,
        '--label', $PurposeLabel,
        '--publish', '127.0.0.1::5432',
        '--tmpfs', '/var/lib/postgresql/data:rw',
        '--env', "POSTGRES_USER=$DatabaseUser",
        '--env', "POSTGRES_PASSWORD=$databasePassword",
        '--env', "POSTGRES_DB=$DatabaseName",
        '--health-cmd', "pg_isready -U $DatabaseUser -d $DatabaseName",
        '--health-interval', '2s',
        '--health-timeout', '2s',
        '--health-retries', '60',
        $PostgresImage
    )
    & $script:DockerPath @dockerRunArgs *> $null
    if ($LASTEXITCODE -ne 0) {
        throw "Could not start disposable PostgreSQL $PostgresImage container."
    }
    $script:ContainerCreated = $true

    $hostPort = Get-PostgresHostPort
    Wait-DisposablePostgresHealth

    $testDatabaseUrl = "postgresql://${DatabaseUser}:$databasePassword@127.0.0.1:$hostPort/$DatabaseName"
    Write-Host '[local-payroll-postgres-gate] Running canonical payroll integration command: npm run test:integration:payroll-profiles:isolated'
    $testExitCode = Invoke-ProcessWithEnvironment `
        -FilePath $npmPath `
        -Arguments @('run', 'test:integration:payroll-profiles:isolated') `
        -SanitizeSensitiveEnvironment `
        -ExtraEnvironment @{
            TEST_DATABASE_URL = $testDatabaseUrl
            TEST_DATABASE_RESET_CONFIRM = $ResetConfirmation
            NODE_ENV = 'test'
        }

    if ($testExitCode -ne 0) {
        throw "Canonical payroll integration command failed with exit code $testExitCode"
    }
    Write-Host '[local-payroll-postgres-gate] Payroll PostgreSQL integration passed.'
} catch {
    $script:ExitCode = 1
    [Console]::Error.WriteLine("[local-payroll-postgres-gate] $($_.Exception.Message)")
} finally {
    Remove-CreatedContainer
    if ($script:CleanupFailed) {
        $script:ExitCode = 1
    }
}

exit $script:ExitCode



