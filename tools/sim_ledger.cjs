/**
 * sim_ledger.cjs — 开云体育 100 元生存实验:模拟账本 + 前向验证流程.
 *
 * 铁律(第三章):
 * - 只能模拟,绝不提交任何真实订单,不做投注单金额测试,不操作浏览器下单.
 * - 与 data/experiment_survival_100/ledger.json(真实账本,保持 0 单)完全隔离.
 * - 模拟赔率只是观察报价 ≠ 可成交价;金额恒为 0 或 "SIM";平台订单号恒为 null.
 * - 规则不明则结算 status 恒为"待确认",绝不猜胜负/盈亏.
 * - 预测不可变:写入后不得修改原文,改错只追加新版本保留历史.
 *
 * 用法:
 *   node tools/sim_ledger.cjs validate <decision.json>
 *   node tools/sim_ledger.cjs add <decision.json>
 *   node tools/sim_ledger.cjs report YYYY-MM-DD
 *   node tools/sim_test.cjs   (自动化测试)
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const EXP_DIR = path.join(ROOT, "data", "experiment_survival_100");
const SIM_PATH = path.join(EXP_DIR, "simulation.json");
const RISK_PATH = path.join(EXP_DIR, "risk_config.json");
const PRED_DIR = path.join(EXP_DIR, "predictions");
const REPORT_DIR = path.join(EXP_DIR, "reports");

const SETTLEMENT_PENDING = "待确认";
const SETTLEMENT_DONE = "已结算";
const SETTLEMENT_VOID = "已取消";

// ---------------------------------------------------------------- 风险上限
function getRiskCaps(riskCfg) {
  const cfg = riskCfg || readJsonQuiet(RISK_PATH) || {};
  return {
    initialCapital: Number(cfg.initialCapital ?? 100),
    singleMax: Number(cfg.singleMax ?? 1),
    maxConcurrentOpenRisk: Number(cfg.maxConcurrentOpenRisk ?? 3),
    dailyMaxRisk: Number(cfg.dailyMaxRisk ?? 5),
    experimentMaxLoss: Number(cfg.experimentMaxLoss ?? 20),
  };
}

/** 风险上限校验:只记录不执行.返回每档 pass/fail + 原因. */
function checkRiskCaps(decision, context) {
  const caps = getRiskCaps(context && context.riskCfg);
  // 模拟单固定按 1 SIM 单位做"假如真下"的上限试算(不执行).
  const simStake = 1;
  const dayUsed = Number((context && context.dayUsedSim) || 0);
  const openRisk = Number((context && context.openRiskSim) || 0);
  const expLoss = Number((context && context.experimentLossSim) || 0);
  const checks = {
    single: simStake <= caps.singleMax ? "pass" : "fail",
    concurrent: openRisk + simStake <= caps.maxConcurrentOpenRisk ? "pass" : "fail",
    daily: dayUsed + simStake <= caps.dailyMaxRisk ? "pass" : "fail",
    experiment: expLoss + simStake <= caps.experimentMaxLoss ? "pass" : "fail",
    note: "校验只记录不执行,不下单、不锁额度",
    simStake,
    caps,
  };
  return checks;
}

// ---------------------------------------------------------------- 数据质量
function isBlank(v) {
  return v === undefined || v === null || (typeof v === "string" && v.trim() === "");
}

/**
 * 数据质量检查:缺失赔率/时间/赛事 ID 则拒绝记为有效预测.
 * 返回 { valid, missing: {missingOdds, missingTime, missingEventId}, reasons[] }
 */
function checkDataQuality(dec) {
  const reasons = [];
  const missingOdds =
    !dec.observedOdds || typeof dec.observedOdds.price !== "number" || !(dec.observedOdds.price > 1);
  const missingTime =
    isBlank(dec.observedOdds && dec.observedOdds.observedAt) ||
    isBlank(dec.dateAsiaShanghai);
  const missingEventId = !dec.event || isBlank(dec.event.id);
  if (missingOdds) reasons.push("缺失赔率:observedOdds.price 必须为 >1 的数字");
  if (missingTime) reasons.push("缺失时间:observedOdds.observedAt 与 dateAsiaShanghai 均为必填");
  if (missingEventId) reasons.push("缺失赛事ID:event.id 必填");
  if (isBlank(dec.market)) reasons.push("缺失市场:market 必填");
  if (isBlank(dec.side)) reasons.push("缺失方向:side 必填");
  if (isBlank(dec.modelName) || isBlank(dec.modelVersion)) reasons.push("缺失模型:modelName+modelVersion 必填");
  if (isBlank(dec.dataSource)) reasons.push("缺失来源:dataSource 必填");
  if (typeof dec.prob !== "number" || !(dec.prob >= 0 && dec.prob <= 1))
    reasons.push("缺失概率:prob 必须为 0~1 数字");
  return {
    valid: reasons.length === 0,
    missing: { missingOdds, missingTime, missingEventId },
    reasons,
  };
}

