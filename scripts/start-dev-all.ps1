param()

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$pidFile = Join-Path $repoRoot ".tmp/dev-all.pids.json"
New-Item -ItemType Directory -Force -Path (Join-Path $repoRoot ".tmp") | Out-Null

$services = @(
  @{ Name = "auth"; Command = "npm run dev:auth"; Port = 3000 },
  @{ Name = "task"; Command = "npm run dev:task"; Port = 3102 },
  @{ Name = "bff"; Command = "npm run dev:bff"; Port = 3001 },
  @{ Name = "web"; Command = "npm run dev:web"; Port = 5173 }
)

$started = @()

foreach ($service in $services) {
  $proc = Start-Process `
    -FilePath "powershell.exe" `
    -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-Command", ("Set-Location '{0}'; {1}" -f $repoRoot, $service.Command) `
    -WorkingDirectory $repoRoot `
    -PassThru

  $started += [PSCustomObject]@{
    name = $service.Name
    pid = $proc.Id
    port = [int]$service.Port
    startedAt = (Get-Date).ToString("o")
  }
}

$started | ConvertTo-Json -Depth 4 | Set-Content -Path $pidFile -Encoding UTF8

Write-Output "Started services:"
foreach ($entry in $started) {
  Write-Output (" - {0}: PID {1}" -f $entry.name, $entry.pid)
}

Write-Output ""
Write-Output ("PID file: {0}" -f $pidFile)
Write-Output "Each service is running in its own PowerShell window."
Write-Output "Use npm run dev:all:stop to stop all started services."
