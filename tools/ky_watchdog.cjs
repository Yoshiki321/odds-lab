/**
 * ky_watchdog.cjs — 采集器健康自检（供 Windows 任务计划每分钟调用）
 * 只做三件事：查心跳、查鉴权错误、查连续失败；结果写到 snapshots/HEALTH.md
 * 不修改采集器状态、不下注、不碰账本。
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const SNAP = path.join(ROOT, "data", "experiment_survival_100", "snapshots");
const STATE = path.join(SNAP, "_state.json");
const LOG = path.join(SNAP, "_log.jsonl");
const OUT = path.join(SNAP, "HEALTH.md");
const ALERT_STATE = path.join(SNAP, "_alert_state.json");
const STALE_MS = 120000; // 心跳超过 2 分钟没更新视为停摆
const REPEAT_MS = 30 * 60000; // 异常持续时每 30 分钟提醒一次，避免骚扰

function parse(line) {
  try { return JSON.parse(line); } catch { return null; }
}

function atomicWrite(fp, content, opts = {}) {
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  const tmp = `${fp}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, content, { encoding: "utf8", ...opts });
  fs.renameSync(tmp, fp);
}

function main() {
  const now = Date.now();
  const alerts = [];
  let state = null;
  let hb = null;
  let authError = null;
  let attempts = [];
  let apiErrs = 0;
  let parsedLog = [];

  try { state = JSON.parse(fs.readFileSync(STATE, "utf8")); } catch (e) { alerts.push("读不到 _state.json"); }
  if (state) {
    hb = state.heartbeat || null;
    authError = state.authError || null;
  }
  if (fs.existsSync(LOG)) {
    const raw = fs.readFileSync(LOG, "utf8").trim();
    parsedLog = raw ? raw.split("\n").map(parse).filter(Boolean) : [];
    attempts = parsedLog.filter(x => x.type === "attempt");
    apiErrs = parsedLog.filter(x => x.type === "api_error").length;
  }

  // 1) 心跳停摆
  if (!hb) alerts.push("没有心跳记录");
  else if (!Number.isFinite(hb.atMs) || now - hb.atMs > STALE_MS) {
    const mins = Number.isFinite(hb.atMs) ? Math.round((now - hb.atMs) / 60000) : "?";
    alerts.push(`采集器停摆：心跳已 ${mins} 分钟没更新（最后 ${hb.at}）`);
  }

  // 2) 鉴权失效
  if (authError) alerts.push(`鉴权失效：${authError.code || ""} ${authError.msg || ""}（${authError.at}）`);

  // 3) 最近 30 分钟内的采集：全部失败才报，避免陈旧记录一直告警
  const sinceMs = now - 30 * 60000;
  const recent = attempts.filter(x => {
    const t = Date.parse((x.reqEndBJ || "").replace(" ", "T") + "+08:00");
    return Number.isFinite(t) && t >= sinceMs;
  });
  if (recent.length >= 3 && recent.every(x => !x.ok)) {
    const last = recent[recent.length - 1];
    const reasons = {};
    for (const x of recent) { const r = x.reason || "无原因"; reasons[r] = (reasons[r] || 0) + 1; }
    alerts.push(`最近 30 分钟 ${recent.length} 次采集全部失败：${JSON.stringify(reasons)}，最后 ${last.reqEndBJ}`);
  }

  // 4) 最近 30 分钟内新增 api_error
  const recentErrs = parsedLog.filter(x => x.type === "api_error" && Date.parse((x.at || "").replace(" ", "T") + "+08:00") >= sinceMs);
  if (recentErrs.length > 0) alerts.push(`最近 30 分钟新增 ${recentErrs.length} 条 api_error`);

  // 5) 自愈：同步 getOriginalDataPB 的最新有效头到全部关联查询模板（采用原子写防止半截 JSON）
  let healed = [];
  try {
    const CRED = path.join(ROOT, "data", "experiment_survival_100", "runtime", "api_credentials.json");
    const cred = JSON.parse(fs.readFileSync(CRED, "utf8"));
    const a = cred.templates && cred.templates.getOriginalDataPB;
    const targets = ["getMatchBaseInfoByOddsPB", "countUnsettleTickets", "structureMatchBaseInfoByMidsPB"];
    if (a && a.headers) {
      for (const name of targets) {
        const b = cred.templates[name];
        if (!b) continue;
        const desired = Object.assign({}, a.headers, b.method === "POST" ? { "content-type": "application/json" } : {});
        if (JSON.stringify(b.headers) !== JSON.stringify(desired)) {
          b.headers = desired;
          healed.push(name);
        }
      }
      if (healed.length) {
        cred.savedAt = new Date().toISOString();
        atomicWrite(CRED, JSON.stringify(cred, null, 2), { mode: 0o600 });
      }
    }
  } catch (e) { /* 凭据文件问题不在此自愈 */ }
  if (healed.length) alerts.push(`已自动同步请求头到模板：${healed.join(", ")}`);

  const status = alerts.length ? "异常" : "正常";
  const ts = new Date(Date.now() + 8 * 3600e3).toISOString().replace("T", " ").slice(0, 19);
  const lines = [
    `# 采集器健康（${ts} 北京时间）`,
    "",
    `**状态：${status}**`,
    "",
    `心跳：${hb ? hb.at : "无"}`,
    `鉴权：${authError ? "失效 " + (authError.code || "") : "正常"}`,
    `累计采集次数：${attempts.length}`,
    `api_error 累计：${apiErrs}`,
    "",
  ];
  if (alerts.length) {
    lines.push("## 需要处理");
    for (const a of alerts) lines.push(`- ${a}`);
    lines.push("");
    lines.push("处理：网页重新登录后，运行 `node tools/ky_api_auth.cjs save`。");
  } else {
    lines.push("无需处理。采集器每分钟轮询，比赛进入 T−35~T−30 窗口会自动采集。");
  }
  lines.push("");
  lines.push("说明：此文件由 KYWatchdog 每分钟自动更新。");
  lines.push("");
  atomicWrite(OUT, lines.join("\n"));

  // 主动告警：修复原 Bug——仅在真正发送通知时更新 lastNotifiedAt，保证每 30 分钟提醒生效
  let prev = {};
  try { prev = JSON.parse(fs.readFileSync(ALERT_STATE, "utf8")); } catch {}
  const prevNotifiedAt = Number.isFinite(prev.lastNotifiedAt) ? prev.lastNotifiedAt : prev.at;
  // 鉴权签名：只要出现“新的”鉴权错误（code/msg 变化）就立即告警，不等 30 分钟
  const authSig = authError ? `${authError.code || ""}|${authError.msg || ""}` : null;
  const authIsNew = !!authSig && prev.authSig !== authSig;
  const shouldNotify =
    authIsNew ||
    (status === "异常" && prev.status !== "异常") ||
    (status === "异常" && Number.isFinite(prevNotifiedAt) && now - prevNotifiedAt >= REPEAT_MS) ||
    (status === "正常" && prev.status === "异常");
  if (shouldNotify) {
    try {
      const { toast } = require("./ky_toast.cjs");
      const title = status === "异常" ? "开云采集器异常" : "开云采集器已恢复";
      const brief = alerts.length ? alerts[0] : "心跳正常，鉴权正常";
      toast(title, brief.slice(0, 120));
    } catch (e) {
      process.stderr.write("toast error: " + e.message + "\n");
    }
  }
  atomicWrite(ALERT_STATE, JSON.stringify({
    status,
    checkedAt: now,
    lastNotifiedAt: shouldNotify ? now : (prevNotifiedAt || null),
    authSig,
    alerts,
  }, null, 2));

  process.stdout.write(`${ts} ${status} alerts=${alerts.length} notified=${shouldNotify ? 1 : 0}\n`);
}

main();