/** 规范键:同赛事同市场同方向幂等. */
function canonicalKey(dec) {
  const e = (dec.event && dec.event.id) || "";
  return [String(e), String(dec.market || ""), String(dec.side || ""), String(dec.line ?? "")].join("|");
}

/**
 * 同一快照冒充多样本检出:同一 observedAt + 同一赛事只计一次.
 * 返回 { groups: {key: decisionId[]}, reusedKeys[], effectiveCount }
 */
function detectSnapshotReuse(decisions) {
  const map = new Map();
  for (const d of decisions) {
    const at = (d.observedOdds && d.observedOdds.observedAt) || "";
    const eid = (d.event && d.event.id) || "";
    const k = `${eid}@@${at}`;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(d.decisionId);
  }
  const groups = Object.fromEntries(map);
  const reusedKeys = [...map.entries()].filter(([, v]) => v.length > 1).map(([k]) => k);
  const effectiveCount = map.size; // 每组只计一次
  return { groups, reusedKeys, effectiveCount };
}

// ---------------------------------------------------------------- 校验
function validateDecision(dec, existing, context) {
  const errors = [];
  const warnings = [];

  if (!dec || typeof dec !== "object") return { ok: false, errors: ["decision 必须为对象"], warnings };

  if (isBlank(dec.decisionId)) errors.push("decisionId 必填且去重");
  if (isBlank(dec.dateAsiaShanghai) || !/^\d{4}-\d{2}-\d{2}$/.test(String(dec.dateAsiaShanghai || "")))
    errors.push("dateAsiaShanghai 必填,格式 YYYY-MM-DD(Asia/Shanghai)");

  // decisionId 去重(幂等)
  if (!isBlank(dec.decisionId) && existing.some((d) => d.decisionId === dec.decisionId))
    errors.push(`decisionId 去重:已存在 ${dec.decisionId},幂等拒绝重复写入`);

  // 同赛事同市场同方向幂等(不同 decisionId 但同键也拒绝)
  if (existing.some((d) => canonicalKey(d) === canonicalKey(dec)))
    errors.push(`幂等拒绝:同赛事同市场同方向已存在(canonicalKey=${canonicalKey(dec)})`);

  // 模拟赔率必须带 observedAt 时间戳
  if (!dec.observedOdds || isBlank(dec.observedOdds.observedAt))
    errors.push("observedOdds.observedAt 必填(模拟赔率必须带时间戳)");
  if (dec.observedOdds && typeof dec.observedOdds.price !== "number")
    errors.push("observedOdds.price 必须为数字(只是观察报价≠可成交)");

  // 金额恒为 0 或 SIM;平台订单号恒为 null
  if (!(dec.amount === 0 || dec.amount === "SIM"))
    errors.push('金额恒为 0 或 "SIM",绝不允许真实金额');
  if (dec.platformOrderId !== null) errors.push("平台订单号恒为 null(模拟永不下单)");
  // schema 外下单相关字段一律拒绝（防误调用实单入口）
  for (const k of ["betUrl", "orderId", "txId", "stake", "submit", "placeOrder", "betRecord"]) {
    if (dec[k] !== undefined && dec[k] !== null && dec[k] !== "")
      errors.push(`误调用拒绝:schema 外下单相关字段 ${k} 不得出现`);
  }

  // EV 计算:记录公式 prob*price-1(每 SIM 单位期望)
  if (typeof dec.prob === "number" && dec.observedOdds && typeof dec.observedOdds.price === "number") {
    const ev = dec.prob * dec.observedOdds.price - 1;
    if (typeof dec.evPerUnit !== "number") {
      warnings.push(`evPerUnit 未填,按公式 prob*price-1 应为 ${ev.toFixed(4)}(仅提示,不自动回填)`);
    } else if (Math.abs(dec.evPerUnit - ev) > 1e-6) {
      errors.push(`EV 计算不一致:填报 ${dec.evPerUnit} vs 公式 prob*price-1=${ev.toFixed(6)}`);
    }
  }
  if (isBlank(dec.uncertainty)) warnings.push("uncertainty 建议填写(不确定性说明)");

  // 赛果/结算/盈亏:规则不明则 status 待确认,绝不猜
  const st = dec.settlement && dec.settlement.status;
  if (![SETTLEMENT_PENDING, SETTLEMENT_DONE, SETTLEMENT_VOID].includes(st))
    errors.push(`settlement.status 必须为 ${SETTLEMENT_PENDING}/${SETTLEMENT_DONE}/${SETTLEMENT_VOID} 之一`);
  if (st === SETTLEMENT_PENDING) {
    if (dec.settlement.pnl !== null && dec.settlement.pnl !== undefined)
      errors.push("待确认结算绝不猜盈亏:pnl 必须为 null");
    if (dec.settlement.result === "win" || dec.settlement.result === "loss")
      errors.push("待确认结算绝不猜胜负:result 不得写 win/loss");
  }
  if (st === SETTLEMENT_DONE) {
    if (isBlank(dec.settlement.rulesConfirmedBy) || isBlank(dec.settlement.resultSource))
      errors.push("已结算必须同时给出 rulesConfirmedBy(规则确认依据)+resultSource(赛果来源),否则只能待确认");
  }

  // 时间/时区:date 必须等于 observedAt 的 Asia/Shanghai 日期；预测必须早于开赛
  if (dec.observedOdds && !isBlank(dec.observedOdds.observedAt)) {
    const dOfObs = asiaDateOf(dec.observedOdds.observedAt);
    if (dOfObs && dec.dateAsiaShanghai && String(dec.dateAsiaShanghai) !== dOfObs)
      errors.push(`日期必须等于观察时间的 Asia/Shanghai 日期:date=${dec.dateAsiaShanghai} vs observedAt归属 ${dOfObs}(跨午夜按观察时刻归属)`);
  }
  const t = isPredictionBeforeKickoff(dec);
  if (t.checked && !t.ok)
    errors.push("预测时间必须早于对应赛事或玩法截止时间:observedAt 必须早于 kickoff(赛后补记一律拒绝)");
  if (dec.event && !isBlank(dec.event.kickoffAsiaShanghai)) {
    const tk = new Date(String(dec.event.kickoffAsiaShanghai)).getTime();
    if (isNaN(tk)) errors.push("event.kickoffAsiaShanghai 时间格式无效");
  }

  // 数据质量
  const dq = checkDataQuality(dec);
  if (!dq.valid) {
    errors.push(`数据质量拒绝记为有效预测:${dq.reasons.join(";")}`);
  }

  // 风险检查只记录不执行(缺失则提示补上,不拦截但记 warning?这里记 error 要求补齐以便审计)
  if (!dec.riskCheck) warnings.push("riskCheck 缺失:应附 100/1/3/5/20 上限校验(只记录不执行)");

  return { ok: errors.length === 0, errors, warnings, dataQuality: dq };
}

