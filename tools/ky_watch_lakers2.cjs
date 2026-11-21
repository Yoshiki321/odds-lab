/** ky_watch_lakers2.cjs — 只读盯单v2：比分取 msc，退出只看结算(未结<3)或4小时。 */
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

function scoreOf(m) {
  const arr = Array.isArray(m.msc) ? m.msc : [];
  const get = (id) => { const hit = arr.find((x) => String(x).startsWith("S" + id + "|")); return hit ? hit.split("|")[1] : null; };
  return get(1) || get(2) || "?";
}
function periodOf(m) {
  const arr = Array.isArray(m.msc) ? m.msc : [];
  const q = arr.filter((x) => /^S19|^S20/.test(String(x)));
  return q.length ? q.map((x) => String(x)).join(",") : "-";
}

(async () => {
  const c = auth.load();
  const t1 = c.templates.getMatchBaseInfoByOddsPB;
  const ct = c.templates.countUnsettleTickets;
  const started = Date.now();
  log(`[${bj(new Date())}] 盯单v2开始 mid=${MID}`);
  let last = "";
  for (;;) {
    try {
      const b = JSON.parse(t1.post || "{}"); b.mid = MID;
      const o = unwrap(await (await fetch(t1.url, { method: t1.method, headers: t1.headers, body: JSON.stringify(b) })).text());
      const m = (o.data || [])[0] || {};
      const arr = (m.playData && m.playData.length ? m.playData : m.hpsData) || [];
      const g = arr.flatMap((x) => x.hps || []).find((x) => String(x.hpid) === "39");
      const odds = g ? (g.hl.ol || []).map((x) => `${x.onb}@${(Number(x.ov) / 100000).toFixed(2)}`).join(" ") : "-";
      const unc = unwrap(await (await fetch(ct.url + "&t=" + Date.now(), { headers: ct.headers })).text()).data;
      const line = `[${bj(new Date())}] 比分=${scoreOf(m)} 节次=${periodOf(m)} 让分=${odds} 未结=${unc}`;
      if (line !== last) log(line);
      last = line;
      if (unc < 3) { log(`[${bj(new Date())}] 未结降至${unc}，湖人单已结算，退出`); break; }
    } catch (e) { log(`[${bj(new Date())}] 轮询异常: ${e.message}`); }
    if (Date.now() - started > 4 * 3600 * 1000) { log(`[${bj(new Date())}] 满4小时，停止`); break; }
    await new Promise((r) => setTimeout(r, 60000));
  }
  process.exit(0);
})();
