import { pool } from '../../src/server/db/pool.js';
const r = await pool().query(`
  SELECT id, match_id, confidence, pick, status FROM virtual_bets WHERE id >= 'vb-165' ORDER BY id`);
for (const x of r.rows) console.log(x.id, x.match_id, x.confidence, x.pick, x.status);
const st = await pool().query(`SELECT ok, errors, updated_at FROM source_status WHERE id=1`);
const s = st.rows[0];
console.log('source_status ok=', s.ok, 'errors=', s.errors, 'at=', String(s.updated_at).slice(0, 19));
await pool().end();