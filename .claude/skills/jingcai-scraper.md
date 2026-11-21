---
name: jingcai-scraper
description: 竞彩网(sporttery.cn) + 懂球帝(dongqiudi.com) + 澳客(okooo.com) 三平台数据接口速查 — 竞彩足球/篮球/传统足彩全量接口、实时比分/赔率、积分榜、百家欧赔对比、赔率变化历史
metadata:
  type: project
---

# 竞彩网 API 速查与抓取

所有接口基址 `https://webapi.sporttery.cn/gateway/`，纯 HTTP GET，**无需浏览器/登录/签名**，仅需 `referer` 头。

## 通用请求头

```json
{
  "referer": "https://www.sporttery.cn/",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 Edg/151.0.0.0",
  "accept": "application/json, text/javascript, */*; q=0.01"
}
```

部分接口需要特定 referer（见各接口说明）。响应格式：`{ errorCode: "0", success: true, value: { ... } }`。

---

## 一、即时赔率（在售赛事）

### 竞彩足球

| 玩法 | URL params | 池字段 |
|---|---|---|
| 胜平负+让球 | `poolCode=hhad,had` | `had`(胜平负), `hhad`(让球) |
| 混合全池 | `channel=c`（不加 poolCode） | 同上 + `crs`(比分), `ttg`(总进球), `hafu`(半全场) |

**接口**：`uniform/football/getMatchCalculatorV1.qry`

### 竞彩篮球

| 玩法 | URL params | 池字段 |
|---|---|---|
| 胜负 | `poolCode=mnl` | `mnl`(胜负) |
| 混合全池 | `poolCode=mnl,hdc,hilo,wnm` | `mnl`(胜负), `hdc`(让分), `hilo`(大小分), `wnm`(胜分差) |

**接口**：`uniform/basketball/getMatchCalculatorV1.qry`

### 数据提取

响应 `value.matchInfoList[].subMatchList[]` 每场：

```json
{
  "matchId": 2041020,
  "matchNumStr": "周日020",
  "matchDate": "2026-08-24",
  "matchTime": "01:00:00",
  "matchWeek": "周日",
  "matchStatus": "Selling",
  "homeTeamAbbName": "圣克拉拉",
  "awayTeamAbbName": "法马利康",
  "homeRank": "[葡超6]",
  "awayRank": "[葡超13]",
  "leagueAbbName": "葡超",
  "leagueId": 55,
  "had": { "h": "2.59", "d": "2.65", "a": "2.73", "updateDate": "2026-08-23", "updateTime": "19:34:33" },
  "hhad": { "h": "6.45", "d": "4.00", "a": "1.38", "goalLine": "-1", ... },
  "crs": { "s00s00": "14.00", "s01s01": "5.40", ... },
  "ttg": { "s0": "6.50", "s1": "3.35", "s2": "2.95", ... },
  "hafu": { "hh": "4.90", "dd": "3.55", "aa": "5.00", ... },
  "poolList": [ { "poolCode": "HHAD", "single": 0, "poolStatus": "Selling" }, ... ],
  "oddsList": [ { "poolCode": "HAD", "h": "2.590", "d": "2.650", "a": "2.730", ... } ]
}
```

---

## 二、历史赛果（已开奖比赛）

### 足球

**接口**：`uniform/football/getUniformMatchResultV1.qry`

**参数**：
| 参数 | 说明 | 示例 |
|---|---|---|
| `matchBeginDate` | 开始日期(必填) | `2026-08-24` |
| `matchEndDate` | 结束日期(必填) | `2026-08-24` |
| `pageSize` | 每页条数(默认30) | `50` |
| `pageNo` | 页码(从1开始) | `1` |
| `leagueId` | 联赛筛选(空=全部) | `55`(葡超) |
| `isFix` | 是否固定 | `0` |
| `matchPage` | 固定传1 | `1` |
| `pcOrWap` | 设备标识 | `1` |

**referer**：`https://www.sporttery.cn/jc/zqsgkj/`

**数据结构** `value.matchResult[]`：

```json
{
  "matchId": 2041008,
  "matchNumStr": "周日008",
  "matchDate": "2026-08-23",
  "leagueName": "荷兰甲级联赛",
  "leagueNameAbbr": "荷甲",
  "leagueId": 17,
  "homeTeam": "埃因霍温",
  "awayTeam": "格罗宁根",
  "allHomeTeam": "PSV埃因霍温",
  "allAwayTeam": "格罗宁根",
  "homeTeamId": 250,
  "awayTeamId": 246,
  "h": "1.20",        // 最终主胜赔率
  "d": "5.85",        // 最终平赔
  "a": "8.00",        // 最终客胜赔率
  "goalLine": "-1",   // 让球数
  "sectionsNo1": "3:1",     // 半场比分
  "sectionsNo999": "5:1",   // 全场比分（90分钟）
  "winFlag": "H",     // H=主胜 D=平 A=客胜
  "matchResultStatus": "2", // 2=已开奖 1=待开奖
  "poolStatus": "Payout",   // Payout=已开奖
  "bettingSingle": 0,       // 是否单固场次
}
```

