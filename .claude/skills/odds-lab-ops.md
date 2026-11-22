---
name: odds-lab-ops
description: Odds-Lab（Yoshiki321/odds-lab）本地 Agent 全流程操作手册 — 自动同步 GitHub 最新代码、安装验证、平滑发版与打包、每日循环采集、残差模型评估、五门禁信号判定与风控下注执行。任何时候收到「下载项目」「同步发版」「执行每日循环」「扫盘/评估/下注」都直接按本 skill 执行。
---

# Odds-Lab 本地 Agent 全流程操作手册（odds-lab-ops）

> 本文件是本地 Agent（OpenCode / Claude Code）接管 `Yoshiki321/odds-lab` 的唯一总入口。执行前先完整通读本文件与 `docs/ARCHITECTURE_AND_OPS.md`。

---

## 一、核心文件地图（知道该用什么文件）

| 职责域 | 核心文件 | 用途说明 |
|---|---|---|
| **架构与 SOP** | `docs/ARCHITECTURE_AND_OPS.md` | 建模范式、去水/EV 公式、每日循环时间表、执行层/分析层分工 |
| **免费数据源手册** | `.claude/skills/free-data-sources.md`、`tools/fetch_football_data.py`、`tools/fetch_espn_intel.py` | 经实测免费免 Key 源（Football-Data 11 联赛尖盘/xG、ESPN 足球首发/NBA 伤停）及训练联动 |
| **v2 常驻服务** | `app/src/server/app.ts`、`api.ts`、`ops.ts` | `127.0.0.1:9000` HTTP/WS 看板与研判接口（Windows 任务计划 `JC9000` 托管） |
| **数据库结构** | `app/src/server/db/schema.sql` | 含 `matches`/`scores`/`results`/`match_crosswalk`/`model_predictions` 等表 |
| **定价与精确 EV** | `app/src/shared/pricing.ts`、`tools/pricing.cjs` | Power 去水、整盘/四分之一盘精确 EV、1/4 凯利、CLV 收盘价价值 |
| **跨源赛事对齐** | `tools/match_crosswalk.cjs` | 竞彩 / 开云 / 懂球帝 / 澳客唯一映射（≤30min、拒梯队误配、拒歧义） |
| **开云采集与守护** | `tools/ky_daemon.cjs`、`tools/ky_api_engine.cjs`、`tools/ky_snapshot_collector.cjs` | 09:00 扫盘、`[T−35, T−30]` 主窗口、`[T−4, T−1]` 收盘价(CLV)采集 |
| **信号五门禁** | `tools/ky_signal_gate.cjs` | 校验 OOS 模型、非封盘、精确净 EV > +2.5%、`+30s` 滑点、时间窗与盘口一致 |
| **风控下单执行** | `tools/ky_bet_live.cjs`、`tools/ky_api_bet.cjs` | Fail-Closed 账本风控四算、单次提交、`acceptOdds=1`，需显式开启 `ALLOW_LIVE_BET` |
| **模型训练与审计** | `tools/train_residual_model.py`、`tools/weekly_audit.cjs` | 市场先验 + Dixon-Coles 残差训练、Walk-Forward 样本外验证、周度 CLV 报告 |
| **自动化测试** | `tools/sim_test.cjs`、`tools/sweep_test.cjs`、`tools/pipeline_test.cjs` | 隔离风控(21 组) + 扫盘(14 组) + 定价/对齐/门禁/CLV 全链路(8 组) |
| **Windows 运维** | `app/watchdog.ps1`、`app/run-wf.vbs` | 9000 端口精准 PID 看门狗；UTF-8 定时值守启动器 |

---

## 二、自动拉取最新代码、验证与发版

1. **保护本地隐私与账本文件（严禁覆盖或提交）**：
   - `app/config/db.json`
   - `data/experiment_survival_100/ledger*.json`
   - `data/experiment_survival_100/runtime/api_credentials.json`
2. **拉取最新 `main`**：
   - 如尚未克隆：`git clone https://github.com/Yoshiki321/odds-lab.git`
   - 如已存在：先 `git status`（若本地有新改动，切新分支推送给 GitHub 维护侧合并，绝不强改 `main`），再执行：
     ```bash
     git fetch --all --prune
     git checkout main
     git pull --ff-only origin main
     ```
   - 若 `app/config/db.json` 缺失，按 `app/config/db.template.json` 提示补齐（或确认 `JC_DB_*` 环境变量就绪）。
