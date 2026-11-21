import { pool } from '../src/server/db/pool.js';
const p = pool();
const r = await p.query(`SELECT m.num, m.home, m.away, ls.score lscore, ls.status_name lst, res.score rscore, res.fetched_at rfa
  FROM matches m
  LEFT JOIN live_scores ls ON ls.match_id = m.match_id
  LEFT JOIN results res ON res.match_id = m.match_id
  WHERE m.match_date = '2026-09-06' ORDER BY m.kickoff`);
for (const x of r.rows) console.log(String(x.num).padEnd(6), String(x.home).padEnd(8), String(x.away).padEnd(8), 'live='+String(x.lscore).padEnd(5), String(x.lst).padEnd(5), 'res='+(x.rscore||'-'));
await p.end(); process.exit(0);
