/** edge_betrecord3.cjs — 只读：真实点击“注单历史”，等弹窗页，读未结订单+兑现报价。 */
"use strict";
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9333", { timeout: 15000 });
  const ctx = browser.contexts()[0];
  const page = ctx.pages()[0];
  const before = new Set(ctx.pages());

  const popupP = ctx.waitForEvent("page", { timeout: 15000 }).catch(() => null);
  await page.getByText("注单历史", { exact: true }).first().click({ timeout: 10000 }).catch((e) => console.error("CLICK_ERR " + e.message));
  const popup = await popupP;
  await page.waitForTimeout(2500);

  const pages = ctx.pages();
  const rec = popup || pages.find((p) => p.url().includes("bet_record"));
  if (!rec) {
    console.log(JSON.stringify({ ok: false, pages: pages.map((p) => p.url().slice(0, 70)) }));
    process.exit(0);
  }
  await rec.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
  await rec.waitForTimeout(2000);
  const out = await rec.evaluate(() => {
    const t = document.body.innerText || "";
    const i = t.indexOf("未结算注单");
    return { hash: location.hash, seg: i >= 0 ? t.slice(i, i + 900) : t.slice(0, 700) };
  });
  console.log(JSON.stringify({ ok: true, newPages: pages.length - before.size, ...out }, null, 1));
  process.exit(0);
})().catch((e) => { console.error("ERR " + e.message); process.exit(1); });
