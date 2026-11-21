/** edge_autotransfer_read.cjs — 只读：读取“自动转账”开关的可观察状态（不点击、不切换）。 */
"use strict";
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9333", { timeout: 15000 });
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => p.url().includes("finance/transfer")) || ctx.pages()[0];

  const out = await page.evaluate(() => {
    const label = [...document.querySelectorAll("p")].find((e) => (e.textContent || "").trim() === "自动转账");
    if (!label) return { found: false };
    const row = label.closest("div")?.parentElement;
    const sw = row ? row.querySelector("[class*=PKE9], [class*=piec3], [aria-checked], [class*=switch]") : null;
    const pick = (el) => el ? { tag: el.tagName, cls: (el.className || "").toString(), aria: el.getAttribute("aria-checked"), title: el.getAttribute("title") } : null;
    return { found: true, switchEl: pick(sw), rowHtml: row ? row.outerHTML.slice(0, 500) : null };
  });
  console.log(JSON.stringify(out, null, 1));
  process.exit(0);
})().catch((e) => { console.error("ERR " + e.message); process.exit(1); });
