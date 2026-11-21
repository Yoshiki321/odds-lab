import { query, pool } from '../../src/server/db/pool.js';
async function main(){
  const r = await query(`SELECT COUNT(*)::int n, MIN(fetched_at) minf, MAX(fetched_at) maxf FROM results`);
  console.log('results rows:', JSON.stringify(r.rows[0]));
  const s = await query(`SELECT r.match_id, m.home, m.away, m.league, r.score, r.had FROM results r JOIN matches m USING(match_id) WHERE r.had IS NOT NULL AND r.had IN ('H','D','A') ORDER BY m.kickoff DESC LIMIT 3`);
  console.log('sample:', JSON.stringify(s.rows));
  const nojoin = await query(`SELECT COUNT(*)::int n FROM results r LEFT JOIN matches m USING(match_id) WHERE m.match_id IS NULL`);
  console.log('results without match row:', nojoin.rows[0].n);
  await pool().end();
}
main();
