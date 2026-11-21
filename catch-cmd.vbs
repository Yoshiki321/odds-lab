Option Explicit
' catch-cmd.vbs — 无窗口监控：每300ms轮询新建的控制台进程，记录命令行+父进程
' 用法：双击启动（wscript，无黑窗）。停：任务管理器结束 wscript.exe（命令行含 catch-cmd）。
' 日志：同目录 cmd-capture.log。下次闪窗后把日志发回即可定罪。
Dim fso, logPath, wmi, seen
Set fso = CreateObject("Scripting.FileSystemObject")
logPath = fso.BuildPath(fso.GetParentFolderName(WScript.ScriptFullName), "cmd-capture.log")
Set wmi = GetObject("winmgmts:\\.\root\cimv2")
Set seen = CreateObject("Scripting.Dictionary")

Sub LogLine(s)
  Dim f
  Set f = fso.OpenTextFile(logPath, 8, True)
  f.WriteLine s
  f.Close
End Sub

LogLine "=== monitor started " & Now & " ==="

Do While True
  Dim procs, p, key, cur, pp, it, parentInfo
  On Error Resume Next
  Set procs = wmi.ExecQuery("SELECT ProcessId,ParentProcessId,Name,CommandLine FROM Win32_Process WHERE Name='cmd.exe' OR Name='conhost.exe' OR Name='powershell.exe' OR Name='pwsh.exe' OR Name='node.exe' OR Name='python.exe'")
  If Err.Number <> 0 Then
    LogLine Now & " WMI err: " & Err.Description
    Err.Clear
  Else
    Set cur = CreateObject("Scripting.Dictionary")
    For Each p In procs
      key = CStr(p.ProcessId)
      cur(key) = True
      If Not seen.Exists(key) Then
        seen(key) = True
        parentInfo = ""
        Set pp = wmi.ExecQuery("SELECT Name,CommandLine FROM Win32_Process WHERE ProcessId=" & p.ParentProcessId)
        For Each it In pp
          parentInfo = it.Name & " :: " & it.CommandLine
        Next
        LogLine Now & " NEW " & p.Name & " PID=" & p.ProcessId & " PPID=" & p.ParentProcessId
        LogLine "  cmd: " & p.CommandLine
        LogLine "  parent: " & parentInfo
      End If
    Next
  End If
  WScript.Sleep 300
Loop
