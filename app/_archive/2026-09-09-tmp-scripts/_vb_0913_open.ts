import { pool } from '../../src/server/db/pool.js';
import { upsertVirtual } from '../../src/server/db/store.js';
import * as fs from 'fs';

interface VbSpec {
  id: string; matchId: string; pick: string; odds: number; confidence: number;
  myView: string; reviewHook: string;
}
const SPECS: VbSpec[] = [
  { id: 'vb-165', matchId: '2041445', pick: '主负 @1.54', odds: 1.54, confidence: 56,
    myView: '56实单档全场最高，但R5窗外(距开9.3h)+EV-13.0%：莫尔德客胜，竞彩1.54<欧1.65定价偏贵，M-04形态但亚盘渠道无AH线→settleEV不可得。测方向对错',
    reviewHook: '主负=莫尔德赢。欧1.65隐含61%，竞彩1.54隐含65%标贵，看方向是否仍对（M-04第4样本）' },
  { id: 'vb-166', matchId: '2041444', pick: '客-2胜 @1.82', odds: 1.82, confidence: 49,
    myView: '49实单档但无欧赔可比，深盘客-2（巴萨）M-03模板+距开8.6h R5窗外。测深盘大热穿盘',
    reviewHook: '客-2胜=巴萨净胜3+。深盘-2+无欧赔价值维缺失，看西甲深让大热是否穿' },
  { id: 'vb-167', matchId: '2041441', pick: '主负 @2.60', odds: 2.60, confidence: 47,
    myView: '47弃投·平局。莱切-蒙扎主负2.60，R9平局过滤器直接弃，但赔率最高有检测价值，测平局过滤器误杀率',
    reviewHook: '主负=蒙扎赢。2.60赔率+平局过滤器，看是否被逼平（R9验证场）' },
  { id: 'vb-168', matchId: '2041453', pick: '主负 @1.15', odds: 1.15, confidence: 47,
    myView: '47候选超低赔1.15（巴黎客胜）。低赔无价值维，测试大热陷阱模板',
    reviewHook: '主负=巴黎赢。1.15隐含87%，巴黎客战布雷斯特，看是否爆冷' },
  { id: 'vb-169', matchId: '2041454', pick: '主负 @2.05', odds: 2.05, confidence: 47,
    myView: '47弃投·平局。皇家社会-马竞，R9平局过滤器弃投，静盘无信号，测过滤器对西甲强强对话的误杀',
    reviewHook: '主负=马竞赢。2.05+平局过滤器，看强强对话是否平局高发' },
  { id: 'vb-170', matchId: '2041439', pick: '主胜 @2.00', odds: 2.00, confidence: 47,
    myView: '47弃投·平局但无欧赔可比。芬超库奥皮奥-赫尔辛基主胜2.00，R9平局过滤器 vs 芬兰联赛主队常态，测试过滤器跨联赛适用性',
    reviewHook: '主胜=库奥皮奥赢。无欧赔+平局过滤器，看芬超平局率是否真的高' },
  { id: 'vb-171', matchId: '2041448', pick: '客+1胜 @1.95', odds: 1.95, confidence: 46,
    myView: '46候选。那不勒斯-博洛尼亚客+1胜1.95，让球P47%@13:33，EV-8.9%。下盘保护化：客受让方平局也中，测受让方豁免',
    reviewHook: '客+1胜=博洛尼亚不败(平/赢即中)。下盘保护化在受让方的有效性' },
  { id: 'vb-172', matchId: '2041435', pick: '主胜 @2.07', odds: 2.07, confidence: 46,
    myView: '46弃投·平局。东京绿茵-千叶市原日职早场(17:00,3.3h)主胜2.07，R9平局过滤器弃投。日职早场窗口内但<48只虚拟',
    reviewHook: '主胜=东京绿茵赢。日职早场+平局过滤器，看弃投场是否真的出平' },
  { id: 'vb-173', matchId: '2041443', pick: '主胜 @1.21', odds: 1.21, confidence: 46,
    myView: '46候选低赔1.21（莱红牛-汉堡）。德甲升班马对决大热，EV-14.1%，无价值维，测大热陷阱',
    reviewHook: '主胜=莱红牛赢。1.21隐含83%，看升班马主场大热是否穿' },
  { id: 'vb-174', matchId: '2041436', pick: '主胜 @1.55', odds: 1.55, confidence: 45,
    myView: '45候选。仙台七夕-札幌冈萨日乙早场(17:00,3.3h)主胜1.55，EV-13.3%。窗口内但<48只虚拟',
    reviewHook: '主胜=仙台赢。1.55低赔+日乙早场，看主队升势是否兑现' },
  { id: 'vb-175', matchId: '2041447', pick: '客-2胜 @1.72', odds: 1.72, confidence: 45,
    myView: '45候选。埃沃斯堡-拜仁客-2胜1.72，让球P48%@13:33，EV-17.2%。德甲深盘客让M-03模板，测拜仁净胜3+',
    reviewHook: '客-2胜=拜仁净胜3+。深盘-2+P48%，看德甲班霸客让深盘是否穿' },
  { id: 'vb-176', matchId: '2041440', pick: '主胜 @1.43', odds: 1.43, confidence: 44,
    myView: '44候选。海伦芬-特尔斯达荷甲主胜1.43，EV-15.5%无价值维，测荷甲中游主胜方向',
    reviewHook: '主胜=海伦芬赢。1.43中低赔，看荷甲主队常态是否成立' },
];

const DIR = 'C:/zwkj/竞彩助手/data/virtual/';
const p = pool();
const mq = await p.query(`SELECT match_id, num, league, home, away, kickoff FROM matches WHERE match_date='2026-09-13'`);
const M = new Map(mq.rows.map(r => [String(r.match_id), r]));

for (const s of SPECS) {
  const m = M.get(s.matchId);
  if (!m) { console.log('!! no match', s.matchId); continue; }
  const v = {
    id: s.id, matchId: s.matchId, matchNum: m.num, league: m.league, home: m.home, away: m.away,
    matchTime: m.kickoff ? m.kickoff.toISOString().slice(11, 19) : null, kickoff: m.kickoff,
    confidence: s.confidence, myView: s.myView, analysis: '13:00开盘扫描：实单全空仓(全场无正EV)，top12虚拟注覆盖', pick: s.pick,
    odds: s.odds, reviewHook: s.reviewHook, status: 'open', placedAt: new Date(), settledAt: null, result: null,
  };
  await upsertVirtual(v as any);
  fs.writeFileSync(DIR + s.id + '.json', JSON.stringify({ id: s.id, matchId: s.matchId, matchNum: m.num, league: m.league, home: m.home, away: m.away, matchTime: v.matchTime, kickoff: v.kickoff?.toISOString(), confidence: s.confidence, myView: s.myView, analysis: v.analysis, pick: s.pick, odds: s.odds, reviewHook: s.reviewHook, status: 'open', placedAt: v.placedAt.toISOString() }, null, 2), 'utf8');
  console.log('written', s.id, s.pick);
}
await p.end();