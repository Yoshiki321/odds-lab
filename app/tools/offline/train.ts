/**
 * 离线训练 / 校准（纯本地，不联网、不开服务）
 *
 * 数据源：data/history/football/<YYYY-MM-DD>.json（竞彩历史：胜平负赔率 + 让球线 + 比分 + 赛果）
 * 输出：控制台表格（不落文件），带样本量与 95% 置信区间，避免小样本过度解读。
 *
 * 用法：
 *   npx tsx tools/offline/train.ts
 *   npx tsx tools/offline/train.ts --league 英超
 *   npx tsx tools/offline/train.ts --from 2026-05-01 --to 2026-08-29
 *   npx tsx tools/offline/train.ts --split 0.7     # 前70% / 后30% 稳定性对照
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(HERE, '..', '..', '..', 'data');
const HIST = path.join(DATA, 'history', 'football');

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : def;
}

interface Rec {
  date: string; league: string; home: string; away: string;
  oh: number; od: number; oa: number; line: number | null;
  hg: number; ag: number;
  had: 'H' | 'D' | 'A'; hhad: 'H' | 'D' | 'A';
}

const n = (v: any): number | null => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const parseScore = (s: any): [number, number] | null => {
  const m = String(s ?? '').match(/(\d+)\s*:\s*(\d+)/);
  return m ? [Number(m[1]), Number(m[2])] : null;
};

function loadRecords(): Rec[] {
  if (!fs.existsSync(HIST)) throw new Error('缺少 data/history/football');
  const files = fs.readdirSync(HIST).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  const out: Rec[] = [];
  const seen = new Set<string>();
  for (const f of files) {
    let arr: any[];
    try {
      const j = JSON.parse(fs.readFileSync(path.join(HIST, f), 'utf8'));
      arr = Array.isArray(j) ? j : j.matches ?? j.data ?? [];
    } catch { continue; }
    for (const m of arr) {
      if (String(m.matchResultStatus) !== '2') continue; // 只要终场
      const sc = parseScore(m.sectionsNo999);
      if (!sc) continue;
      const oh = n(m.h), od = n(m.d), oa = n(m.a);
      if (!oh || !od || !oa || oh <= 1 || od <= 1 || oa <= 1) continue; // 无赔率的场次不进训练集
      const key = String(m.matchId ?? `${m.matchDate}|${m.homeTeam}|${m.awayTeam}`);
      if (seen.has(key)) continue;
      seen.add(key);

      const line = n(m.goalLine);
      const [hg, ag] = sc;
      const diff = hg - ag;
      const had: 'H' | 'D' | 'A' = diff > 0 ? 'H' : diff < 0 ? 'A' : 'D';
      const hhad: 'H' | 'D' | 'A' = line == null ? had
        : (diff + line) > 0 ? 'H' : (diff + line) < 0 ? 'A' : 'D';
      out.push({
        date: String(m.matchDate), league: String(m.leagueNameAbbr || m.leagueName || '?'),
        home: String(m.homeTeam), away: String(m.awayTeam),
        oh, od, oa, line, hg, ag, had, hhad,
      });
    }
  }
  return out;
}

/** Wilson 95% 置信区间（小样本必须给不确定性） */
function wilson(k: number, total: number): [number, number] {
  if (!total) return [0, 0];
  const p = k / total, z = 1.96;
  const denom = 1 + z * z / total;
  const center = (p + z * z / (2 * total)) / denom;
  const half = (z * Math.sqrt(p * (1 - p) / total + z * z / (4 * total * total))) / denom;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}
const pct = (x: number) => (x * 100).toFixed(1) + '%';
const ci = (k: number, total: number) => {
  const [lo, hi] = wilson(k, total);
  return `[${pct(lo)}~${pct(hi)}]`;
};
function pad(s: string | number, width: number): string {
  const str = String(s ?? '');
  const w = [...str].reduce((a, ch) => a + (/[\u4e00-\u9fa5\uff00-\uffef]/.test(ch) ? 2 : 1), 0);
  return str + ' '.repeat(Math.max(0, width - w));
}

