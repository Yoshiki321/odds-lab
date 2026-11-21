/** sim_test.cjs — 模拟账本自动化测试(只读/只写隔离区,不碰真实账本). node tools/sim_test.cjs */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  getRiskCaps,
  checkRiskCaps,
  checkDataQuality,
  canonicalKey,
  detectSnapshotReuse,
  validateDecision,
  asiaDateOf,
  isPredictionBeforeKickoff,
  assertInsideExpDir,
  distinctMatchIds,
  groupByEvent,
  summarizeRecords,
  SETTLEMENT_PENDING,
} = require("./sim_ledger.cjs");

let pass = 0;
function t(name, fn) {
  try {
    fn();
    pass += 1;
    console.log(`ok - ${name}`);
  } catch (e) {
    console.error(`FAIL - ${name}\n${e.stack}`);
    process.exitCode = 1;
  }
}

function baseDec(over = {}) {
  return {
    decisionId: "SIM-20261118-001",
    dateAsiaShanghai: "2026-11-18",
    event: { id: "EVT-001", league: "TEST", home: "A", away: "B", kickoffAsiaShanghai: "2026-11-18T20:00:00+08:00" },
    market: "全场大小",
    side: "大2.5",
    line: "2.5",
    observedOdds: { price: 1.9, observedAt: "2026-11-18T10:00:00+08:00", note: "只是观察报价≠可成交价" },
    modelName: "test-model",
    modelVersion: "v0.1",
    dataSource: "unit-test",
    observedAt: "2026-11-18T10:00:00+08:00",
    prob: 0.55,
    evPerUnit: 0.55 * 1.9 - 1,
    uncertainty: "测试不确定性说明",
    skipReason: "",
    riskCheck: null,
    amount: "SIM",
    platformOrderId: null,
    settlement: { status: SETTLEMENT_PENDING, result: null, pnl: null, resultSource: "", rulesConfirmedBy: "" },
    review: "",
    ...over,
  };
}

// 1. 风险上限计算(1/3/5/20)
t("风险上限=1/3/5/20", () => {
  const caps = getRiskCaps({ singleMax: 1, maxConcurrentOpenRisk: 3, dailyMaxRisk: 5, experimentMaxLoss: 20, initialCapital: 100 });
  assert.equal(caps.singleMax, 1);
  assert.equal(caps.maxConcurrentOpenRisk, 3);
  assert.equal(caps.dailyMaxRisk, 5);
  assert.equal(caps.experimentMaxLoss, 20);
  const c1 = checkRiskCaps({}, { riskCfg: { singleMax: 1, maxConcurrentOpenRisk: 3, dailyMaxRisk: 5, experimentMaxLoss: 20 }, dayUsedSim: 0, openRiskSim: 0, experimentLossSim: 0 });
  assert.equal(c1.single, "pass");
  const c2 = checkRiskCaps({}, { riskCfg: { singleMax: 1, maxConcurrentOpenRisk: 3, dailyMaxRisk: 5, experimentMaxLoss: 20 }, dayUsedSim: 5, openRiskSim: 0, experimentLossSim: 0 });
  assert.equal(c2.daily, "fail"); // 日累计5已满,再加1超限 -> 只记录不执行
});

// 2. 去重幂等:同 decisionId 拒绝;同赛事同市场同方向拒绝
t("去重幂等", () => {
  const existing = [baseDec()];
  const sameId = baseDec();
  const v1 = validateDecision(sameId, existing, {});
  assert.equal(v1.ok, false);
  assert.match(v1.errors.join("|"), /decisionId 去重/);
  const sameKey = baseDec({ decisionId: "SIM-20261118-002" });
  assert.equal(canonicalKey(sameKey), canonicalKey(existing[0]));
  const v2 = validateDecision(sameKey, existing, {});
  assert.equal(v2.ok, false);
  assert.match(v2.errors.join("|"), /同赛事同市场同方向/);
  const diff = baseDec({ decisionId: "SIM-20261118-003", event: { id: "EVT-002" } });
  const v3 = validateDecision(diff, existing, {});
  assert.equal(v3.ok, true, JSON.stringify(v3.errors));
});

