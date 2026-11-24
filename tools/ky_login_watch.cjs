/**
 * ky_login_watch.cjs — 登录态自动检测 + 凭据自动刷新（只读页面/不碰账本）
 *
 * 背景：保存的“凭据”是请求头快照，会随服务端会话过期；浏览器关闭还会丢 session cookie。
 * 本脚本在浏览器保持运行的前提下，每分钟检查一次：
 *   1) 页面仍在 /user/login → 未登录，什么都不做
 *   2) 已登录且现有凭据可用 → 什么都不做
 *   3) 已登录但凭据失效 → 自动从页面重新捕获（ky_api_auth.cjs save）
 *   4) 捕获成功后确保 KYDaemon 在跑
 *
 * 不打印任何凭据值。日志写 runtime/login_watch.log。
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");
const zlib = require("node:zlib");
const { chromium } = require("playwright");
const auth = require("./ky_api_auth.cjs");

const ROOT = path.resolve(__dirname, "..");
const EXP = path.join(ROOT, "data", "experiment_survival_100");
const RT = path.join(EXP, "runtime");
const CDP = "http://127.0.0.1:9333";

function log(msg) {
  fs.mkdirSync(RT, { recursive: true });
  const ts = new Date(Date.now() + 8 * 3600e3).toISOString().replace("T", " ").slice(0, 19);
  fs.appendFileSync(path.join(RT, "login_watch.log"), `${ts} ${msg}\n`, "utf8");
}

async function apiOk() {
  const c = auth.load();
  if (!c || !c.templates || !c.templates.getOriginalDataPB) return false;
  const t = c.templates.getOriginalDataPB;
  try {
    const r = await fetch(t.url.replace(/t=\d+/, "t=" + Date.now()), {
      headers: t.headers,
      signal: AbortSignal.timeout(10000),
    });
    const j = await r.json();
    if (j.code !== "0000000") return false;
    const d = typeof j.data === "string" && j.data.startsWith("H4sI")
      ? JSON.parse(zlib.gunzipSync(Buffer.from(j.data, "base64")).toString("utf8"))
      : j.data;
    return Array.isArray(d && d.matchsList) && d.matchsList.length > 0;
  } catch {
    return false;
  }
}

function daemonRunning() {
  try {
    const out = cp.execFileSync("powershell", ["-NoProfile", "-Command",
      "(Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'ky_daemon' } | Measure-Object).Count"
    ], { timeout: 15000, encoding: "utf8" });
    return Number(String(out).trim()) > 0;
  } catch { return false; }
}

(async () => {
  // 接口优先：凭据可用时什么都不做，绝不碰浏览器
  if (await apiOk()) {
    log("credentials_ok");
    process.exit(0);
  }

  // 凭据过期：只有这时才借用用户已打开的浏览器页面刷新 code
  let page;
  try {
    const b = await chromium.connectOverCDP(CDP, { timeout: 8000 });
    page = b.contexts()[0].pages()[0];
  } catch (e) {
    log("need_manual_code"); // 浏览器没开：等用户手动开一次，不自动拉起
    process.exit(0);
  }
  const url = page.url();
  if (url.includes("/user/login")) {
    log("waiting_login");
    process.exit(0);
  }
  log("credentials_stale_capturing");
  try {
    // 用不重载页面的方式抓取：进入游戏 + 关闭安全提示 + 从赔率头推导 getOriginalDataPB
    cp.execFileSync(process.execPath, [path.join(__dirname, "ky_manual_capture.cjs")], { timeout: 120000 });
    log("capture_done ok=" + (await apiOk()));
  } catch (e) {
    log("capture_failed " + String(e.message).slice(0, 120));
    process.exit(0);
  }
  if (!daemonRunning()) {
    try {
      cp.execFileSync("powershell", ["-NoProfile", "-WindowStyle", "Hidden", "-Command", "Start-ScheduledTask -TaskName KYDaemon"], { timeout: 20000 });
      log("daemon_start_requested");
    } catch (e) {
      log("daemon_start_failed " + String(e.message).slice(0, 100));
    }
  } else {
    log("daemon_running");
  }
  process.exit(0);
})().catch((e) => { log("fatal " + String(e.message).slice(0, 140)); process.exit(1); });
