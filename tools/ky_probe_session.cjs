/**
 * ky_probe_session.cjs — 探测页面自身 API 是否有效，并用其请求头试调 getOriginalDataPB
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
  let respSample = null;
  page.on("request", (r) => {
    const u = r.url();
    if (!tpl.getMatchBaseInfoByOddsPB && u.includes("getMatchBaseInfoByOddsPB")) {
      tpl.getMatchBaseInfoByOddsPB = { url: u, method: r.method(), headers: safeHeaders(r.headers()), post: r.postData() };
    }
  });
  page.on("response", async (r) => {
    if (respSample || !r.url().includes("getMatchBaseInfoByOddsPB")) return;
    try { respSample = (await r.text()).slice(0, 160); } catch {}
  });
  await page.goto("https://www.w7spda.vip:6501/game/sport/ob?enName=YBTY", { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
  for (let i = 0; i < 30 && !tpl.getMatchBaseInfoByOddsPB; i++) {
    await page.waitForTimeout(1000);
    if (i === 5) {
      // 登录后体育页可能停在厂商大厅，需要点“进入游戏”才会加载赔率子应用
      try { await page.getByText("进入游戏", { exact: true }).first().click({ timeout: 3000 }); } catch {}
    }
    if (i === 6 || i === 12 || i === 18) {
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
  console.log("page_resp=" + String(respSample).replace(/\s+/g, " ").slice(0, 140));
  if (!tpl.getMatchBaseInfoByOddsPB) process.exit(1);

  const h = tpl.getMatchBaseInfoByOddsPB.headers;
  const url = "https://api.71vfi7l.com/yewu11/v2/m/getOriginalDataPB?t=" + Date.now();
  const raw = await new Promise((res, rej) => {
    https.get(url, { headers: h, rejectUnauthorized: false }, (r) => { let d = ""; r.on("data", (x) => d += x); r.on("end", () => res(d)); }).on("error", rej);
  });
  const j = JSON.parse(raw);
  console.log("derived_getOriginalDataPB_code=" + j.code);
  if (j.code === "0000000") {
    const d = unwrap(raw);
    tpl.getOriginalDataPB = { url, method: "GET", headers: h, post: null };
    console.log("matchsList=" + ((d && d.matchsList) || []).length);
    fs.mkdirSync(path.dirname(CRED), { recursive: true });
    fs.writeFileSync(CRED, JSON.stringify({ savedAt: new Date().toISOString(), templates: tpl }, null, 2), { mode: 0o600, encoding: "utf8" });
    console.log("saved_ok");
  }
  process.exit(0);
})().catch((e) => { console.error("ERR " + e.message.slice(0, 160)); process.exit(1); });
