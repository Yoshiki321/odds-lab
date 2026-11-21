import { query, pool } from '../../src/server/db/pool.js';
async function main(){
  const r = await query(`SELECT id, match_id, pick, status, result, settled_at FROM virtual_bets WHERE id='vb-140'`);
  console.log('PG virtual_bets:', JSON.stringify(r.rows[0] ?? null));
  await pool().end();
}
main();
