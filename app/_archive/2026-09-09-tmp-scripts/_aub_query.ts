import { pool } from '../../src/server/db/pool.js';
async function main() {
  const p = pool();
  const s = await p.query(`SELECT id, scan_round, total, band, dir, value, dims, analyzed_at FROM scores WHERE match_id='2041414' ORDER BY scan_round, id`);
  for (const r of s.rows) {
    const note = r.dims?.value?.note ?? '';
    console.log(`scores #${r.id} r${r.scan_round} ${r.total} ${r.band} ${r.dir} value=${r.value} note=${note} @${r.analyzed_at}`);
  }
  const e = await p.query(`SELECT home_odds, draw_odds, away_odds, source, observed_at FROM europe_odds WHERE match_id='2041414'`);
  for (const r of e.rows) console.log(`europe ${r.source} ${r.home_odds}/${r.draw_odds}/${r.away_odds} @${r.observed_at}`);
  await p.end();
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); });
