/** ky_chipscan.cjs — 只读：逐个联赛标签点开并统计（验证可行性）。用法: node tools/ky_chipscan.cjs 英超 西甲 巴甲 葡超 */
"use strict";
const { chromium } = require("playwright");
(async () => {
  const names = process.argv.slice(2).length ? process.argv.slice(2) : ["英超", "西甲", "德甲", "意甲", "法甲", "巴甲", "葡超"];
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9333", { timeout: 15000 });
  const ctx = browser.contexts()[0];
  const page = ctx.pages()[0];
  for (let i = 0; i < 20; i++) {
    const len = await page.evaluate(() => (document.body.innerText || "").length).catch(() => 0);
    if (len > 2000) break;
    await page.waitForTimeout(1000);
  }
  await page.evaluate(() => {
    const el = [...document.querySelectorAll(".menu-item")].find((e) => /热门赛事/.test(e.textContent || ""));
    if (el) el.click();
  });
  await page.waitForTimeout(3000);

  const results = [];
  for (const want of names) {
    const h = await page.evaluateHandle((lab) => [...document.querySelectorAll("*")].find((e) => e.children.length === 0 && (e.textContent || "").trim() === lab) || null, want);
    const el = h.asElement();
    if (!el) { results.push({ want, clicked: false, reason: "标签不存在" }); continue; }
    const ok = await el.click({ timeout: 5000 }).then(() => true).catch(() => false);
    if (!ok) { results.push({ want, clicked: false, reason: "点击失败" }); continue; }
    await page.waitForTimeout(2500);
    const text = await page.evaluate(() => (document.body.innerText || "").slice(0, 60000));
    const adv = (text.match(/未开赛\s*\n\s*(\d+)/) || [])[1] || null;
    const times = [...text.matchAll(/(\d{2}:\d{2})\(GMT\+8\)/g)].length;
    results.push({ want, clicked: true, advertised: adv, timeTokens: times });
  }
  console.log(JSON.stringify(results, null, 1));
  process.exit(0);
})().catch((e) => { console.error("ERR " + e.message); process.exit(1); });
