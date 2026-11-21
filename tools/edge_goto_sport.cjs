/** edge_goto_sport.cjs — 在同一标签打开 sport iframe 的地址（不打印 token），并读头部余额/未结。 */
"use strict";
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9333", { timeout: 15000 });
  const ctx = browser.contexts()[0];
  const page = ctx.pages()[0];

  const src = await page.evaluate(() => {
    const f = document.querySelector("iframe");
    return f ? f.src : null;
  });
  if (!src) { console.log(JSON.stringify({ ok: false, reason: "no iframe src" })); process.exit(0); }

  await page.goto(src, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(3000);

  const data = await page.evaluate(() => {
    const t = document.body.innerText || "";
    const i = t.indexOf("Hi,");
    const dyn = [...document.querySelectorAll(".dynamic-amount")].map((e) => e.textContent).join("");
    return {
      url: location.href.slice(0, 40),
      head: i >= 0 ? t.slice(i, i + 140).replace(/\n/g, "|") : "",
      textLen: t.length,
      dynAll: dyn,
    };
  });
  console.log(JSON.stringify({ ok: true, ...data }, null, 1));
  process.exit(0);
})().catch((e) => { console.error("ERR " + e.message); process.exit(1); });
