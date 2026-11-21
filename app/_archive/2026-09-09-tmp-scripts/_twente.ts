import { query, pool } from '../../src/server/db/pool.js';
const kw = '%' + '特温特' + '%';
const r = await query(
  `SELECT m.match_id, m.num, m.home, m.away, m.league,
          to_char(m.kickoff AT TIME ZONE 'Asia/Shanghai', 'MM-DD HH24:MI') ko,
          to_char(m.match_date, 'YYYY-MM-DD') md
     FROM matches m
    WHERE m.home LIKE $1 OR m.away LIKE $1
    ORDER BY m.kickoff DESC LIMIT 3`, [kw]);
console.log('特温特 rows:', JSON.stringify(r.rows));
await pool().end();