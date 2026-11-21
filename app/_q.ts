import { query } from './src/server/db/pool.js';
async function main() {
  const v = await query(`SELECT id, pick, my_view, status, result, match_id FROM virtual_bets WHERE id IN ('vb-138','vb-139','vb-140') ORDER BY id`);
  console.log('VB:', JSON.stringify(v.rows));
  const s = await query(`
    SELECT s.dir, s.odds, s.drop_amt, s.total, s.band, s.risk, s.model
    FROM scores s WHERE s.match_id='2041328' AND s.scan_round=1`);
  console.log('SCORE(维多利亚):', JSON.stringify(s.rows));
}
main().then(() => process.exit(0)).catch(e => { console.error('ERR', e.message); process.exit(1); });