/** 去掉抽水的隐含概率（同一场三项归一） */
function implied(oh: number, od: number, oa: number): { h: number; d: number; a: number } {
  const rh = 1 / oh, rd = 1 / od, ra = 1 / oa;
  const z = rh + rd + ra;
  return { h: rh / z, d: rd / z, a: ra / z };
}

function section(title: string): void { console.log(`\n${'─'.repeat(78)}\n${title}\n${'─'.repeat(78)}`); }

function main(): void {
  let recs = loadRecords();
  const from = arg('from'), to = arg('to'), lg = arg('league');
  if (from) recs = recs.filter(r => r.date >= from);
  if (to) recs = recs.filter(r => r.date <= to);
  if (lg) recs = recs.filter(r => r.league.includes(lg));

  if (!recs.length) { console.log('没有可用记录（检查 data/history/football 与筛选条件）'); process.exit(1); }
  const dates = [...new Set(recs.map(r => r.date))].sort();
  console.log(`训练集 ${recs.length} 场 · ${dates[0]} ~ ${dates[dates.length - 1]} · ${dates.length} 个比赛日${lg ? ` · 联赛含「${lg}」` : ''}`);
  console.log('口径：只取终场、有竞彩胜平负赔率的场次；让球结果按 goalLine 由比分推；不含串关。');

  // ── 1 总体分布 ──
  section('1. 总体分布');
  const cnt = { H: 0, D: 0, A: 0 } as Record<string, number>;
  let goals = 0;
  for (const r of recs) { cnt[r.had]++; goals += r.hg + r.ag; }
  const T = recs.length;
  console.log(`主胜 ${pct(cnt.H / T)} ${ci(cnt.H, T)} · 平 ${pct(cnt.D / T)} ${ci(cnt.D, T)} · 客胜 ${pct(cnt.A / T)} ${ci(cnt.A, T)} · 场均进球 ${(goals / T).toFixed(2)}`);
  console.log(`主队不败 ${pct((cnt.H + cnt.D) / T)} · 大2.5 ${pct(recs.filter(r => r.hg + r.ag > 2.5).length / T)} · 大3.0 ${pct(recs.filter(r => r.hg + r.ag > 3).length / T)}`);

  // ── 2 联赛基线（N≥30 才列） ──
  section('2. 联赛基线（N≥30）');
  const byLg = new Map<string, Rec[]>();
  for (const r of recs) { if (!byLg.has(r.league)) byLg.set(r.league, []); byLg.get(r.league)!.push(r); }
  const lgRows = [...byLg.entries()].filter(([, a]) => a.length >= 30)
    .map(([k, a]) => ({ k, N: a.length, h: a.filter(x => x.had === 'H').length, d: a.filter(x => x.had === 'D').length }))
    .sort((x, y) => y.N - x.N).slice(0, 12);
  console.log(pad('联赛', 10) + pad('N', 6) + pad('主胜', 22) + pad('平', 22) + '客胜');
  for (const r of lgRows) {
    console.log(pad(r.k, 10) + pad(r.N, 6) + pad(`${pct(r.h / r.N)} ${ci(r.h, r.N)}`, 16) + pad(`${pct(r.d / r.N)} ${ci(r.d, r.N)}`, 16) + pct((r.N - r.h - r.d) / r.N));
  }

  // ── 3 赔率校准：市场隐含 vs 实际 ──
  section('3. 胜平负赔率校准（隐含概率 vs 实际命中，偏差=实际−隐含）');
  const bands: [number, number][] = [[1, 1.5], [1.5, 2], [2, 2.5], [2.5, 3.5], [3.5, 5], [5, 8], [8, 20]];
  console.log(pad('赔率区间', 12) + pad('N', 6) + pad('隐含均值', 10) + pad('实际', 22) + '偏差');
  // 用「主胜」这一路做校准曲线（同法可看平/客）
  for (const [lo, hi] of bands) {
    const sub = recs.filter(r => r.oh >= lo && r.oh < hi);
    if (!sub.length) continue;
    const imp = sub.reduce((s, r) => s + implied(r.oh, r.od, r.oa).h, 0) / sub.length;
    const hit = sub.filter(r => r.had === 'H').length;
    console.log(pad(`${lo}~${hi}`, 12) + pad(sub.length, 6) + pad(pct(imp), 10) + pad(`${pct(hit / sub.length)} ${ci(hit, sub.length)}`, 16) + `${(hit / sub.length - imp >= 0 ? '+' : '')}${pct(hit / sub.length - imp)}`);
  }
  console.log('说明：竞彩赔率含抽水，归一后的隐含概率是「费率公平」基线；实际高于隐含才有价值（仍需扣掉抽水与执行成本）。');

  // ── 4 让球盘 ──
  section('4. 让球盘（goalLine 分布与让球方胜率）');
  console.log(pad('让球线', 10) + pad('N', 6) + pad('让胜', 16) + pad('让平', 12) + '让负');
  const lines = [...new Set(recs.filter(r => r.line != null).map(r => r.line as number))].sort((a, b) => a - b);
  for (const L of lines) {
    const sub = recs.filter(r => r.line === L);
    if (sub.length < 30) continue;
    const h = sub.filter(r => r.hhad === 'H').length, d = sub.filter(r => r.hhad === 'D').length;
    console.log(pad(L > 0 ? `主受让${L}` : `主让${-L}`, 10) + pad(sub.length, 6) + pad(`${pct(h / sub.length)} ${ci(h, sub.length)}`, 16) + pad(pct(d / sub.length), 12) + pct((sub.length - h - d) / sub.length));
  }
  console.log('说明：goalLine 为负数=主队让球；让平=走盘（亚盘按整数盘退本金，竞彩让球平=输）。');

  // ── 5 盲投 ROI（按赔率区间盲投主胜） ──
  section('5. 盲投核算：按主胜赔率区间每场 1u 盲投主胜（账面 ROI）');
  console.log(pad('赔率区间', 12) + pad('N', 6) + pad('命中率', 16) + pad('ROI', 10) + '结论');
  for (const [lo, hi] of bands) {
    const sub = recs.filter(r => r.oh >= lo && r.oh < hi);
    if (sub.length < 20) continue;
    let pnl = 0;
    for (const r of sub) pnl += r.had === 'H' ? r.oh - 1 : -1;
    const roi = pnl / sub.length;
    const hit = sub.filter(r => r.had === 'H').length;
    console.log(pad(`${lo}~${hi}`, 12) + pad(sub.length, 6) + pad(`${pct(hit / sub.length)} ${ci(hit, sub.length)}`, 16) + pad(`${(roi * 100).toFixed(1)}%`, 10) +
      (sub.length < 100 ? '样本不足，别当结论' : roi > 0.03 ? '正 ROI：先查方法学' : '无优势'));
  }

  // ── 6 时间稳定性 ──
  const split = Number(arg('split', '0'));
  if (split > 0 && split < 1) {
    section(`6. 时间切分稳定性（前 ${(split * 100).toFixed(0)}% vs 后 ${((1 - split) * 100).toFixed(0)}%）`);
    const sorted = [...recs].sort((a, b) => a.date.localeCompare(b.date));
    const cut = Math.floor(sorted.length * split);
    const parts: [string, Rec[]][] = [['前段', sorted.slice(0, cut)], ['后段', sorted.slice(cut)]];
    console.log(pad('区间', 8) + pad('N', 6) + pad('主胜', 12) + pad('平', 12) + pad('大2.5', 12) + '场均进球');
    for (const [label, sub] of parts) {
      if (!sub.length) continue;
      console.log(pad(label, 8) + pad(sub.length, 6) +
        pad(pct(sub.filter(r => r.had === 'H').length / sub.length), 12) +
        pad(pct(sub.filter(r => r.had === 'D').length / sub.length), 12) +
        pad(pct(sub.filter(r => r.hg + r.ag > 2.5).length / sub.length), 12) +
        (sub.reduce((s, r) => s + r.hg + r.ag, 0) / sub.length).toFixed(2));
    }
    console.log('说明：两段差异明显时，先怀疑赛制/样本结构变化，再谈策略有效性。');
  }

  console.log('\n提醒：以上是描述性统计与校准，不是收益承诺；样本 <100 的格子只当线索。');
}

main();
