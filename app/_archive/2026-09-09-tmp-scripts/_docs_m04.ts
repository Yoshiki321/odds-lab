import { query, pool } from '../../src/server/db/pool.js';
// M-04 复盘落档（PG docs，网页读源；文件锁期间先走 PG）
// 内容：09-09 隔夜复盘 —— 方向命中 7/15、被 EV 门禁拦下的三张方向全对 → 规则候选：负EV档位改投欧亚盘同方向
const body = {
  version: 'v2.1',
  updatedAt: '2026-09-10T16:15+08:00',
  review: {
    date: '2026-09-09',
    salesDay: '2026-09-09',
    settled: '14/15 官方终场（江原为次日补录，已入09-10）',
    directionAccuracy: '7/15 = 47%（末帧 pred vs 官方赛果）',
    key: [
      '被 EV 门禁拦下的三张方向全对：那不勒斯 52分 pred=A✅(0:1)、巴黎 48分 pred=H✅(6:1)、切尔西 47分 pred=H✅(6:3)。大热方向本身大概率对，竞彩负EV主要来自赔率定价低于欧盘。',
      '按欧亚盘玩法：结算用欧亚盘 → 同一方向投欧亚盘（欧赔/上盘）为合法+EV，不必因竞彩负EV放弃方向。'
    ],
  },
  ruleCandidate: 'M-04 负EV档位改投欧亚盘同方向：竞彩目标场次 score≥48 且欧亚方向负EV时，不空仓，改记同方向@欧亚盘（结算盘口）；仅当竞彩赔率高于欧盘（逆向定价）才真放弃。价值维改读 europe_odds_history 最近值（补评分轮次"无欧赔可比"缺漏）。',
  today: { date: '2026-09-10', result: '待盘', mistakes: ['M-04'] }
};
const r = await query(`SELECT name FROM docs WHERE name='scoring-upgrade'`);
if (r.rows.length) {
  await query(`UPDATE docs SET body=$1::jsonb, updated_at=now() WHERE name='scoring-upgrade'`, [JSON.stringify(body)]);
  console.log('docs scoring-upgrade 已更新 (M-04)');
} else {
  await query(`INSERT INTO docs (name, body) VALUES ('scoring-upgrade', $1::jsonb)`, [JSON.stringify(body)]);
  console.log('docs scoring-upgrade 已插入 (M-04)');
}
await pool().end();
