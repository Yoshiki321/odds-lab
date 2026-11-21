# 竞彩助手 v2（TS + Python + PostgreSQL）

v1（Node CJS + JSON 文件）→ v2 架构迁移。**一切数据落 PG（数据库 `jc_assistant`），评分只读 PG，前端只读 HTTP/WS。**

## 架构

```
public/ (index/self-upgrade/help 三页，前端零改动)
  │  HTTP /api/* + WS /ws
app/src/server/
  ├─ app.ts          入口：migrate → http → WS hub → scheduler → watcher
  ├─ api.ts          REST 路由（day/days/summary/mistakes/diary/live/status）
  ├─ ws/hub.ts       WS 房间广播（day:日期 / summary / status）
  ├─ ws/watcher.ts   change_log 哨兵轮询 → hub 推送（需求1：前端零刷新实时变）
  ├─ scheduler/
  │   ├─ planner.ts  扫描排程（需求2）：13:00 预扫 → 20:00 首扫 → 各 kickoff-30min 临场
  │   └─ worker.ts   每 60s 跑到点计划
  ├─ llm/
  │   ├─ prompt.ts   分析 prompt（预写，只换实时水位）
  │   ├─ adapter.ts  LLM API 适配（配置 key 后启用）
  │   └─ analyzer.ts LLM 未配置 → 自动回落本地引擎评分（当前生效路径）
  └─ db/
      ├─ pool.ts      PG 连接池 + migrate
      ├─ schema.sql   9 表（matches/scores/results/live/bets/virtual/bankroll/scan_plans/docs…）
      ├─ store.ts     数据访问 + buildDayView/buildSummary（旧 server.js 同构视图）
      └─ store-scan.ts scan_plans 读写
app/tools/            生产工具（对齐原 tools/*.js）
  ├─ refresh.ts       抓当日盘 → PG → 评分 → 赛果 → 排程 → source_status（主刷新入口）
  ├─ fetch-today.ts   sporttery getMatchCalculatorV1 → upsert matches（COALESCE 首见盘定格）
  ├─ score.ts         评分引擎 v1.6（DROP 表/深盘退回/下盘保护化/M1-M5 命中）
  ├─ fetch-results.ts getUniformMatchResultV1 → results（幂等，未终场不写）
  ├─ fetch-live.ts    sporttery 比分直播 + okooo 缓存合并 → live_scores
  ├─ settle.ts        真注（亚盘365/HAD/HHAD）+ 虚拟注结算（幂等）
  └─ ingest_legacy.ts 首次迁移 data/ JSON → PG
app/scripts/          运维诊断
  ├─ inspect.ts       当日评分/视图/信息源状态
  ├─ scan-now.ts      手动触发某天扫描计划
  ├─ ws-test.ts       WS 端到端（订阅→写哨兵→收推送）
  ├─ engine-check.ts  评分引擎关键规则断言（13 项）
  └─ db-test.ts       PG 连接诊断（不打印密码）
```

## 配置

- `app/config/db.json`：PG 连接（host/user/password/database）。模板见 `db.template.json`。
- 数据全部在 PG；`data/` 目录仅 okooo 比分缓存 + 旧 JSON 备份读入用。

## 常用命令（cd app）

| 命令 | 作用 |
|------|------|
| `npm run migrate` | 幂等建表 |
| `npx tsx tools/refresh.ts` | 主刷新：抓盘+评分+赛果+排程（口令「更新」对应此） |
| `npx tsx tools/settle.ts` | 结算真注+虚拟注（13:03/23:07 用） |
| `npx tsx tools/fetch-live.ts` | 比分直播刷新 |
| `npx tsx scripts/inspect.ts [date]` | 看当日评分/视图 |
| `npx tsx scripts/scan-now.ts [date]` | 手动触发扫描计划 |
| `npx tsx scripts/engine-check.ts` | 引擎规则断言 |
| `npx tsx scripts/ws-test.ts [date] [port]` | WS 端到端测试 |
| `npm run switch` | **一键切换**：ingest → 停旧 9000 → 起 v2 9000 → 验证 |

## 启动

```bash
cd app
PORT=9001 npx tsx src/server/app.ts     # 临时验证（避开旧 9000）
npm run switch                           # 正式切换：停旧起新，9000 变 v2
```

启动后：http://localhost:9000/（v2），WS `ws://localhost:9000/ws`。

## 定时任务（CronCreate durable，.claude/scheduled_tasks.json）

| 触发 | 任务 | 动作 |
|------|------|------|
| 每日 13:03 | e78bfb7d | 开盘：refresh → 结算前日 → 模型扫描 → 可买早场 |
| 每日 23:07 | adf0d8ba | 关盘：refresh → 结算 → 复盘 → 台账日记 |
| 13:33–22:33 每小时 | 265f3a9d | 只 refresh（不结算不下单） |

> 7 天过期，会话重启后先 `CronList` 核对重建。

## 验证清单（本次已跑通）

- [x] migrate OK，PG 连接（hr backend 凭据）
- [x] refresh 全链路：8 场 → 评分 → 赛果 → scan 计划（9 条）
- [x] 调度执行：7 计划 7 轮，引擎 fallback 全分析
- [x] 引擎断言 13/13（降水/DROP/退回/保护化/M1/首盘）
- [x] HTTP API 全端点 + 旧前端同构视图
- [x] WS 端到端（订阅→哨兵→推送）
- [x] 比分直播（100 场/29 封盘/okooo 16 合并）
- [x] ingest 全量导入（4 天 55 场/71 分/38 虚拟注/1 实单）
- [x] 结算链路（虚拟注 5 张已结）
- [x] typecheck 0 错误
- [x] `npm run switch` 一键切换：旧 server.js 停，v2 独占 9000（单实例，9001 已回收）
- [x] planDay 修复：全量轮（开盘/首次）kickoff 存 NULL，临场批次存真实 ISO（原先 '全天' 字面量撞 timestamptz）
- [x] 比赛日规则：`salesDateOf(num, kickoff)` 由编号前缀推导销售日，跨午夜场归前一天（周日001~024 整组归周日）；`repair-match-date.ts` 已归位存量 55 场并同步 scores
- [x] 实时比分自动链路：server 内置 `live-poller.ts` 每 60s 抓 sporttery → live_scores（需求1「server 周期更新 live」）；refresh.ts 顺带补一次
