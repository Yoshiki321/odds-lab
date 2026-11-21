/** ky_nba_lakers.cjs — 点 NBA 菜单，找湖人场次与其盘口。 */
"use strict";
const { chromium } = require("playwright");
(async () => {
  const b = await chromium.connectOverCDP("http://127.0.0.1:9333", { timeout: 15000 });
  const home = b.contexts()[0].pages()[0];
  await home.getByText("NBA", { exact: true }).first().click({ timeout: 8000 }).catch(() => {});
  await home.waitForTimeout(6000);
  let txt = await home.evaluate(() => (document.body.innerText || "").slice(0, 60000));
  let idx = txt.indexOf("湖人");
  if (idx < 0) {
    // 尝试篮球大类
    await home.getByText("篮球", { exact: true }).first().click({ timeout: 6000 }).catch(() => {});
    await home.waitForTimeout(5000);
    txt = await home.evaluate(() => (document.body.innerText || "").slice(0, 60000));
    idx = txt.indexOf("湖人");
  }
  console.log(JSON.stringify({
    len: txt.length,
    hasLakers: idx >= 0,
    seg: idx >= 0 ? txt.slice(Math.max(0, idx - 400), idx + 700).replace(/\n/g, "|") : null,
    nbaSection: (() => { const i = txt.indexOf("NBA"); return i >= 0 ? txt.slice(i, i + 300).replace(/\n/g, "|") : null; })(),
  }, null, 1));
  process.exit(0);
})().catch((e) => { console.error("ERR " + e.message); process.exit(1); });
