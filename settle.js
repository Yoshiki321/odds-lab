/**
 * 竞彩投注结算工具
 *
 * 在比赛结束后运行，读取官方开奖结果结算每笔投注。
 *
 * 用法:
 *   node settle.js              # 结算所有待结算投注
 *   node settle.js <betId>      # 结算单笔
 *   node settle.js status       # 查看当前持仓和可结算状态
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BET_DIR = join(__dirname, 'data', 'betting', 'bets');
const LEDGER = join(__dirname, 'data', 'betting', 'ledger.json');
const BANKROLL = join(__dirname, 'data', 'betting', 'bankroll.json');
const HISTORY_DIR = join(__dirname, 'data', 'history', 'football');
const LEAGUE_DIR = join(__dirname, 'data', 'league');

const HAD_CODE = 'HAD';
const WINFLAG_MAP = { 'H': 'h', 'D': 'd', 'A': 'a' };

function readJSON(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJSON(path, obj) {
  writeFileSync(path, JSON.stringify(obj, null, 2), 'utf8');
}

/** 通过联赛/赛程数据查找比赛结果 */
async function findResult(matchId, homeTeam, awayTeam) {
  // 1. 优先用 getFixedBonusV1 直接查决赛结果（最可靠, 官方接口）
  try {
    const result = await fetchFixedBonusResult(matchId);
    if (result) return result;
  } catch {}

  // 2. 从历史赛果里找
  const historyDir = HISTORY_DIR;
  const { readdirSync } = await import('node:fs');
  let files = [];
  try { files = readdirSync(historyDir).filter(f => f.endsWith('.json')); } catch {}
  for (const f of files) {
    const data = readJSON(join(historyDir, f));
    const matches = data.matches || [];
    const m = matches.find(x => x.matchId === matchId);
    if (m && m.winFlag && m.matchResultStatus === '2') return m;
  }

  // 3. 再从联赛数据里找
  try {
    const leagueData = readJSON(join(LEAGUE_DIR, 'leagues.json'));
    for (const L of leagueData.data) {
      for (const block of L.matches) {
        const sub = block.subMatchList || [];
        const m = sub.find(x => x.uniformMatchId === matchId);
        if (m && m.wbsjMatchSc === 'Played') return m;
      }
    }
  } catch {}

  return null;
}

