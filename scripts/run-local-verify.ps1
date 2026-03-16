param(
  [int]$TimeoutSec = 120
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$authLog = Join-Path $repoRoot '.tmp-auth-local-run.log'
$taskLog = Join-Path $repoRoot '.tmp-task-local-run.log'

if (Test-Path $authLog) { Remove-Item $authLog -Force }
if (Test-Path $taskLog) { Remove-Item $taskLog -Force }

function Wait-HttpReady {
  param(
    [string]$Url,
    [int]$Timeout
  )

  $deadline = (Get-Date).AddSeconds($Timeout)
  while ((Get-Date) -lt $deadline) {
    try {
      $null = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 5
      return $true
    } catch {
      Start-Sleep -Seconds 2
    }
  }

  return $false
}

$authJob = $null
$taskJob = $null
try {
  $authJob = Start-Job -ScriptBlock {
    Set-Location 'e:\ctm\apps\auth-service'
    npm run start:dev *>&1 | Tee-Object -FilePath 'e:\ctm\.tmp-auth-local-run.log'
  }
  $taskJob = Start-Job -ScriptBlock {
    Set-Location 'e:\ctm\apps\task-service'
    npm run start:dev *>&1 | Tee-Object -FilePath 'e:\ctm\.tmp-task-local-run.log'
  }

  if (-not (Wait-HttpReady -Url 'http://localhost:3000/api/health/ready' -Timeout $TimeoutSec)) {
    throw 'auth-service did not become ready within timeout'
  }

  if (-not (Wait-HttpReady -Url 'http://localhost:3002/api/health/ready' -Timeout $TimeoutSec)) {
    throw 'task-service did not become ready within timeout'
  }

  & (Join-Path $repoRoot 'scripts/verify-local-stack.ps1')
}
finally {
  if ($authJob) {
    Stop-Job $authJob -ErrorAction SilentlyContinue | Out-Null
    Remove-Job $authJob -Force -ErrorAction SilentlyContinue
  }

  if ($taskJob) {
    Stop-Job $taskJob -ErrorAction SilentlyContinue | Out-Null
    Remove-Job $taskJob -Force -ErrorAction SilentlyContinue
  }

  Write-Host "Auth log: $authLog"
  Write-Host "Task log: $taskLog"
}
