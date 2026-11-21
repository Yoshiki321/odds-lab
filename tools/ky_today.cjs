/** ky_today.cjs — 只读：扫“今日”场次并列出候选（分级+独赢赔率）。不下注。 */
"use strict";
const { chromium } = require("playwright");
const TIER1 = ["欧洲冠军联赛","欧冠","欧国联","欧联杯","英超","西甲","意甲","德甲","法甲"];
const TIER2 = ["英冠","德乙","西乙","葡超","荷甲","巴甲","美职","土超"];
const ALIAS = {"欧洲冠军联赛":"欧冠","欧足联欧洲联赛":"欧联杯","欧洲联赛":"欧联杯","欧洲国家联赛":"欧国联",
 "英格兰超级联赛":"英超","西班牙甲级联赛":"西甲","意大利甲级联赛":"意甲","德国甲级联赛":"德甲","法国甲级联赛":"法甲",
 "英格兰冠军联赛":"英冠","德国乙级联赛":"德乙","西班牙乙级联赛":"西乙","葡萄牙超级联赛":"葡超",
 "荷兰甲级联赛":"荷甲","巴西甲级联赛":"巴甲","美国职业大联盟":"美职","土耳其超级联赛":"土超"};
const norm = (l) => ALIAS[l] || Object.entries(ALIAS).find(([k]) => l && l.startsWith(k))?.[1] || l;
const tier = (l) => (TIER1.includes(norm(l)) ? 1 : TIER2.includes(norm(l)) ? 2 : 3);

(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9333", { timeout: 15000 });
  const ctx = browser.contexts()[0];
  const page = ctx.pages()[0];
  for (let i = 0; i < 20; i++) {
    const len = await page.evaluate(() => (document.body.innerText || "").length).catch(() => 0);
    if (len > 2000) break;
    await page.waitForTimeout(1000);
  }
  await page.getByText("今日", { exact: true }).first().click({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(3000);

  const text = await page.evaluate(() => (document.body.innerText || "").slice(0, 60000));
  const lines = text.split("\n").map((s) => s.trim());
  const rows = [];
  let league = "";
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l) continue;
    if (/联赛|杯|锦标|冠军|超级|甲级|乙级|联盟/.test(l) && l.length <= 14) league = l;
    const dm = l.match(/^(\d{1,2})月(\d{1,2})日$/);
    const tm = (lines[i + 1] || "").match(/^(\d{2}):(\d{2})\(GMT\+8\)$/);
    if (!dm || !tm) continue;
    const home = lines[i - 2], away = lines[i - 1];
    if (!home || !away || home.length > 20 || away.length > 20) continue;
    // 独赢赔率：其后不远处 主胜/客胜/平局
    const seg = lines.slice(i + 2, i + 20).join("\n");
    const h = (seg.match(/主胜\s*\n\s*(\d+\.\d{2})/) || [])[1];
    const a = (seg.match(/客胜\s*\n\s*(\d+\.\d{2})/) || [])[1];
    const d = (seg.match(/平局\s*\n\s*(\d+\.\d{2})/) || [])[1];
    const month = +dm[1], day = +dm[2], year = new Date().getUTCFullYear();
    let ms = Date.UTC(year, month - 1, day, +tm[1] - 8, +tm[2]);
    if (ms < Date.now() - 180 * 86400000) ms = Date.UTC(year + 1, month - 1, day, +tm[1] - 8, +tm[2]);
    rows.push({ league, tier: tier(league), home, away, kickoffMs: ms, kickoff: new Date(ms).toISOString(), h, d, a });
  }
  const seen = new Set();
  const uniq = rows.filter((r) => { const k = r.home + "|" + r.away + "|" + r.kickoffMs; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((x, y) => x.kickoffMs - y.kickoffMs);
  const now = Date.now();
  const upcoming = uniq.filter((r) => r.kickoffMs > now);
  console.log(JSON.stringify({ total: uniq.length, upcoming: upcoming.length, list: upcoming.slice(0, 25).map((r) => ({ tier: r.tier, league: norm(r.league), match: r.home + " vs " + r.away, kickoffBJ: r.kickoff, odds: { h: r.h, d: r.d, a: r.a } })) }, null, 1));
  process.exit(0);
})().catch((e) => { console.error("ERR " + e.message); process.exit(1); });
