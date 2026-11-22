/**
 * ky_auto_bet.cjs — 自动扫盘 + 用盘口算 EV + 按风控下单（纯接口）
 *
 * 每次运行：
 *  1) 调 ky_ev_scan.cjs 扫未来 6 小时真实足球，取 EV>=3% 的候选
 *  2) 过滤：开赛>15分钟、赔率1.5~3.0、账本里没有同场在途单
 *  3) 风控：单注下限/上限、余额、未结敞口、当日、累计亏损（全部 fail-closed）
 *  4) 最多下一单；走 ky_bet_live.cjs（内含 ALLOW_LIVE_BET 校验）
 *  5) 成功则写入 ledger_user_orders.json，日志写 runtime/auto_bet.log
 *
 * 用法: node tools/ky_auto_bet.cjs [--dry]
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");
const https = require("node:https");

const ROOT = path.resolve(__dirname, "..");
const EXP = path.join(ROOT, "data", "experiment_survival_100");
const LEDGER = path.join(EXP, "ledger_user_orders.json");
const RISK = path.join(EXP, "risk_config.json");
const LOG = path.join(EXP, "runtime", "auto_bet.log");
const AMOUNT = 10;
const MAX_OPEN_SELF = 20; // 自设上限，低于 risk_config 的 30
const DRY = process.argv.includes("--dry");

function log(msg) {
  fs.mkdirSync(path.dirname(LOG), { recursive: true });
  const ts = new Date(Date.now() + 8 * 3600e3).toISOString().replace("T", " ").slice(0, 19);
  fs.appendFileSync(LOG, `${ts} ${msg}\n`, "utf8");
  console.log(msg);
}
function readJson(p, dflt) { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return dflt; } }
function balance() {
  const c = readJson(path.join(EXP, "runtime", "api_credentials.json"), null);
  if (!c || !c.templates || !c.templates.getMatchBaseInfoByOddsPB) return Promise.resolve(null);
  const t = c.templates.getMatchBaseInfoByOddsPB;
  const u = new URL(t.url).origin + "/yewu12/user/amount?t=" + Date.now();
  return new Promise((res) => {
    https.get(u, { headers: t.headers, rejectUnauthorized: false }, (r) => {
      let d = ""; r.on("data", (x) => d += x); r.on("end", () => { try { res(Number(JSON.parse(d).data.amount)); } catch { res(null); } });
    }).on("error", () => res(null));
  });
}
function scan() {
  const out = cp.execFileSync(process.execPath, [path.join(__dirname, "ky_ev_scan.cjs"), "6", "0.03"], { timeout: 280000, encoding: "utf8" });
  const rows = [];
  for (const line of out.split(/\r?\n/)) {
    const s = line.trim();
    if (!s.startsWith("{")) continue;
    try { rows.push(JSON.parse(s)); } catch {}
  }
  return rows;
}

/** 自动结算：拉订单列表，把在途单的 betResult 写回账本，释放敞口 */
function reconcile(ledger) {
  const c = readJson(path.join(EXP, "runtime", "api_credentials.json"), null);
  if (!c || !c.templates || !c.templates.getMatchBaseInfoByOddsPB) return ledger;
  const t = c.templates.getMatchBaseInfoByOddsPB;
  const origin = new URL(t.url).origin;
  const body = { orderTypeFilter: 0, orderBy: 0, timeType: 0, orderStatus: 0, selected: 0, enablePreSettle: 0, userId: "534989530547739322", page: 1, size: 50 };
  const zlib = require("node:zlib");
  let records = [];
  try {
    const raw = cp.execFileSync(process.execPath, ["-e", `
      const https=require('https'),zlib=require('zlib');
      const body=${JSON.stringify(body)};
      const d=JSON.stringify(body);
      const r=https.request(${JSON.stringify(origin + "/yewurecord/order/betRecord/getOrderListPB?t=" + Date.now())},{method:'POST',rejectUnauthorized:false,headers:${JSON.stringify({ ...t.headers, "content-type": "application/json" })},},rr=>{let s='';rr.on('data',x=>s+=x);rr.on('end',()=>{const j=JSON.parse(s);let x=j.data;if(typeof x==='string'&&x.startsWith('H4sI'))x=JSON.parse(zlib.gunzipSync(Buffer.from(x,'base64')).toString('utf8'));process.stdout.write(JSON.stringify((x&&x.records)||[]));});});r.on('error',e=>process.stdout.write('[]'));r.setHeader('Content-Length',Buffer.byteLength(d));r.write(d);r.end();
    `], { timeout: 30000, encoding: "utf8" });
    records = JSON.parse(raw);
  } catch { return ledger; }
  if (!Array.isArray(records) || !records.length) return ledger;
  let changed = false;
  for (const e of ledger) {
    if (e.status !== "open") continue;
    const rec = records.find((r) => String(r.orderNo) === String(e.orderNo || e.betNo) || (r.detailList || []).some((d) => String(d.betNo) === String(e.betNo)));
    if (!rec) continue;
    const d = (rec.detailList || [])[0] || {};
    const br = Number(d.betResult);
    if (br === 0 || String(rec.orderStatus) === "0") continue;
    e.status = "settled"; e.result = br; e.settledAt = new Date().toISOString();
    const amt = Number(e.amount), odds = Number(e.odds);
    if (br === 4) e.pnl = +(amt * (odds - 1)).toFixed(2);
    else if (br === 3) e.pnl = -amt;
    else if (br === 5) e.pnl = +(amt * (odds - 1) / 2).toFixed(2);
    else if (br === 6) e.pnl = -amt / 2;
    else e.pnl = null;
    changed = true;
  }
  if (changed) fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 2), "utf8");
  return ledger;
}

