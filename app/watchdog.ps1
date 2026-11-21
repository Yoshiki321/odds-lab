# watchdog.ps1 - health watchdog for the 9000 server (runs as SYSTEM, invisible)
$log = 'C:\JCroot\data\watchdog.log'
function Log($m) { Add-Content -LiteralPath $log -Value ("{0} {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m) -Encoding UTF8 }
try {
  $r = Invoke-WebRequest -Uri 'http://127.0.0.1:9000/api/health' -TimeoutSec 8 -UseBasicParsing
  if ($r.StatusCode -eq 200) { exit 0 }
} catch { }
Log '9000 DOWN - recovering'
Stop-Process -Name node -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Start-ScheduledTask -TaskName 'JC9000'
Log 'restart issued'
exit 1