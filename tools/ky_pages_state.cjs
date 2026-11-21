/** ky_pages_state.cjs — 列出所有页面及其状态（是否有内容/是否登录）。 */
"use strict";
const { chromium } = require("playwright");
(async () => {
  const b = await chromium.connectOverCDP("http://127.0.0.1:9333", { timeout: 15000 });
  const ctx = b.contexts()[0];
  const out = [];
  for (const p of ctx.pages()) {
    const st = await p.evaluate(() => ({ len: (document.body.innerText || "").length, hi: (document.body.innerText || "").includes("Hi,"), head: (document.body.innerText || "").slice(0, 60).replace(/\n/g, "|") })).catch(() => ({ err: true }));
    out.push({ url: p.url().slice(0, 70), ...st });
  }
  console.log(JSON.stringify(out, null, 1));
  process.exit(0);
})().catch((e) => { console.error("ERR " + e.message); process.exit(1); });
