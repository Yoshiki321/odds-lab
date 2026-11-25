/**
 * ky_collector_guard.cjs — 采集器卡死自动重启（不碰浏览器）
 * 规则：
 *  - 心跳超过 10 分钟未更新 → 精准杀掉 ky_snapshot_collector 进程并重启 KYCollector
 *  - 10 分钟内只重启一次，避免重启风暴
 *  - 鉴权过期时重启无害（仍会失败），但能清掉 hung 进程；真正的恢复仍需人工登录刷新 code
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const EXP = path.join(ROOT, "data", "experiment_survival_100");
const STATE = path.join(EXP, "snapshots", "_state.json");
const RT = path.join(EXP, "runtime");
const LSTATE = path.join(RT, "collector_guard_state.json");
const LOG = path.join(RT, "collector_guard.log");
const STALE_MS = 5 * 60000;
const COOLDOWN_MS = 5 * 60000;

function log(msg) {
  fs.mkdirSync(RT, { recursive: true });
  const ts = new Date(Date.now() + 8 * 3600e3).toISOString().replace("T", " ").slice(0, 19);
  fs.appendFileSync(LOG, `${ts} ${msg}\n`, "utf8");
}

function ps(cmd) {
  return cp.execFileSync("powershell", ["-NoProfile", "-Command", cmd], { encoding: "utf8", timeout: 30000 }).trim();
}

(function main() {
  let st = null;
  try { st = JSON.parse(fs.readFileSync(STATE, "utf8")); } catch {}
  const hb = st && st.heartbeat;
  if (st && st.authError) { log("auth_expired_wait"); process.exit(0); }
  if (!hb || !Number.isFinite(hb.atMs)) { log("no_heartbeat"); process.exit(0); }
  const age = Date.now() - hb.atMs;
  if (age <= STALE_MS) process.exit(0);

  let last = 0;
  try { last = JSON.parse(fs.readFileSync(LSTATE, "utf8")).lastRestartMs || 0; } catch {}
  if (Date.now() - last < COOLDOWN_MS) { log(`stale age=${Math.round(age / 60000)}min cooldown`); process.exit(0); }

  let pids = [];
  try {
    const out = ps("Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'ky_snapshot_collector' } | ForEach-Object { $_.ProcessId }");
    pids = out.split(/\s+/).filter(Boolean);
  } catch (e) { log("pid_query_failed " + String(e.message).slice(0, 80)); }
  for (const p of pids) {
    try { ps(`Stop-Process -Id ${Number(p)} -Force`); } catch {}
  }
  try { ps("Start-ScheduledTask -TaskName KYCollector"); } catch (e) { log("start_failed " + String(e.message).slice(0, 80)); }
  fs.mkdirSync(RT, { recursive: true });
  fs.writeFileSync(LSTATE, JSON.stringify({ lastRestartMs: Date.now(), killed: pids }, null, 2), "utf8");
  log(`restarted collector killed=${JSON.stringify(pids)} age=${Math.round(age / 60000)}min`);
})();
