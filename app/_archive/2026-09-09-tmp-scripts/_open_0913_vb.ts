import { pool } from '../../src/server/db/pool.js';
// 13:00 开盘：决策只信 refresh round1 帧。列出 09-13 top 场次，选 ≥44 虚拟注。
async function main() {
  const q = `
    SELECT s.match_id, s.total, s.band, s.dir, s.market, s.pred, s.odds, s.dims, s.drop_amt,
           m.num, m.league, m.home, m.away, m.kickoff, m.hhad, m.match_date
    FROM scores s
    JOIN matches m ON m.match_id = s.match_id
    WHERE s.match_date = '2026-09-13' AND s.scan_round = 1
    ORDER BY s.total DESC LIMIT 14`;
  const r = await pool().query(q);
  const now = new Date();
  for (const row of r.rows) {
    const d = row.dims || {};
    const val = d.value && typeof d.value === 'object' ? `v${d.value.score}${d.value.note?` ${d.value.note}`:''}` : '';
    const hrs = row.kickoff ? (((+new Date(row.kickoff)) - (+now)) / 3600000).toFixed(1) : '?';
    console.log(`${row.num} ${String(row.total).padStart(2)} ${String(row.band).padEnd(6)} ${row.dir.padEnd(8)}@${row.odds} 距开${hrs}h ${row.league}/${row.home}-${row.away} ${row.market} ${val}`);
  }
  await pool().end();
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); });