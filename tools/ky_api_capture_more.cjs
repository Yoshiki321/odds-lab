/** ky_api_capture_more.cjs — 捕获滚球/注单/兑现接口模板并合并进凭据文件（值不回显）。 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const auth = require("./ky_api_auth.cjs");

const KEYS = [
  "getAllInPlayMatchListPB", "liveEventsPB", "getOrderListPB", "getPreBetOrderListPB",
  "queryCashOutMaxAmountListPB", "getMatchLimitInfoByMidsNewPB", "yewu12/user/amount",
  "getAllMatchesOddsPB", "structureTournamentMatchesPB",
];
const safe = (h) => {
  const o = {};
  for (const [k, v] of Object.entries(h)) {
    if (/^(host|content-length|accept-encoding|connection|origin|referer|user-agent|cookie)$/i.test(k) || /^sec-/i.test(k)) continue;
    o[k] = v;
  }
  return o;
};

(async () => {
  const b = await chromium.connectOverCDP("http://127.0.0.1:9333", { timeout: 15000 });
  const ctx = b.contexts()[0];
  const found = {};
  const attach = (p) => p.on("request", (r) => {
    const u = r.url();
    for (const k of KEYS) {
      if (found[k] || !u.includes(k)) continue;
      found[k] = { url: u, method: r.method(), headers: safe(r.headers()), post: r.postData() };
    }
  });
  ctx.pages().forEach(attach);
  ctx.on("page", attach);

  let home = ctx.pages()[0];
  for (let i = 0; i < 15; i++) { const l = await home.evaluate(() => (document.body.innerText || "").length).catch(() => 0); if (l > 1000) break; await home.waitForTimeout(800); }
  // 滚球
  await home.getByText("滚球赛事", { exact: true }).first().click({ timeout: 8000 }).catch(() => {});
  await home.waitForTimeout(6000);
  // 注单历史
  await home.evaluate(() => { const el = [...document.querySelectorAll("*")].find((e) => e.children.length === 0 && (e.textContent || "").trim() === "注单历史"); if (el) el.click(); }).catch(() => {});
  await home.waitForTimeout(6000);
  for (const p of ctx.pages()) {
    if (!p.url().includes("bet_record")) continue;
    for (const t of ["未结算注单", "已结算注单"]) { await p.getByText(t, { exact: false }).first().click({ timeout: 5000 }).catch(() => {}); await p.waitForTimeout(3500); }
  }

  const cred = auth.load() || { savedAt: null, approvedByUser: "2026-11-19", templates: {} };
  // 合并：把短名映射成统一键
  const ALIAS = { "yewu12/user/amount": "user/amount" };
  for (const [k, v] of Object.entries(found)) cred.templates[ALIAS[k] || k] = v;
  cred.savedAt = new Date().toISOString();
  fs.writeFileSync(auth.CRED, JSON.stringify(cred, null, 2), { mode: 0o600, encoding: "utf8" });

  console.log(JSON.stringify({ ok: true, captured: Object.keys(found), totalTemplates: Object.keys(cred.templates).length, note: "值未回显" }, null, 1));
  process.exit(0);
})().catch((e) => { console.error("ERR " + e.message); process.exit(1); });