**历史深度**：2015-01-01 至今。篮球接口同结构，路径换 `uniform/basketball/`，额外字段 `finalScore`(全比分)、`oneScore`~`fourScore`(每节比)、`goalline`(让分数)。

---

## 三、单场详情 + 赔率变化历史（核心！）

**接口**：`uniform/football/getFixedBonusV1.qry`

**参数**：
| 参数 | 说明 | 示例 |
|---|---|---|
| `clientCode` | 固定 `3001` | `3001` |
| `matchId` | 比赛ID | `2041020` |

**referer**：`https://www.sporttery.cn/jc/zqdz/`

**返回 `value.oddsHistory` 结构**：

```json
{
  "homeTeamId": 250,
  "awayTeamId": 246,
  "homeTeamAbbName": "埃因霍温",
  "awayTeamAbbName": "格罗宁根",
  "leagueAbbName": "荷甲",
  "leagueAllName": "荷兰甲级联赛",
  "leagueId": "17",
  "hadList": [
    { "h": "1.24", "d": "5.42", "a": "7.20", "updateDate": "2026-08-21", "updateTime": "09:55:11" },
    { "h": "1.22", "d": "5.70", "a": "7.45", "updateDate": "2026-08-23", "updateTime": "12:56:05" },
    { "h": "1.20", "d": "5.85", "a": "8.00", "updateDate": "2026-08-23", "updateTime": "17:59:30" }
    // 按时间排列，每条代表一次赔率变化
  ],
  "hhadList": [
    { "h": "1.77", "d": "4.05", "a": "3.15", "goalLine": "-1", "updateDate": "2026-08-21", "updateTime": "09:55:11" },
    // ...
  ],
  "hafuList": [ ... ],
  "ttgList": [ ... ],
  "crsList": [ ... ],
  "singleList": [
    { "single": 0, "poolCode": "HHAD" },
    { "single": 1, "poolCode": "HAFU" }
    // 0=串关 1=可单关
  ]
}
```

同时返回 **`value.matchResultList[]`** 最终开奖结果：

```json
[
  { "code": "HAD", "combination": "H", "combinationDesc": "胜", "odds": "1.20", "goalLine": "" },
  { "code": "HHAD", "combination": "H", "combinationDesc": "(-1)胜", "goalLine": "-1", "odds": "1.61" },
  { "code": "CRS", "combination": "5:1", "combinationDesc": "5:1", "odds": "22.00" },
  { "code": "TTG", "combination": "6", "combinationDesc": "6", "odds": "7.20" },
  { "code": "HAFU", "combination": "H:H", "combinationDesc": "胜胜", "odds": "1.60" }
]
```

以及 `value.sectionsNo999`（全场比分）。

---

## 四、比赛头部信息（排名/队徽/赛季）

**接口**：`uniform/football/getMatchHeadV1.qry`

**参数**：`source=web&sportteryMatchId={matchId}`

**referer**：`https://www.sporttery.cn/jc/zqdz/`

返回两队排名、赛季、联赛名、队徽链接、wbsjStats(两队本赛季统计)。

---

## 五、赛程

**接口**：`uniform/football/getMatchListV1.qry`

**参数**：`clientCode=3001`

**referer**：`https://www.sporttery.cn/jc/zqszsc/`

返回近几日赛程列表，含 `matchDate`/`matchTime`/`homeTeamAbbName`/`awayTeamAbbName` 等。

---

## 六、联赛资料

### 6.1 联赛列表

**接口**：`uniform/football/league/getLeagueListV1.qry`

**referer**：`https://www.sporttery.cn/zqlszl/`

返回 `value`：
- `hot[]` — 热门联赛（德甲/法甲/英超/意甲/西甲/世界杯）
- `normal[]` — 按大洲/国家分组的所有联赛
- `other[]` — 特殊赛事（世界杯、奥运等）

每个联赛含 `uniformLeagueId`、`seasonList[]`（近3赛季）。

### 6.2 联赛赛程/战绩

**接口**：`uniform/football/league/getMatchResultV1.qry`

