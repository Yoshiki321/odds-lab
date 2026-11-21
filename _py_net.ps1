$pids = @(1968, 12120, 6148, 9976, 12392, 15236, 14904, 15256)
$conns = Get-NetTCPConnection -ErrorAction SilentlyContinue | Where-Object { $pids -contains $_.OwningProcess }

Write-Output "=== python TCP connections ==="
foreach ($c in $conns) {
    Write-Output ("PID=" + $c.OwningProcess + " " + $c.State + " local=" + $c.LocalAddress + ":" + $c.LocalPort + " remote=" + $c.RemoteAddress + ":" + $c.RemotePort)
}

Write-Output "`n=== Listening ports ==="
$listeners = $conns | Where-Object { $_.State -eq 'Listen' }
foreach ($l in $listeners) {
    Write-Output ("PID=" + $l.OwningProcess + " port=" + $l.LocalPort)
}

$est = $conns | Where-Object { $_.State -eq 'Established' }
Write-Output ("`n=== Established: " + @($est).Count + " total ===")
$groups = $est | Group-Object OwningProcess
foreach ($g in $groups) {
    Write-Output ("PID " + $g.Name + " -> " + $g.Count + " connections")
}