/** ky_orders.cjs — 查订单列表（已结算/未结算），用于对账。 */
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
  const bodies = [
    { orderTypeFilter: 0, orderBy: 0, timeType: 1, orderStatus: 2, selected: 0, enablePreSettle: 1, userId: uid, page: 1, size: 20 },
    { orderTypeFilter: 0, orderBy: 0, timeType: 1, orderStatus: 3, selected: 0, enablePreSettle: 1, userId: uid, page: 1, size: 20 },
    { orderTypeFilter: 0, orderBy: 0, timeType: 1, orderStatus: 1, selected: 0, enablePreSettle: 1, userId: uid, page: 1, size: 20 },
  ];
  for (const body of bodies) {
    try {
      const r = await fetch(url, { method: "POST", headers: { ...base.headers, "content-type": "application/json" }, body: JSON.stringify(body) });
      const txt = await r.text();
      let o; try { o = unwrap(txt); } catch { o = { raw: txt.slice(0, 120) }; }
      const flat = JSON.stringify(o);
      console.log("status=" + body.orderStatus + " code=" + (o.code || "?") + " msg=" + (o.msg || "") + " len=" + flat.length);
      const nos = [...flat.matchAll(/"orderNo":"(\d+)"/g)].map((m) => m[1]);
      const results = [...flat.matchAll(/"settleStatus":"?(\w+)"?/g)].map((m) => m[1]);
      if (nos.length) console.log("  orders=" + nos.join(","));
      if (nos.length) { console.log("  head=" + flat.slice(0, 500)); break; }
    } catch (e) { console.log("status=" + body.orderStatus + " ERR " + e.message); }
  }
  process.exit(0);
})();