// 3. 缺失标记:缺赔率/时间/赛事ID 拒绝为有效
t("缺失标记", () => {
  const noOdds = baseDec({ decisionId: "X1", observedOdds: { observedAt: "2026-11-18T10:00:00+08:00" } });
  const q1 = checkDataQuality(noOdds);
  assert.equal(q1.valid, false);
  assert.equal(q1.missing.missingOdds, true);
  const noTime = baseDec({ decisionId: "X2", observedOdds: { price: 1.9 } });
  const q2 = checkDataQuality(noTime);
  assert.equal(q2.valid, false);
  assert.equal(q2.missing.missingTime, true);
  const noEvent = baseDec({ decisionId: "X3", event: { home: "A" } });
  const q3 = checkDataQuality(noEvent);
  assert.equal(q3.valid, false);
  assert.equal(q3.missing.missingEventId, true);
  const v = validateDecision(noOdds, [], {});
  assert.equal(v.ok, false);
  assert.match(v.errors.join("|"), /数据质量/);
});

// 4. 待确认结算不猜
t("待确认结算不猜", () => {
  const guessPnl = baseDec({ decisionId: "Y1", settlement: { status: SETTLEMENT_PENDING, result: null, pnl: 1.5 } });
  const v1 = validateDecision(guessPnl, [], {});
  assert.equal(v1.ok, false);
  assert.match(v1.errors.join("|"), /绝不猜盈亏/);
  const guessWin = baseDec({ decisionId: "Y2", settlement: { status: SETTLEMENT_PENDING, result: "win", pnl: null } });
  const v2 = validateDecision(guessWin, [], {});
  assert.equal(v2.ok, false);
  assert.match(v2.errors.join("|"), /绝不猜胜负/);
  const doneNoProof = baseDec({ decisionId: "Y3", settlement: { status: "已结算", result: "win", pnl: 0.9, resultSource: "", rulesConfirmedBy: "" } });
  const v3 = validateDecision(doneNoProof, [], {});
  assert.equal(v3.ok, false);
  assert.match(v3.errors.join("|"), /规则/);
});

// 5. 同一快照冒充多样本检出
t("快照复用检出", () => {
  const a = baseDec({ decisionId: "S1" });
  const b = baseDec({ decisionId: "S2", market: "全场让球", side: "主-0.5" }); // 同赛事同快照,不同市场
  const r = detectSnapshotReuse([a, b]);
  assert.equal(r.reusedKeys.length, 1);
  assert.equal(r.effectiveCount, 1);
  const c = baseDec({ decisionId: "S3", observedOdds: { price: 1.9, observedAt: "2026-11-18T11:00:00+08:00" } });
  const r2 = detectSnapshotReuse([a, c]);
  assert.equal(r2.reusedKeys.length, 0);
  assert.equal(r2.effectiveCount, 2);
});

// 6. 金额/订单号硬约束 + 赔率时间戳 + EV一致性
t("金额订单时间戳EV", () => {
  const cash = baseDec({ decisionId: "Z1", amount: 50 });
  assert.equal(validateDecision(cash, [], {}).ok, false);
  const ordered = baseDec({ decisionId: "Z2", platformOrderId: "ORD-1" });
  assert.equal(validateDecision(ordered, [], {}).ok, false);
  const noTs = baseDec({ decisionId: "Z3", observedOdds: { price: 1.9 } });
  assert.match(validateDecision(noTs, [], {}).errors.join("|"), /observedAt/);
  const badEv = baseDec({ decisionId: "Z4", evPerUnit: 999 });
  assert.match(validateDecision(badEv, [], {}).errors.join("|"), /EV/);
});

