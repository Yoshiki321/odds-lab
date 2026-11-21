import { pool } from '../../src/server/db/pool.js';
(async () => {
  const p = pool();
  const v = await p.query(`
    SELECT id, match_id, pick, odds, status, kickoff FROM virtual_bets
    WHERE placed_at::date >= '2026-09-11'::date ORDER BY id`);
  console.log('== placed 09-11 ==');
  for (const r of v.rows) console.log(`${r.id} ${r.match_id} ${r.pick} @${r.odds} ko=${r.kickoff ? r.kickoff.toISOString() : 'null'} st=${r.status}`);

  // matches: score + kickoff for 09-12 top board
  const s = await p.query(`
    SELECT s.match_id, m.home, m.away, m.kickoff, s.total, s.band, s.dir, s.odds, s.pred
    FROM scores s JOIN matches m ON m.match_id = s.match_id
    WHERE s.match_date = '2026-09-12'
    ORDER BY s.total DESC, s.analyzed_at DESC LIMIT 14`);
  console.log('== 09-12 top ==');
  const seen = new Set();
  for (const r of s.rows) {
    if (seen.has(r.match_id)) continue;
    seen.add(r.match_id);
    console.log(`${r.match_id} ${r.home} vs ${r.away} ko=${r.kickoff ? r.kickoff.toISOString() : ''} total=${r.total} ${r.band} ${r.dir} @${r.odds} (${r.pred})`);
  }
  await p.end();
})().catch(e => { console.error(e); process.exit(1); });
