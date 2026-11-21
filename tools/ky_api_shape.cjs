/** ky_api_shape.cjs — 解包后打印一个场次的结构（只读）。 */
"use strict";
const { chromium } = require("playwright");
const zlib = require("node:zlib");

(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9333", { timeout: 15000 });
  const ctx = browser.contexts()[0];
  const page = ctx.pages()[0];
  const payloads = [];

  page.on("response", async (res) => {
    const u = res.url();
    if (!u.includes("PB") && !u.includes("getMatchBaseInfoByOdds")) return;
    try {
      const t = await res.text();
      if (t.startsWith("{") && t.includes('"data":"H4sI')) payloads.push({ u: u.split("?")[0].split("/").slice(-2).join("/"), t });
    } catch {}
  });

  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(9000);

  const summary = [];
  let firstMatch = null;
  for (const p of payloads) {
    try {
      const j = JSON.parse(p.t);
      const raw = zlib.gunzipSync(Buffer.from(j.data, "base64"));
      const obj = JSON.parse(raw.toString("utf8"));
      const arr = obj.data || [];
      summary.push({ ep: p.u, matches: Array.isArray(arr) ? arr.length : 0 });
      if (!firstMatch && Array.isArray(arr) && arr.length) {
        const m = arr[0];
        firstMatch = {
          keys: Object.keys(m).slice(0, 40),
          tnjc: m.tnjc, csna: m.csna, mgt: m.mgt,
          teams: Object.keys(m).filter((k) => /team|Team|cea|ceb|hna|ana|name/i.test(k)).slice(0, 12).map((k) => [k, m[k]]),
          hpsKeys: (m.hpsPns || []).slice(0, 3).map((h) => ({ hpn: h.hpn, hids: h.hids, keys: Object.keys(h).slice(0, 14), hps: (h.hps || h.hpsList || []).slice(0, 3) })),
        };
      }
    } catch (e) { summary.push({ ep: p.u, err: e.message }); }
  }

  console.log(JSON.stringify({ payloads: summary, firstMatch }, null, 1).slice(0, 5000));
  process.exit(0);
})().catch((e) => { console.error("ERR " + e.message); process.exit(1); });