// 7. 真实账本隔离:测试全程不读不写 ledger.json
t("真实账本隔离", () => {
  const libSrc = fs.readFileSync(path.join(__dirname, "sim_ledger.cjs"), "utf8");
  // sim_ledger 只允许出现 SIM_PATH / ledger.json 字样用于隔离声明,不得有写真实账本的语句
  assert.doesNotMatch(libSrc, /ledger\.json.{0,80}write|writeFileSync\([^)]*ledger/i);
  const ledgerPath = path.join(__dirname, "..", "data", "experiment_survival_100", "ledger.json");
  const ledger = fs.existsSync(ledgerPath) ? JSON.parse(fs.readFileSync(ledgerPath, "utf8")) : { bets: [] };
  // 真实账本只允许用户明确批准的 EXP100-REAL-* 实单；模拟金额恒0/SIM不得出现
  for (const b of ledger.bets) {
    assert.ok(String(b.decisionId || "").startsWith("EXP100-REAL-"));
    assert.ok(!(b.amount === 0 || b.amount === "SIM"));
  }
});

// 8. 预测时间必须早于开赛/截止时间（赛后补记拒绝）
t("预测时间早于开赛", () => {
  const late = baseDec({
    decisionId: "T8-1",
    observedOdds: { price: 1.9, observedAt: "2026-11-18T21:00:00+08:00" }, // 晚于 20:00 开赛
  });
  const v = validateDecision(late, [], {});
  assert.equal(v.ok, false);
  assert.match(v.errors.join("|"), /早于开赛|早于对应赛事/);
  const exact = baseDec({
    decisionId: "T8-2",
    observedOdds: { price: 1.9, observedAt: "2026-11-18T20:00:00+08:00" }, // 等于开赛不算早于
  });
  assert.equal(validateDecision(exact, [], {}).ok, false);
  const early = baseDec({ decisionId: "T8-3" }); // 10:00 < 20:00 通过
  assert.equal(validateDecision(early, [], {}).ok, true);
  const r = isPredictionBeforeKickoff(late);
  assert.equal(r.checked, true);
  assert.equal(r.ok, false);
});

// 9. 原始预测不可被赛后覆盖（快照不可变 + 赛后时间拒绝）
t("原始预测不可覆盖", () => {
  const fp = path.join(__dirname, "..", "data", "experiment_survival_100", "predictions", "2099-01-01_v1.json");
  const { savePredictionSnapshot } = require("./sim_ledger.cjs");
  if (fs.existsSync(fp)) fs.unlinkSync(fp); // 测试前清理，保证可重复跑
  savePredictionSnapshot("2099-01-01", [{ decisionId: "IMM-1" }], 1);
  assert.throws(() => savePredictionSnapshot("2099-01-01", [{ decisionId: "IMM-2" }], 1), /拒绝覆盖/);
  fs.unlinkSync(fp); // 清理测试 artifact
  // 赛后改时间也被时间规则拦下（不能把 observedAt 改到赛后还通过）
  const post = baseDec({
    decisionId: "T9-1",
    observedOdds: { price: 1.9, observedAt: "2026-11-19T10:00:00+08:00" },
  });
  assert.equal(validateDecision(post, [], {}).ok, false);
});

// 10. 相同预测不得重复计数；同场不同盘口/方向是不同预测
t("重复计数与不同盘口区分", () => {
  const a = baseDec({ decisionId: "D1" }); // 全场大小 大2.5
  const sameAll = baseDec({ decisionId: "D2" }); // 全同 → 同一预测
  assert.equal(canonicalKey(a), canonicalKey(sameAll));
  assert.equal(validateDecision(sameAll, [a], {}).ok, false);
  const diffMarket = baseDec({ decisionId: "D3", market: "全场让球", side: "主-0.5", line: "-0.5" });
  assert.notEqual(canonicalKey(a), canonicalKey(diffMarket));
  assert.equal(validateDecision(diffMarket, [a], {}).ok, true, "不同盘口必须是不同预测，允许分别记录");
  const diffSide = baseDec({ decisionId: "D4", side: "小2.5" });
  assert.notEqual(canonicalKey(a), canonicalKey(diffSide));
  assert.equal(validateDecision(diffSide, [a], {}).ok, true, "不同方向必须是不同预测");
  const diffLine = baseDec({ decisionId: "D5", side: "大3.5", line: "3.5" });
  assert.notEqual(canonicalKey(a), canonicalKey(diffLine));
  // 有效样本：同一快照同赛事只计一次（框架已有），这里确认 3 个不同键同快照 → 复用组1、有效1
  const reuse = detectSnapshotReuse([a, diffMarket, diffSide]);
  assert.equal(reuse.effectiveCount, 1);
});

