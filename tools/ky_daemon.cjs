/**
 * ky_daemon.cjs — 开云生存实验定时守护（单页铁律：全程只用一个标签页）
 *
 * 模式：
 *   node tools/ky_daemon.cjs --once     跑一轮（扫盘或临场，按当前时间判断）
 *   node tools/ky_daemon.cjs --force-sweep  强制立即扫盘（标记 manual）
 *   node tools/ky_daemon.cjs            常驻（每30s tick）
 *
 * 铁律：只观察+记录，绝不下注。下单只在用户明确批准后由人工流程触发。
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const EXP = path.join(ROOT, "data", "experiment_survival_100");
const RT = path.join(EXP, "runtime");
const SWEEP = path.join(EXP, "sweep");
const CDP = "http://127.0.0.1:9333";
const SPORT_ENTRY = "https://www.w7spda.vip:6501/game/sport/ob?enName=YBTY";
const TZ = "Asia/Shanghai";

const TIER1 = ["欧洲冠军联赛", "欧冠", "欧国联", "欧联杯", "英超", "西甲", "意甲", "德甲", "法甲"];
const TIER2 = ["英冠", "德乙", "西乙", "葡超", "荷甲", "巴甲", "美职", "土超"];
/** 全称→简称（页面用全称，分级表用简称） */
const ALIAS = {
  "欧洲冠军联赛": "欧冠", "欧冠联赛": "欧冠",
  "欧足联欧洲联赛": "欧联杯", "欧洲联赛": "欧联杯",
  "欧洲国家联赛": "欧国联", "欧国联": "欧国联",
  "英格兰超级联赛": "英超", "西班牙甲级联赛": "西甲", "意大利甲级联赛": "意甲",
  "德国甲级联赛": "德甲", "法国甲级联赛": "法甲",
  "英格兰冠军联赛": "英冠", "德国乙级联赛": "德乙", "西班牙乙级联赛": "西乙",
  "葡萄牙超级联赛": "葡超", "荷兰甲级联赛": "荷甲", "巴西甲级联赛": "巴甲",
  "美国职业大联盟": "美职", "美国职业大联盟 - 附加赛": "美职", "土耳其超级联赛": "土超",
};
function normLeague(l) {
  if (ALIAS[l]) return ALIAS[l];
  for (const [k, v] of Object.entries(ALIAS)) if (l && l.startsWith(k)) return v;
  return l;
}

