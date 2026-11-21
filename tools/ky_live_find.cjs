/** ky_live_find.cjs — 只读：按 menuId 拉滚球列表，找指定球队。用法: node tools/ky_live_find.cjs 湖人 */
"use strict";
const zlib = require("node:zlib");
const auth = require("./ky_api_auth.cjs");
const unwrap = (t) => { const j = JSON.parse(t); return typeof j.data === "string" && j.data.startsWith("H4sI") ? JSON.parse(zlib.gunzipSync(Buffer.from(j.data, "base64")).toString("utf8")) : j; };
(async () => {
  const kw = process.argv[2] || "湖人";
  const c = auth.load(); const base = c.templates.getOriginalDataPB;
  const origin = new URL(base.url).origin;
  const url = origin + "/yewu11/v1/w/getAllInPlayMatchListPB?t=" + Date.now();
  for (const body of [{ menuId: "1011" }, { menuId: 1011 }, { menuId: "1011", csid: "2" }, { menuId: "500", csid: "2" }]) {
    const r = await fetch(url, { method: "POST", headers: { ...base.headers, "content-type": "application/json" }, body: JSON.stringify(body) });
    const txt = await r.text();
    let o; try { o = unwrap(txt); } catch { continue; }
    if (o.code !== "0000000") { console.log("try " + JSON.stringify(body) + " -> " + o.code + " " + o.msg); continue; }
    const flat = JSON.stringify(o);
    const hit = flat.indexOf(kw);
    console.log("OK body=" + JSON.stringify(body) + " len=" + flat.length + " hasKw=" + (hit >= 0));
    if (hit >= 0) {
      console.log("SEG=" + flat.slice(Math.max(0, hit - 400), hit + 400));
      const arr = [];
      const walk = (x) => { if (!x || typeof x !== "object") return; if (Array.isArray(x)) { x.forEach(walk); return; } if (x.mhn && x.man) arr.push({ mid: x.mid, league: x.tnjc, home: x.mhn, away: x.man, score: (x.mhs ?? "") + "-" + (x.mas ?? "") }); Object.values(x).forEach(walk); };
      walk(o);
      console.log("MATCHES=" + JSON.stringify(arr.filter((m) => new RegExp(kw).test(m.home + m.away))));
    }
    break;
  }
  process.exit(0);
})();
