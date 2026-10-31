param(
  [switch]$Smoke = $false,
  [string]$TargetUrl = "http://host.docker.internal:4000",
  [switch]$Compose = $false,
  [string]$TestScript = "k6-feed-session-loadtest.js"
)

$ErrorActionPreference = "Stop"

$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Definition
$ROOT_DIR = Split-Path -Parent (Split-Path -Parent $SCRIPT_DIR)
Set-Location $ROOT_DIR

Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "         [K6 NEWSFEED LOAD TESTING RUNNER]                      " -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "Target URL:  $TargetUrl"
Write-Host "Smoke Test:  $Smoke"
Write-Host "Compose:     $Compose"

# Ensure output directory exists
$RESULTS_DIR = Join-Path $SCRIPT_DIR "results"
if (-not (Test-Path $RESULTS_DIR)) {
  New-Item -ItemType Directory -Force -Path $RESULTS_DIR | Out-Null
}

$SMOKE_ENV = if ($Smoke) { "true" } else { "false" }

# Start background resource monitoring job (samples docker stats every 2.5s)
$STATS_FILE = Join-Path $RESULTS_DIR "raw_docker_stats.csv"
if (Test-Path $STATS_FILE) { Remove-Item $STATS_FILE -Force }

Write-Host "`n[*] Starting background Docker stats monitoring..." -ForegroundColor Gray
$monitorScript = {
  param($file)
  while ($true) {
    $timestamp = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ss")
    $stats = docker stats --no-stream --format '{{.Name}},{{.CPUPerc}},{{.MemUsage}},{{.MemPerc}}'
    foreach ($line in $stats) {
      if ($line) {
        Add-Content -Path $file -Value "$timestamp,$line"
      }
    }
    Start-Sleep -Milliseconds 2500
  }
}
$monitorJob = Start-Job -ScriptBlock $monitorScript -ArgumentList $STATS_FILE

try {
  if ($Compose) {
    Write-Host "`n[*] Executing K6 via Docker Compose override..." -ForegroundColor Yellow
    $env:SMOKE_TEST = $SMOKE_ENV
    $env:TARGET_URL = "http://api-gateway:4000"
    docker compose -f docker-compose.yml -f docker-compose.loadtest.yml up --abort-on-container-exit --exit-code-from k6 k6
  } else {
    Write-Host "`n[*] Executing Grafana K6 Docker container..." -ForegroundColor Yellow
    docker run --rm -i `
      --cpus="1.5" `
      --memory="512m" `
      --add-host="host.docker.internal:host-gateway" `
      -e "TARGET_URL=$TargetUrl" `
      -e "SMOKE_TEST=$SMOKE_ENV" `
      -v "${RESULTS_DIR}:/scripts/results" `
      -v "${SCRIPT_DIR}:/scripts" `
      grafana/k6:latest run /scripts/$TestScript
  }
} finally {
  # Stop and clean up monitoring job
  Write-Host "`n[*] Stopping Docker stats monitor..." -ForegroundColor Gray
  Stop-Job $monitorJob -ErrorAction SilentlyContinue | Out-Null
  Receive-Job $monitorJob -ErrorAction SilentlyContinue | Out-Null
  Remove-Job $monitorJob -ErrorAction SilentlyContinue | Out-Null
}

# Analyze container resource usage
if (Test-Path $STATS_FILE) {
  Write-Host "`n================================================================" -ForegroundColor Cyan
  Write-Host "         [DOCKER RESOURCE CONSUMPTION SUMMARY]                  " -ForegroundColor Cyan
  Write-Host "================================================================" -ForegroundColor Cyan

  $lines = Get-Content $STATS_FILE
  $parsedSamples = @()
  foreach ($line in $lines) {
    $parts = $line.Split(",")
    if ($parts.Length -ge 5) {
      $container = $parts[1]
      $cpuStr = $parts[2].Replace("%", "").Trim()
      $memUsageStr = $parts[3].Trim()
      $memPercStr = $parts[4].Replace("%", "").Trim()
      
      $cpuVal = 0.0
      [double]::TryParse($cpuStr, [System.Globalization.NumberStyles]::Any, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$cpuVal) | Out-Null

      $memPercVal = 0.0
      [double]::TryParse($memPercStr, [System.Globalization.NumberStyles]::Any, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$memPercVal) | Out-Null

      $parsedSamples += [PSCustomObject]@{
        Container = $container
        CPU = $cpuVal
        MemUsage = $memUsageStr
        MemPerc = $memPercVal
      }
    }
  }

  $grouped = $parsedSamples | Group-Object Container
  $summaryList = @()

  foreach ($group in $grouped) {
    $cpuMax = ($group.Group | Measure-Object -Property CPU -Maximum).Maximum
    $cpuAvg = ($group.Group | Measure-Object -Property CPU -Average).Average
    $memPercMax = ($group.Group | Measure-Object -Property MemPerc -Maximum).Maximum
    $memPercAvg = ($group.Group | Measure-Object -Property MemPerc -Average).Average
    $lastUsage = ($group.Group | Select-Object -Last 1).MemUsage

    $summaryList += [PSCustomObject]@{
      Container = $group.Name
      "Peak CPU %" = [Math]::Round($cpuMax, 2)
      "Avg CPU %" = [Math]::Round($cpuAvg, 2)
      "Peak Mem %" = [Math]::Round($memPercMax, 2)
      "Avg Mem %" = [Math]::Round($memPercAvg, 2)
      "Mem Usage / Limit" = $lastUsage
    }
  }

  $summaryList | Format-Table -AutoSize
  $jsonOutput = $summaryList | ConvertTo-Json -Depth 3
  Set-Content -Path (Join-Path $RESULTS_DIR "docker-resource-usage.json") -Value $jsonOutput
}

Write-Host "`n[+] K6 test execution completed!" -ForegroundColor Green
Write-Host "Results saved to: $RESULTS_DIR/summary.json" -ForegroundColor Green
Write-Host "Resource usage saved to: $RESULTS_DIR/docker-resource-usage.json" -ForegroundColor Green
