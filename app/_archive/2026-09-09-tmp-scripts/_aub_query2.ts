import { pool } from '../../src/server/db/pool.js';
async function main() {
  const p = pool();
  const s = await p.query(`SELECT id, scan_round, total, band, dir, value, dims->'value'->>'note' AS note, to_char(analyzed_at,'HH24:MI') t FROM scores WHERE match_id='2041414' ORDER BY scan_round, id`);
  for (const r of s.rows) console.log(`scores #${r.id} r${r.scan_round} ${r.total} ${r.band} ${r.dir} value=${r.value} ${r.note} @${r.t}`);
  // 全表 09-12 中仍有旧特征(note含 @19:38 且 scan_round>1)的帧数
  const bad = await p.query(`SELECT count(*) n FROM scores WHERE match_date='2026-09-12' AND scan_round>1 AND dims->>'value' LIKE '%@19:38%'`);
  console.log('09-12 污染帧(round>1 @19:38):', bad.rows[0].n);
  await p.end();
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); });
