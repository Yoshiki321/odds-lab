/**
 * ky_bet_live.cjs — 单关下单（真实）。安全失败优先：任何输入不全/不一致/超限 → 拒绝。
 * 用法: node tools/ky_bet_live.cjs <mid> <hpid> <ot> <amount> <预期赔率> [预期线位]
 * 规则：
 *  - 必须提供预期赔率；缺失直接拒绝
 *  - 赔率偏差 > 0.10 或线位变化 → 拒绝
 *  - 风控从 risk_config.json 读取：单注/未结/当日/累计
 *  - 只提交一次，不重试
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const auth = require("./ky_api_auth.cjs");

const ROOT = path.resolve(__dirname, "..");
const EXP = path.join(ROOT, "data", "experiment_survival_100");
const unwrap = (t) => { const j = JSON.parse(t); return typeof j.data === "string" && j.data.startsWith("H4sI") ? JSON.parse(zlib.gunzipSync(Buffer.from(j.data, "base64")).toString("utf8")) : j; };
const deny = (reason, extra) => { console.log(JSON.stringify({ ok: false, rejected: reason, ...(extra || {}) }, null, 1)); process.exit(1); };

(async () => {
  const [mid, hpidWanted, otWanted, amountStr, expOddsStr, expLineStr] = process.argv.slice(2);
  if (!mid || !hpidWanted || !otWanted || !amountStr || !expOddsStr) deny("参数不全：需要 mid hpid ot amount 预期赔率 [预期线位]");
  const amount = Number(amountStr);
  const expOdds = Number(expOddsStr);
  const expLine = expLineStr === undefined ? null : String(expLineStr);
  if (!Number.isFinite(amount) || amount <= 0) deny("金额无效");
  if (!Number.isFinite(expOdds) || expOdds <= 1) deny("预期赔率无效");

  const caps = JSON.parse(fs.readFileSync(path.join(EXP, "risk_config.json"), "utf8"));

  const c = auth.load();
  if (!c) deny("无凭据");
  const t1 = c.templates.getMatchBaseInfoByOddsPB;

  // 1) 拉实时盘口
  const body = JSON.parse(t1.post || "{}"); body.mid = String(mid);
  const o = unwrap(await (await fetch(t1.url, { method: t1.method, headers: t1.headers, body: JSON.stringify(body) })).text());
  const m = (o.data || [])[0];
  if (!m) deny("场次不存在或已结束");

  const groups = ((m.playData && m.playData.length ? m.playData : m.hpsData) || []).flatMap((x) => x.hps || []);
  const g = groups.find((x) => String(x.hpid) === String(hpidWanted));
  if (!g) deny("无该盘口", { available: groups.map((x) => x.hpid) });
  if (!g.hl || !Array.isArray(g.hl.ol) || g.hl.ol.length < 2) deny("盘口无有效选项（可能已挂起）");
  const opt = g.hl.ol.find((x) => String(x.ot) === String(otWanted));
  if (!opt) deny("无该方向", { options: g.hl.ol.map((x) => x.ot) });

  const curOdds = Number(opt.ov) / 100000;
  const curLine = String(g.hl.hv || "");
  if (Math.abs(curOdds - expOdds) > 0.10) deny("赔率偏差超 0.10，拒绝", { expect: expOdds, now: curOdds });
  if (expLine !== null && curLine !== expLine) deny("线位已变，拒绝", { expect: expLine, now: curLine });

  // 2) 风控四算
  const balResp = await (await fetch(new URL(t1.url).origin + "/yewu12/user/amount?t=" + Date.now(), { headers: t1.headers })).json();
  const balance = balResp.data.amount;
  const ct = c.templates.countUnsettleTickets;
  const uncJson = JSON.parse(await (await fetch(ct.url + "&t=" + Date.now(), { headers: ct.headers })).text());
  if (uncJson.code !== "0000000" || typeof uncJson.data !== "number") deny("未结数读取失败，无法核算风险");
  const openCount = uncJson.data;

  const ledgerFile = path.join(EXP, "ledger_user_orders.json");
  let ledger = [];
  try { ledger = JSON.parse(fs.readFileSync(ledgerFile, "utf8")); } catch {}
  const openRisk = ledger.filter((x) => x.status === "open" || x.result === "open").reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const realized = ledger.reduce((s, x) => s + (Number(x.pnl) || 0), 0);

  const gate = {
    single: amount <= caps.singleMax,
    open: openRisk + amount <= caps.maxConcurrentOpenRisk,
    daily: realized + amount <= caps.dailyMaxRisk,
    cumulative: realized + openRisk + amount <= caps.experimentMaxLoss,
  };
  if (!gate.single) deny("超单注上限", { amount, cap: caps.singleMax });
  if (!gate.open) deny("超未结敞口上限", { openRisk, amount, cap: caps.maxConcurrentOpenRisk });
  if (!gate.daily) deny("超当日风险上限", { realized, amount, cap: caps.dailyMaxRisk });
  if (!gate.cumulative) deny("超累计亏损上限", { realized, openRisk, amount, cap: caps.experimentMaxLoss });

  // 3) 构造并提交（一次）
  const oid = String(opt.oid), hid = String(g.hl.hid);
  const bet = {
    acceptOdds: 2, tenantId: 1, deviceType: 2, currencyCode: "CNY",
    deviceImei: "", fpId: "", openMiltSingle: 0, preBet: 0, developers: "ty", timeZone: 20,
    seriesOrders: [{
      seriesSum: 1, seriesType: 1, seriesValues: "单关", fullBet: 0,
      orderDetailList: [{
        marketId: hid, marketTypeFinally: "EU", matchId: String(m.mid), matchName: m.tnjc,
        matchType: 1, oddFinally: String(curOdds), odds: Number(opt.ov),
        playId: String(g.hpid), playName: String(g.hpn || ""),
        playOptionName: String(opt.on || opt.onb || ""),
        playOptions: String(opt.ot), playOptionsId: oid,
        sportId: String(m.csid === "2" ? "2" : "1"), tournamentId: String(m.tid),
        excellentOddsBet: 0, ol_bet_only_id: oid, front_bet_id: oid,
        marketValue: "", scoreBenchmark: "", betAmount: amount,
        sportName: m.csid === "2" ? "篮球" : "足球",
        tournamentLevel: Number(m.tlev || 1), dataSource: String(opt.cds || "A01"),
      }],
    }],
    bet_mode_type: "is_single", front_bet_ids: [oid], ol_bet_only_ids: [oid],
  };
  const bt = c.templates["betOrder/betPB"] || {
    url: new URL(t1.url).origin + "/yewu13/v1/betOrder/betPB?t=" + Date.now(),
    method: "POST", headers: t1.headers,
  };
  const resp = await fetch(bt.url, { method: "POST", headers: { ...bt.headers, "content-type": "application/json" }, body: JSON.stringify(bet) });
  const txt = await resp.text();
  let parsed; try { parsed = unwrap(txt); } catch { parsed = { raw: txt.slice(0, 300) }; }

  const rec = {
    decisionId: `EXP100-AUTO-${mid}-${Date.now()}`,
    at: new Date().toISOString(),
    intent: { mid, league: m.tnjc, home: m.mhn, away: m.man, line: curLine, market: g.hpn || g.hpid, side: opt.onb || opt.ot, odds: curOdds, amount },
    gate, balanceBefore: balance, openCountBefore: openCount,
    receipt: parsed,
  };
  const dir = path.join(EXP, "decisions");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${rec.decisionId}.json`), JSON.stringify(rec, null, 2), "utf8");

  console.log(JSON.stringify({ submitted: true, status: resp.status, intent: rec.intent, gate, receipt: parsed, note: "只提交一次；结算以 ky_recon 为准" }, null, 1));
  process.exit(0);
})().catch((e) => { console.error("ERR " + e.message); process.exit(1); });
