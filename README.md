# Odds-Lab（盘口与赔率实验室）

以**欧亚盘口（亚盘让球 / 欧赔 1X2 / 大小球）、多源水位定价偏差与可验证量化模型**为核心的数据采集、盘口分析与实验验证平台。

> **项目定位**：本项目并非“竞彩投注助手”。核心研究对象是欧亚盘口定价、隐含概率去水、盘口水位异动与样本外（OOS）统计验证；中国竞彩网（`sporttery.cn`）仅作为场次池与参考水位源之一，与开云体育、懂球帝、澳客、Understat xG 等多源数据交叉对照。

---

## 核心能力

- **多源盘口与赛果采集**：整合欧亚盘口（开云体育 API / 懂球帝 / 澳客）、参考场次与历史赛果（竞彩网网关）、以及五大联赛 xG 数据（Understat）。
- **盘口定价与量化模型**：
  - 1X2 去水、泊松/Dixon-Coles 进球分布反推、亚盘/大小球条件公平赔率与 EV 计算（`app/tools/ev-fit.ts`、`app/tools/m04.ts`、`tools/dixon_coles.py`、`tools/ou_calc.py`、`tools/xg_quant.py`）
  - 严格隔离结算内核（`app/tools/settlement.ts`、`app/src/shared/settlement.ts`），区分三项让球盘、亚盘半/整/四分之一盘与大小球走水规则
  - 样本外（OOS）时点级验证、Brier/LogLoss 基线对比与快照时间戳审计（`app/tools/match_level_eval.ts`、`app/tools/prob_metrics.ts`、`discussion_package_v4/`）
- **实时看板与常驻服务（`app/`）**：TypeScript + PostgreSQL + WebSocket 服务端，提供盘口追踪、多维评分参考、实时比分轮询、虚拟注复盘与前端看板（详见 [`app/README.md`](app/README.md)）。
- **实验隔离与风控守卫（`data/experiment_survival_100/`）**：模拟账本（`simulation.json`）与真实账本严格隔离，默认只观察与记录；所有自动化脚本遵循 Fail-Closed 风控门禁与时间窗校验。

---

## 目录结构

```text
odds-lab/
├── app/                         # Odds-Lab v2 核心服务（TypeScript + PostgreSQL + WebSocket）
│   ├── config/                  # 数据库配置模板（db.template.json；本地 db.json 已忽略）
│   ├── public/                  # v2 前端看板（index / self-upgrade / help）
│   ├── src/
│   │   ├── server/              # HTTP/WS 服务、API 路由、扫描排程、实时轮询、DB 层
│   │   └── shared/              # 共享类型与生产结算模块
│   ├── tools/                   # 数据抓取、评分、EV/M-04、结算、快照与 OOS 评估工具
│   ├── scripts/                 # 运维与诊断脚本
│   ├── tests/                   # 结算与账本单元测试
│   ├── run-wf.vbs               # Windows 定时值守启动器（UTF-8）
│   └── watchdog.ps1             # 9000 端口精准 PID 健康看门狗
├── tools/                       # 欧亚盘口采集、开云守护/快照、模拟账本测试、Python 量化脚本
├── data/                        # 实验记录、风控配置、工作流模板、联赛资料与模型文档
│   ├── experiment_survival_100/ # 生存实验配置、快照评估报告与复盘记录
│   ├── betting/                 # 评分规则与策略记录
│   ├── diary/                   # 复盘日记与规则迭代记录
│   └── wf/                      # 开盘/关盘无人值守规格模板
├── discussion_package_v4/       # 评估可信度与 T-30 采集方案自包含评审包
├── memory/                      # 踩坑复盘与策略沉淀
├── scraper.js                   # 历史赛果与参考盘口批量抓取器
├── AGENTS.md                    # 代理会话入口与运行铁律
└── .claude/                     # 项目规范与专项操作手册（skills）
```

---

## 数据源概览

