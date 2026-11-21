# watchdog.ps1 - health watchdog for the 9000 server (runs as SYSTEM, invisible)
$rootDir = Split-Path -Parent $PSScriptRoot
$log = Join-Path $rootDir 'data\watchdog.log'
function Log($m) { Add-Content -LiteralPath $log -Value ("{0} {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m) -Encoding UTF8 }

# 连续重试 3 次，避免 refresh 繁忙时误判重启
for ($i = 0; $i -lt 3; $i++) {
  try {
    $r = Invoke-WebRequest -Uri 'http://127.0.0.1:9000/api/health' -TimeoutSec 8 -UseBasicParsing
    if ($r.StatusCode -eq 200) { exit 0 }
  } catch { }
  if ($i -lt 2) { Start-Sleep -Seconds 3 }
}

Log '9000 DOWN after 3 checks - recovering targeted PID only'
# 严禁 Stop-Process -Name node -Force（会误杀 ky_daemon 等其它 node 进程），仅终止监听 9000 的 PID
$pids = @(Get-NetTCPConnection -LocalPort 9000 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
foreach ($pid in $pids) {
  if ($pid -and $pid -gt 0) {
    Log ("killing port 9000 listener PID=$pid")
    Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
  }
}
Start-Sleep -Seconds 2
Start-ScheduledTask -TaskName 'JC9000'
Log 'restart issued'
exit 1