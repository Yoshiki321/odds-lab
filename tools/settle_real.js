/**
 * settle_real.js — 真注（data/betting/bets）365终指亚盘精确结算
 *
 * 只在官方 matchResultList 出现 HAD combination（=比赛正式终场）后才结算。
 * 精确处理亚盘: 平手(0)走盘退本金 / 受让平半(+0.25)平局半赢半输 / 受让半球(+0.5)无走盘。
 *
 * 用法:
 *   node tools/settle_real.js              # 结算所有可结算的真注(终场+在途)
 *   node tools/settle_real.js status       # 只查看哪些可结算、当前比分(不写入)
 *
 * 结算口径: 按 bet 档案的 totalOdds(365终指亚盘水位) 返还。
 *   - 平手盘(0):       客队赢=full win; 平=push(退全额本金); 客队输=full loss
 *   - 受让+0.25(平半): 客队赢=full win; 平=half win(返 0.5s+0.5s*odds); 客队输=full loss
 *   - 受让+0.5(半球):  客队平或赢=full win; 客队输=full loss
 *   - 主队让-0.5:      主队赢=full win; 平或输=full loss
 *   - 主队让-1:        主队赢2球+=full win; 赢1球=push; 平或输=full loss
 * 注: 本项目真注多为客队受让方向(让-1陷阱反向), 以 pick 含队名判断主客。
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'node:https';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const BET_DIR = join(ROOT, 'data', 'betting', 'bets');
const LEDGER = join(ROOT, 'data', 'betting', 'ledger.json');
const BANKROLL = join(ROOT, 'data', 'betting', 'bankroll.json');

function readJSON(p) { return JSON.parse(readFileSync(p, 'utf8')); }
function writeJSON(p, o) { writeFileSync(p, JSON.stringify(o, null, 2), 'utf8'); }

function fetch(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', referer: 'https://www.sporttery.cn/jc/zqdz/' },
      timeout: 15000
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

/** 查官方终场结果: matchResultList 有 HAD combination 才算终场 */
async function fetchFinal(matchId) {
  const url = `https://webapi.sporttery.cn/gateway/uniform/football/getFixedBonusV1.qry?clientCode=3001&matchId=${matchId}`;
  const j = await fetch(url);
  if (!j.success || !j.value) return null;
  const v = j.value;
  const mr = v.matchResultList || [];
  const had = mr.find(x => x.code === 'HAD');
  if (!had || !had.combination) return null;
  return { score: v.sectionsNo999, hadResult: had.combination };
}

function parseScore(s) {
  const m = String(s).match(/(\d+)\s*:\s*(\d+)/);
  if (!m) return null;
  return [parseInt(m[1]), parseInt(m[2])];
}

/**
 * 提取亚盘线（统一为"所买队伍让球数"视角）:
 *   pick 中的 +/- 是所买队伍自身的受让/让出符号: "-1.5"=让1.5, "+0.25"=受让0.25, "0"=平手
 *   teamLine = -(pick符号值)  →  正=让球, 负=受让
 *   isHomePick: 买的是主队还是客队(决定 effDiff 取主队净胜还是客队净胜)
 */
function extractLine(pick, home, away) {
  const isHomePick = pick.includes(home);
  const m = pick.match(/([+-])(\d+(?:\.\d{1,2})?)/);
  let v;
  if (m) {
    v = parseFloat(m[1] + m[2]);
  } else {
    const m0 = pick.match(/0\s*（平手）/);
    if (m0) v = 0;
    else return null;
  }
  return { isHomePick, teamLine: -v };
}

/**
 * 亚盘结算（标准平手/平半/半球/一球规则）
 * @param score "2:0"
 * @param teamLine 所买队伍让球数(正=让, 负=受让)
 * @param isHomePick 买主队还是客队
 * @returns {outcome: 'win'|'loss'|'push'|'halfwin'|'halfloss', returnAmt}
 */
function asianSettle(score, teamLine, isHomePick, odds, stake) {
  const s = parseScore(score);
  if (!s) return { outcome: 'void', returnAmt: stake };
  const diff = s[0] - s[1];                 // 主队净胜
  const effDiff = isHomePick ? diff : -diff; // 所买队伍净胜
  const frac = Math.abs(teamLine) % 1;
  let lines;
  if (frac === 0.25 || frac === 0.75) {
    lines = [teamLine - 0.25, teamLine + 0.25];
  } else {
    lines = [teamLine];
  }
  const results = lines.map(L => {
    const a = effDiff - L;
    return a > 0 ? 'win' : a < 0 ? 'loss' : 'push';
  });
  const winCnt = results.filter(r => r === 'win').length;
  const lossCnt = results.filter(r => r === 'loss').length;
  const pushCnt = results.filter(r => r === 'push').length;
  if (lines.length === 1) {
    if (winCnt === 1) return { outcome: 'win', returnAmt: +(stake * odds).toFixed(2) };
    if (lossCnt === 1) return { outcome: 'loss', returnAmt: 0 };
    return { outcome: 'push', returnAmt: stake };
  }
  if (winCnt === 2) return { outcome: 'win', returnAmt: +(stake * odds).toFixed(2) };
  if (lossCnt === 2) return { outcome: 'loss', returnAmt: 0 };
  if (winCnt === 1 && pushCnt === 1) return { outcome: 'halfwin', returnAmt: +(stake / 2 + (stake / 2) * odds).toFixed(2) };
  if (lossCnt === 1 && pushCnt === 1) return { outcome: 'halfloss', returnAmt: +(stake / 2).toFixed(2) };
  return { outcome: 'void', returnAmt: stake };
}