| 数据源 | 用途与定位 | 主要入口 |
|---|---|---|
| **开云体育（欧亚主盘）** | 全场独赢 / 亚盘让球 / 大小球实时盘口、T−30 快照采集 | `tools/ky_api_engine.cjs`、`tools/ky_snapshot_collector.cjs` |
| **懂球帝（magicball）** | 欧赔 / 亚盘 / 大小球初盘与即时水位对照 | `app/tools/fetch-europe-odds.ts` |
| **澳客（okooo）** | 百家欧赔 / 亚盘对比与比分补全 | `tools/okooo_scraper.js`、`tools/fetch_okooo_live.js` |
| **中国竞彩网（sporttery）** | 场次池筛选、参考水位、历史赛果（2016 至今） | `scraper.js`、`app/tools/fetch-today.ts`、`app/tools/fetch-results.ts` |
| **Understat** | 五大联赛 xG / npxG 球队进攻防守数据 | `tools/fetch_xg.py`、`tools/xg_quant.py` |

---

## 快速开始

### 1. 环境要求
- Node.js `>= 20`（运行 `app/` 下的 TypeScript 工具与服务）
- PostgreSQL `>= 14`（服务数据库，配置见 `app/config/db.template.json` 或环境变量 `JC_DB_*`）
- Python `>= 3.10`（可选，用于 `tools/dixon_coles.py`、`tools/ou_calc.py`、`tools/xg_quant.py`）

### 2. 配置与启动 v2 服务
```bash
# 1) 复制数据库配置模板并填入本地凭据（db.json 已加入 .gitignore，严禁提交）
cp app/config/db.template.json app/config/db.json

# 2) 安装依赖并执行幂等建表
cd app
npm install
npm run migrate

# 3) 启动服务（默认仅监听 127.0.0.1:9000）
npm start
```
> 建议设置环境变量 `JC_API_TOKEN` 为写接口与触发器启用 Bearer Token 鉴权。Windows 生产环境由任务计划 `JC9000` 托管，详见 [`app/README.md`](app/README.md)。

### 3. 常用验证与测试
```bash
# 模拟账本、风控隔离与统计口径测试（21 组）
node tools/sim_test.cjs

# 定价、跨源对齐、五门禁与 CLV 审计全链路测试（8 组）
node tools/pipeline_test.cjs

# 足球“市场先验 + Dixon-Coles 残差”模型自检与周度 CLV 审计
python3 tools/train_residual_model.py --self-test
node tools/weekly_audit.cjs

# 扫盘计划与时间窗测试
node tools/sweep_test.cjs

# TypeScript 类型检查与单元测试（在 app/ 目录）
cd app && npm run typecheck && npm run test:unit

# Python 大小球与 Dixon-Coles 精算示例
python3 tools/ou_calc.py --odds 1.90 3.40 4.10
```

### 4. 参考数据批量抓取（`scraper.js`）
```bash
node scraper.js all              # 赔率 + 近30天历史 + 联赛 + 比分直播
node scraper.js odds             # 即时参考赔率快照（UTC 时间戳）
node scraper.js history 2024-01-01
node scraper.js live             # 实时比分
```

---

## 安全与风控红线

1. **凭据与账本绝不入库**：`app/config/db.json`、`*credentials*.json`、`ledger*` 均已在 `.gitignore` 屏蔽。
2. **默认仅本机回环访问**：服务端默认绑定 `127.0.0.1:9000`，写接口内置 Origin CSRF 防护与可选 `JC_API_TOKEN` 鉴权。
3. **自动流程只观察不下单**：所有定时刷新、扫盘、守护进程默认只读采集与记录；真实下单脚本（`tools/ky_bet_live.cjs` / `tools/ky_api_bet.cjs`）默认锁定，必须显式传入 `ALLOW_LIVE_BET=YES_I_CONFIRM` 且通过 Fail-Closed 账本风控校验。
4. **先验证后上线**：任何预测模型必须通过严格样本外（OOS）与市场基线对比验证，未通过验证的模型（如当前篮球模型）信号门保持硬关闭。

> 完整建模范式、每日循环采集计划与执行层/分析层 SOP 详见 [`docs/ARCHITECTURE_AND_OPS.md`](docs/ARCHITECTURE_AND_OPS.md)。
