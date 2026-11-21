import { query } from '../src/server/db/pool.js';
async function main() {
  for (const id of ['2041323', '2041327', '2041346', '2041288']) {
    const s = await query("SELECT scan_round, total, dir, odds, band, from_source, analyzed_at FROM scores WHERE match_id = $1 ORDER BY analyzed_at DESC", [id]);
    console.log(`--- ${id}`);
    for (const r of s.rows) console.log(`   round=${r.scan_round} total=${r.total} ${r.dir}@${r.odds} ${r.band} src=${r.from_source} at=${r.analyzed_at}`);
  }
  process.exit(0);
}
main();
