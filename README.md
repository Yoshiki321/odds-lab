# 竞彩助手 — 数据抓取器

抓取中国竞彩网(sporttery.cn)官方网关 `webapi.sporttery.cn` + 懂球帝(dongqiudi.com) 的竞彩相关数据。
纯 Node.js HTTP 直连,无需浏览器/登录/签名。

## 数据源

| 数据源 | 覆盖 | 接口文档 |
|---|---|---|
| [竞彩网](https://www.sporttery.cn/) | 竞彩足球/篮球/传统足彩,历史赛果(2015至今),赔率变化历史 | `.claude/skills/jingcai-scraper.md` 前十二节 |
| [懂球帝](https://www.dongqiudi.com/) | 实时比分/赔率(欧赔亚盘大小球)/积分榜/动画直播 | `.claude/skills/jingcai-scraper.md` 懂球帝章节 |
| [澳客](https://www.okooo.com/) | 百家欧赔/亚盘/大小球对比、实时技术统计 | `.claude/skills/jingcai-scraper.md` 澳客章节 |

## 懂球帝核心接口

```
GET https://www.dongqiudi.com/magicball/v1/list/match_list?language=zh-CN&cmp_type=soccer&tab_type=all
GET https://www.dongqiudi.com/magicball/v1/match/app/detail?id={match_id}&app=dqd&lang=zh-cn
GET https://tracker-api.namitiyu.com/api/football/static_detail?id={tid}&uuid=&lang=zh
GET https://tracker-api.namitiyu.com/api/football/variable_detail?id={tid}&uuid=&lang=zh
```

- `match_list` — 全量比赛+赔率(`score_odds.origin/spot` 欧赔/亚盘/大小球,逗号编码)
- `app/detail` — 单场详情(仅顶级联赛含赔率历史/技术统计)
- `tracker-api` — 动画直播实时事件

数据详情见 `.claude/skills/jingcai-scraper.md`。

## 启动

```
node scraper.js all            # 全部(赔率+近30天历史+联赛)
node scraper.js odds           # 即时赔率(足球/篮球全部玩法池)
node scraper.js history        # 历史赛果全量 2016-01-01 至今
node scraper.js history 2024-01-01   # 指定起始日期
node scraper.js league         # 联赛资料(全部联赛×赛季)
node scraper.js support        # 支持比例(默认2026-08起)
node scraper.js ctzc [N]       # 传统足彩最近N期(N默认10)
node scraper.js live           # 比分直播(实时)
```
数据落盘 `data/` 目录。

## 接口清单(全部 GET,webapi.sporttery.cn/gateway/)

| 数据域 | 接口 | 关键参数 | 历史深度 |
|---|---|---|---|
| 竞彩足球即时赔率 | `uniform/football/getMatchCalculatorV1.qry` | `poolCode=hhad,had` 或空=混合全池 | 仅当日在售 |
| 竞彩篮球即时赔率 | `uniform/basketball/getMatchCalculatorV1.qry` | `poolCode=mnl,hdc,hilo,wnm` | 仅当日在售 |
| 足球历史赛果 | `uniform/football/getUniformMatchResultV1.qry` | `matchBeginDate`/`matchEndDate`/`pageNo`/`pageSize` | **2016至今** |
| 篮球历史赛果 | `uniform/basketball/getUniformMatchResultV1.qry` | 同上 | **2016至今** |
| 赛程 | `uniform/football/getMatchListV1.qry` | `clientCode=3001` | 近几日 |
| 支持比例-胜平负 | `uniform/football/getVoteV1.qry` | `poolCode=HAD/HHAD/CRS/TTG/HAFU` + `businessDate` | 仅可查最近日期 |
| 临场热度-偏差点 | `uniform/football/getVotePlayV1.qry` | `poolCode=HAD&isToday=0` | 当日 |
| 球迷支持率/概率 | `jc/common/getSupportRateV1.qry` | `matchIds=...&poolCode=hhad,had&sportType=1` | 仅当日在售 |
| 联赛列表 | `uniform/football/league/getLeagueListV1.qry` | — | 全部 |
| 联赛赛程/战绩 | `uniform/football/league/getMatchResultV1.qry` | `seasonId`+`uniformLeagueId` | 各联赛近3赛季 |
| 比分直播 | `uniform/fb/getMatchDataPageListV1.qry` | `method=live` | 实时进行中 |
| 传统足彩-开奖汇总 | `lottery/getFootBallDrawInfoV2.qry` | `param=94,0;90,0;98,0` | 50期 |
| 传统足彩-单期回查 | `lottery/getFootBallDrawInfoByDrawNumV1.qry` | `lotteryGameNum=90&lotteryDrawNum=26109` | 全部历史期 |
| 传统足彩-在售期 | `lottery/getFootBallMatchV1.qry` | `param=90,0` | 当日在售 |

## 数据结构

### 历史赛果 matchResult[ ]
```
matchId, matchNumStr(周日001), matchDate, leagueName/leagueId,
homeTeam/allHomeTeam, awayTeam/allAwayTeam, homeTeamId, awayTeamId,
h/d/a(胜平负赔率), goalLine(让球), sectionsNo1(半场比分), sectionsNo999(全场比分),
winFlag(H/D/A), matchResultStatus(2=开奖), poolStatus, bettingSingle
```
足球/篮球共用此结构;篮球额外含 finalScore/oneScore~fourScore/overtimeScore。

### 即时赔率 matchInfoList[].subMatchList[ ]
```
matchId, matchNumStr, matchDate/matchTime/matchWeek, businessDate,
matchStatus, homeTeamAbbName/AwayTeamAbbName, homeRank/awayRank, leagueId,
池字段: had(胜平负) hhad(让球,含goalLine) crs(比分) ttg(总进球)
        hafu(半全场) mnl(篮-胜负) hdc(篮-让分) hilo(篮-大小) wnm(篮-胜分差)
poolList[ ](是否单关/串关), oddsList[ ]
```

### 传统足彩单期 value(flattened)
```
lotteryDrawNum/lotteryDrawTime/lotteryDrawResult(如 "3 3 1 0..." 30码),
matchList[ ](每场 masterTeam/guestTeam/matchName/result/czScore/czHalfScore),
prizeLevelList[ ](奖级/注数/奖金), totalSaleAmount, poolBalanceAfterdraw
```

## 抓取注意
- 接口均在腾讯 EdgeOne/WAF 后,但只校验 `referer` 头,无需签名;建议带浏览器 UA。
- 疑似限流:请求间隔 350–600ms,可调 `sleep`。
- 全量历史(2016至今,足球篮球)≈ 2500+ 天 × 2 类,约 2–3 万条赛果,单次跑完 1.5–2.5 小时。

## 增量更新建议
- 历史赛果按日成文件 `history/{sport}/{date}.json`,可定时增量补当日。
- 即时赔率按分钟快照存 `odds/_latest/`,保留一段时间用于赔率走势分析。