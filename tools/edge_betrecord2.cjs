/** edge_betrecord2.cjs — 只读：保留查询参数进入注单历史，读未结订单与兑现报价。 */
"use strict";
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9333", { timeout: 15000 });
  const ctx = browser.contexts()[0];
  const page = ctx.pages()[0];

  const u = new URL(page.url());
  u.hash = "#/bet_record";
  const target = u.toString();

  await page.goto(target, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(4000);

  const out = await page.evaluate(() => {
    const t = document.body.innerText || "";
    const start = t.indexOf("未结算注单");
    return { hash: location.hash, len: t.length, seg: start >= 0 ? t.slice(start, start + 900) : t.slice(0, 600) };
  });
  console.log(JSON.stringify(out, null, 1));
  process.exit(0);
})().catch((e) => { console.error("ERR " + e.message); process.exit(1); });
