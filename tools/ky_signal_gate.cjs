/**
 * ky_signal_gate.cjs — 下注信号判定（只读，绝不下单）
 *
 * 硬门槛（全部满足才输出 SIGNAL）：
 *  1) 存在经过验证的模型概率文件（verified=true、oosBeatsBaseline=true、数据新鲜且非未来时间）
 *  2) 实时盘口可拉且有效（非封盘）
 *  3) 精确净 EV > MIN_EV（默认 +2.5% 安全垫，复用 pricing.cjs；1/4 凯利注码 > 0）
 *  4) 距开赛在 [30min, 8h] 时间窗内且预测时刻 < 开赛时间
 *  5) 开云盘口线 == 竞彩/基准盘口线（盘口一致）
 *
 * 任一不满足 → NO_SIGNAL。未通过 OOS 验证的模型永远 NO_SIGNAL。
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { calcBinaryEV, calcHandicapOrTotalEV, fractionalKelly } = require("./pricing.cjs");

const ROOT = path.resolve(__dirname, "..");
const EXP = path.join(ROOT, "data", "experiment_survival_100");
const MODEL_FOOTBALL = path.join(EXP, "model", "football_residual_v1.json");
const MODEL_BASKETBALL = path.join(EXP, "model", "basketball_verified.json");
const OUT = path.join(EXP, "snapshots", "SIGNAL.md");
const SIG_STATE = path.join(EXP, "snapshots", "_signal_state.json");
const WIN_MIN = 30 * 60000;
const WIN_MAX = 8 * 60 * 60000;
const FRESH_MAX = 6 * 60 * 60000;
const DEFAULT_MIN_EV = 0.025; // +2.5% 最小 EV 安全垫，覆盖滑点与估计误差

const bj = (ms) => new Date(ms + 8 * 3600e3).toISOString().replace("T", " ").slice(0, 19);
const finite = (x) => typeof x === "number" && Number.isFinite(x);

/**
 * 纯函数五门禁校验
 * @param {object} ctx { model, candidate, nowMs, minEv }
 */
function evaluateSignalGate({ model, candidate, nowMs = Date.now(), minEv = DEFAULT_MIN_EV }) {
  const reasons = [];
  let ev = null;
  let kellyFrac = 0;

  // 门槛 1：验证模型
  if (!model) {
    reasons.push("无已验证模型文件 → 不可计算，信号门保持关闭");
  } else {
    if (model.verified !== true) reasons.push("模型 verified != true（未通过样本外准入门槛）");
    if (!finite(model.generatedAt) || model.generatedAt > nowMs || nowMs - model.generatedAt > FRESH_MAX) {
      reasons.push("模型文件时间戳非法或已过期（>6h 或未来时间）");
    }
    if (model.oosBeatsBaseline !== true) reasons.push("样本外未显著优于市场基线");
  }

  // 门槛 2–5：实时盘口、精确 EV > minEv、时间窗 [30min, 8h]、盘口线一致
  if (candidate) {
    const { kickoffMs, predictMs, modelProb, probAtLine, line, odds, confirmOdds30s, isSuspended, kyLine, jcLine } = candidate;
    if (isSuspended === true) reasons.push("目标盘口已封盘/挂起");

    // 若提供了 +30s 滑点确认价，取两者中更保守的赔率算 EV
    const effOdds = finite(confirmOdds30s) && confirmOdds30s > 1 ? Math.min(odds, confirmOdds30s) : odds;
    if (!finite(effOdds) || effOdds <= 1) {
      reasons.push("实时赔率缺失或无效");
    } else if (typeof probAtLine === "function" && finite(line)) {
      ev = calcHandicapOrTotalEV(line, effOdds, probAtLine);
    } else if (finite(modelProb) && modelProb > 0 && modelProb < 1) {
      ev = calcBinaryEV(modelProb, effOdds);
    } else {
      reasons.push("模型概率或分线概率分布缺失");
    }

    if (ev == null) {
      if (!reasons.some((r) => r.includes("概率") || r.includes("赔率"))) reasons.push("无法计算精确净 EV");
    } else if (!(ev > minEv)) {
      reasons.push(`模型估计净 EV=${(ev * 100).toFixed(2)}% 未达安全垫门槛(>${(minEv * 100).toFixed(1)}%)`);
    } else {
      kellyFrac = fractionalKelly(ev, effOdds, 0.25, minEv, 0.10);
    }

    if (!finite(kickoffMs)) {
      reasons.push("开赛时间缺失");
    } else {
      const refNow = finite(predictMs) ? predictMs : nowMs;
      if (refNow >= kickoffMs) reasons.push("预测时刻不早于开赛时间");
      const remainMs = kickoffMs - nowMs;
      if (remainMs < WIN_MIN || remainMs > WIN_MAX) {
        reasons.push(`距开赛 ${(remainMs / 60000).toFixed(1)}min，不在 [30min, 8h] 时间窗内`);
      }
    }

    if (kyLine != null && jcLine != null && Number(kyLine) !== Number(jcLine)) {
      reasons.push(`开云盘口线(${kyLine})与参考盘口线(${jcLine})不一致`);
    }
  } else if (model && reasons.length === 0) {
    reasons.push("模型已验证但未提供实时盘口候选");
  }

  return { isSignal: reasons.length === 0, ev, kellyFrac, reasons };
}

function loadActiveModel() {
  for (const fp of [MODEL_FOOTBALL, MODEL_BASKETBALL]) {
    if (fs.existsSync(fp)) {
      try {
        const j = JSON.parse(fs.readFileSync(fp, "utf8"));
        if (j && j.verified === true) return { file: fp, model: j };
      } catch {}
    }
  }
  return { file: null, model: null };
}

function main() {
  const { model } = loadActiveModel();
  const res = evaluateSignalGate({ model, candidate: null, nowMs: Date.now() });
  const { isSignal, reasons } = res;
  const ts = bj(Date.now());
  const lines = [
    `# 下注信号（${ts} 北京时间）`,
    "",
    `**状态：${isSignal ? "SIGNAL（满足全部门槛）" : "NO_SIGNAL"}**`,
    "",
    ...reasons.map((r) => `- ${r}`),
    "",
    "说明：本判定只读、不下单。门槛=OOS验证模型 + 非封盘 + 精确净EV>2.5% + 时间窗[30min,8h] + 盘口线一致。",
  ];
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, lines.join("\n"), "utf8");

  let prev = {};
  try { prev = JSON.parse(fs.readFileSync(SIG_STATE, "utf8")); } catch {}
  if (isSignal && prev.status !== "SIGNAL") {
    try { require("./ky_toast.cjs").toast("Odds-Lab 下注信号", "满足全部门槛，请查看 SIGNAL.md"); } catch {}
  }
  fs.writeFileSync(SIG_STATE, JSON.stringify({ status: isSignal ? "SIGNAL" : "NO_SIGNAL", at: Date.now(), reasons }, null, 2), "utf8");
  process.stdout.write(`${ts} ${isSignal ? "SIGNAL" : "NO_SIGNAL"} reasons=${reasons.length}\n`);
}

module.exports = { evaluateSignalGate, WIN_MIN, WIN_MAX, FRESH_MAX, DEFAULT_MIN_EV };

if (require.main === module) main();
