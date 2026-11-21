/**
 * ky_virtual_live.cjs — 滚球虚拟单（不花钱）：扫盘→按低抽水选→记录→用最后可见比分结算
 * 用法: node tools/ky_virtual_live.cjs [--once]
 * 存储: data/experiment_survival_100/virtual/live_virtual.json
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const auth = require("./ky_api_auth.cjs");

const EXP = path.join(__dirname, "..", "data", "experiment_survival_100");
const STORE = path.join(EXP, "virtual", "live_virtual.json");
const unwrap = (t) => { const j = JSON.parse(t); return typeof j.data === "string" && j.data.startsWith("H4sI") ? JSON.parse(zlib.gunzipSync(Buffer.from(j.data, "base64")).toString("utf8")) : j; };
const bj = (d) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d);
const o2n = (v) => Number(v) / 100000;

function load() { try { return JSON.parse(fs.readFileSync(STORE, "utf8")); } catch { return { createdAt: new Date().toISOString(), bets: [] }; } }
function save(s) { fs.mkdirSync(path.dirname(STORE), { recursive: true }); fs.writeFileSync(STORE, JSON.stringify(s, null, 2), "utf8"); }

async function fetchAll() {
  const c = auth.load();
  const t0 = c.templates.getOriginalDataPB;
  return unwrap(await (await fetch(t0.url.replace(/t=\d+/, "t=" + Date.now()), { headers: t0.headers })).text());
}
async function fetchOdds(mid) {
  const c = auth.load();
  const t1 = c.templates.getMatchBaseInfoByOddsPB;
  const b = JSON.parse(t1.post || "{}"); b.mid = String(mid);
  const o = unwrap(await (await fetch(t1.url, { method: t1.method, headers: t1.headers, body: JSON.stringify(b) })).text());
  return (o.data || [])[0] || null;
}
function vigOf(opts) {
  if (!opts || opts.length < 2) return null;
  return opts.reduce((s, x) => s + 1 / x.odds, 0);
}
function scoreOf(m) {
  const a = m.msc || [];
  const g = (id) => { const h = a.find((x) => String(x).startsWith("S" + id + "|")); return h ? h.split("|")[1] : null; };
  return g(1) || g(2) || null;
}

async function pass() {
  const s = load();
  const all = await fetchAll();
  const now = Date.now();
  // 只做真实比赛：排除电子足球/电子篮球与 VS-/PANDA/EAFC/2K 类虚拟赛事
  const isVirtual = (m) => {
    const t = `${m.tnjc || ""} ${m.tna || ""}`;
    return /PANDA|EAFC|VS-|2K|电子|虚拟/.test(t);
  };
  const leagues = new Map((all.tids_obj || []).map((x) => [String(x.tid), x.tn]));
  const live = (all.matchsList || []).filter((m) => {
    const t = Number(m.mgt);
    if (!Number.isFinite(t) || t > now || t <= now - 4 * 3600e3) return false;
    if (["190", "191"].includes(String(m.csid))) return false; // 电子足球/电子篮球
    return !isVirtual(m);
  }).slice(0, 30);

  const openBets = s.bets.filter((b) => b.status === "open");
  // 结算：比赛不在 live 列表里 或 已有终场比分
  for (const b of openBets) {
    const still = live.find((m) => String(m.mid) === String(b.mid));
    if (still) {
      const sc = scoreOf(still);
      if (sc) b.lastScore = sc;
      continue;
    }
    // 不见了 → 用最后一次记录比分结算
    if (!b.lastScore) { b.status = "void"; b.note = "无终场比分，判无效"; continue; }
    const [h, a] = b.lastScore.split(":").map(Number);
    const margin = h - a;
    if (b.market === "ml") {
      const homeWin = margin > 0;
      b.status = (b.side === "1" ? homeWin : !homeWin) ? "win" : "lose";
      b.pnl = b.status === "win" ? +(b.stake * (b.odds - 1)).toFixed(2) : -b.stake;
    } else if (b.market === "hcp") {
      const line = Number(b.line);
      const adj = margin + (b.side === "1" ? line : -line);
      b.status = adj > 0 ? "win" : adj < 0 ? "lose" : "push";
      b.pnl = b.status === "win" ? +(b.stake * (b.odds - 1)).toFixed(2) : b.status === "lose" ? -b.stake : 0;
    }
    b.settledAt = new Date().toISOString();
    b.finalScore = b.lastScore;
  }

  // 新开虚拟单：每轮最多 2 单，只做抽水<1.07 的独赢/让分
  let added = 0;
  for (const m of live) {
    if (added >= 2) break;
    if (s.bets.some((b) => String(b.mid) === String(m.mid) && b.status === "open")) continue;
    if (s.bets.filter((b) => String(b.mid) === String(m.mid)).length >= 2) continue;
    let mm; try { mm = await fetchOdds(m.mid); } catch { continue; }
    if (!mm) continue;
    const groups = ((mm.playData && mm.playData.length ? mm.playData : mm.hpsData) || []).flatMap((x) => x.hps || []);
    const cands = [];
    for (const g of groups) {
      const hid = String(g.hpid);
      const opts = (g.hl.ol || []).map((x) => ({ ot: x.ot, odds: o2n(x.ov), line: g.hl.hv }));
      const vig = vigOf(opts);
      if (vig == null || vig > 1.07) continue;
      if (!["1", "37"].includes(hid) && !["4", "39"].includes(hid)) continue;
      for (const o of opts) cands.push({ market: ["4", "39"].includes(hid) ? "hcp" : "ml", side: o.ot, odds: o.odds, line: o.line, vig });
    }
    if (!cands.length) continue;
    cands.sort((a, b) => a.vig - b.vig);
    const pick = cands[0];
    const sc = scoreOf(mm);
    s.bets.push({
      id: `VL-${String(s.bets.length + 1).padStart(4, "0")}`,
      mid: String(m.mid), league: m.tnjc || leagues.get(String(m.tid)) || "?", home: mm.mhn, away: mm.man,
      market: pick.market, side: pick.side, line: pick.line, odds: pick.odds, vig: +pick.vig.toFixed(4),
      stake: 2, status: "open", openedAt: new Date().toISOString(), openedBJ: bj(new Date()),
      openScore: sc || null, lastScore: sc || null,
    });
    added++;
  }
  save(s);
  const stats = summarize(s);
  console.log(JSON.stringify({ ok: true, passAt: new Date().toISOString(), scoredMatches: live.length, added, ...stats }, null, 1));
  return s;
}
function leagues(m) { return "?"; }
function summarize(s) {
  const settled = s.bets.filter((b) => ["win", "lose", "push", "void"].includes(b.status));
  const open = s.bets.filter((b) => b.status === "open");
  const pnl = settled.reduce((x, b) => x + (b.pnl || 0), 0);
  const wins = settled.filter((b) => b.status === "win").length;
  return { total: s.bets.length, settled: settled.length, open: open.length, wins, winRate: settled.length ? +(wins / settled.length * 100).toFixed(1) : null, pnl: +pnl.toFixed(2) };
}

(async () => {
  const once = process.argv.includes("--once");
  if (once) { await pass(); process.exit(0); }
  for (;;) { try { await pass(); } catch (e) { console.error("ERR " + e.message); } await new Promise((r) => setTimeout(r, 120000)); }
})();
