import { query, pool } from '../../src/server/db/pool.js';
async function main(){
  const r = await query(`SELECT match_id, snapshot_at, hours_to_ko, slot, scan_round, total, band, value_ev, had, europe FROM score_snapshots WHERE match_id='2041362' ORDER BY snapshot_at DESC LIMIT 2`);
  console.log('那不勒斯 snapshots:', JSON.stringify(r.rows, null, 1).slice(0, 900));
  const c = await query(`SELECT COUNT(*)::int n, COUNT(DISTINCT match_id)::int matches FROM score_snapshots`);
  console.log('total snapshots:', c.rows[0].n, 'matches:', c.rows[0].matches);
  await pool().end();
}
main();