3. **依赖安装与全套验证（任一失败立即停止）**：
   ```bash
   cd app && npm install && npm run migrate && npm run typecheck && npm run test:unit
   cd ..
   node tools/sim_test.cjs
   node tools/sweep_test.cjs
   node tools/pipeline_test.cjs
   python3 tools/train_residual_model.py --self-test
   ```
4. **平滑重启服务（Windows 规范）**：
   - **严禁**直接用 shell 跑 `npx tsx src/server/app.ts`；**严禁**全局杀 `node.exe`（会误杀 `KYDaemon`）。
   - 先 `Stop-ScheduledTask -TaskName 'JC9000'`，若 9000 端口仍有残留 PID 则仅精准 `Stop-Process -Id <PID> -Force`，再 `Start-ScheduledTask -TaskName 'JC9000'`。
   - 检查 `http://127.0.0.1:9000/api/health` 返回 HTTP 200 且 `ok: true`，确认 `KYDaemon` / `KYWatchdog` 正常。
5. **按需打发版包**：
   - `git archive --format=zip --output=releases/odds-lab-<版本号>.zip HEAD`
   - 核验 zip 不含任何 `db.json` / `ledger*` / `*credentials*` / `node_modules`，输出 SHA-256。

---

## 三、每日循环采集、分析与下注执行流程

严格按 `docs/ARCHITECTURE_AND_OPS.md` 的北京时间节点运转，**执行层与分析层严格隔离**：

- **09:00**：`KYDaemon` 触发 `tools/ky_api_engine.cjs` 全量扫盘（一/二/三级足球），生成当日计划并写 `sweepDone`。
- **09:33**：补结昨日凌晨场官方 Payout 赛果，执行三源对账（订单列表 + 未结数 + 余额）。
- **10:00**：运行 `python3 tools/fetch_football_data.py --season 2627 --all`、`--fixtures` 及 Understat xG 更新（带 `as_of_date`）。
- **13:05**：`app` 服务同步参考场次池、懂球帝欧亚水位与 `match_crosswalk` 对齐。
- **T−50m**：运行 `python3 tools/fetch_espn_intel.py --sport soccer --league <code >` 采集足球首发/伤停（NBA 运行 `--sport nba`，未通过 OOS 验证前篮球信号门保持关闭）。
- **T−35m ~ T−30m（主决策窗）**：
  1. `tools/ky_snapshot_collector.cjs` 采集执行盘口（1X2 / 亚盘 / 大小球），按 `reqEndUtc` 取窗口内首条有效记录。
  2. 调用 `tools/ky_signal_gate.cjs` 执行五门禁核验（OOS `verified=true` + 非封盘 + 精确净 EV > `+2.5%` + `+30s` 滑点保守价 + 时间窗 + 盘口线一致）。
  3. **下注与风控红线**：
     - 若模型尚未通过 `n >= 300` 样本外验证（`verified != true`）或任一门禁未过：**只落虚拟注**（`simulation.json` / `POST /api/virtual`），绝不下真单。
     - 仅当五门禁全过、且用户已明确授权自动执行（环境变量 `ALLOW_LIVE_BET=YES_I_CONFIRM`）与 `risk_config.json` Fail-Closed 风控四算全通过时，方可调用 `tools/ky_bet_live.cjs` 单次下单（`acceptOdds=1`，提交后立即停止并汇报回执，绝不重试）。
- **T−2m**：`ky_snapshot_collector.cjs` 采集收盘参考价（`closingOk`），配对计算 CLV。
- **23:07 / 每周日**：每日写复盘日记；每周日跑 `node tools/weekly_audit.cjs` 与 `python3 tools/train_residual_model.py` 做滚动样本外验证。

---

## 四、每次执行完毕的汇报格式

简洁输出以下 5 项：
1. **代码版本**：最新 `main` Commit SHA 与变更摘要
2. **测试结果**：`sim_test`、`sweep_test`、`pipeline_test`、`train_residual_model --self-test`、`typecheck` 状态
3. **服务与采集**：`127.0.0.1:9000/api/health`、`KYDaemon` / `KYWatchdog` 状态及已积累 T−30/收盘配对样本数
4. **今日信号与注单**：实单（如有）+ 虚拟单逐笔列表 + 资金/风控余量
5. **待人工处理项**：如需要补配 `db.json`、重新登录捕获凭据或人工确认高分信号
