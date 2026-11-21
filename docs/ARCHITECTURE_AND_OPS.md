# Odds-Lab 量化建模、数据采集与日常循环执行规范

## 1. 核心建模范式：市场先验 + 残差增量

- **不从零猜比分**：仅用历史场均进球/得分预测胜负无法打赢已吸收公开信息的亚盘盘口（篮球 2,190 场 v1/v2 验证 Brier 0.2723 / 0.2800 均劣于市场基线 0.2498）。
- **市场先验 + 残差融合**：以低水 Sharp 市场（Pinnacle / 懂球帝欧赔）**幂函数去水概率** `p_mkt` 为先验锚点，用带 L2 正则的逻辑回归叠加统计底座（时间衰减 Dixon-Coles `p_stat`）与增量特征（`ΔxG`、`Δline` 盘口异动、首发伤停、赛程疲劳）：
  ```text
  logit(p_hat) = w0 * logit(p_mkt) + w1 * (logit(p_stat) - logit(p_mkt)) + w2 * delta_line + w3 * fatigue + b
  ```
- **Fail-Closed 样本外准入**：`tools/train_residual_model.py` 仅在严格 Walk-Forward 样本外验证满足 **`n >= 300` 且按日 Block Bootstrap Brier 差 95% CI 上界 `< 0`** 时才写入 `verified: true`；否则一律 `verified: false`，`ky_signal_gate.cjs` 保持硬关闭。

## 2. 精确去水、EV 与 CLV 算法（SSOT）

统一实现见 `app/src/shared/pricing.ts` 与 `tools/pricing.cjs`：

- **三项盘去水**：幂函数去水（Power Method），求 `k > 0` 使 `Σ(1/O_i)^k = 1`，消除冷门高抽水造成的虚假 +EV。
- **1X2 / 竞彩 HHAD（三项盘）**：`EV = p_model * O_exec - 1`（让平算全输，非走水）。
- **亚盘整盘 / 整数大小球**：拆三态 `(pWin, pPush, pLose)`，`EV = pWin * (O_exec - 1) - pLose`。
- **亚盘四分之一盘（±0.25 / ±0.75）**：50/50 精确拆盘 `EV = 0.5 * EV(line - 0.25) + 0.5 * EV(line + 0.25)`。
- **注码管理**：1/4 凯利 `f = min(0.10, 0.25 * EV / (O_exec - 1))`，且设最小 EV 安全垫 `EV > +2.5%`。
- **CLV（收盘价价值）**：`CLV = closingFairProb * execOdds - 1`（用 `T−2m` 收盘价去水概率验证 `T−30` 下单水位是否长期占优）。

## 3. 跨源对齐与快照采集规范

- **统一映射**：`tools/match_crosswalk.cjs` 与 PostgreSQL `match_crosswalk` 表，强制 `|kickoffDiff| <= 30min` + 统一别名 + 拒绝 U19/U21/女足跨梯队误配 + 拒绝多候选歧义。
- **双窗口采集**：`tools/ky_snapshot_collector.cjs` 同时采集 `[T−35, T−30]` 主窗口（`mainOk`，只留窗口内首条有效记录）与 `[T−4, T−1]` 收盘窗口（`closingOk`，用于 CLV 核算），所有快照带 `v2-envelope` UTC 元数据与 `sha256`。

## 4. 每日循环工作计划（北京时间 +08:00）

| 时间 | 责任层 | 核心动作 |
|---|---|---|
| **09:00** | 执行层（`KYDaemon`） | 全量早间扫盘（一/二/三级足球），生成当日临场计划，写 `sweepDone` 防重复 |
| **09:33** | 执行层（`JCCloseY0933`） | 补结昨日凌晨场官方 Payout 赛果，三源对账（订单 + 未结数 + 余额） |
| **10:00** | 执行层（增量脚本） | 更新 Understat xG 与赛程间隔数据（带 `as_of_date`） |
| **13:05** | 执行层（`app` 服务） | 竞彩参考池开盘同步 + 懂球帝欧亚水位 + `match_crosswalk` 对齐 |
| **T−50m** | 执行层 + 分析层 | 抓首发/伤停情报（NBA 在 T−90m/T−30m，未接通前不开实单） |
| **T−35~T−30** | 分析层 → 执行层 | 主窗口采样 → 模型算精确 EV → 五门禁 → +30s 滑点确认 → 发 `SIGNAL` 待人工确认 / 落虚拟注 |
| **T−2m** | 执行层（`ky_snapshot_collector`） | 采集收盘参考价（`closingOk`），配对计算 CLV |
| **23:07 / 周日** | 分析层（`JCClose2307`） | 每日写复盘日记；每周日运行 `node tools/weekly_audit.cjs` 与 `python3 tools/train_residual_model.py` 滚动审计 |

## 5. 执行层 vs 分析层职责隔离

- **执行层（机械、无思考）**：负责准点采样、UTC 信封落盘、+30s 滑点确认、Fail-Closed 账本风控锁（`ALLOW_LIVE_BET=YES_I_CONFIRM`、`acceptOdds=1`）与三源对账。
- **分析层（建模、无资金权）**：负责零泄漏特征构造、残差概率预测、精确 EV 与 1/4 凯利计算、全量虚拟注记录、CLV 归因与周度 Walk-Forward 重训。