**参数**：
| 参数 | 说明 | 示例 |
|---|---|---|
| `seasonId` | 赛季ID | `15243`(葡超2026/2027) |
| `uniformLeagueId` | 联赛ID | `78`(葡超) |

**referer**：`https://www.sporttery.cn/zqlszl/?uniformLeagueId={id}`

返回 `value.matchList[]`，每项含 `matchDate`+`subMatchList[]`：
```json
{
  "homeAbbCnName": "圣克拉拉",
  "awayAbbCnName": "法马利康",
  "matchDate": "2026-08-24",
  "matchTime": "01:00",
  "sectionsNo1": "0:0",        // 半场比分
  "sectionsNo999": "1:1",      // 全场比分
  "wbsjMatchSc": "Played",     // Fixture=未开始 Played=已完赛
  "wbsjMatchScDesc": "已完成",
  "uniformMatchId": 2498260,
  "phaseName": "Regular Season",
  "gameweek": "3"
}
```

> 注意：`seasonId` 随时间变化，需先通过 `getLeagueListV1.qry` 获取最新。

---

## 七、支持比例与投票

### 7.1 投票详情

**接口**：`uniform/football/getVoteV1.qry`

**参数**：
| 参数 | 说明 | 示例 |
|---|---|---|
| `poolCode` | 玩法代码 | `HAD`/`HHAD`/`CRS`/`TTG`/`HAFU` |
| `pageSize` | 每页条数 | `10` |
| `pageNo` | 页码 | `1` |
| `businessDate` | 比赛日期 | `2026-08-24` |

**referer**：`https://www.sporttery.cn/jc/zqspfzc/`

返回 `value.matches.list[]` 每位：
```json
{
  "matchId": 2041020,
  "matchNum": "周日020",
  "h": "2.59", "d": "2.65", "a": "2.73",
  "hsupportRate": "35%", "dsupportRate": "41%", "asupportRate": "24%",
  "hprobability": "34%", "dprobability": "34%", "aprobability": "32%",
  "herror": "1%", "derror": "7%", "aerror": "-8%",
  "win": 32223, "draw": 37412, "lose": 22000,  // 投票人数
  "enumber": "20013", "evalue": "-8%",  // 偏差点
  "leagueAbbName": "葡超",
  "poolStatus": "Selling"
}
```

### 7.2 临场热度偏差点排名

**接口**：`uniform/football/getVotePlayV1.qry`

**参数**：`poolCode=HAD&isToday=0`

**referer**：`https://www.sporttery.cn/jc/zqspfzc/`

按偏差点绝对值排序，快速定位"最热"场次。

### 7.3 球迷支持率/概率

**接口**：`jc/common/getSupportRateV1.qry`

**参数**：
| 参数 | 说明 | 示例 |
|---|---|---|
| `matchIds` | 比赛ID(逗号分隔) | `2041018,2041020` |
| `poolCode` | 玩法 | `hhad,had` |
| `sportType` | 运动类型 | `1`(足球) |

**referer**：`https://www.sporttery.cn/`

返回 `value["_{matchId}"]` 含 `HHAD` 和 `HAD` 对象：
```json
{
  "HAD": {
    "hSupportRate": "35%", "hProbability": "34%",
    "dSupportRate": "41%", "dProbability": "34%",
    "aSupportRate": "24%", "aProbability": "32%",
    "win": 32223, "draw": 37413, "lose": 22000,
    "eKey": "a", "eValue": -8, "absValue": 8
  },
  "HHAD": { ... }
}
```

---

## 八、比分直播（实时）

**接口**：`uniform/fb/getMatchDataPageListV1.qry`

**参数**：`method=live`

**referer**：`https://www.sporttery.cn/jc/zqbfzb/`

**其他比分直播接口**：
- `uniform/fb/getConditionsV1.qry?method=live` — 联赛筛选条件
- `uniform/fb/getMatchLiveStatusListV1.qry` — 比赛状态列表
- `uniform/fb/getMatchLiveV1.qry?matchIds=&eventTc=goals,penalty_shootout&method=live` — 实时事件(进球/点球)

---

## 九、传统足彩

### 9.1 开奖汇总（含最新期列表）

**接口**：`lottery/getFootBallDrawInfoV2.qry`

**参数**：`isVerify=1&param=94,0;90,0;98,0`

**referer**：`https://www.sporttery.cn/ctzc/ctzq/`

返回 `value`：
- `sfcDetail` — 胜负游戏当前期详情
- `sfclist[]` — 胜负游戏+任选9场 历史期号列表（50期）
- `bqcDetail` / `bqclist[]` — 6场半全场
- `jqcDetail` / `jqclist[]` — 4场进球

