/** edge_betrecord.cjs — 只读：打开注单历史未结页，取订单状态/兑现报价。不点击任何操作按钮。 */
"use strict";
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9333", { timeout: 15000 });
  const ctx = browser.contexts()[0];
  const page = ctx.pages()[0];

  const base = new URL(page.url());
  const target = base.origin + "/#/bet_record";
  await page.goto(target, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(3500);

  const data = await page.evaluate(() => {
    const t = document.body.innerText || "";
    return { url: location.href.slice(0, 60), text: t.slice(0, 1200) };
  });
  console.log(JSON.stringify(data, null, 1));
  process.exit(0);
})().catch((e) => { console.error("ERR " + e.message); process.exit(1); });
