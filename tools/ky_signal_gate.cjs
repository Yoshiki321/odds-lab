/**
 * ky_signal_gate.cjs — 下注信号判定（只读，绝不下单）
 *
 * 路径1「等够格信号」的硬门槛。全部满足才输出 SIGNAL：
 *  1) 存在经过验证的模型概率文件，且 verified=true、样本外优于基线、预测时刻<开赛、数据新鲜
 *  2) 实时盘口可拉且有效
 *  3) 模型估计EV > 0（用验证模型概率×赔率−1，不是市场基线EV）
 *  4) 距开赛在 [30min, 8h] 时间窗内
 *  5) 开云让分线 == 竞彩让分线（两边盘口一致）
 *
 * 任一不满足 → NO_SIGNAL。没有任何模型时永远 NO_SIGNAL，不可能误触发。
 * 输出写 snapshots/SIGNAL.md；有 SIGNAL 时弹 Toast（复用 ky_toast.cjs）。
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const ROOT = path.resolve(__dirname, "..");
const EXP = path.join(ROOT, "data", "experiment_survival_100");
const MODEL = path.join(EXP, "model", "basketball_verified.json");
const OUT = path.join(EXP, "snapshots", "SIGNAL.md");
const SIG_STATE = path.join(EXP, "snapshots", "_signal_state.json");
const WIN_MIN = 30 * 60000, WIN_MAX = 8 * 60 * 60000;
const FRESH_MAX = 6 * 60 * 60000; // 模型文件生成不超过 6 小时

const bj = (ms) => new Date(ms + 8 * 3600e3).toISOString().replace("T", " ").slice(0, 19);
const finite = (x) => typeof x === "number" && Number.isFinite(x);

/**
 * 纯函数门禁校验（可供单元测试与实时评估直接调用）
 * @param {object} ctx { model, candidate, nowMs }
 */
function evaluateSignalGate({ model, candidate, nowMs = Date.now() }) {
  const reasons = [];
  // 门槛1：验证模型
  if (!model) {
    reasons.push("无验证模型文件（model/basketball_verified.json 不存在）→ 不可计算，永不触发");
  } else {
    if (model.verified !== true) reasons.push("模型 verified != true");
    if (!finite(model.generatedAt) || model.generatedAt > nowMs || nowMs - model.generatedAt > FRESH_MAX) {
      reasons.push("模型文件时间戳非法或已过期（>6h 或未来时间）");
    }
    if (model.oosBeatsBaseline !== true) reasons.push("样本外未优于基线");
  }

  // 门槛2-5：实时盘口、EV>0、时间窗 [30min, 8h]、开云/竞彩盘口线一致
  if (candidate) {
    const { kickoffMs, predictMs, modelProb, odds, kyLine, jcLine } = candidate;
    if (!finite(odds) || odds <= 1) {
      reasons.push("实时赔率缺失或无效");
    }
    if (!finite(modelProb) || modelProb <= 0 || modelProb >= 1) {
      reasons.push("模型概率缺失或越界");
    } else if (finite(odds) && odds > 1) {
      const ev = modelProb * odds - 1;
      if (!(ev > 0)) reasons.push(`模型估计 EV <= 0 (${(ev * 100).toFixed(2)}%)`);
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
      reasons.push(`开云盘口线(${kyLine})与竞彩盘口线(${jcLine})不一致`);
    }
  } else if (model && reasons.length === 0) {
    reasons.push("模型已验证但未提供实时盘口候选（需接入实时候选后再启用）");
  }

  return { isSignal: reasons.length === 0, reasons };
}

function main() {
  let model = null;
  const loadErrors = [];
  if (fs.existsSync(MODEL)) {
    try { model = JSON.parse(fs.readFileSync(MODEL, "utf8")); }
    catch { loadErrors.push("模型文件解析失败"); }
  }
  const res = loadErrors.length
    ? { isSignal: false, reasons: loadErrors }
    : evaluateSignalGate({ model, candidate: null, nowMs: Date.now() });

  const { isSignal, reasons } = res;
  const ts = bj(Date.now());
  const lines = [
    `# 下注信号（${ts} 北京时间）`,
    "",
    `**状态：${isSignal ? "SIGNAL（满足全部门槛）" : "NO_SIGNAL"}**`,
    "",
    ...reasons.map(r => `- ${r}`),
    "",
    "说明：本判定只读、不下单。门槛=验证模型+样本外优于基线+模型估计EV>0+时间窗[T-30min,T-8h]+两边盘口一致。无验证模型时永远 NO_SIGNAL。",
  ];
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, lines.join("\n"), "utf8");

  let prev = {};
  try { prev = JSON.parse(fs.readFileSync(SIG_STATE, "utf8")); } catch {}
  if (isSignal && prev.status !== "SIGNAL") {
    try { require("./ky_toast.cjs").toast("开云下注信号", "满足全部门槛，请查看 SIGNAL.md"); } catch {}
  }
  fs.writeFileSync(SIG_STATE, JSON.stringify({ status: isSignal ? "SIGNAL" : "NO_SIGNAL", at: Date.now(), reasons }, null, 2), "utf8");

  process.stdout.write(`${ts} ${isSignal ? "SIGNAL" : "NO_SIGNAL"} reasons=${reasons.length}\n`);
}

module.exports = { evaluateSignalGate, WIN_MIN, WIN_MAX, FRESH_MAX };

if (require.main === module) main();
