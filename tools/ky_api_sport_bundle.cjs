/** ky_api_sport_bundle.cjs — 抓体育APP(用户端)公开JS，抽取全部 yewu 接口路径。 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "data", "experiment_survival_100", "runtime", "api_sport_endpoints.json");
const BASE = "https://user-pc-new.zqt0510.com";

(async () => {
  const html = await fetch(BASE + "/", { signal: AbortSignal.timeout(15000) }).then((r) => r.text()).catch(() => "");
  if (!html) { console.log(JSON.stringify({ ok: false, reason: "HTML获取失败" })); process.exit(1); }
  const scripts = [...new Set([...html.matchAll(/<script[^>]+src=["']([^"']+)["']/g)].map((m) => m[1]))];
  const found = new Map();
  let fetched = 0;
  for (const src of scripts) {
    const url = src.startsWith("http") ? src : BASE + (src.startsWith("/") ? src : "/" + src);
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) continue;
      const t = await r.text();
      fetched++;
      // yewuN/vM/xxxPB 等接口
      const re = /["'`](\/?yewu\d+\/[a-zA-Z0-9_/\-\.]*(?:PB|[a-zA-Z]+))["'`]/g;
      let m;
      while ((m = re.exec(t)) !== null) {
        const ep = m[1].replace(/^\//, "");
        if (ep.length < 5 || ep.length > 100) continue;
        if (!found.has(ep)) found.set(ep, { endpoint: ep, source: src.split("/").pop().slice(0, 30) });
      }
    } catch {}
  }
  const out = {
    generatedAt: new Date().toISOString(),
    source: "体育APP公开HTML+JS静态包抽取（不依赖登录）",
    htmlBytes: html.length,
    scriptsFound: scripts.length,
    jsFetched: fetched,
    count: found.size,
    endpoints: [...found.values()].sort((a, b) => a.endpoint.localeCompare(b.endpoint)),
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2), "utf8");
  console.log(JSON.stringify({ out: path.relative(ROOT, OUT), scripts: scripts.length, fetched, count: found.size, endpoints: out.endpoints.map((e) => e.endpoint) }, null, 1));
  process.exit(0);
})().catch((e) => { console.error("ERR " + e.message); process.exit(1); });
