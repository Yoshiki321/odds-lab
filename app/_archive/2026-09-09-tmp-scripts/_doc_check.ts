import { query, pool } from '../../src/server/db/pool.js';
(async () => {
  const r = await query(`SELECT name, body->>'updatedAt' upd, body->>'version' ver, left(body::text, 200) head FROM docs ORDER BY name`);
  for (const x of r.rows) console.log(`${x.name}  [${x.upd}] v${x.ver}  ${(x.head || '').slice(0, 120)}`);
  await pool().end();
})().catch(e => { console.error(e.message); process.exit(1); });