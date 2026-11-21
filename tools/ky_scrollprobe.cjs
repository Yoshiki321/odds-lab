/** ky_scrollprobe.cjs — 找列表滚动容器并尝试滚动，看解析条数是否增加。 */
"use strict";
const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9333", { timeout: 15000 });
  const ctx = browser.contexts()[0];
  const page = ctx.pages()[0];
  for (let i = 0; i < 20; i++) {
    const len = await page.evaluate(() => (document.body.innerText || "").length).catch(() => 0);
    if (len > 2000) break;
    await page.waitForTimeout(1000);
  }
  const cands = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll("div")) {
      const sh = el.scrollHeight, ch = el.clientHeight;
      if (sh > ch + 200 && ch > 300) {
        out.push({ cls: (el.className || "").toString().slice(0, 60), sh, ch, kids: el.children.length });
      }
    }
    return out.sort((a, b) => b.sh - a.sh).slice(0, 6);
  });
  // 尝试滚动最大的那个容器
  const res = await page.evaluate(() => {
    let best = null;
    for (const el of document.querySelectorAll("div")) {
      const sh = el.scrollHeight, ch = el.clientHeight;
      if (sh > ch + 200 && ch > 300 && (!best || sh - ch > best.sh - best.ch)) best = el;
    }
    if (!best) return { ok: false };
    const before = best.scrollTop;
    best.scrollTop = best.scrollTop + 3000;
    return { ok: true, before, after: best.scrollTop, sh: best.scrollHeight, ch: best.clientHeight };
  });
  await page.waitForTimeout(2000);
  const len2 = await page.evaluate(() => (document.body.innerText || "").length);
  console.log(JSON.stringify({ cands, scroll: res, textLen: len2 }, null, 1));
  process.exit(0);
})().catch((e) => { console.error("ERR " + e.message); process.exit(1); });
