/** edge-cdp.cjs — 连 automation Edge(CDP 9333)，只读优先。
 *  用法: node tools/edge-cdp.cjs info|text|eval|goto [args]
 *  设计: 每步超时；结束直接退出进程（不断开也不等待），避免挂死。 */
"use strict";
const { chromium } = require("playwright");

const T = Number(process.env.TO || 15000);

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9333", { timeout: T });
  const ctx = browser.contexts()[0] || (await browser.newContext());
  let page = ctx.pages()[0] || (await ctx.newPage());

  if (cmd === "info") {
    const pages = ctx.pages().map((p) => p.url());
    console.log(JSON.stringify({ url: page.url(), pages }, null, 1));
  } else if (cmd === "text") {
    const len = Number(process.env.LEN || 800);
    const t = await page.evaluate((n) => (document.body ? document.body.innerText.slice(0, n) : ""), len).catch((e) => "EVAL_ERR " + e.message);
    console.log(t);
  } else if (cmd === "eval") {
    const expr = args.join(" ");
    const r = await page.evaluate((code) => {
      try { const v = new Function("return (" + code + ")")(); return typeof v === "string" ? v : JSON.stringify(v); }
      catch (e) { return "SCRIPT_ERR " + e.message; }
    }, expr).catch((e) => "EVAL_ERR " + e.message);
    console.log(String(r).slice(0, 6000));
  } else if (cmd === "goto") {
    await page.goto(args[0], { waitUntil: "domcontentloaded", timeout: T });
    console.log("OK " + page.url());
  } else {
    console.error("cmd: info|text|eval|goto");
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error("ERR " + e.message); process.exit(1); });
