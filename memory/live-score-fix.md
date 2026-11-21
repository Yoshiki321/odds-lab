---
name: live-score-fix
description: "okooo实时比分链路两个坑：server require缓存不热更新 + fetch_live_scores主入口/导出函数双路径"
metadata:
  type: project
---

**现象（2026-09-06）**：命令行 `node tools/fetch_live_scores.cjs` 能合并 okooo 实时比分，但网页一直显示「待开奖」无比分。

**根因一（主因）**：server.js 用 `createRequire` + `require('./tools/fetch_live_scores.cjs')` 缓存模块——**改脚本后必须重启 server 进程才生效**（node require 缓存不热更新）。首次排查时重启过一次，但当时脚本里 okooo 合并段实际写在 `if (require.main === module)` 分支（只有命令行直跑才执行），require 路径调 `fetchLiveScores()` 只抓 sporttery 空比分，还每轮把手动合并的比分覆盖回空。

**根因二**：spawn 的 okooo 抓取 + mergeOkooo 合并逻辑必须放进 `fetchLiveScores()` 函数体内（module.exports 导出那个），不能只留在 require.main 分支。

**根因三（纯打字坑）**：返回键 `okoooHit`（3个 o）和 console.log 里写的 `r.okooHit`（2个 o）不一致 → 显示 undefined，容易被误判为合并没跑。数据层其实正常。

**How to apply**：
1. 改 `tools/fetch_live_scores.cjs`（或任何被 server require 的工具）→ 必须 `node tools/restart_server.cjs 9000` 重启。
2. server 共用逻辑写入导出的函数体：`module.exports = { fetchLiveScores }`，main 分支只做命令行回显。
3. 排查「网页没数据但命令行有」：先重启 server，再看是否逻辑只在 require.main 分支。[[data-tools]]