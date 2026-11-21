# Odds-Lab v2 服务（TypeScript + PostgreSQL + WebSocket）

`app/` 是 Odds-Lab 的核心常驻服务与数据引擎。所有盘口、欧亚水位轨迹、赛果、评分快照、扫描计划与台账统一持久化至 PostgreSQL，前端看板通过 HTTP API 与 WebSocket 实时同步。

## 目录架构

```text
app/
├── public/                    # v2 前端页面（index.html / self-upgrade.html / help.html）
├── config/
│   └── db.template.json       # PostgreSQL 连接模板（复制为 db.json，严禁提交）
├── src/
│   ├── server/
│   │   ├── app.ts             # 服务入口：migrate → HTTP(127.0.0.1:9000) → WS Hub → 后台循环
│   │   ├── api.ts             # REST 路由（只读接口 + 带 CSRF/Token 校验的写/触发接口）
│   │   ├── ops.ts             # 研判层写入（虚拟注/日记/门禁体检/人工确认单）
│   │   ├── auto-refresh.ts    # 13:05 开盘兜底 + 整点刷新（共享单飞互斥锁）
│   │   ├── live-poller.ts     # 每 60s 实时比分轮询 + 每 6min 官方 Payout 赛果补拉
│   │   ├── ws/
│   │   │   ├── hub.ts         # WebSocket 多房间推送（Origin 校验 + 订阅上限）
│   │   │   └── watcher.ts     # change_log 哨兵轮询（从 MAX(id) 起跳）
│   │   ├── scheduler/
│   │   │   ├── planner.ts     # 扫描排程（13:00 预扫 → 20:00 首扫 → kickoff-30m 临场）
│   │   │   └── worker.ts      # 原子抢占 pending→running 执行器
│   │   ├── llm/               # LLM 适配层（未配置时自动回落本地评分引擎）
│   │   └── db/                # 连接池、20 表 schema.sql、store 数据访问层
│   └── shared/
│       ├── types.ts           # 前后端共享类型
│       └── settlement.ts      # 生产结算校验内核（HAD / HHAD / AH / OU）
├── tools/                     # 抓取、评分 v2.1、EV/M-04、结算、审计与 OOS 评估
├── scripts/                   # 运维诊断脚本（db-test / inspect / engine-check / ws-test）
├── tests/                     # settlement & betting 单元测试
├── run-wf.vbs                 # Windows 无人值守触发器（UTF-8）
└── watchdog.ps1               # 9000 端口精准 PID 健康看门狗
```

## 配置说明

支持两种方式配置 PostgreSQL（默认库名 `jc_assistant`，兼容已有生产库）：

1. **环境变量（推荐）**：`JC_DB_HOST`、`JC_DB_PORT`、`JC_DB_USER`、`JC_DB_PASSWORD`、`JC_DB_NAME`
2. **本地配置文件**：复制 `app/config/db.template.json` 为 `app/config/db.json` 并填写真实凭据（已加入 `.gitignore`）

可选安全与监听环境变量：
- `HOST`：默认 `127.0.0.1`（仅本机访问）
- `PORT`：默认 `9000`
- `JC_API_TOKEN`：设置后，所有 `POST`/`DELETE` 写接口与 `/api/trigger/*` 需携带 `Authorization: Bearer <token>`

## 常用命令（在 `app/` 目录下执行）

| 命令 | 作用 |
|---|---|
| `npm run migrate` | 幂等初始化/更新 PostgreSQL 表结构 |
| `npm start` | 启动常驻服务（默认 `http://127.0.0.1:9000`） |
| `npm run refresh` | 执行一次完整机械刷新（抓盘 + 欧亚水位 + 评分 + 官方赛果 + 排程） |
| `npm run typecheck` | TypeScript 类型检查（`tsc --noEmit`） |
| `npm run test:unit` | 运行结算内核单元测试（不依赖数据库） |
| `npm test` | 运行全部单元与数据库集成测试 |
| `npx tsx tools/settle.ts` | 按官方 Payout 赛果结算单关真注与虚拟注 |
| `npx tsx tools/audit.ts` | 分档校准与 EV 门禁审计 |
| `npx tsx scripts/engine-check.ts` | 评分引擎核心规则断言 |

## 核心 HTTP 接口

- **只读接口**：`GET /api/health` · `/api/summary` · `/api/days` · `/api/day/:date` · `/api/live/:date` · `/api/diary` · `/api/mistakes` · `/api/score-status` · `/api/gate?date=&num=`
- **机械触发器（POST）**：`/api/trigger/refresh?date=` · `/api/trigger/settle` · `/api/trigger/audit`
- **研判写入（POST/DELETE）**：`/api/virtual` · `/api/diary` · `/api/bet`（需 `confirmed: true` 且通过服务端五门禁）

## Windows 生产托管说明

- 常驻服务由 Windows 任务计划 `JC9000` 托管，看门狗 `watchdog.ps1` 每 30 分钟巡检 `http://127.0.0.1:9000/api/health`（连续 3 次失败才按 9000 端口 PID 精准重启，绝不误杀其他 Node 进程）。
- 定时值守任务（`JCOpen1303` / `JCClose2307` / `JCCloseY0933`）通过 `run-wf.vbs` 触发，仅调用 HTTP 接口完成机械刷新、复盘与虚拟注记录，不自动下真单。
