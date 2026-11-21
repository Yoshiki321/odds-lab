import { pool } from '../../src/server/db/pool.js';
async function main() {
  const r = await pool().query('SELECT source, updated_at, ok, message FROM source_status ORDER BY updated_at DESC LIMIT 12');
  for (const row of r.rows) {
    console.log(`${row.source}\t${row.ok ? 'OK' : 'ERR'}\t${row.updated_at?.toISOString?.() ?? row.updated_at}\t${row.message ?? ''}`);
  }
  await pool().end();
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); });
