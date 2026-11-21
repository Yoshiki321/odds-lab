/**
 * sweep_plan.cjs — 早间扫盘与临场复核计划（纯函数，可测试；只写计划/报告，不下单、不碰真实账本）。
 * 用法: node tools/sweep_plan.cjs plan <matches.json> <outplan.json>
 * matches.json: [{id, league, home, away, kickoff /* ISO+08:00 *\/, markets:[{market, side, line, price, observedAt}]}]
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const EXP = path.join(ROOT, "data", "experiment_survival_100");
const SWEEP_DIR = path.join(EXP, "sweep");

function loadConfig() {
  return JSON.parse(fs.readFileSync(path.join(SWEEP_DIR, "config_v1.json"), "utf8"));
}

function tierOf(league, cfg) {
  if ((cfg.tiers.tier1 || []).includes(league)) return 1;
  if ((cfg.tiers.tier2 || []).includes(league)) return 2;
  return 3;
}

function cmpMatch(a, b) {
  const t = new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime();
  if (t !== 0) return t;
  const ha = String(a.home), hb = String(b.home);
  if (ha !== hb) return ha < hb ? -1 : 1; // Unicode 码点升序（见超10场附则）
  const aa = String(a.away), ab = String(b.away);
  if (aa !== ab) return aa < ab ? -1 : 1;
  return 0;
}

/** 按一类→二类→三类优先级筛选；类内按开赛/主队排序；默认不限流，全部纳入。 */
function selectCandidates(matches, cfg, cap) {
  const sorted = [...matches].sort(cmpMatch);
  const byTier = [[], [], []];
  for (const m of sorted) byTier[tierOf(m.league, cfg) - 1].push(m);
  const ordered = [...byTier[0], ...byTier[1], ...byTier[2]];
  if (cap == null) return { total: ordered.length, included: ordered, excluded: [], capped: false };
  const limit = cap;
  return {
    total: ordered.length,
    included: ordered.slice(0, limit),
    excluded: ordered.slice(limit).map((m) => ({ id: m.id, reason: "超轮次上限（限流，需安排后续处理或标记未处理）" })),
    capped: true,
  };
}

