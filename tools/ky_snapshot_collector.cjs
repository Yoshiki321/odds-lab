/**
 * ky_snapshot_collector.cjs — 赛前快照采集器（只采集，不下注）
 * 用法:
 *   node tools/ky_snapshot_collector.cjs --once    跑一轮（发现+到点采集）
 *   node tools/ky_snapshot_collector.cjs           常驻循环（每 60s）
 *
 * 冻结规则：
 *  - 主窗口 [T-35, T-30]，取"响应完整返回时刻"落在窗口内的最新成功记录
 *  - 辅助窗口 [T-25, T-20] 单独记 aux，不并入主样本
 *  - 收盘窗口 [T-2, T-1] 记 closingOk，用于 CLV 配对
 *  - 窗口内无成功 → missing
 *  - 原始响应只增不改，写哈希；日志不含凭据
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const zlib = require("node:zlib");
const auth = require("./ky_api_auth.cjs");

const ROOT = path.resolve(__dirname, "..");
const EXP = path.join(ROOT, "data", "experiment_survival_100");
const SNAP = path.join(EXP, "snapshots");
const LOG = path.join(SNAP, "_log.jsonl");
const STATE = path.join(SNAP, "_state.json");

const MAIN_LO = 30, MAIN_HI = 35, AUX_LO = 20, AUX_HI = 25;
const CLOSING_LO = 1, CLOSING_HI = 4; // T-4m ~ T-1m 收盘参考价（3分钟宽防60s轮询跳过，保留最临近开赛一帧）
const CLOCK_TOLERANCE_MS = 5000;

const unwrap = (t) => {
  const j = JSON.parse(t);
  if (typeof j.data === "string" && j.data.startsWith("H4sI"))
    return JSON.parse(zlib.gunzipSync(Buffer.from(j.data, "base64")).toString("utf8"));
  return j;
};
const bj = (d) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(d);
const bjDate = (ms) => bj(new Date(ms)).slice(0, 10);
const log = (obj) => { fs.mkdirSync(SNAP, { recursive: true }); fs.appendFileSync(LOG, JSON.stringify(obj) + "\n", "utf8"); };
const readState = () => { try { return JSON.parse(fs.readFileSync(STATE, "utf8")); } catch { return { missing: {}, seen: {} }; } };
const writeState = (s) => { fs.mkdirSync(SNAP, { recursive: true }); fs.writeFileSync(STATE, JSON.stringify(s, null, 2), "utf8"); };

/** 纯函数：给定开赛时间与当前时刻，返回所属窗口 */
function windowOf(kickoffMs, nowMs) {
  const m = (kickoffMs - nowMs) / 60000;
  if (m >= MAIN_LO && m <= MAIN_HI) return "main";
  if (m >= AUX_LO && m <= AUX_HI) return "aux";
  if (m >= CLOSING_LO && m <= CLOSING_HI) return "closing";
  return null;
}

/** 纯函数：从尝试列表里选主样本（响应完成时刻在窗口内，取最新） */
function pickMain(attempts, kickoffMs) {
  const lo = kickoffMs - MAIN_HI * 60000;
  const hi = kickoffMs - MAIN_LO * 60000;
  const ok = attempts.filter((a) => a.ok && a.endMs >= lo && a.endMs <= hi);
  if (!ok.length) return null;
  return ok.reduce((a, b) => (b.endMs > a.endMs ? b : a));
}

