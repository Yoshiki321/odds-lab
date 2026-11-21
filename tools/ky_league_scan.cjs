/** ky_league_scan.cjs — 只读：点开指定联赛标签，抓该联赛全部场次（默认巴甲）。用法: node tools/ky_league_scan.cjs 巴西甲 */
"use strict";
const { chromium } = require("playwright");
const ALIAS = { "巴西甲级联赛": "巴甲", "巴西甲": "巴甲", "巴甲": "巴西甲级联赛" };
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
  // 重新加载体育页，回到“全部联赛”状态（避免残留在某个联赛筛选里）
  const cur = page.url();
  if (cur.includes("zqt0510")) {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
  } else {
    await page.goto("https://www.w7spda.vip:6501/game/sport/ob?enName=YBTY", { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
  }
  for (let i = 0; i < 20; i++) {
    const len = await page.evaluate(() => (document.body.innerText || "").length).catch(() => 0);
    if (len > 2000) break;
    await page.waitForTimeout(1000);
  }
  // 走搜索框过滤联赛（比点联赛标签可靠）
  const box = page.getByPlaceholder("请输入联赛名或球队名").first();
  await box.click({ timeout: 8000 }).catch(() => {});
  await box.fill("", { timeout: 5000 }).catch(() => {});
  await box.type(want, { delay: 80 }).catch(() => {});
  await page.keyboard.press("Enter").catch(() => {});
  await page.waitForTimeout(3000);

  const text = await page.evaluate(() => (document.body.innerText || "").slice(0, 60000));
  const lines = text.split("\n").map((s) => s.trim());
  const rows = [];
  for (let i = 0; i < lines.length; i++) {
    const dm = lines[i].match(/^(\d{1,2})月(\d{1,2})日$/);
    const tm = (lines[i + 1] || "").match(/^(\d{2}):(\d{2})\(GMT\+8\)$/);
    if (!dm || !tm) continue;
    const home = lines[i - 2], away = lines[i - 1];
    if (!home || !away || home.length > 20 || away.length > 20) continue;
    const seg = lines.slice(i + 2, i + 22).join("\n");
    const h = (seg.match(/主胜\s*\n\s*(\d+\.\d{2})/) || [])[1];
    const d = (seg.match(/平局\s*\n\s*(\d+\.\d{2})/) || [])[1];
    const a = (seg.match(/客胜\s*\n\s*(\d+\.\d{2})/) || [])[1];
    rows.push({ home, away, date: `${dm[1]}/${dm[2]}`, time: `${tm[1]}:${tm[2]}`, had: [h, d, a] });
  }
  const adv = (text.match(/未开赛\s*\n\s*(\d+)/) || [])[1] || null;
  console.log(JSON.stringify({ clicked: true, league: want, advertised: adv, parsed: rows.length, rows }, null, 1));
  process.exit(0);
})().catch((e) => { console.error("ERR " + e.message); process.exit(1); });
