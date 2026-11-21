/** ky_find_lakers_mid.cjs — 从全量数据里找湖人-爵士 mid，并打印其篮球盘口。 */
"use strict";
const zlib = require("node:zlib");
const auth = require("./ky_api_auth.cjs");
const unwrap = (t) => { const j = JSON.parse(t); return typeof j.data === "string" && j.data.startsWith("H4sI") ? JSON.parse(zlib.gunzipSync(Buffer.from(j.data, "base64")).toString("utf8")) : j; };
(async () => {
  const c = auth.load();
  const t0 = c.templates.getOriginalDataPB;
  const all = unwrap(await (await fetch(t0.url.replace(/t=\d+/, "t=" + Date.now()), { headers: t0.headers })).text());
  const leagues = new Map((all.tids_obj || []).map((x) => [String(x.tid), x.tn]));
  const hits = (all.matchsList || []).filter((m) => /湖人/.test(m.mhn || "") || /湖人/.test(m.man || ""));
  console.log("HITS=" + JSON.stringify(hits.map((m) => ({ mid: m.mid, league: leagues.get(String(m.tid)), home: m.mhn, away: m.man, mst: m.mst, score: m.mhs + "-" + (m.mas ?? "?"), mgt: m.mgt }))));
  const mid = hits[0] && hits[0].mid;
  if (!mid) process.exit(0);
  const t1 = c.templates.getMatchBaseInfoByOddsPB;
  const b = JSON.parse(t1.post || "{}"); b.mid = String(mid);
  const o = unwrap(await (await fetch(t1.url, { method: t1.method, headers: t1.headers, body: JSON.stringify(b) })).text());
  const m = (o.data || [])[0];
  const arr = (m.playData && m.playData.length ? m.playData : m.hpsData) || [];
  const groups = arr.flatMap((x) => x.hps || []).map((g) => ({ hpn: g.hpn, hpid: g.hpid, chpid: g.chpid, hid: g.hl && g.hl.hid, hv: g.hl && g.hl.hv, opts: ((g.hl && g.hl.ol) || []).map((x) => ({ ot: x.ot, onb: x.onb, ov: x.ov, oid: x.oid })) }));
  console.log("MATCH=" + JSON.stringify({ mid: m.mid, league: m.tnjc, home: m.mhn, away: m.man, score: m.mhs + "-" + m.mas, mst: m.mst }));
  console.log("GROUPS=" + JSON.stringify(groups.slice(0, 8)));
  process.exit(0);
})();
