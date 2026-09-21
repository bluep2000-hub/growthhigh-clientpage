param([string]$PythonPath = "")

$ErrorActionPreference = "Stop"

$taskName = "GrowthHigh Recording Automation"
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$runnerPath = Join-Path $PSScriptRoot "run_recording_scheduler.py"
$projectPython = Join-Path $repositoryRoot ".venv\Scripts\python.exe"
if ($PythonPath) {
    $pythonPath = (Resolve-Path -LiteralPath $PythonPath -ErrorAction Stop).Path
} elseif (Test-Path -LiteralPath $projectPython -PathType Leaf) {
    $pythonPath = $projectPython
} else {
    $pythonPath = (Get-Command python -ErrorAction Stop).Source
}
$pythonwPath = Join-Path (Split-Path -Parent $pythonPath) "pythonw.exe"

if (-not (Test-Path -LiteralPath $pythonwPath -PathType Leaf)) {
    throw "pythonw.exe를 찾을 수 없습니다: $pythonwPath"
}
if (-not (Test-Path -LiteralPath $runnerPath -PathType Leaf)) {
    throw "예약 실행 파일을 찾을 수 없습니다: $runnerPath"
}

$action = New-ScheduledTaskAction `
    -Execute $pythonwPath `
    -Argument ('"{0}"' -f $runnerPath) `
    -WorkingDirectory $repositoryRoot

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
    -ExecutionTimeLimit (New-TimeSpan -Hours 2)

# Google Drive 데스크톱의 G: 드라이브를 읽어야 하므로 이 사용자 로그인 중에만 실행한다.
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal = New-ScheduledTaskPrincipal `
    -UserId $currentUser `
    -LogonType Interactive `
    -RunLevel Limited

Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $triggers `
    -Settings $settings `
    -Principal $principal `
    -Description "Drive 접수 녹음을 Gemini로 전사·요약하고 Notion 공개 기록과 고객페이지 반영을 처리합니다." `
    -Force | Out-Null

Write-Output "TASK_NAME=$taskName"
Write-Output "SCHEDULE=09:00,13:00,18:00"
Write-Output "LOGON_TYPE=Interactive"
