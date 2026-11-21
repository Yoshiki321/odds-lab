# 讨论包 v3（2026-11-19，按评审意见修订）

> 本版针对评审提出的 4 项：测试路径、结算输入校验、配对基线比较、247 口径更正。

## 直接运行（解压后在本目录执行，无需编译）

```
node src/ev-fit.test.ts        # 期望 PASS 9,  FAIL 0
node src/settlement.test.ts    # 期望 PASS 41, FAIL 0
node src/prob_metrics.ts       # 自检：配对比较 / 小样本 insufficient / 重复键拒绝
node src/audit247_review.ts    # 247 分组 + 可复现性判定（数据在 data/audit/）
```

以上四条命令**不需要移动文件**（本版把算法与测试放在同一 `src/`，审计数据随包附带）。

## 目录

```
src/
  ev-fit.ts            去水基线 → λ 拟合 → Skellam 让球概率 + 走水（已修精化/校验/安全失败）
  settlement.ts        结算纯函数（含运行时校验，非法输入返回 uncomputable）
  prob_metrics.ts      Brier / LogLoss / 校准分箱 / Wilson / 配对基线比较
  audit247_review.ts   247 复核（可移植路径）
  ev-fit.test.ts       9 项
  settlement.test.ts   41 项（正常 + 非法输入 + 性质）
  ky_bet_live.cjs      下单（强制预期赔率/线位 + 四项风控）
  ky_recon.cjs         对账（订单号主键 + 三源交叉 + 余额快照）
  ky_api_engine.cjs    全量扫盘 + 单场盘口
docs/
  ALGORITHMS.md        算法清单（术语：去水基线概率 / 模型估计EV）
  MODEL_SEPARATION.md  五种玩法分别建模
  AUDIT_247_REVIEW.md  247 复核（含更正说明）
  score.ts             六维评分（供参考，未纳入测试）
data/audit/audit-2026-09-20.json   247 聚合数据（无逐场明细）
```

## 本版修复（对应评审意见）

1. **测试路径**：算法与测试同目录，README 命令在全新解压目录可直接跑。
2. **结算输入校验**：
   - 盘口必须是 0.25 的整数倍且 |line|≤10；`-0.3`、`0.1`、`11` 一律 `uncomputable`
   - 比分必须非负整数；`NaN`、负数、小数 → `uncomputable`
   - 赔率必须有限且 ∈(1,1000)；`NaN`、`≤1`、`Infinity` → `uncomputable`
   - 方向非法、竞彩让球非整数线 → `uncomputable`
   - 不可计算时 `pnlPerUnit = null` 并给出 `reason`
3. **配对基线比较**：
   - 输入改为 `{matchId, predictAt, market, outcome, pModel, pBaseline}`
   - 按 `(matchId, predictAt, market)` 去重；重复/缺字段 → 拒绝比较
   - 计算配对 Brier 差值的均值与 95%CI；CI 全负才判 better，跨 0 判 inconclusive
   - 不再用固定 0.005 当显著性；输出注明未做多重比较校正与相关性调整
4. **247 口径更正**：
   - 保留 n=9 与描述性结果
   - ROI 区间标注为"平均赔率近似，仅粗略提示，不可当统计区间"
   - 明确"数量合计=247 只能证明计数一致，不能证明互斥"
   - 逐场缺失 → 回测无法复现；时间切分**不得推断**

## 仍未解决
- 独立泊松假设、1x2 反推 λ 的识别性（需同场大小球/比分信息并做样本外）
- quarter 概率未接入门控（结算已实现并测试）
- 开云侧无训练数据，配对比较函数就绪但无样本
- 247 无逐场明细，无法真正复现
