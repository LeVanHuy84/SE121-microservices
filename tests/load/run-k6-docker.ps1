param(
  [switch]$Smoke = $false,
  [ValidateSet("standard", "full", "stress", "sustained", "smoke")]
  [string]$Profile = "sustained",
  [ValidateSet("realistic", "fast", "relaxed")]
  [string]$Pacing = "realistic",
  [int]$VUs = 200,
  [int]$PagesPerSession = 8,
  [int]$NumUsers = 350,
  [string]$TargetUrl = "http://host.docker.internal:4000",
  [switch]$Compose = $false,
  [switch]$Build = $false,
  [string]$TestScript = "k6-feed-session-loadtest.js",
  [string]$Scenario = "",
  [switch]$KeepRawStats = $false
)

$ErrorActionPreference = "Stop"

$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Definition
$ROOT_DIR = Split-Path -Parent (Split-Path -Parent $SCRIPT_DIR)
Set-Location $ROOT_DIR

# Map friendly scenario shortcuts to test script names
if ($Scenario) {
  switch ($Scenario.ToLower()) {
    "feed"        { $TestScript = "k6-feed-session-loadtest.js" }
    "trending"    { $TestScript = "k6-trending-session-loadtest.js" }
    "write"       { $TestScript = "k6-post-fanout-stress.js" }
    "post"        { $TestScript = "k6-post-fanout-stress.js" }
    "interaction" { $TestScript = "k6-social-interaction-loadtest.js" }
    "social"      { $TestScript = "k6-social-interaction-loadtest.js" }
    "ai"          { $TestScript = "k6-ai-assistant-rag-loadtest.js" }
    "assistant"   { $TestScript = "k6-ai-assistant-rag-loadtest.js" }
    "music"       { $TestScript = "k6-music-search-loadtest.js" }
    "search"      { $TestScript = "k6-music-search-loadtest.js" }
    "blended"     { $TestScript = "k6-blended-realistic-workload.js" }
    default       { Write-Host "Unknown scenario '$Scenario', falling back to '$TestScript'" -ForegroundColor Yellow }
  }
}

$TestTag = [System.IO.Path]::GetFileNameWithoutExtension($TestScript).Replace("k6-", "").Replace("-session-loadtest", "").Replace("-loadtest", "").Replace("-stress", "")
if ([string]::IsNullOrWhiteSpace($TestTag)) { $TestTag = "feed" }

if ($Smoke) {
  $Profile = "smoke"
}

Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "         [K6 NEWSFEED LOAD TESTING RUNNER]                      " -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "Target URL:        $TargetUrl"
Write-Host "Test Script:       $TestScript"
Write-Host "Active Profile:    $Profile"
Write-Host "Pacing Mode:       $Pacing ($(if ($Pacing -eq 'fast') { 'Fast Scroll ~0.7s (Yields ~240 RPS)' } elseif ($Pacing -eq 'relaxed') { 'Relaxed Reading ~2.5s' } else { 'Natural Human Browsing 1.2s - 2.0s' }))"
Write-Host "Pages Per Session: $PagesPerSession (1 Cold + $($PagesPerSession - 1) Cache Scroll)"
Write-Host "Total Mock Users:  $NumUsers"
Write-Host "Compose Mode:      $Compose"

# Ensure output directory exists
$RESULTS_DIR = Join-Path $SCRIPT_DIR "results"
if (-not (Test-Path $RESULTS_DIR)) {
  New-Item -ItemType Directory -Force -Path $RESULTS_DIR | Out-Null
}

$SMOKE_ENV = if ($Profile -eq "smoke") { "true" } else { "false" }

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
    Write-Host "`n[*] Executing K6 via unified test compose (docker-compose.test.yml)..." -ForegroundColor Yellow
    $env:SMOKE_TEST = $SMOKE_ENV
    $env:LOAD_PROFILE = $Profile
    $env:TARGET_VUS = $VUs.ToString()
    $env:PACING_MODE = $Pacing
    $env:PAGES_PER_SESSION = $PagesPerSession.ToString()
    $env:NUM_USERS = $NumUsers.ToString()
    $env:K6_TEST_SCRIPT = $TestScript
    $env:TARGET_URL = "http://api-gateway:4000"
    $baseArgs = @()
    if (Test-Path ".env.test.local") {
      $baseArgs += @("--env-file", ".env.test.local")
    }
    $baseArgs += @("-f", "docker-compose.test.yml")

    if ($Build) {
      Write-Host "`n[*] Rebuilding and recreating core services with latest code (api-gateway, content-feed-service)..." -ForegroundColor Yellow
      & docker compose $baseArgs build api-gateway content-feed-service
      & docker compose $baseArgs up -d --no-deps api-gateway content-feed-service
    }

    $upArgs = $baseArgs + @("--profile", "loadtest", "up", "--abort-on-container-exit", "--exit-code-from", "k6", "k6")
    & docker compose $upArgs
  } else {
    Write-Host "`n[*] Executing Grafana K6 Docker container..." -ForegroundColor Yellow
    docker run --rm -i `
      --cpus="1.5" `
      --memory="512m" `
      --add-host="host.docker.internal:host-gateway" `
      -e "TARGET_URL=$TargetUrl" `
      -e "SMOKE_TEST=$SMOKE_ENV" `
      -e "LOAD_PROFILE=$Profile" `
      -e "TARGET_VUS=$VUs" `
      -e "PACING_MODE=$Pacing" `
      -e "PAGES_PER_SESSION=$PagesPerSession" `
      -e "NUM_USERS=$NumUsers" `
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
  Set-Content -Path (Join-Path $RESULTS_DIR "docker-resource-usage-$Profile.json") -Value $jsonOutput
  if ($TestTag -ne "feed") {
    Set-Content -Path (Join-Path $RESULTS_DIR "docker-resource-usage-$TestTag-$Profile.json") -Value $jsonOutput
  }

  if (-not $KeepRawStats -and (Test-Path $STATS_FILE)) {
    Remove-Item -Path $STATS_FILE -Force -ErrorAction SilentlyContinue
  }
}

Write-Host "`n[+] K6 test execution completed!" -ForegroundColor Green
Write-Host "Results saved to: $RESULTS_DIR/summary-$Profile.json (and summary.json)" -ForegroundColor Green
Write-Host "Resource usage saved to: $RESULTS_DIR/docker-resource-usage-$Profile.json (and docker-resource-usage.json)" -ForegroundColor Green
if ($TestTag -ne "feed") {
  Write-Host "Tagged outputs: $RESULTS_DIR/summary-$TestTag-$Profile.json & docker-resource-usage-$TestTag-$Profile.json" -ForegroundColor Green
}
