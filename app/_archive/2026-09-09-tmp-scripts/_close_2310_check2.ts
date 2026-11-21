import { pool } from '../../src/server/db/pool.js';
(async () => {
  const p = pool();
  const v = await p.query(`SELECT id, match_id, pick, odds, status, kickoff, placed_at FROM virtual_bets ORDER BY id LIMIT 60`);
  console.log('== all virtual_bets ==');
  for (const r of v.rows) console.log(`${r.id} ${r.match_id} ${r.pick} @${r.odds} ko=${r.kickoff ? r.kickoff.toISOString() : 'null'} st=${r.status} placed=${r.placed_at ? r.placed_at.toISOString() : ''}`);

  const m = await p.query(`SELECT column_name FROM information_schema.columns WHERE table_name='matches' ORDER BY ordinal_position`);
  console.log('== matches cols ==', m.rows.map(r => r.column_name).join(','));
  await p.end();
})().catch(e => { console.error(e); process.exit(1); });
