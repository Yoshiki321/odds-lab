# predictions/ — 预测不可变快照区

- 命名:`YYYY-MM-DD_vN.json`(N 从 1 起).
- 写入后不得修改原文;改错只追加新版本保留历史(`tools/sim_ledger.cjs savePredictionSnapshot` 已做存在即拒绝覆盖).
- 每条预测必须含:`decisionId`(去重)、`dateAsiaShanghai`、`event.id`、`market`、`side`、
  `observedOdds{price, observedAt}`(模拟赔率必须带时间戳,只是观察报价≠可成交)、
  `modelName+modelVersion`、`dataSource+observedAt`、`prob+evPerUnit+uncertainty`。
- 缺失赔率/时间/赛事 ID 拒绝记为有效预测;同一 `observedAt` 同一赛事只计一次(快照复用检出)。
- 2026-11-18 现状:尚无有效预测,本目录暂无快照文件(空即真实,不补假数据)。
