/** ky_snapshot_test.cjs — 采集器纯逻辑测试（不联网、不下注） */
"use strict";
const assert = require("node:assert/strict");
const { windowOf, pickMain, MAIN_LO, MAIN_HI, AUX_LO, AUX_HI } = require("./ky_snapshot_collector.cjs");

let pass = 0;
function t(name, fn) {
  try { fn(); pass++; console.log("ok - " + name); }
  catch (e) { console.error("FAIL - " + name + "\n" + e.stack); process.exitCode = 1; }
}
const K = 1_800_000_000_000; // 假开赛时刻
const min = (n) => n * 60000;

t("窗口判定：T-35~T-30 为主窗口（含边界）", () => {
  assert.equal(windowOf(K, K - min(MAIN_HI)), "main");
  assert.equal(windowOf(K, K - min(MAIN_LO)), "main");
  assert.equal(windowOf(K, K - min(32)), "main");
});

t("窗口判定：T-25~T-20 为辅助窗口，且不与主窗口重叠", () => {
  assert.equal(windowOf(K, K - min(AUX_HI)), "aux");
  assert.equal(windowOf(K, K - min(AUX_LO)), "aux");
  assert.equal(windowOf(K, K - min(29)), null, "T-29 不属于任何窗口");
  assert.equal(windowOf(K, K - min(36)), null, "T-36 不属于任何窗口");
});

t("主样本选择：只认响应完成时刻在窗口内", () => {
  const attempts = [
    { ok: true, endMs: K - min(40) },  // 太早
    { ok: true, endMs: K - min(33) },  // 窗口内
    { ok: true, endMs: K - min(31) },  // 窗口内且更晚
    { ok: true, endMs: K - min(29) },  // 太晚（已过主窗口）
  ];
  const pick = pickMain(attempts, K);
  assert.ok(pick);
  assert.equal(pick.endMs, K - min(31));
});

t("主样本选择：窗口内全失败 → null（记 missing）", () => {
  const attempts = [{ ok: false, endMs: K - min(33) }, { ok: false, endMs: K - min(31) }];
  assert.equal(pickMain(attempts, K), null);
});

t("主样本选择：请求在窗口内发出但响应在窗口后 → 不算", () => {
  const attempts = [{ ok: true, startMs: K - min(31), endMs: K - min(29.9) }];
  assert.equal(pickMain(attempts, K), null);
});

t("主样本选择：辅助窗口记录不参与主样本", () => {
  const attempts = [{ ok: true, endMs: K - min(22) }];
  assert.equal(pickMain(attempts, K), null);
});

t("边界：恰好 T-35:00 与 T-30:00 都算主窗口", () => {
  assert.equal(windowOf(K, K - min(35)), "main");
  assert.equal(windowOf(K, K - min(30)), "main");
});

console.log(`\nPASS ${pass} 组, exit=${process.exitCode || 0}`);