### 9.2 单期回查（含每场比分、开奖结果、奖金）

**接口**：`lottery/getFootBallDrawInfoByDrawNumV1.qry`

**参数**：
| 参数 | 说明 | 示例 |
|---|---|---|
| `isVerify` | 固定 `1` | `1` |
| `lotteryGameNum` | 游戏编号 | `90`(胜负) / `900129`(任9) / `98`(半全场) / `94`(进球) |
| `lotteryDrawNum` | 期号 | `26109` |

**referer**：`https://www.sporttery.cn/ctzc/ctzq/`

返回 `value`（flattened，无 sfcDetail 包装）：
```json
{
  "lotteryDrawNum": "26109",
  "lotteryDrawTime": "2026-08-23",
  "lotteryDrawResult": "3 3 1 0 3 3 3 0 3 3 3 3 1 1",
  "lotteryGameName": "胜负游戏",
  "totalSaleAmount": "17698462",
  "poolBalanceAfterdraw": "0",
  "matchList": [
    { "masterTeamName": "曼  城", "guestTeamName": "伯恩茅", "matchName": "英超",
      "result": "3", "czScore": "3:0", "czHalfScore": "2:0" },
    ...
  ],
  "prizeLevelList": [
    { "prizeLevel": "一等奖", "stakeCount": "29", "stakeAmount": "273,410", "totalPrizeamount": "7,928,890" },
    { "prizeLevel": "二等奖", "stakeCount": "710", "stakeAmount": "4,786", "totalPrizeamount": "3,398,060" }
  ]
}
```

### 9.3 在售期查询

**接口**：`lottery/getFootBallMatchV1.qry`

**参数**：`param=90,0&lotteryDrawNum=&sellStatus=0&termLimits=10`

**referer**：`https://www.sporttery.cn/ctzc/ctzq/`

---

## 十、抓取器脚本

项目内置 `scraper.js`，封装了以上全部接口的高阶抓取逻辑：

```bash
node scraper.js all            # 赔率+近30天历史+联赛+比分直播
node scraper.js odds           # 即时赔率快照
node scraper.js history [date] # 历史赛果(默认2015-01-01至今)
node scraper.js league         # 联赛资料(全部联赛×赛季)
node scraper.js support [date] # 支持比例
node scraper.js ctzc [N]       # 传统足彩最近N期
node scraper.js live           # 比分直播
```

数据落盘 `data/` 目录，按类型/日期分文件。

---

## 十一、快速查询示例

### 查一场比赛的最新赔率

```javascript
const url = 'https://webapi.sporttery.cn/gateway/uniform/football/getMatchCalculatorV1.qry?channel=c';
const res = await fetch(url, { headers: { referer: 'https://www.sporttery.cn/' } });
const data = await res.json();
const match = data.value.matchInfoList.flatMap(b => b.subMatchList).find(m => m.matchNumStr === '周日020');
```

### 查一场比赛的结果 + 赔率变化历史

```javascript
const url = 'https://webapi.sporttery.cn/gateway/uniform/football/getFixedBonusV1.qry?clientCode=3001&matchId=2041020';
const res = await fetch(url, { headers: { referer: 'https://www.sporttery.cn/jc/zqdz/' } });
const data = await res.json();
console.log('全场比分:', data.value.sectionsNo999);
console.log('胜平负赔率变化:', data.value.oddsHistory.hadList);
console.log('开奖结果:', data.value.matchResultList);
```

### 查某日所有已开奖赛果

```javascript
const url = 'https://webapi.sporttery.cn/gateway/uniform/football/getUniformMatchResultV1.qry?matchBeginDate=2026-08-24&matchEndDate=2026-08-24&pageSize=50&pageNo=1&isFix=0&matchPage=1&pcOrWap=1';
const res = await fetch(url, { headers: { referer: 'https://www.sporttery.cn/jc/zqsgkj/' } });
const data = await res.json();
data.value.matchResult.forEach(m => {
  console.log(m.matchNumStr, m.homeTeam, m.sectionsNo999, m.awayTeam, '→', m.winFlag === 'H' ? '主胜' : m.winFlag === 'D' ? '平' : '客胜');
});
```

### 查两队历史交锋

遍历联赛历史数据，按 `homeTeamId`/`awayTeamId` 或队名匹配。联赛ID通过 `getLeagueListV1` 获取，赛季ID取最新。

