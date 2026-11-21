/** sweep_test.cjs — 扫盘与临场机制测试（纯逻辑，不碰网络/真实账本）。node tools/sweep_test.cjs */
"use strict";
const assert = require("node:assert/strict");
const { tierOf, cmpMatch, selectCandidates, planRechecks, withinWindow, summarizeScope, renderMorningReport } = require("./sweep_plan.cjs");

const cfg = { version: "t", tiers: { tier1: ["欧冠"], tier2: ["德乙", "巴甲"], tier3: [] }, inplay: { offsetMinBeforeKickoff: 30 } };
let pass = 0;
function t(name, fn) {
  try { fn(); pass += 1; console.log(`ok - ${name}`); }
  catch (e) { console.error(`FAIL - ${name}\n${e.stack}`); process.exitCode = 1; }
}
const M = (id, league, home, kickoff) => ({ id, league, home, away: "客", kickoff });

// 1. 分级映射
t("分级映射", () => {
  assert.equal(tierOf("欧冠", cfg), 1);
  assert.equal(tierOf("德乙", cfg), 2);
  assert.equal(tierOf("未知联赛", cfg), 3); // 未列入=三类，需用户允许才观察
});

// 2. 类内排序：开赛升序，同时间主队Unicode升序
t("类内排序", () => {
  const ms = [M("b", "欧冠", "博", "2026-11-25T01:45:00+08:00"), M("a", "欧冠", "加", "2026-11-25T01:45:00+08:00"), M("c", "欧冠", "曼", "2026-11-25T04:00:00+08:00")];
  assert.deepEqual([...ms].sort(cmpMatch).map((m) => m.id), ["a", "b", "c"]);
});

// 3. 优先级：一类先于二类；默认不限流（无静默丢失）；显式cap才截断并具名未处理
t("优先级与上限", () => {
  const ms = [];
  for (let i = 0; i < 8; i++) ms.push(M("T2-" + i, "德乙", "主" + i, "2026-11-20T01:00:00+08:00"));
  for (let i = 0; i < 5; i++) ms.push(M("T1-" + i, "欧冠", "主" + i, "2026-11-21T01:00:00+08:00"));
  const sel = selectCandidates(ms, cfg);
  assert.equal(sel.total, 13);
  assert.equal(sel.included.length, 13); // 默认不限流
  assert.equal(sel.excluded.length, 0);
  assert.ok(sel.included.slice(0, 5).every((m) => m.league === "欧冠"), "一类优先");
  const capped = selectCandidates(ms, cfg, 10);
  assert.equal(capped.included.length, 10);
  assert.equal(capped.excluded.length, 3);
  assert.ok(capped.excluded.every((e) => /后续处理|未处理/.test(e.reason)));
});

// 4. 跨午夜：开赛时间绝对值比较，与日期标签无关
t("跨午夜", () => {
  const ms = [M("n1", "欧冠", "主", "2026-11-19T00:30:00+08:00"), M("n2", "欧冠", "主", "2026-11-18T23:00:00+08:00")];
  assert.deepEqual([...ms].sort(cmpMatch).map((m) => m.id), ["n2", "n1"]);
});

// 5. 临场计划=开赛前30分钟（绝对毫秒调度；展示北京时间显式标注）；可执行窗=[计划,计划+5分钟]（已确认）
t("临场计划与偏差窗", () => {
  const r = planRechecks([M("m", "欧冠", "主", "2026-11-25T01:45:00+08:00")], cfg);
  // 同一时刻两种写法必须相等：北京 11-25 01:15+08:00 == UTC 11-24 17:15Z
  assert.equal(r[0].planAtBeijing, "2026-11-25T01:15:00+08:00");
  assert.equal(r[0].planAtMs, Date.parse("2026-11-24T17:15:00Z"));
  assert.equal(r[0].kickoffBeijing, "2026-11-25T01:45:00+08:00");
  const P = r[0].planAtMs;
  assert.deepEqual(withinWindow(P, P, undefined), { executable: true, reason: "窗内" }); // 计划时刻本身可执行
  assert.equal(withinWindow(P, P + 3 * 60000, undefined).executable, true); // 晚3分钟可执行
  assert.equal(withinWindow(P, P + 5 * 60000, undefined).executable, true); // +5分钟边界可执行（含边界）
  assert.equal(withinWindow(P, P + 5 * 60000 + 1, undefined).executable, false); // 超1毫秒=错过
  assert.equal(withinWindow(P, P - 1, undefined).executable, false); // 早1毫秒=不提前（禁T-40提前）
  assert.equal(withinWindow(P, P - 10 * 60000, undefined).executable, false); // 早10分钟=T-40，明确禁止
});

// 5b. 跨午夜：开赛 00:15+08:00 → 计划落在前一日 23:45+08:00（绝对毫秒计算，不按日期字符串）
t("跨午夜计划", () => {
  const r = planRechecks([M("n", "欧冠", "主", "2026-11-19T00:15:00+08:00")], cfg);
  assert.equal(r[0].planAtBeijing, "2026-11-18T23:45:00+08:00");
  assert.equal(r[0].planAtMs, Date.parse("2026-11-18T15:45:00Z"));
});

