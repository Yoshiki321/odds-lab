/** ky_api_chunks.cjs — 递归从JS里找chunk名，抓全体育APP接口。 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const BASE = "https://user-pc-new.zqt0510.com";
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "data", "experiment_survival_100", "runtime", "api_sport_endpoints_full.json");

(async () => {
  const html = await fetch(BASE + "/", { signal: AbortSignal.timeout(15000) }).then((r) => r.text()).catch(() => "");
  const queue = [...new Set([...html.matchAll(/<script[^>]+src=["']([^"']+)["']/g)].map((m) => m[1]))].map((s) => s.startsWith("http") ? s : BASE + (s.startsWith("/") ? s : "/" + s));
  const visited = new Set();
  const found = new Map();
  const run = async (url, depth) => {
    if (visited.has(url) || depth > 3 || visited.size >= 60) return;
    visited.add(url);
    let t;
    try { const r = await fetch(url, { signal: AbortSignal.timeout(12000) }); if (!r.ok) return; t = await r.text(); } catch { return; }
    const re = /["'`](\/?yewu\d+\/[a-zA-Z0-9_/\-\.]*(?:PB|[a-zA-Z]+))["'`]/g;
    let m;
    while ((m = re.exec(t)) !== null) {
      const ep = m[1].replace(/^\//, "");
      if (ep.length > 4 && ep.length < 100 && !found.has(ep)) found.set(ep, { endpoint: ep, source: url.split("/").pop().slice(0, 40) });
    }
    // 找 chunk: "xxx.yyy.js" 或 "/js/xxx.js"
    const re2 = /["']([a-zA-Z0-9_\-\.]+\.js)["']/g;
    while ((m = re2.exec(t)) !== null) {
      const f = m[1];
      if (!/\.js$/.test(f) || f.length > 70) continue;
      const u = BASE + "/js/" + f.replace(/^\//, "");
      if (!visited.has(u)) queue.push(u);
    }
  };
  while (queue.length) {
    const u = queue.shift();
    await run(u, 0);
    // 第二轮：对刚抓到的 JS 再做一层
  }
  // 递归一层
  const extra = [...visited];
  for (const u of extra) await run(u.replace(/\.js$/, ".js"), 1);

  const out = { generatedAt: new Date().toISOString(), jsVisited: visited.size, count: found.size, endpoints: [...found.values()].sort((a, b) => a.endpoint.localeCompare(b.endpoint)) };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2), "utf8");
  console.log(JSON.stringify({ out: path.relative(ROOT, OUT), visited: visited.size, count: found.size, endpoints: out.endpoints.map((e) => e.endpoint) }, null, 1));
  process.exit(0);
})().catch((e) => { console.error("ERR " + e.message); process.exit(1); });
