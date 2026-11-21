import { query, pool } from '../../src/server/db/pool.js';
const body = {
  date: '2026-09-11',
  title: '隔夜赛果复盘 + 开盘前状态',
  mood: '🛡️ 稳健·开盘日',
  entries: [{
    time: '09:24',
    type: 'overnight-review',
    text: '**隔夜复盘：09-10 盘官方已开奖 6 场，评分方向命中 4/6=67%。** 拜仁 5:0、曼联 4:0 主胜方向命中；科莫 4:1 主胜方向命中；斯拉维亚 2:3 客胜方向命中。阿马多拉 2:1 与费内巴切 1:1 方向未命中，其中费内巴切命中平局过滤器，说明 R9 有效；深盘高分的拜仁/曼联最终方向正确，但让球 P99/P100 仍不应直接等同穿盘。第 7 场官方结果尚未入库，不计入命中率。当前无实单、无虚拟单，现金保持 1079.11。'
  }],
  bets: [], cash: 1079.11, inPlay: [], mistakes: []
};
const name = 'journal:2026-09-11';
const r = await query('SELECT name FROM docs WHERE name=$1', [name]);
if (r.rows.length) await query('UPDATE docs SET body=$1::jsonb, updated_at=now() WHERE name=$2', [JSON.stringify(body), name]);
else await query('INSERT INTO docs(name, body) VALUES($1, $2::jsonb)', [name, JSON.stringify(body)]);
console.log('journal:2026-09-11 已写入');
await pool().end();
