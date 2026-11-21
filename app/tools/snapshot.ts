// snapshot.ts — 多时点评分快照（score_snapshots 落帧）
// 每次 refresh 评分完成后对当日已上市场次落一帧，回答"前置 vs 临场"如何演变
// slot 按打帧时刻距开赛小时分桶：pre / t-12h / t-8h / t-4h / t-2h / t-30m / live
import { query } from '../src/server/db/pool.js';
import { getDayMatches, snapshotScore } from '../src/server/db/store.js';

/** 距开赛小时 → slot 标签 */
export function slotOf(hours: number | null): string {
  if (hours == null) return 'hourly';
  if (hours >= 24) return 'pre';
  if (hours >= 10) return 't-12h';
  if (hours >= 6) return 't-8h';
  if (hours >= 3) return 't-4h';
  if (hours >= 1) return 't-2h';
  if (hours >= 0.3) return 't-30m';
  return 'live';
}

const jstr = (o: unknown): string => {
  if (o == null) return '';
  try { return typeof o === 'string' ? o : JSON.stringify(o); } catch { return String(o); }
};

/** 从 dims.value.note 解析 EV 小数（"+3.8% 让球P50%" → 0.038；"-14.0%" → -0.14） */
function evOf(note: string | undefined): number | null {
  if (!note) return null;
  const m = note.match(/([+-]?\d+(?:\.\d+)?)%/);
  if (!m) return null;
  return parseFloat(m[1]) / 100;
}

/** 当日各场最新评分 → 打一帧快照。返回落帧数 */
export async function snapshotDay(date: string): Promise<number> {
  const matches = await getDayMatches(date);
  if (!matches.length) return 0;
  const now = new Date().toISOString();
  const ids = matches.map(m => m.matchId);
  const scores = await query(
    `SELECT DISTINCT ON (match_id) match_id, scan_round, dir, market, pred, odds, drop_amt, total, band, dims, analysis, has_base_mark
     FROM scores WHERE match_id = ANY($1::varchar[]) AND match_date = $2
     ORDER BY match_id, scan_round DESC`, [ids, date]);
  const byId = new Map(scores.rows.map((r: any) => [r.match_id, r]));

  const europe = await query(
    `SELECT match_id, home_odds, draw_odds, away_odds FROM europe_odds WHERE match_id = ANY($1::varchar[])`, [ids]);
  const eurById = new Map(europe.rows.map((r: any) => [r.match_id, r]));
  const support = await query(
    `SELECT match_id, support FROM matches WHERE match_id = ANY($1::varchar[]) AND support IS NOT NULL`, [ids]);
  const supById = new Map(support.rows.map((r: any) => [r.match_id, r]));

  let n = 0;
  for (const m of matches) {
    const s = byId.get(m.matchId);
    if (!s) continue; // 未开售/未评分跳过
    const ko = m.kickoff ? new Date(m.kickoff).getTime() : null;
    const hoursToKo = ko != null ? (ko - Date.now()) / 3600_000 : null;
    const dims = s.dims ?? s.analysis?.dims ?? {};
    const eu = eurById.get(m.matchId);
    const sup = supById.get(m.matchId)?.support;
    const ev = evOf(dims.value?.note);
    await snapshotScore({
      matchId: m.matchId, snapshotAt: now, hoursToKo: hoursToKo != null ? +hoursToKo.toFixed(1) : null,
      slot: slotOf(hoursToKo), scanRound: s.scan_round,
      total: s.total, band: s.band, dir: s.dir, market: s.market, pred: s.pred,
      odds: s.odds == null ? null : Number(s.odds), dropAmt: s.drop_amt == null ? 0 : Number(s.drop_amt),
      valueEv: ev,
      score: dims,
      had: jstr(m.had), hhad: jstr(m.hhad),
      europe: eu ? `${eu.home_odds},${eu.draw_odds},${eu.away_odds}@spot` : '',
      support: jstr(sup),
      hasBaseMark: s.has_base_mark || 'v',
    });
    n++;
  }
  return n;
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('snapshot.ts')) {
  const arg = process.argv[2];
  const date = arg && /^\d{4}-\d{2}-\d{2}$/.test(arg) ? arg : new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
  snapshotDay(date).then(n => console.log(`评分快照 ${date} 落帧${n}场`)).catch(e => { console.error('快照失败:', e?.message || e); process.exit(1); });
}