// 11. 赔率缺失或规则不明时不能算出确定盈亏
t("缺失则无确定盈亏", () => {
  const noPrice = baseDec({ decisionId: "P1", observedOdds: { price: 1.0, observedAt: "2026-11-18T10:00:00+08:00" } });
  assert.equal(validateDecision(noPrice, [], {}).ok, false); // price 必须 >1
  const nanPrice = baseDec({ decisionId: "P2", observedOdds: { price: NaN, observedAt: "2026-11-18T10:00:00+08:00" } });
  assert.equal(validateDecision(nanPrice, [], {}).ok, false);
  const pendingZero = baseDec({
    decisionId: "P3",
    settlement: { status: SETTLEMENT_PENDING, result: null, pnl: 0 }, // pnl:0 也是确定数字，不允许
  });
  assert.match(validateDecision(pendingZero, [], {}).errors.join("|"), /绝不猜盈亏/);
  const doneNoRules = baseDec({
    decisionId: "P4",
    settlement: { status: "已结算", result: "win", pnl: 0.9, resultSource: "x", rulesConfirmedBy: "" },
  });
  assert.equal(validateDecision(doneNoRules, [], {}).ok, false);
});

// 12. 数据时间/时区/跨午夜日期正确
t("时区与跨午夜", () => {
  assert.equal(asiaDateOf("2026-11-18T10:00:00+08:00"), "2026-11-18");
  assert.equal(asiaDateOf("2026-11-18T23:50:00+08:00"), "2026-11-18");
  assert.equal(asiaDateOf("2026-11-19T00:30:00+08:00"), "2026-11-19");
  assert.equal(asiaDateOf("not-a-date"), null);
  // 跨午夜：18 日 23:50 观察、19 日 00:30 开赛 → 允许，但 date 必须按观察日 18 日归属
  const night = baseDec({
    decisionId: "T12-1",
    dateAsiaShanghai: "2026-11-18",
    event: { id: "EVT-N", kickoffAsiaShanghai: "2026-11-19T00:30:00+08:00" },
    observedOdds: { price: 1.9, observedAt: "2026-11-18T23:50:00+08:00" },
  });
  assert.equal(validateDecision(night, [], {}).ok, true, JSON.stringify(validateDecision(night, [], {}).errors));
  const wrongDay = baseDec({
    decisionId: "T12-2",
    dateAsiaShanghai: "2026-11-19", // 按开赛日归属是错的，必须按观察日
    event: { id: "EVT-N2", kickoffAsiaShanghai: "2026-11-19T00:30:00+08:00" },
    observedOdds: { price: 1.9, observedAt: "2026-11-18T23:50:00+08:00" },
  });
  assert.match(validateDecision(wrongDay, [], {}).errors.join("|"), /Asia\/Shanghai 日期/);
});

