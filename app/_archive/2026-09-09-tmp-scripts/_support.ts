import { query, pool } from '../../src/server/db/pool.js';
async function main(){
  const r = await query(`SELECT m.num, m.home, m.away, m.support FROM matches m WHERE m.match_date='2026-09-09' AND m.support IS NOT NULL ORDER BY m.kickoff`);
  for (const x of r.rows) {
    const s = x.support ?? {};
    console.log((x.num ?? '?').padEnd(8), (x.home ?? '').padEnd(12), (x.away ?? '').padEnd(12), JSON.stringify(s));
  }
  await pool().end();
}
main();