```javascript
const leagueUrl = 'https://webapi.sporttery.cn/gateway/uniform/football/league/getMatchResultV1.qry?seasonId=15243&uniformLeagueId=78';
const res = await fetch(leagueUrl, { headers: { referer: 'https://www.sporttery.cn/zqlszl/?uniformLeagueId=78' } });
const data = await res.json();
const matches = data.value.matchList.flatMap(d => d.subMatchList);
const h2h = matches.filter(m =>
  (m.homeAbbCnName === '圣克拉拉' && m.awayAbbCnName === '法马利康') ||
  (m.homeAbbCnName === '法马利康' && m.awayAbbCnName === '圣克拉拉')
);
```

---

## 十二、注意事项

1. **限流**：建议间隔 350-600ms，库函数 `sleep` 可调。
2. **Referer**：必须带，不同页面 referer 可能不同。
3. **历史深度**：足球/篮球赛果 2015-01-01 至今；传统足彩全部历史期。
4. **联赛数据**：各联赛只保留近3赛季，更早赛季 `seasonId` 不在列表中。
5. **响应字段后缀 `f`**：`"f": "-1"` 表示下降，`"1"` 表示上升，`"0"` 表示不变。用于判断赔率变化方向。
6. **篮球结构差异**：篮球历史赛果接口返回 `finalScore`(终场比分)、`oneScore`~`fourScore`(节比分)、`goalline`(让分数)、`extraScore`(加时)、`overtimeScore`。

---

# 懂球帝 API 速查与抓取

基址 `https://www.dongqiudi.com/`，HTTP GET 直连，仅需 `referer` 头。**数据覆盖实时比分、赔率(欧赔/亚盘/大小)、积分榜、赛事数据、动画直播。**

## 一、比赛列表（最核心）

**接口**：`/magicball/v1/list/match_list`

**参数**：
| 参数 | 说明 | 示例 |
|---|---|---|
| `language` | 语言 | `zh-CN` |
| `cmp_type` | 运动类型 | `soccer` / `basketball` |
| `tab_type` | 过滤 | `all`(全部) / `live`(进行中) / `fixture`(未开始) / `result`(已完赛) |

**referer**：`https://www.dongqiudi.com/`

**数据结构** `data.matches[]`：

```json
{
  "match_id": "54493170",
  "competition": { "id": "32", "name": "西甲", "color": "#006633" },
  "status": "Fixture",          // Fixture=未开始 Playing=进行中 Finished=已完赛
  "minute": "12'",              // 进行中的分钟数
  "minute_str": "12'",
  "start_play": "2026-08-24 01:00:00",
  "match_timestamp": 1787576400,
  "cmp_type": "soccer",
  "team_A": {
    "id": "510",
    "name": "马拉加",
    "logo": "https://sd.qunliao.info/...",
    "fs": "1",                   // 比分
    "hts": "0",                  // 半场比分
    "league_rank": "西甲 #10",
    "yc": "", "rc": "",          // 红黄牌
    "corners": "",               // 角球
    "cond_odd": [0, 0, 5]        // 投注热度编码
  },
  "team_B": { ... },
  "score_odds": {                // 赔率数据（核心！）
    "origin": [                  // 初盘
      "0.98,0.5,0.83",          // [0] 亚盘：主队水位,让球数,客队水位
      "1.91,3.6,3.1",           // [1] 欧赔：主胜,平,客胜
      "1.0,3.0,0.8"             // [2] 大小球：大球水位,盘口,小球水位
    ],
    "spot": [ ... ]              // 即时盘（同格式，实时更新）
  },
  "hdp_odds": "0.5",             // 让球数
  "total_odds": "3.0",           // 大小球盘口
  "animation_live": "https://tracker.namitiyu.com/zh/football?profile=...&id=4626661",
  "business_status": 256,
  "score_diff": "0",             // 分差（篮球）
  "score_total": "0"             // 总分（篮球）
}
```

**`score_odds` 格式解码**：
```
亚盘: "主队水位,让球数,客队水位"  → 例 "0.98,0.5,0.83" → 主队0.98水 让0.5球 客队0.83水
欧赔: "主胜,平,客胜"              → 例 "1.91,3.6,3.1"  → 标准欧赔
大小: "大球水位,盘口,小球水位"     → 例 "1.0,3.0,0.8"  → 大球1.0水 盘口3.0球 小球0.8水
```

## 二、单场详情

**接口**：`/magicball/v1/match/app/detail`

**参数**：
| 参数 | 说明 | 示例 |
|---|---|---|
| `id` | match_id | `54482136` |
| `app` | 固定 `dqd` | `dqd` |
| `lang` | 语言 | `zh-cn` |

**referer**：`https://www.dongqiudi.com/match/{id}`

**返回结构**：

