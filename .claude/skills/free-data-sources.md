---
name: free-data-sources
description: Odds-Lab 经实测可用的免费免 Key 数据源与专业资料站完全手册 — 涵盖每个免费源怎么抓取、返回结构是什么样、该抽取哪些字段、怎么清洗分析，以及如何接入残差模型训练与 CLV 审计闭环。凡涉及扩充数据源、拉取历史欧亚盘口、获取足球首发/NBA 伤停或喂数据给模型训练时，一律按本 skill 执行。
---

# Odds-Lab 免费免 Key 数据源与资料站操作手册（free-data-sources）

> **实测准入铁律**：本手册只收录 **2026-11-21 实测 HTTP 200、免费、无需付费 API Key、返回真实可用结构化数据** 的源。以下已实测失效/受限的源**明确淘汰，不再浪费时间接入**：
> - ~~ClubElo (`api.clubelo.com`)~~：日榜 502 Bad Gateway，Fixtures API 官方已停用（`Fixtures API deactivated`）
> - ~~FBref xG~~：2026 年 1 月起已下线高阶 xG 数据
> - ~~NBA CDN (`cdn.nba.com`) / FotMob 未鉴权 API~~：实测 403 / 404

---

## 一、经实测可用的免费数据源清单（8 大源）

| # | 数据源 | 覆盖范围 | 费用 / 鉴权 | 核心脚本入口 | 核心用途 |
|---|---|---|---|---|---|
| 1 | **Football-Data.co.uk**（新增实测） | 11 个一/二级欧洲联赛（英超/西甲/意甲/德甲/法甲/英冠/西乙/德乙/荷甲/葡超/土超）+ 未来赛程 | 免费 / 免 Key | `tools/fetch_football_data.py` | **大样本历史训练核心**：Betfair 交易所初/收盘尖盘、Bet365/市场均值、亚盘初/终盘、大小球 2.5、26/27 赛季 `HxG/AxG` |
| 2 | **ESPN Public JSON API**（新增实测） | 全球主流足球（五大联赛/欧冠/英冠/荷甲/葡超/巴甲/美职/日职/澳超）+ **NBA** | 免费 / 免 Key | `tools/fetch_espn_intel.py` | **临场情报核心**：足球首发 11 人与阵型（T−50m）、**NBA 完整双方伤停名单**（Out / Questionable / Day-To-Day）与让分走势 |
| 3 | **OpenLigaDB**（新增实测） | 德甲（`bl1`）、德乙（`bl2`） | 免费 / 免 Key | `https://api.openligadb.de/getmatchdata/bl1` | 德系联赛精确开赛时间与比分校验锚点 |
| 4 | **开云体育 API**（现有） | 全球一/二/三级足球 + NBA 欧亚主盘 | 账号会话（免额外费） | `tools/ky_api_engine.cjs`、`tools/ky_snapshot_collector.cjs` | 目标执行盘口（1X2 / 亚盘 / 大小球）、`[T−35, T−30]` 主窗口与 `[T−4, T−1]` 收盘价（CLV） |
| 5 | **懂球帝 magicball**（现有） | 足球欧赔 / 亚盘 / 大小球初盘与即时水位 | 免费 / 免 Key | `app/tools/fetch-europe-odds.ts` | 盘口水位交叉对照与欧亚初盘历史轨迹 |
| 6 | **中国竞彩网网关**（现有） | 竞彩足球/篮球场次池、参考水位、支持率、2016 至今官方 Payout 赛果 | 免费 / 免 Key | `scraper.js`、`app/tools/fetch-today.ts`、`fetch-results.ts` | 场次池基准、大众支持率偏差、官方权威结算赛果 |
| 7 | **澳客（okooo）**（现有） | 百家欧赔/亚盘对比、实时比分补全 | 免费 / 免 Key | `tools/okooo_scraper.js`、`tools/fetch_okooo_live.js` | 多庄家水位离散度与比分兜底 |
| 8 | **Understat**（现有） | 五大联赛球队/球员 npxG / xGA | 免费 / 免 Key | `tools/fetch_xg.py`、`tools/xg_quant.py` | 五大联赛深度预期进球回归特征 |

