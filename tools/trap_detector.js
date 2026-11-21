/**
 * tools/trap_detector.js — 盘口陷阱检测系统
 *
 * 检测原理：
 *   盘口陷阱 = 基本面强势 + 盘口不认 = 反买信号
 *   庄家比任何数据都了解内情，盘口不给力 = 庄家不看好
 *
 * 检测信号（权重累加）：
 *   1. 单关标记（bettingSingle=1）→ 庄家敢放单关，有把握收割
 *   2. 强势方盘口浅（上盘让≤0.25）→ 基本面强但盘口不认
 *   3. 变盘淡化（临场盘口从深→浅）→ 赛前资金不看好
 *   4. 99家平均 vs 365分歧（365更看好弱势方）→ 机构分歧
 *   5. 欧赔倒挂（竞彩赔率 > 欧赔均值）→ 竞彩不看好
 *   6. 近况强势但亚盘输盘多（赢球输盘）→ 真实状态差
 *   7. 排名倒挂（排名低但让球）→ 虚高
 *
 * 用法:
 *   node tools/trap_detector.js <matchId>          # 检测单场比赛
 *   node tools/trap_detector.js today              # 检测今日所有比赛
 *   node tools/trap_detector.js today --force      # 强制刷新缓存
 */

import { scrapeMatch } from './okooo_scraper.js';
import { scrapeJingcaiList } from './okooo_jingcai.js';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ===== 检测函数 =====

/**
 * 检测单场比赛的盘口陷阱
 * @param {Object} matchData - 从 okooo_scraper 返回的比赛数据
 * @param {Object} jingcaiMatch - 从 jingcai 列表获取的竞彩数据（可选）
 * @returns {Object} trapAnalysis
 */
export function detectTrap(matchData, jingcaiMatch) {
  const signals = [];
  let trapScore = 0;
  const maxScore = 100;

  const home = matchData.homeTeam;
  const away = matchData.awayTeam;
  const homeRecent = matchData.homeRecent || [];
  const awayRecent = matchData.awayRecent || [];
  const standings = matchData.standings || [];
  const rankings = matchData.worldRankings || [];

  // 获取主客队排名
  const homeStanding = standings.find(s => s.team === home);
  const awayStanding = standings.find(s => s.team === away);
  const homeStandingRank = homeStanding?.rank || matchData.homeRank;
  const awayStandingRank = awayStanding?.rank || matchData.awayRank;

  // 获取世界排名
  const homeWorldRank = rankings.find(r => r.team === home)?.rank;
  const awayWorldRank = rankings.find(r => r.team === away)?.rank;

  // --- 信号1: 单关标记（从官方API获取 bettingSingle） ---
  if (jingcaiMatch?.bettingSingle === 1) {
    signals.push({
      name: 'single_match',
      label: '单关放行',
      desc: '庄家敢放单关，说明有把握收割单关玩家',
      severity: 'high',
      score: 20
    });
    trapScore += 20;
  }

  // --- 信号2: 近10场亚盘强势 vs 本场盘口浅 ---
  // 注意: homeRecent[0] 是包含本场赛果的历史记录（如果是复盘），从第2场开始才是赛前近况
  const preMatchHome = homeRecent.slice(1).slice(0, 10); // 本场之前10场
  const preMatchAway = awayRecent.slice(1).slice(0, 10);

  const homeAsianWins = preMatchHome.filter(m => m.asianResult === '赢').length;
  const homeAsianLosses = preMatchHome.filter(m => m.asianResult === '输').length;
  const homeAsianTotal = preMatchHome.filter(m => m.asianResult).length;

  if (homeAsianTotal >= 5) {
    const homeWinRate = homeAsianWins / homeAsianTotal;
    if (homeWinRate >= 0.6) {
      // 近况强势
      const handicap = matchData.homeRecent?.[0]?.handicap || jingcaiMatch?.rqLabel || '';
      // 检查盘口深度
      const isShallowHandicap = /平手|受平手|让平手|平手\/半球|受让|^0$|^\+?0$/.test(handicap) || !handicap;

      if (isShallowHandicap) {
        signals.push({
          name: 'strong_form_shallow_handicap',
          label: '强势方盘口浅',
          desc: `${home}赛前10场亚盘${homeAsianWins}赢${homeAsianLosses}输(胜率${(homeWinRate*100).toFixed(0)}%)，但盘口只有"${handicap||'无'}"`,
          severity: 'high',
          score: 25,
          detail: { homeAsianWins, homeAsianLosses, homeAsianTotal, winRate: homeWinRate, handicap }
        });
        trapScore += 25;
      }

      // 即使盘口不浅，但赢球输盘率高的也要标记
      const homeRecentLosses = preMatchHome.slice(0, 6).filter(m => m.asianResult === '输').length;
      if (homeAsianWins >= 5 && homeRecentLosses >= 2) {
        signals.push({
          name: 'win_but_lose_handicap',
          label: '赢球输盘',
          desc: `${home}赛前10场${homeAsianWins}赢盘但近6场${homeRecentLosses}输盘，赢盘势头在减弱`,
          severity: 'medium',
          score: 10
        });
        trapScore += 10;
      }
    }
  }

  // --- 信号3: 赛前盘口淡化（最近一场对比之前） ---
  const matchHandicap = matchData.homeRecent?.[0]?.handicap || jingcaiMatch?.rqLabel || '';
  const prevHandicap = matchData.homeRecent?.[1]?.handicap || '';
  if (matchHandicap && prevHandicap) {
    // 比较盘口深度（简单字符串比较）
    const handicapDepth = (h) => {
      if (/半球\/一球|一球|一球\/球半|球半/.test(h)) return 3;
      if (/半球/.test(h)) return 2;
      if (/平手\/半球/.test(h)) return 1;
      if (/平手/.test(h)) return 0;
      if (/受平手\/半球/.test(h)) return -1;
      if (/受半球/.test(h)) return -2;
      if (/受半球\/一球|受一球/.test(h)) return -3;
      return null;
    };
    const cur = handicapDepth(matchHandicap);
    const prev = handicapDepth(prevHandicap);
    if (cur !== null && prev !== null && cur < prev) {
      signals.push({
        name: 'pre_match_handicap_fade',
        label: '赛前盘口淡化',
        desc: `${home}盘口从"${prevHandicap}"降到"${matchHandicap}"，赛前资金不看好`,
        severity: 'high',
        score: 20
      });
      trapScore += 20;
    }
  }

  // --- 信号4: 排名倒挂 ---
  if (homeStandingRank && awayStandingRank) {
    const hR = parseInt(homeStandingRank);
    const aR = parseInt(awayStandingRank);
    if (!isNaN(hR) && !isNaN(aR)) {
      // 排名低(数字大) 的球队让球 → 虚高盘
      if (hR > aR && hR - aR >= 3 && /让/.test(matchHandicap)) {
        signals.push({
          name: 'rank_inverted_handicap',
          label: '排名倒挂让球',
          desc: `${home}排名#${hR}低于${away}排名#${aR}，但让球"${matchHandicap}"，虚高盘`,
          severity: 'medium',
          score: 15
        });
        trapScore += 15;
      }
    }
  }

  // --- 信号5: 世界排名差距大但盘口浅 ---
  if (homeWorldRank && awayWorldRank && /让/.test(matchHandicap)) {
    const rankDiff = awayWorldRank - homeWorldRank;
    if (rankDiff > 200) {
      // 世界排名差200+但只让平半或更浅
      if (/平手/.test(matchHandicap)) {
        signals.push({
          name: 'world_rank_mismatch',
          label: '排名差距大但盘口浅',
          desc: `${home}世界排名#${homeWorldRank} vs ${away}#${awayWorldRank}(差${rankDiff})，盘口仅"${matchHandicap}"`,
          severity: 'medium',
          score: 10
        });
        trapScore += 10;
      }
    }
  }

  // --- 信号6: 欧赔99家 vs 365分歧 ---
  const firstMatch = matchData.homeRecent?.[0];
  if (firstMatch?.odds99Home && firstMatch?.odds365) {
    // 如果365终指明显高于99家平均，说明365不看好主队
    if (home === firstMatch.homeTeam) {
      if (firstMatch.odds365 > firstMatch.odds99Home * 1.05) {
        signals.push({
          name: 'odds365_divergence',
          label: '365不看好主队',
          desc: `365终指${firstMatch.odds365}高于99家平均${firstMatch.odds99Home}，主流机构不看好${home}`,
          severity: 'medium',
          score: 10
        });
        trapScore += 10;
      }
    }
  }

  // --- 信号7: 竞彩 vs 欧赔对比 ---
  if (jingcaiMatch && firstMatch) {
    const jcOdds = jingcaiMatch.oddsH;
    const euOdds = firstMatch.odds99Home;
    if (jcOdds && euOdds && jcOdds > euOdds) {
      signals.push({
        name: 'jc_odds_higher_than_eu',
        label: '竞彩赔率高于欧赔',
        desc: `竞彩${jcOdds} > 欧赔${euOdds}，竞彩不看好${home}`,
        severity: 'low',
        score: 5
      });
      trapScore += 5;
    }
  }

  // --- 信号8: 客队近况强但盘口不认 ---
  const awayAsianWins = awayRecent.filter(m => m.asianResult === '赢').length;
  const awayAsianTotal = awayRecent.filter(m => m.asianResult).length;
  if (awayAsianTotal >= 5) {
    const awayWinRate = awayAsianWins / awayAsianTotal;
    const awayHandicap = matchData.awayRecent?.[0]?.handicap || '';
    // 客队近况好且受让
    if (awayWinRate >= 0.6 && /受/.test(awayHandicap)) {
      signals.push({
        name: 'away_strong_form_receive',
        label: '客队强势受让',
        desc: `${away}近10场亚盘${awayAsianWins}赢(胜率${(awayWinRate*100).toFixed(0)}%)但仍受让"${awayHandicap}"，庄家不看好`,
        severity: 'medium',
        score: 15
      });
      trapScore += 15;
    }
  }

  // 计算总分和判定
  const confidence = Math.min(trapScore / maxScore, 1);
  let verdict = 'safe';
  if (trapScore >= 45) verdict = 'trap_high';
  else if (trapScore >= 30) verdict = 'trap_medium';
  else if (trapScore >= 15) verdict = 'trap_low';

  return {
    home,
    away,
    trapScore,
    confidence,
    verdict,
    signals: signals.sort((a, b) => b.score - a.score),
    detail: {
      homeStandingRank,
      awayStandingRank,
      homeWorldRank,
      awayWorldRank,
      homeAsianRecord: { wins: homeAsianWins, losses: homeAsianLosses, total: homeAsianTotal },
      awayAsianRecord: { wins: awayAsianWins, total: awayAsianTotal },
      handicap: matchHandicap,
      singleMatch: matchData.singleMatch
    }
  };
}

/**
 * 检测今日所有比赛
 */
export async function detectTodayTraps(force = false) {
  const jingcai = await scrapeJingcaiList(force);
  const results = [];

  // 加载官方API赔率数据，获取真实 bettingSingle
  let officialSingleMap = {};
  try {
    const oddsFiles = readdirSync(join(ROOT, 'data/odds'))
      .filter(f => /^football_spf_/.test(f)).sort().reverse();
    if (oddsFiles.length > 0) {
      const o = JSON.parse(readFileSync(join(ROOT, 'data/odds', oddsFiles[0]), 'utf8'));
      const matches = o.value?.matchInfoList || [];
      matches.forEach(m => {
        m.subMatchList.forEach(sub => {
          const key = (sub.homeTeamAbbName + sub.awayTeamAbbName).replace(/\s+/g, '');
          officialSingleMap[key] = { single: sub.bettingSingle, league: sub.leagueAbbName };
        });
      });
    }
  } catch (e) {
    // 没有官方赔率文件也不影响检测
  }

  for (const match of jingcai.matches) {
    // 匹配官方数据
    const key = (match.homeTeam + match.awayTeam).replace(/\s+/g, '');
    const official = officialSingleMap[key];
    match.bettingSingle = official?.single !== undefined ? official.single : 0;

    try {
      const matchData = await scrapeMatch(match.matchId, force);
      if (matchData && matchData.homeTeam) {
        const analysis = detectTrap(matchData, match);
        results.push({
          ...match,
          trap: analysis
        });
      }
    } catch (e) {
      results.push({
        ...match,
        trap: { verdict: 'no_data', error: e.message }
      });
    }
  }

  // 按陷阱分数排序（最危险的在最前面）
  results.sort((a, b) => (b.trap?.trapScore || 0) - (a.trap?.trapScore || 0));
  return results;
}

