/**
 * ky_api_scan.cjs — API 版扫盘（根治覆盖率）：捕获页面自身请求 getMatchBaseInfoByOddsPB，
 * 解包(base64+gzip→JSON)得到全部场次+盘口，不依赖列表折叠/点击。
 *
 * 用法: node tools/ky_api_scan.cjs            # 扫盘并写计划
 *       node tools/ky_api_scan.cjs --dry      # 只打印统计，不写文件
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const EXP = path.join(ROOT, "data", "experiment_survival_100");
const SWEEP = path.join(EXP, "sweep");
const CDP = "http://127.0.0.1:9333";

const TIER1 = ["欧冠", "欧联杯", "欧国联", "英超", "西甲", "意甲", "德甲", "法甲"];
const TIER2 = ["英冠", "德乙", "西乙", "葡超", "荷甲", "巴甲", "美职", "土超"];

const bj = (ms) => {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).formatToParts(new Date(ms));
  const g = (t) => p.find((x) => x.type === t).value;
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}:${g("second")}+08:00`;
};
const tierOf = (lg) => (TIER1.includes(lg) ? 1 : TIER2.includes(lg) ? 2 : 3);
const o2num = (ov) => (typeof ov === "number" ? ov / 100000 : Number(ov) / 100000);

function decodePayload(txt) {
  const j = JSON.parse(txt);
  if (typeof j.data !== "string" || !j.data.startsWith("H4sI")) return null;
  return JSON.parse(zlib.gunzipSync(Buffer.from(j.data, "base64")).toString("utf8"));
}

/** 从一场的 hpsData 抽三主盘 */
function extractMarkets(m) {
  const out = { had: null, hhad: null, ou: null };
  for (const g of (m.playData && m.playData.length ? m.playData : m.hpsData) || []) {
    for (const grp of g.hps || []) {
      const hp = String(grp.hpid || "");
      const hl = grp.hl || {};
      const opts = hl.ol || [];
      if (hp === "1" && !out.had) {
        const pick = (ot) => opts.find((o) => o.ot === ot);
        const h = pick("1"), d = pick("X"), a = pick("2");
        if (h && d && a) out.had = { h: o2num(h.ov), d: o2num(d.ov), a: o2num(a.ov) };
      } else if (hp === "4" && !out.hhad) {
        const h = opts.find((o) => o.ot === "1"), a = opts.find((o) => o.ot === "2");
        if (h && a && hl.hv) out.hhad = { line: String(hl.hv), h: o2num(h.ov), a: o2num(a.ov) };
      } else if (hp === "2" && !out.ou) {
        const over = opts.find((o) => /大/.test(o.onb || "")), under = opts.find((o) => /小/.test(o.onb || ""));
        if (over && under && hl.hv) out.ou = { line: String(hl.hv), over: o2num(over.ov), under: o2num(under.ov) };
      }
    }
  }
  return out;
}

(async () => {
  const dry = process.argv.includes("--dry");
  const browser = await chromium.connectOverCDP(CDP, { timeout: 15000 });
  const ctx = browser.contexts()[0];
  const page = ctx.pages()[0];

  let best = null;
  page.on("response", async (res) => {
    if (!res.url().includes("getMatchBaseInfoByOddsPB")) return;
    try {
      const t = await res.text();
      const obj = decodePayload(t);
      const arr = obj && Array.isArray(obj.data) ? obj.data : null;
      if (arr && (!best || arr.length > best.length)) best = arr;
    } catch {}
  });

  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
  // 等最大批次返回（页面会分批拉取）
  for (let i = 0; i < 20; i++) await page.waitForTimeout(1000);

  if (!best || !best.length) {
    console.log(JSON.stringify({ ok: false, reason: "未捕获到比赛数据接口" }));
    process.exit(1);
  }

  const now = Date.now();
  const all = best
    .filter((m) => /足球/.test(m.csna || "") || (m.hpsData && m.hpsData.length))
    .map((m) => ({
      mid: m.mid,
      league: m.tnjc,
      home: m.mhn,
      away: m.man,
      kickoffMs: Number(m.mgt),
      status: m.mst,
      markets: extractMarkets(m),
    }))
    .filter((m) => Number.isFinite(m.kickoffMs) && m.kickoffMs > now && m.kickoffMs - now <= 72 * 3600 * 1000);

  all.sort((a, b) => a.kickoffMs - b.kickoffMs || (a.home < b.home ? -1 : 1));
  for (const m of all) m.tier = tierOf(m.league);
  const ordered = [...all.filter((m) => m.tier === 1), ...all.filter((m) => m.tier === 2), ...all.filter((m) => m.tier === 3)];

  const withOdds = ordered.filter((m) => m.markets.had || m.markets.hhad || m.markets.ou).length;
  const stats = {
    captured: best.length,
    inScope72h: ordered.length,
    withAnyOdds: withOdds,
    tier1: ordered.filter((m) => m.tier === 1).length,
    tier2: ordered.filter((m) => m.tier === 2).length,
    tier3: ordered.filter((m) => m.tier === 3).length,
    readyForBetting: ordered.filter((m) => m.markets.had && m.markets.hhad && m.markets.ou).length,
  };

  if (dry) {
    console.log(JSON.stringify({ ok: true, dry: true, stats, sample: ordered.slice(0, 6) }, null, 1));
    process.exit(0);
  }

  const date = bj(now).slice(0, 10);
  const plan = {
    version: "sweep-plan-v3-api",
    createdAt: bj(now),
    observedAt: bj(now),
    source: "getMatchBaseInfoByOddsPB (page 自身请求，本机解包)",
    stats,
    coverageNote: `接口一次返回 ${best.length} 场，72h 内 ${ordered.length} 场（其中 ${withOdds} 场有盘口）；不再依赖列表折叠，覆盖以接口返回为准`,
    rechecks: ordered.map((m) => ({
      eventId: String(m.mid), mid: m.mid, league: m.league, home: m.home, away: m.away, tier: m.tier,
      kickoff: bj(m.kickoffMs), kickoffMs: m.kickoffMs,
      planAtMs: m.kickoffMs - 30 * 60000, planAtBeijing: bj(m.kickoffMs - 30 * 60000),
      offsetMin: 30, markets: m.markets,
    })),
  };
  fs.mkdirSync(SWEEP, { recursive: true });
  let fp = path.join(SWEEP, `planApi_${date}.json`);
  if (fs.existsSync(fp)) fp = path.join(SWEEP, `planApi_${date}_${bj(now).slice(11, 19).replace(/:/g, "")}.json`);
  fs.writeFileSync(fp, JSON.stringify(plan, null, 2), "utf8");

  console.log(JSON.stringify({ ok: true, plan: path.basename(fp), stats }, null, 1));
  process.exit(0);
})().catch((e) => { console.error("ERR " + e.message); process.exit(1); });
