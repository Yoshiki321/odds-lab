import { pool } from '../../src/server/db/pool.js';
import { upsertVirtual } from '../../src/server/db/store.js';
import * as fs from 'fs';

interface VbSpec {
  id: string;
  matchId: string;
  pick: string;
  odds: number;
  confidence: number;
  myView: string;
  reviewHook: string;
}
const SPECS: VbSpec[] = [
  { id: 'vb-153', matchId: '2041408', pick: '主+1胜 @1.78', odds: 1.78, confidence: 58,
    myView: '58加注档唯一，但价值维0：欧EV-83.7%让球P9%钳制失真（M-03深盘模板，亚盘-2.75深让）。测下盘保护化在深让下的有效性',
    reviewHook: '主+1胜=钢巴赢或平即中。东京FC受让方大众高看，看钢巴能否守住+1' },
  { id: 'vb-154', matchId: '2041434', pick: '主-2胜 @1.72', odds: 1.72, confidence: 57,
    myView: '57实单档+价值10（欧EV+69.7%），但R5拦（03:00距15h）+深盘P99%疑钳制失真。测皇马-2大热能否穿盘',
    reviewHook: '主-2胜=皇马净胜3+。欧1.13隐含88%胜，净胜3+概率若<58%则1.72-2为负期望' },
  { id: 'vb-155', matchId: '2041433', pick: '主负 @1.36', odds: 1.36, confidence: 48,
    myView: '48实单档但EV-15.9%（竞彩1.36<欧1.53，M-04形态）。转欧亚亦非+EV→真放弃。M-04第3样本：竞彩负EV≠方向错',
    reviewHook: '主负=阿森纳客胜。欧盘1.53隐含65%，竞彩1.36隐含73%定价偏高，看方向对不对' },
  { id: 'vb-156', matchId: '2041426', pick: '主胜 @1.85', odds: 1.85, confidence: 47,
    myView: '47候选·平局（R9平局过滤器）。热刺-埃弗顿主胜1.85，平局结构风险，只虚拟测判断',
    reviewHook: '主胜=热刺赢。R9平局过滤器是否误杀：看热刺能否赢球而不是被逼平' },
  { id: 'vb-157', matchId: '2041429', pick: '主负 @1.15', odds: 1.15, confidence: 47,
    myView: '47候选超低赔1.15（波尔图客胜）。低赔无价值维，测试大热陷阱模板',
    reviewHook: '主负=波尔图赢。1.15隐含87%，波尔图葡超强队但客场低赔，看是否爆冷' },
  { id: 'vb-158', matchId: '2041428', pick: '主胜 @1.31', odds: 1.31, confidence: 47,
    myView: '47候选低赔1.31。毕尔巴鄂-埃尔切，降水0.13形态1，无价值维，只虚拟',
    reviewHook: '主胜=毕尔巴鄂赢。低赔大热看是否穿盘或爆冷' },
  { id: 'vb-159', matchId: '2041407', pick: '主胜 @1.43', odds: 1.43, confidence: 45,
    myView: '45候选。广岛三箭-大阪樱花J联赛，降水0.07形态4，价值维0只虚拟',
    reviewHook: '主胜=广岛赢。J联赛样本测下盘保护化之外的普通主胜方向' },
  { id: 'vb-160', matchId: '2041420', pick: '主胜 @1.35', odds: 1.35, confidence: 44,
    myView: '44候选低赔1.35。利物浦-富勒姆，静盘无降水，价值维0只虚拟',
    reviewHook: '主胜=利物浦赢。英超大热1.35看利物浦穿盘还是轮换冷' },
  { id: 'vb-161', matchId: '2041430', pick: '主负 @1.29', odds: 1.29, confidence: 44,
    myView: '44候选超低赔1.29。福图纳-阿贾克斯，静盘，荷甲客强但1.29无价值，只虚拟',
    reviewHook: '主负=阿贾克斯赢。1.29大热看荷甲客队稳定性' },
  { id: 'vb-162', matchId: '2041405', pick: '主胜 @1.95', odds: 1.95, confidence: 44,
    myView: '44弃投·平局但降水0.30强信号（昨塞维利亚同形态）。R9平局过滤器 vs 强降水，测试谁赢',
    reviewHook: '主胜=蔚山赢。降水0.30为全日最强，但R9说平局风险高，测过滤器冲突' },
  { id: 'vb-163', matchId: '2041418', pick: '主胜 @2.10', odds: 2.10, confidence: 47,
    myView: '47弃投·平局静盘。维拉-诺丁汉，R9平局过滤器直接弃，但主胜2.10有赔率，测静盘平局过滤器误杀率',
    reviewHook: '主胜=维拉赢。静盘无信号+平局过滤器，看是否被逼平' },
  { id: 'vb-164', matchId: '2041413', pick: '主胜 @1.14', odds: 1.14, confidence: 43,
    myView: '43候选超低赔1.14。多特蒙德-帕德博恩深盘大热，P值失真模板，测试大热陷阱',
    reviewHook: '主胜=多特赢。1.14隐含88%极深大热，看德甲大热是否穿' },
];

const DIR = 'C:/zwkj/竞彩助手/data/virtual/';
const p = pool();
const mq = await p.query(`SELECT match_id, num, league, home, away, kickoff FROM matches WHERE match_date='2026-09-12'`);
const M = new Map(mq.rows.map(r => [String(r.match_id), r]));

for (const s of SPECS) {
  const m = M.get(s.matchId);
  if (!m) { console.log('!! no match', s.matchId); continue; }
  const v = {
    id: s.id, matchId: s.matchId, matchNum: m.num, league: m.league, home: m.home, away: m.away,
    matchTime: m.kickoff ? m.kickoff.toISOString().slice(11, 19) : null, kickoff: m.kickoff,
    confidence: s.confidence, myView: s.myView, analysis: '开盘扫描：实单全空仓，关键场次虚拟注覆盖', pick: s.pick,
    odds: s.odds, reviewHook: s.reviewHook, status: 'open', placedAt: new Date(), settledAt: null, result: null,
  };
  await upsertVirtual(v as any);
  fs.writeFileSync(DIR + s.id + '.json', JSON.stringify({ id: s.id, matchId: s.matchId, matchNum: m.num, league: m.league, home: m.home, away: m.away, matchTime: v.matchTime, kickoff: v.kickoff?.toISOString(), confidence: s.confidence, myView: s.myView, analysis: v.analysis, pick: s.pick, odds: s.odds, reviewHook: s.reviewHook, status: 'open', placedAt: v.placedAt.toISOString() }, null, 2), 'utf8');
  console.log('written', s.id, s.pick);
}
await p.end();
console.log('done 12 vb');