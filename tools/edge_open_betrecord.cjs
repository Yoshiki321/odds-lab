/** edge_open_betrecord.cjs — 只读：点“注单历史”入口（打开新页），读未结订单与兑现报价。不下单、不点操作。 */
"use strict";
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9333", { timeout: 15000 });
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => p.url().includes("zqt0510")) || ctx.pages()[0];
  const before = ctx.pages().length;

  await page.evaluate(() => {
    const el = [...document.querySelectorAll("*")].find((e) => (e.textContent || "").trim() === "注单历史" && e.children.length === 0);
    if (el) el.click();
  });
  await page.waitForTimeout(3500);

  const pages = ctx.pages();
  const rec = pages.find((p) => p.url().includes("bet_record")) || pages[pages.length - 1];
  if (!rec) { console.log(JSON.stringify({ ok: false, reason: "未打开注单页", pages: pages.map((p) => p.url().slice(0, 60)) })); process.exit(0); }

  const t = await rec.evaluate(() => (document.body.innerText || "").slice(0, 1400));
  console.log(JSON.stringify({ ok: true, openedNew: pages.length > before, url: rec.url().slice(0, 60), text: t }, null, 1));
  process.exit(0);
})().catch((e) => { console.error("ERR " + e.message); process.exit(1); });