/** 用 getFixedBonusV1 查比赛胜负结果 */
async function fetchFixedBonusResult(matchId) {
  const https = await import('node:https');
  const url = `https://webapi.sporttery.cn/gateway/uniform/football/getFixedBonusV1.qry?clientCode=3001&matchId=${matchId}`;
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', referer: 'https://www.sporttery.cn/jc/zqdz/' },
      timeout: 10000
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          if (j.success && j.value) {
            const mr = j.value.matchResultList || [];
            const had = mr.find(x => x.code === 'HAD');
            const hhad = mr.find(x => x.code === 'HHAD');
            if (had) {
              resolve({
                matchId,
                winFlag: had.combination,  // 'H' | 'D' | 'A'
                hhadResult: hhad?.combination,  // HHAD开奖 H/D/A
                goalLine: hhad?.goalLine,
                sectionsNo999: j.value.sectionsNo999 || '?',
                matchResultStatus: '2',
                source: 'fixedBonus'
              });
              return;
            }
          }
          resolve(null);
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

/** 判定一个 leg 是否命中（支持HAD和HHAD） */
function legWins(pick, result) {
  const winFlag = typeof result === 'string' ? result : (result?.winFlag || '');
  const sections = typeof result === 'string' ? '' : (result?.sectionsNo999 || '');

  if (pick.includes('HHAD') || pick.includes('让球') || pick.includes('受让') || pick.includes('让')) {
    // 让球盘: 用官方 matchResultList 中的 HHAD 结果
    if (result?.hhadResult) {
      const target = pick.includes('主胜') || pick.endsWith('H') ? 'H'
        : pick.includes('平') || pick.endsWith('D') ? 'D'
        : pick.includes('客胜') || pick.endsWith('A') ? 'A' : null;
      return target === result.hhadResult;
    }
    // 降级：用比分计算
    if (sections && result?.goalLine !== undefined) {
      const [hs, as] = sections.split(':').map(Number);
      if (isNaN(hs) || isNaN(as)) return null;
      const gl = parseInt(result.goalLine, 10);
      const diff = hs - gl - as;
      // 主胜: diff > 0, 平: diff === 0, 客胜: diff < 0
      if (pick.includes('主胜') || pick.endsWith('H')) return diff > 0;
      if (pick.includes('平') || pick.endsWith('D')) return diff === 0;
      if (pick.includes('客胜') || pick.endsWith('A')) return diff < 0;
    }
    return null;
  }

  // 普通胜平负 HAD
  return (pick.includes('主胜') && winFlag === 'H') ||
         (pick.includes('平') && winFlag === 'D') ||
         (pick.includes('客胜') && winFlag === 'A');
}

async function settleBet(bet) {
  if (bet.status === 'settled') {
    console.log(`  [跳过] bet-${bet.betId} 已结算`);
    return null;
  }

  let allWin = true;
  for (const leg of bet.legs) {
    const result = await findResult(leg.matchId, leg.home, leg.away);
    if (!result) {
      console.log(`  [待定] bet-${bet.betId} 场次 ${leg.matchNum} ${leg.home}vs${leg.away} 尚未有结果`);
      return null;
    }
    leg.result = result;
    const winFlag = result.winFlag;
    const sections = result.sectionsNo999 || '?';
    const isWin = legWins(leg.pick, result);
    console.log(`  [场次] ${leg.matchNum} ${leg.home}${sections}${leg.away} 官方:${winFlag === 'H' ? '主胜' : winFlag === 'D' ? '平' : '客胜'} 投注:${leg.pick} ${isWin === true ? '✅' : isWin === false ? '❌' : '⚠️走水'}`);
    if (isWin !== true) allWin = false;
  }

  bet.status = 'settled';
  bet.settledAt = new Date().toISOString();

  if (allWin) {
    bet.returnAmount = Math.round(bet.stake * bet.totalOdds * 100) / 100;
    bet.profit = Math.round((bet.returnAmount - bet.stake) * 100) / 100;
    console.log(`  [结算] ✅ bet-${bet.betId} 中奖! 投注${bet.stake} -> 返${bet.returnAmount} (盈利+${bet.profit})`);
  } else {
    bet.returnAmount = 0;
    bet.profit = -bet.stake;
    console.log(`  [结算] ❌ bet-${bet.betId} 未中奖, 损失${bet.stake}`);
  }

  return bet;
}

async function main() {
  const cmd = process.argv[2];
  const ledger = readJSON(LEDGER);
  const bankroll = readJSON(BANKROLL);

  // 读取所有待结算投注
  const betIds = cmd && !isNaN(Number(cmd)) ? [Number(cmd)] : ledger.bets;
  const bets = [];
  for (const id of betIds) {
    const path = join(BET_DIR, `bet-${String(id).padStart(3, '0')}.json`);
    if (!existsSync(path)) {
      console.log(`[错误] bet-${id} 文件不存在`);
      continue;
    }
    bets.push(readJSON(path));
  }

  if (cmd === 'status') {
    console.log('\n=== 当前持仓 ===');
    console.log(`现金: ${ledger.cash} 元`);
    console.log(`累计投注: ${ledger.totalStaked} 元`);
    console.log(`累计返奖: ${ledger.totalReturned} 元`);
    console.log(`已实现盈亏: ${ledger.settledProfit} 元`);
    console.log(`在途投注: ${ledger.inPlay.length} 单`);
    for (const id of ledger.inPlay) {
      const b = readJSON(join(BET_DIR, `bet-${String(id).padStart(3, '0')}.json`));
      console.log(`  bet-${id}: ${b.legs.map(l => l.home + 'vs' + l.away + '(' + l.pick + ')').join(' × ')} 投${b.stake} 赔${b.totalOdds} 状态:${b.status}`);
    }
    return;
  }

  console.log(`\n=== 结算投注 ===`);

  for (const bet of bets) {
    const result = await settleBet(bet);
    if (!result) continue;

    // 更新文件
    writeJSON(join(BET_DIR, `bet-${String(bet.betId).padStart(3, '0')}.json`), bet);

    // 更新台账
    ledger.totalStaked += bet.stake;
    ledger.totalReturned += bet.returnAmount;
    ledger.settledProfit += bet.profit;
    ledger.cash += bet.returnAmount;
    ledger.inPlay = ledger.inPlay.filter(id => id !== bet.betId);
    ledger.history.push({
      date: bet.settledAt,
      type: 'SETTLE',
      note: `bet-${bet.betId}: ${bet.profit >= 0 ? '中奖' : '未中'} +${bet.returnAmount}`,
      amount: bet.returnAmount,
      balance: ledger.cash,
    });
    ledger.lastUpdated = new Date().toISOString();

    // 更新资金流水
    bankroll.cash = ledger.cash;
    bankroll.sequence.push({
      date: bet.settledAt,
      type: 'IN',
      note: `bet-${bet.betId} 结算 ${bet.profit >= 0 ? '中奖' : '未中'}`,
      amount: bet.returnAmount,
      balance: ledger.cash,
    });
    bankroll.lastUpdated = new Date().toISOString();
  }

  writeJSON(LEDGER, ledger);
  writeJSON(BANKROLL, bankroll);
  console.log(`\n结算完成。当前现金: ${ledger.cash} 元`);
}

main().catch(e => console.error('[错误]', e.message));