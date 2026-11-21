/** ky_probe.cjs — 探测：点早盘并把比赛区文本抽样出来（只读，不下单）。 */
"use strict";
const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9333", { timeout: 15000 });
  const ctx = browser.contexts()[0];
  const page = ctx.pages()[0];
  // 等渲染
  for (let i = 0; i < 20; i++) {
    const len = await page.evaluate(() => (document.body.innerText || "").length).catch(() => 0);
    if (len > 2000) break;
    await page.waitForTimeout(1000);
  }
  await page.getByText("早盘", { exact: true }).first().click({ timeout: 8000 }).catch((e) => console.error("CLICK_ERR " + e.message));
  await page.waitForTimeout(3000);
  const out = await page.evaluate(() => {
    const t = document.body.innerText || "";
    const idx = t.indexOf("所有日期");
    const idx2 = t.indexOf("未开赛");
    return { len: t.length, hasDate: idx >= 0, seg: t.slice(Math.max(0, idx2 - 200), idx2 + 700) };
  });
  console.log(JSON.stringify(out, null, 1));
  process.exit(0);
})().catch((e) => { console.error("ERR " + e.message); process.exit(1); });
