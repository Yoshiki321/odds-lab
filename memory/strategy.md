# 8维分析框架 v2（数据源版）

每场投注前必须覆盖8个维度。以下为每个维度的数据源和判断标准。

## ① 赔率维度
- **数据源**：竞彩 `getMatchCalculatorV1` 当前赔率 + `getFixedBonusV1` 赔率历史
- **判断**：赔率是否合理？主胜/平/客胜的隐含概率
- **工具**：`node tools/odds_history.js <matchId>` 直接出完整数据

## ② 支持率维度（公众热度）
- **数据源**：竞彩 `getVoteV1` 支持率 vs 概率
- **判断**：公众过热（+10%以上偏热）→ 陷阱信号；公众与机构一致 → 可跟
- **关键指标**：`evalue`（误差值）+ `psyError`（心理误差异常标志）

## ③ 实力维度（官方战绩）
- **数据源**：**竞彩 `getMatchHeadV1`**（wbsjStats 赛季总战绩+主客场+排名）
- **之前**：手动翻 history 文件拼凑，效率低
- **现在**：`tools/odds_history.js` 直接输出排名+胜平负+主场客场

## ④ 让球维度（盘口信号）
- **数据源**：竞彩 HHAD（让球盘赔率）+ **懂球帝亚盘**（初盘 vs 即时盘口变化）
- **判断**：盘口升降→资金方向。济州让0.25→平手=让不起球，明确指向客队不败

## ⑤ 风险维度
- **数据源**：综合前4维 + 赔率变化次数
- **判断**：赔率稳定（不动or微调）→风险低；剧烈波动→风险高

## ⑥ 赔率变化追踪（R5核心）
- **数据源**：**竞彩 `getFixedBonusV1` 的 hadList/hhadList**
- **之前**：手动定时抓快照对比，只能看到"有变化/没变化"
- **现在**：一条API返回从开盘到现在的所有变盘记录，直接数次数
- **R5判断**：超8h场次需≥3次变动才投

## ⑦ 价值维度（竞彩 vs 欧赔）
- **数据源**：**懂球帝 magicball match_list 的 score_odds.spot**
- **判断**：竞彩赔率 vs 欧赔对比
  - 竞彩赔率低于欧赔（如竞彩2.00 vs 欧赔2.20）→ 竞彩更看好，有价值
  - 竞彩赔率高于欧赔 → 竞彩定价有"价值洼地"？
  - 竞彩vs欧赔方向不同 → 分歧信号，需谨慎

## ⑧ 体力/伤停维度
- **数据源**：近7天比赛密度（从history文件或wbsjStats推算）
- **判断**：一周双赛的球队体力劣势；刚打完杯赛的球队可能轮换

## 工具调用速查

```bash
# 查一场完整数据（赔率历史+战绩+欧赔对比）
node tools/odds_history.js <matchId>

# 查多场
node tools/odds_history.js <matchId1> <matchId2>

# 查支持率（需单独抓）
node scraper.js support <YYYY-MM-DD>

# 查最新赔率快照
node scraper.js odds
```

## 8维分析后输出格式

```json
{
  "signals": {
    "reasoning": "综合8维结果…",
    "support": { "had_h": "XX%", ... },
    "handicap": "让球盘分析…",
    "risk": "风险评估…"
  },
  "decision": {
    "pick": "方向",
    "odds": 2.03,
    "confidence": "中高",
    "note": "分析要点"
  }
}
```