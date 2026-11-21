/** ky_api_probe.cjs — 只读：挂监听，重载体育页，记录所有比赛数据接口的返回格式。 */
"use strict";
const { chromium } = require("playwright");
const KEYS = ["getAllMatchesOddsPB", "collectMatchesPB", "structureMatchBaseInfoByMidsPB", "findTopMatchsPB", "getMatchBaseInfoByOddsPB", "matchDetail/getMatchDetailPB", "findTopIdsPB", "category/getCategoryList", "findPlaySortPB"];

(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9333", { timeout: 15000 });
  const ctx = browser.contexts()[0];
  const page = ctx.pages()[0];
  const hits = [];

  page.on("response", async (res) => {
    const url = res.url();
    if (!KEYS.some((k) => url.includes(k))) return;
    try {
      const ct = (res.headers()["content-type"] || "").slice(0, 40);
      const buf = await res.body();
      hits.push({ url: url.split("?")[0].split("/").slice(-3).join("/"), status: res.status(), ct, bytes: buf.length, head: buf.slice(0, 120).toString("utf8").replace(/[\x00-\x1f]/g, ".") });
    } catch (e) { hits.push({ url: url.slice(0, 80), err: e.message }); }
  });

  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(8000);

  console.log(JSON.stringify({ count: hits.length, hits }, null, 1));
  process.exit(0);
})().catch((e) => { console.error("ERR " + e.message); process.exit(1); });
