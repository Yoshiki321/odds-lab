import { pool } from '../../src/server/db/pool.js';
async function main() {
  const p = pool();
  const d = await p.query(`SELECT name, updated_at FROM docs WHERE name LIKE 'journal:%' OR name LIKE 'bankroll%' OR name='scoring-upgrade' ORDER BY updated_at DESC LIMIT 8`);
  for (const r of d.rows) console.log(`${r.name}\t${r.updated_at}`);
  const j = await p.query(`SELECT body FROM docs WHERE name='journal:2026-09-12'`);
  if (j.rows.length) {
    const b = j.rows[0].body;
    console.log('\n[09-12 日记] keys=', Object.keys(b).join(','), '\n', JSON.stringify(b).slice(0, 400));
  } else console.log('\n[无 09-12 日记]');
  await p.end();
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); });
