param(
  [string]$AuthApiBase = 'http://localhost:3000/api/auth',
  [string]$TaskApiBase = 'http://localhost:3002/api'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Invoke-JsonApi {
  param(
    [string]$Method,
    [string]$Url,
    [hashtable]$Headers = @{},
    [object]$Body = $null
  )

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

  return Invoke-RestMethod @requestParams
}

$authServiceBase = [regex]::Replace($AuthApiBase, '/api/auth/?$', '')
$taskServiceBase = [regex]::Replace($TaskApiBase, '/api/?$', '')

Write-Host '1) Checking backend readiness...'
$authReady = Invoke-JsonApi -Method 'GET' -Url "$authServiceBase/api/health/ready"
$taskReady = Invoke-JsonApi -Method 'GET' -Url "$taskServiceBase/api/health/ready"
Write-Host "   Auth: $($authReady.status)"
Write-Host "   Task: $($taskReady.status)"

$emailSuffix = [Guid]::NewGuid().ToString('N').Substring(0, 8)
$email = "local-$emailSuffix@example.com"
$password = 'CtmLocal2026!'
$fullName = 'Local Stack Verify'

Write-Host '2) Registering and logging in test user...'
$null = Invoke-JsonApi -Method 'POST' -Url "$AuthApiBase/signup" -Body @{
  email = $email
  password = $password
  fullName = $fullName
}

$login = Invoke-JsonApi -Method 'POST' -Url "$AuthApiBase/login" -Body @{
  email = $email
  password = $password
}

$token = [string]$login.accessToken
if ([string]::IsNullOrWhiteSpace($token)) {
  throw 'Login succeeded but accessToken is missing.'
}

$authHeaders = @{ Authorization = "Bearer $token" }

Write-Host '3) Creating workspace/project/task via task-service...'
$workspace = Invoke-JsonApi -Method 'POST' -Url "$TaskApiBase/workspaces" -Headers $authHeaders -Body @{ name = "Local Workspace $emailSuffix" }
$workspaceId = [string]$workspace.data.id
if ([string]::IsNullOrWhiteSpace($workspaceId)) {
  throw 'Workspace creation failed: missing workspace id.'
}

$project = Invoke-JsonApi -Method 'POST' -Url "$TaskApiBase/workspaces/$workspaceId/projects" -Headers $authHeaders -Body @{ name = "Local Project $emailSuffix"; description = 'Created by verify-local-stack.ps1' }
$projectId = [string]$project.data.id
if ([string]::IsNullOrWhiteSpace($projectId)) {
  throw 'Project creation failed: missing project id.'
}

$task = Invoke-JsonApi -Method 'POST' -Url "$TaskApiBase/projects/$projectId/tasks" -Headers $authHeaders -Body @{ title = "Verify Task $emailSuffix"; description = 'Persisted in Postgres'; priority = 'MEDIUM'; status = 'TODO' }
$taskId = [string]$task.data.id
if ([string]::IsNullOrWhiteSpace($taskId)) {
  throw 'Task creation failed: missing task id.'
}

$board = Invoke-JsonApi -Method 'GET' -Url "$TaskApiBase/projects/$projectId/board" -Headers $authHeaders
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
  userEmail = $email
  workspaceId = $workspaceId
  projectId = $projectId
  taskId = $taskId
  persistedTaskCount = @($persisted).Count
  timestamp = (Get-Date).ToString('o')
}
$result | ConvertTo-Json -Depth 5