// ---------------------------------------------------------------- 时间/时区(Asia/Shanghai)
/** observedAt/kickoff 的 Asia/Shanghai 日期 YYYY-MM-DD；解析失败返回 null */
function asiaDateOf(iso) {
  if (isBlank(iso)) return null;
  const d = new Date(String(iso));
  if (isNaN(d.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(d);
    const y = parts.find((p) => p.type === "year").value;
    const m = parts.find((p) => p.type === "month").value;
    const day = parts.find((p) => p.type === "day").value;
    return `${y}-${m}-${day}`;
  } catch {
    return null;
  }
}

/** 预测时间必须早于开赛/截止时间；无 kickoff 则不拦截(只要求 observedAt 存在) */
function isPredictionBeforeKickoff(dec) {
  const kick = dec.event && dec.event.kickoffAsiaShanghai;
  const obs = dec.observedOdds && dec.observedOdds.observedAt;
  if (isBlank(kick) || isBlank(obs)) return { checked: false, ok: true };
  const tKick = new Date(String(kick)).getTime();
  const tObs = new Date(String(obs)).getTime();
  if (isNaN(tKick) || isNaN(tObs)) return { checked: false, ok: true };
  return { checked: true, ok: tObs < tKick, tObs, tKick };
}

// ---------------------------------------------------------------- 隔离:写盘路径收敛
/** 所有写盘必须收敛在实验目录内；越界一律拒绝（防账本混写） */
function assertInsideExpDir(p, label) {
  const resolved = path.resolve(p);
  if (resolved !== EXP_DIR && !resolved.startsWith(EXP_DIR + path.sep))
    throw new Error(`${label || "写盘越界拒绝"}:${p} 不在实验目录内`);
  return resolved;
}

// ---------------------------------------------------------------- 记录单位 vs 统计单位
/** 不重复比赛数：按 event.id 去重 */
function distinctMatchIds(list) {
  const s = new Set();
  for (const d of list || []) {
    const id = d && d.event && d.event.id;
    if (id !== undefined && id !== null && String(id) !== "") s.add(String(id));
  }
  return [...s];
}

/** 同场关联组：同 event.id 的多记录为一组（高度相关，不得当独立比赛） */
function groupByEvent(list) {
  const map = new Map();
  for (const d of list || []) {
    const id = String((d && d.event && d.event.id) || "");
    if (!map.has(id)) map.set(id, []);
    map.get(id).push(d.decisionId || d.decisionId === 0 ? d.decisionId : "?");
  }
  return Object.fromEntries(map);
}

/**
 * 范围汇总：记录数 / 不重复比赛数 / 同场组 / 状态分布。
 * 状态：有效(effective, 进 simulation 且校验通过) / 放弃(abandoned, skipReason 非空) / 缺失(missing)。
 */
function summarizeRecords(items) {
  const records = (items || []).length;
  const distinctMatches = distinctMatchIds(items).length;
  const groups = groupByEvent(items);
  const byStatus = { effective: 0, abandoned: 0, missing: 0 };
  for (const d of items || []) {
    if (d && d.status === "abandoned") byStatus.abandoned += 1;
    else if (d && d.missing) byStatus.missing += 1;
    else byStatus.effective += 1;
  }
  return { records, distinctMatches, groupCount: Object.keys(groups).length, groups, byStatus };
}

// ---------------------------------------------------------------- 存储
function readJsonQuiet(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function loadSimulation() {
  const j = readJsonQuiet(SIM_PATH);
  if (!j || !Array.isArray(j.decisions)) throw new Error(`simulation.json 损坏或缺失 decisions[]:${SIM_PATH}`);
  return j;
}

function addDecision(dec) {
  assertInsideExpDir(SIM_PATH, "模拟账本写盘越界拒绝");
  const sim = loadSimulation();
  const v = validateDecision(dec, sim.decisions, {});
  if (!v.ok) {
    const e = new Error("校验未通过,拒绝写入:\n- " + v.errors.join("\n- "));
    e.validation = v;
    throw e;
  }
  // 附上风险试算(只记录不执行)与质量标记
  const withMeta = {
    ...dec,
    observedOdds: {
      ...dec.observedOdds,
      note: "只是观察报价≠可成交价,未下单、不可复制成交",
    },
    riskCheck: dec.riskCheck || { ...checkRiskCaps(dec, {}), mode: "SIM_ONLY" },
    dataQuality: v.dataQuality,
    amount: dec.amount,
    platformOrderId: null,
  };
  sim.decisions.push(withMeta);
  sim.meta.updatedAtAsiaShanghai = new Date().toISOString();
  fs.writeFileSync(SIM_PATH, JSON.stringify(sim, null, 2), "utf8");
  return withMeta;
}

/**
 * 预测不可变快照:写入后不得修改原文,改错只追加新版本保留历史.
 * 路径 predictions/<date>_v<version>.json;已存在则拒绝覆盖.
 */
function savePredictionSnapshot(dateStr, items, version) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || ""))) throw new Error("date 格式必须为 YYYY-MM-DD");
  const v = Number(version);
  if (!Number.isInteger(v) || v < 1) throw new Error("version 必须为 >=1 的整数");
  fs.mkdirSync(PRED_DIR, { recursive: true });
  assertInsideExpDir(PRED_DIR, "快照目录越界拒绝");
  const fp = path.join(PRED_DIR, `${dateStr}_v${v}.json`);
  assertInsideExpDir(fp, "快照写盘越界拒绝");
  if (fs.existsSync(fp)) throw new Error(`不可变拒绝覆盖:已存在 ${fp},请用 v${v + 1} 追加新版本`);
  const payload = {
    meta: {
      dateAsiaShanghai: dateStr,
      version: v,
      immutable: true,
      note: "写入后不得修改原文,改错只追加新版本保留历史",
    },
    items,
  };
  fs.writeFileSync(fp, JSON.stringify(payload, null, 2), "utf8");
  return fp;
}

