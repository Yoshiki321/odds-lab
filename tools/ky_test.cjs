/** ky_test.cjs — 守护逻辑单测（纯解析，不联网）。node tools/ky_test.cjs */
"use strict";
const assert = require("node:assert/strict");
const { parseMatches, tierOf, normLeague, selectAndPlan, makeRechecks } = require("./ky_daemon.cjs");

let pass = 0;
function t(name, fn) {
  try { fn(); pass += 1; console.log("ok - " + name); }
  catch (e) { console.error("FAIL - " + name + "\n" + e.stack); process.exitCode = 1; }
}

const SAMPLE = [
  "欧洲冠军联赛", "18", "全场独赢",
  "加拉塔萨雷", "阿斯顿维拉", "11月25日", "01:45(GMT+8)", "主胜", "2.46",
  "博多格林特", "林茨", "11月25日", "01:45(GMT+8)", "主胜", "1.51",
  "英格兰超级联赛", "20",
  "曼城", "富勒姆", "11月21日", "20:30(GMT+8)", "主胜", "1.24",
].join("\n");

t("解析出场次与开赛时间(+08:00)", () => {
  const ms = parseMatches(SAMPLE);
  assert.equal(ms.length, 3);
  const gal = ms.find((m) => m.home === "加拉塔萨雷");
  assert.equal(gal.kickoff, "2026-11-25T01:45:00+08:00");
  assert.equal(gal.kickoffMs, Date.parse("2026-11-25T01:45:00+08:00"));
});

t("联赛全称归一", () => {
  assert.equal(normLeague("英格兰超级联赛"), "英超");
  assert.equal(normLeague("欧洲冠军联赛"), "欧冠");
  assert.equal(tierOf("英格兰超级联赛"), 1);
  assert.equal(tierOf("德国乙级联赛"), 2);
  assert.equal(tierOf("某不知名联赛"), 3);
});

t("范围筛选：未来72h内才纳入", () => {
  const ms = parseMatches(SAMPLE);
  const now = Date.parse("2026-11-21T00:00:00+08:00"); // 曼城场在 20:30 当天 → 纳入
  const sel = selectAndPlan(ms, now);
  assert.ok(sel.included.some((m) => m.home === "曼城"), "72h内应纳入");
  assert.ok(!sel.included.some((m) => m.home === "加拉塔萨雷"), "11-25 超72h应排除");
  assert.equal(sel.capped, false);
});

t("临场计划=开赛前30分钟（北京时间标注+绝对毫秒）", () => {
  const ms = parseMatches(SAMPLE);
  const sel = selectAndPlan(ms, Date.parse("2026-11-21T00:00:00+08:00"));
  const rc = makeRechecks(sel.included);
  const mci = rc.find((r) => r.home === "曼城");
  assert.equal(mci.planAtBeijing, "2026-11-21T20:00:00+08:00");
  assert.equal(mci.planAtMs, Date.parse("2026-11-21T20:00:00+08:00"));
});

t("去重：同场同开赛只留一条", () => {
  const dup = SAMPLE + "\n曼城\n富勒姆\n11月21日\n20:30(GMT+8)";
  const ms = parseMatches(dup);
  assert.equal(ms.filter((m) => m.home === "曼城").length, 1);
});

console.log(`\nPASS ${pass} 组, exit=${process.exitCode || 0}`);
