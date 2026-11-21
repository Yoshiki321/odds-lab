// audit.ts — 自我提升度量层：分档校准 + EV门审计
// 方法（比赛时真相优先）：信号=每场最早 score_snapshot（total/pred/market/odds/value_ev），
// 无快照回退 scores round1；结局=results；hit=(market==HAD?had:hhad)===pred。
// EV：快照首帧 value_ev（小数）；缺失则用 europe_odds_history 当日最早去水重算。
// 用法: npx tsx tools/audit.ts ；报告落盘 data/audit/audit-<BJ日期>.json
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { query } from '../src/server/db/pool.js';
import { fairProbForPick } from './ev-fit.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const bjDay = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
const bandOf = (t: number) => t >= 58 ? '58+加注' : t >= 48 ? '48-57实单' : t >= 40 ? '40-47候选' : t >= 30 ? '30-39弱' : '<30放弃';

interface Sig { matchId: string; num: string; date: string; total: number; pred: string; market: string; odds: number; ev: number | null; src: string }

export async function audit(): Promise<any> {
  // 1. 每场最早快照（比赛时信号）
  const snaps = (await query(`
    SELECT DISTINCT ON (s.match_id) s.match_id, s.total, s.pred, s.market, s.odds, s.value_ev,
      m.num, to_char(m.match_date,'YYYY-MM-DD') d, m.hhad
    FROM score_snapshots s JOIN matches m ON m.match_id = s.match_id
    WHERE s.total IS NOT NULL AND (s.hours_to_ko IS NULL OR s.hours_to_ko > 0)
    ORDER BY s.match_id, s.snapshot_at`)).rows;
  const seen = new Set(snaps.map((x: any) => x.match_id));
  // 无快照回退 scores round1
  const r1 = (await query(`
    SELECT s.match_id, s.total, s.pred, s.market, s.odds, m.num, to_char(m.match_date,'YYYY-MM-DD') d, m.hhad
    FROM scores s JOIN matches m ON m.match_id = s.match_id
    WHERE s.scan_round = 1 AND s.total IS NOT NULL`)).rows;
  const sigs: Sig[] = snaps.map((x: any) => ({
    matchId: x.match_id, num: x.num, date: x.d, total: Number(x.total),
    pred: x.pred, market: x.market || 'HHAD', odds: Number(x.odds),
    ev: x.value_ev == null ? null : Number(x.value_ev), src: 'snap',
    gl: (() => { try { return parseFloat(x.hhad?.goalLine); } catch { return NaN; } })(),
  }));
  for (const x of r1) {
    if (seen.has(x.match_id)) continue;
    let gl = NaN;
    try { gl = parseFloat(x.hhad?.goalLine); } catch { /* 无线 */ }
    sigs.push({
      matchId: x.match_id, num: x.num, date: x.d, total: Number(x.total),
      pred: x.pred, market: x.market || 'HHAD', odds: Number(x.odds), ev: null, src: 'r1', gl,
    } as Sig);
  }
  // 2. 结局
  const res = (await query(`SELECT match_id, had, hhad FROM results WHERE had IN ('H','D','A')`)).rows;
  const resMap = new Map(res.map((x: any) => [x.match_id, x]));
  // 3. 欧赔（当日最早，重算缺失EV用）
  const euros = (await query(`
    SELECT DISTINCT ON (match_id) match_id, home_odds, draw_odds, away_odds
    FROM europe_odds_history ORDER BY match_id, observed_at`)).rows;
  const euroMap = new Map(euros.map((x: any) => [x.match_id, { home: +x.home_odds, draw: +x.draw_odds, away: +x.away_odds }]));

  const rows: any[] = [];
  for (const s of sigs) {
    const r: any = resMap.get(s.matchId);
    if (!r) continue; // 未终场不计
    const actual = s.market === 'HAD' ? r.had : r.hhad;
    const hit = !!s.pred && !!actual && s.pred === actual;
    let ev = s.ev;
    if (ev == null) {
      const eu = euroMap.get(s.matchId);
      if (eu && eu.home > 1 && eu.draw > 1 && eu.away > 1 && s.odds > 1) {
        const z = 1 / eu.home + 1 / eu.draw + 1 / eu.away;
        const fair = { home: (1 / eu.home) / z, draw: (1 / eu.draw) / z, away: (1 / eu.away) / z };
        const gl = (s as any).gl;
        const p = s.market === 'HAD'
          ? (s.pred === 'H' ? fair.home : s.pred === 'D' ? fair.draw : fair.away)
          : (Number.isFinite(gl) ? fairProbForPick(fair, s.pred as 'H' | 'A', 'HHAD', gl) : null);
        if (p != null) ev = +(p * s.odds - 1).toFixed(4);
      }
    }
    rows.push({ ...s, actual, hit, ev });
  }

  const agg = (list: any[]) => {
    const n = list.length, h = list.filter(x => x.hit).length;
    const roi = n ? +(list.reduce((a, x) => a + (x.hit ? x.odds : 0), 0) / n - 1).toFixed(3) : null;
    return { n, hit: h, pct: n ? Math.round(h / n * 100) : null, avgOdds: n ? +(list.reduce((a, x) => a + x.odds, 0) / n).toFixed(2) : null, roiFlat: roi };
  };
  const bands: any = {};
  for (const b of ['58+加注', '48-57实单', '40-47候选', '30-39弱', '<30放弃'])
    bands[b] = agg(rows.filter(x => bandOf(x.total) === b));
  const evPos = rows.filter(x => x.ev != null && x.ev > 0);
  const evNeg = rows.filter(x => x.ev != null && x.ev <= 0);
  const evNone = rows.filter(x => x.ev == null);
  const report = {
    at: new Date().toISOString(), days: [...new Set(rows.map(x => x.date))].sort(),
    settled: rows.length, bands,
    evGate: { pos: agg(evPos), neg: agg(evNeg), none: agg(evNone) },
    note: 'ROI为等额假设的代理值；HHAD-hit按官方hhad方向；首帧快照=比赛时信号',
  };
  const line = (k: string, a: any) =>
    `${k.padEnd(10)} n=${String(a.n).padStart(3)} 命中=${a.pct == null ? '-' : a.pct + '%'} 均赔=${a.avgOdds ?? '-'} ROI=${a.roiFlat == null ? '-' : (a.roiFlat >= 0 ? '+' : '') + a.roiFlat}`;
  console.log(`=== 分档校准（已终场${rows.length}场，${report.days[0]}~${report.days[report.days.length - 1]}） ===`);
  for (const b of Object.keys(bands)) console.log(line(b, bands[b]));
  console.log('=== EV门审计 ===');
  console.log(line('EV>0', report.evGate.pos));
  console.log(line('EV≤0', report.evGate.neg));
  console.log(line('无欧赔', report.evGate.none));
  mkdirSync(join(ROOT, 'data', 'audit'), { recursive: true });
  const f = join(ROOT, 'data', 'audit', `audit-${bjDay()}.json`);
  writeFileSync(f, JSON.stringify(report, null, 1));
  console.log('报告已落盘 ' + f);
  return report;
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('audit.ts')) {
  audit().then(() => process.exit(0)).catch(e => { console.error('审计失败:', e); process.exit(1); });
}
