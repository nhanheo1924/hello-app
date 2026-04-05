param(
    [string]$ApiBaseUrl = "https://api.nhanctm.site/api/v1",
    [string]$AdminBearerToken = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-StatusCode {
    param(
        [Parameter(Mandatory = $true)][string]$Url,
        [hashtable]$Headers = @{}
    )

    try {
        $response = Invoke-WebRequest -Uri $Url -Method GET -MaximumRedirection 0 -Headers $Headers
        return [int]$response.StatusCode
    } catch {
        if ($_.Exception.Response -ne $null) {
            return [int]$_.Exception.Response.StatusCode.value__
        }
        throw
    }
}

$adminWorkspacesUrl = "$ApiBaseUrl/admin/workspaces?limit=20&page=1"
$adminSyncUrl = "$ApiBaseUrl/sync/stream?scope=admin&workspaceId=*"

Write-Host "Checking unauthenticated admin endpoints..."
$unauthAdminWorkspacesStatus = Get-StatusCode -Url $adminWorkspacesUrl
$unauthAdminSyncStatus = Get-StatusCode -Url $adminSyncUrl

if ($unauthAdminWorkspacesStatus -ne 401) {
    throw "Gate failed: expected unauth $adminWorkspacesUrl -> 401, got $unauthAdminWorkspacesStatus"
}
if ($unauthAdminSyncStatus -ne 401) {
    throw "Gate failed: expected unauth $adminSyncUrl -> 401, got $unauthAdminSyncStatus"
}

Write-Host "Unauthenticated checks passed."

if ([string]::IsNullOrWhiteSpace($AdminBearerToken)) {
    Write-Host "Skipping authenticated check (no AdminBearerToken provided)."
    exit 0
}

Write-Host "Checking authenticated admin workspace endpoint..."
$authHeaders = @{
    Authorization = "Bearer $AdminBearerToken"
}
$authAdminWorkspacesStatus = Get-StatusCode -Url $adminWorkspacesUrl -Headers $authHeaders
if ($authAdminWorkspacesStatus -ne 200) {
    throw "Gate failed: expected authenticated $adminWorkspacesUrl -> 200, got $authAdminWorkspacesStatus"
}

Write-Host "Authenticated checks passed."
