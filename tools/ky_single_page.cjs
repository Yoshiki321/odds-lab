/** ky_single_page.cjs — 收敛为单页：保留投注APP首页，关闭其它。 */
"use strict";
const { chromium } = require("playwright");
(async () => {
  const b = await chromium.connectOverCDP("http://127.0.0.1:9333", { timeout: 15000 });
  const ctx = b.contexts()[0];
  const pages = ctx.pages();
  const keep = pages.find((p) => p.url().includes("zqt0510/#/home")) || pages.find((p) => p.url().includes("zqt0510")) || pages[0];
  const closed = [];
  for (const p of pages) {
    if (p === keep) continue;
    try { closed.push(p.url().slice(0, 50)); await p.close(); } catch {}
  }
  console.log(JSON.stringify({ kept: keep.url().slice(0, 60), closed, remaining: ctx.pages().length }, null, 1));
  process.exit(0);
})().catch((e) => { console.error("ERR " + e.message); process.exit(1); });
