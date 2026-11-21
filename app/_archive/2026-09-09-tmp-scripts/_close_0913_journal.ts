import { query, pool } from '../../src/server/db/pool.js';
import * as fs from 'fs';

const name = 'journal:2026-09-13';
const nowS = '2026-09-13T23:40:00+08:00';

const r = await query(`SELECT body FROM docs WHERE name=$1`, [name]);
let body = r.rows.length ? r.rows[0].body : { title: '关盘', entries: [], cash: 1079.11, virtual: { total: 12, win: 0, loss: 0, void: 0 } };
body.entries = body.entries ?? [];
body.entries.push({
  time: '23:40',
  type: 'close',
  text: `**关盘：实单空仓维持（全日无 M-04 可投场次），虚拟注 12 单中 2 单已结均负。**

**结算**：早场 2 场 1:1 双平，熊猫二连负：
- vb-172 东京绿茵 主胜@2.07：1:1 → loss（但**末帧方向已翻转为客+1胜**，客+1 于 1:1 实际该中 → 下注帧 vs 临场帧错配，赔了正确方向的虚拟注）
- vb-174 仙台七夕 主胜@1.55：1:1 → loss
其余 10 单在途（汉坎/莱万特/莱切/布雷斯特/皇家社会/库奥皮奥/那不勒斯/莱红牛/埃沃斯堡/海伦芬，凌晨+夜间场次未终场）。

**当日复盘（22/24 未终场，只 2 场可结）**：
- 方向命中 1/2 = 50%。东京绿茵按终帧客+1胜判定实际命中（1:1），仙台错杀。
- 高分段（24 场最高 59 芝加哥客+1，49 档汉坎/莱万特/法马利康/布雷斯特/仙台）全部未终场，明日结算。
- **运维教训**：23:00 最终刷新遇 sporttery 全站 567 WAF 风控（竞彩/支持率/计算器三接口全拦）→ 无最终帧，复盘用 21:37 成功帧。赛果接口未被拦，结算正常。

**现金 ¥1079.11 不变**（0 实单），虚拟池 2L 在累计。`,
});
await query(`UPDATE docs SET body=$2::jsonb, updated_at=now() WHERE name=$1`, [name, JSON.stringify(body)]);
console.log('journal close 已写');

const NOTE = '09-13关盘空仓：全日无M-04可投；sporttery 567风控致无最终帧(用21:37帧)；虚拟2结均负(东京绿茵1:1末帧客+1被早帧主胜错配)';
const DIR = 'C:/zwkj/竞彩助手/data/betting/';
const br = JSON.parse(fs.readFileSync(DIR + 'bankroll.json', 'utf8'));
br.sequence.push({ date: nowS, type: 'NO_BET', note: NOTE, amount: 0, balance: 1079.11 });
fs.writeFileSync(DIR + 'bankroll.json', JSON.stringify(br, null, 2), 'utf8');
const lg = JSON.parse(fs.readFileSync(DIR + 'ledger.json', 'utf8'));
lg.history.push({ date: nowS, type: 'NO_BET', note: NOTE, amount: 0, balance: 1079.11 });
fs.writeFileSync(DIR + 'ledger.json', JSON.stringify(lg, null, 2), 'utf8');
await query(`UPDATE bankroll SET cash=$1, history=$2::jsonb, updated_at=now() WHERE id=1`,
  [1079.11, JSON.stringify(br.sequence)]);
console.log('bankroll/ledger +09-13关盘');
await pool().end();