```json
{
  "matchSample": {
    "match_id": "54482136",
    "competition_id": "122",
    "competition_name": "以甲",
    "status": "Playing",
    "minute": "19",
    "start_play": "2026-08-24 16:00:00",
    "team_A_id": "50001021",
    "team_A_name": "纳扎雷斯马卡比",
    "team_A_logo": "https://...",
    "team_A_rank": "以甲 #13",
    "team_B_id": "50008232",
    "team_B_name": "阿弗拉工人",
    "team_B_rank": "以甲 #6",
    "fs_A": "0",          // 主队比分
    "fs_B": "0",          // 客队比分
    "hts_A": "0",         // 半场比分
    "hts_B": "0",
    "gameweek": "2",
    "suretime": 1
  },
  "matchOdds": { ... },       // 赔率历史(仅顶级联赛)
  "matchAnalysis": { ... },   // 数据分析(仅顶级联赛)
  "matchSK": { ... },         // 技术统计(仅顶级联赛)
  "matchFormation": { ... },  // 阵容
  "matchJijin": { ... },      // 比赛进程
  "living": [ { "title": "动画直播", "url": "https://tracker.namitiyu.com/..." } ],
  "tabs": { "tabs_default": "matchinfo", "list": [...] }
}
```

> 注意：`matchOdds`/`matchAnalysis`/`matchSK` 仅对顶级联赛(英超/西甲/意甲/德甲/法甲/欧冠等)已开赛或已完赛的比赛返回完整数据。

## 三、实时动画数据（tracker-api 纳秘体育）

**接口**：
```
GET https://tracker-api.namitiyu.com/api/football/static_detail?id={tid}&uuid=&lang=zh
GET https://tracker-api.namitiyu.com/api/football/variable_detail?id={tid}&uuid=&lang=zh
GET https://tracker-api.namitiyu.com/api/football/progress?id={tid}&uuid=&lang=zh
```

- `static_detail` — 静态数据(阵容、球员信息、阵型)
- `variable_detail` — 实时动态(进球/红黄牌/换人事件、实时数据)
- `progress` — 比赛进度(时间线)

`{tid}` 从比赛列表的 `animation_live` URL 中提取（`id=4626661`）。

## 四、积分榜 & 数据统计（SSR 内嵌）

数据页 `/data` 是 SSR 渲染，数据在 `window.__NUXT__.data[1]` 中：

```javascript
// 浏览器中执行:
const d = window.__NUXT__.data[1];

// 积分榜
d.standingsGroups[0].teams[]  // 联赛积分榜
// 每项: { rank, name, logo, played, won, drawn, lost, goalsFor, goalsAgainst, goalDiff, points }

// 切换联赛
d.allCompetitions              // 所有联赛列表
d.activeCompetitionId          // 当前选中联赛ID

// 个人榜
d.personTypes                  // 射手榜/助攻榜/黄牌榜/红牌榜
d.personRanking                // 当前榜数据

// 球队榜
d.teamTypes                    // 进球榜/失球榜/射门榜
d.teamRanking                  // 当前榜数据

// 赛程
d.schedule.rounds              // 各轮次比赛
d.schedule.gameweeks           // 轮次列表
d.schedule.currentGameweek     // 当前轮次
```

## 五、快速查询示例

### 查所有比赛的赔率

```javascript
const url = 'https://www.dongqiudi.com/magicball/v1/list/match_list?language=zh-CN&cmp_type=soccer&tab_type=all';
const res = await fetch(url, { headers: { referer: 'https://www.dongqiudi.com/' } });
const data = await res.json();
data.data.matches.forEach(m => {
  const odds = m.score_odds?.spot;
  if (odds) {
    const [asia, euro, total] = odds;
    console.log(m.competition.name, m.team_A.name, 'vs', m.team_B.name,
      '欧赔:', euro, '亚盘:', asia, '大小:', total);
  }
});
```

### 查一场比赛详情

```javascript
const url = 'https://www.dongqiudi.com/magicball/v1/match/app/detail?id=54493170&app=dqd&lang=zh-cn';
const res = await fetch(url, { headers: { referer: 'https://www.dongqiudi.com/' } });
const data = await res.json();
console.log(data.matchSample.team_A_name, data.matchSample.fs_A+'-'+data.matchSample.fs_B, data.matchSample.team_B_name);
```

### 易混淆字段对照

