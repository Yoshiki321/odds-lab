/**
 * odds_history.js — 竞彩赔率变化历史 + 懂球帝欧赔对比 工具
 *
 * 用法:
 *   node tools/odds_history.js <matchId> [matchId ...]
 *
 * 数据来源:
 *   1. 竞彩网 getFixedBonusV1  — 赔率变化历史(hadList/hhadList)
 *   2. 懂球帝 magicball        — 欧赔/亚盘/大小球 (初盘 vs 即时)
 *   3. 竞彩网 getMatchHeadV1   — 本赛季战绩/排名/积分榜
 */

const https = require('https');

const JINGCAI_BASE = 'https://webapi.sporttery.cn/gateway';
const DONGQIUDI_BASE = 'https://www.dongqiudi.com';

function get(url, headers = {}, retries = 2) {
  return new Promise((resolve, reject) => {
    const attempt = (n) => {
      const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0', ...headers } }, res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: data, json: JSON.parse(data) }); }
          catch(e) { resolve({ status: res.statusCode, body: data, json: null }); }
        });
      });
      req.on('error', e => n > 0 ? setTimeout(() => attempt(n - 1), 500) : reject(e));
      req.setTimeout(15000, () => { req.destroy(); n > 0 ? setTimeout(() => attempt(n - 1), 500) : reject(new Error('timeout ' + url)); });
    };
    attempt(retries);
  });
}

async function getJingcaiOddsHistory(matchId) {
  const url = `${JINGCAI_BASE}/uniform/football/getFixedBonusV1.qry?clientCode=3001&matchId=${matchId}`;
  const r = await get(url, { referer: 'https://www.sporttery.cn/jc/zqdz/' });
  if (!r.json?.success) return { error: r.body?.slice(0, 300) };
  const oh = r.json.value?.oddsHistory;
  return {
    matchId,
    had_history: oh?.hadList || [],
    hhad_history: oh?.hhadList || [],
    had_changes: (oh?.hadList || []).length,
    hhad_changes: (oh?.hhadList || []).length
  };
}

async function getJingcaiHead(matchId) {
  const url = `${JINGCAI_BASE}/uniform/football/getMatchHeadV1.qry?source=web&sportteryMatchId=${matchId}`;
  const r = await get(url, { referer: 'https://www.sporttery.cn/jc/zqdz/' });
  if (!r.json?.success) return { error: r.body?.slice(0, 300) };
  const v = r.json.value;
  return {
    matchId,
    homeShort: v.homeTeamShortName,
    awayShort: v.awayTeamShortName,
    season: v.seasonName,
    gameweek: v.gameweek,
    wbsjStats: v.wbsjStats
  };
}

async function getDongqiudiOdds(matchId) {
  const url = `${DONGQIUDI_BASE}/magicball/v1/list/match_list?language=zh-CN&cmp_type=soccer&tab_type=all`;
  const r = await get(url, { referer: 'https://www.dongqiudi.com/' });
  if (!r.json?.data?.matches) return { error: 'no matches' };
  const matches = r.json.data.matches;
  // Need to match by team names since dongqiudi has different IDs
  // We return all matches and let caller match
  return matches;
}

// Parse score_odds format: "0.98,0.5,0.83" → {water_home:0.98, handicap:0.5, water_away:0.83}
function parseAsia(str) {
  if (!str) return null;
  const [h, hl, a] = str.split(',');
  return { homeWater: parseFloat(h), handicap: parseFloat(hl), awayWater: parseFloat(a) };
}
function parseEuro(str) {
  if (!str) return null;
  const [h, d, a] = str.split(',');
  return { home: parseFloat(h), draw: parseFloat(d), away: parseFloat(a) };
}
function parseTotal(str) {
  if (!str) return null;
  const [over, line, under] = str.split(',');
  return { over: parseFloat(over), line: parseFloat(line), under: parseFloat(under) };
}

module.exports = { getJingcaiOddsHistory, getJingcaiHead, getDongqiudiOdds, parseAsia, parseEuro, parseTotal };

