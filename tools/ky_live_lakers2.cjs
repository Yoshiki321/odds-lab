/** ky_live_lakers2.cjs — 收敛单页 → 点滚球 → 找湖人场次与盘口文本。 */
"use strict";
const { chromium } = require("playwright");
(async () => {
  const b = await chromium.connectOverCDP("http://127.0.0.1:9333", { timeout: 15000 });
  const ctx = b.contexts()[0];
  const pages = ctx.pages();
  const home = pages.find((p) => p.url().includes("zqt0510/#/home")) || pages[pages.length - 1];
  // 单页铁律：关掉其它页
  for (const p of pages) { if (p !== home) { try { await p.close(); } catch {} } }
  for (let i = 0; i < 15; i++) { const l = await home.evaluate(() => (document.body.innerText || "").length).catch(() => 0); if (l > 1000) break; await home.waitForTimeout(800); }

  // 找滚球菜单项（可能叫“滚球赛事”或“现场滚球盘”）
  const candidates = ["滚球赛事", "滚球", "现场滚球盘", "LIVE"];
  let clicked = null;
  for (const c of candidates) {
    const n = await home.getByText(c, { exact: false }).count().catch(() => 0);
    if (n) { await home.getByText(c, { exact: false }).first().click({ timeout: 6000 }).catch(() => {}); clicked = c; break; }
  }
  await home.waitForTimeout(6000);

  const txt = await home.evaluate(() => (document.body.innerText || "").slice(0, 60000));
  const idx = txt.indexOf("湖人");
  const seg = idx >= 0 ? txt.slice(Math.max(0, idx - 300), idx + 500) : null;
  console.log(JSON.stringify({ clicked, len: txt.length, hasLakers: idx >= 0, seg }, null, 1));
  process.exit(0);
})().catch((e) => { console.error("ERR " + e.message); process.exit(1); });