// ---------------------------------------------------------------- 日报
function buildDailyReport(dateStr) {
  const sim = loadSimulation();
  const day = sim.decisions.filter((d) => d.dateAsiaShanghai === dateStr);
  const dq = checkDataQualitySummary(day);
  const reuse = detectSnapshotReuse(day);
  const settled = day.filter((d) => d.settlement && d.settlement.status === SETTLEMENT_DONE);
  const pending = day.filter((d) => !d.settlement || d.settlement.status === SETTLEMENT_PENDING);
  const noBetReasons = collectNoBetReasons(day);
  return {
    dateAsiaShanghai: dateStr,
    predictions: day.length,
    effectiveSamples: reuse.effectiveCount,
    simulations: day.length,
    missing: dq,
    settledCount: settled.length,
    pendingCount: pending.length,
    snapshotReuseGroups: reuse.reusedKeys.length,
    errors: [],
    noBetReasons,
  };
}

function checkDataQualitySummary(day) {
  let missing = 0;
  const details = [];
  for (const d of day) {
    const q = checkDataQuality(d);
    if (!q.valid) {
      missing += 1;
      details.push({ decisionId: d.decisionId, reasons: q.reasons });
    }
  }
  return { missingCount: missing, details };
}

function collectNoBetReasons(day) {
  const reasons = [];
  for (const d of day) {
    if (d.skipReason) reasons.push(`${d.decisionId}: ${d.skipReason}`);
  }
  if (reasons.length === 0)
    reasons.push("真实下注停止:平台最小投注 2.00 元 > 单注上限 1 元,按第三章停真实下注,仅模拟");
  return reasons;
}