// 5c. UTC↔北京时间换算往返一致
t("时区换算往返", () => {
  const { fmtBeijing } = require("./sweep_plan.cjs");
  assert.equal(fmtBeijing(Date.parse("2026-11-24T17:15:00Z")), "2026-11-25T01:15:00+08:00");
  assert.equal(Date.parse(fmtBeijing(Date.parse("2026-11-24T17:15:00Z"))), Date.parse("2026-11-24T17:15:00Z"));
});

// 5d. 重启不伪造执行：计划对象不含执行记录字段；重复计算结果一致
t("重启不伪造执行", () => {
  const ms = [M("m", "欧冠", "主", "2026-11-25T01:45:00+08:00")];
  const a = planRechecks(ms, cfg);
  const b = planRechecks(ms, cfg);
  assert.deepEqual(a, b); // 确定性重算
  for (const k of ["executedAt", "executed", "status", "result"]) assert.ok(!(k in a[0]), `计划不得含执行字段:${k}`);
});

// 5e. 开赛时间变化：保存变更记录，替换计划不追加（避免重复任务）
t("开赛时间变化", () => {
  const { updatePlanKickoff, claimTask } = require("./sweep_plan.cjs");
  const plan = { rechecks: [{ eventId: "m", kickoff: "2026-11-25T01:45:00+08:00", kickoffMs: 1, kickoffBeijing: "x", planAtMs: 2, planAtBeijing: "y", offsetMin: 30 }] };
  const up = updatePlanKickoff(plan, "m", "2026-11-25T02:00:00+08:00");
  assert.equal(up.rechecks.length, 1); // 替换，未追加
  assert.equal(up.rechecks[0].planAtBeijing, "2026-11-25T01:30:00+08:00");
  assert.equal(up.kickoffChanges.length, 1);
  assert.equal(up.kickoffChanges[0].eventId, "m");
  // 认领去重：已执行拒绝重复；窗内未执行才可执行
  assert.equal(claimTask(up.rechecks[0], up.rechecks[0].planAtMs + 60000, [], undefined).decision, "execute");
  assert.equal(claimTask(up.rechecks[0], up.rechecks[0].planAtMs + 60000, ["m"], undefined).decision, "duplicate");
  assert.equal(claimTask(up.rechecks[0], up.rechecks[0].planAtMs - 1000, [], undefined).decision, "missed");
});

// 6. 统计单位：记录/不重复比赛/同场组
t("统计单位", () => {
  const items = [
    { eventId: "M1", status: "候选" }, { eventId: "M1", status: "候选" },
    { eventId: "M2", status: "排除" }, { eventId: "M3", status: "待核实" },
  ];
  const s = summarizeScope(items);
  assert.equal(s.records, 4);
  assert.equal(s.distinctMatches, 3);
  assert.equal(s.byStatus["候选"], 2);
});

// 7. 同场多市场保留明细：同一赛事不同市场是不同记录、同一复核任务
t("同场多市场", () => {
  const recs = planRechecks([M("M1", "欧冠", "主", "2026-11-25T01:45:00+08:00")], cfg);
  assert.equal(recs.length, 1); // 同一比赛只有一个临场任务（去重）
  const items = [{ eventId: "M1", market: "独赢" }, { eventId: "M1", market: "让球" }, { eventId: "M1", market: "大小" }];
  assert.equal(summarizeScope(items).distinctMatches, 1); // 不当3场独立比赛
});

// 8. 错过不补造：超时/提前/已开赛一律放弃
t("错过不补造", () => {
  const P = Date.parse("2026-11-24T17:15:00Z");
  assert.equal(withinWindow(P, P + 6 * 60000).executable, false); // 超窗
  assert.equal(withinWindow(P, P - 60000).executable, false); // 提前
});

// 9. 晨报渲染包含纳入/排除/复核时间（北京时间显式标注）
t("晨报渲染", () => {
  const sel = { total: 2, included: [M("a", "欧冠", "加", "2026-11-25T01:45:00+08:00")], excluded: [{ id: "x", reason: "超轮次上限" }] };
  const md = renderMorningReport("2026-11-19", sel, [{ eventId: "a", planAtMs: 1, planAtBeijing: "2026-11-25T01:15:00+08:00", offsetMin: 30 }], ["备注"]);
  assert.match(md, /总符合: 2/);
  assert.match(md, /排除/);
  assert.match(md, /01:15:00\+08:00/);
});

// 10. 截断不静默丢场：被排除的是更晚开赛场，且全部具名保留
t("截断保留全部", () => {
  const ms = [];
  for (let i = 0; i < 12; i++) ms.push(M("E" + i, "欧冠", "主" + i, `2026-11-2${i < 6 ? "5" : "6"}T01:00:00+08:00`));
  const sel = selectCandidates(ms, cfg, 10);
  assert.equal(sel.total, 12);
  assert.equal(sel.included.length + sel.excluded.length, 12); // 无静默丢失
  assert.ok(sel.excluded.every((e) => e.id && e.reason));
  const lastInc = new Date(sel.included[sel.included.length - 1].kickoff).getTime();
  for (const e of sel.excluded) {
    const m = ms.find((x) => x.id === e.id);
    assert.ok(new Date(m.kickoff).getTime() >= lastInc, "被排除的是更晚开赛场");
  }
});

console.log(`\nPASS ${pass} 组, exit=${process.exitCode || 0}`);
