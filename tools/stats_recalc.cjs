// tools/stats_recalc.cjs — audit_2026-11-18.md §3 统计结论复算脚本
// 只读汇总数字做复算，不读账本、不写盘、无外部依赖。
// 用法: node tools/stats_recalc.cjs
'use strict';

function f(x, d) { return Number(x).toFixed(d); }

console.log('=== [1] 每注期望复算 (§3.2) ===');
const rows = [
  { name: 'A', n: 191, w: 42, odds: 3.18 },
  { name: 'B', n: 211, w: 34, odds: 5.3 },
];
for (const r of rows) {
  const p = r.w / r.n;
  const q = 1 - p;
  const ev = p * r.odds;
  console.log(`策略${r.name}: p=${r.w}/${r.n}=${f(p, 6)}, q=${f(q, 6)}, `
    + `EV/注=p*odds=${f(p, 6)}*${r.odds}=${f(ev, 6)}, 净=${f(ev - 1, 6)}/注`);
}

console.log('');
console.log('=== [2] 长连输概率复算 (§3.3, 独立同p假设) ===');
function streakExact(n, p, k) {
  const q = 1 - p;
  let a = new Array(k).fill(0); a[0] = 1;
  for (let i = 0; i < n; i++) {
    const b = new Array(k).fill(0);
    for (let j = 0; j < k; j++) {
      b[0] += a[j] * p;
      if (j + 1 < k) b[j + 1] += a[j] * q;
      // 落到 a[k-1]*q 的质量即首次触达 k 连输, 不再跟踪(只求"至少一次")
    }
    a = b;
  }
  const pNo = a.reduce((s, x) => s + x, 0);
  return 1 - pNo;
}
const streaks = [
  { name: 'A', n: 191, w: 42, k: 14 },
  { name: 'B', n: 211, w: 34, k: 25 },
];
for (const s of streaks) {
  const p = s.w / s.n;
  const q = 1 - p;
  const qk = Math.pow(q, s.k);
  const m = s.n - s.k + 1;
  const approx = 1 - Math.pow(1 - qk, m);
  const exact = streakExact(s.n, p, s.k);
  console.log(`策略${s.name}: N=${s.n}, p=${s.w}/${s.n}=${f(p, 6)}, `
    + `q=${f(q, 6)}, q^${s.k}=${f(qk, 6)}, 窗口数=${m}, `
    + `近似P=${f(approx, 6)}, 精确递推P=${f(exact, 6)}`);
}

console.log('');
console.log('=== [3] 样本量功效复算 (§5.4: H0=25% vs H1=30%, 单样本比例) ===');
const Z_A_ONE = 1.6448536269514722; // 单侧 alpha=0.05
const Z_A_TWO = 1.959963984540054;  // 双侧 alpha=0.05
const Z_B80 = 0.8416212335729143;   // power=0.8
const p0 = 0.25, p1 = 0.30, ODDS = 3.0;
function nNormal(a, b) {
  const num = a * Math.sqrt(p0 * (1 - p0)) + b * Math.sqrt(p1 * (1 - p1));
  return Math.pow(num / (p1 - p0), 2);
}
const nOne = nNormal(Z_A_ONE, Z_B80);
const nTwo = nNormal(Z_A_TWO, Z_B80);
console.log(`正态近似公式: n=[(z_a*sqrt(p0(1-p0))+z_b*sqrt(p1(1-p1)))/(p1-p0)]^2`);
console.log(`代入: p0=${p0}, p1=${p1}, z_a(单侧)=${f(Z_A_ONE, 4)}, z_b=${f(Z_B80, 4)}`
  + ` -> n=${f(nOne, 2)} (向上取整 ${Math.ceil(nOne)})`);
console.log(`代入: z_a(双侧)=${f(Z_A_TWO, 4)} -> n=${f(nTwo, 2)} (向上取整 ${Math.ceil(nTwo)})`);
console.log(`赔率${ODDS}固定时: H0下EV=${f(p0 * ODDS, 4)} (净${f(p0 * ODDS - 1, 4)}), `
  + `H1下EV=${f(p1 * ODDS, 4)} (净${f(p1 * ODDS - 1, 4)}), 均为负`);

// 精确二项搜索: 最小 n 使存在临界值 c 满足 P_p0(X>=c)<=0.05 且 P_p1(X>=c)>=0.8
function exactN(pa, pb, alpha, power) {
  const ra = pa / (1 - pa), rb = pb / (1 - pb);
  for (let n = 10; n < 10000; n++) {
    const fa = new Array(n + 1); const fb = new Array(n + 1);
    fa[0] = Math.exp(n * Math.log1p(-pa));
    fb[0] = Math.exp(n * Math.log1p(-pb));
    for (let k = 0; k < n; k++) {
      fa[k + 1] = fa[k] * (n - k) / (k + 1) * ra;
      fb[k + 1] = fb[k] * (n - k) / (k + 1) * rb;
    }
    let t0 = 0, t1 = 0, c = -1, size = 0, pw = 0;
    for (let k = n; k >= 0; k--) {
      t0 += fa[k]; t1 += fb[k];
      if (t0 <= alpha) { c = k; size = t0; pw = t1; }
    }
    if (c > 0 && pw >= power) return { n, c, size, pw };
  }
  return null;
}
const ex = exactN(p0, p1, 0.05, 0.8);
console.log(`精确二项搜索(单侧alpha=0.05,power=0.8): n=${ex.n}, c=${ex.c}, `
  + `实际size=${f(ex.size, 6)}, 实际power=${f(ex.pw, 6)}`);
console.log('');
console.log('复算完成: 以上均为纯算术输出, 未读逐注/账本数据。');
