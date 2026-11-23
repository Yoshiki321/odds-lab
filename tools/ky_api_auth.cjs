/**
 * ky_api_auth.cjs — 会话凭据持久化（用户 2026-11-19 明确批准修改原“令牌不落盘”规则）
 * - 只在用户授权时保存；文件路径固定、权限收紧到当前用户
 * - 任何输出/日志都不回显值，只回显字段名与保存时间
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
let chromium = null; try { chromium = require("playwright").chromium; } catch {}

const ROOT = path.resolve(__dirname, "..");
const CRED = path.join(ROOT, "data", "experiment_survival_100", "runtime", "api_credentials.json");
const CDP = "http://127.0.0.1:9333";
const ENDPOINTS = ["getOriginalDataPB", "structureMatchBaseInfoByMidsPB", "getMatchBaseInfoByOddsPB", "countUnsettleTickets", "betOrder/betPB"];

const safeHeaders = (h) => {
  const out = {};
  for (const [k, v] of Object.entries(h)) {
    if (/^(host|content-length|accept-encoding|connection|origin|referer|user-agent|cookie)$/i.test(k) || /^sec-/i.test(k)) continue;
    out[k] = v;
  }
  return out;
};

function save(obj) {
  fs.mkdirSync(path.dirname(CRED), { recursive: true });
  fs.writeFileSync(CRED, JSON.stringify(obj, null, 2), { mode: 0o600, encoding: "utf8" });
  return CRED;
}
function load() {
  try { return JSON.parse(fs.readFileSync(CRED, "utf8")); } catch { return null; }
}
function loaded() { return fs.existsSync(CRED); }

/** 从当前页面请求捕获凭据模板（值不回显） */
async function captureFromPage() {
  const browser = await chromium.connectOverCDP(CDP, { timeout: 15000 });
  const ctx = browser.contexts()[0];
  const page = ctx.pages()[0];
  const tpl = {};
  page.on("request", (r) => {
    const u = r.url();
    for (const k of ENDPOINTS) {
      if (tpl[k] || !u.includes(k)) continue;
      tpl[k] = { url: u, method: r.method(), headers: safeHeaders(r.headers()), post: r.postData() };
    }
  });
  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
  const deadline = Date.now() + 40000;
  while (Object.keys(tpl).length < 3 && Date.now() < deadline) {
    await page.waitForTimeout(1000);
    if (!tpl.getMatchBaseInfoByOddsPB) {
      await page.evaluate(() => {
        const el = [...document.querySelectorAll("*")].find((e) => e.children.length === 0 && e.textContent && e.textContent.trim().length > 1 && /^[一-龥A-Za-z0-9]{2,12}$/.test(e.textContent.trim()));
        if (el) el.click();
      }).catch(() => {});
    }
  }
  return tpl;
}

if (require.main === module) {
(async () => {
  const cmd = process.argv[2] || "status";
  if (cmd === "status") {
    const c = load();
    console.log(JSON.stringify({ saved: !!c, savedAt: c ? c.savedAt : null, endpoints: c ? Object.keys(c.templates || {}) : [], path: path.relative(ROOT, CRED), note: "值不回显" }, null, 1));
  } else if (cmd === "save") {
    const tpl = await captureFromPage();
    if (Object.keys(tpl).length < 3) { console.log(JSON.stringify({ ok: false, reason: "捕获不足3个接口模板，页面可能未登录" })); process.exit(1); }
    const fp = save({ savedAt: new Date().toISOString(), approvedByUser: "2026-11-19 最高权限批准", templates: tpl });
    console.log(JSON.stringify({ ok: true, file: path.relative(ROOT, fp), endpoints: Object.keys(tpl), note: "值未回显；请立即收紧文件权限" }, null, 1));
  } else if (cmd === "clear") {
    if (loaded()) fs.unlinkSync(CRED);
    console.log(JSON.stringify({ ok: true, cleared: true }));
  } else {
    console.log("用法: node tools/ky_api_auth.cjs status|save|clear");
    process.exitCode = 2;
  }
  process.exit(0);
})().catch((e) => { console.error("ERR " + e.message); process.exit(1); });
}

module.exports = { load, loaded, CRED };
