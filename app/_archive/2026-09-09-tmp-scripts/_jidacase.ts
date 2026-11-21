import { query } from '../src/server/db/pool.js';
async function main() {
  const m = await query("SELECT match_id, num, home, away, league, hhad, had, had_base, hhad_base, support FROM matches WHERE away LIKE '%利雅胜利%' AND home LIKE '%吉达联合%'");
  for (const r of m.rows) {
    console.log(`${r.match_id} ${r.num} ${r.home}-${r.away} ${r.league}`);
    console.log('  hhad=', JSON.stringify(r.hhad));
    console.log('  had=', JSON.stringify(r.had));
    console.log('  hhad_base=', JSON.stringify(r.hhad_base));
    console.log('  had_base=', JSON.stringify(r.had_base));
    const blk = r.support?.HAD;
    console.log('  HAD support: eKey=', blk?.eKey, 'absValue=', blk?.absValue, 'hS=', blk?.hSupportRate, 'hP=', blk?.hProbability);
    const s = await query("SELECT total, dir, odds, market, pred, dims FROM scores WHERE match_id = $1 ORDER BY analyzed_at DESC LIMIT 1", [r.match_id]);
    console.log('  latest: total=', s.rows[0]?.total, s.rows[0]?.dir, '@', s.rows[0]?.odds, 'market=', s.rows[0]?.market);
    console.log('  dims=', JSON.stringify(s.rows[0]?.dims, null, 1).slice(0, 1400));
  }
  process.exit(0);
}
main();
