/** ky_live_probe.cjs — 试不同字段名找到滚球列表接口的参数。 */
"use strict";
const zlib = require("node:zlib");
const auth = require("./ky_api_auth.cjs");
const unwrap = (t) => { const j = JSON.parse(t); return typeof j.data === "string" && j.data.startsWith("H4sI") ? JSON.parse(zlib.gunzipSync(Buffer.from(j.data, "base64")).toString("utf8")) : j; };
(async () => {
  const c = auth.load(); const base = c.templates.getOriginalDataPB;
  const origin = new URL(base.url).origin;
  const url = origin + "/yewu11/v1/w/getAllInPlayMatchListPB?t=" + Date.now();
  const fields = ["menu", "menuNo", "menuIds", "menuIdStr", "id", "mid", "mn"];
  for (const f of fields) {
    const body = { [f]: "1011" };
    try {
      const r = await fetch(url, { method: "POST", headers: { ...base.headers, "content-type": "application/json" }, body: JSON.stringify(body) });
      const o = unwrap(await r.text());
      const flat = JSON.stringify(o).slice(0, 120);
      console.log(f + " -> code=" + o.code + " msg=" + (o.msg || "") + " len=" + JSON.stringify(o).length);
      if (o.code === "0000000") { console.log("SUCCESS field=" + f); break; }
    } catch (e) { console.log(f + " ERR " + e.message); }
  }
  process.exit(0);
})();
