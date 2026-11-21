/**
 * ky_toast.cjs — 发 Windows Toast 通知（无外部依赖）
 * 用法: node tools/ky_toast.cjs "标题" "内容"
 * 用 EncodedCommand 传中文，规避 PowerShell 5.1 读 UTF-8 脚本的编码问题。
 */
"use strict";
const { execFileSync } = require("node:child_process");

function psLiteral(s) {
  // PowerShell 单引号字符串：用 '' 转义内部单引号
  return "'" + String(s).replace(/'/g, "''") + "'";
}

function toast(title, message) {
  const t = psLiteral(title);
  const m = psLiteral(message);
  const script = [
    "$ErrorActionPreference='Stop'",
    "$AppId='{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'",
    "[Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime]|Out-Null",
    "$x=[Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)",
    "$tt=$x.GetElementsByTagName('text')",
    `$tt.Item(0).AppendChild($x.CreateTextNode(${t}))|Out-Null`,
    `$tt.Item(1).AppendChild($x.CreateTextNode(${m}))|Out-Null`,
    "$n=[Windows.UI.Notifications.ToastNotification]::new($x)",
    "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($AppId).Show($n)",
  ].join(";");
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  execFileSync("powershell", ["-NoProfile", "-WindowStyle", "Hidden", "-EncodedCommand", encoded], { timeout: 15000, stdio: "ignore" });
}

module.exports = { toast };

if (require.main === module) {
  try {
    toast(process.argv[2] || "KY", process.argv[3] || "");
    process.stdout.write("toast ok\n");
  } catch (e) {
    process.stderr.write("toast failed: " + e.message + "\n");
    process.exit(1);
  }
}
