# Requires Docker Desktop in Linux container mode and the two images below.
# Uses only disposable containers bound to localhost. No saved app connections are read.
$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$suffix = [guid]::NewGuid().ToString('N').Substring(0, 10)
$pg = "datagoblin-perf-pg-$suffix"
$sql = "datagoblin-perf-sql-$suffix"
$ownedContainers = @()
$keys = @('DATAGOBLIN_PERF_ISOLATED','DATAGOBLIN_PERF_PG_PORT','DATAGOBLIN_PERF_SQL_PORT','DATAGOBLIN_PERF_REPORT_DIR')
$previous = @{}
foreach ($key in $keys) { $previous[$key] = [Environment]::GetEnvironmentVariable($key, 'Process') }
try {
    docker run --detach --rm --name $pg --publish 127.0.0.1::5432 --env POSTGRES_PASSWORD=GoblinPerf_2026_TestOnly --env POSTGRES_DB=datagoblin_perf postgres:17-alpine | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not start disposable PostgreSQL.' }
    $ownedContainers += $pg
    docker run --detach --rm --name $sql --publish 127.0.0.1::1433 --env ACCEPT_EULA=Y --env MSSQL_SA_PASSWORD=GoblinPerf_2026_TestOnly --env MSSQL_PID=Developer mcr.microsoft.com/mssql/server:2022-CU14-ubuntu-22.04 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not start disposable SQL Server.' }
    $ownedContainers += $sql
    $pgAddress = docker port $pg 5432
    if ($LASTEXITCODE -ne 0) { throw 'Could not read PostgreSQL port.' }
    $sqlAddress = docker port $sql 1433
    if ($LASTEXITCODE -ne 0) { throw 'Could not read SQL Server port.' }
    $env:DATAGOBLIN_PERF_ISOLATED = 'yes'
    $env:DATAGOBLIN_PERF_PG_PORT = ($pgAddress -split ':')[-1].Trim()
    $env:DATAGOBLIN_PERF_SQL_PORT = ($sqlAddress -split ':')[-1].Trim()
    $env:DATAGOBLIN_PERF_REPORT_DIR = Join-Path $project ("performance-results/" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
    cargo test --manifest-path (Join-Path $project 'src-tauri/Cargo.toml') live_perf:: -- --ignored --nocapture --test-threads=1
    if ($LASTEXITCODE -ne 0) { throw "Performance checks failed. Partial reports: $env:DATAGOBLIN_PERF_REPORT_DIR" }
    Write-Output "Performance checks passed. Reports: $env:DATAGOBLIN_PERF_REPORT_DIR"
} finally {
    foreach ($name in $ownedContainers) { docker rm --force $name | Out-Null }
    foreach ($key in $keys) { [Environment]::SetEnvironmentVariable($key, $previous[$key], 'Process') }
}
