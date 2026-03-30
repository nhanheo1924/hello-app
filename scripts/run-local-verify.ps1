param(
  [int]$TimeoutSec = 120,
  [switch]$UseCloudflaredTunnel,
  [string]$RootEnvPath = '.env'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$authLog = Join-Path $repoRoot '.tmp-auth-local-run.log'
$taskLog = Join-Path $repoRoot '.tmp-task-local-run.log'
$bffLog = Join-Path $repoRoot '.tmp-bff-local-run.log'

function Read-EnvFile {
  param([string]$Path)

  $map = @{}
  if (-not (Test-Path -LiteralPath $Path)) {
    return $map
  }

  Get-Content -LiteralPath $Path | ForEach-Object {
    $line = [string]$_
    if ([string]::IsNullOrWhiteSpace($line)) {
      return
    }
    $trimmed = $line.Trim()
    if ($trimmed.StartsWith('#')) {
      return
    }
    $parts = $line -split '=', 2
    if ($parts.Length -lt 2) {
      return
    }
    $key = $parts[0].Trim()
    if ($key) {
      $map[$key] = [string]$parts[1]
    }
  }

  return $map
}

function Get-EnvValue {
  param(
    [hashtable]$Source,
    [string[]]$Keys,
    [string]$Default = ''
  )

  foreach ($key in $Keys) {
    if ($Source.ContainsKey($key)) {
      $value = [string]$Source[$key]
      if (-not [string]::IsNullOrWhiteSpace($value)) {
        return $value.Trim()
      }
    }
  }

  return $Default
}

$resolvedRootEnvPath = if ([System.IO.Path]::IsPathRooted($RootEnvPath)) {
  $RootEnvPath
} else {
  Join-Path $repoRoot $RootEnvPath
}

& (Join-Path $repoRoot 'scripts/sync-local-env.ps1') -RootEnvPath $resolvedRootEnvPath

$effectiveBffApiBase = 'http://localhost:3001/api/v1'
$effectiveZaClientId = ''
$effectiveZaClientSecret = ''

if ($UseCloudflaredTunnel) {
  $rootEnv = Read-EnvFile -Path $resolvedRootEnvPath
  $apiTunnel = Get-EnvValue -Source $rootEnv -Keys @('CLOUDFLARED_TUNNEL_API_URL_LOCAL')
  if ([string]::IsNullOrWhiteSpace($apiTunnel)) {
    throw 'UseCloudflaredTunnel=true but CLOUDFLARED_TUNNEL_API_URL_LOCAL is not set in root .env'
  }

  $apiTunnelOrigin = $apiTunnel.TrimEnd('/')
  $effectiveBffApiBase = "$apiTunnelOrigin/api/v1"
  $effectiveZaClientId = Get-EnvValue -Source $rootEnv -Keys @('CLOUDFLARE_ZA_CLIENT_ID_LOCAL', 'CF_ACCESS_CLIENT_ID')
  $effectiveZaClientSecret = Get-EnvValue -Source $rootEnv -Keys @('CLOUDFLARE_ZA_CLIENT_SECRET_LOCAL', 'CF_ACCESS_CLIENT_SECRET')
}

if (Test-Path $authLog) { Remove-Item $authLog -Force }
if (Test-Path $taskLog) { Remove-Item $taskLog -Force }
if (Test-Path $bffLog) { Remove-Item $bffLog -Force }

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
$bffJob = $null
try {
  $authJob = Start-Job -ScriptBlock {
    Set-Location 'e:\ctm\apps\auth-service'
    npm run start:dev *>&1 | Tee-Object -FilePath 'e:\ctm\.tmp-auth-local-run.log'
  }
  $taskJob = Start-Job -ScriptBlock {
    Set-Location 'e:\ctm\apps\task-service'
    npm run start:dev *>&1 | Tee-Object -FilePath 'e:\ctm\.tmp-task-local-run.log'
  }
  $bffJob = Start-Job -ScriptBlock {
    Set-Location 'e:\ctm\apps\bff-service'
    npm run start:dev *>&1 | Tee-Object -FilePath 'e:\ctm\.tmp-bff-local-run.log'
  }

  if (-not (Wait-HttpReady -Url 'http://localhost:3000/api/health/ready' -Timeout $TimeoutSec)) {
    throw 'auth-service did not become ready within timeout'
  }

  if (-not (Wait-HttpReady -Url 'http://localhost:3102/api/health/ready' -Timeout $TimeoutSec)) {
    throw 'task-service did not become ready within timeout'
  }

  if (-not (Wait-HttpReady -Url 'http://localhost:3001/api/v1/health/ready' -Timeout $TimeoutSec)) {
    throw 'bff-service did not become ready within timeout'
  }

  & (Join-Path $repoRoot 'scripts/verify-local-stack.ps1') `
    -BffApiBase $effectiveBffApiBase `
    -CloudflareZaClientId $effectiveZaClientId `
    -CloudflareZaClientSecret $effectiveZaClientSecret

  & (Join-Path $repoRoot 'scripts/verify-auth-flows.ps1') `
    -BffApiBase $effectiveBffApiBase `
    -CloudflareZaClientId $effectiveZaClientId `
    -CloudflareZaClientSecret $effectiveZaClientSecret
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

  if ($bffJob) {
    Stop-Job $bffJob -ErrorAction SilentlyContinue | Out-Null
    Remove-Job $bffJob -Force -ErrorAction SilentlyContinue
  }

  Write-Host "Auth log: $authLog"
  Write-Host "Task log: $taskLog"
  Write-Host "BFF log: $bffLog"
}
