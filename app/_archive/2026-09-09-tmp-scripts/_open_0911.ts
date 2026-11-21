import { query, pool } from '../../src/server/db/pool.js';
// 13:00 开盘：当日评分 + 欧赔 + EV + 已有注单核对
(async () => {
  const p = pool();
  const r = await p.query(
    `SELECT m.num, m.league, m.home, m.away,
            to_char(m.kickoff AT TIME ZONE 'Asia/Shanghai','MM-DD HH24:MI') AS ko,
            s.total, s.band, s.market, s.pred, s.odds,
            s.dims->'value'->>'note' AS vnote,
            s.dims->'model'->>'note' AS mnote,
            s.dims->'risk'->>'note' AS rnote,
            s.dims->'drop'->>'note' AS dnote
       FROM scores s JOIN matches m USING(match_id)
      WHERE m.match_date='2026-09-11'
      ORDER BY s.total DESC`);
  console.log('== 09-11 评分 ==');
  for (const x of r.rows) console.log(`${x.num} ${x.league} ${x.home}-${x.away} ko=${x.ko} ${x.total} ${x.band} pred=${x.pred}@${x.odds} | ${x.dnote} | ${x.vnote} | ${x.mnote}`);

  const e = await p.query(
    `SELECT m.num, m.home, m.away, eu.home_odds, eu.draw_odds, eu.away_odds,
            to_char(eu.observed_at AT TIME ZONE 'Asia/Shanghai','HH24:MI') AS at
       FROM europe_odds eu JOIN matches m USING(match_id)
      WHERE m.match_date='2026-09-11' ORDER BY m.num`);
  console.log('\n== 欧赔 ==');
  for (const x of e.rows) console.log(`${x.num} ${x.home}-${x.away} H${x.home_odds} D${x.draw_odds} A${x.away_odds} @${x.at}`);

  const b = await p.query(`SELECT bet_id, num, home, away, pick, odds, stake, status FROM bets WHERE status IN ('open','pending') ORDER BY bet_id`);
  console.log('\n== 在途真注 ==');
  if (!b.rows.length) console.log('  无');
  for (const x of b.rows) console.log(`  bet-${x.bet_id} ${x.home}-${x.away} ${x.pick}@${x.odds} ${x.stake} ${x.status}`);

  const v = await p.query(`SELECT id, match_num, home, away, pick, odds, status FROM virtual WHERE match_id IN (SELECT match_id FROM matches WHERE match_date='2026-09-11') ORDER BY id`);
  console.log('== 09-11 已有虚拟注 ==');
  if (!v.rows.length) console.log('  无');
  for (const x of v.rows) console.log(`  ${x.id} ${x.home}-${x.away} ${x.pick}@${x.odds} ${x.status}`);

  const br = await p.query(`SELECT cash, in_play, updated_at FROM bankroll WHERE id=1`);
  console.log('\n== bankroll ==', JSON.stringify(br.rows[0]));
  await p.end();
})().catch(e => { console.error(e.message); process.exit(1); });
