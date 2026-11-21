import { pool } from '../../src/server/db/pool.js';
const r = await pool().query('SELECT ok, errors, detail, updated_at FROM source_status WHERE id=1');
const s = r.rows[0];
console.log('ok=', s.ok, 'errors=', JSON.stringify(s.errors)?.slice(0, 400));
console.log('updated_at=', String(s.updated_at).slice(0, 19));
await pool().end();