# 数据与独立模型报告（2026-11-19）

> 只涉及数据、算法、测试。未触碰账本、订单、账户，未下注。

## 1. 数据源与实际可用范围

| 数据 | 位置 | 字段 | 时间字段含义 | 覆盖 | 可用性 |
|---|---|---|---|---|---|
| 历史赛果 | `data/history/football/*.json`（252 天） | matchId、联赛、主客队+ID、`h/d/a`、goalLine、`sectionsNo999`、winFlag、poolStatus | 只有 `matchDate`（日期，**无开赛时刻**）；`h/d/a` 是**终盘/事后**赔率，无采集时刻 | 2026 全年 | 可做**训练特征与赛果**；**不可**作为某时点的赛前基线 |
| 赔率快照 | `data/odds/football_all_<日期>-<时分秒>.json`（26 个可用） | MATCH 级 `matchDate`+`matchTime`（开赛）、`had/hhad/crs` 含 `updateDate/updateTime` | 文件名时间=采集时刻（cross-check 用文件 mtime）；赔率自带 updateTime | 2026-08-23 ~ 08-29，594 场次 | **唯一可用于赛前时点比较的源** |
| 赛后结果 | 同上 history | 比分、winFlag、poolStatus | 事后 | 同上 | 与预测记录分开存放（数据集里只带 score 字符串，不参与特征） |

**发现的陷阱**：有快照文件的文件名时间是 16:54，而其中 `had.updateTime` 是 19:34 —— 说明"文件里的赔率"晚于"采集时刻"。因此：
`predictMs = max(文件 mtime, 该场赔率的 updateTime)`，并强制 `predictMs < kickoff`；保留的 927 行中，晚于采集时刻的赔率行数为 **0**（已按此规则剔除）。

**数据授权/限制**：均来自项目既有抓取落盘（竞彩官方网关 + 本地快照），未新增外部数据源；不含个人数据。

## 2. 新增/修改文件

| 文件 | 说明 |
|---|---|
| `app/tools/dataset_build.ts` | 构建防泄漏数据集（含 rowKey / isLeakFree / impliedProbs） |
| `app/tools/dataset.test.ts` | 10 项防泄漏与配对键测试 |
| `app/tools/oos_eval.ts` | 时间样本外评估（walk-forward 泊松 vs 市场基线） |
| `app/tools/prob_metrics.ts` | 增加 `validatePairs` / `brierEx` / `logLossEx`（区分 empty 与 invalid）；配对键加入 line |
| `app/tools/ev-fit.ts` | 精化类型标注（TS7022 修复） |
| `app/tools/m04.ts` / `score.ts` | 导入改 `.ts`，配合 tsconfig 开关 |
| `app/tsconfig.json` | 增加 `allowImportingTsExtensions: true`（noEmit 已为 true） |
| `data/experiment_survival_100/dataset/rows.jsonl` | 927 行数据集 |
| `data/experiment_survival_100/dataset/stats.json` | 数据质量统计 |
| `data/experiment_survival_100/dataset/oos_report.json` | 样本外结果 |

## 3. 数据质量与防泄漏测试

```
node app/tools/dataset.test.ts   → PASS 10, FAIL 0
```

覆盖：不同盘口线不同键、同场不同方向不同键、时区等价同键、预测=开赛拒绝、预测晚于开赛拒绝、采集晚于预测拒绝、赔率晚于预测拒绝、正常赛前通过、去水合法/非法。

数据集统计：快照 26、扫描场次 594、**保留 927 行 / 68 场**；丢弃 noResult 267、noTime 18、badOdds 0、afterKickoff 0。

## 4. 模型、基线与切分

- **基线**：同一快照 `had` 三项比例去水，仅作为市场基线，不是"真实概率"。
- **独立模型**：独立泊松，`λ主 = 联赛主场均值 × 主队进攻 × 客队防守`，`λ客 = 联赛客场均值 × 客队进攻 × 主队防守`；球队攻防按场次收缩（K=5，向 1 收缩）；仅用 `matchDate < 预测日` 的历史比赛拟合（保守，避免同日信息）。
- **切分**：walk-forward —— 每场预测只用其之前的比赛拟合，不使用未来；68 场按开赛时间排序依次预测。
- 明确限制：这是"可解释的简单模型"，不是市场增强模型；未使用任何当前赔率作为特征。

## 5. 样本外结果

| 指标 | 独立模型 | 市场基线 |
|---|---|---|
| Brier（927 行） | **0.1876** | **0.1615** |
| LogLoss | **0.5574** | **0.4956** |

配对 Brier 差（模型−基线）：**+0.0261**，95%CI **[+0.0202, +0.0320]** → **劣于基线**。

**结论**：在这 68 场 / 9 天样本上，独立泊松模型显著不如市场基线。样本量小、同场 H/D/A 与同队多场相关未调整，结论只到"该模型不得用于实盘"这一层，不能反推市场无效或有效。

## 6. 原始报错与已修问题

| 报错/问题 | 处理 |
|---|---|
| 首次评估模型 Brier 0.2147（退化成联赛平均） | 数据集未存 `homeTeamId/awayTeamId`，补字段重建 → 0.1876 |
| `tsc`: TS5097 `.ts` 扩展名不允许 | 加 `allowImportingTsExtensions`（项目 `noEmit:true` 合法） |
| `tsc`: TS7022 隐式 any（ev-fit） | 显式标注 `base` 类型 |
| `tsc`: `Row` 缺 homeId/awayId；`PairedObs` 缺 line | 补字段，配对键加入 line |
| `brier([])` 与 `brier(非法)` 都返回 null，无法区分 | 新增 `validatePairs/brierEx/logLossEx`，区分 empty/invalid |

## 7. 未解决

- 样本仅 **68 场 / 9 天**，远不足以做任何有效性判断；扩采样是第一优先级。
- 数据集无半场/大小球时点数据，quarter 与大小球模型未评估。
- 同场三方向、同队多场的相关性未在区间中调整（比较函数已注明）。
- `m04.ts`/`score.ts` 的 `.ts` 导入：Node 直跑通过、`tsc --noEmit` 通过；**是否被服务端实际调用属集成问题，未验证**。

## 8. 下一步最值得做的一件事

**持续采集赛前快照（同一场在开赛前多个时点各存一次），把样本从 68 场扩到数百场、覆盖多个月份与更多联赛**，再重跑本报告的 walk-forward 评估。在样本扩起来之前，任何模型结论都不成立。