---

## 二、新增核心免费源：怎么取、拿到什么样、抽什么字段、怎么分析

### 数据源 A：Football-Data.co.uk（历史训练 + 未来赛程盘口）

1. **怎么取**：
   ```bash
   # 拉取 2026-27 赛季全部 11 个一/二级欧洲联赛（实测 1,235 场，约 5 秒完成）
   python3 tools/fetch_football_data.py --season 2627 --all
   # 拉取上一完整赛季（2025-26）扩充训练集到 5,000+ 场
   python3 tools/fetch_football_data.py --season 2526 --all
   # 拉取即将开赛的赛程与盘口（实测 98 场）
   python3 tools/fetch_football_data.py --fixtures
   ```
2. **拿到什么样**（落盘 `data/free_sources/football_data_2627.jsonl`，每行一条标准化 JSON）：
   ```json
   {
     "leagueCode": "E0", "league": "英超", "tier": 1, "date": "2026-11-08", "timeUtc": "16:30",
     "home": "Man United", "away": "Aston Villa", "hg": 4, "ag": 4,
     "sharpOpen1x2": [2.24, 3.85, 3.3], "sharpClose1x2": [2.06, 4.2, 3.5],
     "softOpen1x2": [2.20, 3.60, 3.10],
     "ahLine": -0.25, "ahOpen": [1.83, 1.91], "ahClose": [1.92, 1.81],
     "ou25Open": [1.72, 2.10], "hxg": 3.55, "axg": 2.88
   }
   ```
3. **该取什么数据 / 过滤什么**：
   - **必取**：`sharpOpen1x2`（Betfair Exchange `BFEH/D/A` 低水尖盘初盘）、`sharpClose1x2`（`BFECH/D/A` 收盘尖盘）、`softOpen1x2`（`B365H/D/A`）、`ahLine` + `ahOpen`/`ahClose`、`hxg`/`axg`（26/27 赛季自带）。
   - **必过滤**：缺失 `FTHG`/`FTAG` 或任一赔率 `<= 1.0` 的残缺行直接丢弃。
4. **怎么分析**：
   - **市场先验**：用 `tools/pricing.cjs` / `train_residual_model.py` 的 `devig_power(sharpOpen1x2)` 去水得到真实无水先验 `p_mkt`。
   - **Sharp-Soft 价差特征（`delta_line`）**：计算 `devig_power(sharpOpen1x2)[0] - devig_power(softOpen1x2)[0]`，衡量软庄定价是否滞后于交易所尖盘。
   - **CLV 验证**：用 `devig_power(sharpClose1x2)[0] * softOpen1x2[0] - 1` 计算历史假设下单的收盘价价值。
   - **xG 回归**：滚动计算球队近 5–10 场 `avg(hxg - hg)`，识别“进球虚高但 xG 偏低”的回调队（只用历史已完赛场次，绝不泄露当场 `hxg`）。

---

### 数据源 B：ESPN Public JSON API（足球首发 + NBA 伤停）

1. **怎么取**：
   ```bash
   # 足球（支持 eng.1, eng.2, esp.1, ita.1, ger.1, fra.1, uefa.champions, ned.1, por.1, bra.1, usa.1, jpn.1, aus.1）
   python3 tools/fetch_espn_intel.py --sport soccer --league eng.1
   # NBA（含完整双方伤停名单 Out / Questionable / Day-To-Day）
   python3 tools/fetch_espn_intel.py --sport nba
   ```
2. **拿到什么样**（落盘 `data/free_sources/espn_<league>_<YYYYMMDD>.json`）：
   - 足球每场含：`eventId`、`kickoffUtc`、`home`/`away`、`rosters`（`formation` + `startersCount` + 首发名单，赛前约 1 小时自动填充）、`injuries`。
   - NBA 每场含：`eventId`、`kickoffUtc`、`home`/`away`、`injuries`（按主客队分组，含球员姓名、位置、`status` 如 `Out`/`Questionable`/`Day-To-Day` 及具体伤情说明；实测单次可稳定拉出 20+ 条实时伤停）。
