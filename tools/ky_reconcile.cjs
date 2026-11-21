/** ky_reconcile.cjs — 一次性对账：按订单号列出已结算/未结算订单，并读余额。 */
"use strict";
const zlib = require("node:zlib");
const auth = require("./ky_api_auth.cjs");
const unwrap = (t) => { const j = JSON.parse(t); return typeof j.data === "string" && j.data.startsWith("H4sI") ? JSON.parse(zlib.gunzipSync(Buffer.from(j.data, "base64")).toString("utf8")) : j; };
const CODE = { 0: "未结", 3: "输", 4: "赢", 5: "赢半", 6: "输半(推测)" };

(async () => {
  const c = auth.load();
  const base = c.templates.getOriginalDataPB;
  const origin = new URL(base.url).origin;
  const uid = "534989530547739322";
  const seen = new Map();
  for (const status of [1, 2, 3]) {
    for (let page = 1; page <= 10; page++) {
      const url = origin + "/yewurecord/order/betRecord/getOrderListPB?t=" + Date.now();
      const body = { orderTypeFilter: 0, orderBy: 0, timeType: 1, orderStatus: status, selected: 0, enablePreSettle: 1, userId: uid, page, size: 50 };
      const o = unwrap(await (await fetch(url, { method: "POST", headers: { ...base.headers, "content-type": "application/json" }, body: JSON.stringify(body) })).text());
      for (const r of o.records || []) {
        const d = (r.detailList || [])[0] || {};
        const no = String(d.betNo || r.orderNo);
        if (!seen.has(no)) seen.set(no, { orderNo: no, match: d.matchInfo, option: d.playOptionName, odds: d.oddsValues, bet: Number(d.betAmount) / 100, betResult: d.betResult, result: CODE[d.betResult] || "未知", back: d.backAmount ?? r.backAmount ?? 0 });
      }
      if (!o.hasNext) break;
    }
  }
  const rows = [...seen.values()];
  const pnl = rows.filter((x) => x.betResult && x.betResult !== 0).reduce((s, x) => s + (Number(x.back) - x.bet), 0);
  const b = await (await fetch(origin + "/yewu12/user/amount?t=" + Date.now(), { headers: base.headers })).json();
  console.log(JSON.stringify({ count: rows.length, settledPnl: +pnl.toFixed(2), balance: b.data && b.data.amount, rows }, null, 1));
  process.exitCode = 0;
})().catch((e) => { console.error("ERR " + e.message); process.exitCode = 1; });
