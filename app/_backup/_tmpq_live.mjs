import { pool } from '../src/server/db/pool.js';
const p = pool();
const l = await p.query(`SELECT ls.match_id, m.num, m.home, m.away, ls.score, ls.ht, ls.status, ls.status_name, ls.source, ls.fetched_at
  FROM live_scores ls JOIN matches m ON m.match_id = ls.match_id ORDER BY ls.fetched_at DESC LIMIT 15`);
console.log('live_scores 总数:', (await p.query('SELECT count(*) c FROM live_scores')).rows[0].c);
for (const x of l.rows) console.log(String(x.num).padEnd(6), String(x.home).padEnd(8), String(x.away).padEnd(8), 'score='+x.score, 'st='+x.status_name, 'src='+x.source, 'fetched='+new Date(x.fetched_at).toISOString().slice(0,19));
const r = await p.query(`SELECT m.num, m.home, m.away, res.score, res.had, res.hhad, res.fetched_at FROM results res JOIN matches m ON m.match_id = res.match_id ORDER BY res.fetched_at DESC LIMIT 15`);
console.log('results 总数:', (await p.query('SELECT count(*) c FROM results')).rows[0].c);
for (const x of r.rows) console.log(String(x.num).padEnd(6), String(x.home).padEnd(8), String(x.away).padEnd(8), 'score='+x.score, 'had='+x.had, 'hhad='+x.hhad, 'fetched='+new Date(x.fetched_at).toISOString().slice(0,19));
await p.end(); process.exit(0);
