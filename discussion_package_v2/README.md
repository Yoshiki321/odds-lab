# 讨论包 v2（2026-11-19 修订版）

> v1 已过期：v1 里的 `ev-fit.ts` 是修复前版本，且没有结算纯函数与 247 复核结论。请以本包为准。

## 目录

```
code/
  ev-fit.ts            # 去水基线 → 拟合 λh,λa → Skellam 让球概率 + 走水概率（已修精化/校验/安全失败）
  settlement.ts        # 结算纯函数：整数/半球/quarter、大小球、竞彩胜平负、竞彩让球
  m04.ts               # 策略门控（精品策略，非"正EV必要条件"）
  score.ts             # 六维评分（value 维用模型估计概率 × 竞彩赔率 − 1）
  prob_metrics.ts      # Brier / LogLoss / 校准分箱 / Wilson，样本<100 判 insufficient
  audit247_review.ts   # 247 场报告复核（含置信区间与可复现性判定）
  ky_bet_live.cjs      # 下单：强制预期赔率/线位 + 四项风控 + 只提交一次
  ky_recon.cjs         # 对账：订单号主键 + 三源交叉 + 余额快照
  ky_api_engine.cjs    # 全量扫盘 + 单场盘口（纯接口）
  ky_virtual_live.cjs  # 滚球虚拟单（不花钱攒样本）
tests/
  ev-fit.test.ts       # 9 项：校验/独立参考/精化不倒退/方向/非整数拒绝/push
  settlement.test.ts   # 26 项：整数/半球/quarter/大小/竞彩/边界/客让方向
docs/
  ALGORITHMS.md        # 算法清单（术语已改为"去水基线概率"/"模型估计EV"）
  MODEL_SEPARATION.md  # 五种玩法分别建模与结算公式
  AUDIT_247_REVIEW.md  # 247 场复核：EV>0 组仅 9 场，区间跨 0
  AUDIT_RULES.md       # 虚拟单 30/100 门槛
  risk_config.json     # 当前风险上限
QUESTION_LIST.md       # 11 个具体问题（请对方逐条挑错）
```

## 运行方式（Node 24 直接跑 TS，无需编译）

```
node tests/ev-fit.test.ts        # 期望 PASS 9, FAIL 0
node tests/settlement.test.ts    # 期望 PASS 26, FAIL 0
node code/audit247_review.ts     # 打印分组置信区间
node code/prob_metrics.ts        # 自检 Brier/LogLoss/Wilson
```

## 当前事实（供评审对照）

- 本地账本已重置，起点余额 72.30；平台历史订单仍在（不可撤销）。
- 此前 6 笔真实单净 −23.69，主要来自一笔 20 元湖人让分单。
- 竞彩侧有 EV 链路但**无样本外、无校准**；开云侧**无模型**。
- 247 场报告中"EV>0 组 ROI +39%"来自 **n=9**，95%CI 为 −25%~+104%，不成立。

## 已知未解决
1. 独立泊松假设与 1x2 反推 λ 的欠定性
2. quarter 拆分已在纯函数实现，但未接入实盘门控、未核实平台规则
3. 开云侧缺训练数据，`compareToBaseline` 只能返回 insufficient
4. 247 场无逐场明细，无法复现
