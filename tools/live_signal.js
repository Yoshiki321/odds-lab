/**
 * live_signal.js — 实时价值信号检测（基于今日盘口快照）
 *
 * 与 value_detector 的区别：
 *   - 直接读 data/today/_latest.json（getMatchCalculatorV1 实时快照）
 *   - 用实时 hf/df/af 变盘方向 + 盘口外形检测信号
 *   - 不依赖 getFixedBonusV1 的当日变盘历史（那个接口当日返回空）
 *
 * 用法:
 *   node tools/live_signal.js              # 先抓再检测
 *   node tools/live_signal.js --scan       # 只检测（用已抓数据）
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUTPUT_DIR = join(ROOT, 'data', 'value_signals');

const TOP5 = ['英超', '西甲', '德甲', '意甲', '法甲', '欧冠', '欧罗巴', '英超联赛杯', '英格兰联赛杯'];
const SECOND = ['英冠', '德乙', '法乙', '葡超', '荷甲', '巴甲', '美职'];

// 从 getMatchCalculatorV1 快照构建场次对象
function buildMatch(m) {
  const had = m.had || {}, hhad = m.hhad || {};
  const singleMap = m.single || {};
  const hadSingle = singleMap.HAD === 1;
  return {
    matchId: m.matchId,
    num: m.num,
    league: m.league,
    home: m.home,
    away: m.away,
    matchDate: m.matchDate,
    matchTime: m.matchTime,
    goalLine: hhad.goalLine || '',
    h: parseFloat(had.h) || 0, d: parseFloat(had.d) || 0, a: parseFloat(had.a) || 0,
    hh: parseFloat(hhad.h) || 0, hd: parseFloat(hhad.d) || 0, ha: parseFloat(hhad.a) || 0,
    hadChanges: 0, // 昨日快照无法得变盘次数
    hhadChanges: 0,
    // 最近一次变化方向
    hadHF: parseInt(had.hf) === 1 ? 1 : 0,
    hadAF: parseInt(had.af) === 1 ? 1 : 0,
    hadAD: parseInt(had.af) === -1 ? 1 : 0,
    hhadHF: parseInt(hhad.hf) === 1 ? 1 : 0,
    hhadAF: parseInt(hhad.af) === 1 ? 1 : 0,
    hhadAD: parseInt(hhad.af) === -1 ? 1 : 0,
    hadSingle,  // HAD单关=整体单关
    // 最近一次变盘方向符号
    hhadADir: hhad.af === '1' ? 'up' : hhad.af === '-1' ? 'down' : 'flat',
    hhadHDir: hhad.hf === '1' ? 'up' : hhad.hf === '-1' ? 'down' : 'flat',
    hadADir: had.af === '1' ? 'up' : had.af === '-1' ? 'down' : 'flat',
  };
}

const SIGNALS = {
  P2a_gl1: {
    name: '🏆 最强信号',
    desc: 'HHAD-A(让球负) + 非五大非次级 + 让球+1 + 非单关',
    winRate: '44.1%', preciseEV: '172.6%', roi: '+288% (34注)',
    condition: (m) =>
      !TOP5.includes(m.league) && !SECOND.includes(m.league) &&
      (m.goalLine === '+1' || m.goalLine === '1') &&
      !m.hadSingle,
    addBonus: (m) => m.hhadADir === 'flat' && '🟢让球负方向平(最稳)',
  },
  P2a: {
    name: 'P2a基础',
    desc: 'HHAD-A(让球负) + 非五大非次级(不限制让球)',
    winRate: '46.5%', preciseEV: '120.1%', roi: '+114% (99注)',
    condition: (m) =>
      !TOP5.includes(m.league) && !SECOND.includes(m.league),
    addBonus: (m) => null,
  },
  P2a_hdir_flat: {
    name: 'P2a主向稳定',
    desc: 'P2a + 让球主方向flat',
    winRate: '58.6%', preciseEV: '150.3%', roi: '+150% (29注)',
    condition: (m) =>
      !TOP5.includes(m.league) && !SECOND.includes(m.league) &&
      m.hhadHDir === 'flat',
    addBonus: (m) => null,
  },
};

function main() {
  const args = process.argv.slice(2);
  const scanOnly = args.includes('--scan');

  if (!scanOnly) {
    // 先抓今日盘口
    try { execSync('node tools/fetch_today_odds.js', { cwd: ROOT, stdio: 'inherit' }); }
    catch(e) { console.error('抓取失败:', e.message); }
  }

  const todayFile = join(ROOT, 'data', 'today', '_latest.json');
  if (!existsSync(todayFile)) {
    console.error('无今日数据，先运行 node tools/fetch_today_odds.js');
    process.exit(1);
  }
  const today = JSON.parse(readFileSync(todayFile, 'utf8'));
  const date = today.fetchedAt?.slice(0, 10) || new Date().toISOString().slice(0, 10);

  const matches = (today.matches || []).map(buildMatch);

  console.log(`\n=== 实时价值信号检测 v1 ===`);
  console.log(`日期: ${date} | 场次: ${matches.length}\n`);

  // 扫描
  const hits = [];
  for (const m of matches) {
    const sigs = [];
    for (const [id, sig] of Object.entries(SIGNALS)) {
      if (sig.condition(m)) {
        sigs.push({ id, ...sig, bonus: sig.addBonus ? sig.addBonus(m) : null });
      }
    }
    if (sigs.length) hits.push({ match: m, sigs });
  }

  if (!hits.length) {
    console.log('❌ 今日无命中信号（空仓日）\n');
    return;
  }

  console.log('✅ 命中信号:');
  console.log('');
  for (const { match: m, sigs } of hits) {
    console.log(`  ${m.num} ${m.league} | ${m.home} vs ${m.away}`);
    console.log(`  让球: ${m.goalLine} | HAD: ${m.h}/${m.d}/${m.a} | HHAD: ${m.hh}/${m.hd}/${m.ha}`);
    console.log(`  单关: ${m.hadSingle ? '✅' : '❌'} | 变盘方向: 主${m.hhadHDir} 客${m.hhadADir}`);
    for (const s of sigs) {
      console.log(`  🔥 ${s.id} ${s.name}`);
      console.log(`     买让球负 @ ${m.ha}（${s.desc}）`);
      if (s.bonus) console.log(`     ${s.bonus}`);
    }
    console.log('');
  }

  // 汇总
  console.log('--- 汇总 ---');
  for (const { sigs } of hits) {
    for (const s of sigs) {
      console.log(`  ${s.id}: ${s.name} (${s.winRate}胜率 EV${s.preciseEV})`);
    }
  }

  // 保存
  if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(join(OUTPUT_DIR, `live_${date.replace(/-/g, '')}.json`), JSON.stringify(hits, null, 2), 'utf8');
  console.log(`\n已保存: data/value_signals/live_${date.replace(/-/g, '')}.json`);
}

main();