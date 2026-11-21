/**
 * ky_signal_gate.cjs — 下注信号判定（只读，绝不下单）
 *
 * 路径1「等够格信号」的硬门槛。全部满足才输出 SIGNAL：
 *  1) 存在经过验证的篮球模型概率文件，且 verified=true、样本外优于基线、预测时刻<开赛、数据新鲜
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
const auth = require("./ky_api_auth.cjs");

const ROOT = path.resolve(__dirname, "..");
const EXP = path.join(ROOT, "data", "experiment_survival_100");
const MODEL = path.join(EXP, "model", "basketball_verified.json");
const OUT = path.join(EXP, "snapshots", "SIGNAL.md");
const SIG_STATE = path.join(EXP, "snapshots", "_signal_state.json");
const WIN_MIN = 30 * 60000, WIN_MAX = 8 * 60 * 60000;
const FRESH_MAX = 6 * 60 * 60000; // 模型文件生成不超过 6 小时

const unwrap = (t) => { const j = JSON.parse(t); return typeof j.data === "string" && j.data.startsWith("H4sI") ? JSON.parse(zlib.gunzipSync(Buffer.from(j.data, "base64")).toString("utf8")) : j; };
const bj = (ms) => new Date(ms + 8 * 3600e3).toISOString().replace("T", " ").slice(0, 19);
const finite = (x) => typeof x === "number" && Number.isFinite(x);

function main() {
  const reasons = [];
  let model = null;
  // 门槛1：验证模型
  if (!fs.existsSync(MODEL)) {
    reasons.push("无验证篮球模型文件（model/basketball_verified.json 不存在）→ 不可计算，永不触发");
  } else {
    try { model = JSON.parse(fs.readFileSync(MODEL, "utf8")); } catch { reasons.push("模型文件解析失败"); }
    if (model) {
      if (model.verified !== true) reasons.push("模型 verified != true");
      if (!finite(model.generatedAt) || Date.now() - model.generatedAt > FRESH_MAX) reasons.push("模型文件过期（>6h）");
      if (model.oosBeatsBaseline !== true) reasons.push("样本外未优于基线");
    }
  }

  // 没有通过门槛1就写 NO_SIGNAL 并退出，不拉盘口、绝不下单
  if (model && reasons.length === 0) {
    // 门槛2/3/4/5 需要实时盘口，此处留待模型就绪后接入；当前阶段永远走不到
    reasons.push("模型已验证但实时盘口判定尚未接入（需接入后再启用）");
  }

  const isSignal = reasons.length === 0;
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
  fs.writeFileSync(OUT, lines.join("\n"), "utf8");

  // 状态翻转时弹 Toast（异常/信号出现都要让人知道）
  let prev = {};
  try { prev = JSON.parse(fs.readFileSync(SIG_STATE, "utf8")); } catch {}
  if (isSignal && prev.status !== "SIGNAL") {
    try { require("./ky_toast.cjs").toast("开云下注信号", "满足全部门槛，请查看 SIGNAL.md"); } catch {}
  }
  fs.writeFileSync(SIG_STATE, JSON.stringify({ status: isSignal ? "SIGNAL" : "NO_SIGNAL", at: Date.now(), reasons }, null, 2), "utf8");

  process.stdout.write(`${ts} ${isSignal ? "SIGNAL" : "NO_SIGNAL"} reasons=${reasons.length}\n`);
}
main();
