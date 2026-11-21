import { pool } from '../../src/server/db/pool.js';
import * as fs from 'fs';
(async () => {
  const p = pool();
  // 1. virtual bets status from PG
  const v = await p.query(`SELECT id, match_id, pick, odds, status, result FROM virtual_bets WHERE kickoff::date >= '2026-09-11' AND kickoff::date <= '2026-09-11' ORDER BY id`);
  console.log('== virtual_bets 09-11 ==');
  for (const r of v.rows) console.log(`${r.id} ${r.match_id} ${r.pick} @${r.odds} stake=${r.stake} status=${r.status} pnl=${r.pnl}`);

  // 2. bankroll
  const b = await p.query(`SELECT * FROM bankroll ORDER BY updated_at DESC LIMIT 1`);
  console.log('== bankroll ==', JSON.stringify(b.rows[0] ?? null));

  // 3. 09-12 board top scores for tomorrow candidates
  const s = await p.query(`
    SELECT s.match_id, m.home, m.away, m.kickoff_time, s.total, s.band, s.dir, s.odds, s.pred
    FROM scores s JOIN matches m ON m.match_id = s.match_id
    WHERE s.match_date = '2026-09-12' AND s.scan_round = (SELECT MAX(scan_round) FROM scores s2 WHERE s2.match_id = s.match_id AND s2.match_date = '2026-09-12')
    ORDER BY s.total DESC LIMIT 15`);
  console.log('== 09-12 board top15 ==');
  for (const r of s.rows) console.log(`${r.match_id} ${r.home} vs ${r.away} ${r.kickoff_time} total=${r.total} ${r.band} ${r.dir} ${r.odds} (${r.pred})`);

  await p.end();
})().catch(e => { console.error(e); process.exit(1); });
