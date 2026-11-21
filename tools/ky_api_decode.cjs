/** ky_api_decode.cjs — 抓比赛接口 → base64+gzip 解包 → 判断格式并抽样。 */
"use strict";
const { chromium } = require("playwright");
const zlib = require("node:zlib");

const TARGET = "getMatchBaseInfoByOddsPB";

(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9333", { timeout: 15000 });
  const ctx = browser.contexts()[0];
  const page = ctx.pages()[0];
  let captured = null;

  page.on("response", async (res) => {
    if (!res.url().includes(TARGET) || captured) return;
    try {
      const txt = await res.text();
      captured = txt;
    } catch {}
  });

  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
  for (let i = 0; i < 30 && !captured; i++) await page.waitForTimeout(500);

  if (!captured) { console.log(JSON.stringify({ ok: false, reason: "未捕获" })); process.exit(0); }

  const j = JSON.parse(captured);
  const buf = Buffer.from(j.data, "base64");
  const raw = zlib.gunzipSync(buf);
  const isJson = raw[0] === 0x7b || raw[0] === 0x5b;
  const head = raw.slice(0, 300).toString("utf8").replace(/[\x00-\x1f]/g, ".");
  console.log(JSON.stringify({ ok: true, code: j.code, gzBytes: buf.length, rawBytes: raw.length, isJson, head }, null, 1));
  process.exit(0);
})().catch((e) => { console.error("ERR " + e.message); process.exit(1); });
