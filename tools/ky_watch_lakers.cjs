/** ky_watch_lakers.cjs — 只读盯单：每分钟记湖人比分+未结数，结算即退出。 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const auth = require("./ky_api_auth.cjs");

const MID = "5860974";
const LOG = path.join(__dirname, "..", "data", "experiment_survival_100", "runtime", "watch_lakers.log");
const unwrap = (t) => { const j = JSON.parse(t); return typeof j.data === "string" && j.data.startsWith("H4sI") ? JSON.parse(zlib.gunzipSync(Buffer.from(j.data, "base64")).toString("utf8")) : j; };
const bj = (d) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(d);
const log = (s) => { fs.appendFileSync(LOG, s + "\n", "utf8"); console.log(s); };

(async () => {
  const c = auth.load();
  const t1 = c.templates.getMatchBaseInfoByOddsPB;
  const ct = c.templates.countUnsettleTickets;
  const started = Date.now();
  log(`[${bj(new Date())}] 开始盯单 mid=${MID}`);
  let last = "";
  for (;;) {
    let line = "";
    try {
      const b = JSON.parse(t1.post || "{}"); b.mid = MID;
      const o = unwrap(await (await fetch(t1.url, { method: t1.method, headers: t1.headers, body: JSON.stringify(b) })).text());
      const m = (o.data || [])[0] || {};
      const arr = (m.playData && m.playData.length ? m.playData : m.hpsData) || [];
      const g = arr.flatMap((x) => x.hps || []).find((x) => String(x.hpid) === "39");
      const odds = g ? (g.hl.ol || []).map((x) => `${x.onb}@${(Number(x.ov) / 100000).toFixed(2)}`).join(" ") : "-";
      const unc = unwrap(await (await fetch(ct.url + "&t=" + Date.now(), { headers: ct.headers })).text()).data;
      line = `[${bj(new Date())}] 比分=${m.mhs ?? "?"}-${m.mas ?? "?"} 状态=${m.mst} 让分=${odds} 未结=${unc}`;
      if (line !== last) log(line);
      last = line;
      if (unc < 3) { log(`[${bj(new Date())}] 检测到未结减少(${unc})，湖人单可能已结算，退出盯单`); break; }
      if (m.mst === "0" || Number(m.mst) === 0) { log(`[${bj(new Date())}] 比赛状态=0(已结束)，退出盯单`); break; }
    } catch (e) {
      log(`[${bj(new Date())}] 轮询异常: ${e.message}`);
    }
    if (Date.now() - started > 4 * 3600 * 1000) { log(`[${bj(new Date())}] 超4小时，停止盯单`); break; }
    await new Promise((r) => setTimeout(r, 60000));
  }
  process.exit(0);
})();
