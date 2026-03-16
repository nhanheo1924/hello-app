Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')

Push-Location (Join-Path $repoRoot 'apps/auth-service')
try {
  Write-Host 'Syncing auth-service schema with local database (db push)...'
  npx prisma db push --accept-data-loss
  if ($LASTEXITCODE -ne 0) {
    throw 'auth-service schema sync failed.'
  }
}
finally {
  Pop-Location
}

Push-Location (Join-Path $repoRoot 'apps/task-service')
try {
  Write-Host 'Applying task-service migrations (migrate deploy)...'
  npx prisma migrate deploy
  if ($LASTEXITCODE -ne 0) {
    Write-Warning 'task-service migrate deploy failed, falling back to db push.'
    npx prisma db push --accept-data-loss
    if ($LASTEXITCODE -ne 0) {
      throw 'task-service schema sync failed.'
    }
  }
}
finally {
  Pop-Location
}

Write-Host 'Local database setup completed.'