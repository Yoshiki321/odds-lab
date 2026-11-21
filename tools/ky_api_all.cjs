/** ky_api_all.cjs — 找出返回场次最多的接口（只读）。 */
"use strict";
const { chromium } = require("playwright");
const zlib = require("node:zlib");

function decode(txt) {
  try {
    const j = JSON.parse(txt);
    if (typeof j.data !== "string" || !j.data.startsWith("H4sI")) return null;
    const raw = zlib.gunzipSync(Buffer.from(j.data, "base64")).toString("utf8");
    return JSON.parse(raw);
  } catch { return null; }
}
function countMatches(obj) {
  const arr = (obj && obj.data) || null;
  if (Array.isArray(arr)) return arr.length;
  if (arr && typeof arr === "object") return Object.keys(arr).length;
  return 0;
}

(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9333", { timeout: 15000 });
  const ctx = browser.contexts()[0];
  const page = ctx.pages()[0];
  const log = [];

  page.on("response", async (res) => {
    const u = res.url();
    if (!u.includes("PB")) return;
    try {
      const t = await res.text();
      const obj = decode(t);
      if (!obj) return;
      const n = countMatches(obj);
      if (n > 0) log.push({ ep: u.split("?")[0].split("/").slice(-2).join("/"), n, bytes: t.length });
    } catch {}
  });

  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(6000);
  // 切早盘
  await page.getByText("早盘", { exact: true }).first().click({ timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(5000);
  // 逐个日期
  const dates = await page.evaluate(() => [...new Set([...((document.body.innerText || "").matchAll(/(\d{1,2}\/\d{1,2})\s*\n?\s*（(\d+)/g))].map((m) => m[1]))].slice(0, 4)).catch(() => []);
  for (const d of dates) {
    await page.getByText(d, { exact: true }).first().click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(3500);
  }

  const agg = {};
  for (const r of log) { agg[r.ep] = Math.max(agg[r.ep] || 0, r.n); }
  console.log(JSON.stringify({ dates, agg, samples: log.slice(-12) }, null, 1));
  process.exit(0);
})().catch((e) => { console.error("ERR " + e.message); process.exit(1); });
