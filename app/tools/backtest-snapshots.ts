/**
 * 回测框架：score_snapshots × results
 *
 * 三点纪律（此前版本踩过）：
 *   1. 一帧一场：ROI 只用「每场末帧」，同场多帧不再重复计入样本；
 *   2. 分玩法：HAD 帧对 results.had，HHAD 帧对 results.hhad，不混算；
 *   3. 无赔率不伪造收益：赔率缺失/非法的帧直接从 ROI 里剔除并单独报数；
 *   4. 时点安全：只认 snapshot_at < 开赛时刻 的帧，赛后的帧不进回测。
 *
 * 输出：默认 app/../data/betting/backtest-snapshots.{json,md}
 * 用法：npx tsx tools/backtest-snapshots.ts
 */
import fs from 'fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { query, pool } from '../src/server/db/pool.js';

const here = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(here, '..', '..', 'data', 'betting'); // app/tools → 项目/data/betting
const OUT = join(DATA_DIR, 'backtest-snapshots.json');
const OUT_MD = join(DATA_DIR, 'backtest-snapshots.md');

interface Frame {
  match_id: string; snapshot_at: string; slot: string; market: string | null;
  total: number; band: string; pred: string; odds: number | null; value_ev: number | null;
  kickoff: string | null;
}
interface Res { match_id: string; had: string | null; hhad: string | null }

/** 单帧假设投注 1u 在 pred（@odds）：命中返还 odds-1，否则 -1。赔率非法返回 null（剔除） */
function pnl(odds: number | null, hit: boolean): number | null {
  if (odds == null || !Number.isFinite(odds) || odds <= 1) return null;
  return hit ? odds - 1 : -1;
}

function officialOf(res: Res | undefined, market: string): string | null {
  if (!res) return null;
  return market === 'HHAD' ? res.hhad : res.had;
}

function bandOf(total: number): 'hi' | 'mid' | 'lo' {
  return total >= 58 ? 'hi' : total >= 48 ? 'mid' : 'lo';
}

