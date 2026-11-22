/**
 * ky_capture_noreload.cjs — 不重载页面，从正在运行的已登录页面捕获请求头
 * 用法: node tools/ky_capture_noreload.cjs
 * 只在用户已登录且页面活跃时使用；不 reload、不提交任何表单。
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const CRED = path.join(ROOT, "data", "experiment_survival_100", "runtime", "api_credentials.json");
const CDP = "http://127.0.0.1:9333";
const TARGETS = ["getOriginalDataPB", "structureMatchBaseInfoByMidsPB", "getMatchBaseInfoByOddsPB", "countUnsettleTickets", "getOrderListPB"];

const safeHeaders = (h) => {
  const out = {};
  for (const [k, v] of Object.entries(h || {})) {
    if (/^(host|content-length|accept-encoding|connection|origin|referer|user-agent|cookie)$/i.test(k) || /^sec-/i.test(k)) continue;
    out[k] = v;
  }
  return out;
};

(async () => {
  const b = await chromium.connectOverCDP(CDP, { timeout: 30000 });
  const ctx = b.contexts()[0];
  const page = ctx.pages().find((p) => p.url().includes("w7spda") && p.url().includes("/game")) || ctx.pages()[0];
  console.log("page=" + page.url());
  const tpl = {};
  page.on("request", (r) => {
    const u = r.url();
    for (const k of TARGETS) {
      if (tpl[k] || !u.includes(k)) continue;
      tpl[k] = { url: u, method: r.method(), headers: safeHeaders(r.headers()), post: r.postData() };
    }
  });

  // 等待页面自然轮询；不足时点击一个安全的文本元素触发比赛详情
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(1000);
    if (tpl.getOriginalDataPB && tpl.getMatchBaseInfoByOddsPB) break;
    if (i === 5 || i === 12 || i === 20) {
      await page.evaluate(() => {
        const bad = /投注|下注|确认|提交|充值|提现|存款|取款|转账/;
        const cands = [...document.querySelectorAll("div,span,a,li,td")].filter((e) => {
          const t = (e.innerText || "").trim();
          return e.children.length === 0 && t.length > 1 && t.length < 20 && !bad.test(t) && /[\u4e00-\u9fa5]/.test(t);
        });
        const el = cands.find((e) => /老鹰|黄蜂|vs|主|客/.test(e.innerText)) || cands[0];
        if (el) el.click();
      }).catch(() => {});
    }
  }

  const keys = Object.keys(tpl);
  console.log("captured=" + JSON.stringify(keys));
  if (!tpl.getOriginalDataPB) { console.log(JSON.stringify({ ok: false, reason: "未捕获 getOriginalDataPB" })); process.exit(1); }
  fs.mkdirSync(path.dirname(CRED), { recursive: true });
  fs.writeFileSync(CRED, JSON.stringify({ savedAt: new Date().toISOString(), templates: tpl }, null, 2), { mode: 0o600, encoding: "utf8" });
  console.log(JSON.stringify({ ok: true, endpoints: keys }));
  process.exit(0);
})().catch((e) => { console.error("ERR " + e.message.slice(0, 160)); process.exit(1); });
