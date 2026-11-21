/**
 * ky_recon.cjs — 统一对账（三源交叉：订单列表 / 未结数 / 余额）
 * 用法: node tools/ky_recon.cjs [--json]
 * 规则（2026-11-19 审计后）：
 *  - 订单以列表里的 betNo 为准（回执 16 位与列表 15 位不一致，不可混用）
 *  - 派彩在 detailList 层（backAmount），不在 record 层
 *  - 退单只认余额：余额回到下单前 = 退单；余额已扣但列表查不到 = 在途（接口漏单）
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const auth = require("./ky_api_auth.cjs");

const ROOT = path.resolve(__dirname, "..");
const EXP = path.join(ROOT, "data", "experiment_survival_100");
const unwrap = (t) => { const j = JSON.parse(t); return typeof j.data === "string" && j.data.startsWith("H4sI") ? JSON.parse(zlib.gunzipSync(Buffer.from(j.data, "base64")).toString("utf8")) : j; };

async function balance() {
  const c = auth.load();
  const base = c.templates.getOriginalDataPB;
  const origin = new URL(base.url).origin;
  const r = await fetch(origin + "/yewu12/user/amount?t=" + Date.now(), { headers: base.headers });
  return (await r.json()).data.amount;
}
async function unsettledCount() {
  const c = auth.load();
  const ct = c.templates.countUnsettleTickets;
  const j = JSON.parse(await (await fetch(ct.url + "&t=" + Date.now(), { headers: ct.headers })).text());
  return j.code === "0000000" ? j.data : null;
}
async function orders() {
  const c = auth.load();
  const base = c.templates.getOriginalDataPB;
  const origin = new URL(base.url).origin;
  const uid = "534989530547739322";
  const url = origin + "/yewurecord/order/betRecord/getOrderListPB?t=" + Date.now();
  const map = new Map();
  for (const orderStatus of [1, 2, 3]) {
    for (const timeType of [1, 2, 3, 4]) {
      for (let page = 1; page <= 3; page++) {
        const body = { orderTypeFilter: 0, orderBy: 0, timeType, orderStatus, selected: 0, enablePreSettle: 1, userId: uid, page, size: 50 };
        let o;
        try {
          o = unwrap(await (await fetch(url, { method: "POST", headers: { ...base.headers, "content-type": "application/json" }, body: JSON.stringify(body) })).text());
        } catch { continue; }
        const recs = o.records || [];
        if (!recs.length) break;
        for (const r of recs) {
          const d = (r.detailList || [])[0] || {};
          const no = String(d.betNo || r.orderNo || "");
          if (!no) continue;
          map.set(no, {
            betNo: no,
            match: d.matchInfo || "",
            bet: Number(d.betAmount || 0) / 100,
            odds: d.oddsValues ? Number(d.oddsValues) : null,
            line: d.marketValues || "",
            play: d.playName || "",
            option: d.playOptionName || "",
            result: d.betResult,
            back: Number(d.backAmount || 0),
            status: d.betStatus,
            orderStatus, timeType,
          });
        }
        if (!o.hasNext) break;
      }
    }
  }
  return [...map.values()];
}

function classify(rows) {
  const win = rows.filter((r) => r.result === 4);
  const halfWin = rows.filter((r) => r.result === 5);
  const lose = rows.filter((r) => r.result === 3);
  const pending = rows.filter((r) => r.result === 0 || r.result === null || r.result === undefined);
  const other = rows.filter((r) => ![0, 3, 4, 5, null, undefined].includes(r.result));
  const pnl = rows.reduce((s, r) => s + (r.back > 0 ? r.back - r.bet : r.result === 3 ? -r.bet : 0), 0);
  return { win, halfWin, lose, pending, other, pnl };
}

(async () => {
  const bal = await balance();
  const unc = await unsettledCount();
  const rows = await orders();
  const cls = classify(rows);
  const ledgerFile = path.join(EXP, "ledger_user_orders.json");
  let ledger = [];
  try { ledger = JSON.parse(fs.readFileSync(ledgerFile, "utf8")); } catch { ledger = []; }

  const out = {
    checkedAt: new Date().toISOString(),
    balance: bal,
    unsettledCount: unc,
    ordersFromApi: rows.length,
    settled: { win: cls.win.length, halfWin: cls.halfWin.length, lose: cls.lose.length, pending: cls.pending.length, other: cls.other.length },
    netPnlFromOrders: +cls.pnl.toFixed(2),
    ledgerRecords: ledger.length,
    rows,
  };

  // 账本迁移：以 betNo 为主键，写入余额快照
  const migrated = rows.map((r) => ({ ...r, balanceSnapshot: bal, capturedAt: new Date().toISOString() }));
  fs.writeFileSync(path.join(EXP, "ledger_by_orderno.json"), JSON.stringify({ migratedAt: new Date().toISOString(), balance: bal, records: migrated }, null, 2), "utf8");

  if (process.argv.includes("--json")) {
    const p = path.join(EXP, "runtime", "recon.json");
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(out, null, 2), "utf8");
    console.log("written " + p);
  } else {
    console.log("余额=" + bal + " 未结数=" + unc + " 订单条数=" + rows.length);
    console.log("已结：赢" + cls.win.length + " 赢半" + cls.halfWin.length + " 输" + cls.lose.length + " 待结" + cls.pending.length + " 其他" + cls.other.length);
    console.log("订单净额=" + cls.pnl.toFixed(2));
    console.log("\n明细：");
    for (const r of rows) {
      const tag = r.result === 4 ? "赢" : r.result === 5 ? "赢半" : r.result === 3 ? "输" : "待结";
      console.log(`  ${r.betNo} | ${tag} | ${r.match} | ${r.play} ${r.option} | 注${r.bet} | 派${r.back} | 赔${r.odds ?? "-"}`);
    }
  }
  process.exit(0);
})().catch((e) => { console.error("ERR " + e.message); process.exit(1); });