// CLI mode
if (require.main === module) {
  const cwd = process.cwd();
  const fs = require('fs');
  const path = require('path');
  const dataDir = path.join(cwd, 'data');

  (async () => {
    const ids = process.argv.slice(2).map(Number).filter(Boolean);
    if (!ids.length) { console.log('用法: node tools/odds_history.js <matchId> [...]'); process.exit(0); }

    // Load odds snapshot for team name mapping
    const oddsFiles = fs.existsSync(path.join(dataDir, 'odds'))
      ? fs.readdirSync(path.join(dataDir, 'odds')).filter(f => f.includes('football_all')).sort()
      : [];
    const latestFile = oddsFiles[oddsFiles.length - 1];
    let nameMap = {};
    if (latestFile) {
      try {
        const sn = JSON.parse(fs.readFileSync(path.join(dataDir, 'odds', latestFile)));
        (sn.value?.matchInfoList || []).forEach(day =>
          (day.subMatchList || []).forEach(m => {
            nameMap[m.matchId] = { home: m.homeTeamAllName, away: m.awayTeamAllName, matchNum: m.matchNumStr };
          })
        );
      } catch(e) {}
    }

    for (const id of ids) {
      const teams = nameMap[id] || { home: '?', away: '?' };
      console.log(`\n================ matchId ${id} — ${teams.home} vs ${teams.away} ================`);

      // 1. Odds history
      const hist = await getJingcaiOddsHistory(id);
      if (hist.error) { console.log('赔率历史 FAIL:', hist.error); }
      else {
        console.log(`赔率变化历史: HAD ${hist.had_changes}次, HHAD ${hist.hhad_changes}次`);
        if (hist.had_history.length) {
          console.log('HAD timeline:');
          hist.had_history.forEach(e => console.log(`  ${e.updateDate.slice(5)} ${e.updateTime}  主${e.h} 平${e.d} 客${e.a}`));
        }
        if (hist.hhad_history.length) {
          const latest = hist.hhad_history[hist.hhad_history.length - 1];
          console.log('HHAD latest:', `让${latest.goalLine} 主${latest.h} 平${latest.d} 客${latest.a} @${latest.updateTime}`);
        }
        // R5 check
        const hadN = hist.had_changes;
        console.log(`R5评估: 变盘${hadN}次. ${hadN >= 3 ? '✅ ≥3次变动,满足R5(超8h可投)' : hadN >= 1 ? '⚠️ ' + hadN + '次变动,未达3次(仅≤8h场可投)' : '❌ 0次变动,赔率未博弈'}`);
      }

      // 2. Head stats
      const head = await getJingcaiHead(id);
      if (head.error) { console.log('战绩 FAIL:', head.error); }
      else if (head.wbsjStats) {
        const h = head.wbsjStats.home, a = head.wbsjStats.away;
        console.log(`\n${head.season}赛季 第${head.gameweek}轮`);
        if (h) console.log(`主队 排名${h.ranking}: ${h.sWinGoalMatchCnt}胜${h.sDrawMatchCnt}平${h.sLossGoalMatchCnt}负 | 主场${h.sHomeWinGoalMatchCnt}胜${h.sHomeDrawMatchCnt}平${h.sHomeLossGoalMatchCnt}负`);
        if (a) console.log(`客队 排名${a.ranking}: ${a.sWinGoalMatchCnt}胜${a.sDrawMatchCnt}平${a.sLossGoalMatchCnt}负 | 客场${a.sAwayWinGoalMatchCnt}胜${a.sAwayDrawMatchCnt}平${a.sAwayLossGoalMatchCnt}负`);
      }
    }

    // 3. Dongqiudi Euro odds for reference
    console.log('\n\n================ 懂球帝欧赔(全量) ================');
    const dqd = await getDongqiudiOdds();
    if (Array.isArray(dqd)) {
      // match by name
      Object.entries(nameMap).forEach(([id, t]) => {
        const m = dqd.find(x => x.team_A?.name === t.home && x.team_B?.name === t.away)
          || dqd.find(x => x.team_A?.name?.includes(t.home.slice(0, 2)) && x.team_B?.name?.includes(t.away.slice(0, 2)));
        if (m && m.score_odds) {
          const { origin, spot } = m.score_odds;
          const oe = parseEuro(origin?.[1]), se = parseEuro(spot?.[1]);
          const oa = parseAsia(origin?.[0]), sa = parseAsia(spot?.[0]);
          console.log(`\n[懂球帝] ${t.home} vs ${t.away} (match_id ${m.match_id})`);
          console.log(`  欧赔 初盘: ${oe ? oe.home + '/' + oe.draw + '/' + oe.away : 'n/a'}  即时: ${se ? se.home + '/' + se.draw + '/' + se.away : 'n/a'}`);
          console.log(`  亚盘 初盘: ${oa ? oa.homeWater + '@' + oa.handicap + '@' + oa.awayWater : 'n/a'}  即时: ${sa ? sa.homeWater + '@' + sa.handicap + '@' + sa.awayWater : 'n/a'}`);
        }
      });
    }
  })();
}