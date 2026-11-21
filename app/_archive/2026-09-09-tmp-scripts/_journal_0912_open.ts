import { query, pool } from '../../src/server/db/pool.js';
import * as fs from 'fs';

const name = 'journal:2026-09-12';
const nowS = '2026-09-12T13:40:00+08:00';

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
  text: `**开盘：实单空仓，12虚拟注覆盖（vb-153~164）。**
前日结算：09-11 虚拟注 12 结 = **9赢2输1走**（西汉姆主胜@1.42、纽伦堡@2.35、柏林联@2.72、马斯特里@1.98、塞维利亚@1.82、威尼斯@2.22、哈马费萨@1.45、雷恩@1.82、京都@1.56 全中；赫根、科里蒂巴输；阿尔克马-2走）。真注 0 结，现金不变。
当日扫描 top 三场全被门禁拦：
- 大阪钢巴 58 加注档 主+1胜@1.78：价值维0（欧EV-83.7% 让球P9% 钳制失真，M-03 深盘模板，亚盘-2.75）→ 拦
- 皇马 57 实单档 主-2胜@1.72：价值10（欧EV+69.7%），但 R5 距开15h>8h 拦 + P99% 疑失真 → 拦，19:00 入窗后复评
- 桑德兰-阿森纳 48 实单档 主负@1.36：欧EV-15.9%（竞彩1.36<欧1.53）M-04 形态 → 真放弃
其余全 ≤47 候选/弱/弃投·平局。全日无实证 +EV 实单场次。
虚拟注亮点：蔚山 44 弃投·平局但降水0.30 全日最强信号，测 R9 平局过滤器 vs 强降水冲突；多特 1.14 极深大热测穿盘。`,
});
if (body.virtual) { body.virtual.total = 12; }
if (!body.cash) body.cash = 1079.11;
if (r.rows.length) {
  await query(`UPDATE docs SET body=$2::jsonb, updated_at=now() WHERE name=$1`, [name, JSON.stringify(body)]);
} else {
  await query(`INSERT INTO docs (name, body, updated_at) VALUES ($1,$2,now())`, [name, JSON.stringify(body)]);
}
console.log('journal:2026-09-12 已写入');

// ---- bankroll/ledger NO_BET ----
const NOTE = '09-12开盘空仓：top3全被门禁拦（大阪钢巴M-03深盘EV失真/皇马R5+深盘/桑德兰EV-15.9%），无实证+EV场次；虚拟注12单覆盖关键场次';
const DIR = 'C:/zwkj/竞彩助手/data/betting/';
const br = JSON.parse(fs.readFileSync(DIR + 'bankroll.json', 'utf8'));
br.sequence.push({ date: nowS, type: 'NO_BET', note: NOTE, amount: 0, balance: 1079.11 });
fs.writeFileSync(DIR + 'bankroll.json', JSON.stringify(br, null, 2), 'utf8');
const lg = JSON.parse(fs.readFileSync(DIR + 'ledger.json', 'utf8'));
lg.history.push({ date: nowS, type: 'NO_BET', note: NOTE, amount: 0, balance: 1079.11 });
lg.lastUpdated = nowS;
fs.writeFileSync(DIR + 'ledger.json', JSON.stringify(lg, null, 2), 'utf8');
await query(`UPDATE bankroll SET cash=$1, settled_profit=$2, total_staked=$3, total_returned=$4, history=$5::jsonb, updated_at=now() WHERE id=1`,
  [1079.11, 79.11, 112.25, 191.36, JSON.stringify(br.sequence)]);
console.log('bankroll/ledger +09-12开盘空仓');
await pool().end();