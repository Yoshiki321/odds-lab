/** ky_api_client.cjs — 从当前页面抓一次 API 头（仅内存，不落盘），然后用纯 Node fetch 调接口。 */
"use strict";
const zlib = require("node:zlib");
const { chromium } = require("playwright");

const unwrap = (txt) => {
  const j = JSON.parse(txt);
  if (typeof j.data === "string" && j.data.startsWith("H4sI"))
    return JSON.parse(zlib.gunzipSync(Buffer.from(j.data, "base64")).toString("utf8"));
  return j;
};

async function bootstrap() {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9333", { timeout: 15000 });
  const ctx = browser.contexts()[0];
  const page = ctx.pages()[0];
  let hit = null;
  page.on("request", (r) => {
    if (hit || !r.url().includes("getOriginalDataPB")) return;
    const h = {};
    for (const [k, v] of Object.entries(r.headers())) {
      if (/^(host|content-length|accept-encoding|connection|origin|referer|user-agent|cookie)$/i.test(k) || /^sec-/i.test(k)) continue;
      h[k] = v;
    }
    hit = { url: r.url(), headers: h };
  });
  // 刷新触发一次
  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
  for (let i = 0; i < 25 && !hit; i++) await page.waitForTimeout(800);
  return hit;
}

(async () => {
  const hit = await bootstrap();
  if (!hit) { console.log(JSON.stringify({ ok: false, reason: "未捕获请求头" })); process.exit(1); }
  // 纯 Node fetch，不带 cookie
  const r = await fetch(hit.url, { headers: hit.headers });
  const txt = await r.text();
  const obj = unwrap(txt);
  console.log(JSON.stringify({
    ok: true, status: r.status, bytes: txt.length,
    keys: Object.keys(obj).slice(0, 10),
    matches: obj.matchsList ? obj.matchsList.length : null,
    leagues: obj.tids_obj ? obj.tids_obj.length : null,
    sports: obj.spList ? obj.spList.length : null,
    headerKeysUsed: Object.keys(hit.headers),
    note: "凭据仅驻留内存，未写盘",
  }, null, 1));
  process.exit(0);
})().catch((e) => { console.error("ERR " + e.message); process.exit(1); });
