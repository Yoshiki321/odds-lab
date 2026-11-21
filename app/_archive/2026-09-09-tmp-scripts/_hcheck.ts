import { query, pool } from '../../src/server/db/pool.js';
async function main(){
  const s = await query("SELECT ok, errors, detail, updated_at FROM source_status WHERE id=1");
  const ss = s.rows[0];
  console.log('source_status ok=' + ss.ok, 'errors=' + JSON.stringify(ss.errors), 'detail=' + JSON.stringify(ss.detail ?? {}).slice(0,200));
  const r = await query("SELECT s.match_id, m.num, m.home, m.away, s.total, s.band, s.value, s.dims->'value'->>'note' AS vnote FROM scores s JOIN matches m USING (match_id) WHERE s.match_date='2026-09-09' AND s.scan_round=(SELECT MAX(scan_round) FROM scores s2 WHERE s2.match_date='2026-09-09') AND s.total>=58 ORDER BY s.total DESC");
  for (const x of r.rows) console.log(x.num, x.home+'-'+x.away, 'total=' + x.total, x.band, 'value=' + x.value, '|', x.vnote ?? '');
  await pool().end();
}
main();
