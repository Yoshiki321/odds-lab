/**
 * tools/pipeline_test.cjs — Odds-Lab 核心定价、跨源对齐、信号门禁与 CLV 审计全链路测试
 */
"use strict";
const assert = require("node:assert/strict");
const {
  devigProportional,
  devigPower,
  calcThreeStateEV,
  calcHandicapOrTotalEV,
  calcBinaryEV,
  fractionalKelly,
  calcCLV,
} = require("./pricing.cjs");
const { alignMatch, teamMatch, buildCanonicalId } = require("./match_crosswalk.cjs");
const { evaluateSignalGate } = require("./ky_signal_gate.cjs");
const { computeClvPairs, renderAuditMarkdown } = require("./weekly_audit.cjs");

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

// 1. Power devig vs Proportional devig on skewed 1X2
test("Power去水消除冷门偏差且概率和为1", () => {
  const prop = devigProportional([1.35, 5.0, 9.0]);
  const pwr = devigPower([1.35, 5.0, 9.0]);
  assert.ok(prop && pwr);
  assert.ok(Math.abs(pwr.probs.reduce((a, b) => a + b, 0) - 1) < 1e-6);
  // Power method assigns higher prob to favorite and lower prob to longshot than proportional
  assert.ok(pwr.probs[0] > prop.probs[0]);
  assert.ok(pwr.probs[2] < prop.probs[2]);
});

// 2. Integer Asian Handicap / Over-Under EV (push returns stake -> 0 net)
test("整盘走水精确EV计算", () => {
  const ev = calcThreeStateEV({ pWin: 0.45, pPush: 0.20, pLose: 0.35 }, 1.90);
  // 0.45 * 0.90 - 0.35 = 0.405 - 0.35 = +0.055
  assert.ok(Math.abs(ev - 0.055) < 1e-9);
});

// 3. Quarter-line (-0.75) exact 50/50 split EV
test("四分之一盘(-0.75)精确50/50拆盘EV", () => {
  const dist = {
    "-1": { pWin: 0.35, pPush: 0.25, pLose: 0.40 },
    "-0.5": { pWin: 0.60, pPush: 0.0, pLose: 0.40 },
  };
  const ev = calcHandicapOrTotalEV(-0.75, 1.90, (L) => dist[String(L)] || null);
  const evLo = 0.35 * 0.90 - 0.40; // -0.085
  const evHi = 0.60 * 0.90 - 0.40; // +0.14
  assert.ok(Math.abs(ev - 0.5 * (evLo + evHi)) < 1e-9);
  assert.equal(calcHandicapOrTotalEV(-0.3, 1.90, () => null), null); // invalid step rejected
});

// 4. Fractional Kelly with 2.5% EV cushion & 10% cap
test("1/4凯利安全垫与上限封顶", () => {
  assert.equal(fractionalKelly(0.02, 2.0, 0.25, 0.025, 0.10), 0); // below 2.5% minEv -> 0
  const f = fractionalKelly(0.08, 2.0, 0.25, 0.025, 0.10);
  assert.ok(Math.abs(f - 0.02) < 1e-9);
  assert.equal(fractionalKelly(0.80, 2.0, 0.25, 0.025, 0.10), 0.10); // capped at 10%
});

// 5. CLV calculation
test("CLV收盘价价值计算", () => {
  const clv = calcCLV(2.10, 0.50); // +5% CLV
  assert.ok(Math.abs(clv - 0.05) < 1e-6);
});

// 6. Crosswalk alignment: alias hit, youth team rejection, >30min rejection, ambiguity rejection
test("跨源对齐：别名命中、拒梯队误配、拒超时、拒歧义", () => {
  const ko = Date.parse("2026-11-22T20:00:00+08:00");
  assert.equal(teamMatch("曼城", "Manchester City"), true);
  assert.equal(teamMatch("曼城", "曼城U21"), false);
  const res1 = alignMatch(
    { home: "曼城", away: "阿森纳", kickoffMs: ko },
    [{ id: "jc1", home: "曼彻斯特城", away: "阿仙奴", kickoffMs: ko + 10 * 60000 }],
  );
  assert.equal(res1.status, "matched");
  assert.equal(res1.match.id, "jc1");

  const resLate = alignMatch(
    { home: "曼城", away: "阿森纳", kickoffMs: ko },
    [{ id: "jc1", home: "曼城", away: "阿森纳", kickoffMs: ko + 45 * 60000 }],
  );
  assert.equal(resLate.status, "unmatched");

  const resAmb = alignMatch(
    { home: "曼城", away: "阿森纳", kickoffMs: ko },
    [
      { id: "jc1", home: "曼城", away: "阿森纳", kickoffMs: ko },
      { id: "jc2", home: "曼彻斯特城", away: "阿仙奴", kickoffMs: ko + 5 * 60000 },
    ],
  );
  assert.equal(resAmb.status, "ambiguous");
  assert.ok(buildCanonicalId(ko, "曼城", "阿森纳").includes("vs"));
});

// 7. Signal gate: +30s slippage conservative odds, suspended block, minEv=2.5%, time window
test("五门禁：+30s滑点保守价、封盘拦截、最小EV门槛与时间窗", () => {
  const now = Date.now();
  const okModel = { verified: true, generatedAt: now - 5000, oosBeatsBaseline: true };
  // Passing candidate
  const pass = evaluateSignalGate({
    model: okModel,
    candidate: { kickoffMs: now + 2 * 3600e3, predictMs: now, modelProb: 0.56, odds: 1.95, confirmOdds30s: 1.90, kyLine: -0.5, jcLine: -0.5 },
    nowMs: now,
  });
  // effOdds = min(1.95, 1.90) = 1.90 -> EV = 0.56 * 1.90 - 1 = +6.4% > 2.5%
  assert.equal(pass.isSignal, true);
  assert.ok(pass.kellyFrac > 0);

  // Slippage drops EV below 2.5%
  const slipFail = evaluateSignalGate({
    model: okModel,
    candidate: { kickoffMs: now + 2 * 3600e3, predictMs: now, modelProb: 0.55, odds: 1.95, confirmOdds30s: 1.85, kyLine: -0.5, jcLine: -0.5 },
    nowMs: now,
  });
  // effOdds = 1.85 -> EV = 0.55 * 1.85 - 1 = +1.75% <= 2.5%
  assert.equal(slipFail.isSignal, false);

  // Suspended market blocked
  const susp = evaluateSignalGate({
    model: okModel,
    candidate: { kickoffMs: now + 2 * 3600e3, predictMs: now, modelProb: 0.60, odds: 2.0, isSuspended: true },
    nowMs: now,
  });
  assert.equal(susp.isSignal, false);
});

// 8. Weekly audit CLV pairing
test("周度CLV审计配对与报告渲染", () => {
  const mockState = {
    mainOk: { "1001": { endBJ: "2026-11-21 19:28:00", odds: { h: 2.15, d: 3.40, a: 3.50 } } },
    closingOk: { "1001": { endBJ: "2026-11-21 19:58:00", odds: { h: 1.95, d: 3.50, a: 4.00 } } },
  };
  const pairs = computeClvPairs(mockState);
  assert.equal(pairs.length, 1);
  assert.ok(pairs[0].clvH > 0, "expected positive CLV when T-30 odds 2.15 > closing 1.95");
  const md = renderAuditMarkdown(pairs, "2026-11-21");
  assert.ok(md.includes("配对样本数") && md.includes("还差 299 场"));
});

console.log(`\nPIPELINE TESTS PASSED (${passed}/${passed})`);