| 懂球帝字段 | 含义 | 竞彩对应字段 |
|---|---|---|
| `match_id` | 比赛ID | `matchId` |
| `team_A.name` | 主队名 | `homeTeam` |
| `team_B.name` | 客队名 | `awayTeam` |
| `team_A.fs` | 主队比分 | `sectionsNo999` 冒号左侧 |
| `team_B.fs` | 客队比分 | `sectionsNo999` 冒号右侧 |
| `team_A.hts` | 半场比分 | `sectionsNo1` 冒号左侧 |
| `team_B.hts` | 半场客队分 | `sectionsNo1` 冒号右侧 |
| `status=Fixture` | 未开始 | `matchStatus=Selling` |
| `status=Playing` | 进行中 | `matchStatus=Playing` |
| `status=Finished` | 已完赛 | `matchResultStatus=2` |
| `score_odds.origin` | 初盘赔率 | `oddsList` 开盘价 |
| `score_odds.spot` | 即时赔率 | `had/hhad` 等当前值 |

## 六、注意事项

1. **HTTP 直连可用**，无需浏览器，仅需 `referer: https://www.dongqiudi.com/`。
2. **限流**：建议间隔 500ms，过快可能被临时封 IP。
3. **比赛列表数据量大**（足球 200+ 场），建议按 `tab_type` 过滤。
4. **`score_odds` 为编码格式**，需拆分解析（逗号分隔）。
5. **`score_odds` 可能为 `null` 或缺失**（低级别联赛、临场未开盘、篮球部分场次），统一解析函数必须加可选链/空值防护：`score_odds?.spot?.[0]`，缺失则跳过该场或标记"无赔率"，切勿直接解构报错。
6. **`matchOdds`/`matchAnalysis`/`matchSK`** 仅对顶级联赛已开赛/已完赛比赛返回，低级别联赛为空。
6. **积分榜**为 SSR 数据，需用浏览器渲染或解析 `window.__NUXT__`。
7. **tracker-api.namitiyu.com** 为动画直播数据源，可实时推送比赛事件。

---

# 澳客(okooo.com) API 速查

基址 `https://www.okooo.com/`，**唯一平台能拿"多家公司欧赔/亚盘/大小球对比"**（威廉希尔/立博/bet365 等百家）。数据多为 HTML 片段需手动解析。

> ⚠️ **WAF 说明**：澳客有较严防护，`stdlib http` 直连部分接口会 405/空。**需用浏览器(Playwright)或页面内 fetch 访问**。建议：进一场已开的比赛页，在页面上下文 `fetch` 接口绕过校验。比赛 ID 从 `https://www.okooo.com/soccer/match/`(足球日历)获取。

## 一、百家欧赔对比（需求: 欧赔主流对比）★★★

**接口**：`/soccer/match/{matchid}/odds/ajax/`

**参数**：
| 参数 | 说明 | 示例 |
|---|---|---|
| `page` | 页码(0=全部) | `0` |
| `trnum` | 公司数 | `0` |
| `companytype` | 公司组 | `BaijiaBooks`(百家)/`AuthoriteBooks`(权威)/`BigBooks`(大公司)/`ExchangeBooks`(交易所) |
| `type` | 玩法 | `0`=欧赔 / `1`=让球盘 / `2`=大小球 |

**referer**：`https://www.okooo.com/soccer/match/{matchid}/odds/`

**返回为 HTML 表格**（`<tr>` 每行一家公司），需解析：

```html
<tr data-pname="9***均">
  <span class="nolink">2.02</span>  <!-- 隐藏: 初赔 主 -->
  <span class="nolink">3.28</span>  <!-- 隐藏: 初赔 平 -->
  <span class="nolink">3.42</span>  <!-- 隐藏: 初赔 客 -->
  <span class="">2.36</span>        <!-- 最新: 主 -->
  <span class="">3.22</span>        <!-- 最新: 平 -->
  <span class="">2.99</span>        <!-- 最新: 客 -->
  <i>↑</i>                          <!-- 升降箭头 -->
  ...概率/凯利指数/赔付率字段
</tr>
```

**依次显示的公司**：9***均(本站均值)、竞**方(竞彩官方)、威***尔(威廉希尔)、立*(立博)、B**365(bet365) 等几十家。

**解析后每行字段**（按 HTML 顺序）：
```
公司名 | 初指(主/平/客 3个) | 最新(主/平/客 3个) |
最新概率(主/平/客 3个) | 凯利指数(主/平/客 3个) | 赔付率
```
其中 `↑`/`↓` 表示较上一次变动方向。**这是做"竞彩 vs 欧赔价值洼地"对比的核心数据**。

## 二、实时赛况 + 技术统计

**接口**：`/I/?method=ok.soccer.match.livestatus&matchid={matchid}`

**referer**：`https://www.okooo.com/soccer/match/{matchid}/`

