/** ky_api_resultpage.cjs — 只读：专点“赛果”页，抓其请求。 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { chromium } = require("playwright");
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "data", "experiment_survival_100", "runtime", "api_result_page.json");

const dec = (t) => { try { const j = JSON.parse(t); if (typeof j.data === "string" && j.data.startsWith("H4sI")) return JSON.parse(zlib.gunzipSync(Buffer.from(j.data, "base64")).toString("utf8")); return j; } catch { return null; } };
const shp = (o, d) => { if (d <= 0) return typeof o; if (Array.isArray(o)) return { array: o.length, item: o.length ? shp(o[0], d - 1) : null }; if (o && typeof o === "object") { const r = {}; for (const k of Object.keys(o).slice(0, 12)) r[k] = shp(o[k], d - 1); return r; } return typeof o; };

(async () => {
  const b = await chromium.connectOverCDP("http://127.0.0.1:9333", { timeout: 15000 });
  const c = b.contexts()[0];
  const seen = new Map();
  const attach = (p) => p.on("response", async (res) => {
    const u = new URL(res.url()); const ep = u.pathname;
    if (!/yewu|site\/api/.test(ep)) return;
    const key = ep + "|" + res.request().method();
    const rec = { endpoint: ep, method: res.request().method(), queryKeys: [...u.searchParams.keys()], pageUrl: p.url().slice(0, 70) };
    try { const txt = await res.text(); const o = dec(txt); if (o) rec.shape = shp(o, 2); const rb = res.request().postData(); if (rb) { try { rec.requestFields = Object.keys(JSON.parse(rb)); } catch {} } } catch {}
    if (!seen.has(key)) seen.set(key, rec);
  });
  c.pages().forEach(attach); c.on("page", attach);

  let home = c.pages()[0];
  for (let i = 0; i < 15; i++) { const l = await home.evaluate(() => (document.body.innerText || "").length).catch(() => 0); if (l > 1000) break; await home.waitForTimeout(800); }
  // 直接找顶部导航的“赛果”并真实点击
  const found = await home.getByText("赛果", { exact: true }).count().catch(() => 0);
  if (found) await home.getByText("赛果", { exact: true }).first().click({ timeout: 8000 }).catch(() => {});
  await home.waitForTimeout(6000);
  // 尝试日期筛选
  for (const t of ["今天", "昨天", "7天内"]) { await home.getByText(t, { exact: true }).first().click({ timeout: 4000 }).catch(() => {}); await home.waitForTimeout(2500); }

  const out = { generatedAt: new Date().toISOString(), navCount: found, pages: c.pages().map((p) => p.url().slice(0, 80)), endpoints: [...seen.values()] };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2), "utf8");
  console.log(JSON.stringify({ found, pages: out.pages, endpoints: out.endpoints.map((e) => e.endpoint) }, null, 1));
  process.exit(0);
})().catch((e) => { console.error("ERR " + e.message); process.exit(1); });
