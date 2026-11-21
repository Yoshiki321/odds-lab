import { upsertVirtual } from '../../src/server/db/store.js';
import { pool } from '../../src/server/db/pool.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'data', 'virtual');
const now = new Date().toISOString();

interface V {
  id: string; matchId: string; num: string; league: string; home: string; away: string;
  matchTime: string; kickoff: string; pick: string; odds: string; confidence: number;
  myView: string; analysis: string; reviewHook: string;
}
const bets: V[] = [
  { id: 'vb-141', matchId: '2041386', num: '周五001', league: '日职', home: '京都', away: '柏太阳神', matchTime: '18:00:00', kickoff: '2026-09-11T18:00:00+08:00', pick: '主负 @1.56', odds: '1.56', confidence: 5,
    myView: '51分实单档但欧EV-12%，竞彩客胜1.56 < EU客胜1.67（竞彩更低），M-04候选触发改投欧亚盘但EU价仍约-6% → 转欧亚亦非+EV，真放弃',
    analysis: 'M1 P2a_gl1弱化（让球+1客降水0.18退回胜平负），4源仅2源确认。EU主5.00/平3.80/客1.67 与竞彩接近，机构定价客胜略信于竞彩。EV门禁拦下实单（M-03口径）。',
    reviewHook: '客胜命中=M-04样本+1（竞彩负EV≠方向错，但欧亚也非+EV放弃合理）；客胜落空=M1弱化方向信号假' },
  { id: 'vb-142', matchId: '2041395', num: '周五010', league: '英冠', home: '西汉姆联', away: '雷克斯', matchTime: '03:00:00', kickoff: '2026-09-12T03:00:00+08:00', pick: '主胜 @1.42', odds: '1.42', confidence: 4,
    myView: '48分实单档但距开13.5h超R5八小时窗，19:00后窗内再评；无欧赔可比EV未证实',
    analysis: '降水规则命中（drop0.18+2源确认），1.42大热。R5时间窗口（>8h不投）当前拦截，非方向否决。',
    reviewHook: '主胜命中=降水规则有效但窗口纪律错过（评估19:00是否值得补）；不胜=1.42低赔负EV方向也假' },
  { id: 'vb-143', matchId: '2041396', num: '周五011', league: '西甲', home: '塞维利亚', away: '巴伦西亚', matchTime: '03:00:00', kickoff: '2026-09-12T03:00:00+08:00', pick: '主胜 @1.82', odds: '1.82', confidence: 3,
    myView: '47分弃投·平局（R_draw≥0.7）却被强降水0.32覆盖——R9过滤器 vs 强降水谁对',
    analysis: '降水0.32全表最强方向信号，但平局结构险≥0.7判弃投（平赔集中+让球浅）。虚拟注测试：强降水能否穿透平局温床。',
    reviewHook: '平局=过滤器正确吃掉强降水；主胜分胜负=强降水信号真，R9误杀' },
  { id: 'vb-144', matchId: '2041389', num: '周五004', league: '瑞超', home: '赫根', away: '米亚尔比', matchTime: '01:00:00', kickoff: '2026-09-12T01:00:00+08:00', pick: '主胜 @1.47', odds: '1.47', confidence: 3,
    myView: '46分候选档，欧EV-12.9%低赔主胜负期望，只虚拟验证',
    analysis: '降水规则命中但1.47低赔EV负（EU主胜1.57），价值维0。候选档（40-47）只虚拟。',
    reviewHook: '主胜命中=瑞超主队强度撑住负EV方向；不胜=低赔负EV方向假（EV门禁该挡）' },
  { id: 'vb-145', matchId: '2041390', num: '周五005', league: '荷甲', home: '阿尔克马', away: '威廉二世', matchTime: '02:00:00', kickoff: '2026-09-12T02:00:00+08:00', pick: '主-2胜 @1.83', odds: '1.83', confidence: 3,
    myView: '43分候选档：静盘+未命中模型，但欧EV+78%/让球P97%——深盘P97%=M-03失真模板（巴黎/拜仁前例），绝不真押',
    analysis: 'EU主胜1.17 悬殊，竞彩主-2@1.83。让球P97%是Skellam拟合的钳制值，深盘2球覆盖概率失真（M-03）。价值维10但model 0/静盘，band候选。',
    reviewHook: '-2穿盘命中=深盘P97%此处真实（大热让深可穿）；不穿或以小胜2球内=M-03深盘失真继续成立' },
  { id: 'vb-146', matchId: '2041387', num: '周五002', league: '沙职', home: '哈马费萨', away: '吉达联合', matchTime: '23:45:00', kickoff: '2026-09-11T23:45:00+08:00', pick: '主负 @1.45', odds: '1.45', confidence: 3,
    myView: '40分候选档，M5 CRS比分池触发（1.45大热），无欧赔EV不可证',
    analysis: '近开4.6h窗内但值维无欧赔。M5 CRS独立娱乐池：大热场博高赔比分（≥8.0）。虚拟验证大热方向+CRS池。',
    reviewHook: '吉达联合客胜=大热方向稳；冷门/平=沙职大热陷阱（次级低赔主场风险）' },
  { id: 'vb-147', matchId: '2041388', num: '周五003', league: '德乙', home: '纽伦堡', away: '汉诺威96', matchTime: '00:30:00', kickoff: '2026-09-12T00:30:00+08:00', pick: '主胜 @2.35', odds: '2.35', confidence: 2,
    myView: '39分弃投·平局（R_draw≥0.7），欧EV-14.9%——双闸弃投',
    analysis: '德乙2.35主胜+平局结构险高。v1.8过滤器判弃投。',
    reviewHook: '平=过滤器正确；汉诺威分胜负=德乙方向信号被误杀' },
  { id: 'vb-148', matchId: '2041393', num: '周五008', league: '意甲', home: '威尼斯', away: '佛罗伦萨', matchTime: '02:45:00', kickoff: '2026-09-12T02:45:00+08:00', pick: '主负 @2.22', odds: '2.22', confidence: 2,
    myView: '39分弃投·平局，欧EV-6.1%接近中性——弃投是否过度',
    analysis: '意甲客胜2.22，EV-6%在半档窗口线附近。R9弃投理由是平局结构（平赔集中3.40）。',
    reviewHook: '佛罗伦萨客胜分胜负=弃投过度（EV接近中性的场不该一刀切平局）；平=过滤器对' },
  { id: 'vb-149', matchId: '2041392', num: '周五007', league: '德甲', home: '柏林联合', away: '沙尔克04', matchTime: '02:30:00', kickoff: '2026-09-12T02:30:00+08:00', pick: '主负 @2.72', odds: '2.72', confidence: 2,
    myView: '38分弃投·平局，德甲2.72客胜+平局结构',
    analysis: '高赔客胜但R_draw≥0.7。德甲柏林联合主场vs沙尔克（STRONG双方冲突risk-6）。',
    reviewHook: '客胜命中=2.72高赔错杀；平/主胜=过滤器对（德甲平手盘温床）' },
  { id: 'vb-150', matchId: '2041394', num: '周五009', league: '法甲', home: '雷恩', away: '马赛', matchTime: '02:45:00', kickoff: '2026-09-12T02:45:00+08:00', pick: '主胜 @1.82', odds: '1.82', confidence: 2,
    myView: '36分弱档，静盘+未命中模型，欧EV-9.9%——弱档验证能否假突',
    analysis: '静盘无降水信号，仅HAD低赔侧主胜。弱档不投真钱。',
    reviewHook: '主胜命中=弱档漏抓（马赛客场虫？）；不胜=弱档正确放弃' },
  { id: 'vb-151', matchId: '2041397', num: '周五012', league: '巴甲', home: '科里蒂巴', away: '巴竞技', matchTime: '08:00:00', kickoff: '2026-09-12T08:00:00+08:00', pick: '主负 @2.20', odds: '2.20', confidence: 2,
    myView: '32分弃投·平局，巴甲自然年轮次认知+R9平局结构',
    analysis: '巴甲科里蒂巴主场（自然年赛道，非跨年）。客胜2.20但R_draw判弃投。',
    reviewHook: '巴竞技客胜=方向对但低分弃投合理？；平=平局过滤器对（巴甲常年平局高）' },
  { id: 'vb-152', matchId: '2041391', num: '周五006', league: '荷乙', home: '马斯特里', away: '阿尔梅勒', matchTime: '02:00:00', kickoff: '2026-09-12T02:00:00+08:00', pick: '主负 @1.98', odds: '1.98', confidence: 1,
    myView: '31分弱·平局，静盘欧EV-13.3%——最低分档验证',
    analysis: '荷乙弱档·平局，静盘无信号。',
    reviewHook: '客胜=低档方向狗屎运；非客胜=弱档正确（31分不值得分析）' },
];

