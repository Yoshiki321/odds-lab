/** ky_order_lookup.cjs — 按关键字查订单（含已结算），核对某单结果。 */
"use strict";
const zlib = require("node:zlib");
const auth = require("./ky_api_auth.cjs");
const unwrap = (t) => { const j = JSON.parse(t); return typeof j.data === "string" && j.data.startsWith("H4sI") ? JSON.parse(zlib.gunzipSync(Buffer.from(j.data, "base64")).toString("utf8")) : j; };

(async () => {
  const kw = process.argv[2] || "RBI";
  const c = auth.load();
  const base = c.templates.getOriginalDataPB;
  const origin = new URL(base.url).origin;
  const uid = "534989530547739322";
  const url = origin + "/yewurecord/order/betRecord/getOrderListPB?t=" + Date.now();
  const seen = new Set();
  for (const status of [1, 2, 3]) {
    for (const timeType of [1, 2]) {
      const body = { orderTypeFilter: 0, orderBy: 0, timeType, orderStatus: status, selected: 0, enablePreSettle: 1, userId: uid, page: 1, size: 50 };
      try {
        const o = unwrap(await (await fetch(url, { method: "POST", headers: { ...base.headers, "content-type": "application/json" }, body: JSON.stringify(body) })).text());
        for (const r of o.records || []) {
          const d = (r.detailList || [])[0] || {};
          const key = (d.betNo || r.orderNo) + "";
          if (seen.has(key)) continue;
          seen.add(key);
          const text = JSON.stringify(r);
          if (!new RegExp(kw).test(text)) continue;
          console.log(JSON.stringify({
            timeType, orderStatus: status,
            orderNo: d.betNo || r.orderNo, match: d.matchInfo,
            bet: d.betAmount, result: d.betResult, back: d.backAmount ?? r.backAmount ?? 0,
            odds: d.oddsValues, play: d.playName, option: d.playOptionName,
          }, null, 1));
        }
      } catch {}
    }
  }
  console.log("scanned=" + seen.size);
  process.exit(0);
})();
