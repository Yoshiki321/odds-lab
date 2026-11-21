/** edge_wallets.cjs — 只读：打开转账页，读各钱包余额。不做任何转账操作。 */
"use strict";
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9333", { timeout: 15000 });
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => p.url().includes("w7spda")) || ctx.pages()[0];

  await page.goto("https://www.w7spda.vip:6501/mine/finance/transfer", { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(4000);

  const out = await page.evaluate(() => {
    const t = document.body.innerText || "";
    const grab = (name) => {
      const re = new RegExp(name + "\\s*\\n?\\s*¥?\\s*\\n?\\s*([0-9]+\\.[0-9]{2})");
      const m = t.match(re);
      return m ? m[1] : null;
    };
    const centerIdx = t.indexOf("中心钱包");
    return {
      sport: grab("开云体育"),
      real: grab("开云真人"),
      chess: grab("开云棋牌"),
      center: centerIdx >= 0 ? t.slice(centerIdx, centerIdx + 60).replace(/\n/g, "|") : null,
      hasAuto: t.includes("自动转账"),
    };
  });
  console.log(JSON.stringify(out, null, 1));
  process.exit(0);
})().catch((e) => { console.error("ERR " + e.message); process.exit(1); });