**返回 JSON**：
```json
{
  "code": 0,
  "info": {
    "matchLive": {
      "matchId": 1316929, "homeId": 1239, "awayId": 1230,
      "homeName": "博塔弗戈", "awayName": "巴拉纳竞技",
      "liveStatus": 100, "liveMinute": "完",
      "homeFT": 2, "awayFT": 3
    },
    "eventList": [
      { "team": 2, "time": "11'", "type": 30, "player_name": "若昂" }
    ],
    "statistic": {
      "home": { "BallPossession": 55, "Corners": 13, "Fouls": 12, "ShotsOnGoal": 8, "ShotsOffGoal": 15, "Passesrate": 88, ...全面技术统计 },
      "away": { ... }
    }
  }
}
```

`eventList` 的 `type`：`30`=进球 `40`=红黄牌。

## 三、比赛详情页（SSR 内嵌丰厚数据）

**URL**：`/soccer/match/{matchid}/`

无需接口，页面 HTML 已含完整数据：
- 积分大势（排位、积分、胜平负场次）
- 控球率/射门/角球实时统计
- 比分直播事件流
- 球队市值（€）
- 半场/全场比分

## 四、月份日历（找比赛入口）

**URL**：`/soccer/match/` → 足球日历页，含全部历史比赛 ID，是检索比赛 ID 的入口。

## 五、快速示例（页面内 fetch）

```javascript
// 先导航到任意已开赛比赛页绕过 WAF
await page.goto('https://www.okooo.com/soccer/match/1316929/', { waitUntil: 'domcontentloaded' });

// 欧赔百家对比
const resp = await page.evaluate(async () => {
  const H = { 'Referer': location.href, 'X-Requested-With': 'XMLHttpRequest' };
  const r = await fetch('/soccer/match/1316929/odds/ajax/?page=0&trnum=0&companytype=BaijiaBooks&type=0', { headers: H, credentials: 'include' });
  return await r.text();
});
// 解析 <tr data-pname="威...尔"> 行

// 实时赛况
const live = await page.evaluate(async () => {
  const H = { 'Referer': location.href, 'X-Requested-With': 'XMLHttpRequest' };
  const r = await fetch('/I/?method=ok.soccer.match.livestatus&matchid=1316929', { headers: H, credentials: 'include' });
  return await r.json();
});
console.log(live.info.statistic.home.BallPossession, '%控球');
```

## 六、注意

1. **必须浏览器环境**（页面内 fetch）访问，直接 http 可能被 WAF 拦截。
2. **严禁高频并发请求**：每次请求前加随机延时 1500~3000ms（Playwright `page.waitForTimeout`），否则极易触发 IP 封禁或强制验证码。
3. `odds/ajax` 返回 **HTML 表格**不是 JSON，需按 `<tr>` 解析；初赔在 `class="nolink"` 隐藏元素里。
3. 公司名被打码（`威***尔`=威廉希尔），需要映射表补充真名（或用本站/竞彩方/B**365 三家即可对比）。
4. **雷速(leisu.com) 放弃**——WAF 对无头浏览器 403，无法稳定抓取。
5. 竞彩官方赔率那行（竞**方）就是本场竞彩官方报价，可与"本站均值"对比判断竞彩是否压价。

---

# 三平台数据源速查总表

| 需求 | 平台 | 接口/位置 | 备注 |
|---|---|---|---|
| 🔴 赔率变化历史 | 竞彩网 | `uniform/football/getFixedBonusV1.qry?clientCode=3001&matchId={mid}` | 全部玩法完整历史 |
| 🟡 欧赔多家对比 | 澳客 | `/soccer/match/{mid}/odds/ajax/?type=0` | 威廉希尔/立博/bet365等,需解析HTML |
| 🟡 亚盘多家对比 | 澳客 | `/soccer/match/{mid}/odds/ajax/?type=1` | 同上 |
| 🟡 大小球多家对比 | 澳客 | `/soccer/match/{mid}/odds/ajax/?type=2` | 同上 |
| 🟡 积分榜详情 | 懂球帝 | `/data` 页 `window.__NUXT__.data[1].standingsGroups` | 完整积分/胜平负/净胜球 |
| 🟡 球队近期状态 | 竞彩+懂球帝 | 按 `team_id` 过滤历史赛果/比赛列表拼凑 | 无现成API |
| 实时比分+赔率 | 懂球帝 | `magicball/v1/list/match_list` | 欧赔/亚盘/大小 编码格式 |
| 实时技术统计 | 澳客 | `/I/?method=ok.soccer.match.livestatus&matchid={mid}` | 全面数据 |
| 传统足彩开奖 | 竞彩网 | `lottery/getFootBallDrawInfo*` | 全部历史期 |