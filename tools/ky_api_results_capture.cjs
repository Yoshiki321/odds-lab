/** ky_api_results_capture.cjs — 专抓“赛果/注单历史/钱包”新页接口（监听所有页面）。 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "data", "experiment_survival_100", "runtime", "api_results_capture.json");

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
  if (o && typeof o === "object") { const r = {}; for (const k of Object.keys(o).slice(0, 12)) r[k] = shape(o[k], d - 1); return { type: "object", keys: r }; }
  return typeof o;
}

(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9333", { timeout: 15000 });
  const ctx = browser.contexts()[0];
  const seen = new Map();
  const tag = [{ v: "init" }];

  const attach = (p) => {
    p.on("response", async (res) => {
      const u = new URL(res.url());
      const ep = u.pathname.replace(/\/[0-9a-f]{16,}/g, "/{id}");
      if (!/yewu|site\/api/.test(ep)) return;
      const key = ep + "|" + res.request().method();
      const rec = { endpoint: ep, method: res.request().method(), status: res.status(), queryKeys: [...u.searchParams.keys()], page: p.url().slice(0, 60), view: tag[0].v };
      try {
        const txt = await res.text();
        const d = decode(txt);
        rec.encoding = d.enc; rec.bytes = d.bytes;
        if (d.obj) rec.shape = shape(d.obj, 2);
        const rb = res.request().postData();
        if (rb) { try { rec.requestFields = Object.keys(JSON.parse(rb)); } catch {} }
      } catch (e) { rec.error = e.message; }
      const old = seen.get(key);
      if (!old || (rec.bytes || 0) > (old.bytes || 0)) seen.set(key, rec);
    });
  };
  ctx.pages().forEach(attach);
  ctx.on("page", (p) => attach(p));

  const home = ctx.pages()[0];
  for (let i = 0; i < 20; i++) {
    const len = await home.evaluate(() => (document.body.innerText || "").length).catch(() => 0);
    if (len > 2000) break;
    await home.waitForTimeout(1000);
  }

  // 赛果
  tag[0].v = "赛果";
  await home.getByText("赛果", { exact: true }).first().click({ timeout: 8000 }).catch(() => {});
  await home.waitForTimeout(5000);
  for (const t of ["足球", "今天", "7天内"]) {
    await home.getByText(t, { exact: true }).first().click({ timeout: 5000 }).catch(() => {});
    await home.waitForTimeout(2500);
  }
  // 注单历史
  tag[0].v = "注单历史";
  await home.evaluate(() => { const el = [...document.querySelectorAll("*")].find((e) => e.children.length === 0 && (e.textContent || "").trim() === "注单历史"); if (el) el.click(); }).catch(() => {});
  await home.waitForTimeout(6000);
  for (const p of ctx.pages()) {
    if (!p.url().includes("bet_record")) continue;
    for (const t of ["未结算注单", "已结算注单", "预约注单"]) {
      await p.getByText(t, { exact: false }).first().click({ timeout: 5000 }).catch(() => {});
      await p.waitForTimeout(3000);
    }
    // 查询按钮
    await p.getByText("查询", { exact: true }).first().click({ timeout: 5000 }).catch(() => {});
    await p.waitForTimeout(4000);
  }
  // 钱包/转账
  tag[0].v = "钱包";
  const main = ctx.pages().find((p) => p.url().includes("w7spda")) || home;
  await main.goto("https://www.w7spda.vip:6501/mine/finance/transfer", { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
  await main.waitForTimeout(6000);

  const out = { generatedAt: new Date().toISOString(), endpoints: [...seen.values()].sort((a, b) => a.endpoint.localeCompare(b.endpoint)) };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2), "utf8");
  console.log(JSON.stringify({ out: path.relative(ROOT, OUT), count: out.endpoints.length, endpoints: out.endpoints.map((e) => e.endpoint + " [" + e.view + "]") }, null, 1));
  process.exit(0);
})().catch((e) => { console.error("ERR " + e.message); process.exit(1); });