3. **怎么分析与使用**：
   - **足球 T−50m 临场复核**：对比 `rosters.starters` 与常规主力，若头号射手/主力中卫/一门缺阵且开云盘口尚未调水，记为高优先级人工复核信号。
   - **NBA 伤停特征（未来重启 NBA 模型的必备前置）**：统计每队 `status == "Out"` 与 `"Questionable"` 的核心首发人数及场均出场时间占比，在接通至少 500 场历史伤停快照并跑赢市场基线前，NBA 实单门保持关闭。

---

## 三、怎么把免费数据正式列入训练与每日循环流程

### 1. 离线大样本模型训练与消融（随时可跑，每周日必跑）
```bash
# Step 1: 拉取 25/26 + 26/27 免费欧亚盘口历史数据
python3 tools/fetch_football_data.py --season 2627 --all

# Step 2: 跑严格 Walk-Forward + 按日 Block Bootstrap 样本外验证
python3 tools/train_residual_model.py \
  --football-data data/free_sources/football_data_2627.jsonl \
  --out data/experiment_survival_100/model/football_residual_v1.json
```
- **准入红线（Fail-Closed）**：只有当输出 JSON 中 `nEval >= 300`、`brierDiffCi95[1] < 0`（显著优于 Betfair 尖盘基线）时，`verified` 才会变成 `true`；否则自动保持 `verified: false`，`ky_signal_gate.cjs` 硬拦截不发实单信号。
- **特征迭代纪律**：每次只改一个特征（如加入滚动 `HxG/AxG` 差、加入 `AH` 亚盘初终盘漂移、分一/二级联赛独立拟合），对比 `modelBrier` 与 `modelLogLoss` 是否同步改善，达标才升级版本。

### 2. 融入每日循环采集计划（对接 `odds-lab-ops.md`）
- **每日 10:00（基本面与历史库更新）**：跑 `fetch_football_data.py --season 2627 --all` + `--fixtures`（更新最新完赛赛果、xG 与未来赛程盘口），并用 `tools/match_crosswalk.cjs` 与开云/竞彩场次对齐。
- **赛前 T−50m（临场情报）**：对当日重点场次跑 `fetch_espn_intel.py --sport soccer --league <code >`（NBA 为 `--sport nba`），核查首发与伤停突变。
- **每周日 23:30（周度闭环）**：跑 `node tools/weekly_audit.cjs`（汇总开云 `T−30` vs `T−2m` CLV）+ `python3 tools/train_residual_model.py --football-data ...`（滚动重训与样本外审计）。

---

## 四、人工研判与对照用专业资料站清单（免费浏览）

| 领域 | 资料站 | 查什么最有效 |
|---|---|---|
| **欧亚盘口与变盘** | [OddsPortal](https://www.oddsportal.com/football/) · [球探体育（Titan007）](https://m.titan007.com/odds.htm) | 80+ 庄家欧赔/亚盘初盘与临场异常降水；球探在中文亚盘与二/三级联赛资料最全 |
| **足球首发与 xG** | [FotMob](https://www.fotmob.com/) · [SofaScore](https://www.sofascore.com/) · [xG Stat](https://www.xgstat.com/) | Opta 驱动 xG、射门图、球员评分、赛前 1 小时首发与不可用球员 |
| **伤停停赛与身价** | [Transfermarkt](https://www.transfermarkt.us/premier-league/sperrenausfaelle/wettbewerb/GB1/plus/1) | 主力伤病、停赛、复出预期与阵容身价差（评估缺阵权重） |
| **NBA 官方伤停与裁判** | [NBA Official Injury Report](https://official.nba.com/nba-injury-report-2026-27-season/) · [NBA Referee Assignments](https://official.nba.com/referee-assignments/) · [Basketball-Reference](https://www.basketball-reference.com/leagues/NBA_2027.html) | 官方滚动伤停 PDF、每日裁判组名单、球队百回合 ORtg/DRtg/Pace |
