/** ky_api_sample.cjs — 打印 getMatchBaseInfoByOddsPB 一场的完整结构（只读）。 */
"use strict";
const { chromium } = require("playwright");
const zlib = require("node:zlib");

(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9333", { timeout: 15000 });
  const ctx = browser.contexts()[0];
  const page = ctx.pages()[0];
  let best = null;

  page.on("response", async (res) => {
    if (!res.url().includes("getMatchBaseInfoByOddsPB")) return;
    try {
      const t = await res.text();
      const j = JSON.parse(t);
      if (typeof j.data !== "string") return;
      const raw = zlib.gunzipSync(Buffer.from(j.data, "base64")).toString("utf8");
      if (!best || raw.length > best.length) best = raw;
    } catch {}
  });

  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(9000);

  if (!best) { console.log(JSON.stringify({ ok: false })); process.exit(0); }
  const obj = JSON.parse(best);
  const arr = obj.data || [];
  const m = arr.find((x) => x.hpsPns && x.hpsPns.length) || arr[0];
  const slim = {
    keysAll: Object.keys(m),
    mid: m.mid, tnjc: m.tnjc, mgt: m.mgt, mhn: m.mhn, man: m.man, mhs: m.mhs, mat: m.mat,
    playSample: (m.hpsPns || []).slice(0, 2).map((h) => ({
      hpn: h.hpn,
      keys: Object.keys(h),
      oddsSample: (h.hps || h.hpsList || []).slice ? (h.hps || h.hpsList || []).slice(0, 3) : h.hps,
    })),
  };
  console.log(JSON.stringify({ ok: true, matches: arr.length, slim }, null, 1).slice(0, 4000));
  process.exit(0);
})().catch((e) => { console.error("ERR " + e.message); process.exit(1); });
