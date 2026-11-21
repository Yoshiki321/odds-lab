import { pool } from '../../src/server/db/pool.js';
import { fairProbForPick } from '../../tools/ev-fit.js';
async function main() {
  const p = pool();
  const e = await p.query(`SELECT home_odds, draw_odds, away_odds, observed_at FROM europe_odds WHERE match_id='2041406'`);
  const s = await p.query(`SELECT scan_round, total, band, dims->'value'->>'note' note, to_char(analyzed_at,'HH24:MI') t FROM scores WHERE match_id='2041406' ORDER BY scan_round`);
  for (const r of s.rows) console.log(`r${r.scan_round} ${r.total} ${r.band} note=${r.note} @${r.t}`);
  const e2 = e.rows[0];
  const raw = { home: 1/+e2.home_odds, draw: 1/+e2.draw_odds, away: 1/+e2.away_odds };
  const z = raw.home + raw.draw + raw.away;
  const fair = { home: raw.home/z, draw: raw.draw/z, away: raw.away/z };
  console.log('欧赔', e2.home_odds, e2.draw_odds, e2.away_odds, 'fair', fair.home.toFixed(3), fair.draw.toFixed(3), fair.away.toFixed(3));
  console.log('新ev-fit 主+1胜 P =', fairProbForPick(fair, 'H', 'HHAD', +1)?.toFixed(3));
  await p.end();
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); });