// ===== CLI =====
const cliPath = process.argv[1]?.replace(/\\/g, '/').split('/').pop();
if (process.argv[1] && import.meta.url.replace(/\\/g, '/').endsWith(cliPath)) {
  const cmd = process.argv[2];
  const force = process.argv.includes('--force');

  if (cmd === 'today') {
    detectTodayTraps(force).then(results => {
      console.log(`\n═══════════════════════════════════════════`);
      console.log(`  盘口陷阱检测 · 今日竞彩 ${results.length}场`);
      console.log(`═══════════════════════════════════════════`);

      const trapCount = results.filter(r => r.trap?.verdict?.startsWith('trap')).length;
      console.log(`  陷阱信号: ${trapCount}场 | 安全: ${results.length - trapCount}场\n`);

      results.forEach(r => {
        const t = r.trap;
        if (!t || t.verdict === 'no_data') {
          console.log(`\n${r.num} ${r.league} ${r.homeTeam} vs ${r.awayTeam} ⚠️ 无数据`);
          return;
        }

        const icon = t.verdict === 'trap_high' ? '🔴' :
                     t.verdict === 'trap_medium' ? '🟡' : '🟢';
        const label = t.verdict === 'trap_high' ? '高陷阱' :
                      t.verdict === 'trap_medium' ? '中陷阱' : '安全';

        console.log(`\n${icon} ${r.num} ${r.league} ${r.homeTeam} vs ${r.awayTeam}`);
        console.log(`   竞彩: ${r.oddsH}/${r.oddsD}/${r.oddsA} | 让球${r.rq} ${r.rqOddsH}/${r.rqOddsD}/${r.rqOddsA}`);
        console.log(`   盘口陷阱分: ${t.trapScore}/100 — ${label}`);

        // 列出信号
        t.signals.forEach(s => {
          const sev = s.severity === 'high' ? '🔴' : s.severity === 'medium' ? '🟡' : '⚪';
          console.log(`   ${sev} ${s.label}: ${s.desc}`);
        });
      });

      console.log(`\n═══════════════════════════════════════════`);
    }).catch(e => console.error(e.message));

  } else if (cmd === 'match' && process.argv[3]) {
    scrapeMatch(process.argv[3], force).then(d => {
      if (d && d.homeTeam) {
        const analysis = detectTrap(d);
        const icon = analysis.verdict === 'trap_high' ? '🔴' :
                     analysis.verdict === 'trap_medium' ? '🟡' : '🟢';
        const label = analysis.verdict === 'trap_high' ? '高陷阱' :
                      analysis.verdict === 'trap_medium' ? '中陷阱' : '安全';

        console.log(`\n═══════════════════════════════════════════`);
        console.log(`  盘口陷阱检测: ${d.homeTeam} vs ${d.awayTeam}`);
        console.log(`═══════════════════════════════════════════`);
        console.log(`  评分: ${analysis.trapScore}/100 ${icon} ${label}`);
        console.log(`  单关: ${d.singleMatch ? '✅ 是' : '否'}`);
        console.log(`  盘口: ${d.homeRecent?.[0]?.handicap || '无'}`);

        if (analysis.signals.length) {
          console.log(`\n  检测信号:`);
          analysis.signals.forEach(s => {
            const sev = s.severity === 'high' ? '🔴' : s.severity === 'medium' ? '🟡' : '⚪';
            console.log(`  ${sev} [${s.score}分] ${s.label}`);
            console.log(`     ${s.desc}`);
          });
        } else {
          console.log(`\n  无陷阱信号`);
        }
        console.log(`═══════════════════════════════════════════\n`);
      }
    }).catch(e => console.error(e.message));
  } else {
    console.log('用法:');
    console.log('  node tools/trap_detector.js today              # 检测今日所有比赛');
    console.log('  node tools/trap_detector.js today --force      # 强制刷新缓存');
    console.log('  node tools/trap_detector.js match <matchId>    # 检测单场比赛');
  }
}