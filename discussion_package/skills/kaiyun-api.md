---
name: kaiyun-api
description: 开云体育(user-pc-new.zqt0510.com + api.71vfi7l.com) 接口速查 — 全接口目录、base64+gzip解包、赛程/盘口字段映射、订单接口、签名与登录态注意。需要抓盘、扫场、读赔率、对账、脱离页面走接口时用本 skill。
---

# 开云体育接口速查（实测 2026-11-19）

> 数据来源：自动化 Edge（CDP 9333）上页面自身发出的请求，用 Playwright 响应监听捕获，非猜测。
> 完整机器可读目录：`data/experiment_survival_100/runtime/api_catalog.json`（20 个接口，含请求参数名与解包后结构）。

## 0. 通信与解包（关键）

- 主域：页面 `https://user-pc-new.zqt0510.com`；接口 `https://api.71vfi7l.com`。
- 响应外壳：`{ code:"0000000", data:"<base64>", msg:"成功", ts:... }`。
- **`data` 以 `H4sI` 开头 = base64(gzip(JSON))**。解包：
  ```js
  const j = JSON.parse(text);
  const json = JSON.parse(zlib.gunzipSync(Buffer.from(j.data, "base64")).toString("utf8"));
  ```
- 少数接口明文 JSON（`getCategoryList`、`countUnsettleTickets`、`getSystemTime`）。
- 赔率数值 `ov` 是 **×100000**：`137000 → 1.37`、`500000 → 5.00`、`184000 → 1.84`。
- 请求有签名头（`x-api-client/web`、`x-api-site/4002`、`x-api-uuid`、`x-api-version/2.0.0`、`x-api-xxx`）；主站 `/site/api/v1/user/member/info` 直接 fetch 会返回 `非法请求(6003)` → **脱离页面前必须处理签名，不能只用 cookie**。

## 1. 赛程与盘口（核心三件套）

### A. `POST /yewu11/v1/w/getOriginalDataPB`
- 请求体：无字段（`{}`）
- 解包后关键字段：
  - `spList[42]`：项目（csid/csna）
  - `tids_obj[372]`：联赛 `{tn, tid, tlev}` ← 联赛名↔ID
  - `matchsList[2515]`：全部场次 `{mcid, tid, mst, mgt, mcg, mc, maid, ...}`（有 mid/时间/联赛ID，**无队名无赔率**）
  - `menus`：菜单多语言
- 用途：一次拿到全量比赛 ID 与开赛时间；这是“脱离页面”的入口。

### B. `POST /yewu11/v1/w/structureMatchBaseInfoByMidsPB`
- 请求字段：`mids`、`cuid`、`cos`、`orpt`、`euid`
- 解包后 `data[]` 每场：`mid`、`tnjc`(联赛简称)、`mhn`(主队)、`man`(客队)、`mgt`(开赛ms)、`csna`(项目)、`hpsPns[]`(玩法名+`hpid`)
- 实测一次 12 场；用于按 mid 批量补队名。

### C. `POST /yewu11/v1/w/getMatchBaseInfoByOddsPB`
- 请求字段：`mid`、`mcid`、`newUser`
- 解包后：
  - `data[1]`：该场基础信息（同上）
  - **`playData[177]`**：全部盘口与赔率！每项 `{ctsp, chpid, hpid, hpn, hl:{hv, ol:[...]}}`
- `hpid` 映射（来自 `hpsPns`）：`1`=全场独赢、`4`=全场让球、`2`=全场大小、`17`=上半场独赢、`19`=上半场让球、`18`=上半场大小。
- `hl.hv`：让球/大小盘口线（如 `-1/1.5`、`3/3.5`）。
- `hl.ol[]` 选项：`ot`=`1`(主/胜)、`X`(平)、`2`(客/负)；`onb`=中文标签（大/小/主胜…）；`ov`=赔率×100000。
- 这是下注前读实时盘口的权威来源。

## 2. 列表/筛选辅助

| 接口 | 请求 | 解包后 | 用途 |
|---|---|---|---|
| `POST findTopMatchsPB` | — | 热门场次 ID | 热门 |
| `POST findTopIdsPB` | — | 热门 ID 列表 | 热门 |
| `POST collectMatchesPB` | — | 收藏场次 | 收藏 |
| `POST getOutrightDisplayMatchsPB` | — | 冠军类盘口 | 冠军 |
| `GET findPlaySortPB` | — | 玩法排序 | 盘口顺序 |
| `POST findPlayTopPB` | — | 常用玩法 | 盘口筛选 |
| `GET getCategoryList` | 明文 | `data[11]` 每项 `{marketName, plays, id, label}` | 玩法定义 |
| `POST getOriginalDataPB` | — | 见上 | 全量赛程 |
| `POST loadTournamentMatchPB` | — | 联赛→场次 | 分组 |
| `POST loadMappingPB` | `session_info` | 盘口 ID→中文映射(401…416) | 盘口名 |
| `POST loadNameListPB` | `http_custom_lang` | 多语言名(101…) | 翻译 |
| `GET menu/initPB` | — | 菜单结构 | 导航 |
| `POST eventCollectionPB` | — | 赛事聚合 | 聚合 |
| `POST tabSwitchPB` | — | 统计切换 | 统计 |
| `GET getSystemTime/currentTimeMillis` | 明文 | 服务器时间 | 对时 |

