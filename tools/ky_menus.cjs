/** ky_menus.cjs — 打印菜单映射，找滚球/篮球 menu id。 */
"use strict";
const zlib = require("node:zlib");
const auth = require("./ky_api_auth.cjs");
const unwrap = (t) => { const j = JSON.parse(t); return typeof j.data === "string" && j.data.startsWith("H4sI") ? JSON.parse(zlib.gunzipSync(Buffer.from(j.data, "base64")).toString("utf8")) : j; };
(async () => {
  const c = auth.load(); const t = c.templates.getOriginalDataPB;
  const r = await fetch(t.url.replace(/t=\d+/, "t=" + Date.now()), { headers: t.headers });
  const o = unwrap(await r.text());
  console.log("menus=" + JSON.stringify(o.menus).slice(0, 800));
  console.log("spList=" + JSON.stringify(o.spList).slice(0, 300));
  process.exit(0);
})();