const mode = process.argv[2] || 'settle';

// 读 ledger 在途
const ledger = readJSON(LEDGER);
const bankroll = readJSON(BANKROLL);
const inPlay = ledger.inPlay || [];

if (inPlay.length === 0) {
  console.log('无在途真注');
  process.exit(0);
}

let changed = false;
for (const ip of inPlay) {
  const betFile = join(BET_DIR, `bet-${String(ip.betId).padStart(3, '0')}.json`);
  if (!existsSync(betFile)) { console.log(`  [缺档案] bet-${ip.betId}`); continue; }
  const bet = readJSON(betFile);
  if (bet.status !== 'open') { console.log(`  [跳过] bet-${ip.betId} status=${bet.status}`); continue; }
  const leg = bet.legs?.[0];
  if (!leg) { console.log(`  [跳过] bet-${ip.betId} 无legs`); continue; }

  const fin = await fetchFinal(leg.matchId);
  if (!fin) {
    console.log(`  [待终场] bet-${ip.betId} ${leg.home}vs${leg.away} 官方未开奖`);
    continue;
  }
  const score = fin.score;
  const ex = extractLine(leg.pick, leg.home, leg.away);
  if (!ex) { console.log(`  [无法解析盘口] bet-${ip.betId} pick=${leg.pick}`); continue; }
  const st = asianSettle(score, ex.teamLine, ex.isHomePick, bet.totalOdds, bet.stake);
  const profit = +(st.returnAmt - bet.stake).toFixed(2);
  const icon = st.outcome === 'win' ? '✅' : st.outcome === 'halfwin' ? '🟡' : st.outcome === 'push' ? '⚪' : '❌';
  console.log(`  [${icon}] bet-${ip.betId} ${leg.home} ${score} ${leg.away} | ${leg.pick} | 线=${ex.teamLine} -> ${st.outcome} 返还${st.returnAmt} 净${profit>=0?'+':''}${profit}`);

  if (mode === 'status') continue;

  // 写回 bet 档案
  bet.status = 'settled';
  bet.result = score;
  bet.hadResult = fin.hadResult;
  bet.returnAmount = st.returnAmt;
  bet.profit = profit;
  bet.settledAt = new Date().toISOString();
  bet.settle = {
    market: '365终指亚盘',
    pick: leg.pick,
    score,
    line: ex.line,
    outcome: st.outcome,
    note: `${st.outcome} 返还${st.returnAmt} 净${profit>=0?'+':''}${profit}`
  };
  writeJSON(betFile, bet);

  // ledger: cash + 返还, inPlay 移除, history 加 SETTLE
  ledger.cash = +(ledger.cash + st.returnAmt).toFixed(2);
  ledger.settledProfit = +(ledger.settledProfit + profit).toFixed(2);
  ledger.totalReturned = +(ledger.totalReturned + st.returnAmt).toFixed(2);
  ledger.inPlay = ledger.inPlay.filter(x => x.betId !== ip.betId);
  ledger.history.push({
    date: new Date().toISOString(),
    type: 'SETTLE',
    note: `bet-${ip.betId}: ${leg.home} ${score} ${leg.away} ${leg.pick} ${st.outcome} 返还${st.returnAmt}(净${profit>=0?'+':''}${profit})`,
    amount: st.returnAmt,
    balance: ledger.cash
  });
  ledger.lastUpdated = new Date().toISOString();

  // bankroll: sequence 加 IN
  bankroll.cash = +(bankroll.cash + st.returnAmt).toFixed(2);
  bankroll.sequence.push({
    date: new Date().toISOString(),
    type: 'IN',
    note: `bet-${ip.betId} 结算 ${st.outcome} 返还${st.returnAmt}`,
    amount: st.returnAmt,
    balance: bankroll.cash
  });
  bankroll.lastUpdated = new Date().toISOString();

  changed = true;
}

if (mode === 'status') {
  console.log(`\n[status模式] 当前现金 ${ledger.cash} | 在途 ${ledger.inPlay.length} 注(未终场)`);
  process.exit(0);
}

if (changed) {
  writeJSON(LEDGER, ledger);
  writeJSON(BANKROLL, bankroll);
  console.log('\n已更新 ledger/bankroll');
  console.log(`现金 ${ledger.cash} | 累计盈亏 ${ledger.settledProfit} | 在途 ${ledger.inPlay.length} 注`);
} else {
  console.log('\n本次无可结算真注(比赛未终场), 台账未变');
}