(async () => {
  const risk = readJson(RISK, null);
  if (!risk) { log("DENY risk_config missing"); process.exit(1); }
  const bal = await balance();
  if (!Number.isFinite(bal)) { log("DENY balance unreadable"); process.exit(1); }
  let ledger = Array.isArray(readJson(LEDGER, [])) ? readJson(LEDGER, []) : [];
  ledger = reconcile(ledger);
  const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const open = ledger.filter((x) => x.status === "open");
  const openRisk = open.reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const dailyStake = ledger.filter((x) => String(x.at || "").slice(0, 10) === today).reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const realizedPnl = ledger.reduce((s, x) => s + (Number(x.pnl) || 0), 0);
  const realizedLoss = Math.max(0, -realizedPnl);

  if (openRisk + AMOUNT > MAX_OPEN_SELF) { log(`SKIP openRisk=${openRisk} >= self ${MAX_OPEN_SELF}`); process.exit(0); }
  if (bal < AMOUNT) { log(`SKIP balance=${bal}`); process.exit(0); }
  if (dailyStake + AMOUNT > Number(risk.dailyMaxRisk)) { log(`SKIP daily=${dailyStake}`); process.exit(0); }
  if (realizedLoss + openRisk + AMOUNT > Number(risk.experimentMaxLoss)) { log(`SKIP cumulative`); process.exit(0); }

  let rows;
  try { rows = scan(); } catch (e) { log("SCAN_FAIL " + String(e.message).slice(0, 120)); process.exit(1); }
  const seen = new Set(open.map((x) => String(x.mid || "")));
  const cands = rows.filter((r) => {
    if (!(r.ev >= 3)) return false;
    if (!(r.odds >= 1.5 && r.odds <= 3.0)) return false;
    if (!Number.isFinite(r.line)) return false;
    if (seen.has(String(r.mid))) return false;
    const k = Date.parse(String(r.kickoff).replace(" ", "T") + ":00+08:00");
    return Number.isFinite(k) && k > Date.now() + 15 * 60000;
  });
  if (!cands.length) { log("NO_SIGNAL"); process.exit(0); }
  cands.sort((a, b) => b.ev - a.ev);
  const pick = cands[0];
  log(`PICK mid=${pick.mid} ${pick.home} vs ${pick.away} ${pick.side}${pick.line}@${pick.odds} ev=${pick.ev}%`);

  if (DRY) { log("DRY no bet"); process.exit(0); }

  const ot = pick.side === "主" ? "1" : "2";
  const args = [path.join(__dirname, "ky_bet_live.cjs"), String(pick.mid), "4", ot, String(AMOUNT), String(pick.odds), String(pick.line)];
  let out;
  try {
    out = cp.execFileSync(process.execPath, args, {
      timeout: 120000, encoding: "utf8",
      env: { ...process.env, ALLOW_LIVE_BET: "YES_I_CONFIRM" },
    });
  } catch (e) {
    log("BET_FAIL " + String(e.stdout || e.message).slice(0, 240));
    process.exit(1);
  }
  let res = null;
  try { res = JSON.parse(out); } catch {}
  if (!res || !res.submitted) { log("BET_NOT_SUBMITTED " + String(out).slice(0, 200)); process.exit(1); }
  const d = (res.receipt && res.receipt.orderDetailRespList && res.receipt.orderDetailRespList[0]) || {};
  const entry = {
    betNo: d.orderNo || null,
    at: new Date().toISOString(),
    mid: String(pick.mid), event: pick.home + " vs " + pick.away, league: pick.league,
    market: "全场让球", side: d.playOptionName || `${pick.side}${pick.line}`,
    line: Number(pick.line), odds: Number(d.oddsValues || pick.odds),
    amount: AMOUNT, maxWin: (Number(d.maxWinMoney || 0) / 100) || (AMOUNT * pick.odds - AMOUNT),
    status: "open", pnl: null, result: null,
    basis: { model: "poisson-fit-to-1x2", evPct: pick.ev, note: "模型估计EV，未验证模型；用户授权随时下注" },
  };
  ledger.push(entry);
  fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 2), "utf8");
  log(`BET_OK betNo=${entry.betNo} ${entry.event} ${entry.side}@${entry.odds} amount=${AMOUNT}`);
})().catch((e) => { log("FATAL " + String(e.message).slice(0, 160)); process.exit(1); });
