import { query, pool } from '../../src/server/db/pool.js';
async function main(){
  const r = await query("SELECT body->>'content' IS NOT NULL AS has_content, updated_at FROM docs WHERE name='journal:2026-09-09'");
  if (r.rows.length === 0) { console.log('docs 无 journal:2026-09-09'); }
  else { console.log('docs 有 journal, updated_at=', String(r.rows[0].updated_at)); }
  await pool().end();
}
main();
