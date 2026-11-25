/**
 * ky_manual_capture.cjs — 手动/一次性抓取：大厅点“进入游戏”→ 等赔率请求 → 推导 getOriginalDataPB
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");
const zlib = require("node:zlib");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const CRED = path.join(ROOT, "data", "experiment_survival_100", "runtime", "api_credentials.json");
const safeHeaders = (h) => {
  const out = {};
  for (const [k, v] of Object.entries(h || {})) {
    if (/^(host|content-length|accept-encoding|connection|origin|referer|user-agent|cookie)$/i.test(k) || /^sec-/i.test(k)) continue;
    out[k] = v;
  }
  return out;
};
const unwrap = (x) => {
  const j = JSON.parse(x);
  if (typeof j.data === "string" && j.data.startsWith("H4sI")) return JSON.parse(zlib.gunzipSync(Buffer.from(j.data, "base64")).toString("utf8"));
  return j;
};

(async () => {
  const b = await chromium.connectOverCDP("http://127.0.0.1:9333", { timeout: 20000 });
  const ctx = b.contexts()[0];
  const page = ctx.pages().find((p) => p.url().includes("w7spda")) || ctx.pages()[0];
  const tpl = {};
  page.on("request", (r) => {
    const u = r.url();
    if (!tpl.getMatchBaseInfoByOddsPB && u.includes("getMatchBaseInfoByOddsPB")) tpl.getMatchBaseInfoByOddsPB = { url: u, method: r.method(), headers: safeHeaders(r.headers()), post: r.postData() };
    if (!tpl.structureMatchBaseInfoByMidsPB && u.includes("structureMatchBaseInfoByMidsPB")) tpl.structureMatchBaseInfoByMidsPB = { url: u, method: r.method(), headers: safeHeaders(r.headers()), post: r.postData() };
  });

  await page.goto("https://www.w7spda.vip:6501/game/sport", { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(3000);
  try { await page.getByText("进入游戏", { exact: true }).first().click({ timeout: 5000 }); console.log("clicked_enter"); } catch { console.log("no_enter_btn"); }
  await page.waitForTimeout(1500);
  try { await page.getByText("我已了解", { exact: true }).first().click({ timeout: 3000 }); console.log("dismissed_notice"); } catch {}

  for (let i = 0; i < 30 && !tpl.getMatchBaseInfoByOddsPB; i++) {
    await page.waitForTimeout(1000);
    if (i === 2) { try { await page.getByText("我已了解", { exact: true }).first().click({ timeout: 2000 }); } catch {} }
    if (i === 8 || i === 15) {
      await page.evaluate(() => {
        const bad = /投注|下注|确认|提交|充值|提现|存款|取款|转账/;
        const cands = [...document.querySelectorAll("div,span,a,li,td")].filter((e) => {
          const t = (e.innerText || "").trim();
          return e.children.length === 0 && t.length > 1 && t.length < 20 && !bad.test(t) && /[\u4e00-\u9fa5]/.test(t);
        });
        const el = cands.find((e) => /vs|主|客|让|大小/.test(e.innerText)) || cands[0];
        if (el) el.click();
      }).catch(() => {});
    }
  }
  console.log("captured_odds=" + !!tpl.getMatchBaseInfoByOddsPB);
  if (!tpl.getMatchBaseInfoByOddsPB) { console.log(JSON.stringify({ ok: false, reason: "未捕获赔率请求" })); process.exit(1); }

  const h = tpl.getMatchBaseInfoByOddsPB.headers;
  const url = "https://api.71vfi7l.com/yewu11/v2/m/getOriginalDataPB?t=" + Date.now();
  const raw = await new Promise((res, rej) => {
    https.get(url, { headers: h, rejectUnauthorized: false }, (r) => { let d = ""; r.on("data", (x) => d += x); r.on("end", () => res(d)); }).on("error", rej);
  });
  const j = JSON.parse(raw);
  console.log("derived_code=" + j.code);
  if (j.code === "0000000") {
    const d = unwrap(raw);
    console.log("matchsList=" + ((d && d.matchsList) || []).length);
    tpl.getOriginalDataPB = { url, method: "GET", headers: h, post: null };
    fs.mkdirSync(path.dirname(CRED), { recursive: true });
    fs.writeFileSync(CRED, JSON.stringify({ savedAt: new Date().toISOString(), templates: tpl }, null, 2), { mode: 0o600, encoding: "utf8" });
    console.log("saved_ok");
  } else {
    process.exit(2);
  }
  process.exit(0);
})().catch((e) => { console.error("ERR " + e.message.slice(0, 160)); process.exit(1); });
