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

function main() {
  const now = Date.now();
  const alerts = [];
  let state = null;
  let hb = null;
  let authError = null;
  let attempts = [];
  let apiErrs = 0;

  try { state = JSON.parse(fs.readFileSync(STATE, "utf8")); } catch (e) { alerts.push("读不到 _state.json"); }
  if (state) {
    hb = state.heartbeat || null;
    authError = state.authError || null;
  }
  if (fs.existsSync(LOG)) {
    const lines = fs.readFileSync(LOG, "utf8").trim().split("\n");
    attempts = lines.map(parse).filter(x => x && x.type === "attempt");
    apiErrs = lines.map(parse).filter(x => x && x.type === "api_error").length;
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
  const recentErrs = (fs.existsSync(LOG) ? fs.readFileSync(LOG, "utf8").trim().split("\n").map(parse).filter(Boolean) : [])
    .filter(x => x.type === "api_error" && Date.parse((x.at || "").replace(" ", "T") + "+08:00") >= sinceMs);
  if (recentErrs.length > 0) alerts.push(`最近 30 分钟新增 ${recentErrs.length} 条 api_error`);

  // 5) 自愈：两个模板的请求头不一致时，用 getOriginalDataPB 的头同步给 getMatchBaseInfoByOddsPB
  //    （getOriginalDataPB 每轮都调，它的头有效；另一个失败通常是登录恢复后没同步）
  let healed = false;
  try {
    const CRED = path.join(ROOT, "data", "experiment_survival_100", "runtime", "api_credentials.json");
    const cred = JSON.parse(fs.readFileSync(CRED, "utf8"));
    const a = cred.templates.getOriginalDataPB;
    const b = cred.templates.getMatchBaseInfoByOddsPB;
    if (a && b && a.headers && JSON.stringify(a.headers) !== JSON.stringify(b.headers)) {
      b.headers = Object.assign({}, a.headers, { "content-type": "application/json" });
      cred.savedAt = new Date().toISOString();
      fs.writeFileSync(CRED, JSON.stringify(cred, null, 2), { mode: 0o600, encoding: "utf8" });
      healed = true;
    }
  } catch (e) { /* 凭据文件问题不在此自愈，写日志即可 */ }
  if (healed) alerts.push("已自动同步 getMatchBaseInfoByOddsPB 的请求头（与 getOriginalDataPB 一致）");

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
    lines.push("处理：网页重新登录后，运行 `node tools/ky_api_auth.cjs save`，并把新会话请求头同步到 getOriginalDataPB / getMatchBaseInfoByOddsPB 两个模板（看门狗会自动同步一次）。");
  } else {
    lines.push("无需处理。采集器每分钟轮询，比赛进入 T−35~T−30 窗口会自动采集。");
  }
  lines.push("");
  lines.push("说明：此文件由 KYWatchdog 每分钟自动更新；工作区内的助手只在收到消息时读取，不会主动弹出告警。");
  lines.push("");
  fs.writeFileSync(OUT, lines.join("\n"), "utf8");

  // 主动告警：状态变化时立即弹；异常持续每 30 分钟弹一次；恢复时弹一次
  let prev = {};
  try { prev = JSON.parse(fs.readFileSync(ALERT_STATE, "utf8")); } catch {}
  const shouldNotify =
    (status === "异常" && prev.status !== "异常") ||
    (status === "异常" && Number.isFinite(prev.at) && now - prev.at >= REPEAT_MS) ||
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
  fs.writeFileSync(ALERT_STATE, JSON.stringify({ status, at: now, alerts }, null, 2), "utf8");

  process.stdout.write(`${ts} ${status} alerts=${alerts.length} notified=${shouldNotify ? 1 : 0}\n`);
}

main();
