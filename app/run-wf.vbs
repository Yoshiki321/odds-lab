Option Explicit
' run-wf.vbs open|close|closey - unattended workflow launcher (hidden window, UTF-8)
' Reads data\wf\open-1303.md or close-2307.md as UTF-8 via ADODB.Stream, replaces {{DATE}},
' runs opencode-cli run --auto, appends output to data\wf\wf-open.log / wf-close.log
' NOTE: this file MUST stay pure ASCII.
Dim sh, fso, mode, rootDir, tmplFile, outLog, body, bj, cmd, tmpPrompt, cli, msg
Dim streamIn, streamOut, dNow, dTarget, stamp

If WScript.Arguments.Count < 1 Then WScript.Quit 2
mode = LCase(WScript.Arguments(0))
If mode <> "open" And mode <> "close" And mode <> "closey" Then WScript.Quit 2

Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")

rootDir = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
sh.CurrentDirectory = rootDir

cli = sh.ExpandEnvironmentStrings("%OPENCODE_CLI%")
If cli = "" Or cli = "%OPENCODE_CLI%" Or Not fso.FileExists(cli) Then
  cli = sh.ExpandEnvironmentStrings("%APPDATA%\ai.opencode.desktop\cli\2.0.19\opencode-cli.exe")
End If
If Not fso.FileExists(cli) Then
  cli = "opencode-cli.exe"
End If

If mode = "open" Then
  tmplFile = fso.BuildPath(rootDir, "data\wf\open-1303.md")
  outLog = fso.BuildPath(rootDir, "data\wf\wf-open.log")
ElseIf mode = "closey" Then
  tmplFile = fso.BuildPath(rootDir, "data\wf\close-2307.md")
  outLog = fso.BuildPath(rootDir, "data\wf\wf-closey.log")
Else
  tmplFile = fso.BuildPath(rootDir, "data\wf\close-2307.md")
  outLog = fso.BuildPath(rootDir, "data\wf\wf-close.log")
End If

If Not fso.FileExists(tmplFile) Then
  cmd = "cmd /c chcp 65001>nul & echo ==== " & Now & " TEMPLATE MISSING: " & tmplFile & " ====>> """ & outLog & """"
  sh.Run cmd, 0, True
  WScript.Quit 3
End If

' Read UTF-8 template cleanly using ADODB.Stream (fixes UTF-16 garbled prompt bug)
Set streamIn = CreateObject("ADODB.Stream")
streamIn.Type = 2
streamIn.Charset = "utf-8"
streamIn.Open
streamIn.LoadFromFile tmplFile
body = streamIn.ReadText(-1)
streamIn.Close

dNow = Now
If mode = "closey" Then
  dTarget = DateAdd("d", -1, dNow)
Else
  dTarget = dNow
End If
bj = Right("0000" & Year(dTarget), 4) & "-" & Right("0" & Month(dTarget), 2) & "-" & Right("0" & Day(dTarget), 2)
body = Replace(body, "{{DATE}}", bj)

stamp = Right("0000" & Year(dNow), 4) & Right("0" & Month(dNow), 2) & Right("0" & Day(dNow), 2) & "_" & Right("0" & Hour(dNow), 2) & Right("0" & Minute(dNow), 2) & Right("0" & Second(dNow), 2)
tmpPrompt = fso.BuildPath(fso.GetSpecialFolder(2), "wf_prompt_" & mode & "_" & stamp & ".md")

Set streamOut = CreateObject("ADODB.Stream")
streamOut.Type = 2
streamOut.Charset = "utf-8"
streamOut.Open
streamOut.WriteText body
streamOut.SaveToFile tmpPrompt, 2
streamOut.Close

cmd = "cmd /c chcp 65001>nul & echo.>> """ & outLog & """ & echo ==== " & dNow & " mode=" & mode & " date=" & bj & " ====>> """ & outLog & """"
sh.Run cmd, 0, True

msg = "Read the attached workflow spec and execute it verbatim, step by step. Today is " & bj & ". Reply in Chinese."
cmd = "cmd /c chcp 65001>nul & """ & cli & """ run --auto -m opencode/space-bunny-free -f """ & tmpPrompt & """ """ & msg & """ >> """ & outLog & """ 2>&1"
sh.Run cmd, 0, True
On Error Resume Next
fso.DeleteFile tmpPrompt, True
On Error GoTo 0
WScript.Quit 0
