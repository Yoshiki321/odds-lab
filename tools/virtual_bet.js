/**
 * virtual_bet.js — 虚拟下注体系（前向回测）
 *
 * 不看好/不够信号的比赛不实际投注，但虚拟下注、思考判断、看赛果复盘。
 * 这是真正的样本外验证，比历史回测更值钱。
 *
 * 用法:
 *   node tools/virtual_bet.js new        # 新建虚拟注（交互式）
 *   node tools/virtual_bet.js list       # 列出所有虚拟注
 *   node tools/virtual_bet.js settle     # 结算所有开赛的虚拟注
 *
 * 数据保存: data/virtual/ 目录
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const VDIR = join(ROOT, 'data', 'virtual');

if (!existsSync(VDIR)) mkdirSync(VDIR, { recursive: true });

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(r => rl.question(q, r));

function load() {
  const all = [];
  if (existsSync(VDIR)) {
    for (const f of readdirSync(VDIR).filter(f => f.endsWith('.json'))) {
      try { all.push(JSON.parse(readFileSync(join(VDIR, f), 'utf8'))); } catch {}
    }
  }
  return all.flat();
}

function save(bets) {
  // 按虚拟注 id 分文件
  for (const b of bets) {
    writeFileSync(join(VDIR, `vb-${String(b.id).padStart(3, '0')}.json`), JSON.stringify(b, null, 2), 'utf8');
  }
}

async function cmdNew() {
  const all = load();
  const id = all.length ? Math.max(...all.map(b => b.id)) + 1 : 1;
  console.log(`\n=== 创建虚拟注 #${id} ===`);
  const date = await ask('日期 (如 2026-08-26): ');
  const league = await ask('联赛: ');
  const home = await ask('主队: ');
  const away = await ask('客队: ');
  const matchTime = await ask('开赛时间 (时:分): ');
  const odds = await ask('投注选项与赔率 (如 让球负 @2.16): ');
  const logic = await ask('分析逻辑: ');
  const confidence = await ask('信心 (1-10): ');

  const bet = {
    id, date, league, home, away, matchTime, odds, logic, confidence,
    status: 'open',   // open | win | loss | void
    createTime: new Date().toISOString(),
    result: null,     // 赛后填写
    outcome: null,    // 结算: +x / -x / 0
  };
  save([...all, bet]);
  console.log(`\n✅ 虚拟注 #${id} 已创建`);
  show(bet);
}

/** 非交互: 直接用参数建虚拟注 (供脚本/分析流程调用) */
function createDirect(bet) {
  const all = load();
  const id = all.length ? Math.max(...all.map(b => b.id)) + 1 : 1;
  const b = {
    id,
    date: bet.date, league: bet.league, home: bet.home, away: bet.away,
    matchTime: bet.matchTime, odds: bet.odds, logic: bet.logic,
    confidence: bet.confidence || 5,
    status: 'open', createTime: new Date().toISOString(),
    result: null, outcome: null,
  };
  save([...all, b]);
  return b;
}

function show(b) {
  console.log(`[#${b.id} ${b.status.toUpperCase()}] ${b.date} ${b.league} ${b.home} vs ${b.away} ${b.matchTime}`);
  console.log(`  投注: ${b.odds}`);
  console.log(`  逻辑: ${b.logic}`);
  console.log(`  信心: ${b.confidence}/10`);
  if (b.result) console.log(`  赛果: ${b.result}`);
  if (b.outcome) console.log(`  结算: ${b.outcome}`);
}

async function cmdList() {
  const all = load();
  if (!all.length) { console.log('暂无虚拟注'); return; }
  console.log(`\n=== 虚拟注列表 (${all.length} 单) ===`);
  console.log(`开注: ${all.filter(b => b.status === 'open').length} | 中: ${all.filter(b => b.status === 'win').length} | 输: ${all.filter(b => b.status === 'loss').length} | 走水: ${all.filter(b => b.status === 'void').length}`);
  for (const b of all) show(b);
}

async function cmdSettle() {
  const all = load();
  const open = all.filter(b => b.status === 'open');
  if (!open.length) { console.log('无在开的虚拟注'); return; }
  for (const b of open) {
    console.log(`\n=== 结算虚拟注 #${b.id}: ${b.home} vs ${b.away} ===`);
    const result = await ask('赛果比分 (如 2-1): ');
    const outcome = await ask('命中? (win/loss/void): ');
    b.result = result;
    b.status = outcome;
    b.settledAt = new Date().toISOString();
  }
  save(all);
  console.log('\n✅ 结算完成');
}

// 非交互模式: node virtual_bet.js direct '<json>'
function cmdDirect(jsonStr) {
  const bet = JSON.parse(jsonStr);
  const b = createDirect(bet);
  console.log(`✅ 虚拟注 #${b.id} 已创建`);
  show(b);
}

const cmd = process.argv[2] || 'list';
if (cmd === 'new') await cmdNew();
else if (cmd === 'list') await cmdList();
else if (cmd === 'settle') await cmdSettle();
else if (cmd === 'direct') cmdDirect(process.argv[3]);
rl.close();