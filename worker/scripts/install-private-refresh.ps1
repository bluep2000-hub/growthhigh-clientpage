param(
    [string]$NodePath = "",
    [string]$PythonPath = ""
)

$ErrorActionPreference = "Stop"

$taskName = "GrowthHigh Clientpage Private Refresh"
$workerRoot = Split-Path -Parent $PSScriptRoot
$runnerPath = Join-Path $PSScriptRoot "build-private.mjs"
if ($NodePath) {
    $nodeExe = (Resolve-Path -LiteralPath $NodePath -ErrorAction Stop).Path
} else {
    $nodeExe = (Get-Command node -ErrorAction Stop).Source
}
if ($PythonPath) {
    $pythonExe = (Resolve-Path -LiteralPath $PythonPath -ErrorAction Stop).Path
} else {
    $pythonExe = (Get-Command python -ErrorAction Stop).Source
}
if (-not (Test-Path -LiteralPath $runnerPath -PathType Leaf)) {
    throw "예약 실행 파일을 찾을 수 없습니다: $runnerPath"
}

$quotedNode = $nodeExe.Replace("'", "''")
$quotedPython = $pythonExe.Replace("'", "''")
$quotedRunner = $runnerPath.Replace("'", "''")
$argument = "-NoProfile -NonInteractive -WindowStyle Hidden -Command `$env:PRIVATE_BUILD_PYTHON='$quotedPython'; & '$quotedNode' '$quotedRunner'"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $argument -WorkingDirectory $workerRoot
$triggers = @(
    New-ScheduledTaskTrigger -Daily -At "09:00"
    New-ScheduledTaskTrigger -Daily -At "13:00"
    New-ScheduledTaskTrigger -Daily -At "18:00"
)
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited

Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $triggers `
    -Settings $settings `
    -Principal $principal `
    -Description "등록된 고객사의 공개 승인 데이터를 비공개 고객 페이지에 갱신합니다." `
    -Force | Out-Null

Write-Output "TASK_NAME=$taskName"
Write-Output "SCHEDULE=09:00,13:00,18:00"
Write-Output "LOGON_TYPE=Interactive"
Write-Output "PYTHON=$pythonExe"
