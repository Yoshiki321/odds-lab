import { query, pool } from '../../src/server/db/pool.js';
// 同步 docs 表 scoring-upgrade（记分引擎/网页读取的规则载体）
const body = {
  version: 'v2.1',
  updatedAt: '2026-09-09T23:40+08:00',
  ruleCandidate: 'M-03 实单档虚高门禁：value维=0 且 dims.value.note 含负 EV 时，band 强制标注"虚高"并降一档；竞彩让球方向 vs 欧盘反转（如主胜@1.36 vs 欧2.20）记轮换风险因子。待样本验证后入 score.ts 规则。',
  today: { date: '2026-09-09', result: '空仓', mistakes: ['M-03'] }
};
const r = await query(`SELECT name FROM docs WHERE name='scoring-upgrade'`);
if (r.rows.length) {
  await query(`UPDATE docs SET body=$1::jsonb, updated_at=now() WHERE name='scoring-upgrade'`, [JSON.stringify(body)]);
  console.log('docs scoring-upgrade 已更新');
} else {
  await query(`INSERT INTO docs (name, body) VALUES ('scoring-upgrade', $1::jsonb)`, [JSON.stringify(body)]);
  console.log('docs scoring-upgrade 已插入');
}
await pool().end();
