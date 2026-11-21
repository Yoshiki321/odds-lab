import { pool } from '../../src/server/db/pool.js';
function py(dims: any) {
  const out: Record<string, any> = {};
  for (const k of ['drop','confirm','model','history','risk','value']) {
    const v = dims?.[k];
    out[k] = (v && typeof v === 'object' && 'score' in v) ? `${v.score}${v.note?`(${v.note})`:''}` : `${v}`;
  }
  return out;
}
async function main() {
  const q = `
    SELECT s.match_id, s.total, s.band, s.dir, s.market, s.pred, s.odds, s.dims, s.drop_amt,
           m.league, m.home, m.away, m.kickoff, m.hhad,
           e.home_odds, e.draw_odds, e.away_odds
    FROM scores s
    JOIN matches m ON m.match_id = s.match_id
    LEFT JOIN europe_odds e ON e.match_id = s.match_id
    WHERE s.match_date = '2026-09-13' AND s.scan_round = (SELECT max(scan_round) FROM scores WHERE match_date='2026-09-13')
    ORDER BY s.total DESC LIMIT 10`;
  const r = await pool().query(q);
  for (const row of r.rows) {
    const d = py(row.dims);
    const hrs = row.kickoff ? ((+new Date(row.kickoff) - Date.now())/3600000).toFixed(1) : '?';
    console.log(`${String(row.match_id).padEnd(9)} ${String(row.total).padStart(3)} ${String(row.band).padEnd(6)} ${row.dir.padEnd(9)}@${row.odds} 距开${hrs}h  ${row.league}/${row.home}-${row.away}`);
    console.log(`     drop=${d.drop} confirm=${d.confirm} model=${d.model} hist=${d.history} risk=${d.risk} value=${d.value}`);
  }
  await pool().end();
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); });
