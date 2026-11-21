/**
 * tools/pricing.cjs — Odds-Lab 统一定价、去水、精确 EV、凯利注码与 CLV 内核（CJS 版，与 app/src/shared/pricing.ts 同构）
 */
"use strict";

function validOddsList(odds) {
  return Array.isArray(odds) && odds.length >= 2 && odds.every((o) => Number.isFinite(o) && o > 1);
}

function devigProportional(odds) {
  if (!validOddsList(odds)) return null;
  const inv = odds.map((o) => 1 / o);
  const sum = inv.reduce((s, x) => s + x, 0);
  if (!(sum > 0)) return null;
  return { probs: inv.map((x) => x / sum), overround: +(sum - 1).toFixed(6), method: "proportional" };
}

function devigPower(odds) {
  if (!validOddsList(odds)) return null;
  const inv = odds.map((o) => 1 / o);
  const sum1 = inv.reduce((s, x) => s + x, 0);
  if (Math.abs(sum1 - 1) < 1e-9) return { probs: inv, overround: 0, method: "power", exponent: 1 };
  let lo = 0.01, hi = 20.0;
  const evalSum = (k) => inv.reduce((s, x) => s + Math.pow(x, k), 0);
  if (evalSum(lo) < 1 || evalSum(hi) > 1) return devigProportional(odds);
  for (let i = 0; i < 64; i++) {
    const mid = (lo + hi) / 2;
    if (evalSum(mid) > 1) lo = mid;
    else hi = mid;
  }
  const k = (lo + hi) / 2;
  const raw = inv.map((x) => Math.pow(x, k));
  const norm = raw.reduce((s, x) => s + x, 0);
  return { probs: raw.map((x) => x / norm), overround: +(sum1 - 1).toFixed(6), method: "power", exponent: +k.toFixed(6) };
}

function calcThreeStateEV(p, execOdds) {
  if (!p || !Number.isFinite(execOdds) || execOdds <= 1) return null;
  const sum = p.pWin + p.pPush + p.pLose;
  if (!Number.isFinite(sum) || Math.abs(sum - 1) > 1e-4) return null;
  return p.pWin * (execOdds - 1) - p.pLose;
}

function calcHandicapOrTotalEV(line, execOdds, probAtLine) {
  if (!Number.isFinite(line) || !Number.isFinite(execOdds) || execOdds <= 1) return null;
  const scaled = Math.round(line * 4);
  if (Math.abs(line * 4 - scaled) > 1e-6) return null;
  if (scaled % 2 !== 0) {
    const lo = probAtLine(line - 0.25);
    const hi = probAtLine(line + 0.25);
    if (!lo || !hi) return null;
    const evLo = calcThreeStateEV(lo, execOdds);
    const evHi = calcThreeStateEV(hi, execOdds);
    if (evLo == null || evHi == null) return null;
    return 0.5 * evLo + 0.5 * evHi;
  }
  const single = probAtLine(line);
  if (!single) return null;
  return calcThreeStateEV(single, execOdds);
}

function calcBinaryEV(modelProb, execOdds) {
  if (!Number.isFinite(modelProb) || modelProb <= 0 || modelProb >= 1) return null;
  if (!Number.isFinite(execOdds) || execOdds <= 1) return null;
  return modelProb * execOdds - 1;
}

function fractionalKelly(ev, execOdds, fraction = 0.25, minEv = 0.025, maxCap = 0.10) {
  if (!Number.isFinite(ev) || !Number.isFinite(execOdds) || execOdds <= 1) return 0;
  if (ev <= minEv) return 0;
  const raw = (ev / (execOdds - 1)) * fraction;
  return Math.max(0, Math.min(maxCap, raw));
}

function calcCLV(execOdds, closingFairProb) {
  if (!Number.isFinite(execOdds) || execOdds <= 1) return null;
  if (!Number.isFinite(closingFairProb) || closingFairProb <= 0 || closingFairProb >= 1) return null;
  return +(closingFairProb * execOdds - 1).toFixed(6);
}

module.exports = {
  devigProportional,
  devigPower,
  calcThreeStateEV,
  calcHandicapOrTotalEV,
  calcBinaryEV,
  fractionalKelly,
  calcCLV,
};
