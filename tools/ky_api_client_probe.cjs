/** ky_api_client_probe.cjs — 捕获接口请求头/体，并在页面上下文重放验证。只读。 */
"use strict";
const { chromium } = require("playwright");
const zlib = require("node:zlib");

const unwrap = (txt) => {
  try {
    const j = JSON.parse(txt);
    if (typeof j.data === "string" && j.data.startsWith("H4sI"))
      return JSON.parse(zlib.gunzipSync(Buffer.from(j.data, "base64")).toString("utf8"));
    return j;
  } catch { return null; }
};

(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9333", { timeout: 15000 });
  const ctx = browser.contexts()[0];
  const page = ctx.pages()[0];
  let orig = null, base = null;

  page.on("request", (req) => {
    const u = req.url();
    if (u.includes("getOriginalDataPB") && !orig) {
      orig = { url: u, method: req.method(), headers: req.headers(), post: req.postData() };
    }
    if (u.includes("structureMatchBaseInfoByMidsPB") && !base) {
      base = { url: u, method: req.method(), headers: req.headers(), post: req.postData() };
    }
  });

  // 回首页触发
  await page.goto("https://www.w7spda.vip:6501/game/sport/ob?enName=YBTY", { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(3000);
  const src = await page.evaluate(() => { const f = document.querySelector("iframe"); return f ? f.src : null; }).catch(() => null);
  if (src) await page.goto(src, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
  for (let i = 0; i < 20 && !orig; i++) await page.waitForTimeout(1000);

  if (!orig) { console.log(JSON.stringify({ ok: false, reason: "未捕获 getOriginalDataPB 请求", baseCaptured: !!base })); process.exit(0); }

  // 去掉浏览器自动头（fetch 不能设置的）
  const safeHeaders = {};
  for (const [k, v] of Object.entries(orig.headers)) {
    if (/^(host|content-length|accept-encoding|connection|origin|referer|user-agent|cookie)$/i.test(k) || /^sec-/i.test(k)) continue;
    safeHeaders[k] = v;
  }
  const replay = await page.evaluate(async ({ url, method, headers, body }) => {
    const out = {};
    for (const cred of ["omit", "include"]) {
      try {
        const r = await fetch(url, { method, headers, body: body || undefined, credentials: cred });
        const t = await r.text();
        out[cred] = { status: r.status, len: t.length, head: t.slice(0, 80) };
      } catch (e) { out[cred] = { err: e.message }; }
    }
    return out;
  }, { ...orig, headers: safeHeaders });

  console.log(JSON.stringify({
    ok: true,
    request: { url: orig.url.slice(0, 90), method: orig.method, post: orig.post ? orig.post.slice(0, 120) : null, headerKeys: Object.keys(safeHeaders) },
    replay,
    decodedKeys: null,
    matchCount: null,
    baseReq: base ? { url: base.url.slice(0, 90), post: (base.post || "").slice(0, 200), headerKeys: Object.keys(base.headers).slice(0, 20) } : null,
  }, null, 1));
  process.exit(0);
})().catch((e) => { console.error("ERR " + e.message); process.exit(1); });
