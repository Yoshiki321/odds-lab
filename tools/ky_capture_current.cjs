/**
 * ky_capture_current.cjs — 在已加载体育子应用里搜索比赛并抓取凭据（不刷新/不重新进入）
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
  const onReq = (r) => {
    const u = r.url();
    if (!tpl.getMatchBaseInfoByOddsPB && u.includes("getMatchBaseInfoByOddsPB")) tpl.getMatchBaseInfoByOddsPB = { url: u, method: r.method(), headers: safeHeaders(r.headers()), post: r.postData() };
    if (!tpl.structureMatchBaseInfoByMidsPB && u.includes("structureMatchBaseInfoByMidsPB")) tpl.structureMatchBaseInfoByMidsPB = { url: u, method: r.method(), headers: safeHeaders(r.headers()), post: r.postData() };
  };
  page.on("request", onReq);
  for (const f of page.frames()) f.on("request", onReq);

  const frame = page.frames().find((f) => f !== page.mainFrame());
  if (!frame) { console.log("no_iframe"); process.exit(1); }
  // 关闭安全提示（如仍在）
  for (const f of page.frames()) {
    try { await f.getByText("我已了解", { exact: true }).first().click({ timeout: 1500 }); } catch {}
  }
  try {
    const input = frame.locator('input[placeholder="请输入联赛名或球队名"]').first();
    await input.fill("圣何塞", { timeout: 5000 });
    await input.press("Enter");
    console.log("searched");
  } catch (e) { console.log("search_err " + e.message.slice(0, 80)); }

  for (let i = 0; i < 25 && !tpl.getMatchBaseInfoByOddsPB; i++) {
    await frame.waitForTimeout(1000);
    if (i === 6 || i === 12) {
      try {
        const el = frame.locator("div,span,a,li,td").filter({ hasText: /圣何塞|琉球|熊本/ }).first();
        await el.click({ timeout: 2000 });
      } catch {}
    }
  }
  console.log("captured_odds=" + !!tpl.getMatchBaseInfoByOddsPB);
  if (!tpl.getMatchBaseInfoByOddsPB) process.exit(2);

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
  } else process.exit(3);
  process.exit(0);
})().catch((e) => { console.error("ERR " + e.message.slice(0, 160)); process.exit(1); });
