/** ky_league_scan3.cjs — 只读：热门赛事视图下点开指定联赛，抓场次+盘口。 */
"use strict";
const { chromium } = require("playwright");
(async () => {
  const want = process.argv[2] || "巴甲";
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9333", { timeout: 15000 });
  const ctx = browser.contexts()[0];
  const page = ctx.pages()[0];
  for (let i = 0; i < 20; i++) {
    const len = await page.evaluate(() => (document.body.innerText || "").length).catch(() => 0);
    if (len > 2000) break;
    await page.waitForTimeout(1000);
  }
  // 切热门赛事（全联赛视图）
  await page.evaluate(() => {
    const el = [...document.querySelectorAll(".menu-item")].find((e) => /热门赛事/.test(e.textContent || ""));
    if (el) el.click();
  });
  await page.waitForTimeout(3500);

  // 点目标联赛标签
  const h = await page.evaluateHandle((lab) => {
    return [...document.querySelectorAll("*")].find((e) => e.children.length === 0 && (e.textContent || "").trim() === lab) || null;
  }, want);
  const el = h.asElement();
  const clicked = !!el;
  if (el) await el.click({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(3000);

  const text = await page.evaluate(() => (document.body.innerText || "").slice(0, 70000));
  const lines = text.split("\n").map((s) => s.trim());
  const rows = [];
  for (let i = 0; i < lines.length; i++) {
    const dm = lines[i].match(/^(\d{1,2})月(\d{1,2})日$/);
    const tm = (lines[i + 1] || "").match(/^(\d{2}):(\d{2})\(GMT\+8\)$/);
    if (!dm || !tm) continue;
    const home = lines[i - 2], away = lines[i - 1];
    if (!home || !away || home.length > 20 || away.length > 20) continue;
    const seg = lines.slice(i + 2, i + 24).join("\n");
    const g = (re) => (seg.match(re) || [])[1] || null;
    rows.push({
      home, away, date: `${dm[1]}/${dm[2]}`, time: `${tm[1]}:${tm[2]}`,
      had: [g(/主胜\s*\n\s*(\d+\.\d{2})/), g(/平局\s*\n\s*(\d+\.\d{2})/), g(/客胜\s*\n\s*(\d+\.\d{2})/)],
    });
  }
  const adv = (text.match(/未开赛\s*\n\s*(\d+)/) || [])[1] || null;
  console.log(JSON.stringify({ league: want, clicked, advertised: adv, parsed: rows.length, rows }, null, 1));
  process.exit(0);
})().catch((e) => { console.error("ERR " + e.message); process.exit(1); });