async function run(): Promise<void> {
  const t0 = Date.now();
  const rows: Frame[] = (await query(
    `SELECT s.match_id, s.snapshot_at, s.slot, s.market, s.total, s.band, s.pred, s.odds, s.value_ev,
            m.kickoff
       FROM score_snapshots s
       JOIN matches m USING (match_id)
      ORDER BY s.match_id, s.snapshot_at`)).rows;

  const resRows: Res[] = (await query(
    `SELECT match_id, had, hhad FROM results WHERE had IN ('H','D','A')`)).rows;
  const resMap = new Map(resRows.map(r => [r.match_id, r]));

  // ---- 时点过滤：只保留赛前帧 ----
  const preFrames: Frame[] = [];
  let droppedPostKickoff = 0, droppedNoKickoff = 0;
  for (const f of rows) {
    if (!f.kickoff) { droppedNoKickoff++; continue; }
    if (new Date(f.snapshot_at).getTime() >= new Date(f.kickoff).getTime()) { droppedPostKickoff++; continue; }
    preFrames.push({ ...f, market: (f.market || 'HAD').toUpperCase() });
  }

  // 每场末帧（ROI 唯一口径）
  const lastFrame = new Map<string, Frame>();
  const byMatch = new Map<string, Frame[]>();
  for (const f of preFrames) {
    lastFrame.set(f.match_id, f);
    if (!byMatch.has(f.match_id)) byMatch.set(f.match_id, []);
    byMatch.get(f.match_id)!.push(f);
  }

  const usable = [...lastFrame.values()].filter(f => resMap.has(f.match_id));
  const nMatches = byMatch.size;
  const nUsable = usable.length;

  // ---- 表1 时点×档位命中率（每场每 (slot,band) 取末帧，避免同槽多帧重复计数）----
  const slotLast = new Map<string, Frame>();
  for (const f of preFrames) slotLast.set(`${f.match_id}|${f.slot}|${f.band}|${f.market}`, f);
  const t1 = new Map<string, { n: number; hit: number }>();
  for (const f of slotLast.values()) {
    if (!resMap.has(f.match_id)) continue;
    const official = officialOf(resMap.get(f.match_id), f.market ?? 'HAD');
    if (!official) continue;
    const key = `${f.slot}|${f.band}`;
    const e = t1.get(key) ?? { n: 0, hit: 0 };
    e.n++;
    if (official === f.pred) e.hit++;
    t1.set(key, e);
  }
  const T1 = [...t1.entries()].map(([k, e]) => {
    const [slot, band] = k.split('|');
    return { slot, band, n: e.n, hit: e.hit, hitRate: e.n ? +(e.hit / e.n).toFixed(3) : null };
  }).sort((a, b) => a.slot.localeCompare(b.slot) || a.band.localeCompare(b.band));

  // ---- 表2 EV 分桶 ROI（每场末帧、按玩法取官方赛果、无赔率剔除）----
  const evOf = (v: number | null) => (v == null ? null : v <= -0.2 ? '<-0.2' : v <= -0.1 ? '-0.2~-0.1'
    : v <= -0.05 ? '-0.1~-0.05' : v <= 0 ? '-0.05~0' : v <= 0.05 ? '0~0.05' : '>0.05');
  const t2 = new Map<string, { n: number; hit: number; pnl: number }>();
  let droppedNoOdds = 0, droppedNoOfficial = 0;
  const marketMix = new Map<string, number>();
  for (const f of usable) {
    marketMix.set(f.market!, (marketMix.get(f.market!) ?? 0) + 1);
    const official = officialOf(resMap.get(f.match_id), f.market!);
    if (!official) { droppedNoOfficial++; continue; }
    const hit = official === f.pred;
    const p = pnl(f.odds, hit);
    if (p == null) { droppedNoOdds++; continue; }
    const b = evOf(f.value_ev) ?? '无EV';
    const e = t2.get(b) ?? { n: 0, hit: 0, pnl: 0 };
    e.n++; if (hit) e.hit++; e.pnl += p;
    t2.set(b, e);
  }
  const order = ['<-0.2', '-0.2~-0.1', '-0.1~-0.05', '-0.05~0', '0~0.05', '>0.05', '无EV'];
  const T2 = order.map(b => {
    const e = t2.get(b);
    return e ? { bucket: b, n: e.n, hit: e.hit, hitRate: +(e.hit / e.n).toFixed(3), roi: +(e.pnl / e.n * 100).toFixed(1) }
      : { bucket: b, n: 0, hit: null, hitRate: null, roi: null };
  });

  // ---- 表3/4 首帧 vs 末帧（单调性、信号方向）----
  const T3 = { up: { n: 0, hit: 0 }, down: { n: 0, hit: 0 }, flat: { n: 0, hit: 0 } };
  const T4 = new Map<string, { n: number; hit: number }>();
  for (const [mid, frames] of byMatch) {
    if (frames.length < 2 || !resMap.has(mid)) continue;
    const first = frames[0], last = frames[frames.length - 1];
    const official = officialOf(resMap.get(mid), last.market!);
    if (!official) continue;
    const hit = official === last.pred;
    const delta = last.total - first.total;
    const dir = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
    T3[dir].n++; if (hit) T3[dir].hit++;
    const key = `${bandOf(first.total)}→${bandOf(last.total)}`;
    const e = T4.get(key) ?? { n: 0, hit: 0 };
    e.n++; if (hit) e.hit++;
    T4.set(key, e);
  }
  const T3out = Object.entries(T3).map(([dir, e]) => ({ dir, n: e.n, hit: e.hit, hitRate: e.n ? +(e.hit / e.n).toFixed(3) : null }));
  const T4out = [...T4.entries()].map(([dir, e]) => ({ dir, n: e.n, hit: e.hit, hitRate: e.n ? +(e.hit / e.n).toFixed(3) : null }));

  // ---- 基线：同一批场次里「一律猜主胜」的命中率（对照用，不含赔率收益）----
  let baseHit = 0, baseN = 0;
  for (const f of usable) {
    const r = resMap.get(f.match_id);
    if (!r || !r.had) continue;
    baseN++; if (r.had === 'H') baseHit++;
  }
  const baseline = { n: baseN, hit: baseHit, hitRate: baseN ? +(baseHit / baseN).toFixed(3) : null, note: '一律猜主胜（HAD 官方赛果）' };

  const out = {
    generatedAt: new Date().toISOString(),
    definition: {
      roi: '每场末帧 1u 押 pred，赔率取快照 odds；赔率缺失/非法剔除',
      markets: 'HAD 对 results.had / HHAD 对 results.hhad，分玩法统计',
      timeSafety: '只计 snapshot_at < kickoff 的帧',
    },
    counts: {
      framesTotal: rows.length, framesPreKickoff: preFrames.length,
      droppedPostKickoff, droppedNoKickoff, droppedNoOdds, droppedNoOfficial,
      matches: nMatches, matchesWithResult: nUsable,
      resultsRows: resRows.length,
      marketMix: Object.fromEntries(marketMix),
    },
    table1: T1, table2: T2, table3: T3out, table4: T4out, baseline,
  };

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf-8');
  fs.writeFileSync(OUT_MD, renderMd(out), 'utf-8');
  console.log(`回测四表 | 帧${preFrames.length}/${rows.length} 场次${nMatches} 有赛果${nUsable} | 剔除 赛后${droppedPostKickoff}/无开赛${droppedNoKickoff}/无赔率${droppedNoOdds}/无赛果${droppedNoOfficial} | ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  console.log(`  T1 ${T1.length} 行 | T2 ${T2.filter(x => x.n).length} 桶 | T3 ${T3out.map(t => t.dir + ':' + t.n).join(' ')} | 基线命中 ${baseline.hitRate ?? '—'}`);
  await pool().end();
}

function renderMd(o: any): string {
  const rows = (a: any[], cols: string[], fmt: (r: any) => string) => {
    if (!a?.length) return '_N=0（样本未积累）_\n\n';
    return `| ${cols.join(' | ')} |\n| ${cols.map(() => '---').join(' | ')} |\n` + a.map(r => `| ${fmt(r)} |`).join('\n') + '\n\n';
  };
  return `# 回测四表（score_snapshots × results）\n\n生成于 ${o.generatedAt}\n\n` +
    `口径：${o.definition.roi}；${o.definition.markets}；${o.definition.timeSafety}\n\n` +
    `样本：帧 ${o.counts.framesPreKickoff}/${o.counts.framesTotal} 可用，场次 ${o.counts.matches}，有赛果 ${o.counts.matchesWithResult}；` +
    `剔除 赛后帧 ${o.counts.droppedPostKickoff}、无开赛 ${o.counts.droppedNoKickoff}、无赔率 ${o.counts.droppedNoOdds}、无对应赛果 ${o.counts.droppedNoOfficial}\n\n` +
    `## 1. 时点×档位命中率\n\n` + rows(o.table1, ['时点', '档位', 'N', '命中', '命中率'], r => `${r.slot}|${r.band}|${r.n}|${r.hit}|${r.hitRate ?? '—'}`) +
    `## 2. EV 分桶 ROI（每场末帧 1u）\n\n` + rows(o.table2, ['EV桶', 'N', '命中', '命中率', 'ROI%'], r => `${r.bucket}|${r.n}|${r.hit ?? '—'}|${r.hitRate ?? '—'}|${r.roi ?? '—'}`) +
    `## 3. 快照单调性\n\n` + rows(o.table3, ['方向', 'N', '命中', '命中率'], r => `${r.dir}|${r.n}|${r.hit}|${r.hitRate ?? '—'}`) +
    `## 4. 信号方向交叉\n\n` + rows(o.table4, ['方向', 'N', '命中', '命中率'], r => `${r.dir}|${r.n}|${r.hit}|${r.hitRate ?? '—'}`) +
    `## 基线\n\n| 口径 | N | 命中率 |\n| --- | --- | --- |\n| ${o.baseline.note} | ${o.baseline.n} | ${o.baseline.hitRate ?? '—'} |\n`;
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('backtest-snapshots.ts')) {
  run().catch(e => { console.error('回测失败:', e?.message || e); process.exit(1); });
}
