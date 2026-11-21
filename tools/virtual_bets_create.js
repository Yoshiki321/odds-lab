/**
 * virtual_bets_create.js — 批量创建今晚的虚拟注
 *
 * 直接写 data/virtual/ 目录，不经过子进程调用（避免 Windows 转义问题）
 *
 * 用法:
 *   node tools/virtual_bets_create.js
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const VDIR = join(ROOT, 'data', 'virtual');
if (!existsSync(VDIR)) mkdirSync(VDIR, { recursive: true });

// 读取今日盘口
const today = JSON.parse(readFileSync(join(ROOT, 'data', 'today', '2026-08-26.json'), 'utf8'));

// 获取现有最大 ID
let maxId = 0;
if (existsSync(VDIR)) {
  for (const f of readdirSync(VDIR).filter(f => f.endsWith('.json'))) {
    try {
      const b = JSON.parse(readFileSync(join(VDIR, f), 'utf8'));
      if (b.id > maxId) maxId = b.id;
    } catch {}
  }
}

const TOP5 = ['英超', '西甲', '德甲', '意甲', '法甲', '欧冠', '欧罗巴'];
const SECOND = ['英冠', '德乙', '法乙', '葡超', '荷甲', '巴甲', '美职'];

let id = maxId + 1;
const created = [];

for (const m of today.matches) {
  const had = m.had, hhad = m.hhad;
  const pool = m.single || {};
  const hadSingle = pool.HAD === 1;
  const goalLine = hhad?.goalLine || '';
  const hA = parseFloat(hhad?.a), hH = parseFloat(hhad?.h), hD = parseFloat(hhad?.d);
  const hadA = parseFloat(had?.a), hadH = parseFloat(had?.h), hadD = parseFloat(had?.d);

  const isOther = !TOP5.includes(m.league) && !SECOND.includes(m.league);
  const p2a_gl1 = isOther && (goalLine === '+1' || goalLine === '1') && !hadSingle;
  const p2a = isOther;

  let odds, logic, confidence;

  if (p2a_gl1) {
    odds = `让球负 @${hA}`;
    logic = `P2a_gl1 信号命中：让球+1 + 非单关 + 非五大。买让球负（客队让球≥2）方向。`;
    confidence = 7;
  } else if (p2a) {
    odds = `让球负 @${hA}`;
    logic = `P2a 信号命中：非五大非次级，买让球负方向（客队净胜≥2）。让球${goalLine}。`;
    confidence = 6;
  } else {
    // 无信号对照场次
    if (hadH < hadA) {
      odds = `主胜 @${hadH}`;
      logic = `无信号对照：主队热门（让球${goalLine}），买主胜验证「热门是否过热」。`;
      confidence = 4;
    } else {
      odds = `客胜 @${hadA}`;
      logic = `无信号对照：客队热门（让球${goalLine}），买客胜验证「实力差能否兑现」。`;
      confidence = 4;
    }
  }

  const bet = {
    id, date: m.matchDate, league: m.league, home: m.home, away: m.away,
    matchTime: m.matchTime, odds, logic, confidence,
    status: 'open', createTime: new Date().toISOString(),
    result: null, outcome: null,
  };

  writeFileSync(join(VDIR, `vb-${String(id).padStart(3, '0')}.json`), JSON.stringify(bet, null, 2), 'utf8');
  console.log(`#${id} ${m.league} ${m.home} vs ${m.away} → ${odds}`);
  created.push(bet);
  id++;
}

console.log(`\n✅ 批量创建完成: ${created.length} 个虚拟注`);
console.log('ID范围:', created[0].id, '~', created[created.length - 1].id);