import { query, pool } from '../../src/server/db/pool.js';
async function main(){
  const r = await query("SELECT s.match_id, m.num, m.home, m.away, s.total, s.band, s.dims, s.analysis FROM scores s JOIN matches m USING (match_id) WHERE s.match_date='2026-09-09' AND s.scan_round=(SELECT MAX(scan_round) FROM scores s2 WHERE s2.match_date='2026-09-09') AND s.total>=58 ORDER BY s.total DESC");
  for (const x of r.rows) {
    const d = x.dims ?? {};
    const g = (k: string) => (d[k]?.score ?? '-') + '';
    console.log(x.num, x.home + '-' + x.away, 'total=' + x.total, x.band);
    console.log('   drop=' + g('drop') + ' confirm=' + g('confirm') + ' model=' + g('model') + ' history=' + g('history') + ' risk=' + g('risk') + ' value=' + g('value'));
    for (const k of ['value','model','risk','drop','confirm','history']) if (d[k]?.note) console.log('   ' + k + '.note: ' + d[k].note);
    console.log('   reasoning: ' + (x.analysis?.reasoning ?? ''));
  }
  await pool().end();
}
main();
