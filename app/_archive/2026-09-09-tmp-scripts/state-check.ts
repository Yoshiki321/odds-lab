import { pool } from '../../src/server/db/pool.js';
async function main() {
  const db = pool();
  const cols = await db.query("select column_name,data_type from information_schema.columns where table_name='results' order by ordinal_position");
  console.log('results cols:', cols.rows.map(c => c.column_name).join(','));
  const r = await db.query("select r.match_id, r.score, r.fetched_at, m.num, m.league, m.home, m.away, m.kickoff from results r join matches m on m.match_id = r.match_id where m.match_date in ('2026-09-08','2026-09-09') order by m.kickoff limit 30");
  for (const x of r.rows) console.log(x.num, x.league, (x.home + '-' + x.away).padEnd(14), x.kickoff, 'score=' + (x.score ?? '?'), x.fetched_at);
  await db.end();
}
main().catch(e => { console.error(e); process.exit(1); });