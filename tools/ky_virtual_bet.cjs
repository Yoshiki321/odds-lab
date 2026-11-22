/**
 * ky_virtual_bet.cjs — 主决策窗 T-35~T-30 的虚拟单（不碰真钱）
 * 模型未通过 OOS 验证时，按 odds-lab-ops skill 只落虚拟单（simulation.json）。
 * 用法: node tools/ky_virtual_bet.cjs
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");
const { addDecision } = require("./sim_ledger.cjs");

const ROOT = path.resolve(__dirname, "..");
const EXP = path.join(ROOT, "data", "experiment_survival_100");
const LOG = path.join(EXP, "runtime", "virtual_bet.log");

function log(msg) {
  fs.mkdirSync(path.dirname(LOG), { recursive: true });
  const ts = new Date(Date.now() + 8 * 3600e3).toISOString().replace("T", " ").slice(0, 19);
  fs.appendFileSync(LOG, `${ts} ${msg}\n`, "utf8");
  console.log(msg);
}
function bjDate(ms = Date.now()) { return new Date(ms + 8 * 3600e3).toISOString().slice(0, 10); }

function scan() {
  const out = cp.execFileSync(process.execPath, [path.join(__dirname, "ky_ev_scan.cjs"), "2", "0.02"], { timeout: 280000, encoding: "utf8" });
  const rows = [];
  for (const line of out.split(/\r?\n/)) {
    const s = line.trim();
    if (!s.startsWith("{")) continue;
    try { rows.push(JSON.parse(s)); } catch {}
  }
  return rows;
}

(function main() {
  const now = Date.now();
  const rows = scan();
  const inWindow = rows.filter((r) => {
    const k = Date.parse(String(r.kickoff).replace(" ", "T") + ":00+08:00");
    if (!Number.isFinite(k)) return false;
    const rem = k - now;
    return rem >= 28 * 60000 && rem <= 37 * 60000;
  });
  if (!inWindow.length) { log("NO_SIGNAL window=28-37min"); process.exit(0); }
  inWindow.sort((a, b) => b.ev - a.ev);
  const r = inWindow[0];
  const prob = r.pWin;
  const ev = prob * r.odds - 1;
  const dec = {
    decisionId: `SIM-EV-${r.mid}-${now}`,
    dateAsiaShanghai: bjDate(now),
    event: { id: String(r.mid), home: r.home, away: r.away, league: r.league, kickoff: r.kickoff },
    market: "全场让球",
    side: `${r.side}${r.line}`,
    line: r.line,
    observedOdds: { price: r.odds, observedAt: new Date(now).toISOString(), source: "ky_api_engine" },
    prob,
    evPerUnit: ev,
    amount: "SIM",
    platformOrderId: null,
    settlement: { status: "待确认", pnl: null, result: null },
    modelName: "poisson-fit-to-1x2",
    modelVersion: "v1-unverified",
    dataSource: "ky_api_odds",
    uncertainty: "模型未通过OOS验证（n<300）；仅虚拟单，不构成实单依据",
  };
  try {
    const saved = addDecision(dec);
    log(`VIRTUAL_OK ${saved.decisionId} ${r.home} vs ${r.away} ${r.side}${r.line}@${r.odds} ev=${(ev * 100).toFixed(2)}%`);
  } catch (e) {
    log(`VIRTUAL_SKIP ${String(e.message).split("\n")[0].slice(0, 160)}`);
  }
})();
