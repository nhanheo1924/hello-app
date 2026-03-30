param()

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$pidFile = Join-Path $repoRoot ".tmp/dev-all.pids.json"

$entries = @()
if (Test-Path $pidFile) {
  $raw = Get-Content -Path $pidFile -Raw

  try {
    $parsed = $raw | ConvertFrom-Json
    if ($parsed -is [System.Array]) {
      $entries = $parsed
    } elseif ($parsed) {
      $entries = @($parsed)
    }
  } catch {
    Write-Output ("Unable to parse PID file: {0}" -f $pidFile)
    exit 1
  }
} else {
  $entries = @(
    [PSCustomObject]@{ name = "auth"; port = 3000; pid = 0 },
    [PSCustomObject]@{ name = "task"; port = 3102; pid = 0 },
    [PSCustomObject]@{ name = "bff"; port = 3001; pid = 0 },
    [PSCustomObject]@{ name = "web"; port = 5173; pid = 0 }
  )
}

if ($entries.Count -eq 0) {
  Write-Output "No tracked services found in PID file."
  if (Test-Path $pidFile) {
    Remove-Item -Force -Path $pidFile
  }
  exit 0
}

foreach ($entry in $entries) {
  $portValue = 0
  if ($entry.PSObject.Properties.Name -contains "port") {
    $portValue = [int]$entry.port
  }

  if ($portValue -gt 0) {
    try {
      $listener = Get-NetTCPConnection -State Listen -LocalPort $portValue -ErrorAction Stop | Select-Object -First 1
      if ($listener -and $listener.OwningProcess -gt 0) {
        Stop-Process -Id $listener.OwningProcess -Force -ErrorAction Stop
        Write-Output ("Stopped {0} (port {1}, PID {2})" -f $entry.name, $portValue, $listener.OwningProcess)
        continue
      }
    } catch {
      # fallback to tracked pid below
    }
  }

  $pidValue = [int]$entry.pid
  if ($pidValue -le 0) {
    continue
  }

  try {
    $proc = Get-Process -Id $pidValue -ErrorAction Stop
    Stop-Process -Id $proc.Id -Force -ErrorAction Stop
    Write-Output ("Stopped {0} (PID {1})" -f $entry.name, $pidValue)
  } catch {
    Write-Output ("Skipped {0} (PID {1}) - not running" -f $entry.name, $pidValue)
  }
}

if (Test-Path $pidFile) {
  Remove-Item -Force -Path $pidFile
}
Write-Output "Done."
