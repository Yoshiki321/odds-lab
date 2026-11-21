import { query, pool } from '../../src/server/db/pool.js';
// 更新 journal:2026-09-10 —— 修正 17:51 误述 + 补 23:37 关盘裁决
const body = {
  date: '2026-09-10',
  title: '隔夜复盘 + 盘口研判后关盘空仓',
  mood: '🛡️ 稳健·复盘日',
  entries: [
    {
      time: '09:00',
      type: 'overnight-review',
      text: `**隔夜复盘（09-09 销售日）：方向命中 7/15=47%。**\n\n被 EV 门禁拦下的三张方向全对：那不勒斯 客胜 0:1✅、巴黎 主胜 6:1✅、切尔西 主胜 6:3✅。结论：大热方向概率本身对，负EV主要来自竞彩把赔率定在欧盘之下；按欧亚盘玩法，同一方向改投欧亚盘为合法+EV，不应空仓。（复盘细则已入自我升级账 M-04）`,
    },
    {
      time: '13:03',
      type: 'summary',
      text: `**午间开盘：当日 7 场全量评分。**\n\n曼联 51、科莫 50、拜仁 48、费内巴切/德尔瓦耶 47、阿马多拉 46、斯拉维亚 38。均于今日 13:00-23:00 购窗内可选投。初次判断误记为"已开赛"，晚间已更正（下述）。`,
    },
    {
      time: '23:37',
      type: 'decide',
      text: `**关盘裁决：空仓。三理由。**\n\n① 高位两票（曼联 62、拜仁 60，加注档，欧盘方向大正）：但方向均为让 2-3 球深盘，让球概率测算钳制在 99-100%（此前巴黎同形态已验证其失真），加注不成立；② 中位票科莫 49 实单，欧盘定价负期望 -15% 门禁拦下；费内巴切/阿马多拉同理负期望；③ 费内巴切/德尔瓦耶/斯拉维亚平局结构弃投。全天实单 0 单，虚拟 0。`,
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
  console.log('journal:2026-09-10 已修正+补关盘');
}
await pool().end();