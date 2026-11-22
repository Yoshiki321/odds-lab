/**
 * ky_ev_scan.cjs — 纯接口扫盘 + 用盘口算 EV（只读，不下单）
 * 逻辑：独赢三项去水 → 拟合独立泊松(λh,λa) → 算让球线覆盖概率 → 对比让球赔率算 EV
 * 用法: node tools/ky_ev_scan.cjs [hours=6] [minEv=0.02]
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const https = require("node:https");

const ROOT = path.resolve(__dirname, "..");
const CRED = path.join(ROOT, "data", "experiment_survival_100", "runtime", "api_credentials.json");
const VIRTUAL = /梦幻|虚拟|电子|电竞|PANDA|EAFC|VS-|2K/i;

function get(u, h) {
  return new Promise((res, rej) => {
    https.get(u, { rejectUnauthorized: false, headers: h }, (r) => {
      let d = ""; r.on("data", (x) => d += x); r.on("end", () => res(d));
    }).on("error", rej);
  });
}
function post(u, b, h) {
  return new Promise((res, rej) => {
    const d = JSON.stringify(b);
    const r = https.request(u, { method: "POST", rejectUnauthorized: false, headers: { ...h, "Content-Length": Buffer.byteLength(d) } }, (rr) => {
      let s = ""; rr.on("data", (x) => s += x); rr.on("end", () => res(s));
    });
    r.on("error", rej); r.write(d); r.end();
  });
}
function unwrap(t) {
  const j = JSON.parse(t);
  if (typeof j.data === "string" && j.data.startsWith("H4sI")) return JSON.parse(zlib.gunzipSync(Buffer.from(j.data, "base64")).toString("utf8"));
  return j;
}
function pois(l, k) { let p = Math.exp(-l); for (let i = 1; i <= k; i++) p *= l / i; return p; }
function poissonArr(l, K) { const a = new Array(K + 1); for (let k = 0; k <= K; k++) a[k] = pois(l, k); return a; }
function skellamLe(lh, la, t, K = 20) {
  const ph = poissonArr(lh, K), pa = poissonArr(la, K);
  let s = 0;
  for (let m = -K; m <= t; m++) {
    let p = 0;
    for (let j = 0; j <= K; j++) { const k = j - m; if (k >= 0 && k <= K) p += ph[j] * pa[k]; }
    s += p;
  }
  return s;
}
function coverProb(lh, la, line) {
  // 主队视角 line；quarter 拆两半；返回主队 {pWin,pPush}
  const isQ = Math.abs(line * 4 - Math.round(line * 4)) > 1e-9 && Math.abs(line * 2 - Math.round(line * 2)) > 1e-9;
  const lines = isQ ? [line - 0.25, line + 0.25] : [line];
  let pWin = 0, pPush = 0;
  for (const L of lines) {
    const pLe = skellamLe(lh, la, Math.ceil(-L) - 1); // M <= ceil(-L)-1 不覆盖
    let pP = 0;
    const mPush = -L;
    if (Number.isInteger(mPush)) {
      const ph = poissonArr(lh, 20), pa = poissonArr(la, 20);
      for (let j = 0; j <= 20; j++) { const k = j - mPush; if (k >= 0 && k <= 20) pP += ph[j] * pa[k]; }
    }
    pWin += (1 - pLe - pP) / lines.length;
    pPush += pP / lines.length;
  }
  return { pWin, pPush };
}
function evOf(pWin, pPush, odds) {
  return pWin * (odds - 1) + pPush * 0 - (1 - pWin - pPush) * 1;
}
function fitLambdas(pH, pD, pA) {
  let best = null;
  for (let lh = 0.2; lh <= 3.6; lh += 0.1) {
    for (let la = 0.2; la <= 3.6; la += 0.1) {
      const pHat = 1 - skellamLe(lh, la, 0);
      const pDraw = skellamLe(lh, la, 0) - skellamLe(lh, la, -1);
      const pAat = skellamLe(lh, la, -1);
      const err = (pHat - pH) ** 2 + (pDraw - pD) ** 2 + (pAat - pA) ** 2;
      if (!best || err < best.err) best = { lh, la, err };
    }
  }
  // 局部精化
  let b = best;
  for (let lh = b.lh - 0.1; lh <= b.lh + 0.1; lh += 0.01) {
    for (let la = b.la - 0.1; la <= b.la + 0.1; la += 0.01) {
      if (lh < 0.1 || la < 0.1) continue;
      const pHat = 1 - skellamLe(lh, la, 0);
      const pDraw = skellamLe(lh, la, 0) - skellamLe(lh, la, -1);
      const pAat = skellamLe(lh, la, -1);
      const err = (pHat - pH) ** 2 + (pDraw - pD) ** 2 + (pAat - pA) ** 2;
      if (err < b.err) b = { lh, la, err };
    }
  }
  return b;
}

(async () => {
  const hours = Number(process.argv[2] || 6);
  const minEv = Number(process.argv[3] || 0.02);
  const c = JSON.parse(fs.readFileSync(CRED, "utf8"));
  const t = c.templates.getOriginalDataPB;
  const d = unwrap(await get(t.url.replace(/t=\d+/, "t=" + Date.now()), t.headers));
  const ml = d.matchsList || [];
  const now = Date.now();
  const fut = ml.filter((m) => {
    const k = Number(m.mgt);
    return k > now + 15 * 60000 && k < now + hours * 3600e3 && String(m.csid) === "1";
  }).sort((a, b) => Number(a.mgt) - Number(b.mgt));

  const t2 = c.templates.getMatchBaseInfoByOddsPB;
  const rows = [];
  for (const m of fut.slice(0, 200)) {
    const league = String(m.tnjc || "");
    if (VIRTUAL.test(league) || VIRTUAL.test(String(m.mhn || ""))) continue;
    let base;
    try {
      const body = Object.assign(JSON.parse(t2.post || "{}"), { mid: m.mid });
      const dd = unwrap(await post(t2.url.replace(/t=\d+/, "t=" + Date.now()), body, t2.headers));
      base = (Array.isArray(dd) ? dd : (dd && dd.data) || [])[0];
    } catch { continue; }
    if (!base || !base.mgt) continue;
    const groups = ((base.playData && base.playData.length ? base.playData : base.hpsData) || []).flatMap((x) => x.hps || []);
    const names = {};
    for (const p of base.hpsPns || []) names[p.hpid] = p.hpn;
    const ml1 = groups.find((g) => names[g.hpid] === "全场独赢" || String(g.hpid) === "1");
    const hc1 = groups.find((g) => names[g.hpid] === "全场让球" || String(g.hpid) === "4");
    if (!ml1 || !hc1 || !ml1.hl || !hc1.hl) continue;
    const o1 = ml1.hl.ol || [], oh = hc1.hl.ol || [];
    const H = Number(o1.find((o) => o.ot === "1")?.ov) / 1e5;
    const D = Number(o1.find((o) => o.ot === "X")?.ov) / 1e5;
    const A = Number(o1.find((o) => o.ot === "2")?.ov) / 1e5;
    if (!(H > 1 && D > 1 && A > 1)) continue;
    const invH = 1 / H, invD = 1 / D, invA = 1 / A, z = invH + invD + invA;
    const pH = invH / z, pD = invD / z, pA = invA / z;
    const fit = fitLambdas(pH, pD, pA);
    const line = Number(hc1.hl.hv);
    if (!Number.isFinite(line)) continue;
    for (const o of oh) {
      const odds = Number(o.ov) / 1e5;
      if (!(odds > 1)) continue;
      let pWin, pPush;
      const r = coverProb(fit.lh, fit.la, line); // 主队视角
      if (o.ot === "1") { pWin = r.pWin; pPush = r.pPush; }
      else { pWin = 1 - r.pWin - r.pPush; pPush = r.pPush; } // 客队：主队输=客队赢
      const ev = evOf(pWin, pPush, odds);
      rows.push({
        mid: m.mid, league: String(base.tnjc || ""), home: m.mhn, away: m.man,
        kickoff: new Date(Number(m.mgt) + 8 * 3600e3).toISOString().slice(0, 16).replace("T", " "),
        line, side: o.ot === "1" ? "主" : "客", odds: +odds.toFixed(2),
        pH: +pH.toFixed(3), pD: +pD.toFixed(3), pA: +pA.toFixed(3),
        pWin: +pWin.toFixed(3), pPush: +pPush.toFixed(3), ev: +(ev * 100).toFixed(2),
        lh: +fit.lh.toFixed(2), la: +fit.la.toFixed(2),
      });
    }
  }
  const TIER=/英超|西甲|意甲|德甲|法甲|欧冠|欧联|欧国联|英冠|德乙|西乙|葡超|荷甲|巴甲|美职|土超|澳超|日职|日联|韩K|荷乙|沙超/;
  for(const r of rows) r.tier=TIER.test(r.league);
  rows.sort((a, b) => b.ev - a.ev);
  const good = rows.filter((r) => r.ev >= minEv * 100);
  console.log("scanned=" + rows.length + " candidates=" + good.length);
  for (const r of good.slice(0, 10)) console.log(JSON.stringify(r));
  if (!good.length) for (const r of rows.slice(0, 5)) console.log("best_negative " + JSON.stringify(r));
})().catch((e) => { console.error("ERR " + e.message); process.exit(1); });