function nowMs() { return Date.now(); }
function bj(ms) {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).formatToParts(new Date(ms));
  const g = (t) => p.find((x) => x.type === t).value;
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}:${g("second")}+08:00`;
}
function bjDate(ms) { return bj(ms).slice(0, 10); }
/** 北京时间的"当日第几分钟" */
function bjMinutes(ms) {
  const s = bj(ms);
  return Number(s.slice(11, 13)) * 60 + Number(s.slice(14, 16));
}
function log(level, msg) {
  fs.mkdirSync(RT, { recursive: true });
  const line = `${bj(nowMs())} [${level}] ${msg}`;
  fs.appendFileSync(path.join(RT, "daemon.log"), line + "\n", "utf8");
  console.log(line);
}
function readJson(p, dflt) { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return dflt; } }
function writeJson(p, v) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v, null, 2), "utf8"); }
function statePath() { return path.join(RT, "daemon_state.json"); }
function planPath(date) { return path.join(SWEEP, `plan_${date}.json`); }

// ---------------------------------------------------------------- 浏览器（仅凭据过期时人工使用；守护不再自动拉起）
async function connectSinglePage() {
  // 2026-11-19：用户要求删除自动拉起浏览器逻辑。接口调用不依赖浏览器。
  throw new Error("浏览器已被禁用：本守护只走接口。需要刷新凭据时由用户手动开浏览器并运行 ky_api_auth save");
}

async function gotoSport(page) {
  if (!page.url().includes("zqt0510")) {
    await page.goto(SPORT_ENTRY, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2000);
    const src = await page.evaluate(() => { const f = document.querySelector("iframe"); return f ? f.src : null; }).catch(() => null);
    if (src) {
      await page.goto(src, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
    }
  } else {
    // 每次扫盘都重载，回到干净的首页状态（避免残留在某个联赛/视图筛选里）
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
  }
  // 等渲染（SPA 首次约需数秒）
  let len = 0;
  for (let i = 0; i < 20; i++) {
    len = await page.evaluate(() => (document.body.innerText || "").length).catch(() => 0);
    if (len > 2000) break;
    await page.waitForTimeout(1000);
  }
  // 切到早盘（列表未点开时 innerText 里没有赛程）
  const hasList = await page.evaluate(() => (document.body.innerText || "").includes("所有日期")).catch(() => false);
  if (!hasList) {
    await page.getByText("早盘", { exact: true }).first().click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(2500);
  }
  return page.url();
}

// ---------------------------------------------------------------- 解析体育页
/** 从场次块里抽三主盘：独赢(主/平/客)、让球(线+两侧)、大小(线+大/小) */
function extractMarkets(block) {
  const lines = block.split("\n").map((s) => s.trim());
  const num = (s) => { const m = (s || "").match(/^\d+\.\d{2}$/); return m ? Number(s) : null; };
  const pick = (label, offset) => {
    const i = lines.findIndex((l) => l === label);
    if (i < 0) return null;
    for (let k = i + 1; k < Math.min(i + 1 + (offset || 3), lines.length); k++) {
      const v = num(lines[k]);
      if (v != null) return v;
    }
    return null;
  };
  const had = { h: pick("主胜"), d: pick("平局"), a: pick("客胜") };
  // 让球：line, 主赔, line(或对侧线), 客赔 —— 兼容 "0/1.99/0/1.89" 与 "-1/1.82/+1/2.06"
  let hhad = null;
  const isLine = (s) => /^[+-]?\d+(\.\d+)?(\/\d+(\.\d+)?)?$/.test(s || "");
  for (let i = 0; i < lines.length - 3; i++) {
    if (!isLine(lines[i])) continue;
    const oh = num(lines[i + 1]);
    const ok2 = isLine(lines[i + 2]);
    const oa = num(lines[i + 3]);
    if (oh && oa && ok2) { hhad = { line: lines[i], h: oh, a: oa }; break; }
  }
  // 大小：大 / 线 / 大赔率 / 小 / 线 / 小赔率
  let ou = null;
  const oi = lines.findIndex((l, i) => l === "大" && /^[\d./]+$/.test(lines[i + 1] || "") && num(lines[i + 2]));
  if (oi >= 0) {
    const line = lines[oi + 1], over = num(lines[oi + 2]);
    const ui = lines.findIndex((l, i) => i > oi && l === "小");
    const under = ui >= 0 ? num(lines[ui + 2]) : null;
    ou = { line, over, under };
  }
  return { had, hhad, ou };
}

/** 从页面文本抽取场次：队名/队名 + 日期 + 时间(+08:00)；联赛取最近的上方联赛标题 */
function parseMatches(text) {
  const lines = text.split("\n").map((s) => s.trim());
  const out = [];
  const dateRe = /^(\d{1,2})月(\d{1,2})日$/;
  const timeRe = /^(\d{2}):(\d{2})\(GMT\+8\)$/;
  const KNOWN_LEAGUE = [...TIER1, ...TIER2, "英超", "西甲", "意甲", "德甲", "法甲"];
  let league = "";
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l) continue;
    if (KNOWN_LEAGUE.includes(l) || /联赛|杯|锦标|超级|甲级|乙级|联盟/.test(l)) league = l;
    const dm = l.match(dateRe);
    if (!dm) continue;
    const home = lines[i - 2], away = lines[i - 1];
    const tm = (lines[i + 1] || "").match(timeRe);
    if (!home || !away || !tm || home.length > 20 || away.length > 20) continue;
    const year = new Date(nowMs()).getUTCFullYear();
    const month = Number(dm[1]), day = Number(dm[2]);
    // 北京时间构造：用 Date.UTC 后减 8h
    let ms = Date.UTC(year, month - 1, day, Number(tm[1]) - 8, Number(tm[2]));
    // 跨年/跨月：若比现在早很多，视为明年
    if (ms < nowMs() - 180 * 86400000) ms = Date.UTC(year + 1, month - 1, day, Number(tm[1]) - 8, Number(tm[2]));
    const block = lines.slice(i + 2, i + 26).join("\n");
    out.push({ id: null, league: league || "未标注", home, away, kickoffMs: ms, kickoff: bj(ms), markets: extractMarkets(block) });
  }
  // 去重（同场同开赛）
  const seen = new Set();
  return out.filter((m) => { const k = `${m.home}|${m.away}|${m.kickoffMs}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

