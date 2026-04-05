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

function Convert-ToHexString {
  param([byte[]]$Bytes)

  return ($Bytes | ForEach-Object { $_.ToString('x2') }) -join ''
}

function New-RandomHex {
  param(
    [int]$ByteLength = 32
  )

  $buffer = [byte[]]::new($ByteLength)
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($buffer)
  } finally {
    $rng.Dispose()
  }
  return Convert-ToHexString -Bytes $buffer
}

function New-DevKid {
  return "ctm-dev-kid-$(New-RandomHex -ByteLength 4)"
}

function Escape-NewLines {
  param([string]$Value)

  if ([string]::IsNullOrEmpty($Value)) {
    return ''
  }

  return $Value.Replace("`r`n", "`n").Replace("`n", '\n').Trim()
}

function New-RsaKeyPairEscaped {
  $nodeScript = @"
const { generateKeyPairSync } = require('crypto');
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

process.stdout.write(JSON.stringify({
  privateKey: privateKey.replace(/\n/g, '\\n'),
  publicKey: publicKey.replace(/\n/g, '\\n'),
}));
"@

  $json = node -e $nodeScript
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($json)) {
    throw 'Failed to generate JWT RSA key pair via node.'
  }

  $parsed = $json | ConvertFrom-Json
  return @{
    PrivateKey = [string]$parsed.privateKey
    PublicKey = [string]$parsed.publicKey
  }
}

function Ensure-MapValue {
  param(
    [hashtable]$Map,
    [string]$Key,
    [scriptblock]$Generator,
    [System.Collections.Generic.List[string]]$GeneratedLabels
  )

  $current = Get-FirstValue -Source $Map -Keys @($Key)
  if (-not [string]::IsNullOrWhiteSpace($current)) {
    return $current
  }

  $value = & $Generator
  $Map[$Key] = $value
  $GeneratedLabels.Add($Key) | Out-Null
  return $value
}

function Upsert-EnvMapLine {
  param(
    [System.Collections.Generic.List[string]]$Lines,
    [string]$Key,
    [string]$Value
  )

  $pattern = '^\s*' + [regex]::Escape($Key) + '\s*='
  for ($index = 0; $index -lt $Lines.Count; $index++) {
    if ([regex]::IsMatch($Lines[$index], $pattern)) {
      $Lines[$index] = "$Key=$Value"
      return
    }
  }

  $Lines.Add("$Key=$Value") | Out-Null
}

function Save-RootEnvFile {
  param(
    [string]$Path,
    [hashtable]$Map,
    [string[]]$OrderedKeys
  )

  $existingLines = [System.Collections.Generic.List[string]]::new()
  if (Test-Path -LiteralPath $Path) {
    foreach ($line in Get-Content -LiteralPath $Path) {
      $existingLines.Add([string]$line) | Out-Null
    }
  }

  foreach ($key in $OrderedKeys) {
    if ($Map.ContainsKey($key)) {
      Upsert-EnvMapLine -Lines $existingLines -Key $key -Value ([string]$Map[$key])
    }
  }

  [System.IO.File]::WriteAllLines($Path, $existingLines, [System.Text.UTF8Encoding]::new($false))
}

