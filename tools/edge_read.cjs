/** edge_read.cjs — 只读：从 automation Edge 读投注页(sport iframe)头部余额/未结数。
 *  不做任何点击、不提交、不导航。 */
"use strict";
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9333", { timeout: 15000 });
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => p.url().includes("w7spda") || p.url().includes("kaiyun")) || ctx.pages()[0];
  const frames = page.frames().map((f) => f.url());
  const sport = page.frames().find((f) => f.url().includes("zqt0510"));
  const out = { mainUrl: page.url(), frames, sportFound: !!sport };
  if (sport) {
    out.sport = await sport.evaluate(() => {
      const t = document.body.innerText || "";
      const i = t.indexOf("Hi,");
      const head = i >= 0 ? t.slice(i, i + 120) : "";
      // 余额：动态数字容器
      const dyn = [...document.querySelectorAll(".dynamic-amount")];
      const enter = dyn.filter((e) => e.className.includes("enter")).map((e) => e.textContent).join("");
      const leave = dyn.filter((e) => e.className.includes("leave")).map((e) => e.textContent).join("");
      const all = dyn.map((e) => e.textContent).join("");
      const badge = [...document.querySelectorAll("*")]
        .filter((e) => e.children.length === 0 && /^\d{1,3}$/.test((e.textContent || "").trim()))
        .slice(0, 6)
        .map((e) => (e.className || "").toString().slice(0, 40) + "=" + e.textContent.trim());
      return { head, balanceEnter: enter, balanceLeave: leave, balanceAll: all, numericNodes: badge, textLen: t.length };
    });
  }
  console.log(JSON.stringify(out, null, 1));
  process.exit(0);
})().catch((e) => { console.error("ERR " + e.message); process.exit(1); });
