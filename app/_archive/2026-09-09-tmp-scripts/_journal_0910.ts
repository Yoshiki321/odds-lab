import { query, pool } from '../../src/server/db/pool.js';
// journal:2026-09-10 当日投注日记（只写球，football-only）
const body = {
  date: '2026-09-10',
  title: '隔夜复盘 + 今晨盘全已开赛，明日盘全弱，空仓',
  mood: '🛡️ 稳健·复盘日',
  entries: [
    {
      time: '09:00',
      type: 'overnight-review',
      text: `**隔夜复盘（09-09 销售日）：方向命中 7/15=47%。**\n\n被 EV 门禁拦下的三张方向全对：那不勒斯 客胜 0:1✅、巴黎 主胜 6:1✅、切尔西 主胜 6:3✅。结论：大热方向概率本身对，负EV主要来自竞彩把赔率定在欧盘之下；按欧亚盘玩法，同一方向改投欧亚盘为合法+EV，不应空仓。`,
    },
    {
      time: '13:03',
      type: 'summary',
      text: `**午间开盘：当日 7 场全量评分，3 场达实单档但均凌晨已开赛，无投窗。**\n\n当日盘 7 场（00:45-08:30 开赛）：曼联 51 实单、科莫 50 实单、拜仁 48 实单、德尔瓦耶 47 弃投·平局、费内巴切 47 候选·平局、阿马多拉 46 候选、斯拉维亚 38 弃投。全部已开赛，R5 投窗禁止。明日盘 12 场全 ≤37 弱/弃投，无档位达标。**空仓，理由：无窗口内候选 + 无档位达标场次。**`,
    },
    {
      time: '17:51',
      type: 'decide',
      text: `**收盘前复扫：维持空仓。**\n\n09-11 盘最早场（京都 18:00）距开赛 24h+，超投窗；其余全弱。今晚 23:07 关盘前若 09-11 早期场次进入 ≤8h 投窗且档位达标再评估。`,
    },
  ],
  bets: [],
  cash: 1079.11,
  inPlay: [],
  mistakes: ['M-04'],
};
const name = 'journal:2026-09-10';
const r = await query(`SELECT name FROM docs WHERE name=$1`, [name]);
if (r.rows.length) {
  await query(`UPDATE docs SET body=$1::jsonb, updated_at=now() WHERE name=$2`, [JSON.stringify(body), name]);
  console.log('journal:2026-09-10 已更新');
} else {
  await query(`INSERT INTO docs (name, body) VALUES ($1, $2::jsonb)`, [name, JSON.stringify(body)]);
  console.log('journal:2026-09-10 已插入');
}
await pool().end();
