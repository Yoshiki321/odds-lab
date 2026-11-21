/**
 * tools/weekly_audit.cjs — 周度 CLV（收盘价价值）与滑点审计报告生成器
 *
 * 读取 snapshots/_state.json 中配对的 T-30 主窗口（mainOk）与 T-2m 收盘价（closingOk），
 * 用 pricing.cjs 幂函数去水计算每场 CLV，输出周度审计 Markdown 报告。
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { devigPower, calcCLV } = require("./pricing.cjs");

const ROOT = path.resolve(__dirname, "..");
const EXP = path.join(ROOT, "data", "experiment_survival_100");
const STATE_FILE = path.join(EXP, "snapshots", "_state.json");
const REPORT_DIR = path.join(EXP, "reports");

function computeClvPairs(state) {
  const mainOk = (state && state.mainOk) || {};
  const closingOk = (state && state.closingOk) || {};
  const pairs = [];

  for (const [mid, mRec] of Object.entries(mainOk)) {
    const cRec = closingOk[mid];
    if (!mRec?.odds || !cRec?.odds) continue;
    const mO = mRec.odds;
    const cO = cRec.odds;
    if (!(mO.h > 1 && mO.d > 1 && mO.a > 1 && cO.h > 1 && cO.d > 1 && cO.a > 1)) continue;
    const closingFair = devigPower([cO.h, cO.d, cO.a]);
    if (!closingFair) continue;
    pairs.push({
      mid,
      mainAt: mRec.endBJ || mRec.at,
      closingAt: cRec.endBJ || cRec.at,
      clvH: calcCLV(mO.h, closingFair.probs[0]),
      clvD: calcCLV(mO.d, closingFair.probs[1]),
      clvA: calcCLV(mO.a, closingFair.probs[2]),
      bestClv: Math.max(
        calcCLV(mO.h, closingFair.probs[0]) ?? -9,
        calcCLV(mO.d, closingFair.probs[1]) ?? -9,
        calcCLV(mO.a, closingFair.probs[2]) ?? -9,
      ),
    });
  }
  return pairs;
}

function renderAuditMarkdown(pairs, dateStr) {
  const n = pairs.length;
  const meanH = n ? (pairs.reduce((s, p) => s + (p.clvH || 0), 0) / n) : null;
  const meanBest = n ? (pairs.reduce((s, p) => s + (p.bestClv || 0), 0) / n) : null;
  const posCount = pairs.filter((p) => p.bestClv > 0).length;

  const lines = [
    `# Odds-Lab 周度 CLV 与快照审计报告（${dateStr}）`,
    "",
    `- 配对样本数（T−30 主窗口 ∩ T−2m 收盘价）：**${n}** 场（上线准入门槛：300 场）`,
    `- 主胜侧平均 CLV：**${meanH != null ? (meanH * 100).toFixed(2) + "%" : "N/A"}**`,
    `- 最优方向平均 CLV：**${meanBest != null ? (meanBest * 100).toFixed(2) + "%" : "N/A"}**（正 CLV 占比：${n ? ((posCount / n) * 100).toFixed(1) + "%" : "N/A"}）`,
    "",
    "## 准入状态",
    n >= 300
      ? "- 样本量已达标，可执行 `python3 tools/train_residual_model.py` 跑正式 Walk-Forward 样本外验证。"
      : `- 当前样本量不足 300 场（还差 ${300 - n} 场），继续保持采集与虚拟注复盘，模型信号门保持关闭。`,
    "",
  ];
  return lines.join("\n");
}

function main() {
  let state = {};
  try { state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch {}
  const pairs = computeClvPairs(state);
  const dateStr = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
  const md = renderAuditMarkdown(pairs, dateStr);
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const out = path.join(REPORT_DIR, `weekly_audit_${dateStr}.md`);
  fs.writeFileSync(out, md, "utf8");
  process.stdout.write(`weekly_audit written: ${out} (pairs=${pairs.length})\n`);
}

module.exports = { computeClvPairs, renderAuditMarkdown };
if (require.main === module) main();
