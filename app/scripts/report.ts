// report.ts - 汇报：评分档位分布 + 信息源状态 + 在途注单
import { query } from '../src/server/db/pool.js';
async function run() {
  const s = await query(`SELECT total, count(*) n FROM scores WHERE match_date='2026-09-07' GROUP BY total ORDER BY total DESC`);
  const bands = { '≥80加注': 0, '70-79实单': 0, '60-69候选': 0, '40-59弱': 0, '<40放弃': 0 };
  for (const r of s.rows) {
    if (r.total >= 80) bands['≥80加注'] += +r.n;
    else if (r.total >= 70) bands['70-79实单'] += +r.n;
    else if (r.total >= 60) bands['60-69候选'] += +r.n;
    else if (r.total >= 40) bands['40-59弱'] += +r.n;
    else bands['<40放弃'] += +r.n;
  }
  console.log('09-07 评分档位:', JSON.stringify(bands), '共', s.rows.reduce((a, b) => a + +b.n, 0), '场');
  const top = await query(`SELECT m.num, m.home, m.away, sc.total, sc.pred, sc.market FROM scores sc JOIN matches m ON m.match_id=sc.match_id WHERE sc.match_date='2026-09-07' AND sc.total>=60 ORDER BY sc.total DESC`);
  console.log('≥60 场次:');
  for (const r of top.rows) console.log(' ', r.num, r.home, 'v', r.away, r.total + '分', r.pred, r.market);
  const st = await query(`SELECT * FROM source_status ORDER BY updated_at DESC LIMIT 3`).catch(() => ({ rows: [] }));
  console.log('source_status:', st.rows.length ? JSON.stringify(st.rows[0]) : '无');
  const bets = await query(`SELECT bet_id, stake, status FROM bets WHERE status='open' ORDER BY placed_at DESC LIMIT 5`).catch(() => ({ rows: [] }));
  console.log('在途:', bets.rows.length ? JSON.stringify(bets.rows) : '无');
  process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });