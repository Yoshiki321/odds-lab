/**
 * 价值信号检测器 v1 — 每日实战可用
 *
 * 基于精确EV扫描发现的最强信号：
 *   P2a: HHAD_A(让球负) + 变盘1-2次 + 非五大非次级联赛
 *
 * 用法:
 *   node tools/value_detector.js          # 检测今日比赛
 *   node tools/value_detector.js --date 2026-08-26  # 指定日期
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUTPUT_DIR = join(ROOT, 'data', 'value_signals');

const TOP5 = ['英超', '西甲', '德甲', '意甲', '法甲', '欧冠', '欧罗巴'];
const SECOND = ['英冠', '德乙', '法乙', '葡超', '荷甲', '巴甲', '美职'];

// ========== 信号定义 ==========

const SIGNALS = [
  {
    id: 'P2a_gl1',
    name: '🏆 最强价值信号',
    desc: 'HHAD-A(让球负) + 变盘1-2次 + 非五大非次级联赛 + 让球+1',
    winRate: '44.1%',
    preciseEV: '172.6%',
    roi: '+288% (¥1000→¥3881, 34注, 回撤27%)',
    condition: (m) =>
      m.hhadChanges >= 1 && m.hhadChanges <= 2 &&
      !TOP5.includes(m.league) && !SECOND.includes(m.league) &&
      (m.hhadGoalLine === '+1' || m.hhadGoalLine === '1'),
    direction: 'A', // 让球负
    oddsKey: 'ha',
    priority: 1,
  },
  {
    id: 'P2a',
    name: 'P2a基础信号',
    desc: 'HHAD-A(让球负) + 变盘1-2次 + 非五大非次级联赛(不限制让球)',
    winRate: '46.5%',
    preciseEV: '120.1%',
    roi: '+114% (¥1000→¥2142, 99注, 回撤40%)',
    condition: (m) =>
      m.hhadChanges >= 1 && m.hhadChanges <= 2 &&
      !TOP5.includes(m.league) && !SECOND.includes(m.league),
    direction: 'A', // 让球负
    oddsKey: 'ha',
    priority: 2,
  },
  {
    id: 'P2a_hdir_flat',
    name: 'P2a主方向稳定信号',
    desc: 'P2a + 让球主方向flat(稳定, 胜率58.6%)',
    winRate: '58.6%',
    preciseEV: '150.3%',
    roi: '+150% (¥1000→¥2495, 29注, 回撤27%)',
    condition: (m) =>
      m.hhadChanges >= 1 && m.hhadChanges <= 2 &&
      !TOP5.includes(m.league) && !SECOND.includes(m.league) &&
      m.hhadHDir === 'flat',
    direction: 'A', // 让球负
    oddsKey: 'ha',
    priority: 3,
  },
  {
    id: 'P3',
    name: '平向变盘平局',
    desc: 'HAD-D(平局) + 方向h→d→a→ + 让球-1',
    winRate: '34.0%',
    preciseEV: '114.7%(训练) 169.3%(测试)',
    roi: '+161% (¥1000→¥2611, 8个月)',
    condition: (m) =>
      m.hadDir === 'h→d→a→' && m.goalLine === '-1',
    direction: 'D', // 平局
    oddsKey: 'd',
  },
  {
    id: 'P5',
    name: '全向平向平局',
    desc: 'HAD-D(平局) + 方向h→d→a→(任何盘口)',
    winRate: '29.9%',
    preciseEV: '115.1%(训练) 121.4%(测试)',
    roi: '+82.6% (¥1000→¥1825, 8个月)',
    condition: (m) =>
      m.hadDir === 'h→d→a→',
    direction: 'D', // 平局
    oddsKey: 'd',
  },
  {
    id: 'P7',
    name: '次级联赛高赔平局',
    desc: 'HAD-D(平局) + 赔率3.0-5.0 + 次级联赛',
    winRate: '31.7%',
    preciseEV: '105.9%(训练) 122.5%(测试)',
    roi: '+74.6% (¥1000→¥1746, 8个月)',
    condition: (m) =>
      SECOND.includes(m.league) && m.d >= 3.0 && m.d < 5.0,
    direction: 'D', // 平局
    oddsKey: 'd',
  },
];

// ========== 数据加载 ==========

function loadMatchData(matchId) {
  const cacheFile = join(ROOT, 'data', 'history', '_odds_cache', `${matchId}.json`);
  if (!existsSync(cacheFile)) return null;
  try {
    return JSON.parse(readFileSync(cacheFile, 'utf8'));
  } catch { return null; }
}

function getTodayMatches() {
  // 从竞彩列表获取今日比赛
  const jcFile = join(ROOT, 'data', 'okooo_cache', 'jingcai_list.json');
  if (!existsSync(jcFile)) return [];
  try {
    const jc = JSON.parse(readFileSync(jcFile, 'utf8'));
    return jc.matches || [];
  } catch { return []; }
}

function analyzeMatch(jcMatch) {
  const cache = loadMatchData(jcMatch.matchId);
  if (!cache) return null;

  const had = cache.oddsHistory?.hadList || [];
  const hhad = cache.oddsHistory?.hhadList || [];
  const single = cache.oddsHistory?.singleList || [];
  if (!had.length || !hhad.length) return null;

  const hadFirst = had[0], hadLast = had[had.length - 1];
  const hhadFirst = hhad[0], hhadLast = hhad[hhad.length - 1];

  const hDir = hadLast.h > hadFirst.h ? '↑' : hadLast.h < hadFirst.h ? '↓' : '→';
  const dDir = hadLast.d > hadFirst.d ? '↑' : hadLast.d < hadFirst.d ? '↓' : '→';
  const aDir = hadLast.a > hadFirst.a ? '↑' : hadLast.a < hadFirst.a ? '↓' : '→';

  // HHAD方向标志
  const hhadHF = hhad.filter(e => parseInt(e.hf) === 1).length;
  const hhadHD = hhad.filter(e => parseInt(e.hf) === -1).length;
  const hhadAF = hhad.filter(e => parseInt(e.af) === 1).length;
  const hhadAD = hhad.filter(e => parseInt(e.af) === -1).length;
  const hhadHDir = hhadHF - hhadHD > 0 ? 'up' : hhadHF - hhadHD < 0 ? 'down' : 'flat';
  const hhadADir = hhadAF - hhadAD > 0 ? 'up' : hhadAF - hhadAD < 0 ? 'down' : 'flat';

  const hhadSingle = (single.find(s => s.poolCode === 'HHAD'))?.single ?? 1;

  return {
    matchId: jcMatch.matchId,
    league: jcMatch.league || cache.oddsHistory?.leagueAbbName || cache.leagueAbbName || '未知',
    home: jcMatch.homeTeam || cache.homeTeam,
    away: jcMatch.awayTeam || cache.awayTeam,
    goalLine: jcMatch.goalLine || hhadLast.goalLine,
    hhadGoalLine: hhadLast.goalLine || jcMatch.goalLine || '',
    h: parseFloat(hadLast.h), d: parseFloat(hadLast.d), a: parseFloat(hadLast.a),
    hh: parseFloat(hhadLast.h), hd: parseFloat(hhadLast.d), ha: parseFloat(hhadLast.a),
    hadChanges: had.length, hhadChanges: hhad.length,
    hadDir: `h${hDir}d${dDir}a${aDir}`,
    hhadHDir, hhadADir,
    hhadSingle,
    single: jcMatch.single || false,
  };
}

// ========== 主函数 ==========

function main() {
  const args = process.argv.slice(2);
  const dateArg = args.find(a => a.startsWith('--date='))?.split('=')[1];
  const date = dateArg || new Date().toISOString().slice(0, 10);

  console.log(`\n=== 价值信号检测器 v1 ===`);
  console.log(`日期: ${date}\n`);

  const todayMatches = getTodayMatches();
  if (!todayMatches.length) {
    console.log('⚠️ 未找到今日比赛数据。请先运行:');
    console.log('  node tools/okooo_jingcai.js');
    console.log('然后重试。\n');
    return;
  }

  console.log(`今日共 ${todayMatches.length} 场比赛\n`);

  // 分析每场比赛
  const results = [];
  for (const jc of todayMatches) {
    const m = analyzeMatch(jc);
    if (!m) continue;

    const signals = [];
    for (const sig of SIGNALS) {
      if (sig.condition(m)) {
        signals.push({
          id: sig.id,
          name: sig.name,
          direction: sig.direction,
          odds: m[sig.oddsKey],
          desc: sig.desc,
        });
      }
    }

    if (signals.length) {
      results.push({ match: m, signals });
    }
  }

  if (results.length) {
    console.log('✅ 命中信号比赛:');
    console.log('');
    for (const { match: m, signals } of results) {
      console.log(`  ${m.league} | ${m.home} vs ${m.away}`);
      console.log(`  让球: ${m.goalLine} | 赔率: ${m.h}/${m.d}/${m.a}`);
      console.log(`  让球赔率: H${m.hh} D${m.hd} A${m.ha}`);
      console.log(`  变盘: HAD${m.hadChanges}次 HHAD${m.hhadChanges}次 | 方向: ${m.hadDir}`);
      console.log(`  单关: ${m.single ? '✅是' : '❌否'}`);
      for (const s of signals) {
        console.log(`  🔥 ${s.id} ${s.name}`);
        console.log(`     买: ${s.direction === 'D' ? '平局' : s.direction === 'A' ? '让球负' : '让球胜'} @ ${s.odds}`);
        console.log(`     ${s.desc}`);
      }
      console.log('');
    }

    // 汇总统计
    console.log('--- 信号汇总 ---');
    const sigCount = {};
    for (const { signals } of results) {
      for (const s of signals) {
        sigCount[s.id] = (sigCount[s.id] || 0) + 1;
      }
    }
    for (const [id, count] of Object.entries(sigCount)) {
      const sig = SIGNALS.find(s => s.id === id);
      console.log(`  ${id} ${sig?.name}: ${count}场命中`);
    }
    console.log('');
    console.log('💰 建议资金管理: 起步5% / 积累8% / 增长10% / 冲刺12%');
    console.log('   连输2单降档, 连赢3单升档, 单日亏损20%停');

    // 保存结果
    if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });
    writeFileSync(join(OUTPUT_DIR, `${date}.json`), JSON.stringify(results, null, 2), 'utf-8');
    console.log(`\n已保存: ${date}.json`);
  } else {
    console.log('❌ 今日无比赛命中任何信号');
    console.log('（空仓日，保留资金）');
  }
}

main();