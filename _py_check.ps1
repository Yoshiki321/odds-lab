$procs = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'python.exe' }
foreach ($p in $procs) {
    $cmd = $p.CommandLine
    if ($cmd.Length -gt 200) { $cmd = $cmd.Substring(0,200) }
    Write-Output ("PID=" + $p.ProcessId + " PPID=" + $p.ParentProcessId + " start=" + $p.CreationDate)
    Write-Output ("  cmd=" + $cmd)
    Write-Output ("  WorkingSet=" + [math]::Round($p.WorkingSetSize/1MB) + "MB")
    Write-Output ""
}

# 输出父进程信息
Write-Output "=== python 的父进程 ==="
$pyPids = @($procs | ForEach-Object { $_.ProcessId })
$ppids = @($procs | ForEach-Object { $_.ParentProcessId } | Where-Object { $_ -ne 0 })
$parents = Get-CimInstance Win32_Process | Where-Object { $ppids -contains $_.ProcessId }
foreach ($pp in $parents) {
    $cmd = $pp.CommandLine
    if ($cmd.Length -gt 150) { $cmd = $cmd.Substring(0,150) }
    Write-Output ("PPID=" + $pp.ProcessId + " name=" + $pp.Name + " start=" + $pp.CreationDate)
    Write-Output ("  cmd=" + $cmd)
    Write-Output ""
}