function tierOf(league) {
  const l = normLeague(league);
  if (TIER1.includes(l)) return 1;
  if (TIER2.includes(l)) return 2;
  return 3;
}
function inScope(m, now) {
  const ahead = m.kickoffMs - now;
  return ahead > 0 && ahead <= 72 * 3600000; // 未来72小时内
}

function selectAndPlan(matches, now) {
  const scope = matches.filter((m) => inScope(m, now));
  for (const m of scope) m.tier = tierOf(m.league);
  scope.sort((a, b) => a.kickoffMs - b.kickoffMs || (a.home < b.home ? -1 : a.home > b.home ? 1 : 0));
  const ordered = [...scope.filter((m) => m.tier === 1), ...scope.filter((m) => m.tier === 2), ...scope.filter((m) => m.tier === 3)];
  for (const m of ordered) m.id = `${m.home}-${m.away}-${m.kickoffMs}`;
  return { total: ordered.length, included: ordered, excluded: [], capped: false };
}

function makeRechecks(cands) {
  return cands.map((m) => {
    const planMs = m.kickoffMs - 30 * 60000;
    return { eventId: m.id, home: m.home, away: m.away, league: m.league, tier: m.tier, kickoff: m.kickoff, kickoffMs: m.kickoffMs, planAtMs: planMs, planAtBeijing: bj(planMs), offsetMin: 30 };
  });
}

