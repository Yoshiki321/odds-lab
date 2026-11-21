import { query, pool } from '../../src/server/db/pool.js';
async function main(){
 const r=await query("SELECT ok, errors, detail, updated_at FROM source_status WHERE id=1");
 console.log(JSON.stringify(r.rows[0] ?? null));
 await pool().end();
}
main();
