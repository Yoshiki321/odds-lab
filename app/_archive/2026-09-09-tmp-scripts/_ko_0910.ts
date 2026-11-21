import { query, pool } from '../../src/server/db/pool.js';
(async () => {
  const p = pool();
  const now = Date.now();
  const r = await p.query(
    `SELECT m.num, m.home, m.away, m.league, m.kickoff
       FROM matches m WHERE m.match_date='2026-09-10' ORDER BY m.kickoff`);
  for (const x of r.rows) {
    const hrs = (new Date(x.kickoff).getTime() - now) / 36e5;
    console.log(x.num, x.league.padEnd(6), `${x.home}-${x.away}`.padEnd(18),
      String(x.kickoff).slice(0, 16), hrs >= 0 ? `距开${hrs.toFixed(1)}h` : `已开${Math.abs(hrs).toFixed(1)}h`);
  }
  await p.end();
})().catch(e => { console.error(e.message); process.exit(1); });