// ---------------------------------------------------------------- 扫盘
/** 按联赛标签抓取：点击标签→解析→累积去重（提升覆盖率；仅一类标签） */
const TIER1_TABS = ["欧冠", "欧联杯", "五大联赛", "欧国联"];
async function collectTier1(page) {
  const all = [];
  for (const tab of TIER1_TABS) {
    const ok = await page.getByText(tab, { exact: false }).first().click({ timeout: 6000 }).then(() => true).catch(() => false);
    if (!ok) continue;
    await page.waitForTimeout(2000);
    const text = await page.evaluate(() => (document.body.innerText || "").slice(0, 60000)).catch(() => "");
    const ms = parseMatches(text).map((m) => ({ ...m, tab }));
    all.push(...ms);
  }
  const seen = new Set();
  return all.filter((m) => { const k = `${m.home}|${m.away}|${m.kickoffMs}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

/** 按日期标签逐个抓（提升覆盖率）：点 11/19、11/20… 每个日期都解析一遍 */
async function collectByDates(page, maxDates) {
  const labels = await page.evaluate(() => {
    const t = document.body.innerText || "";
    return [...new Set([...t.matchAll(/(\d{1,2}\/\d{1,2})\s*\n?\s*（(\d+)/g)].map((m) => m[1]))];
  }).catch(() => []);
  const use = labels.slice(0, maxDates || 4);
  const all = [];
  for (const lab of use) {
    const ok = await page.getByText(lab, { exact: true }).first().click({ timeout: 6000 }).then(() => true).catch(() => false);
    if (!ok) continue;
    await page.waitForTimeout(2200);
    const text = await page.evaluate(() => (document.body.innerText || "").slice(0, 60000)).catch(() => "");
    all.push(...parseMatches(text).map((m) => ({ ...m, dateTab: lab })));
  }
  const seen = new Set();
  return all.filter((m) => { const k = `${m.home}|${m.away}|${m.kickoffMs}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

/** 滚动加载 + 累积解析：解决懒加载/折叠导致的覆盖率过低 */
async function collectByScroll(page, { maxScrolls = 40, idleStop = 3 } = {}) {
  const acc = new Map();
  let idle = 0;
  const absorb = (text) => {
    let added = 0;
    for (const m of parseMatches(text)) {
      const k = `${m.home}|${m.away}|${m.kickoffMs}`;
      if (!acc.has(k)) { acc.set(k, m); added++; }
    }
    return added;
  };
  // 先把列表滚到顶部
  await page.mouse.move(700, 500).catch(() => {});
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -2000).catch(() => {});
  await page.waitForTimeout(800);
  absorb(await page.evaluate(() => (document.body.innerText || "").slice(0, 80000)).catch(() => ""));
  for (let s = 0; s < maxScrolls; s++) {
    await page.mouse.wheel(0, 1400).catch(() => {});
    await page.waitForTimeout(700);
    const text = await page.evaluate(() => (document.body.innerText || "").slice(0, 80000)).catch(() => "");
    const added = absorb(text);
    if (added === 0) { idle++; if (idle >= idleStop) break; } else idle = 0;
  }
  return [...acc.values()];
}

/** 逐个联赛点开抓取（列表按联赛折叠，展开才有场次；覆盖全部联赛） */
async function collectByLeagues(page) {
  const labels = await page.evaluate(() => {
    const t = document.body.innerText || "";
    const out = [];
    const re = /([\u4e00-\u9fa5A-Za-z][\u4e00-\u9fa5A-Za-z\s\-·]*?)\s*(\d{1,4})\n/g;
    let m;
    while ((m = re.exec(t)) !== null) {
      const name = m[1].trim();
      if (name.length < 2 || name.length > 18) continue;
      if (/^(LIVE|早盘|今日|全部|时间|简译|繁译|日间|夜间|收藏|未开赛|滚球盘|选择联赛|专业|新手|热门|欧洲盘)$/.test(name)) continue;
      if (!/联赛|杯|锦标|冠军|超级|甲级|乙级|联盟|国联|欧联|欧冠/.test(name)) continue;
      out.push(name);
    }
    return [...new Set(out)];
  }).catch(() => []);
  const acc = new Map();
  for (const lab of labels) {
    const ok = await page.getByText(lab, { exact: true }).first().click({ timeout: 4000 }).then(() => true).catch(() => false);
    if (!ok) continue;
    await page.waitForTimeout(1500);
    const text = await page.evaluate(() => (document.body.innerText || "").slice(0, 80000)).catch(() => "");
    for (const m of parseMatches(text)) {
      const k = `${m.home}|${m.away}|${m.kickoffMs}`;
      if (!acc.has(k)) acc.set(k, { ...m, leagueTab: lab });
    }
  }
  return { labels, matches: [...acc.values()] };
}

/** 全联赛抓取：先进“热门赛事”视图，再逐个联赛标签点开解析（解决折叠只渲染当前联赛） */
async function collectAllLeagues(page) {
  // 1) 切热门赛事（全联赛视图）
  await page.evaluate(() => {
    const el = [...document.querySelectorAll(".menu-item")].find((e) => /热门赛事/.test(e.textContent || ""));
    if (el) el.click();
  }).catch(() => {});
  await page.waitForTimeout(3000);

  // 2) 取联赛标签（叶子文本里像联赛名的）
  const labels = await page.evaluate(() => {
    const out = [];
    for (const e of document.querySelectorAll("*")) {
      if (e.children.length) continue;
      const t = (e.textContent || "").trim();
      if (!t || t.length < 2 || t.length > 12) continue;
      if (!/联赛|杯|锦标|冠军|甲级|乙级|超级|国联|欧联|欧冠|联盟/.test(t)) continue;
      if (/^(五大联赛|滚球盘|未开赛|选择联赛|体育菜单)$/.test(t)) continue;
      out.push(t);
    }
    return [...new Set(out)];
  }).catch(() => []);

  const acc = new Map();
  const used = [];
  for (const lab of labels.slice(0, 28)) {
    const h = await page.evaluateHandle((l) => [...document.querySelectorAll("*")].find((e) => e.children.length === 0 && (e.textContent || "").trim() === l) || null, lab);
    const el = h.asElement();
    if (!el) continue;
    const ok = await el.click({ timeout: 4000 }).then(() => true).catch(() => false);
    if (!ok) continue;
    used.push(lab);
    await page.waitForTimeout(1400);
    const text = await page.evaluate(() => (document.body.innerText || "").slice(0, 70000)).catch(() => "");
    for (const m of parseMatches(text)) {
      const k = `${m.home}|${m.away}|${m.kickoffMs}`;
      if (!acc.has(k)) acc.set(k, { ...m, leagueTab: lab });
    }
  }
  return { labels, used, matches: [...acc.values()] };
}

/** 按联赛标签逐个抓（已验证可行）：每个联赛点开→解析→累积；失败的记入 failedLeagues */
const SWEEP_LEAGUES = [
  "欧冠", "欧联杯", "欧国联", "欧洲国家联赛",
  "英超", "西甲", "意甲", "德甲", "法甲",
  "英冠", "英格兰冠军联赛", "德乙", "德国乙级联赛", "西乙", "西班牙乙级联赛",
  "葡超", "荷甲", "巴甲", "美职联", "土超",
];
async function collectByChips(page, names) {
  const acc = new Map();
  const okLeagues = [];
  const failedLeagues = [];
  let advertisedSum = 0;
  for (const want of names) {
    const h = await page.evaluateHandle((lab) => [...document.querySelectorAll("*")].find((e) => e.children.length === 0 && (e.textContent || "").trim() === lab) || null, want);
    const el = h.asElement();
    if (!el) { failedLeagues.push({ league: want, reason: "标签不存在" }); continue; }
    const ok = await el.click({ timeout: 5000 }).then(() => true).catch(() => false);
    if (!ok) { failedLeagues.push({ league: want, reason: "点击失败" }); continue; }
    await page.waitForTimeout(2200);
    // 联赛内滚动加载，抓全该联赛（避免只拿首屏）
    const accText = [];
    accText.push(await page.evaluate(() => (document.body.innerText || "").slice(0, 70000)).catch(() => ""));
    for (let s = 0; s < 6; s++) {
      await page.mouse.move(700, 500).catch(() => {});
      await page.mouse.wheel(0, 1200).catch(() => {});
      await page.waitForTimeout(600);
      accText.push(await page.evaluate(() => (document.body.innerText || "").slice(0, 70000)).catch(() => ""));
    }
    const text = accText.join("\n");
    const adv = Number((text.match(/未开赛\s*\n\s*(\d+)/) || [])[1] || 0);
    advertisedSum += adv;
    const got = parseMatches(text);
    okLeagues.push({ league: want, advertised: adv, parsed: got.length });
    for (const m of got) {
      const k = `${m.home}|${m.away}|${m.kickoffMs}`;
      if (!acc.has(k)) acc.set(k, { ...m, leagueTab: want });
    }
  }
  return { matches: [...acc.values()], okLeagues, failedLeagues, advertisedSum };
}

async function runSweep({ manual = false } = {}) {
  const now = nowMs();
  const date = bjDate(now);
  const { browser, page } = await connectSinglePage();
  try {
    const url = await gotoSport(page);
    const text = await page.evaluate(() => (document.body.innerText || "").slice(0, 40000)).catch(() => "");
    if (!text || text.length < 200) {
      log("ERROR", `扫盘失败：页面无内容（url=${url.slice(0, 60)}）`);
      writeJson(statePath(), { ...readJson(statePath(), {}), lastSweep: { date, at: bj(now), ok: false, reason: "页面无内容" } });
      return { ok: false, reason: "页面无内容" };
    }
    // 联赛逐个点开（已验证可行）；先回热门赛事全联赛视图
    await page.evaluate(() => {
      const el = [...document.querySelectorAll(".menu-item")].find((e) => /热门赛事/.test(e.textContent || ""));
      if (el) el.click();
    }).catch(() => {});
    await page.waitForTimeout(3000);
    const chips = await collectByChips(page, SWEEP_LEAGUES).catch(() => ({ matches: [], okLeagues: [], failedLeagues: [], advertisedSum: 0 }));
    const matches = chips.matches.length ? chips.matches : parseMatches(await page.evaluate(() => (document.body.innerText || "").slice(0, 80000)).catch(() => ""));
    const sel = selectAndPlan(matches, now);
    // 页面宣称总量（用于覆盖率诚实标注）
    const advertised = chips.advertisedSum || (() => {
      const m = text.match(/未开赛\s*\n\s*(\d{1,5})/);
      return m ? Number(m[1]) : null;
    })();
    const coverageNote = advertised
      ? `按联赛逐个抓：成功 ${chips.okLeagues.length} 个联赛/失败 ${chips.failedLeagues.length} 个；解析到 ${matches.length} 场（宣称合计 ${advertised} 场，覆盖率 ${(matches.length / advertised * 100).toFixed(1)}%）；失败联赛记未检查`
      : `页面未读到总量；解析到 ${matches.length} 场（覆盖情况未知）`;
    const rechecks = makeRechecks(sel.included);
    const plan = {
      version: "sweep-plan-v2", configVersion: "sweep-config-v2", createdAt: bj(now), mode: manual ? "manual" : "scheduled",
      observedAt: bj(now), sourcePage: url.slice(0, 80),
      parsedMatches: matches.length, advertisedTotal: advertised, coverageNote,
      sel, rechecks,
      note: "解析为粗解析（页面文本），赔率等明细以页面为准；只观察不下单",
    };
    // 计划文件：同日重复运行写带时间戳的版本，不覆盖
    const base = planPath(date).replace(/\.json$/, "");
    let fp = `${base}.json`;
    if (fs.existsSync(fp)) fp = `${base}_${bj(now).slice(11, 19).replace(/:/g, "")}.json`;
    writeJson(fp, plan);

    // 晨报
    const md = [
      `# 早间扫盘 ${date}（${manual ? "手动一键" : "定时 09:00"}，北京时间 +08:00）`,
      ``,
      `> 只观察不下单；解析为粗解析，赔率明细以页面为准。`,
      ``,
      `- 观察时刻：${bj(now)}`,
      `- ${coverageNote}`,
      `- 解析到场次：${matches.length}；范围内(未来72h)：${sel.total}；纳入：${sel.included.length}`,
      ...sel.included.slice(0, 40).map((m) => `  - [${m.tier}类] ${m.league} ${m.home} vs ${m.away} 开赛 ${m.kickoff}`),
      `- 临场复核计划（开赛前30分钟，窗[计划,+5min]）：`,
      ...rechecks.slice(0, 40).map((r) => `  - ${r.home} vs ${r.away} 计划 ${r.planAtBeijing}（ms ${r.planAtMs}）`),
    ].join("\n");
    const mfp = path.join(SWEEP, `morning_${date}.md`);
    fs.mkdirSync(SWEEP, { recursive: true });
    if (fs.existsSync(mfp)) {
      fs.writeFileSync(path.join(SWEEP, `morning_${date}_${bj(now).slice(11, 19).replace(/:/g, "")}.md`), md, "utf8");
    } else fs.writeFileSync(mfp, md, "utf8");

    const st = readJson(statePath(), {});
    st.lastSweep = { date, at: bj(now), ok: true, parsed: matches.length, included: sel.included.length, planFile: path.basename(fp) };
    st.sweepDone = st.sweepDone || {};
    st.sweepDone[date] = bj(now);
    writeJson(statePath(), st);
    log("INFO", `扫盘完成 date=${date} parsed=${matches.length} included=${sel.included.length} plan=${path.basename(fp)}`);
    return { ok: true, parsed: matches.length, included: sel.included.length, fp };
  } finally {
    await browser.close().catch(() => {});
  }
}

// ---------------------------------------------------------------- 临场
/** 在体育页文本里找该场的独赢/让球/大小赔率（就近文本，粗取） */
function extractOddsFor(text, home, away) {
  const i = text.indexOf(home);
  if (i < 0) return null;
  const seg = text.slice(i, i + 900);
  const j = seg.indexOf(away);
  if (j < 0) return null;
  const tail = seg.slice(j + away.length, j + away.length + 400);
  const nums = (tail.match(/\d+\.\d{2}/g) || []).slice(0, 9);
  return { segment: seg.slice(0, 220).replace(/\n/g, "|"), nums };
}

async function runInplay(task) {
  const now = nowMs();
  const date = bjDate(now);
  {
    const apiOdds = readApiOdds(task.mid || task.eventId);
    const markets = apiOdds && apiOdds.markets ? apiOdds.markets : null;
    const odds = markets ? { markets, source: "getMatchBaseInfoByOddsPB", observedAt: bj(now) } : { markets: null };
    const minutesToKick = Math.round((task.kickoffMs - now) / 60000);
    const rec = {
      eventId: task.eventId, dateAsiaShanghai: date, observedAt: bj(now),
      planAt: task.planAtBeijing, planAtMs: task.planAtMs, actualAtMs: now,
      minutesToKickoff: minutesToKick,
      morning: { league: task.league, tier: task.tier, kickoff: task.kickoff },
      latestOdds: odds, autoBet: false,
      decision: "待人工判断（自动流程不下单）",
      dataQuality: markets ? "接口赔率" : "接口未返回该场盘口",
    };
    const dir = path.join(EXP, "inplay");
    fs.mkdirSync(dir, { recursive: true });
    const fp = path.join(dir, `${date}_${String(task.eventId).replace(/[^\w\u4e00-\u9fa5-]/g, "_").slice(0, 40)}.json`);
    if (fs.existsSync(fp)) { log("WARN", `临场记录已存在，拒绝重复 event=${task.eventId}`); return { ok: false, reason: "duplicate" }; }
    writeJson(fp, rec);
    const st = readJson(statePath(), {});
    st.executed = st.executed || {};
    st.executed[task.eventId] = bj(now);
    writeJson(statePath(), st);
    log("INFO", `临场复核已记录 ${task.home} vs ${task.away} T-${minutesToKick}min → ${path.basename(fp)}`);
    return { ok: true, fp, minutesToKick };
  }
}

// ---------------------------------------------------------------- API 原生扫盘/赔率（子进程调用，凭据只在子进程内存）
const { spawnSync } = require("node:child_process");
function runApiSweep() {
  const r = spawnSync(process.execPath, ["tools/ky_api_engine.cjs"], { cwd: ROOT, encoding: "utf8", timeout: 240000 });
  if (r.error || r.status !== 0) {
    log("ERROR", "API扫盘失败: " + String(r.error || r.stderr || "").slice(0, 200));
    return { ok: false };
  }
  try {
    const out = JSON.parse(r.stdout.trim().split("\n").filter((l) => l.startsWith("{")).pop() || "{}");
    const st = readJson(statePath(), {});
    st.sweepDone = st.sweepDone || {};
    st.sweepDone[bjDate(nowMs())] = bj(nowMs());
    writeJson(statePath(), st);
    log("INFO", `API扫盘完成 plan=${out.plan} stats=${JSON.stringify(out.stats)}`);
    return { ok: true, ...out };
  } catch (e) { log("ERROR", "API扫盘输出解析失败: " + e.message); return { ok: false }; }
}
function readApiOdds(mid) {
  const r = spawnSync(process.execPath, ["tools/ky_api_engine.cjs", "--odds", String(mid)], { cwd: ROOT, encoding: "utf8", timeout: 120000 });
  if (r.error || r.status !== 0) return null;
  try { return JSON.parse(r.stdout.trim().split("\n").filter((l) => l.startsWith("{")).pop() || "{}"); } catch { return null; }
}

// ---------------------------------------------------------------- tick
async function tick({ forceSweep = false } = {}) {
  const now = nowMs();
  const date = bjDate(now);
  const st = readJson(statePath(), {});
  const minutes = bjMinutes(now);

  // 1) 扫盘：09:00 之后 2 分钟内且今日未做
  const sweepDue = forceSweep || (minutes >= 540 && minutes < 542 && !(st.sweepDone && st.sweepDone[date]));
  if (sweepDue) {
    await runApiSweep();
    return;
  }

  // 2) 临场：读取今日与昨日计划，找窗内且未执行任务
  const plans = [];
  for (const d of [date, bjDate(now - 86400000)]) {
    for (const f of fs.existsSync(SWEEP) ? fs.readdirSync(SWEEP) : []) {
      if ((f.startsWith(`plan_${d}`) || f.startsWith(`planApi_${d}`)) && f.endsWith(".json")) {
        plans.push(readJson(path.join(SWEEP, f), null));
      }
    }
  }
  const tasks = plans
    .filter((p) => p && (p.version === "sweep-plan-v2" || p.version === "sweep-plan-v4-api-native"))
    .flatMap((p) => (p.rechecks || []).map((t) => ({
      ...t,
      eventId: t.eventId || (t.mid ? `mid-${t.mid}` : null),
      planAtMs: Number.isFinite(t.planAtMs) ? t.planAtMs : (Number.isFinite(t.kickoffMs) ? t.kickoffMs - 30 * 60000 : NaN),
    })))
    .filter((t) => t && t.eventId && t.home && t.away && Number.isFinite(t.kickoffMs) && Number.isFinite(t.planAtMs));
  for (const t of tasks) {
    const executed = st.executed && st.executed[t.eventId];
    if (executed) continue;
    const dt = now - t.planAtMs;
    if (dt < 0) continue;                 // 未到计划时刻，不提前
    if (dt > 5 * 60000) {                 // 超窗 → 记 missed（只记一次）
      st.missed = st.missed || {};
      if (!st.missed[t.eventId]) {
        st.missed[t.eventId] = { at: bj(now), lateMin: Math.round(dt / 60000) };
        writeJson(statePath(), st);
        log("WARN", `临场任务错过 ${t.eventId} 超窗${Math.round(dt / 60000)}分钟，记 missed 不补做`);
      }
      continue;
    }
    await runInplay(t);
    return; // 一轮只做一个，避免长事务
  }
}

// ---------------------------------------------------------------- 导出（供测试）
module.exports = { parseMatches, tierOf, normLeague, selectAndPlan, makeRechecks, bj, bjMinutes };

// ---------------------------------------------------------------- main（仅在直接运行时启动）
if (require.main === module) {
  (async () => {
  const args = process.argv.slice(2);
  if (args.includes("--force-sweep") || args.includes("--once")) {
    const force = args.includes("--force-sweep");
    const r = await tick({ forceSweep: force });
    console.log("tick done");
    process.exit(0);
  }
  log("INFO", "守护启动（每30s tick；单页铁律）");
  for (;;) {
    try { await tick({}); } catch (e) { log("ERROR", "tick异常: " + e.message); }
    await new Promise((r) => setTimeout(r, 30000));
  }
  })();
}
