/** ky_live_probe2.cjs — 看滚球页里篮球/NBA 有哪些场次。 */
"use strict";
const { chromium } = require("playwright");
(async () => {
  const b = await chromium.connectOverCDP("http://127.0.0.1:9333", { timeout: 15000 });
  const home = b.contexts()[0].pages()[0];
  const txt = await home.evaluate(() => (document.body.innerText || "").slice(0, 60000));
  const has = (k) => txt.includes(k);
  const idx = txt.indexOf("篮球");
  console.log(JSON.stringify({
    len: txt.length,
    basketball: has("篮球"), nba: has("NBA"), lakersCn: has("湖人"), lakersEn: /Lakers/i.test(txt),
    aroundBasketball: idx >= 0 ? txt.slice(Math.max(0, idx - 100), idx + 400).replace(/\n/g, "|") : null,
    first500: txt.slice(0, 500).replace(/\n/g, "|"),
  }, null, 1));
  process.exit(0);
})().catch((e) => { console.error("ERR " + e.message); process.exit(1); });
