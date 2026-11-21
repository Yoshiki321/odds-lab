/** ky_watch_two.cjs — 盯两场滚球（比分+赔率），未结减少即报。 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const auth = require("./ky_api_auth.cjs");

const MIDS = ["5871412", "5881906"];
const LOG = path.join(__dirname, "..", "data", "experiment_survival_100", "runtime", "watch_two.log");
const unwrap = (t) => { const j = JSON.parse(t); return typeof j.data === "string" && j.data.startsWith("H4sI") ? JSON.parse(zlib.gunzipSync(Buffer.from(j.data, "base64")).toString("utf8")) : j; };
const bj = (d) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(d);
const log = (s) => { fs.appendFileSync(LOG, s + "\n", "utf8"); console.log(s); };
const score = (m) => { const a = m.msc || []; const h = a.find((x) => String(x).startsWith("S1|")); return h ? h.split("|")[1] : "?"; };

(async () => {
  const c = auth.load();
  const t1 = c.templates.getMatchBaseInfoByOddsPB;
  const ct = c.templates.countUnsettleTickets;
  const started = Date.now();
  let low = 0;
  log(`[${bj(new Date())}] 盯两场开始 ${MIDS.join(",")}`);
  let prev = "";
  for (;;) {
    try {
      const parts = [];
      for (const mid of MIDS) {
        const b = JSON.parse(t1.post || "{}"); b.mid = mid;
        const o = unwrap(await (await fetch(t1.url, { method: t1.method, headers: t1.headers, body: JSON.stringify(b) })).text());
        const m = (o.data || [])[0] || {};
        const arr = (m.playData && m.playData.length ? m.playData : m.hpsData) || [];
        const g = arr.flatMap((x) => x.hps || []).find((x) => String(x.hpid) === "37");
        const odds = g ? (g.hl.ol || []).map((x) => `${x.ot}@${(Number(x.ov) / 100000).toFixed(2)}`).join("/") : "-";
        parts.push(`${m.mhn || mid} ${score(m)} ${m.man || ""} [${odds}]`);
      }
      const cj = JSON.parse(await (await fetch(ct.url + "&t=" + Date.now(), { headers: ct.headers })).text());
      const unc = cj.code === "0000000" && typeof cj.data === "number" ? cj.data : null;
      const line = `[${bj(new Date())}] ${parts.join(" || ")} 未结=${unc ?? "读取失败"}`;
      if (line !== prev) log(line);
      prev = line;
      if (unc !== null && unc < 4) { low++; if (low >= 2) { log(`[${bj(new Date())}] 连续2次未结<4(${unc})，有单结算，退出`); break; } } else low = 0;
    } catch (e) { log(`[${bj(new Date())}] 异常 ${e.message}`); }
    if (Date.now() - started > 3 * 3600 * 1000) { log(`[${bj(new Date())}] 满3小时停止`); break; }
    await new Promise((r) => setTimeout(r, 45000));
  }
  process.exit(0);
})();
