/**
 * ky_api_engine.cjs — 开云纯接口引擎（凭据只在内存，不落盘）
 *   bootstrap: 从当前页面捕获三种接口的请求模板（URL/头/体）
 *   --sweep  : getOriginalDataPB(全量) + structureMatchBaseInfoByMidsPB(队名) → 写计划
 *   --odds M : getMatchBaseInfoByOddsPB 读单场盘口赔率（临场用）
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { chromium } = require("playwright");
const auth = require("./ky_api_auth.cjs");

const ROOT = path.resolve(__dirname, "..");
const EXP = path.join(ROOT, "data", "experiment_survival_100");
const SWEEP = path.join(EXP, "sweep");
const CDP = "http://127.0.0.1:9333";

const TIER1 = ["欧冠", "欧联杯", "欧国联", "英超", "西甲", "意甲", "德甲", "法甲"];
const TIER2 = ["英冠", "德乙", "西乙", "葡超", "荷甲", "巴甲", "美职", "土超"];
const ALIAS = {
  "欧洲冠军联赛": "欧冠", "欧足联欧洲联赛": "欧联杯", "欧洲联赛": "欧联杯", "欧洲国家联赛": "欧国联",
  "英格兰超级联赛": "英超", "西班牙甲级联赛": "西甲", "意大利甲级联赛": "意甲", "德国甲级联赛": "德甲", "法国甲级联赛": "法甲",
  "英格兰冠军联赛": "英冠", "德国乙级联赛": "德乙", "西班牙乙级联赛": "西乙", "葡萄牙超级联赛": "葡超",
  "荷兰甲级联赛": "荷甲", "巴西甲级联赛": "巴甲", "美国职业大联盟": "美职", "土耳其超级联赛": "土超",
};
const normLeague = (l) => ALIAS[l] || Object.entries(ALIAS).find(([k]) => l && l.startsWith(k))?.[1] || l;
const tierOf = (l) => (TIER1.includes(normLeague(l)) || TIER1.includes(l) ? 1 : TIER2.includes(normLeague(l)) || TIER2.includes(l) ? 2 : 3);

const bj = (ms) => {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).formatToParts(new Date(ms));
  const g = (t) => p.find((x) => x.type === t).value;
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}:${g("second")}+08:00`;
};
const unwrap = (txt) => {
  const j = JSON.parse(txt);
  if (typeof j.data === "string" && j.data.startsWith("H4sI"))
    return JSON.parse(zlib.gunzipSync(Buffer.from(j.data, "base64")).toString("utf8"));
  return j;
};
const safeHeaders = (h) => {
  const out = {};
  for (const [k, v] of Object.entries(h)) {
    if (/^(host|content-length|accept-encoding|connection|origin|referer|user-agent|cookie)$/i.test(k) || /^sec-/i.test(k)) continue;
    out[k] = v;
  }
  return out;
};

async function bootstrap() {
  // 用户批准持久化凭据：优先从文件读，完全不碰浏览器（脱离页面）
  const saved = auth.load();
  if (saved && saved.templates && saved.templates.getOriginalDataPB && saved.templates.getMatchBaseInfoByOddsPB) {
    return saved.templates;
  }
  // 回退：从当前页面临时捕获（旧路径）
  const browser = await chromium.connectOverCDP(CDP, { timeout: 15000 });
  const ctx = browser.contexts()[0];
  const page = ctx.pages()[0];
  const templates = {};
  const KEYS = ["getOriginalDataPB", "structureMatchBaseInfoByMidsPB", "getMatchBaseInfoByOddsPB"];
  page.on("request", (r) => {
    const u = r.url();
    for (const k of KEYS) {
      if (templates[k] || !u.includes(k)) continue;
      templates[k] = { url: u, method: r.method(), headers: safeHeaders(r.headers()), post: r.postData() };
    }
  });
  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
  const deadline = Date.now() + 30000;
  while (Object.keys(templates).length < KEYS.length && Date.now() < deadline) {
    await page.waitForTimeout(1000);
    // 尝试触发详情接口（点首场）
    if (!templates.getMatchBaseInfoByOddsPB) {
      await page.evaluate(() => {
        const el = [...document.querySelectorAll("*")].find((e) => e.children.length === 0 && /曼城/.test(e.textContent || ""));
        if (el) el.click();
      }).catch(() => {});
    }
  }
  return templates;
}

async function callApi(tpl, bodyOverride) {
  if (!tpl) throw new Error("缺少接口模板");
  const headers = { ...tpl.headers };
  let body;
  if (bodyOverride && tpl.post) {
    try {
      const obj = JSON.parse(tpl.post);
      const merged = { ...obj, ...bodyOverride };
      body = JSON.stringify(merged);
      headers["content-length"] = String(Buffer.byteLength(body));
      delete headers["content-length"]; // 让 fetch 自己算
    } catch { body = tpl.post; }
  } else if (bodyOverride) body = JSON.stringify(bodyOverride);
  else body = tpl.post || undefined;
  const r = await fetch(tpl.url, { method: tpl.method, headers, body });
  const txt = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${txt.slice(0, 100)}`);
  return unwrap(txt);
}

function marketsFrom(m) {
  const out = { had: null, hhad: null, ou: null };
  const arr = (m.playData && m.playData.length ? m.playData : m.hpsData) || [];
  const o2 = (v) => Number(v) / 100000;
  for (const g of arr) {
    for (const gp of g.hps || []) {
      const hp = String(gp.hpid || ""), hl = gp.hl || {}, ol = hl.ol || [];
      if (hp === "1" && !out.had) {
        const h = ol.find((o) => o.ot === "1"), d = ol.find((o) => o.ot === "X"), a = ol.find((o) => o.ot === "2");
        if (h && d && a) out.had = { h: o2(h.ov), d: o2(d.ov), a: o2(a.ov) };
      } else if (hp === "4" && !out.hhad) {
        const h = ol.find((o) => o.ot === "1"), a = ol.find((o) => o.ot === "2");
        if (h && a && hl.hv) out.hhad = { line: String(hl.hv), h: o2(h.ov), a: o2(a.ov) };
      } else if (hp === "2" && !out.ou) {
        const ov = ol.find((o) => /大/.test(o.onb || "")), un = ol.find((o) => /小/.test(o.onb || ""));
        if (ov && un && hl.hv) out.ou = { line: String(hl.hv), over: o2(ov.ov), under: o2(un.ov) };
      }
    }
  }
  return out;
}

(async () => {
  const args = process.argv.slice(2);
  const templates = await bootstrap();
  const missing = ["getOriginalDataPB", "getMatchBaseInfoByOddsPB"].filter((k) => !templates[k]);
  if (missing.length) { console.log(JSON.stringify({ ok: false, reason: "模板未捕获", missing })); process.exit(1); }

  if (args.includes("--odds")) {
    const mid = args[args.indexOf("--odds") + 1];
    const body = templates.getMatchBaseInfoByOddsPB.post ? JSON.parse(templates.getMatchBaseInfoByOddsPB.post) : {};
    const obj = await callApi(templates.getMatchBaseInfoByOddsPB, { ...body, mid });
    const m = (obj.data || [])[0] || {};
    console.log(JSON.stringify({ ok: true, mid, league: m.tnjc, home: m.mhn, away: m.man, kickoff: m.mgt ? bj(Number(m.mgt)) : null, markets: marketsFrom(m) }, null, 1));
    process.exit(0);
  }

  // 默认：API 扫盘
  const raw = await callApi(templates.getOriginalDataPB);
  const now = Date.now();
  const leagues = new Map((raw.tids_obj || []).map((t) => [String(t.tid), t.tn]));
  const sports = new Map((raw.spList || []).map((s) => [String(s.csid), s.csna]));
  const footballIds = new Set([...sports.entries()].filter(([, n]) => /足球/.test(n)).map(([id]) => id));

  let scope = (raw.matchsList || [])
    .filter((m) => footballIds.has(String(m.csid)))
    .map((m) => ({
      mid: String(m.mid || m.mcid),
      tid: String(m.tid),
      league: leagues.get(String(m.tid)) || "未知联赛",
      home: m.mhn || "(未取到)",
      away: m.man || "(未取到)",
      kickoffMs: Number(m.mgt),
      status: m.mst,
    }))
    .filter((m) => Number.isFinite(m.kickoffMs) && m.kickoffMs > now && m.kickoffMs - now <= 72 * 3600000);
  scope = scope.filter((m) => tierOf(m.league) <= 2);
  scope.sort((a, b) => a.kickoffMs - b.kickoffMs);
  scope = scope.slice(0, 80);

  // 队名已在 getOriginalDataPB 中，无需再批量补（仅对缺失的兜底）
  const needNames = scope.filter((m) => m.home === "(未取到)" || m.away === "(未取到)").slice(0, 30);
  const baseTpl = templates.structureMatchBaseInfoByMidsPB;
  const nameMap = new Map();
  const baseBody = baseTpl && baseTpl.post ? JSON.parse(baseTpl.post) : {};
  for (let i = 0; baseTpl && i < needNames.length; i += 15) {
    const batch = needNames.slice(i, i + 15).map((m) => m.mid);
    try {
      const obj = await callApi(baseTpl, { ...baseBody, mids: batch.join(",") });
      for (const m of (Array.isArray(obj.data) ? obj.data : [])) nameMap.set(String(m.mid), { home: m.mhn, away: m.man, league: m.tnjc || m.tn });
    } catch (e) { console.error("batch err " + e.message); }
  }

  const plan = scope.map((m) => {
    const nm = nameMap.get(m.mid) || {};
    return {
      ...m,
      league: nm.league || m.league,
      home: m.home !== "(未取到)" ? m.home : (nm.home || "(未取到)"),
      away: m.away !== "(未取到)" ? m.away : (nm.away || "(未取到)"),
      tier: tierOf(nm.league || m.league),
      kickoff: bj(m.kickoffMs),
      planAtMs: m.kickoffMs - 30 * 60000,
      planAtBeijing: bj(m.kickoffMs - 30 * 60000),
      source: "api",
    };
  }).filter((m) => m.home !== "(未取到)");

  const stats = { capturedAll: raw.matchsList ? raw.matchsList.length : 0, football: [...sports.values()].filter((n) => /足球/.test(n)).length, inScope: scope.length, named: plan.length, tier1: plan.filter((m) => m.tier === 1).length, tier2: plan.filter((m) => m.tier === 2).length };
  const date = bj(now).slice(0, 10);
  const out = { version: "sweep-plan-v4-api-native", createdAt: bj(now), stats, coverageNote: `全量接口返回 ${stats.capturedAll} 场；一/二类未来72h ${scope.length} 场，补到队名 ${plan.length} 场（未取到队名的不计）`, rechecks: plan };
  fs.mkdirSync(SWEEP, { recursive: true });
  let fp = path.join(SWEEP, `planApi_${date}.json`);
  if (fs.existsSync(fp)) fp = path.join(SWEEP, `planApi_${date}_${bj(now).slice(11, 19).replace(/:/g, "")}.json`);
  fs.writeFileSync(fp, JSON.stringify(out, null, 2), "utf8");
  console.log(JSON.stringify({ ok: true, plan: path.basename(fp), stats, sample: plan.slice(0, 3).map((m) => `${m.league} ${m.home} vs ${m.away} @${m.kickoff}`) }, null, 1));
  process.exit(0);
})().catch((e) => { console.error("ERR " + e.message); process.exit(1); });