(async () => {
  for (const b of bets) {
    await upsertVirtual({
      id: b.id, matchId: b.matchId, matchNum: b.num, league: b.league,
      home: b.home, away: b.away, matchTime: b.matchTime, kickoff: b.kickoff,
      confidence: b.confidence, myView: b.myView, analysis: b.analysis,
      pick: b.pick, odds: b.odds, reviewHook: b.reviewHook,
      status: 'open', placedAt: now, settledAt: null, result: null,
    });
    const json = {
      id: parseInt(b.id.slice(3), 10), date: '2026-09-11', matchNum: b.num, league: b.league,
      home: b.home, away: b.away, matchTime: b.matchTime, matchId: b.matchId,
      kickoff: b.kickoff, confidence: b.confidence, myView: b.myView, analysis: b.analysis,
      pick: b.pick, odds: b.odds, reviewHook: b.reviewHook,
      status: 'open', result: null, placedAt: now,
    };
    fs.writeFileSync(path.join(ROOT, `${b.id}.json`), JSON.stringify(json, null, 2), 'utf8');
    console.log('虚拟注', b.id, b.home + '-' + b.away, b.pick, '已写（PG+JSON）');
  }
  await pool().end();
})().catch(e => { console.error('虚拟注写入失败:', e); process.exit(1); });