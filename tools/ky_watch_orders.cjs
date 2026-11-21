/** ky_watch_orders.cjs — 按订单号列表监视，查结果码 betResult 判断结算，不再用未结数。 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const auth = require("./ky_api_auth.cjs");

const unwrap = (t) => { const j = JSON.parse(t); return typeof j.data === "string" && j.data.startsWith("H4sI") ? JSON.parse(zlib.gunzipSync(Buffer.from(j.data, "base64")).toString("utf8")) : j; };
const bj = (d) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(d);
const CODE = { 0: "未结", 3: "输", 4: "赢", 5: "赢半", 6: "输半(推测)" };

(async () => {
  const orderNos = process.argv.slice(2);
  if (orderNos.length === 0) { console.log(JSON.stringify({ ok: false, reason: "缺少订单号参数" })); process.exit(1); }
  const LOG = path.join(__dirname, "..", "data", "experiment_survival_100", "runtime", "watch_orders.log");
  const log = (s) => { fs.appendFileSync(LOG, s + "\n", "utf8"); console.log(s); };
  const c = auth.load();
  const base = c.templates.getOriginalDataPB;
  const origin = new URL(base.url).origin;
  const uid = "534989530547739322";
  const started = Date.now();
  log(`[${bj(new Date())}] 开始监视订单 ${orderNos.join(",")}`);
  const pending = new Set(orderNos);
  for (;;) {
    try {
      for (const no of pending) {
        for (const status of [1, 2, 3]) {
          const url = origin + "/yewurecord/order/betRecord/getOrderListPB?t=" + Date.now();
          const body = { orderTypeFilter: 0, orderBy: 0, timeType: 1, orderStatus: status, selected: 0, enablePreSettle: 1, userId: uid, page: 1, size: 50 };
          const o = unwrap(await (await fetch(url, { method: "POST", headers: { ...base.headers, "content-type": "application/json" }, body: JSON.stringify(body) })).text());
          for (const r of o.records || []) {
            const d = (r.detailList || [])[0] || {};
            const orderNo = String(d.betNo || r.orderNo);
            if (orderNo === no && d.betResult !== 0) {
              const res = CODE[d.betResult] || "未知";
              const back = Number(d.backAmount ?? r.backAmount ?? 0);
              const bet = Number(d.betAmount) / 100;
              const pnl = +(back - bet).toFixed(2);
              log(`[${bj(new Date())}] ${no} 结果=${res}(${d.betResult}) 派彩=${back} 盈亏=${pnl} | ${d.matchInfo} ${d.playOptionName}`);
              pending.delete(no);
            }
          }
        }
      }
      if (pending.size === 0) { log(`[${bj(new Date())}] 所有订单已结算，退出`); break; }
    } catch (e) { log(`[${bj(new Date())}] 异常 ${e.message}`); }
    if (Date.now() - started > 3 * 3600 * 1000) { log(`[${bj(new Date())}] 满3小时停止`); break; }
    await new Promise((r) => setTimeout(r, 45000));
  }
  process.exit(0);
})();
