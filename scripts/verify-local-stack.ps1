param(
  [string]$BffApiBase = 'http://localhost:3001/api/v1',
  [string]$AuthHealthUrl = 'http://localhost:3000/api/health/ready',
  [string]$TaskHealthUrl = 'http://localhost:3002/api/health/ready',
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

Write-Host '1) Checking backend readiness...'
$authReady = Invoke-JsonApi -Method 'GET' -Url $AuthHealthUrl
$taskReady = Invoke-JsonApi -Method 'GET' -Url $TaskHealthUrl
$bffReady = Invoke-JsonApi -Method 'GET' -Url "$BffApiBase/health/ready"
Write-Host "   Auth: $($authReady.status)"
Write-Host "   Task: $($taskReady.status)"
Write-Host "   BFF : $($bffReady.status)"

$emailSuffix = [Guid]::NewGuid().ToString('N').Substring(0, 8)
$email = "local-$emailSuffix@example.com"
$password = 'CtmLocal2026!'
$fullName = 'Local Stack Verify'

Write-Host '2) Registering and logging in test user via BFF...'
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$null = Invoke-JsonApi -Method 'POST' -Url "$BffApiBase/auth/signup" -Body @{
  email = $email
  password = $password
  fullName = $fullName
} -WebSession $session

$login = Invoke-JsonApi -Method 'POST' -Url "$BffApiBase/auth/login" -Body @{
  email = $email
  password = $password
} -WebSession $session

Write-Host '3) Creating workspace/project/task via BFF...'
$workspace = Invoke-JsonApi -Method 'POST' -Url "$BffApiBase/workspaces" -Body @{ name = "Local Workspace $emailSuffix" } -WebSession $session
$workspaceId = [string]$workspace.data.id
if ([string]::IsNullOrWhiteSpace($workspaceId)) {
  throw 'Workspace creation failed: missing workspace id.'
}

$project = Invoke-JsonApi -Method 'POST' -Url "$BffApiBase/workspaces/$workspaceId/projects" -Body @{ name = "Local Project $emailSuffix"; description = 'Created by verify-local-stack.ps1' } -WebSession $session
$projectId = [string]$project.data.id
if ([string]::IsNullOrWhiteSpace($projectId)) {
  throw 'Project creation failed: missing project id.'
}

$task = Invoke-JsonApi -Method 'POST' -Url "$BffApiBase/projects/$projectId/tasks" -Body @{ title = "Verify Task $emailSuffix"; description = 'Persisted in Postgres'; priority = 'MEDIUM'; status = 'TODO' } -WebSession $session
$taskId = [string]$task.data.id
if ([string]::IsNullOrWhiteSpace($taskId)) {
  throw 'Task creation failed: missing task id.'
}

$board = Invoke-JsonApi -Method 'GET' -Url "$BffApiBase/projects/$projectId/board" -WebSession $session
$allTasks = @()
if ($board.data -and $board.data.columns) {
  foreach ($column in $board.data.columns) {
    if ($column.tasks) {
      $allTasks += @($column.tasks)
    }
  }
}

$persisted = $allTasks | Where-Object { $_.id -eq $taskId }
if (-not $persisted) {
  throw 'Board retrieval succeeded but created task not found. Persistence check failed.'
}

Write-Host '4) Verification successful.'
$result = [ordered]@{
  authHealth = $authReady.status
  taskHealth = $taskReady.status
  bffHealth = $bffReady.status
  userEmail = $email
  workspaceId = $workspaceId
  projectId = $projectId
  taskId = $taskId
  persistedTaskCount = @($persisted).Count
  timestamp = (Get-Date).ToString('o')
}
$result | ConvertTo-Json -Depth 5
