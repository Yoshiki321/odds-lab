# 讨论包 v4 — 评估可信度与采集方案（2026-11-19）

> 本包只讨论**数据时间可信度、统计口径、采集设计**，不讨论"模型好不好/能不能盈利"。
> 结论先行：**现有时间证据不足以做严格样本外评估**；43 场可用样本全部依赖"文件名时间"这一无独立证据的假设。

## 打包里有什么

```
src/     算法与测试（自包含，可直接跑）
  ev-fit.ts / settlement.ts / prob_metrics.ts / m04.ts
  ev-fit.test.ts / settlement.test.ts / dataset.test.ts / m04.test.ts
  dataset_build.ts / match_level_eval.ts / snapshot_inventory.ts / snapshot_classify.ts
docs/    报告
  EVAL_REVIEW_2026-11-19.md   ← 重点：时间分级、mtime +8h 证据、43 场重算、采集方案
  DATA_AND_MODEL_REPORT.md    上一版报告（含需更正的表述）
  MODEL_SEPARATION.md         五种玩法分别建模与结算
  AUDIT_247_REVIEW.md         247 场复核（n=9，不可复现）
  ALGORITHMS.md               算法清单
data/    复核产物（不是原始快照）
  snapshot_classify.json      189 场按比赛分类（43 场可用）
  snapshot_inventory.json     26 个快照文件的时间证据清单
  match_level_report.json     43 场逐场预测/基线/差值
  stats.json                  行级数据集统计
```

## 可直接运行的命令（本目录）

```
node src/ev-fit.test.ts        # PASS 9
node src/settlement.test.ts    # PASS 46
node src/dataset.test.ts       # PASS 10
node src/m04.test.ts           # PASS 9
node src/prob_metrics.ts       # 自检
```

需要项目数据目录才能跑（本包未附 3.7MB 原始快照）：
`dataset_build.ts`、`snapshot_inventory.ts`、`snapshot_classify.ts`、`match_level_eval.ts`

## 核心事实（供评审核对）

1. **26 个快照文件的 mtime 全部比文件名时间晚 28801 秒（8h00m01s）**——整批复制/解压痕迹，mtime 不可作为采集证据。
2. 594 次"快照×场次"出现 → **189 场独立比赛**；其中 strict 6、strict+doubtful 37、仅 doubtful 82、仅无赛果 58、仅无开赛 6；**可用 43 场**。
3. 231 次出现的赔率更新时间**晚于**文件名时间 → 这些内容当时不可能存在，标为 doubtful。
4. 43 场比赛级重算（每场一个预设时点：距开赛最近且 ≥30min）：

| | 模型 | 基线 |
|---|---|---|
| Brier3（三分类求和） | 0.5721 | 0.5157 |
| LogLoss | 0.9626 | 0.8808 |

配对差 +0.0564，按比赛聚类 bootstrap 95%CI **[+0.0030, +0.1165]**（下界贴近 0，未调整球队相关）。

## 请重点回答的 5 个问题

1. T−30 主时点的采样窗口设 **T−35~T−25** 是否合理？平台临场盘口变动频率下，这个窗口采到的价是否可能已不可成交？
2. 同一场在窗口内采到多条时，**取"距开赛最近"** 是否会被视为事后挑选？改成"窗口内第一条"是否更中性？
3. 训练集只有比赛日期（无开赛时刻），用 `matchDate < 预测日` 会不会误杀当日早场？有没有更稳的保守规则？
4. 43 场按比赛聚类 bootstrap 是否足够？是否应改 block bootstrap（按日期块）或层级贝叶斯？
5. 在采到 300 场前，是否值得先做"仅比分预测"的中间评估（不依赖赔率），用来验证模型本身？

## 不要讨论的
- 这个模型好不好（43 场、时间证据不足）
- 能不能盈利（无真实时点赔率与结算数据）