function Normalize-UrlOrigin {
  param(
    [string]$Value
  )

  $raw = [string]$Value
  if ([string]::IsNullOrWhiteSpace($raw)) {
    return ''
  }

  $trimmed = $raw.Trim()
  try {
    $uri = [System.Uri]$trimmed
    return $uri.GetLeftPart([System.UriPartial]::Authority).TrimEnd('/')
  } catch {
    return $trimmed.TrimEnd('/')
  }
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
$generatedRootKeys = [System.Collections.Generic.List[string]]::new()

# Generate/sync local root env values if missing.
[void](Ensure-MapValue -Map $rootEnv -Key 'POSTGRES_HOST' -GeneratedLabels $generatedRootKeys -Generator { 'localhost' })
[void](Ensure-MapValue -Map $rootEnv -Key 'POSTGRES_PORT' -GeneratedLabels $generatedRootKeys -Generator { '5432' })
[void](Ensure-MapValue -Map $rootEnv -Key 'POSTGRES_DB' -GeneratedLabels $generatedRootKeys -Generator { 'ctm-auth-service' })
[void](Ensure-MapValue -Map $rootEnv -Key 'POSTGRES_USER' -GeneratedLabels $generatedRootKeys -Generator { 'postgres' })
[void](Ensure-MapValue -Map $rootEnv -Key 'POSTGRES_PASSWORD' -GeneratedLabels $generatedRootKeys -Generator { 'postgres' })
[void](Ensure-MapValue -Map $rootEnv -Key 'JWT_ISSUER_LOCAL' -GeneratedLabels $generatedRootKeys -Generator { 'http://localhost:3000' })
[void](Ensure-MapValue -Map $rootEnv -Key 'JWT_AUDIENCE' -GeneratedLabels $generatedRootKeys -Generator { 'ctm-web' })
[void](Ensure-MapValue -Map $rootEnv -Key 'JWT_ACTIVE_KID' -GeneratedLabels $generatedRootKeys -Generator { New-DevKid })
[void](Ensure-MapValue -Map $rootEnv -Key 'INTERNAL_PROXY_SECRET' -GeneratedLabels $generatedRootKeys -Generator { New-RandomHex -ByteLength 32 })
[void](Ensure-MapValue -Map $rootEnv -Key 'TOTP_ENCRYPTION_SECRET_LOCAL' -GeneratedLabels $generatedRootKeys -Generator { New-RandomHex -ByteLength 32 })
[void](Ensure-MapValue -Map $rootEnv -Key 'JWT_PUBLIC_KEYS_JSON' -GeneratedLabels $generatedRootKeys -Generator { '[]' })
[void](Ensure-MapValue -Map $rootEnv -Key 'WEB_APP_URL_LOCAL' -GeneratedLabels $generatedRootKeys -Generator { 'http://localhost:5173' })
[void](Ensure-MapValue -Map $rootEnv -Key 'WEB_APP_OAUTH_CALLBACK_URL_LOCAL' -GeneratedLabels $generatedRootKeys -Generator { 'http://localhost:5173/auth/callback/' })
[void](Ensure-MapValue -Map $rootEnv -Key 'GOOGLE_OAUTH_REDIRECT_URI_LOCAL' -GeneratedLabels $generatedRootKeys -Generator { 'http://localhost:3001/api/v1/auth/google/callback' })
[void](Ensure-MapValue -Map $rootEnv -Key 'BFF_PROXY_TARGET_URL_LOCAL' -GeneratedLabels $generatedRootKeys -Generator { 'http://localhost:3001' })
[void](Ensure-MapValue -Map $rootEnv -Key 'AUTH_SERVICE_BASE_URL_LOCAL' -GeneratedLabels $generatedRootKeys -Generator { 'http://localhost:3000/api/auth' })
[void](Ensure-MapValue -Map $rootEnv -Key 'TASK_SERVICE_BASE_URL_LOCAL' -GeneratedLabels $generatedRootKeys -Generator { 'http://localhost:3102/api' })
[void](Ensure-MapValue -Map $rootEnv -Key 'USE_CLOUDFLARED_TUNNEL_LOCAL' -GeneratedLabels $generatedRootKeys -Generator { 'false' })

$jwtPrivateKeyExisting = Get-FirstValue -Source $rootEnv -Keys @('JWT_ACCESS_PRIVATE_KEY')
$jwtPublicKeyExisting = Get-FirstValue -Source $rootEnv -Keys @('JWT_ACCESS_PUBLIC_KEY')
if ([string]::IsNullOrWhiteSpace($jwtPrivateKeyExisting) -or [string]::IsNullOrWhiteSpace($jwtPublicKeyExisting)) {
  $keyPair = New-RsaKeyPairEscaped
  $rootEnv['JWT_ACCESS_PRIVATE_KEY'] = Escape-NewLines -Value $keyPair.PrivateKey
  $rootEnv['JWT_ACCESS_PUBLIC_KEY'] = Escape-NewLines -Value $keyPair.PublicKey
  $generatedRootKeys.Add('JWT_ACCESS_PRIVATE_KEY') | Out-Null
  $generatedRootKeys.Add('JWT_ACCESS_PUBLIC_KEY') | Out-Null
}

Save-RootEnvFile -Path $resolvedRootEnvPath -Map $rootEnv -OrderedKeys @(
  'POSTGRES_HOST',
  'POSTGRES_PORT',
  'POSTGRES_DB',
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'AUTH_DATABASE_URL',
  'TASK_DATABASE_URL',
  'DATABASE_URL_LOCAL',
  'DATABASE_URL',
  'JWT_ISSUER_LOCAL',
  'JWT_AUDIENCE',
  'JWT_ACTIVE_KID',
  'JWT_ACCESS_PRIVATE_KEY',
  'JWT_ACCESS_PUBLIC_KEY',
  'JWT_PUBLIC_KEYS_JSON',
  'INTERNAL_PROXY_SECRET',
  'TOTP_ENCRYPTION_SECRET_LOCAL',
  'WEB_APP_URL_LOCAL',
  'WEB_APP_OAUTH_CALLBACK_URL_LOCAL',
  'GOOGLE_OAUTH_REDIRECT_URI_LOCAL',
  'VITE_API_BASE_URL_LOCAL',
  'VITE_FRONTEND_URL_LOCAL',
  'VITE_OAUTH_CALLBACK_PATH_LOCAL',
  'USE_CLOUDFLARED_TUNNEL_LOCAL',
  'CLOUDFLARED_TUNNEL_API_URL_LOCAL',
  'CLOUDFLARED_TUNNEL_WEB_URL_LOCAL',
  'CLOUDFLARE_ZA_CLIENT_ID_LOCAL',
  'CLOUDFLARE_ZA_CLIENT_SECRET_LOCAL',
  'BFF_PROXY_TARGET_URL_LOCAL',
  'AUTH_SERVICE_BASE_URL_LOCAL',
  'TASK_SERVICE_BASE_URL_LOCAL',
  'GOOGLE_OAUTH_CLIENT_ID',
  'GOOGLE_OAUTH_CLIENT_SECRET'
)

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
$totpEncryptionSecret = Get-FirstValue -Source $rootEnv -Keys @('TOTP_ENCRYPTION_SECRET_LOCAL') -Default $internalProxySecret
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
$googleRedirectUri = Get-FirstValue -Source $rootEnv -Keys @('GOOGLE_OAUTH_REDIRECT_URI_LOCAL') -Default 'http://localhost:3001/api/v1/auth/google/callback'
$bffProxyTargetUrl = Get-FirstValue -Source $rootEnv -Keys @('BFF_PROXY_TARGET_URL_LOCAL') -Default 'http://localhost:3001'
$viteApiBaseUrl = Get-FirstValue -Source $rootEnv -Keys @('VITE_API_BASE_URL_LOCAL', 'VITE_API_BASE_URL') -Default '/api/v1'
$viteFrontendUrl = Get-FirstValue -Source $rootEnv -Keys @('VITE_FRONTEND_URL_LOCAL', 'VITE_FRONTEND_URL') -Default $webAppUrl
$viteOauthCallbackPath = Get-FirstValue -Source $rootEnv -Keys @('VITE_OAUTH_CALLBACK_PATH_LOCAL') -Default '/auth/callback/'
$authServiceBaseUrl = Get-FirstValue -Source $rootEnv -Keys @('AUTH_SERVICE_BASE_URL_LOCAL') -Default 'http://localhost:3000/api/auth'
$taskServiceBaseUrl = Get-FirstValue -Source $rootEnv -Keys @('TASK_SERVICE_BASE_URL_LOCAL') -Default 'http://localhost:3102/api'
$bffCorsOrigin = Get-FirstValue -Source $rootEnv -Keys @('BFF_CORS_ORIGIN_LOCAL') -Default 'http://localhost:5173,http://127.0.0.1:5173'
$serviceCorsOrigin = Get-FirstValue -Source $rootEnv -Keys @('SERVICE_CORS_ORIGIN_LOCAL') -Default 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:3001'
$useTunnel = Get-FirstValue -Source $rootEnv -Keys @('USE_CLOUDFLARED_TUNNEL_LOCAL') -Default 'false'
$useTunnelEnabled = $useTunnel.ToLowerInvariant() -eq 'true'
$cloudflaredApiUrl = Normalize-UrlOrigin -Value (Get-FirstValue -Source $rootEnv -Keys @('CLOUDFLARED_TUNNEL_API_URL_LOCAL'))
$cloudflaredWebUrl = Normalize-UrlOrigin -Value (Get-FirstValue -Source $rootEnv -Keys @('CLOUDFLARED_TUNNEL_WEB_URL_LOCAL'))

if ($useTunnelEnabled) {
  if ([string]::IsNullOrWhiteSpace($cloudflaredApiUrl)) {
    throw 'USE_CLOUDFLARED_TUNNEL_LOCAL=true but CLOUDFLARED_TUNNEL_API_URL_LOCAL is empty.'
  }

  $googleRedirectUri = "$cloudflaredApiUrl/api/v1/auth/google/callback"
  $viteApiBaseUrl = "$cloudflaredApiUrl/api/v1"

  if (-not [string]::IsNullOrWhiteSpace($cloudflaredWebUrl)) {
    $webAppUrl = $cloudflaredWebUrl
    $webCallbackUrl = "$cloudflaredWebUrl/auth/callback/"
    $viteFrontendUrl = $cloudflaredWebUrl
    $bffCorsOrigin = "$cloudflaredWebUrl,http://localhost:5173,http://127.0.0.1:5173"
    $serviceCorsOrigin = "$cloudflaredWebUrl,http://localhost:5173,http://127.0.0.1:5173,http://localhost:3001"
  }
}

$authJwksUrl = 'http://localhost:3000/.well-known/jwks.json'
try {
  $authServiceUri = [System.Uri]$authServiceBaseUrl
  $origin = $authServiceUri.GetLeftPart([System.UriPartial]::Authority)
  if (-not [string]::IsNullOrWhiteSpace($origin)) {
    $authJwksUrl = "$origin/.well-known/jwks.json"
  }
} catch {
  # keep default
}

$authEnvPath = Join-Path $repoRoot 'apps/auth-service/.env'
$taskEnvPath = Join-Path $repoRoot 'apps/task-service/.env'
$bffEnvPath = Join-Path $repoRoot 'apps/bff-service/.env'
$webEnvPath = Join-Path $repoRoot 'apps/web/.env.local'

Write-EnvFile -Path $authEnvPath -Lines @(
  'NODE_ENV=development',
  'APP_HOST=0.0.0.0',
  'APP_PORT=3000',
  'APP_PREFIX=api',
  "CORS_ORIGIN=$serviceCorsOrigin",
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
  "TOTP_ENCRYPTION_SECRET=$totpEncryptionSecret",
  "INTERNAL_PROXY_SECRET=$internalProxySecret",
  'AUTH_PUBLIC_BASE_PATH=/api/v1/auth',
  "WEB_APP_URL=$webAppUrl",
  "WEB_APP_OAUTH_CALLBACK_URL=$webCallbackUrl",
  "GOOGLE_OAUTH_CLIENT_ID=$googleClientId",
  "GOOGLE_OAUTH_CLIENT_SECRET=$googleClientSecret",
  "GOOGLE_OAUTH_REDIRECT_URI=$googleRedirectUri"
)

Write-EnvFile -Path $taskEnvPath -Lines @(
  'NODE_ENV=development',
  'APP_HOST=0.0.0.0',
  'APP_PORT=3102',
  'APP_PREFIX=api',
  "CORS_ORIGIN=$serviceCorsOrigin",
  "DATABASE_URL=$taskDatabaseUrl",
  "JWT_ISSUER=$jwtIssuer",
  "JWT_AUDIENCE=$jwtAudience",
  "AUTH_SERVICE_BASE_URL=$authServiceBaseUrl",
  "DB_REQUIRED_PORT=$pgPort",
  "AUTH_JWKS_URL=$authJwksUrl",
  "INTERNAL_PROXY_SECRET=$internalProxySecret"
)

Write-EnvFile -Path $bffEnvPath -Lines @(
  'NODE_ENV=development',
  'APP_HOST=0.0.0.0',
  'APP_PORT=3001',
  'APP_PREFIX=api/v1',
  "CORS_ORIGIN=$bffCorsOrigin",
  "AUTH_SERVICE_BASE_URL=$authServiceBaseUrl",
  "TASK_SERVICE_BASE_URL=$taskServiceBaseUrl",
  'AUTH_ACCESS_COOKIE_NAME=ctm_at',
  'AUTH_ACCESS_COOKIE_DOMAIN=',
  'AUTH_ACCESS_COOKIE_SAMESITE=lax',
  "INTERNAL_PROXY_SECRET=$internalProxySecret",
  'UPSTREAM_TIMEOUT_MS=15000',
  'AUTH_CRITICAL_UPSTREAM_TIMEOUT_MS=8000',
  'UPSTREAM_MAX_ATTEMPTS=3',
  'UPSTREAM_RETRY_DELAY_MS=400'
)

Write-EnvFile -Path $webEnvPath -Lines @(
  'VITE_APP_BASE_PATH=/',
  "VITE_API_BASE_URL=$viteApiBaseUrl",
  "VITE_FRONTEND_URL=$viteFrontendUrl",
  "VITE_OAUTH_CALLBACK_PATH=$viteOauthCallbackPath",
  "BFF_PROXY_TARGET_URL=$bffProxyTargetUrl",
  "INTERNAL_PROXY_SECRET=$internalProxySecret"
)

Write-Host "Synced local env files:"
Write-Host " - $authEnvPath"
Write-Host " - $taskEnvPath"
Write-Host " - $bffEnvPath"
Write-Host " - $webEnvPath"
if ($generatedRootKeys.Count -gt 0) {
  $generatedDistinct = $generatedRootKeys | Select-Object -Unique
  Write-Host "Generated/filled root .env keys: $($generatedDistinct -join ', ')"
}
