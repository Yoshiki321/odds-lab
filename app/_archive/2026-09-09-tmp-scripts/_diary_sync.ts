import { readFileSync } from 'node:fs';
import { query, pool } from '../../src/server/db/pool.js';
import { upsertDoc } from '../../src/server/db/store.js';
async function main() {
  const p = 'C:/zwkj/竞彩助手/data/diary/journals/2026-09-09.json';
  const body = JSON.parse(readFileSync(p, 'utf8'));
  await upsertDoc('journal:2026-09-09', body);
  const ck = await query("SELECT updated_at FROM docs WHERE name='journal:2026-09-09'");
  console.log('synced, updated_at=', String(ck.rows[0].updated_at), '| entries=', body.content.length);
  await pool().end();
}
main();
