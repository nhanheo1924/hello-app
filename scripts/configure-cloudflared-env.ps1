param(
  [Parameter(Mandatory = $true)]
  [string]$ApiTunnelUrl,
  [string]$WebTunnelUrl = '',
  [string]$CloudflareZaClientId = '',
  [string]$CloudflareZaClientSecret = '',
  [string]$RootEnvPath = '.env',
  [switch]$SkipSync
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Normalize-UrlOrigin {
  param([string]$Value)

  if ([string]::IsNullOrWhiteSpace($Value)) {
    return ''
  }

  $trimmed = $Value.Trim()
  try {
    $uri = [System.Uri]$trimmed
    return $uri.GetLeftPart([System.UriPartial]::Authority).TrimEnd('/')
  } catch {
    throw "Invalid URL: $Value"
  }
}

function Upsert-Line {
  param(
    [System.Collections.Generic.List[string]]$Lines,
    [string]$Key,
    [string]$Value
  )

  $pattern = '^\s*' + [regex]::Escape($Key) + '\s*='
  for ($i = 0; $i -lt $Lines.Count; $i++) {
    if ([regex]::IsMatch($Lines[$i], $pattern)) {
      $Lines[$i] = "$Key=$Value"
      return
    }
  }
  $Lines.Add("$Key=$Value") | Out-Null
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$resolvedRootEnvPath = if ([System.IO.Path]::IsPathRooted($RootEnvPath)) {
  $RootEnvPath
} else {
  Join-Path $repoRoot $RootEnvPath
}

$apiOrigin = Normalize-UrlOrigin -Value $ApiTunnelUrl
$webOrigin = Normalize-UrlOrigin -Value $WebTunnelUrl

$lines = [System.Collections.Generic.List[string]]::new()
if (Test-Path -LiteralPath $resolvedRootEnvPath) {
  foreach ($line in Get-Content -LiteralPath $resolvedRootEnvPath) {
    $lines.Add([string]$line) | Out-Null
  }
}

Upsert-Line -Lines $lines -Key 'USE_CLOUDFLARED_TUNNEL_LOCAL' -Value 'true'
Upsert-Line -Lines $lines -Key 'CLOUDFLARED_TUNNEL_API_URL_LOCAL' -Value $apiOrigin
Upsert-Line -Lines $lines -Key 'GOOGLE_OAUTH_REDIRECT_URI_LOCAL' -Value "$apiOrigin/api/v1/auth/google/callback"
Upsert-Line -Lines $lines -Key 'VITE_API_BASE_URL_LOCAL' -Value "$apiOrigin/api/v1"

if (-not [string]::IsNullOrWhiteSpace($webOrigin)) {
  Upsert-Line -Lines $lines -Key 'CLOUDFLARED_TUNNEL_WEB_URL_LOCAL' -Value $webOrigin
  Upsert-Line -Lines $lines -Key 'WEB_APP_URL_LOCAL' -Value $webOrigin
  Upsert-Line -Lines $lines -Key 'WEB_APP_OAUTH_CALLBACK_URL_LOCAL' -Value "$webOrigin/auth/callback/"
  Upsert-Line -Lines $lines -Key 'VITE_FRONTEND_URL_LOCAL' -Value $webOrigin
}

if (-not [string]::IsNullOrWhiteSpace($CloudflareZaClientId)) {
  Upsert-Line -Lines $lines -Key 'CLOUDFLARE_ZA_CLIENT_ID_LOCAL' -Value $CloudflareZaClientId
  Upsert-Line -Lines $lines -Key 'CF_ACCESS_CLIENT_ID' -Value $CloudflareZaClientId
}
if (-not [string]::IsNullOrWhiteSpace($CloudflareZaClientSecret)) {
  Upsert-Line -Lines $lines -Key 'CLOUDFLARE_ZA_CLIENT_SECRET_LOCAL' -Value $CloudflareZaClientSecret
  Upsert-Line -Lines $lines -Key 'CF_ACCESS_CLIENT_SECRET' -Value $CloudflareZaClientSecret
}

[System.IO.File]::WriteAllLines($resolvedRootEnvPath, $lines, [System.Text.UTF8Encoding]::new($false))

Write-Host "Updated root env for Cloudflared:"
Write-Host " - USE_CLOUDFLARED_TUNNEL_LOCAL=true"
Write-Host " - CLOUDFLARED_TUNNEL_API_URL_LOCAL=$apiOrigin"
if ($webOrigin) {
  Write-Host " - CLOUDFLARED_TUNNEL_WEB_URL_LOCAL=$webOrigin"
}
Write-Host " - GOOGLE_OAUTH_REDIRECT_URI_LOCAL=$apiOrigin/api/v1/auth/google/callback"

if (-not $SkipSync) {
  & (Join-Path $repoRoot 'scripts/sync-local-env.ps1') -RootEnvPath $resolvedRootEnvPath
}
