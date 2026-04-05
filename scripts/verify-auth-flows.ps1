param(
  [string]$BffApiBase = 'http://localhost:3001/api/v1',
  [string]$CloudflareZaClientId = '',
  [string]$CloudflareZaClientSecret = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$zaHeaders = @{}
if (-not [string]::IsNullOrWhiteSpace($CloudflareZaClientId) -and -not [string]::IsNullOrWhiteSpace($CloudflareZaClientSecret)) {
  $zaHeaders['CF-Access-Client-Id'] = $CloudflareZaClientId
  $zaHeaders['CF-Access-Client-Secret'] = $CloudflareZaClientSecret
}

function Invoke-JsonApi {
  param(
    [string]$Method,
    [string]$Url,
    [hashtable]$Headers = @{},
    [object]$Body = $null,
    [Microsoft.PowerShell.Commands.WebRequestSession]$WebSession = $null
  )

  $mergedHeaders = @{}
  foreach ($entry in $zaHeaders.GetEnumerator()) {
    $mergedHeaders[$entry.Key] = $entry.Value
  }
  foreach ($entry in $Headers.GetEnumerator()) {
    $mergedHeaders[$entry.Key] = $entry.Value
  }

  $requestParams = @{
    Method = $Method
    Uri = $Url
    Headers = $mergedHeaders
    ErrorAction = 'Stop'
  }
  if ($null -ne $WebSession) {
    $requestParams['WebSession'] = $WebSession
  }

  if ($null -ne $Body) {
    $requestParams['ContentType'] = 'application/json'
    $requestParams['Body'] = ($Body | ConvertTo-Json -Depth 10 -Compress)
  }

  return Invoke-RestMethod @requestParams
}

function New-TotpCode {
  param(
    [string]$Secret
  )

  $secretEscaped = $Secret.Replace('\', '\\').Replace("'", "\'")
  $otp = node -e "const { authenticator } = require('./apps/auth-service/node_modules/otplib'); process.stdout.write(authenticator.generate('$secretEscaped'));" 2>$null
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($otp)) {
    throw 'Failed to generate OTP using otplib.'
  }

  return $otp.Trim()
}

function Get-RedirectInfo {
  param(
    [string]$Url,
    [hashtable]$Headers = @{}
  )

  $headersJson = ($Headers | ConvertTo-Json -Compress)
  $output = node -e "const headers = JSON.parse(process.argv[2] || '{}'); fetch(process.argv[1], { redirect: 'manual', headers }).then((res) => { process.stdout.write(JSON.stringify({ status: res.status, location: res.headers.get('location') || '' })); }).catch((err) => { process.stdout.write(JSON.stringify({ status: 0, location: '', error: String(err && err.message ? err.message : err) })); process.exit(1); });" $Url $headersJson
  if ([string]::IsNullOrWhiteSpace($output)) {
    throw 'Unable to inspect OAuth redirect response.'
  }

  return $output | ConvertFrom-Json
}

Write-Host '1) Register and login test user...'
$suffix = [Guid]::NewGuid().ToString('N').Substring(0, 8)
$email = "authflow-$suffix@example.com"
$password = 'CtmLocal2026!'
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession

$null = Invoke-JsonApi -Method 'POST' -Url "$BffApiBase/auth/signup" -Body @{
  email = $email
  password = $password
  fullName = 'Auth Flow Verify'
} -WebSession $session

$loginInitial = Invoke-JsonApi -Method 'POST' -Url "$BffApiBase/auth/login" -Body @{
  email = $email
  password = $password
} -WebSession $session

Write-Host '2) Start 2FA setup and confirm with OTP...'
$setup = Invoke-JsonApi -Method 'POST' -Url "$BffApiBase/auth/2fa/setup" -WebSession $session
$secret = [string]$setup.secret
if ([string]::IsNullOrWhiteSpace($secret)) {
  throw '2FA setup failed: missing secret.'
}

$confirmOtp = New-TotpCode -Secret $secret
$confirm = Invoke-JsonApi -Method 'POST' -Url "$BffApiBase/auth/2fa/confirm" -Body @{
  otp = $confirmOtp
} -WebSession $session

$backupCodes = @()
if ($confirm.backupCodes) {
  $backupCodes = @($confirm.backupCodes)
}
if ($backupCodes.Count -eq 0) {
  throw '2FA confirm failed: no backup codes returned.'
}

Write-Host '3) Ensure password login now requires 2FA challenge...'
$challengeSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$login2faRequired = Invoke-JsonApi -Method 'POST' -Url "$BffApiBase/auth/login" -Body @{
  email = $email
  password = $password
} -WebSession $challengeSession

$requiresTwoFactor = $login2faRequired.requiresTwoFactor -eq $true
$twoFactorToken = [string]$login2faRequired.twoFactorToken
if (-not $requiresTwoFactor -or [string]::IsNullOrWhiteSpace($twoFactorToken)) {
  throw 'Expected requiresTwoFactor + twoFactorToken after enabling 2FA.'
}

Write-Host '4) Verify 2FA login with OTP challenge token...'
$verifyOtp = New-TotpCode -Secret $secret
$verify = Invoke-JsonApi -Method 'POST' -Url "$BffApiBase/auth/2fa/verify-login" -Body @{
  otp = $verifyOtp
  twoFactorToken = $twoFactorToken
} -WebSession $challengeSession

Write-Host '5) Disable 2FA using backup code...'
$disable = Invoke-JsonApi -Method 'POST' -Url "$BffApiBase/auth/2fa/disable" -Body @{
  backupCode = [string]$backupCodes[0]
} -WebSession $challengeSession

if (-not ($disable.success -eq $true)) {
  throw 'Disable 2FA failed.'
}

Write-Host '6) Ensure login works without 2FA after disable...'
$finalSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$loginAfterDisable = Invoke-JsonApi -Method 'POST' -Url "$BffApiBase/auth/login" -Body @{
  email = $email
  password = $password
} -WebSession $finalSession

$me = Invoke-JsonApi -Method 'GET' -Url "$BffApiBase/auth/me" -WebSession $finalSession
$meUserId = ''
if ($me.user -and $me.user.id) {
  $meUserId = [string]$me.user.id
} elseif ($me.id) {
  $meUserId = [string]$me.id
}

if ([string]::IsNullOrWhiteSpace($meUserId)) {
  throw 'Expected cookie session after login, but /auth/me did not return user id.'
}

Write-Host '7) Check OAuth start endpoint redirect...'
$oauthRedirect = Get-RedirectInfo -Url "$BffApiBase/auth/google/start" -Headers $zaHeaders
$oauthLocation = [string]$oauthRedirect.location
$oauthState = if ($oauthLocation -like 'https://accounts.google.com/*') {
  'configured'
} elseif ($oauthLocation -like '*google=error*') {
  'not_configured'
} else {
  'unexpected'
}

$result = [ordered]@{
  userEmail = $email
  twoFactorSetup = 'ok'
  twoFactorChallenge = 'ok'
  twoFactorVerify = 'ok'
  twoFactorDisable = 'ok'
  oauthStartStatusCode = [int]$oauthRedirect.status
  oauthStartState = $oauthState
  oauthStartLocation = $oauthLocation
  timestamp = (Get-Date).ToString('o')
}

Write-Host '8) Auth flow verification successful.'
$result | ConvertTo-Json -Depth 5