/** 绝对毫秒 → Asia/Shanghai 显式标注 "YYYY-MM-DDTHH:mm:ss+08:00"（展示用；调度一律用毫秒）。 */
function fmtBeijing(ms) {
  const d = new Date(ms);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const g = (t) => parts.find((p) => p.type === t).value;
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}:${g("second")}+08:00`;
}

function planRechecks(candidates, cfg) {
  const off = (cfg.inplay && cfg.inplay.offsetMinBeforeKickoff) || 30;
  return candidates.map((m) => {
    const kickMs = new Date(m.kickoff).getTime();
    if (isNaN(kickMs)) throw new Error(`开赛时间无效:${m.id}`);
    const planMs = kickMs - off * 60000;
    return {
      eventId: m.id,
      kickoff: m.kickoff, // 原始字符串（含时区偏移，按输入为准）
      kickoffMs: kickMs, // 绝对时间（调度依据）
      kickoffBeijing: fmtBeijing(kickMs), // 展示（北京时间，显式标注）
      planAtMs: planMs, // 绝对时间（调度依据）
      planAtBeijing: fmtBeijing(planMs), // 展示（北京时间，显式标注）
      offsetMin: off,
    };
  });
}

/** 可执行窗：[计划时刻, 计划时刻+5分钟]（用户 2026-11-19 确认；不提前，无±10分钟）。 */
function withinWindow(planAtMs, actualAtMs, windowMs) {
  const plan = Number(planAtMs), act = Number(actualAtMs);
  const w = windowMs == null ? 5 * 60000 : windowMs;
  if (isNaN(plan) || isNaN(act)) return { executable: false, reason: "时间无效" };
  if (act < plan) return { executable: false, reason: "早于计划时刻，不提前执行" };
  if (act - plan <= w) return { executable: true, reason: "窗内" };
  return { executable: false, reason: "超过计划时间后5分钟，错过" };
}

/** 兼容旧调用：withinWindow(planISO, actualISO) 仍可用（按确认窗判定）。 */
function withinWindowISO(planAtISO, actualAtISO, windowMs) {
  return withinWindow(new Date(planAtISO).getTime(), new Date(actualAtISO).getTime(), windowMs);
}

/** 认领任务：去重（已执行拒绝重复）+ 窗口判定；纯函数，不写执行记录。 */
function claimTask(task, actualAtMs, executedIds, windowMs) {
  if ((executedIds || []).includes(task.eventId))
    return { decision: "duplicate", reason: "该赛事临场任务已执行过，拒绝重复" };
  const w = withinWindow(task.planAtMs, actualAtMs, windowMs);
  if (!w.executable) return { decision: "missed", reason: w.reason };
  return { decision: "execute", reason: "窗内且未执行" };
}

/** 同一赛事开赛时间变化：保存变更记录，更新计划（替换不追加，避免重复任务）。 */
function updatePlanKickoff(plan, eventId, newKickoff, offsetMin) {
  const off = offsetMin == null ? 30 : offsetMin;
  const changes = (plan.kickoffChanges || []).slice();
  const tasks = (plan.rechecks || []).filter((t) => t.eventId !== eventId);
  const kickMs = new Date(newKickoff).getTime();
  if (isNaN(kickMs)) throw new Error(`开赛时间无效:${eventId}`);
  const planMs = kickMs - off * 60000;
  changes.push({ eventId, at: new Date().toISOString(), kind: "kickoff-change" });
  tasks.push({
    eventId,
    kickoff: newKickoff,
    kickoffMs: kickMs,
    kickoffBeijing: fmtBeijing(kickMs),
    planAtMs: planMs,
    planAtBeijing: fmtBeijing(planMs),
    offsetMin: off,
  });
  return { ...plan, rechecks: tasks, kickoffChanges: changes };
}

function summarizeScope(items) {
  const events = [...new Set(items.map((d) => d.eventId || (d.event && d.event.id)).filter(Boolean))];
  const byStatus = {};
  for (const d of items) byStatus[d.status || "unknown"] = (byStatus[d.status || "unknown"] || 0) + 1;
  return { records: items.length, distinctMatches: events.length, byStatus };
}

function renderMorningReport(dateStr, sel, rechecks, notes) {
  const L = [];
  L.push(`# 早间扫盘 ${dateStr}(Asia/Shanghai)`);
  L.push(``);
  L.push(`> 只观察不下单；赔率=观察价≠可成交价；时间均为北京时间（+08:00），调度按绝对毫秒。`);
  L.push(``);
  L.push(`- 总符合: ${sel.total}；纳入: ${sel.included.length}；排除: ${sel.excluded.length}`);
  for (const m of sel.included) L.push(`  - 纳入 ${m.league} ${m.home} vs ${m.away} ${m.kickoff}`);
  for (const e of sel.excluded) L.push(`  - 排除 ${e.id}（${e.reason}）`);
  L.push(`- 临场复核计划（北京时间，绝对毫秒调度）:`);
  for (const r of rechecks) L.push(`  - ${r.eventId} 计划 ${r.planAtBeijing}（绝对 ${r.planAtMs}；开赛前${r.offsetMin}分钟）`);
  for (const n of notes || []) L.push(`- ${n}`);
  return L.join("\n");
}

function main(argv) {
  const [cmd, inFp, outFp] = argv.slice(2);
  if (cmd !== "plan") {
    console.error("用法: node tools/sweep_plan.cjs plan <matches.json> <outplan.json>");
    process.exitCode = 2;
    return;
  }
  const cfg = loadConfig();
  const matches = JSON.parse(fs.readFileSync(inFp, "utf8"));
  const sel = selectCandidates(matches, cfg);
  const rechecks = planRechecks(sel.included, cfg);
  const plan = { version: "sweep-plan-v1", configVersion: cfg.version, createdAt: new Date().toISOString(), sel, rechecks };
  const resolved = path.resolve(outFp);
  const expResolved = path.resolve(EXP);
  if (resolved !== expResolved && !resolved.startsWith(expResolved + path.sep)) {
    console.error("写盘越界拒绝");
    process.exitCode = 2;
    return;
  }
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  if (fs.existsSync(resolved)) {
    console.error("不可变拒绝覆盖");
    process.exitCode = 2;
    return;
  }
  fs.writeFileSync(resolved, JSON.stringify(plan, null, 2), "utf8");
  console.log(`OK ${resolved}`);
}

if (require.main === module) main(process.argv);

module.exports = { loadConfig, tierOf, cmpMatch, selectCandidates, planRechecks, withinWindow, withinWindowISO, claimTask, updatePlanKickoff, summarizeScope, renderMorningReport, fmtBeijing };
