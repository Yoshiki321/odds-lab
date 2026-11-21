/**
 * ky_api_catalog.cjs — 抓取开云体育页面实际调用的全部接口，生成接口目录 JSON。
 * 用法: node tools/ky_api_catalog.cjs [输出文件]
 * 只读：挂响应监听 + 页面导航/点击，不提交任何订单。
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const OUT = process.argv[2] || path.join(ROOT, "data", "experiment_survival_100", "runtime", "api_catalog.json");

const KEYS = {
  "getMatchBaseInfoByOddsPB": "场次+全部盘口赔率（批次；解包为JSON）",
  "structureMatchBaseInfoByMidsPB": "按 mid 批量取场次基础信息",
  "structureTournamentMatchesNewPB": "联赛→场次结构",
  "getAllMatchesOddsPB": "全部场次赔率（大批次）",
  "collectMatchesPB": "收藏场次",
  "findTopMatchsPB": "热门场次",
  "findTopIdsPB": "热门ID",
  "getOutrightDisplayMatchsPB": "冠军类盘口",
  "findPlaySortPB": "玩法排序",
  "getCategoryList": "玩法/盘口定义（明文JSON）",
  "findPlayTopPB": "常用玩法",
  "matchDetail/getMatchDetailPB": "单场详情",
  "eventCollectionPB": "赛事聚合",
  "tabSwitchPB": "统计切换",
  "getSystemTime/currentTimeMillis": "服务器时间",
  "countUnsettleTickets": "未结订单数（明文JSON）",
  "betOrder/betPB": "提交订单（POST，禁止自动调用）",
  "member/info": "会员信息（主站签名接口）",
  "loadTournamentMatchPB": "联赛场次映射",
  "loadMappingPB": "盘口映射",
  "menu/initPB": "菜单初始化",
  "loadNameListPB": "联赛名列表",
  "getOriginalDataPB": "原始数据（大包）",
};

function tryDecode(txt) {
  let j;
  try { j = JSON.parse(txt); } catch { return { plain: false, note: "非JSON" }; }
  if (!j || typeof j.data !== "string" || !/^H4sI/.test(j.data)) return { plain: true, obj: j };
  try {
    const raw = zlib.gunzipSync(Buffer.from(j.data, "base64")).toString("utf8");
    const obj = JSON.parse(raw);
    return { plain: false, gzipJson: true, obj, rawBytes: raw.length };
  } catch (e) {
    return { plain: false, gzipJson: false, note: "gzip后非JSON: " + e.message };
  }
}

function shape(obj, depth) {
  if (depth <= 0) return typeof obj;
  if (Array.isArray(obj)) return { type: "array", len: obj.length, item: obj.length ? shape(obj[0], depth - 1) : null };
  if (obj && typeof obj === "object") {
    const out = {};
    for (const k of Object.keys(obj).slice(0, 18)) out[k] = shape(obj[k], depth - 1);
    return { type: "object", keys: out };
  }
  return typeof obj;
}

(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9333", { timeout: 15000 });
  const ctx = browser.contexts()[0];
  const page = ctx.pages()[0];
  const found = new Map();

  page.on("response", async (res) => {
    const url = res.url();
    const key = Object.keys(KEYS).find((k) => url.includes(k));
    if (!key) return;
    const rec = {
      endpoint: key,
      purpose: KEYS[key],
      url: url.split("?")[0],
      method: res.request().method(),
      status: res.status(),
      contentType: (res.headers()["content-type"] || "").slice(0, 50),
      observedAt: new Date().toISOString(),
    };
    try {
      const txt = await res.text();
      rec.bodyBytes = txt.length;
      const d = tryDecode(txt);
      rec.encoding = d.plain ? "plain-json" : d.gzipJson ? "base64+gzip+json" : (d.note || "unknown");
      if (d.obj) rec.shape = shape(d.obj, 3);
      // 请求体（仅记录大小与字段名，避免记录敏感值）
      const rb = res.request().postData();
      if (rb) {
        try { rec.requestFields = Object.keys(JSON.parse(rb)); } catch { rec.requestFields = ["<non-json>"]; }
      }
    } catch (e) { rec.bodyError = e.message; }
    const old = found.get(key);
    if (!old || (rec.bodyBytes || 0) > (old.bodyBytes || 0)) found.set(key, rec);
  });

  // 触发各视图/交互，让页面自己请求接口
  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(7000);
  await page.getByText("早盘", { exact: true }).first().click({ timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(5000);
  for (const d of ["11/20", "11/21"]) {
    await page.getByText(d, { exact: true }).first().click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(3500);
  }
  // 点击一场以触发详情接口（只读）
  await page.evaluate(() => {
    const el = [...document.querySelectorAll("*")].find((e) => e.children.length === 0 && /曼城/.test(e.textContent || ""));
    if (el) el.click();
  }).catch(() => {});
  await page.waitForTimeout(4000);

  const catalog = {
    generatedAt: new Date().toISOString(),
    source: "开云体育自动化 Edge 页面自身请求（CDP 响应监听）",
    decodeRecipe: "JSON wrapper {code,data,msg}；若 data 以 H4sI 开头 → base64 decode → gzip 解压 → JSON",
    endpoints: [...found.values()].sort((a, b) => a.endpoint.localeCompare(b.endpoint)),
    notCaptured: Object.keys(KEYS).filter((k) => !found.has(k)),
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(catalog, null, 2), "utf8");
  console.log(JSON.stringify({ out: path.relative(ROOT, OUT), captured: catalog.endpoints.length, notCaptured: catalog.notCaptured }, null, 1));
  process.exit(0);
})().catch((e) => { console.error("ERR " + e.message); process.exit(1); });
