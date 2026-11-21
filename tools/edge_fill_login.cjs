/** edge_fill_login.cjs — 仅在 automation Edge 的登录页填账号/密码，不提交验证码、不点短信、不落盘凭据。
 *  凭据从环境变量读取（不写入文件/日志）。 */
"use strict";
const { chromium } = require("playwright");

(async () => {
  const acc = process.env.KY_ACC;
  const pwd = process.env.KY_PWD;
  if (!acc || !pwd) { console.error("缺少 KY_ACC/KY_PWD 环境变量"); process.exit(2); }
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9333", { timeout: 15000 });
  const ctx = browser.contexts()[0] || (await browser.newContext());
  const page = ctx.pages()[0] || (await ctx.newPage());

  const result = await page.evaluate(({ a, p }) => {
    function setVal(el, v) {
      el.focus();
      const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      proto.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    const inputs = [...document.querySelectorAll("input")];
    const accEl = inputs.find((i) => (i.placeholder || "").includes("账号"));
    const pwdEl = inputs.find((i) => (i.placeholder || "").includes("密码"));
    if (!accEl || !pwdEl) return { ok: false, reason: "未找到账号/密码输入框", count: inputs.length };
    setVal(accEl, a);
    setVal(pwdEl, p);
    return { ok: true, accLen: accEl.value.length, pwdLen: pwdEl.value.length };
  }, { a: acc, p: pwd });

  console.log(JSON.stringify(result));
  process.exit(0);
})().catch((e) => { console.error("ERR " + e.message); process.exit(1); });
