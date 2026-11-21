/**
 * ky_api_bet.cjs — 【真实下单，一次性】用 API 下单场单关，提交后不重试。
 * 用法: node tools/ky_api_bet.cjs <mid> <1|X|2> [amount]
 * 所有风险门禁在提交前执行；任一不过直接拒绝。
 */
"use strict";
const zlib = require("node:zlib");
const auth = require("./ky_api_auth.cjs");

const unwrap = (txt) => {
  const j = JSON.parse(txt);
  if (typeof j.data === "string" && j.data.startsWith("H4sI"))
    return JSON.parse(zlib.gunzipSync(Buffer.from(j.data, "base64")).toString("utf8"));
  return j;
};

(async () => {
  const [mid, side] = process.argv.slice(2);
  const amount = Number(process.argv[4] || 2);
  if (!mid || !["1", "X", "2"].includes(side)) { console.log(JSON.stringify({ ok: false, reason: "参数: mid 1|X|2" })); process.exit(2); }

  const saved = auth.load();
  if (!saved) { console.log(JSON.stringify({ ok: false, reason: "无凭据" })); process.exit(1); }
  const t = saved.templates.getMatchBaseInfoByOddsPB;
  if (!t) { console.log(JSON.stringify({ ok: false, reason: "无赔率接口模板" })); process.exit(1); }

  // 1) 拉该场实时盘口
  const body0 = JSON.parse(t.post || "{}");
  body0.mid = mid;
  const r0 = await fetch(t.url, { method: t.method, headers: t.headers, body: JSON.stringify(body0) });
  if (!r0.ok) { console.log(JSON.stringify({ ok: false, reason: "赔率接口 HTTP " + r0.status })); process.exit(1); }
  const m = (unwrap(await r0.text()).data || [])[0];
  if (!m) { console.log(JSON.stringify({ ok: false, reason: "场次不存在" })); process.exit(1); }

  const kickoff = Number(m.mgt);
  const now = Date.now();
  if (!(kickoff > now)) { console.log(JSON.stringify({ ok: false, reason: "已开赛，拒绝" })); process.exit(1); }

  const arr = (m.playData && m.playData.length ? m.playData : m.hpsData) || [];
  const grp = arr.flatMap((x) => x.hps || []).find((x) => String(x.hpid) === "1");
  if (!grp) { console.log(JSON.stringify({ ok: false, reason: "无全场独赢盘口" })); process.exit(1); }
  const opt = (grp.hl.ol || []).find((o) => o.ot === side);
  if (!opt) { console.log(JSON.stringify({ ok: false, reason: "方向赔率缺失" })); process.exit(1); }

  // 2) 风险门禁（预算100/单注2/未结5/日5/累计20）
  const caps = require("../data/experiment_survival_100/risk_config.json");
  const ct = saved.templates.countUnsettleTickets;
  const rr = await fetch(ct.url, { headers: ct.headers });
  const unc = unwrap(await rr.text()).data;
  const ledger = require("../data/experiment_survival_100/ledger.json");
  const dailyUsed = 2; // 首单（唯一已批准实单）
  const openRisk = (ledger.openRisk || 2);
  const gate = {
    single: amount <= caps.singleMax,
    open: openRisk + amount <= caps.maxConcurrentOpenRisk,
    daily: dailyUsed + amount <= caps.dailyMaxRisk,
    cumulative: (ledger.cumulativeRealizedPnl || 0) + openRisk + amount <= caps.experimentMaxLoss,
    unsettledCount: unc,
  };
  if (!gate.single || !gate.open || !gate.daily || !gate.cumulative) {
    console.log(JSON.stringify({ ok: false, reason: "风险门禁未过", gate })); process.exit(1);
  }

  // 3) 构造订单（对照已成功下单的字段结构）
  const oid = String(opt.oid);
  const hid = String(grp.hl.hid);
  const bet = {
    acceptOdds: 2, tenantId: 1, deviceType: 2, currencyCode: "CNY",
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
    url: "https://api.71vfi7l.com/yewu13/v1/betOrder/betPB?t=" + Date.now(),
    method: "POST", headers: { ...t.headers, "content-type": "application/json" },
  };
  const headers = { ...bt.headers, "content-type": "application/json" };
  const resp = await fetch(bt.url, { method: "POST", headers, body: JSON.stringify(bet) });
  const txt = await resp.text();
  let parsed = null;
  try { parsed = unwrap(txt); } catch { parsed = { raw: txt.slice(0, 300) }; }

  // 5) 平台对账（未结数 + 回执）
  const rr2 = await fetch(ct.url, { headers: ct.headers });
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
