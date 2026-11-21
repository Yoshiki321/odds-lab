import * as fs from 'fs';
import { pool } from '../../src/server/db/pool.js';

const DIR = 'C:/zwkj/竞彩助手/data/betting/';
const PO = 'C:/zwkj/竞彩助手/data/virtual/';
const nowS = '2026-09-11T23:10:00+08:00';

const NO_BET_NOTE =
  '09-11关盘空仓：全日0实单（京都51/西汉姆50实单档均被EV门禁拦，无欧赔可比价值维0）。已开奖京都2:3柏太阳神，虚拟注vb-141主负@1.56命中（M-04第2个实盘样本：竞彩负EV≠方向错，方向对但不改转欧亚亦非+EV的放弃结论）。其余11场虚拟注待明晨结算';

// ---- bankroll.json ----
const br = JSON.parse(fs.readFileSync(DIR + 'bankroll.json', 'utf8'));
br.sequence.push({ date: nowS, type: 'NO_BET', note: NO_BET_NOTE, amount: 0, balance: 1079.11 });
fs.writeFileSync(DIR + 'bankroll.json', JSON.stringify(br, null, 2), 'utf8');
console.log('bankroll.json +关盘空仓');

// ---- ledger.json ----
const lg = JSON.parse(fs.readFileSync(DIR + 'ledger.json', 'utf8'));
lg.history.push({ date: nowS, type: 'NO_BET', note: NO_BET_NOTE, amount: 0, balance: 1079.11 });
lg.lastUpdated = nowS;
fs.writeFileSync(DIR + 'ledger.json', JSON.stringify(lg, null, 2), 'utf8');
console.log('ledger.json +关盘空仓');

// ---- PG bankroll 对齐 ----
const bh = br.sequence;
await pool().query(
  `UPDATE bankroll SET cash=$1, settled_profit=$2, total_staked=$3, total_returned=$4, history=$5::jsonb, updated_at=now() WHERE id=1`,
  [1079.11, 79.11, 112.25, 191.36, JSON.stringify(bh)]
);
console.log('PG bankroll 已对齐');

// ---- 虚拟注 JSON 镜像对齐 settle 结果（vb-141 win） ----
for (const id of ['vb-141']) {
  const f = PO + id + '.json';
  if (fs.existsSync(f)) {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    j.status = 'win';
    j.result = 'W';
    j.settledAt = nowS;
    fs.writeFileSync(f, JSON.stringify(j, null, 2), 'utf8');
    console.log(id + ' JSON镜像 -> win');
  }
}
await pool().end();
console.log('done');