/**
 * audit247_review.ts — 复核 247 场审计报告：分组样本量、置信区间、能否复现
 * 用法: node app/tools/audit247_review.ts
 * 输出: data/experiment_survival_100/AUDIT_247_REVIEW.md 的控制台摘要（不写账本）
 */
import { readFileSync } from 'node:fs';

interface Band { n: number; hit: number; pct: number; avgOdds: number; roiFlat: number }

function wilson(k: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 1];
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const center = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [(center - margin) / denom, (center + margin) / denom];
}

/** ROI 的近似标准误：按等额投注，单注收益为 (odds-1) 或 -1 */
function roiSe(b: Band): number {
  const p = b.n ? b.hit / b.n : 0;
  const win = b.avgOdds - 1;
  const lose = -1;
  const mean = p * win + (1 - p) * lose;
  const varUnit = p * (win - mean) ** 2 + (1 - p) * (lose - mean) ** 2;
  return Math.sqrt(varUnit / Math.max(b.n, 1));
}

const raw = JSON.parse(readFileSync('data/audit/audit-2026-09-20.json', 'utf8'));
const bands: Record<string, Band> = raw.bands;
const ev = raw.evGate;

console.log('=== 247 场审计复核 ===');
console.log(`覆盖天数 ${raw.days.length}（${raw.days[0]} ~ ${raw.days[raw.days.length - 1]}），已结算 ${raw.settled} 场`);
console.log('');

console.log('--- EV 门分组 ---');
for (const [k, b] of Object.entries(ev) as [string, Band][]) {
  const [lo, hi] = wilson(b.hit, b.n);
  const se = roiSe(b);
  const roiLo = b.roiFlat - 1.96 * se;
  const roiHi = b.roiFlat + 1.96 * se;
  console.log(
    `${k.padEnd(5)} n=${String(b.n).padStart(3)} 命中=${String(b.hit).padStart(3)} ` +
    `命中率=${(b.hit / b.n * 100).toFixed(1)}% [95%CI ${(lo * 100).toFixed(1)}~${(hi * 100).toFixed(1)}%] ` +
    `ROI=${(b.roiFlat * 100).toFixed(1)}% [近似95%CI ${(roiLo * 100).toFixed(0)}~${(roiHi * 100).toFixed(0)}%]`
  );
}

console.log('');
console.log('--- 评分档位 ---');
for (const [k, b] of Object.entries(bands) as [string, Band][]) {
  const [lo, hi] = wilson(b.hit, b.n);
  console.log(`${k.padEnd(10)} n=${String(b.n).padStart(3)} 命中率=${(b.hit / b.n * 100).toFixed(1)}% [95%CI ${(lo * 100).toFixed(1)}~${(hi * 100).toFixed(1)}%] ROI=${(b.roiFlat * 100).toFixed(1)}%`);
}

console.log('');
console.log('--- 可复现性 ---');
const hasRows = Array.isArray((raw as any).rows) || Array.isArray((raw as any).matches);
console.log('聚合文件是否含逐场明细:', hasRows ? '是' : '否 → 247 场结论无法从该文件复现');
console.log('分组是否互斥且合计=总数:',
  Object.values(ev as Record<string, Band>).reduce((s, b) => s + b.n, 0) === raw.settled &&
  Object.values(bands).reduce((s, b) => s + b.n, 0) === raw.settled ? '是' : '否');
