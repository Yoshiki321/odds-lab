/** ky_unsettled.cjs — 列出当前未结算订单。 */
"use strict";
const zlib = require("node:zlib");
const auth = require("./ky_api_auth.cjs");
const unwrap = (t) => { const j = JSON.parse(t); return typeof j.data === "string" && j.data.startsWith("H4sI") ? JSON.parse(zlib.gunzipSync(Buffer.from(j.data, "base64")).toString("utf8")) : j; };
(async () => {
  const c = auth.load();
  const base = c.templates.getOriginalDataPB;
  const origin = new URL(base.url).origin;
  const uid = "534989530547739322";
  const url = origin + "/yewurecord/order/betRecord/getOrderListPB?t=" + Date.now();
  for (const status of [1, 3]) {
    const body = { orderTypeFilter: 0, orderBy: 0, timeType: 1, orderStatus: status, selected: 0, enablePreSettle: 1, userId: uid, page: 1, size: 50 };
    const o = unwrap(await (await fetch(url, { method: "POST", headers: { ...base.headers, "content-type": "application/json" }, body: JSON.stringify(body) })).text());
    console.log("status=" + status + " records=" + (o.records || []).length);
    for (const r of o.records || []) {
      const d = (r.detailList || [])[0] || {};
      console.log("  " + JSON.stringify({ orderNo: d.betNo || r.orderNo, match: d.matchInfo, bet: d.betAmount, result: d.betResult, odds: d.oddsValues, play: d.playName }));
    }
  }
  process.exit(0);
})();
