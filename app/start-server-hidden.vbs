Option Explicit
' start-server-hidden.vbs - hidden launcher, all-ASCII paths via C:\JCapp junction
' Triggered by Task Scheduler at logon; double-click also works. No console window.
' Log: C:\JCapp\server-autostart.log
Dim sh
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "C:\JCapp"
sh.Run "cmd /c npx tsx src/server/app.ts >> server-autostart.log 2>&1", 0, False
