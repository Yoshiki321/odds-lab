/** ky_league_scan2.cjs — 只读：回到“全部联赛”再点目标联赛，抓其场次。用法: node tools/ky_league_scan2.cjs 巴甲 */
"use strict";
const { chromium } = require("playwright");

async function chipClick(page, label) {
  const handle = await page.evaluateHandle((lab) => {
    const els = [...document.querySelectorAll("*")].filter((e) => e.children.length === 0 && (e.textContent || "").trim() === lab);
    // 优先取 y 在 100~260 区间的（联赛筛选条）
    let best = null;
    for (const e of els) {
      const r = e.getBoundingClientRect();
      if (r.width > 0 && r.y > 100 && r.y < 280) { best = e; break; }
    }
    return best || els[0] || null;
  }, label);
  const el = handle.asElement();
  if (!el) return false;
  await el.click({ timeout: 8000 }).catch(() => {});
  return true;
}

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
  const backOk = await chipClick(page, "全部");
  await page.waitForTimeout(2500);
  const chips = await page.evaluate(() => [...document.querySelectorAll("*")].filter((e) => e.children.length === 0).map((e) => (e.textContent || "").trim()).filter((t) => /^(欧冠|欧联杯|五大联赛|英超|西甲|意甲|德甲|法甲|巴甲|葡超|荷甲|土超|墨超|美职联|日职J1联)$/.test(t)));
  const ok = await chipClick(page, want);
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
    const g = (re) => (seg.match(re) || [])[1] || null;
    rows.push({
      home, away, date: `${dm[1]}/${dm[2]}`, time: `${tm[1]}:${tm[2]}`,
      had: [g(/主胜\s*\n\s*(\d+\.\d{2})/), g(/平局\s*\n\s*(\d+\.\d{2})/), g(/客胜\s*\n\s*(\d+\.\d{2})/)],
    });
  }
  const adv = (text.match(/未开赛\s*\n\s*(\d+)/) || [])[1] || null;
  console.log(JSON.stringify({ backClicked: backOk, chipsVisible: chips, leagueClicked: ok, league: want, advertised: adv, parsed: rows.length, rows }, null, 1));
  process.exit(0);
})().catch((e) => { console.error("ERR " + e.message); process.exit(1); });
