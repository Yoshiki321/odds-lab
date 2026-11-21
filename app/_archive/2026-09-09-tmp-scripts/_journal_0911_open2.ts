import { query, pool } from '../../src/server/db/pool.js';
const body = {
  date: '2026-09-11',
  title: '开盘研判：空仓 + 12虚拟注',
  mood: '🛡️ 稳健·开盘日',
  entries: [
    {
      time: '09:24',
      type: 'overnight-review',
      text: '**隔夜复盘：09-10 盘官方已开奖 6 场，评分方向命中 4/6=67%。** 拜仁 5:0、曼联 4:0、科莫 4:1、斯拉维亚 2:3 方向命中；阿马多拉 2:1、费内巴切 1:1 未中（费内巴切被平局过滤器提前拦截，R9 有效）。当前无实单、无虚拟单。',
    },
    {
      time: '13:35',
      type: 'decide',
      text: `**开盘裁决：实单空仓，虚拟注 12 单。**\n\n① 京都-柏太阳神 51 分实单档（早场 18:00 在购窗内）：欧盘定价客胜 EV -12%，竞彩客胜 1.56 比欧盘 1.67 更低——方向未证伪但两个盘口都不是正期望，按 EV 门禁放弃（即便按规则候选改投欧亚盘也不划算）；② 西汉姆联 48 分实单档：03:00 开赛超八小时窗口，19:00 后再评估是否补；③ 塞维利亚 47、威尼斯/纽伦堡/柏林联合/科里蒂巴 弃投·平局，R9 不投；④ 赫根 46、阿尔克马 43（深盘让2 概率钳制失真 M-03 模板）、哈马费萨 40 候选档只虚拟；⑤ 雷恩 36、马斯特里 31 弱档。\n\n全表未出现 ≥58 加注场次，最高分 51 却卡在 EV 门禁——今日无票可买。虚拟注 12 单铺满全表，重点验证：M-04（京都会不会客胜验证了负EV≠方向错）、R9 与强降水 0.32 的对抗（塞维利亚）、深盘让2 P97% 是否失真（阿尔克马）。`,
    },
  ],
  bets: [],
  cash: 1079.11,
  inPlay: [],
  virtual: 12,
  mistakes: [],
};
const name = 'journal:2026-09-11';
const r = await query(`SELECT name FROM docs WHERE name=$1`, [name]);
if (r.rows.length) {
  await query(`UPDATE docs SET body=$1::jsonb, updated_at=now() WHERE name=$2`, [JSON.stringify(body), name]);
  console.log('journal:2026-09-11 已更新（开盘裁决）');
} else {
  await query(`INSERT INTO docs(name, body) VALUES($1,$2::jsonb)`, [name, JSON.stringify(body)]);
  console.log('journal:2026-09-11 已写入');
}
await pool().end();