async function fetchMatches() {
  const c = auth.load();
  if (!c) throw new Error("无凭据，先 node tools/ky_api_auth.cjs save");
  const t0 = c.templates.getOriginalDataPB;
  let lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const t0Start = Date.now();
    try {
      const r = await fetch(t0.url.replace(/t=\d+/, "t=" + Date.now()), { headers: t0.headers, signal: AbortSignal.timeout(10000) });
      const txt = await r.text();
      const t0End = Date.now();
      const j = JSON.parse(txt);
      const serverMs = Number(j.ts) || null;
      if (String(j.code) !== "0000000") {
        // 关键：鉴权/业务错误不再是“0 场可采”，必须显式失败并记录
        const e = new Error(`接口错误 code=${j.code} msg=${j.msg}`);
        e.code = String(j.code);
        throw e;
      }
      const obj = unwrap(txt);
      const leagues = new Map((obj.tids_obj || []).map((x) => [String(x.tid), x.tn]));
      const isVirtualLeague = (lg) => /PANDA|EAFC|VS-|2K|电子|虚拟/i.test(lg || "");
      const matches = (obj.matchsList || [])
        .filter((m) => String(m.csid) === "1")
        .map((m) => ({
          mid: String(m.mid), league: leagues.get(String(m.tid)) || "?",
          home: m.mhn, away: m.man, kickoffMs: Number(m.mgt),
        }))
        .filter((m) => Number.isFinite(m.kickoffMs) && !isVirtualLeague(m.league));
      return { matches, clock: { reqStartMs: t0Start, reqEndMs: t0End, serverMs, offsetMs: serverMs ? serverMs - t0End : null, attempts: attempt } };
    } catch (e) {
      lastErr = e;
      log({ type: "fetch_error", at: bj(new Date()), attempt, error: e.message, cause: e.cause && e.cause.code ? e.cause.code : null });
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  const e2 = new Error("赛程接口连续失败: " + (lastErr && lastErr.message));
  e2.code = lastErr && lastErr.code ? lastErr.code : null;
  throw e2;
}

async function collectOne(c, m, windowLabel, nowMs) {
  const t1 = c.templates.getMatchBaseInfoByOddsPB;
  const body = JSON.parse(t1.post || "{}"); body.mid = m.mid;
  const startMs = Date.now();
  let ok = false, reason = null, odds = null, serverMs = null, hash = null, rawText = null, endMs = startMs;
  try {
    const r = await fetch(t1.url, { method: t1.method, headers: t1.headers, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
    rawText = await r.text();
    endMs = Date.now();
    const j = JSON.parse(rawText);
    serverMs = Number(j.ts) || null;
    if (String(j.code) !== "0000000") {
      reason = `接口错误 code=${j.code} msg=${j.msg || ""}`;
    } else {
      const obj = unwrap(rawText);
      const mm = (obj.data || [])[0];
      if (!mm) { reason = "响应无该场"; }
      else {
        const groups = ((mm.playData && mm.playData.length ? mm.playData : mm.hpsData) || []).flatMap((x) => x.hps || []);
        const g = groups.find((x) => String(x.hpid) === "1" || String(x.hpid) === "37");
        const opts = (g && g.hl && g.hl.ol) || [];
        const get = (ot) => { const o = opts.find((x) => String(x.ot) === ot); return o ? Number(o.ov) / 100000 : null; };
        const h = get("1"), d = get("X"), a = get("2");
        const gAh = groups.find((x) => String(x.hpid) === "4");
        const ahOpts = (gAh && gAh.hl && gAh.hl.ol) || [];
        const ah = ahOpts.length >= 2 ? { line: gAh.hl.hv || "", h: Number(ahOpts[0].ov) / 100000, a: Number(ahOpts[1].ov) / 100000 } : null;
        const gOu = groups.find((x) => String(x.hpid) === "2");
        const ouOpts = (gOu && gOu.hl && gOu.hl.ol) || [];
        const ou = ouOpts.length >= 2 ? { line: gOu.hl.hv || "", over: Number(ouOpts[0].ov) / 100000, under: Number(ouOpts[1].ov) / 100000 } : null;
        if (h && d && a && h > 1 && d > 1 && a > 1) { odds = { h, d, a, ah, ou }; ok = true; } else reason = "独赢三项缺失";
      }
    }
    hash = crypto.createHash("sha256").update(rawText).digest("hex");
  } catch (e) { reason = "请求失败: " + e.message; endMs = Date.now(); }

  const rec = {
    matchId: m.mid, league: m.league, home: m.home, away: m.away,
    kickoffMs: m.kickoffMs, kickoffBJ: bj(new Date(m.kickoffMs)),
    window: windowLabel, reqStartMs: startMs, reqEndMs: endMs,
    schemaVersion: "v2-envelope",
    reqStartUtc: new Date(startMs).toISOString(), reqEndUtc: new Date(endMs).toISOString(),
    reqStartBJ: bj(new Date(startMs)), reqEndBJ: bj(new Date(endMs)),
    serverMs, clockOffsetMs: serverMs ? serverMs - endMs : null,
    ok, reason, odds, hash, minutesBeforeKickoffAtEnd: +((m.kickoffMs - endMs) / 60000).toFixed(2),
  };
  return { rec, rawText };
}

async function runOnce() {
  const c = auth.load();
  if (!c) throw new Error("无凭据");
  const { matches, clock } = await fetchMatches();
  const now = Date.now();
  const due = matches.filter((m) => windowOf(m.kickoffMs, now));
  const state = readState();
  const results = [];

  // 记录时钟状态
  log({ type: "clock", at: bj(new Date(now)), serverMs: clock.serverMs, offsetMs: clock.offsetMs, ok: clock.offsetMs !== null && Math.abs(clock.offsetMs) <= CLOCK_TOLERANCE_MS });

  // 首次观测记录：missing 只在“采集器本来有机会看到主窗口”时才成立
  const firstSeen = state.firstSeen || (state.firstSeen = {});
  for (const m of matches) {
    if (!firstSeen[m.mid]) firstSeen[m.mid] = { at: bj(new Date(now)), atMs: now, kickoff: bj(new Date(m.kickoffMs)) };
  }

  // missing 判定：只统计“主窗口开启前已被观测到、且过了主窗口仍无主样本”的近期比赛（24h 内）
  const mainOk = state.mainOk || (state.mainOk = {});
  for (const m of matches) {
    const minsToKick = (m.kickoffMs - now) / 60000;
    const passed = minsToKick < MAIN_LO && minsToKick > -24 * 60;
    const key = `${m.mid}`;
    const hadChance = firstSeen[key] && firstSeen[key].atMs <= m.kickoffMs - MAIN_HI * 60000;
    if (passed && hadChance && !mainOk[key] && !state.missing[key]) {
      state.missing[key] = { at: bj(new Date(now)), kickoff: bj(new Date(m.kickoffMs)), reason: "窗口内无成功采集", firstSeenAt: firstSeen[key].at };
      log({ type: "missing", matchId: m.mid, league: m.league, home: m.home, away: m.away, kickoffBJ: bj(new Date(m.kickoffMs)), at: bj(new Date(now)) });
    }
  }

  // 性能优化（基于 2026-11-23 遥测分析：23:00 高峰串行重采导致 228 场漏采）：
  // 1) 已命中 mainOk/auxOk 的场次直接跳过，不再在 5 分钟窗口内反复重采
  // 2) 以并发度 5 批处理，将高峰 40 场耗时从 ~60s 降至 ~8s
  const todo = due.filter((m) => {
    const w = windowOf(m.kickoffMs, now);
    if (w === "main" && state.mainOk && state.mainOk[m.mid]) return false;
    if (w === "aux" && state.auxOk && state.auxOk[m.mid]) return false;
    return Boolean(w);
  });

  const CONCURRENCY = 5;
  for (let idx = 0; idx < todo.length; idx += CONCURRENCY) {
    const chunk = todo.slice(idx, idx + CONCURRENCY);
    const batchOut = await Promise.all(chunk.map(async (m) => {
      const w = windowOf(m.kickoffMs, now);
      const { rec, rawText } = await collectOne(c, m, w, now);
      return { m, rec, rawText };
    }));
    for (const { m, rec, rawText } of batchOut) {
      if (rawText) {
        const dir = path.join(SNAP, bjDate(m.kickoffMs));
        fs.mkdirSync(dir, { recursive: true });
        const fp = path.join(dir, `${bj(new Date(rec.reqEndMs)).replace(/[-: ]/g, "").slice(8, 14)}_${m.mid}_${rec.hash.slice(0, 8)}.json`);
        if (!fs.existsSync(fp)) fs.writeFileSync(fp, rawText, "utf8");
        rec.rawFile = path.relative(ROOT, fp);
      }
      const actualWin = windowOf(m.kickoffMs, rec.reqEndMs);
      rec.windowAtEnd = actualWin;
      log({ type: "attempt", ...rec });
      if (rec.ok && actualWin && rec.clockOffsetMs !== null && Math.abs(rec.clockOffsetMs) <= CLOCK_TOLERANCE_MS) {
        const srec = { at: bj(new Date(rec.reqEndMs)), window: actualWin, endBJ: rec.reqEndBJ, endMs: rec.reqEndMs, odds: rec.odds, rawFile: rec.rawFile };
        state.seen[m.mid] = srec;
        if (actualWin === "main") {
          const mo = state.mainOk || (state.mainOk = {});
          if (!mo[m.mid]) mo[m.mid] = srec;
        } else if (actualWin === "closing") {
          const co = state.closingOk || (state.closingOk = {});
          co[m.mid] = srec;
        } else {
          (state.auxOk || (state.auxOk = {}))[m.mid] = srec;
        }
      }
      results.push(rec);
    }
  }
  state.heartbeat = { at: bj(new Date()), atMs: now, dueCount: due.length, clockOffsetMs: clock.offsetMs };
  state.authError = null;
  writeState(state);
  return { due: due.length, results, clock };
}

module.exports = { windowOf, pickMain, runOnce, MAIN_LO, MAIN_HI, AUX_LO, AUX_HI, CLOSING_LO, CLOSING_HI, CLOCK_TOLERANCE_MS };

if (require.main === module) {
  (async () => {
    if (process.argv.includes("--once")) {
      const r = await runOnce();
      console.log(JSON.stringify({ due: r.due, clock: r.clock, results: r.results.map((x) => ({ mid: x.matchId, window: x.window, ok: x.ok, reason: x.reason, minutes: x.minutesBeforeKickoffAtEnd })) }, null, 2));
      process.exit(0);
    }
    console.log("采集器常驻启动（60s 一轮）");
    let lastErrLogMs = 0;
    for (;;) {
      try { const r = await runOnce(); if (r.due) console.log(JSON.stringify({ at: bj(new Date()), due: r.due })); }
      catch (e) {
        const rec = { type: "api_error", at: bj(new Date()), code: e.code || null, error: e.message };
        if (Date.now() - lastErrLogMs > 10 * 60000) { log(rec); lastErrLogMs = Date.now(); }
        try { const s = readState(); s.authError = { at: rec.at, code: rec.code, msg: e.message }; writeState(s); } catch {}
        console.error("ERR " + e.message);
      }
      await new Promise((res) => setTimeout(res, 60000));
    }
  })();
}
