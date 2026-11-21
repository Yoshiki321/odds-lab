/**
 * ky_api_bet.cjs — 【真实下单，一次性】用 API 下单场单关，提交后不重试。
 * 用法: ALLOW_LIVE_BET=YES_I_CONFIRM node tools/ky_api_bet.cjs <mid> <1|X|2> [amount]
 * 所有风险门禁在提交前执行（Fail-Closed）；任一不过直接拒绝。
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const auth = require("./ky_api_auth.cjs");

const ROOT = path.resolve(__dirname, "..");
const EXP = path.join(ROOT, "data", "experiment_survival_100");
const BJ = 8 * 3600_000;
const bjDate = (ms = Date.now()) => new Date(ms + BJ).toISOString().slice(0, 10);

const unwrap = (txt) => {
  const j = JSON.parse(txt);
  if (typeof j.data === "string" && j.data.startsWith("H4sI"))
    return JSON.parse(zlib.gunzipSync(Buffer.from(j.data, "base64")).toString("utf8"));
  return j;
};

const deny = (reason, extra) => {
  console.log(JSON.stringify({ ok: false, reason, ...(extra || {}) }));
  process.exit(1);
};

(async () => {
  if (process.env.ALLOW_LIVE_BET !== "YES_I_CONFIRM") {
    deny("真实下单已锁定：需显式设置环境变量 ALLOW_LIVE_BET=YES_I_CONFIRM");
  }
  const [mid, side] = process.argv.slice(2);
  const amount = Number(process.argv[4] || 2);
  if (!mid || !["1", "X", "2"].includes(side)) { console.log(JSON.stringify({ ok: false, reason: "参数: mid 1|X|2" })); process.exit(2); }
  if (!Number.isFinite(amount) || amount <= 0) deny("金额无效");

  const saved = auth.load();
  if (!saved) deny("无凭据");
  const t = saved.templates.getMatchBaseInfoByOddsPB;
  if (!t) deny("无赔率接口模板");

  // 1) 拉该场实时盘口
  const body0 = JSON.parse(t.post || "{}");
  body0.mid = mid;
  const r0 = await fetch(t.url, { method: t.method, headers: t.headers, body: JSON.stringify(body0), signal: AbortSignal.timeout(10000) });
  if (!r0.ok) deny("赔率接口 HTTP " + r0.status);
  const m = (unwrap(await r0.text()).data || [])[0];
  if (!m) deny("场次不存在");

  const kickoff = Number(m.mgt);
  const now = Date.now();
  if (!(kickoff > now)) deny("已开赛，拒绝");

  const arr = (m.playData && m.playData.length ? m.playData : m.hpsData) || [];
  const grp = arr.flatMap((x) => x.hps || []).find((x) => String(x.hpid) === "1");
  if (!grp) deny("无全场独赢盘口");
  const opt = (grp.hl.ol || []).find((o) => o.ot === side);
  if (!opt) deny("方向赔率缺失");

  // 2) 风险门禁（统一读 risk_config.json，Fail-Closed，修正亏损正负号）
  let caps;
  try { caps = JSON.parse(fs.readFileSync(path.join(EXP, "risk_config.json"), "utf8")); }
  catch (e) { deny("风控配置文件读取失败", { error: e.message }); }

  const singleMin = Number(caps.singleMin ?? 1);
  if (amount < singleMin) deny("低于单注下限", { amount, min: singleMin });

  const ct = saved.templates.countUnsettleTickets;
  if (!ct) deny("无未结数接口模板");
  const rr = await fetch(ct.url, { headers: ct.headers, signal: AbortSignal.timeout(10000) });
  const uncJson = unwrap(await rr.text());
  if (uncJson.code !== "0000000" || typeof uncJson.data !== "number") deny("未结数读取失败");
  const unc = uncJson.data;

  let ledger;
  try { ledger = JSON.parse(fs.readFileSync(path.join(EXP, "ledger.json"), "utf8")); }
  catch (e) { deny("真实账本缺失或损坏（Fail-Closed）", { error: e.message }); }

  const entries = Array.isArray(ledger) ? ledger : (Array.isArray(ledger.entries) ? ledger.entries : []);
  const today = bjDate();
  const dailyUsed = entries
    .filter((x) => {
      const ts = x.at || x.placedAt || x.date || "";
      const d = typeof ts === "string" && ts.length >= 10 ? (ts.includes("T") ? bjDate(Date.parse(ts)) : ts.slice(0, 10)) : "";
      return d === today;
    })
    .reduce((s, x) => s + (Number(x.amount ?? x.stake) || 0), 0);
  const openRisk = Number(ledger.openRisk ?? entries.filter((x) => x.status === "open").reduce((s, x) => s + (Number(x.amount ?? x.stake) || 0), 0));
  const realizedPnl = Number(ledger.cumulativeRealizedPnl ?? entries.reduce((s, x) => s + (Number(x.pnl) || 0), 0));
  const realizedLoss = Math.max(0, -realizedPnl);

  const gate = {
    singleMin: amount >= singleMin,
    single: amount <= caps.singleMax,
    open: openRisk + amount <= caps.maxConcurrentOpenRisk,
    daily: dailyUsed + amount <= caps.dailyMaxRisk,
    cumulative: realizedLoss + openRisk + amount <= caps.experimentMaxLoss,
    unsettledCount: unc,
  };
  if (!gate.single || !gate.open || !gate.daily || !gate.cumulative) {
    deny("风险门禁未过", { gate });
  }

  // 3) 构造订单（acceptOdds=1 拒绝自动接受更差赔率）
  const oid = String(opt.oid);
  const hid = String(grp.hl.hid);
  const bet = {
    acceptOdds: 1, tenantId: 1, deviceType: 2, currencyCode: "CNY",
    deviceImei: "", fpId: "", openMiltSingle: 0, preBet: 0, developers: "ty", timeZone: 20,
    seriesOrders: [{
      seriesSum: 1, seriesType: 1, seriesValues: "单关", fullBet: 0,
      orderDetailList: [{
        marketId: hid, marketTypeFinally: "EU", matchId: String(m.mid), matchName: m.tnjc,
        matchType: 1, oddFinally: String(Number(opt.ov) / 100000), odds: Number(opt.ov),
        playId: "1", playName: "全场独赢", playOptionName: String(opt.on || opt.onb),
        playOptions: side, playOptionsId: oid, sportId: "1", tournamentId: String(m.tid),
        excellentOddsBet: 0, ol_bet_only_id: oid, front_bet_id: oid,
        marketValue: "", scoreBenchmark: "", betAmount: amount,
        sportName: "足球", tournamentLevel: Number(m.tlev || 1), dataSource: String(opt.cds || "A01"),
      }],
    }],
    bet_mode_type: "is_single", front_bet_ids: [oid], ol_bet_only_ids: [oid],
  };

  // 4) 提交一次（不重试）
  const bt = saved.templates["betOrder/betPB"] || {
    url: new URL(t.url).origin + "/yewu13/v1/betOrder/betPB?t=" + Date.now(),
    method: "POST", headers: { ...t.headers, "content-type": "application/json" },
  };
  const headers = { ...bt.headers, "content-type": "application/json" };
  const resp = await fetch(bt.url, { method: "POST", headers, body: JSON.stringify(bet), signal: AbortSignal.timeout(15000) });
  const txt = await resp.text();
  let parsed = null;
  try { parsed = unwrap(txt); } catch { parsed = { raw: txt.slice(0, 300) }; }

  // 5) 平台对账（未结数 + 回执）
  const rr2 = await fetch(ct.url, { headers: ct.headers, signal: AbortSignal.timeout(10000) });
  const unc2 = unwrap(await rr2.text()).data;

  console.log(JSON.stringify({
    submitted: true, status: resp.status,
    intent: { mid, league: m.tnjc, home: m.mhn, away: m.man, kickoff: new Date(kickoff).toISOString(), side, odds: Number(opt.ov) / 100000, amount },
    receipt: parsed,
    unsettledBefore: unc, unsettledAfter: unc2,
    note: "只提交一次；以平台回执为准，结果不明先查单不重发",
  }, null, 1));
  process.exit(0);
})().catch((e) => { console.error("ERR " + e.message); process.exit(1); });
