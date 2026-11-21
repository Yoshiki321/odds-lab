import { query } from '../src/server/db/pool.js';
const tables = ['matches', 'scores', 'results', 'live_scores', 'bets', 'virtual_bets', 'bankroll', 'scan_plans', 'source_status', 'docs'];
for (const t of tables) {
  try { const r = await query(`SELECT count(*) c FROM ${t}`); console.log(`${t.padEnd(14)} ${r.rows[0].c}`); }
  catch (e) { console.log(`${t.padEnd(14)} ERR ${e.message}`); }
}
const d = await query(`SELECT count(*) c, count(DISTINCT match_date) days FROM matches`);
console.log(`matches days=${d.rows[0].days}`);
const bets = await query(`SELECT status, count(*) FROM bets GROUP BY status`);
for (const x of bets.rows) console.log(`  bet status=${x.status} ${x.count}`);
const virt = await query(`SELECT status, count(*) FROM virtual_bets GROUP BY status`);
for (const x of virt.rows) console.log(`  virtual status=${x.status} ${x.count}`);
