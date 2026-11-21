/**
 * 策略B：变盘追风者（Trend Chaser）
 *
 * 哲学：机构变盘方向是最高效的信息。持续压同一个方向说明
 * 有真实资金流入，跟随机构比独立思考更可靠。
 * 敢买中高赔博价值，不怕输光。
 *
 * 核心规则：
 * 1. 只买变盘次数≥3次且方向明确的比赛
 * 2. 跟变盘方向（oddsDirection），不反向
 * 3. 赔率范围 1.50-3.00，敢博价值
 * 4. 2串1，无让球盘限制
 * 5. 单笔上限 = 现金 × 8%（激进）
 * 6. 连输2单后降到5%，连赢2单后回到8%
 * 7. 允许单腿走让球盘（受让方向）
 * 8. 追求高赔率博取超额收益
 *
 * 选场加分项：
 * - 变盘≥5次（强信号）
 * - 变盘方向与热门方向一致（双重确认）
 * - 变盘方向与热门方向相反（分歧场，高价值）
 * - 赔率2.0-3.0（高回报）
 *
 * 选场减分项：
 * - 变盘<2次 → 放弃
 * - 变盘方向来回波动（无明确方向）→ 放弃
 * - 杯赛首回合 → 谨慎
 */
export const STRATEGY_B = {
  name: '变盘追风者 Trend Chaser',
  description: '跟变盘信号，中赔博价值，8%资金',
  maxBetPct: 0.08,
  maxBetPctAfterLoss: 0.05,
  minChanges: 3,
  pickRange: [1.50, 3.00],
  allowHandicap: true,
  consecutiveLossDrop: 2,
  consecutiveWinRaise: 2,

  pick: (matches, cash, consecutiveLosses, consecutiveWins) => {
    // 过滤有明确变盘方向的场次
    const candidates = matches.filter(m => {
      if (!m.oddsDirection) return false;
      if (m.oddsChanges < 3) return false;
      // 变盘方向对应的赔率
      const oddsForDirection = m.oddsDirection === 'H' ? m.h : m.oddsDirection === 'A' ? m.a : m.d;
      return oddsForDirection >= 1.50 && oddsForDirection <= 3.00;
    });
    if (candidates.length < 2) return null;

    const scored = candidates.map(m => {
      const pick = m.oddsDirection;
      const oddsForPick = pick === 'H' ? m.h : pick === 'A' ? m.a : m.d;
      let score = 0;
      score += Math.min(m.oddsChanges, 10) * 2; // 变盘次数多加分
      if (oddsForPick >= 2.0) score += 2; // 高赔加风险分
      if (pick === 'A') score += 1; // 客队热门加分
      // 分歧场：变盘方向与热门方向不同 → 高价值
      const minOdds = Math.min(m.h, m.d, m.a);
      const fav = m.h === minOdds ? 'H' : m.a === minOdds ? 'A' : 'D';
      if (pick !== fav) score += 3;
      return { ...m, pick, oddsForPick, score };
    }).sort((a, b) => b.score - a.score);

    if (scored.length < 2) return null;
    return { legs: scored.slice(0, 2) };
  }
};