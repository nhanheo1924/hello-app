param(
  [string]$RootEnvPath = ".env"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

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
    $value = $parts[1]
    if ($value.StartsWith('"') -and $value.EndsWith('"') -and $value.Length -ge 2) {
      $value = $value.Substring(1, $value.Length - 2)
    }

    if ($key) {
      $map[$key] = $value
    }
  }

  return $map
}

function Get-FirstValue {
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

function Set-DatabaseSchema {
  param(
    [string]$DatabaseUrl,
    [string]$Schema
  )

  if ([string]::IsNullOrWhiteSpace($DatabaseUrl)) {
    return ''
  }

  if ($DatabaseUrl -match '([?&])schema=') {
    return [regex]::Replace($DatabaseUrl, '([?&])schema=[^&]*', "`$1schema=$Schema")
  }

  if ($DatabaseUrl.Contains('?')) {
    return "$DatabaseUrl&schema=$Schema"
  }

  return "$DatabaseUrl?schema=$Schema"
}

function Build-PostgresUrl {
  param(
    [string]$Host,
    [string]$Port,
    [string]$Database,
    [string]$User,
    [string]$Password,
    [string]$Schema
  )

  $encodedUser = [System.Uri]::EscapeDataString($User)
  $encodedPassword = [System.Uri]::EscapeDataString($Password)
  return "postgresql://$encodedUser`:$encodedPassword@$Host`:$Port/$Database?schema=$Schema"
}

function Write-EnvFile {
  param(
    [string]$Path,
    [string[]]$Lines
  )

  $parent = Split-Path -Parent $Path
  if (-not (Test-Path -LiteralPath $parent)) {
    New-Item -ItemType Directory -Path $parent | Out-Null
  }

  [System.IO.File]::WriteAllLines($Path, $Lines, [System.Text.UTF8Encoding]::new($false))
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$resolvedRootEnvPath = if ([System.IO.Path]::IsPathRooted($RootEnvPath)) {
  $RootEnvPath
} else {
  Join-Path $repoRoot $RootEnvPath
}

$rootEnv = Read-EnvFile -Path $resolvedRootEnvPath

$pgHost = Get-FirstValue -Source $rootEnv -Keys @('POSTGRES_HOST', 'PGHOST') -Default 'localhost'
$pgPort = Get-FirstValue -Source $rootEnv -Keys @('POSTGRES_PORT', 'PGPORT') -Default '5432'
$pgDatabase = Get-FirstValue -Source $rootEnv -Keys @('POSTGRES_DB') -Default 'ctm-auth-service'
$pgUser = Get-FirstValue -Source $rootEnv -Keys @('POSTGRES_USER', 'PGUSER') -Default 'postgres'
$pgPassword = Get-FirstValue -Source $rootEnv -Keys @('POSTGRES_PASSWORD', 'PGPASSWORD') -Default 'postgres'

$rootDatabaseUrl = Get-FirstValue -Source $rootEnv -Keys @('DATABASE_URL_LOCAL', 'DATABASE_URL')

$authDatabaseUrl = Get-FirstValue -Source $rootEnv -Keys @('AUTH_DATABASE_URL')
if ([string]::IsNullOrWhiteSpace($authDatabaseUrl)) {
  if ([string]::IsNullOrWhiteSpace($rootDatabaseUrl)) {
    $authDatabaseUrl = Build-PostgresUrl -Host $pgHost -Port $pgPort -Database $pgDatabase -User $pgUser -Password $pgPassword -Schema 'public'
  } else {
    $authDatabaseUrl = Set-DatabaseSchema -DatabaseUrl $rootDatabaseUrl -Schema 'public'
  }
}

$taskDatabaseUrl = Get-FirstValue -Source $rootEnv -Keys @('TASK_DATABASE_URL')
if ([string]::IsNullOrWhiteSpace($taskDatabaseUrl)) {
  if ([string]::IsNullOrWhiteSpace($rootDatabaseUrl)) {
    $taskDatabaseUrl = Build-PostgresUrl -Host $pgHost -Port $pgPort -Database $pgDatabase -User $pgUser -Password $pgPassword -Schema 'task'
  } else {
    $taskDatabaseUrl = Set-DatabaseSchema -DatabaseUrl $rootDatabaseUrl -Schema 'task'
  }
}

$internalProxySecret = Get-FirstValue -Source $rootEnv -Keys @('INTERNAL_PROXY_SECRET') -Default 'dev-internal-proxy-secret-0123456789ab'
$jwtAudience = Get-FirstValue -Source $rootEnv -Keys @('JWT_AUDIENCE') -Default 'ctm-web'
$jwtIssuer = Get-FirstValue -Source $rootEnv -Keys @('JWT_ISSUER_LOCAL') -Default 'http://localhost:3000'
$jwtActiveKid = Get-FirstValue -Source $rootEnv -Keys @('JWT_ACTIVE_KID') -Default 'ctm-dev-kid-1'
$jwtPrivateKey = Get-FirstValue -Source $rootEnv -Keys @('JWT_ACCESS_PRIVATE_KEY')
$jwtPublicKey = Get-FirstValue -Source $rootEnv -Keys @('JWT_ACCESS_PUBLIC_KEY')
$jwtPublicKeysJson = Get-FirstValue -Source $rootEnv -Keys @('JWT_PUBLIC_KEYS_JSON') -Default '[]'
$webAppUrl = Get-FirstValue -Source $rootEnv -Keys @('WEB_APP_URL_LOCAL') -Default 'http://localhost:5173'
$webCallbackUrl = Get-FirstValue -Source $rootEnv -Keys @('WEB_APP_OAUTH_CALLBACK_URL_LOCAL') -Default 'http://localhost:5173/auth/callback/'
$googleClientId = Get-FirstValue -Source $rootEnv -Keys @('GOOGLE_OAUTH_CLIENT_ID')
$googleClientSecret = Get-FirstValue -Source $rootEnv -Keys @('GOOGLE_OAUTH_CLIENT_SECRET')
$googleRedirectUri = Get-FirstValue -Source $rootEnv -Keys @('GOOGLE_OAUTH_REDIRECT_URI_LOCAL') -Default 'http://localhost:5173/api/auth/google/callback'

$authEnvPath = Join-Path $repoRoot 'apps/auth-service/.env'
$taskEnvPath = Join-Path $repoRoot 'apps/task-service/.env'
$webEnvPath = Join-Path $repoRoot 'apps/web/.env.local'

Write-EnvFile -Path $authEnvPath -Lines @(
  'NODE_ENV=development',
  'APP_HOST=0.0.0.0',
  'APP_PORT=3000',
  'APP_PREFIX=api',
  'CORS_ORIGIN=http://localhost:5173,http://127.0.0.1:5173',
  "DATABASE_URL=$authDatabaseUrl",
  'JWT_ACCESS_EXPIRES_IN=60m',
  "JWT_ISSUER=$jwtIssuer",
  "JWT_AUDIENCE=$jwtAudience",
  "JWT_ACTIVE_KID=$jwtActiveKid",
  "JWT_ACCESS_PRIVATE_KEY=$jwtPrivateKey",
  "JWT_ACCESS_PUBLIC_KEY=$jwtPublicKey",
  "JWT_PUBLIC_KEYS_JSON=$jwtPublicKeysJson",
  'TWO_FACTOR_CHALLENGE_EXPIRES_IN=5m',
  'TOTP_ISSUER=CTM Auth',
  "DB_REQUIRED_PORT=$pgPort",
  "TOTP_ENCRYPTION_SECRET=$internalProxySecret",
  "INTERNAL_PROXY_SECRET=$internalProxySecret",
  "WEB_APP_URL=$webAppUrl",
  "WEB_APP_OAUTH_CALLBACK_URL=$webCallbackUrl",
  "GOOGLE_OAUTH_CLIENT_ID=$googleClientId",
  "GOOGLE_OAUTH_CLIENT_SECRET=$googleClientSecret",
  "GOOGLE_OAUTH_REDIRECT_URI=$googleRedirectUri"
)

Write-EnvFile -Path $taskEnvPath -Lines @(
  'NODE_ENV=development',
  'APP_HOST=0.0.0.0',
  'APP_PORT=3002',
  'APP_PREFIX=api',
  'CORS_ORIGIN=http://localhost:5173,http://127.0.0.1:5173',
  "DATABASE_URL=$taskDatabaseUrl",
  "JWT_ISSUER=$jwtIssuer",
  "JWT_AUDIENCE=$jwtAudience",
  "DB_REQUIRED_PORT=$pgPort",
  'AUTH_JWKS_URL=http://localhost:3000/.well-known/jwks.json',
  "INTERNAL_PROXY_SECRET=$internalProxySecret"
)

Write-EnvFile -Path $webEnvPath -Lines @(
  'VITE_APP_BASE_PATH=/',
  'VITE_AUTH_API_BASE_URL=/api/auth',
  'VITE_TASK_API_BASE_URL=/api',
  'VITE_FRONTEND_URL=http://localhost:5173',
  'VITE_OAUTH_CALLBACK_PATH=/auth/callback/',
  'AUTH_PROXY_TARGET_URL=http://localhost:3000/api/auth',
  'TASK_PROXY_TARGET_URL=http://localhost:3002/api',
  "INTERNAL_PROXY_SECRET=$internalProxySecret"
)

Write-Host "Synced local env files:"
Write-Host " - $authEnvPath"
Write-Host " - $taskEnvPath"
Write-Host " - $webEnvPath"