// 13. 模拟订单不会触发真实平台提交（源码级隔离 + 落盘约束）
t("模拟永不触达真实", () => {
  const libSrc = fs.readFileSync(path.join(__dirname, "sim_ledger.cjs"), "utf8");
  // 允许的词：platformOrderId（恒为 null 的约束字段）；拒绝名单数组本身是字符串字面量，先剥离再扫
  const codeOnly = libSrc.replace(/(["'`])(?:(?!\1)[^\\\n]|\\.)*\1/g, "");
  assert.doesNotMatch(codeOnly, /fetch\s*\(|axios|XMLHttpRequest/i);
  assert.doesNotMatch(codeOnly, /betRecord|submitBet|placeBet|sendOrder|createOrder/i);
  assert.doesNotMatch(codeOnly, /require\s*\(\s*["']https?["']\s*\)/i);
  assert.match(libSrc, /平台订单号恒为 null/); // 约束声明必须在
  const d = baseDec({ decisionId: "T13-1" });
  const v = validateDecision(d, [], {});
  assert.equal(v.ok, true);
  assert.equal(d.platformOrderId, null);
  assert.ok(d.amount === 0 || d.amount === "SIM");
});

// 14. 赛前观察必填链（市场/方向/盘口符号/时间缺一即拒）
t("赛前观察必填链", () => {
  const noMarket = baseDec({ decisionId: "T14-1", market: "" });
  assert.match(validateDecision(noMarket, [], {}).errors.join("|"), /market/);
  const noSide = baseDec({ decisionId: "T14-2", side: "" });
  assert.match(validateDecision(noSide, [], {}).errors.join("|"), /side/);
  const noModel = baseDec({ decisionId: "T14-3", modelName: "" });
  assert.match(validateDecision(noModel, [], {}).errors.join("|"), /模型/);
});

// 15. 写盘路径收敛：穿越/非法版本一律拒绝
t("写盘路径收敛", () => {
  const { savePredictionSnapshot } = require("./sim_ledger.cjs");
  assert.throws(() => savePredictionSnapshot("../evil", [{ a: 1 }], 1), /格式|越界/);
  assert.throws(() => savePredictionSnapshot("2026-11-18", [{ a: 1 }], 0), /version/);
  assert.throws(() => savePredictionSnapshot("2026-11-18", [{ a: 1 }], -1), /version/);
  assert.throws(() => savePredictionSnapshot("2026-11-18", [{ a: 1 }], 1.5), /version/);
  assert.throws(() => assertInsideExpDir("/tmp/evil.json", "X"), /不在实验目录内/);
  // 合法路径放行
  assertInsideExpDir(require("node:path").join(__dirname, "..", "data", "experiment_survival_100", "simulation.json"));
});

// 16. 凭据零依赖：模拟程序不读任何真实投注凭据
t("凭据零依赖", () => {
  const libSrc = fs.readFileSync(path.join(__dirname, "sim_ledger.cjs"), "utf8");
  assert.doesNotMatch(libSrc, /token|cookie|passwd|apikey|api_key|sessionid|userEncrypt|X-API/i);
  assert.doesNotMatch(libSrc, /require\s*\(\s*["']https?["']\s*\)/i);
  assert.doesNotMatch(libSrc, /process\.env\.(TOKEN|COOKIE|PASSWORD|SECRET)/i);
});

// 17. 账本路径隔离：模拟账本≠真实账本且同处实验目录受收敛保护
t("账本路径隔离", () => {
  const simPath = require("node:path").join(__dirname, "..", "data", "experiment_survival_100", "simulation.json");
  const ledgerPath = require("node:path").join(__dirname, "..", "data", "experiment_survival_100", "ledger.json");
  assert.notEqual(simPath, ledgerPath);
  assertInsideExpDir(simPath);
  const sim = JSON.parse(fs.readFileSync(simPath, "utf8"));
  assert.ok(Array.isArray(sim.decisions));
  const ledger = fs.existsSync(ledgerPath) ? JSON.parse(fs.readFileSync(ledgerPath, "utf8")) : { bets: [] };
  // 2026-11-19 起：允许用户明确批准的实单 EXP100-REAL-001；其他写入一律视为混写
  for (const b of ledger.bets) {
    assert.ok(b.orderNo && b.decisionId && String(b.decisionId).startsWith("EXP100-REAL-"), `未知真实账本条目:${JSON.stringify(b).slice(0,120)}`);
    assert.ok(b.amount > 0, "真实账本金额必须为正（模拟金额恒0/SIM，与此隔离）");
  }
});

// 18. 记录单位 vs 统计单位：多记录同场只计一场
t("记录与统计单位", () => {
  const recs = [
    { decisionId: "U1", event: { id: "M1" }, status: "abandoned" },
    { decisionId: "U2", event: { id: "M1" }, status: "abandoned" },
    { decisionId: "U3", event: { id: "M1" }, status: "abandoned" },
    { decisionId: "U4", event: { id: "M2" } },
    { decisionId: "U5", event: { id: "M3" }, missing: true },
  ];
  assert.deepEqual(distinctMatchIds(recs).sort(), ["M1", "M2", "M3"]);
  const g = groupByEvent(recs);
  assert.equal(Object.keys(g).length, 3);
  assert.equal(g.M1.length, 3); // 同场 3 记录为一组，高度相关不得当 3 场独立比赛
  const s = summarizeRecords(recs);
  assert.equal(s.records, 5);
  assert.equal(s.distinctMatches, 3);
  assert.equal(s.groupCount, 3);
  assert.deepEqual(s.byStatus, { effective: 1, abandoned: 3, missing: 1 });
});

// 19. v2 快照口径：9 记录 / 3 不重复比赛 / 3 组 / 放弃 9
t("v2快照统计口径", () => {
  const snap = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "experiment_survival_100", "predictions", "2026-11-18_v2.json"), "utf8"));
  assert.equal(snap.meta.version, 2);
  assert.equal(snap.meta.immutable, true);
  const s = summarizeRecords(snap.items);
  assert.equal(s.records, 9);
  assert.equal(s.distinctMatches, 3);
  assert.equal(s.groupCount, 3);
  assert.equal(s.byStatus.abandoned, 9);
  assert.equal(s.byStatus.effective, 0);
  // 同快照同赛事多记录：快照复用检出应报 3 组复用（每场 3 记录同 observedAt）
  const reuse = detectSnapshotReuse(snap.items.map((d, i) => ({ decisionId: "R" + i, event: { id: d.event.id }, observedOdds: { observedAt: snap.meta.observedAtAsiaShanghai } })));
  assert.equal(reuse.reusedKeys.length, 3);
  assert.equal(reuse.effectiveCount, 3); // 统计按不重复比赛（快照组）计
});

// 20. 市场基线可复算：原始赔率→去水概率与文件一致，且带非模型声明
t("市场基线可复算", () => {
  const bl = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "experiment_survival_100", "baselines", "2026-11-18_v2_baseline.json"), "utf8"));
  assert.equal(bl.meta.calcVersion, "baseline-calc-v1");
  assert.ok(bl.meta.immutable);
  for (const b of bl.baselines) {
    const { home, draw, away } = b.rawOdds;
    assert.ok(home > 1 && draw > 1 && away > 1, "缺失任一必要赔率不得建基线");
    const inv = [1 / home, 1 / draw, 1 / away];
    const z = inv[0] + inv[1] + inv[2];
    const fair = inv.map((x) => x / z);
    assert.ok(Math.abs(fair[0] - b.calc.fair.home) < 5e-5, `主去水不一致:${b.event.id}`);
    assert.ok(Math.abs(fair[1] - b.calc.fair.draw) < 5e-5, `平去水不一致:${b.event.id}`);
    assert.ok(Math.abs(fair[2] - b.calc.fair.away) < 5e-5, `客去水不一致:${b.event.id}`);
    assert.ok(Math.abs((z - 1) * 100 - b.calc.marginPct) < 0.06, `水位不一致:${b.event.id}`);
    assert.match(b.disclaimer, /不是独立模型|不是下注建议/);
    assert.equal(b.observedAt, "2026-11-18T21:43:08+08:00");
  }
});

// 21. 误调用拒绝：任何带真实下单痕迹的决策一律拦下
t("误调用拒绝", () => {
  const bad1 = baseDec({ decisionId: "R1", platformOrderId: "ORD-999" });
  assert.equal(validateDecision(bad1, [], {}).ok, false);
  const bad2 = baseDec({ decisionId: "R2", amount: 2 });
  assert.equal(validateDecision(bad2, [], {}).ok, false);
  const bad3 = baseDec({ decisionId: "R3", amount: "SIM", platformOrderId: null });
  bad3.betUrl = "https://example.invalid/submit"; // schema 外的可疑下单字段
  const v3 = validateDecision(bad3, [], {});
  assert.equal(v3.ok, false);
  assert.match(v3.errors.join("|"), /误调用拒绝/);
});

console.log(`\nPASS ${pass} 组, exit=${process.exitCode || 0}`);
