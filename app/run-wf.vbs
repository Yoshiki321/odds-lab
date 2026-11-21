Option Explicit
' run-wf.vbs open|close - unattended workflow launcher (hidden window, UTF-8 log)
' Reads data\wf\open-1303.md or close-2307.md, replaces {{DATE}} with Beijing today,
' runs opencode-cli run --auto, appends output to data\wf\wf-open.log / wf-close.log
' Prompt is passed via -f temp file (avoids long argv + encoding traps).
' NOTE: this file MUST stay pure ASCII. Comments in CJK get mangled by cscript
' under codepage 936 (trailing 0x5C byte eats the next line).
Dim sh, fso, mode, tmplFile, outLog, body, f, bj, cmd, tmpPrompt, cli, msg
mode = LCase(WScript.Arguments(0))
If mode <> "open" And mode <> "close" And mode <> "closey" Then WScript.Quit 2

Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "C:\JCroot"
cli = "C:\Users\Administrator\AppData\Roaming\ai.opencode.desktop\cli\2.0.19\opencode-cli.exe"

If mode = "open" Then
  tmplFile = "C:\JCroot\data\wf\open-1303.md"
  outLog = "C:\JCroot\data\wf\wf-open.log"
ElseIf mode = "closey" Then
  tmplFile = "C:\JCroot\data\wf\close-2307.md"
  outLog = "C:\JCroot\data\wf\wf-closey.log"
Else
  tmplFile = "C:\JCroot\data\wf\close-2307.md"
  outLog = "C:\JCroot\data\wf\wf-close.log"
End If

If Not fso.FileExists(tmplFile) Then
  sh.Run "cmd /c echo TEMPLATE MISSING: " & tmplFile, 0, False
  WScript.Quit 3
End If

Set f = fso.OpenTextFile(tmplFile, 1, False, -1)
body = f.ReadAll
f.Close

bj = Right("0" & Year(Now), 4) & "-" & Right("0" & Month(Now), 2) & "-" & Right("0" & Day(Now), 2)
If mode = "closey" Then
  Dim y: y = DateAdd("d", -1, Now)
  bj = Right("0" & Year(y), 4) & "-" & Right("0" & Month(y), 2) & "-" & Right("0" & Day(y), 2)
End If
body = Replace(body, "{{DATE}}", bj)

tmpPrompt = fso.BuildPath(fso.GetSpecialFolder(2), "wf_prompt_" & mode & ".md")
Set f = fso.CreateTextFile(tmpPrompt, True, True)
f.Write body
f.Close

cmd = "cmd /c chcp 65001>nul & echo.>> """ & outLog & """ & echo ==== " & Now & " mode=" & mode & " date=" & bj & " ====>> """ & outLog & """"
sh.Run cmd, 0, True

msg = "Read the attached workflow spec and execute it verbatim, step by step. Today is " & bj & ". Reply in Chinese."
cmd = "cmd /c chcp 65001>nul & """ & cli & """ run --auto -m opencode/space-bunny-free -f """ & tmpPrompt & """ """ & msg & """ >> """ & outLog & """ 2>&1"
sh.Run cmd, 0, True
WScript.Quit 0
