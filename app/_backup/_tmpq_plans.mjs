import { pool } from '../src/server/db/pool.js';
const p = pool();
const r = await p.query('SELECT id, match_date, labels, kickoff, status FROM scan_plans ORDER BY match_date, id');
for (const x of r.rows) console.log(String(x.id).padEnd(16), String(x.match_date).slice(0, 10), String(x.labels[0]).padEnd(5), x.kickoff ? new Date(x.kickoff).toISOString().slice(0, 16) : 'NULL');
console.log('rows:', r.rows.length);
await p.end();
process.exit(0);