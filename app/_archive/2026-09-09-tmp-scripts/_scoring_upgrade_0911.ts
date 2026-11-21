import { pool } from '../../src/server/db/pool.js';
const name = 'scoring-upgrade';
const r = await pool().query(`SELECT body FROM docs WHERE name=$1`, [name]);
if (!r.rows.length) throw new Error('scoring-upgrade doc 不存在');
const body = r.rows[0].body;
const entry = {
  date: '2026-09-11',
  tag: 'M-04样本',
  match: '京都 2:3 柏太阳神',
  what: '开盘拒投的 M-04 候选 主负@1.56 命中（竞彩1.56 vs 欧盘1.67，转欧亚亦非+EV→真放弃实单）。',
  why: '竞彩负EV≠方向错：方向系统指向主负正确，但两个盘口期望都为负，实单空仓仍是正确纪律。',
  keep: 'M-04 继续按「scores≥48 且竞彩低水→改投欧亚盘」走，但要求欧亚价转正期望才放行；单纯方向对不计入 EV 改判。',
};
const arr = Array.isArray(body.entries) ? body.entries : (Array.isArray(body.history) ? body.history : (Array.isArray(body) ? body : [body]));
if (Array.isArray(body.entries)) body.entries.push(entry);
else if (Array.isArray(body.history)) body.history.push(entry);
else if (Array.isArray(body)) body.push(entry);
else body.entries = [entry];
await pool().query(`UPDATE docs SET body=$2::jsonb, updated_at=now() WHERE name=$1`, [name, JSON.stringify(body)]);
console.log('scoring-upgrade +M-04 样本 09-11');
await pool().end();
