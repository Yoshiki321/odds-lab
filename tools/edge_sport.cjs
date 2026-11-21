/** edge_sport.cjs — 只读：等 sport iframe 就绪后读余额/未结。不点击、不提交。 */
"use strict";
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9333", { timeout: 15000 });
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => p.url().includes("game/sport")) || ctx.pages()[0];

  // 等 sport frame 出现并可用
  let sport = null;
  for (let i = 0; i < 20 && !sport; i++) {
    sport = page.frames().find((f) => f.url().includes("zqt0510"));
    if (!sport) await page.waitForTimeout(1000);
  }
  if (!sport) {
    console.log(JSON.stringify({ ok: false, reason: "sport frame 未就绪", frames: page.frames().map((f) => f.url().slice(0, 80)) }));
    process.exit(0);
  }
  await sport.waitForLoadState("domcontentloaded", { timeout: 20000 }).catch(() => {});

  const data = await sport.evaluate(() => {
    const t = document.body.innerText || "";
    const i = t.indexOf("Hi,");
    const head = i >= 0 ? t.slice(i, i + 140).replace(/\n/g, "|") : "";
    const dyn = [...document.querySelectorAll(".dynamic-amount")];
    return {
      head,
      textLen: t.length,
      dynAll: dyn.map((e) => e.textContent).join(""),
      hasSlip: t.includes("最高可赢"),
    };
  });
  console.log(JSON.stringify({ ok: true, ...data }, null, 1));
  process.exit(0);
})().catch((e) => { console.error("ERR " + e.message); process.exit(1); });
