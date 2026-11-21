/** ky_domprobe.cjs — 探测联赛筛选区结构（只读）。 */
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
  const out = await page.evaluate(() => {
    const res = { hits: [], breadcrumbs: [], clickableLeagues: [] };
    // 找包含“五大联赛”的最深元素
    let target = null;
    for (const el of document.querySelectorAll("*")) {
      if (el.children.length === 0 && (el.textContent || "").trim() === "五大联赛") { target = el; break; }
    }
    if (target) {
      let p = target;
      const chain = [];
      for (let i = 0; i < 5 && p; i++) {
        chain.push({ tag: p.tagName, cls: (p.className || "").toString().slice(0, 70), kids: p.children.length, txt: (p.textContent || "").trim().slice(0, 60) });
        p = p.parentElement;
      }
      res.hits = chain;
      // 同级兄弟（可能是其它联赛标签）
      const parent = target.parentElement;
      if (parent) res.breadcrumbs = [...parent.children].slice(0, 30).map((c) => (c.textContent || "").trim().slice(0, 24));
    }
    // 找所有“带数字”的小标签
    for (const el of document.querySelectorAll("*")) {
      if (el.children.length === 0) {
        const t = (el.textContent || "").trim();
        if (/^[\u4e00-\u9fa5A-Za-z·\-\s]{2,14}$/.test(t)) {
          const sib = el.nextElementSibling;
          const n = sib ? (sib.textContent || "").trim() : "";
          if (/^\d{1,4}$/.test(n)) res.clickableLeagues.push({ name: t, count: n, cls: (el.className || "").toString().slice(0, 40) });
        }
      }
    }
    res.clickableLeagues = res.clickableLeagues.slice(0, 40);
    return res;
  });
  console.log(JSON.stringify(out, null, 1));
  process.exit(0);
})().catch((e) => { console.error("ERR " + e.message); process.exit(1); });
