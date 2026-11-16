# Uses disposable databases only. No saved application connections are read.
$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$suffix = [guid]::NewGuid().ToString('N').Substring(0, 10)
$pg = "datagoblin-join-pg-$suffix"
$sql = "datagoblin-join-sql-$suffix"
$ownedContainers = @()
$keys = @('DATAGOBLIN_JOIN_ISOLATED','DATAGOBLIN_JOIN_PG_PORT','DATAGOBLIN_JOIN_SQL_PORT')
$previous = @{}
foreach ($key in $keys) { $previous[$key] = [Environment]::GetEnvironmentVariable($key, 'Process') }
try {
    docker run --detach --rm --name $pg --publish 127.0.0.1::5432 --env POSTGRES_PASSWORD=GoblinJoin_TestOnly2026 --env POSTGRES_DB=datagoblin_join postgres:17-alpine | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not start disposable PostgreSQL.' }
    $ownedContainers += $pg
    docker run --detach --rm --name $sql --publish 127.0.0.1::1433 --env ACCEPT_EULA=Y --env MSSQL_SA_PASSWORD=GoblinJoin_TestOnly2026 --env MSSQL_PID=Developer mcr.microsoft.com/mssql/server:2022-CU14-ubuntu-22.04 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not start disposable SQL Server.' }
    $ownedContainers += $sql
    $pgAddress = docker port $pg 5432
    if ($LASTEXITCODE -ne 0) { throw 'Could not read PostgreSQL port.' }
    $sqlAddress = docker port $sql 1433
    if ($LASTEXITCODE -ne 0) { throw 'Could not read SQL Server port.' }
    $env:DATAGOBLIN_JOIN_ISOLATED = 'yes'
    $env:DATAGOBLIN_JOIN_PG_PORT = ($pgAddress -split ':')[-1].Trim()
    $env:DATAGOBLIN_JOIN_SQL_PORT = ($sqlAddress -split ':')[-1].Trim()
    cargo test --manifest-path (Join-Path $project 'src-tauri/Cargo.toml') join_edit::tests::live_join_transactions -- --ignored --nocapture
    if ($LASTEXITCODE -ne 0) { throw 'JOIN editing integration checks failed.' }
    Write-Output 'JOIN editing integration checks passed for PostgreSQL and SQL Server.'
} finally {
    foreach ($name in $ownedContainers) { docker rm --force $name | Out-Null }
    foreach ($key in $keys) { [Environment]::SetEnvironmentVariable($key, $previous[$key], 'Process') }
}
