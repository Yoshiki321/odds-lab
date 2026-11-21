import { pool } from '../../src/server/db/pool.js';
(async () => {
  try {
    const r = await pool().query(`SELECT * FROM source_status ORDER BY updated_at DESC LIMIT 5`);
    console.log('source_status rows:', r.rows.length);
    for (const row of r.rows) console.log(JSON.stringify(row));
  } finally {
    await pool().end();
  }
})().catch(e => { console.error(e); process.exit(1); });
