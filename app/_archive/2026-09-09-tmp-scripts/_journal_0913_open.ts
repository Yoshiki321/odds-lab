import { query, pool } from '../../src/server/db/pool.js';
import * as fs from 'fs';

const name = 'journal:2026-09-13';
const nowS = '2026-09-13T13:40:00+08:00';

// ---- docs journal ----
const r = await query(`SELECT body FROM docs WHERE name=$1`, [name]);
const base = {
  title: '开盘研判：空仓 + 12虚拟注',
  entries: [],
  cash: 1079.11,
  virtual: { total: 12, win: 0, loss: 0, void: 0 },
};
let body;
if (r.rows.length) {
  body = r.rows[0].body;
  body.entries = body.entries ?? [];
} else {
  body = JSON.parse(JSON.stringify(base));
}
body.entries.push({
  time: '13:40',
  type: 'open',
  text: `**开盘：实单空仓，12虚拟注覆盖（vb-165~176）。**
前日结算：09-12 虚拟注 9 结 = **6赢3走**（广岛主胜@1.43 6:1、蔚山主胜@1.95 2:1、桑德兰主负@1.36 0:2、波尔图主负@1.15、阿贾克斯主负@1.29、多特主胜@1.14 全中；热刺/毕尔巴鄂/利物浦输；钢巴+1走）。真注 0 结，现金 ¥1079.11 不变。
当日扫描 top 两实单档全被 R5 门禁拦：
- 汉坎-莫尔德 56 实单档 主负@1.54：EV-13.0%（竞彩1.54<欧1.65），距开 9.3h > 8h → R5 窗外，亚盘无 AH 线 settleEV 不可得 → 拦
- 莱万特-巴萨 49 实单档 客-2胜@1.82：无欧赔可比 + 深盘 M-03 模板，距开 8.6h > 8h → 拦
其余 22 场全部 <48（14 场⏳候选/弱，8 场❌弃投·平局），其中早场东京绿茵46/仙台45 在窗内但 <48 只虚拟。
**全日无满足 M-04 的实证 +EV 场次**：唯一高分汉坎 EV 负且无亚盘 settle 口径。
虚拟注：汉坎56（M-04第4样本：竞彩负EV方向对不对）、莱万特-巴萨深盘穿盘、3 场 R9 平局过滤器弃投场（莱切/皇家社会/库奥皮奥/东京绿茵）验证过滤器、那不勒斯客+1下盘保护化、拜仁/巴萨双深盘。`,
});
if (body.virtual) { body.virtual.total = 12; }
if (!body.cash) body.cash = 1079.11;
if (r.rows.length) {
  await query(`UPDATE docs SET body=$2::jsonb, updated_at=now() WHERE name=$1`, [name, JSON.stringify(body)]);
} else {
  await query(`INSERT INTO docs (name, body, updated_at) VALUES ($1,$2,now())`, [name, JSON.stringify(body)]);
}
console.log('journal:2026-09-13 已写入');

// ---- bankroll/ledger NO_BET；现金未变，仅追加轨迹 ----
const NOTE = '09-13开盘空仓：top2实单档全R5窗外（汉坎56 EV-13%无亚盘settle/莱万特49无欧赔），其余<48早场只虚拟；12虚拟注覆盖';
const DIR = 'C:/zwkj/竞彩助手/data/betting/';
const br = JSON.parse(fs.readFileSync(DIR + 'bankroll.json', 'utf8'));
br.sequence.push({ date: nowS, type: 'NO_BET', note: NOTE, amount: 0, balance: 1079.11 });
fs.writeFileSync(DIR + 'bankroll.json', JSON.stringify(br, null, 2), 'utf8');
const lg = JSON.parse(fs.readFileSync(DIR + 'ledger.json', 'utf8'));
lg.history.push({ date: nowS, type: 'NO_BET', note: NOTE, amount: 0, balance: 1079.11 });
fs.writeFileSync(DIR + 'ledger.json', JSON.stringify(lg, null, 2), 'utf8');
await query(`UPDATE bankroll SET cash=$1, settled_profit=$2, total_staked=$3, total_returned=$4, history=$5::jsonb, updated_at=now() WHERE id=1`,
  [1079.11, br.settled_profit ?? 79.11, br.total_staked ?? 112.25, br.total_returned ?? 191.36, JSON.stringify(br.sequence)]);
console.log('bankroll/ledger +09-13开盘空仓');
await pool().end();