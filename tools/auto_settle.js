/**
 * auto_settle.js — 自动结算 + 通知
 *
 * 1. 读所有在途投注
 * 2. 用 getFixedBonusV1 检查每场是否已开奖
 * 3. 已开奖的自动结算
 * 4. 输出结算结果（供 cron 调用）
 *
 * 用法:
 *   node tools/auto_settle.js              # 结算所有可结算的
 *   node tools/auto_settle.js notify       # 结算后打印通知摘要
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'node:https';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const BET_DIR = join(ROOT, 'data', 'betting', 'bets');
const LEDGER = join(ROOT, 'data', 'betting', 'ledger.json');
const BANKROLL = join(ROOT, 'data', 'betting', 'bankroll.json');

function readJSON(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}
function writeJSON(path, obj) {
  writeFileSync(path, JSON.stringify(obj, null, 2), 'utf8');
}

function fetch(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', referer: 'https://www.sporttery.cn/jc/zqdz/' },
      timeout: 15000
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

/** 查一场比赛结果 */
async function checkMatchResult(matchId) {
  const url = `https://webapi.sporttery.cn/gateway/uniform/football/getFixedBonusV1.qry?clientCode=3001&matchId=${matchId}`;
  const j = await fetch(url);
  if (!j.success || !j.value) return null;
  const mr = j.value.matchResultList || [];
  const had = mr.find(x => x.code === 'HAD');
  if (!had) return null;
  const hhad = mr.find(x => x.code === 'HHAD');
  return {
    winFlag: had.combination,
    hhadResult: hhad?.combination,
    goalLine: hhad?.goalLine,
    sectionsNo999: j.value.sectionsNo999 || '?',
    matchResultStatus: '2',
    source: 'auto'
  };
}

/** 判定中奖 */
function legWins(pick, result) {
  const winFlag = result.winFlag;
  if (pick.includes('HHAD') || pick.includes('受让') || pick.includes('让球')) {
    if (result.hhadResult) {
      const target = pick.includes('主胜') || pick.endsWith('H') ? 'H'
        : pick.includes('平') || pick.endsWith('D') ? 'D'
        : pick.includes('客胜') || pick.endsWith('A') ? 'A' : null;
      return target === result.hhadResult;
    }
    return null;
  }
  return (pick.includes('主胜') && winFlag === 'H') ||
         (pick.includes('平') && winFlag === 'D') ||
         (pick.includes('客胜') && winFlag === 'A');
}

async function main() {
  const mode = process.argv[2] || '';
  const ledger = readJSON(LEDGER);
  const bankroll = readJSON(BANKROLL);
  const inPlay = ledger.inPlay || [];
  const results = [];

  if (!inPlay.length) {
    console.log('当前无在途投注');
    process.exit(0);
  }

  for (const betId of inPlay) {
    const fname = join(BET_DIR, `bet-${String(betId).padStart(3, '0')}.json`);
    if (!existsSync(fname)) {
      console.log(`[跳过] bet-${betId} 文件不存在`);
      continue;
    }

    const bet = readJSON(fname);
    if (bet.status === 'settled') {
      console.log(`[跳过] bet-${betId} 已结算`);
      continue;
    }

    // 检查所有腿
    let allReady = true;
    let allWin = true;
    let winLegs = 0;
    let settledLegs = [];

    for (const leg of bet.legs) {
      const result = await checkMatchResult(leg.matchId);
      if (!result) {
        console.log(`[待定] bet-${betId} ${leg.matchNum} ${leg.home}vs${leg.away} 尚未开奖`);
        allReady = false;
        continue;
      }

      leg.result = result;
      const isWin = legWins(leg.pick, result);
      if (isWin === true) {
        winLegs++;
        settledLegs.push({ leg: leg.matchNum, result: '✅ 中', score: result.sectionsNo999 });
      } else if (isWin === false) {
        settledLegs.push({ leg: leg.matchNum, result: '❌ 未中', score: result.sectionsNo999 });
        allWin = false;
      } else {
        settledLegs.push({ leg: leg.matchNum, result: '⚠️ 走水', score: result.sectionsNo999 });
        allWin = false;
      }

      console.log(`  [${isWin ? '✅' : '❌'}] ${leg.matchNum} ${leg.home}${result.sectionsNo999}${leg.away} ${leg.pick}`);
    }

    if (!allReady) {
      console.log(`[等待] bet-${betId} 还有场次未开奖`);
      continue;
    }

    // 结算
    bet.status = 'settled';
    bet.settledAt = new Date().toISOString();

    if (allWin) {
      bet.returnAmount = Math.round(bet.stake * bet.totalOdds * 100) / 100;
      bet.profit = Math.round((bet.returnAmount - bet.stake) * 100) / 100;
    } else {
      bet.returnAmount = 0;
      bet.profit = -bet.stake;
    }

    // 更新bet文件
    writeJSON(fname, bet);

    // 更新台账
    ledger.totalReturned += bet.returnAmount;
    ledger.settledProfit += bet.profit;
    ledger.cash += bet.returnAmount;
    ledger.inPlay = ledger.inPlay.filter(id => id !== bet.betId);
    ledger.history.push({
      date: bet.settledAt,
      type: 'SETTLE',
      note: `bet-${bet.betId}: ${allWin ? '中奖' : '未中奖'} +${bet.returnAmount}`,
      amount: bet.returnAmount,
      balance: ledger.cash,
    });
    ledger.lastUpdated = bet.settledAt;

    // 更新资金
    bankroll.cash = ledger.cash;
    bankroll.sequence.push({
      date: bet.settledAt,
      type: 'IN',
      note: `bet-${bet.betId} 结算 ${allWin ? '中奖' : '未中奖'}`,
      amount: bet.returnAmount,
      balance: ledger.cash,
    });
    bankroll.lastUpdated = bet.settledAt;

    results.push({
      betId,
      result: allWin ? '中奖' : '未中奖',
      stake: bet.stake,
      returnAmount: bet.returnAmount,
      profit: bet.profit,
      totalOdds: bet.totalOdds,
      legs: settledLegs
    });
  }

  writeJSON(LEDGER, ledger);
  writeJSON(BANKROLL, bankroll);

  if (mode === 'notify' && results.length) {
    console.log('\n=== 结算通知 ===');
    for (const r of results) {
      const icon = r.result === '中奖' ? '🎉' : '❌';
      console.log(`${icon} bet-${r.betId} ${r.result}`);
      console.log(`   投${r.stake}元 × ${r.totalOdds}倍 = 返${r.returnAmount}元 (盈亏${r.profit >= 0 ? '+' : ''}${r.profit})`);
      for (const l of r.legs) {
        console.log(`   ${l.leg}: ${l.result} (${l.score})`);
      }
    }
    console.log(`\n当前现金: ${ledger.cash} 元`);
    console.log(`累计盈亏: ${ledger.settledProfit >= 0 ? '+' : ''}${ledger.settledProfit} 元`);
  }

  if (!results.length) {
    console.log('\n无可结算投注');
  }
}

main().catch(e => console.error('[错误]', e.message));