/** ky_live_lakers.cjs — 只读：从滚球列表找湖人场次与盘口。 */
"use strict";
const zlib = require("node:zlib");
const auth = require("./ky_api_auth.cjs");

const unwrap = (t) => {
  const j = JSON.parse(t);
  if (typeof j.data === "string" && j.data.startsWith("H4sI"))
    return JSON.parse(zlib.gunzipSync(Buffer.from(j.data, "base64")).toString("utf8"));
  return j;
};

(async () => {
  const c = auth.load();
  const base = c.templates.getOriginalDataPB;
  const origin = new URL(base.url).origin;
  const url = origin + "/yewu11/v1/w/getAllInPlayMatchListPB?t=" + Date.now();
  const tryBodies = [{}, { sportId: "1" }, { sportId: 1, csid: "2" }];
  for (const body of tryBodies) {
    try {
      const r = await fetch(url, { method: "POST", headers: { ...base.headers, "content-type": "application/json" }, body: JSON.stringify(body) });
      const txt = await r.text();
      if (!r.ok) { console.log("HTTP " + r.status + " body=" + JSON.stringify(body)); continue; }
      const o = unwrap(txt);
      const flat = JSON.stringify(o);
      const hasLakers = /湖人|Lakers/.test(flat);
      console.log(JSON.stringify({ body, keys: Object.keys(o).slice(0, 8), len: flat.length, hasLakers, sample: flat.slice(0, 200) }).slice(0, 800));
      if (hasLakers) {
        const idx = flat.search(/湖人|Lakers/);
        console.log("SEG=" + flat.slice(Math.max(0, idx - 300), idx + 500));
        break;
      }
    } catch (e) { console.log("ERR " + e.message + " body=" + JSON.stringify(body)); }
  }
  process.exit(0);
})();
