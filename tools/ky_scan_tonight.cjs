/** ky_scan_tonight.cjs — 扫今晚可下注场次（滚球+未来8小时），带三主盘。 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const auth = require("./ky_api_auth.cjs");

const unwrap = (t) => { const j = JSON.parse(t); return typeof j.data === "string" && j.data.startsWith("H4sI") ? JSON.parse(zlib.gunzipSync(Buffer.from(j.data, "base64")).toString("utf8")) : j; };
const bj = (ms) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(ms));

function markets(m) {
  const arr = (m.playData && m.playData.length ? m.playData : m.hpsData) || [];
  const groups = arr.flatMap((x) => x.hps || []);
  const o = (v) => Number(v) / 100000;
  const find = (hp) => groups.find((g) => String(g.hpid) === hp);
  const out = {};
  const g1 = find("1") || find("37");
  if (g1) out.ml = (g1.hl.ol || []).map((x) => ({ side: x.ot, label: x.onb || x.on, odds: o(x.ov) }));
  const g2 = find("4") || find("39");
  if (g2) out.hcp = { line: g2.hl.hv, opts: (g2.hl.ol || []).map((x) => ({ side: x.ot, label: x.onb, odds: o(x.ov) })) };
  const g3 = find("2") || find("38");
  if (g3) out.ou = { line: g3.hl.hv, opts: (g3.hl.ol || []).map((x) => ({ side: x.ot, label: x.onb, odds: o(x.ov) })) };
  return out;
}

(async () => {
  const c = auth.load();
  const t0 = c.templates.getOriginalDataPB;
  const all = unwrap(await (await fetch(t0.url.replace(/t=\d+/, "t=" + Date.now()), { headers: t0.headers })).text());
  const leagues = new Map((all.tids_obj || []).map((x) => [String(x.tid), x.tn]));
  const now = Date.now();
  const cands = (all.matchsList || [])
    .filter((m) => ["1", "2"].includes(String(m.csid))) // 足球/篮球
    .map((m) => ({ mid: String(m.mid), league: leagues.get(String(m.tid)) || "?", home: m.mhn, away: m.man, mgt: Number(m.mgt), mst: m.mst, csid: String(m.csid) }))
    .filter((m) => Number.isFinite(m.mgt) && m.mgt > now - 3 * 3600e3 && m.mgt < now + 8 * 3600e3)
    .sort((a, b) => a.mgt - b.mgt)
    .slice(0, 18);

  const t1 = c.templates.getMatchBaseInfoByOddsPB;
  const rows = [];
  for (const m of cands) {
    try {
      const b = JSON.parse(t1.post || "{}"); b.mid = m.mid;
      const o = unwrap(await (await fetch(t1.url, { method: t1.method, headers: t1.headers, body: JSON.stringify(b) })).text());
      const mm = (o.data || [])[0];
      if (!mm) continue;
      const mk = markets(mm);
      const live = m.mgt <= now;
      rows.push({ ...m, live, kickoff: bj(m.mgt), markets: mk });
    } catch {}
  }
  const out = { generatedAt: new Date().toISOString(), now: bj(now), count: rows.length, rows };
  const fp = path.join(__dirname, "..", "data", "experiment_survival_100", "runtime", "scan_tonight.json");
  fs.writeFileSync(fp, JSON.stringify(out, null, 2), "utf8");
  console.log(JSON.stringify({ ok: true, count: rows.length, file: "runtime/scan_tonight.json", brief: rows.slice(0, 8).map((r) => `${r.live ? "LIVE" : r.kickoff} ${r.league} ${r.home} vs ${r.away} | ml=${JSON.stringify(r.markets.ml)} | hcp=${r.markets.hcp ? r.markets.hcp.line : "-"}`) }, null, 1));
  process.exit(0);
})();
