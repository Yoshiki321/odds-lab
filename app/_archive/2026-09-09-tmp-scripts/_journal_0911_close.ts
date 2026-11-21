import { query, pool } from '../../src/server/db/pool.js';
const name = 'journal:2026-09-11';
const r = await query(`SELECT body FROM docs WHERE name=$1`, [name]);
if (!r.rows.length) throw new Error('journal 今日不存在');
const body = r.rows[0].body;
body.title = '开盘研判：空仓 + 12虚拟注 ｜ 关盘：空仓，vb-141命中';
body.entries.push({
  time: '23:10',
  type: 'close',
  text: `**关盘收工：实单空仓，虚拟注 1 结 11 在途。**
已开奖京都 2:3 柏太阳神：开盘拒投的 M-04 候选方向（主负@1.56）命中——竞彩负EV不等于方向错，方向对也不改变「转欧亚亦非+EV → 真放弃」的结论，这是 M-04 第 2 个实盘样本（方向对、实单仍该空）。
西汉姆 50 实单档 19:37 复评：降水 0.24 强信号、R_draw 0.20 无平局结构，但无所值维（无欧赔可比）——1.40 大热隐含 71% 与英冠主胜历史 36% 背离，EV 门禁不放行，维持空仓。全表再无 ≥48 可实证 +EV 场次。
次日 09-12 板候选扫描：最高 43（福图纳-阿贾克斯主负@1.29），无 ≥48 实单档，明日开盘大概率继续空仓或只走虚拟注。`,
});
body.cash = 1079.11;
await query(`UPDATE docs SET body=$2::jsonb, updated_at=now() WHERE name=$1`, [name, JSON.stringify(body)]);
console.log('journal close entry 已更新');
await pool().end();