## 3. 订单与账户

| 接口 | 方法 | 说明 |
|---|---|---|
| `GET /yewurecord/order/betRecord/countUnsettleTickets?outright=0` | GET | 明文 JSON `{"code":"0000000","data":N}` = 未结单数 |
| `POST /yewu13/v1/betOrder/betPB` | POST | **提交订单**。请求体含 `seriesOrders[].orderDetailList[]`：`marketId, matchId, mid, oddFinally, odds(×100000), playId, playOptionName, betAmount, marketTypeFinally:"EU", sportId:"1"`；返回 gzip 包，含 `orderNo`, `betMoney`, `maxWinMoney`, `oddsValues`, `orderStatusCode` |
| `GET /site/api/v1/user/member/info` | POST | 主站签名接口，直接调用返回 `非法请求(6003)`；不要绕过 |
| `GET /yewu11/v1/user/getUserInfoPB` | — | 用户信息（解包） |

## 3b. 补抓（2026-11-19 二次登录后的全视图）

| 类别 | 接口 | 说明 |
|---|---|---|
| 滚球列表 | `POST yewu11/v1/w/getAllInPlayMatchListPB` | LIVE 场次列表 |
| 滚球事件 | `GET yewu11/v2/matchAnalysis/liveEventsPB` | 实时事件 |
| 回放 | `POST yewu11/v1/w/playbackVideoUrlPB` | 视频回放 |
| 注单列表 | `yewurecord/order/betRecord/getOrderListPB` | 订单明细（含已结） |
| 预约注单 | `yewurecord/order/betRecord/getPreBetOrderListPB` | 预约单 |
| 提前兑现 | `yewu13/order/betRecord/queryCashOutMaxAmountListPB` | 兑现报价 |
| 限额 | `yewu11/v1/w/getMatchLimitInfoByMidsNewPB` | 单场投注限额 |
| 钱包余额 | `GET yewu12/user/amount`、`yewu12/user/getUserInfoPB` | 余额/用户信息 |
| 全量赔率 | `POST yewu11/v2/w/getAllMatchesOddsPB` | 大批次赔率 |
| 联赛结构 | `POST yewu11/v2/w/structureTournamentMatchesPB` | 联赛→场次 |

**赛果**：没有独立赛果接口；赛果页复用 `getOriginalDataPB`/`structureTournamentMatchesPB` 里的比分字段（`mhs`/`mat` 等）。
完整并集 165 个路径见 `runtime/api_endpoints_union.json`（来源：实抓20 + 全视图101 + 注单页30 + 公开JS 79+11，去重）。
**仍未抓到**：赔率历史变动接口（若存在）、客服/帮助类业务接口。

## 7. 结算与对账（实测教训，2026-11-19）

### 订单结果码（`getOrderListPB` → `records[].detailList[].betResult`）
| 值 | 含义 |
|---|---|
| 0 | 未结算（在途） |
| 3 | 输 |
| 4 | 赢 |
| 5 | 赢半（quarter 盘，如 -0.5/1 赢 1 球） |
| （推测）6 | 输半（未实测，遇到须核实） |

### 对账的正确方式（三源交叉）
1. **订单列表** `POST /yewurecord/order/betRecord/getOrderListPB`，body 字段：`orderTypeFilter, orderBy, timeType, orderStatus, selected, enablePreSettle, userId, page, size`。`orderStatus=2` 或 `3` 取已结算，读 `records[].detailList[].betResult`（3 输 / 4 赢 / 5 赢半）。
   - **会漏单**：2026-11-19 鳄鱼v老虎 7 元在 APP 可见、未结数含它、余额已扣，但所有筛选组合都查不到。列表查不到 ≠ 退单。
2. **未结数** `GET /yewurecord/order/betRecord/countUnsettleTickets?outright=0` → 明文 JSON `data: N`。
   - 只能和余额、列表一起交叉核对，不能单独作结算依据。有延迟和假跳，但未结数 > 列表条数时说明有漏单。
3. **余额** `GET /yewu12/user/amount` → `data.amount`。最终校验，一切以它为准。
4. **不能用**：比赛详情 `getMatchBaseInfoByOddsPB`（比赛一结束就返回空，空 ≠ 在途）、页面文本。
5. **退单判定**：只有余额回到下注前才算退单；余额已扣但列表查不到 = **在途**（接口漏单），结算后看余额变化或问用户 APP 里的状态补录。
6. **汇报结果前必须有依据**：`betResult` 或余额变化，没有就写"待确认"，不许推测。
7. **校验式**：`期初余额 − 各在途本金 + 各已结派彩 = 当前余额`，差 0 才算平账。

### 退单 / 盘口失效（重点教训）
- 提交时市场被关 → 回执 `code 0402008 "盘口失效"`，不会成交。此时**不要重试**。
- 其余“列表查不到”的情况按上面“对账的正确方式”第 5 条判定。
- 校验式：`期初余额 − 各在途本金 + 各已结派彩 = 当前余额`，差 0 才算平账。

### 下注前的市场有效性校验（必须做）
1. 拉一次 `getMatchBaseInfoByOddsPB`，确认目标 `hpid` 组存在、`hl.ol` 非空、`hv`（线）与预期一致；
2. **赔率变动超过 0.10 或线位变动（如 -9.5→-11.5）必须重新判断**，不能沿用旧判断直接提交；
3. 提交后立即记录回执的 `orderStatusCode`（1/2）、`orderNo` 和下单前后余额；之后以列表 `betNo` 为准。查不到明细不按时间推定退单，按上面第 5 条判定。
4. 下单脚本 `ky_bet_live.cjs` 必须传预期赔率（可选预期线位），赔率偏差 >0.10 或线位变动时脚本直接拒单。

### 记账纪律
- 每笔必须写：入场赔率（回执 `oddsValues`）、实际线位（`marketValues`）、金额、`betResult`、派彩、余额快照。
- 禁止用"在途/未结"描述已结束比赛的单据；结束就去查 `betResult`。
- **订单号不一致**：回执里的 `orderNo` 是 16 位（如 `5385213430392350`），列表里的 `betNo` 是 15 位（如 `538521343039235`），后几位不同。账本用 `betNo`，禁止按回执号去重或匹配。
- **派彩读取层**：`backAmount` 在订单记录层 `r.backAmount`，不在明细层 `d.backAmount`；读错层会全部显示 0。

## 8. 脱离页面（已实现，用户 2026-11-19 批准修改原“令牌不落盘”规则）

- `tools/ky_api_auth.cjs`：`save` 从当前页面抓请求头 → 写入 `runtime/api_credentials.json`（权限用 icacls 收紧到当前用户，值不回显）；`status` 只看字段与时间；`clear` 删除。
- `tools/ky_api_engine.cjs` 启动先读该文件（命中就**不连浏览器**），否则回退到页面捕获。
- 实测：2520 场全量、71 场一/二类带队名、单场盘口 1.37/5.00/6.40 与页面一致。
- 凭据失效（401/空数据）→ 重新 `save`，不要绕过；且不回显值到任何报告。
- 扫盘顺序见 `ky_api_engine.cjs`；签名头必须整组携带，cookie 单独不够。

## 5. 工具

- `tools/ky_bet_live.cjs <mid> <hpid> <ot> <金额> <预期赔率> [预期线位]`：单次下单，变价拒单，记余额快照
- `tools/ky_reconcile.cjs`：订单列表 + 余额一次对账（列表可能漏单，需配合未结数）
- `tools/ky_watch_orders.cjs <betNo...>`：按订单号盯结果
- `tools/ky_order_lookup.cjs <关键字>`：按关键字查单

- `tools/ky_api_catalog.cjs` / `ky_api_full_capture.cjs`：抓全部接口+结构 → `runtime/api_catalog*.json`
- `tools/ky_api_decode.cjs` / `ky_api_shape.cjs` / `ky_api_count.cjs`：解包/结构/计数探测
- `tools/ky_api_scan.cjs`：API 版扫盘（写 `sweep/planApi_<date>.json`）
- `tools/ky_api_auth.cjs`：凭据 `save|status|clear`（值不回显）
- `tools/ky_api_engine.cjs`：全量扫盘 `--sweep` / 单场盘口 `--odds <mid>`
- `tools/ky_bet_live.cjs`：下单（`--expect-odds` / `--expect-line` 硬拦偏差）
- `tools/ky_recon.cjs`：**统一对账**（订单号主键 + 三源交叉 + 余额快照）→ `runtime/recon.json`
- `tools/ky_virtual_live.cjs`：**滚球虚拟单**（不花钱，攒 30 单再审计）→ `virtual/live_virtual.json`

## 6. 风险与禁止

- 不绕过验证码、签名、风控；登录态失效就停下来请用户亲手登录。
- `betPB` 只在用户明确批准本次下单后调用一次；提交后以回执为准，结果不明先查单，不重复提交。
- 观察价 ≠ 可成交价；接口赔率带 `ctsp` 时间戳，必须保存。
