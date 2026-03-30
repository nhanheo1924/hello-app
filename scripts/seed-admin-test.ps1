param(
  [string]$BffApiBase = 'http://localhost:3001/api/v1'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$defaultPassword = 'Password123!'
$accounts = @(
  [PSCustomObject]@{
    Email = 'superadmin.local@ctm.test'
    FullName = 'CTM Super Admin'
    SystemRole = 'SUPER_ADMIN'
  },
  [PSCustomObject]@{
    Email = 'systemadmin.local@ctm.test'
    FullName = 'CTM System Admin'
    SystemRole = 'SYSTEM_ADMIN'
  }
)

function Invoke-JsonApi {
  param(
    [string]$Method,
    [string]$Url,
    [hashtable]$Headers = @{},
    [object]$Body = $null,
    [int]$MaxAttempts = 6
  )

  for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
    $requestParams = @{
      Method = $Method
      Uri = $Url
      Headers = $Headers
      ErrorAction = 'Stop'
    }

    if ($null -ne $Body) {
      $requestParams['ContentType'] = 'application/json'
      $requestParams['Body'] = ($Body | ConvertTo-Json -Depth 10 -Compress)
    }

    try {
      return Invoke-RestMethod @requestParams
    } catch {
      $errorText = [string]$_.Exception.Message
      $isTransient =
        $errorText -match 'BAD_GATEWAY' -or
        $errorText -match 'GATEWAY_TIMEOUT' -or
        $errorText -match 'Unable to connect' -or
        $errorText -match 'timed out'

      if (-not $isTransient -or $attempt -ge $MaxAttempts) {
        throw
      }

      Start-Sleep -Seconds ([Math]::Min($attempt * 2, 8))
    }
  }

  throw "Request failed after $MaxAttempts attempts: $Method $Url"
}

function Ensure-UserExists {
  param(
    [string]$Email,
    [string]$FullName,
    [string]$Password
  )

  try {
    $null = Invoke-JsonApi -Method 'POST' -Url "$BffApiBase/auth/signup" -Body @{
      email = $Email
      password = $Password
      fullName = $FullName
    }
    Write-Host "   created user: $Email"
    return
  } catch {
    $errorMessage = [string]$_.Exception.Message
    if (
      $errorMessage -match '409' -or
      $errorMessage -match 'EMAIL_EXISTS' -or
      $errorMessage -match 'already exists'
    ) {
      Write-Host "   user already exists: $Email"
      return
    }

    throw
  }
}

function Login-User {
  param(
    [string]$Email,
    [string]$Password
  )

  try {
    $login = Invoke-JsonApi -Method 'POST' -Url "$BffApiBase/auth/login" -Body @{
      email = $Email
      password = $Password
    }
  } catch {
    throw "Login failed for $Email. If the user existed with a different password, remove it and rerun seed."
  }

  $token = [string]$login.accessToken
  if ([string]::IsNullOrWhiteSpace($token)) {
    throw "Missing access token for $Email"
  }

  return $token
}

function Set-SystemRoles {
  param(
    [array]$RoleAccounts
  )

  $sqlLines = @()
  foreach ($account in $RoleAccounts) {
    $safeEmail = [string]$account.Email
    $safeEmail = $safeEmail.Replace("'", "''")
    $safeRole = [string]$account.SystemRole

    $sqlLines += "UPDATE users SET system_role = '$safeRole'::system_role, updated_at = NOW() WHERE email = '$safeEmail';"
  }

  $sql = @"
BEGIN;
$(($sqlLines -join "`n"))
COMMIT;
"@

  Push-Location (Join-Path $PSScriptRoot '../apps/auth-service')
  try {
    $sql | npx prisma db execute --schema prisma/schema.prisma --stdin | Out-Null
    if ($LASTEXITCODE -ne 0) {
      throw 'Failed to update system roles via prisma db execute.'
    }
  }
  finally {
    Pop-Location
  }
}

Write-Host '1) Ensuring admin test users exist...'
Write-Host '   waiting for BFF health...'
$null = Invoke-JsonApi -Method 'GET' -Url "$BffApiBase/health/ready" -MaxAttempts 10

foreach ($account in $accounts) {
  Ensure-UserExists -Email $account.Email -FullName $account.FullName -Password $defaultPassword
}

Write-Host '2) Applying system roles in auth database...'
Set-SystemRoles -RoleAccounts $accounts

Write-Host '3) Logging in and checking auth/me role mapping...'
$results = @()
foreach ($account in $accounts) {
  $token = Login-User -Email $account.Email -Password $defaultPassword
  $me = Invoke-JsonApi -Method 'GET' -Url "$BffApiBase/auth/me" -Headers @{ Authorization = "Bearer $token" }

  $actualRole = [string]$me.user.systemRole
  if ($actualRole -ne $account.SystemRole) {
    throw "Role mismatch for $($account.Email): expected $($account.SystemRole), got $actualRole"
  }

  Write-Host "   verified $($account.Email) -> $actualRole"
  $results += [ordered]@{
    email = $account.Email
    expectedRole = $account.SystemRole
    actualRole = $actualRole
    ok = $true
  }
}

Write-Host '4) Seed/check admin test accounts successful.'
[ordered]@{
  bffApiBase = $BffApiBase
  defaultPassword = $defaultPassword
  accounts = $results
  timestamp = (Get-Date).ToString('o')
} | ConvertTo-Json -Depth 6