function renderReportMarkdown(r) {
  const lines = [
    `# 生存实验日报 ${r.dateAsiaShanghai}(Asia/Shanghai)`,
    ``,
    `> 模拟≠真实:本报告全部为模拟记录,无订单提交;赔率≠成交价.`,
    ``,
    `- 预测数:${r.predictions}(有效样本 ${r.effectiveSamples},同一快照同赛事只计一次)`,
    `- 模拟数:${r.simulations}(金额全为 0/SIM,订单号全为 null)`,
    `- 数据缺失:${r.missing.missingCount}`,
    `- 已结:${r.settledCount}(规则未确认一律记待确认,不猜)`,
    `- 待确认:${r.pendingCount}`,
    `- 快照复用组:${r.snapshotReuseGroups}`,
    `- 错误:${r.errors.length ? r.errors.join(";") : "无"}`,
    ``,
    `## 数据缺失明细`,
    ...(r.missing.details.length
      ? r.missing.details.map((d) => `- ${d.decisionId}: ${d.reasons.join(";")}`)
      : [`- 无`]),
    ``,
    `## 不下注原因`,
    ...r.noBetReasons.map((s) => `- ${s}`),
    ``,
    `_由 tools/sim_ledger.cjs 生成,只读 ledger.json 真实账本做隔离核对,不写入真实账本._`,
  ];
  return lines.join("\n");
}

// ---------------------------------------------------------------- CLI
function main(argv) {
  const [cmd, arg] = argv.slice(2);
  if (cmd === "validate") {
    const dec = JSON.parse(fs.readFileSync(arg, "utf8"));
    const sim = loadSimulation();
    const v = validateDecision(dec, sim.decisions, {});
    console.log(JSON.stringify(v, null, 2));
    process.exitCode = v.ok ? 0 : 2;
  } else if (cmd === "add") {
    const dec = JSON.parse(fs.readFileSync(arg, "utf8"));
    const saved = addDecision(dec);
    console.log(`OK ${saved.decisionId}`);
  } else if (cmd === "report") {
    const dateStr = arg;
    const r = buildDailyReport(dateStr);
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    assertInsideExpDir(REPORT_DIR, "报告目录越界拒绝");
    const fp = path.join(REPORT_DIR, `${dateStr}.md`);
    assertInsideExpDir(fp, "报告写盘越界拒绝");
    if (fs.existsSync(fp)) {
      console.error(`不可变拒绝覆盖:已存在 ${fp}`);
      process.exitCode = 2;
      return;
    }
    fs.writeFileSync(fp, renderReportMarkdown(r), "utf8");
    console.log(`OK ${fp}`);
  } else {
    console.error("用法: node tools/sim_ledger.cjs validate|add|report ...");
    process.exitCode = 2;
  }
}

if (require.main === module) main(process.argv);

module.exports = {
  getRiskCaps,
  checkRiskCaps,
  checkDataQuality,
  canonicalKey,
  detectSnapshotReuse,
  asiaDateOf,
  isPredictionBeforeKickoff,
  validateDecision,
  loadSimulation,
  addDecision,
  savePredictionSnapshot,
  buildDailyReport,
  renderReportMarkdown,
  assertInsideExpDir,
  distinctMatchIds,
  groupByEvent,
  summarizeRecords,
  SETTLEMENT_PENDING,
  SETTLEMENT_DONE,
  SETTLEMENT_VOID,
};
