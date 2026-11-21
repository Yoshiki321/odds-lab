/** ky_cap_live.cjs — 点滚球赛事，打印该接口真实请求体（非敏感）。 */
"use strict";
const { chromium } = require("playwright");
(async () => {
  const b = await chromium.connectOverCDP("http://127.0.0.1:9333", { timeout: 15000 });
  const ctx = b.contexts()[0];
  let got = null;
  const attach = (p) => p.on("request", (r) => { if (!got && r.url().includes("getAllInPlayMatchListPB")) got = { url: r.url(), method: r.method(), post: r.postData() }; });
  ctx.pages().forEach(attach); ctx.on("page", attach);
  const home = ctx.pages().find((p) => p.url().includes("zqt0510/#/home")) || ctx.pages()[0];
  await home.bringToFront().catch(() => {});
  for (let i = 0; i < 15; i++) { const l = await home.evaluate(() => (document.body.innerText || "").length).catch(() => 0); if (l > 1000) break; await home.waitForTimeout(800); }
  const cnt = await home.getByText("滚球赛事", { exact: false }).count().catch(() => 0);
  if (cnt) await home.getByText("滚球赛事", { exact: false }).first().click({ timeout: 8000 }).catch(() => {});
  for (let i = 0; i < 10 && !got; i++) await home.waitForTimeout(1000);
  console.log(JSON.stringify({ clicked: cnt > 0, got: got ? { url: got.url.split("?")[0], method: got.method, post: got.post } : null }, null, 1));
  process.exit(0);
})().catch((e) => { console.error("ERR " + e.message); process.exit(1); });
