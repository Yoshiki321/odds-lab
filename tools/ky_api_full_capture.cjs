/**
 * ky_api_full_capture.cjs — 全视图接口抓取（只读）
 * 覆盖：体育首页/早盘/今日/滚球/赛果/注单历史/详情/钱包转账/帮助
 * 输出：runtime/api_catalog_full.json（所有 api 域名请求的路径+方法+状态+编码+结构）
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "data", "experiment_survival_100", "runtime", "api_catalog_full.json");
const CDP = "http://127.0.0.1:9333";
const API_HOST = /api\.(71vfi7l|togav85|[a-z0-9]+)\.com|w7spda\.vip/;

function decode(txt) {
  try {
    const j = JSON.parse(txt);
    if (typeof j.data === "string" && j.data.startsWith("H4sI")) {
      const raw = zlib.gunzipSync(Buffer.from(j.data, "base64")).toString("utf8");
      try { return { enc: "base64+gzip+json", obj: JSON.parse(raw), bytes: raw.length }; }
      catch { return { enc: "base64+gzip(raw)", obj: null, bytes: raw.length }; }
    }
    return { enc: "plain-json", obj: j, bytes: txt.length };
  } catch { return { enc: "other", obj: null, bytes: txt.length }; }
}

function shape(o, d) {
  if (d <= 0) return typeof o;
  if (Array.isArray(o)) return { type: "array", len: o.length, item: o.length ? shape(o[0], d - 1) : null };
  if (o && typeof o === "object") {
    const r = {};
    for (const k of Object.keys(o).slice(0, 12)) r[k] = shape(o[k], d - 1);
    return { type: "object", keys: r };
  }
  return typeof o;
}

(async () => {
  const browser = await chromium.connectOverCDP(CDP, { timeout: 15000 });
  const ctx = browser.contexts()[0];
  const page = ctx.pages()[0] || (await ctx.newPage());
  const seen = new Map();
  const actions = [];

  page.on("response", async (res) => {
    const url = res.url();
    if (!API_HOST.test(url)) return;
    const u = new URL(url);
    const ep = u.pathname.replace(/\/[0-9a-f]{16,}/g, "/{id}");
    const key = ep + "|" + res.request().method();
    const rec = {
      endpoint: ep, method: res.request().method(), status: res.status(),
      queryKeys: [...u.searchParams.keys()],
      contentType: (res.headers()["content-type"] || "").slice(0, 40),
      observedAt: new Date().toISOString(), action: actions[actions.length - 1] || "initial",
    };
    try {
      const txt = await res.text();
      const d = decode(txt);
      rec.encoding = d.enc; rec.decodedBytes = d.bytes;
      if (d.obj) rec.shape = shape(d.obj, 2);
      const rb = res.request().postData();
      if (rb) { try { rec.requestFields = Object.keys(JSON.parse(rb)); } catch { rec.requestFields = ["<non-json>"]; } }
    } catch (e) { rec.error = e.message; }
    const old = seen.get(key);
    if (!old || (rec.decodedBytes || 0) > (old.decodedBytes || 0)) seen.set(key, rec);
  });

  const clickText = async (t, label) => {
    actions.push(label);
    await page.getByText(t, { exact: true }).first().click({ timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(2500);
  };

  // 进体育页
  actions.push("open-sport");
  await page.goto("https://www.w7spda.vip:6501/game/sport/ob?enName=YBTY", { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(6000);
  const src = await page.evaluate(() => { const f = document.querySelector("iframe"); return f ? f.src : null; }).catch(() => null);
  if (src) { await page.goto(src, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {}); await page.waitForTimeout(6000); }

  await clickText("早盘", "tab-早盘");
  await clickText("今日", "tab-今日");
  await clickText("滚球赛事", "menu-滚球赛事");
  await page.waitForTimeout(4000);
  await clickText("赛果", "link-赛果");
  await page.waitForTimeout(4000);
  // 赛果页的筛选
  for (const t of ["足球", "今天", "7天内"]) await clickText(t, "filter-" + t);
  // 注单历史（可能开新页）
  actions.push("link-注单历史");
  await page.evaluate(() => { const el = [...document.querySelectorAll("*")].find((e) => e.children.length === 0 && (e.textContent || "").trim() === "注单历史"); if (el) el.click(); }).catch(() => {});
  await page.waitForTimeout(4000);
  const pages = ctx.pages();
  const recPage = pages.find((p) => p.url().includes("bet_record"));
  if (recPage) {
    await recPage.getByText("未结算注单", { exact: false }).first().click({ timeout: 5000 }).catch(() => {});
    await recPage.waitForTimeout(3000);
    await recPage.getByText("已结算注单", { exact: false }).first().click({ timeout: 5000 }).catch(() => {});
    await recPage.waitForTimeout(3000);
  }
  // 详情：回首页点一场
  const home = pages.find((p) => p.url().includes("zqt0510")) || page;
  await home.goto("https://user-pc-new.zqt0510.com/#/home", { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
  await home.waitForTimeout(3500);
  await home.evaluate(() => { const el = [...document.querySelectorAll("*")].find((e) => e.children.length === 0 && /曼城/.test(e.textContent || "")); if (el) el.click(); }).catch(() => {});
  await home.waitForTimeout(4000);
  for (const t of ["数据", "盘面"]) await home.getByText(t, { exact: true }).first().click({ timeout: 5000 }).catch(() => {}).catch(() => {});

  const catalog = {
    generatedAt: new Date().toISOString(),
    note: "仅本会话捕获；未触发的页面/操作对应接口不在表内",
    endpoints: [...seen.values()].sort((a, b) => a.endpoint.localeCompare(b.endpoint)),
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(catalog, null, 2), "utf8");
  console.log(JSON.stringify({ out: path.relative(ROOT, OUT), count: catalog.endpoints.length, endpoints: catalog.endpoints.map((e) => e.endpoint) }, null, 1));
  process.exit(0);
})().catch((e) => { console.error("ERR " + e.message); process.exit(1); });
