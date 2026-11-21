/** ky_api_count.cjs — 按 '"mid"' 计数各接口返回的场次数，找“全量”接口。 */
"use strict";
const { chromium } = require("playwright");
const zlib = require("node:zlib");

function decode(txt) {
  try {
    const j = JSON.parse(txt);
    if (typeof j.data !== "string" || !j.data.startsWith("H4sI")) return null;
    return zlib.gunzipSync(Buffer.from(j.data, "base64")).toString("utf8");
  } catch { return null; }
}

(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9333", { timeout: 15000 });
  const ctx = browser.contexts()[0];
  const page = ctx.pages()[0];
  const rows = [];

  page.on("response", async (res) => {
    const u = res.url();
    if (!u.includes("PB")) return;
    try {
      const t = await res.text();
      const raw = decode(t);
      if (!raw) return;
      const mids = (raw.match(/"mid"/g) || []).length;
      const tours = (raw.match(/"tname"|"tnjc"|"tnName"/g) || []).length;
      if (mids > 0 || tours > 0) rows.push({ ep: u.split("?")[0].split("/").slice(-2).join("/"), mids, tours, bytes: raw.length });
    } catch {}
  });

  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(7000);
  await page.getByText("早盘", { exact: true }).first().click({ timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(5000);
  for (const d of ["11/20", "11/21"]) {
    await page.getByText(d, { exact: true }).first().click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(4000);
  }

  const best = {};
  for (const r of rows) {
    if (!best[r.ep] || r.mids > best[r.ep].mids) best[r.ep] = r;
  }
  console.log(JSON.stringify({ best, sampleCount: rows.length }, null, 1));
  process.exit(0);
})().catch((e) => { console.error("ERR " + e.message); process.exit(1); });
