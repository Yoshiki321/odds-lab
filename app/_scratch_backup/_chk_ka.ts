import { query } from './src/server/db/pool.js';
const r = await query(`SELECT num, home, away, had, hhad, had_base, hhad_base FROM matches WHERE match_date='2026-09-07' AND (home LIKE '%卡尔马%' OR home LIKE '%埃尔切%')`);
for (const x of r.rows) {
  const b = x.hhad_base, c = x.hhad;
  console.log(x.num, x.home+'-'+x.away);
  console.log('  基线hhad:', JSON.stringify(b), '→ 当前:', JSON.stringify(c));
  console.log('  基线had :', JSON.stringify(x.had_base), '→ 当前:', JSON.stringify(x.had));
}
process.exit(0);
