/**
 * 策略A：价值猎手（Value Hunter）
 *
 * 哲学：竞彩抽水主要集中在低赔端，1.6-2.0是唯一真实正EV区间。
 * 放弃"稳胆"思维，接受中赔中等胜率是数学最优解。
 *
 * 核心规则：
 * 1. 只买热门赔率在 1.60-2.00 之间的比赛
 * 2. SPF 玩法，不碰让球盘
 * 3. 2串1，两条腿都必须在1.6-2.0区间内
 * 4. 单笔上限 = 当前现金 × 5%（固定比例，不按阶段）
 * 5. 连输2单后上限降到3%，连赢3单后回到5%
 * 6. 空仓优先：没有合适的组合就不买
 * 7. 不碰1.5赔率（44%胜率陷阱）
 * 8. 不碰让球盘（33%覆盖陷阱）
 * 9. 杯赛谨慎
 *
 * 选场加分项：
 * - 客队热门（胜率57% > 主队热门52%）
 * - 支持率与赔率隐含概率接近（不热）
 * - 变盘方向与选中方向一致
 * - 联赛比赛（vs杯赛）
 *
 * 选场减分项：
 * - 让球线≥2 → 直接放弃
 * - 赔率=1.5 → 直接放弃
 * - 同联赛、同时段的两条腿（同时爆冷风险）
 */
export const STRATEGY_A = {
  name: '价值猎手 Value Hunter',
  description: '1.6-2.0正EV区间，2串1，5%固定资金',
  maxBetPct: 0.05,
  maxBetPctAfterLoss: 0.03,
  pickRange: [1.60, 2.00],
  noHandicap: true,
  maxConsecutiveLossDrop: 2,
  maxConsecutiveWinRaise: 3,
  // 模拟选择函数
  pick: (matches, cash, consecutiveLosses, consecutiveWins) => {
    // 过滤出符合策略A条件的场次
    const candidates = matches.filter(m => {
      if (m.goalLine && Math.abs(parseFloat(m.goalLine)) >= 2) return false;
      const odds = [m.h, m.d, m.a];
      return odds.some(o => o >= 1.60 && o <= 2.00);
    });
    // 太少了就不买
    if (candidates.length < 2) return null;
    // 按变盘方向与热门方向一致性排序，选最好的两条
    const scored = candidates.map(m => {
      const minOdds = Math.min(m.h, m.d, m.a);
      const pick = m.h === minOdds ? 'H' : m.a === minOdds ? 'A' : 'D';
      let score = 0;
      if (pick === 'A') score += 1;  // 客队热门加分
      if (m.oddsDirection === pick) score += 2; // 变盘方向一致
      if (m.oddsChanges >= 3) score += 1; // 多次变盘
      return { ...m, pick, score };
    }).sort((a, b) => b.score - a.score);
    if (scored.length < 2) return null;
    return { legs: scored.slice(0, 2) };
  }
};