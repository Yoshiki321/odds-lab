import { query, pool } from '../../src/server/db/pool.js';
async function main(){
  const r = await query("SELECT num, home, away, kickoff FROM matches WHERE match_date='2026-09-09' AND num IN ('周三007','周三005') ");
  for (const x of r.rows) console.log(x.num, x.home+'-'+x.away, 'kickoff=', String(x.kickoff));
  await pool().end();
}
main();
