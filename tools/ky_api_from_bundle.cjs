/** ky_api_from_bundle.cjs — 从公开 JS 静态包里抽取接口路径（不需要登录）。 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const CAT = path.join(ROOT, "data", "experiment_survival_100", "runtime", "api_catalog_full.json");
const OUT = path.join(ROOT, "data", "experiment_survival_100", "runtime", "api_endpoints_from_bundle.json");

function tryRequire(p) { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } }

(async () => {
  const cat = tryRequire(CAT);
  if (!cat) { console.log(JSON.stringify({ ok: false, reason: "无 api_catalog_full.json" })); process.exit(1); }
  const jsPaths = [...new Set(cat.endpoints.map((e) => e.endpoint).filter((e) => e.endsWith(".js") && e.startsWith("/_next/")))];
  const bases = ["https://user-pc-new.zqt0510.com", "https://www.w7spda.vip:6501"];
  const found = new Map();
  let fetched = 0;

  for (const p of jsPaths) {
    for (const base of bases) {
      try {
        const r = await fetch(base + p, { signal: AbortSignal.timeout(8000) });
        if (!r.ok) continue;
        const t = await r.text();
        fetched++;
        // 接口路径：/yewuN/vM/...PB、/site/api/v1/...、/act/api/v1/...
        const reList = [
          /["'`](\/?(?:yewu\d+|site|act|game|ins)\/[a-zA-Z0-9_/-]*(?:PB|[a-z]+))["'`]/g,
          /["'](\/api\/[a-zA-Z0-9_/-]+)["']/g,
        ];
        for (const re of reList) {
          let m;
          while ((m = re.exec(t)) !== null) {
            const ep = m[1].replace(/^\//, "");
            if (ep.length < 5 || ep.length > 90) continue;
            if (!found.has(ep)) found.set(ep, { endpoint: ep, sources: [] });
            const s = found.get(ep);
            if (s.sources.length < 3) s.sources.push(p.split("/").pop().slice(0, 24));
          }
        }
        break;
      } catch {}
    }
  }

  const out = {
    generatedAt: new Date().toISOString(),
    method: "公开JS静态包路径抽取（不依赖登录）",
    jsFilesScanned: fetched,
    endpointCount: found.size,
    endpoints: [...found.values()].sort((a, b) => a.endpoint.localeCompare(b.endpoint)),
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2), "utf8");
  console.log(JSON.stringify({ out: path.relative(ROOT, OUT), jsFiles: fetched, count: found.size, sample: out.endpoints.slice(0, 25).map((x) => x.endpoint) }, null, 1));
  process.exit(0);
})().catch((e) => { console.error("ERR " + e.message); process.exit(1); });
