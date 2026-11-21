import { pool } from '../../src/server/db/pool.js';
async function main() {
  const db = pool();
  const r = await db.query("select num, support from matches where support is not null order by updated_at desc limit 1");
  if (!r.rows.length) { console.log('无support'); return; }
  const g = typeof r.rows[0].support === 'string' ? JSON.parse(r.rows[0].support) : r.rows[0].support;
  for (const k of Object.keys(g)) {
    console.log(`--- ${k}:`);
    for (const [kk, vv] of Object.entries(g[k] || {})) console.log(`  ${kk}: ${JSON.stringify(vv)}`);
  }
  await db.end();
}
main().catch(e => { console.error(e); process.exit(1); });