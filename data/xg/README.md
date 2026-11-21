# xG 数据目录（Understat）

## 用途
存储 Understat 抓取的欧洲五大联赛 xG 数据，供 Dixon-Coles 量化分析使用。

## 状态（2026-08-29）
**框架已搭好，决策未启用。** 赛季初期（2026/27 第1-2轮）每队仅1-3场样本，npxG 估计方差极大，**不可用于投注决策**。
计划：联赛踢到 **5轮+**（约2026-09中）再用本系统做决策支持。

## 文件
- `raw_{LEAGUE}_{SEASON}.json` — 逐场原始数据（每队history含 xG/xGA/npxG/npxGA/比分）
  - `SEASON=2026` = 当前赛季（2026/27）
  - `SEASON=2025` = 上赛季（2025/26，可作先验基线）
- `npxg_summary.csv` — 各队最近N场加权平均 npxG/npxGA/净差

## 使用
```bash
# 抓取更新（默认五五大联赛当前赛季）
python tools/fetch_xg.py
# 强制重新抓取
python tools/fetch_xg.py --refresh
# 指定联赛
python tools/fetch_xg.py --leagues EPL La_liga

# xG → Dixon-Coles → +EV 量化分析（今日所有有xG数据的场次）
python tools/xg_quant.py --today
# 单场分析
python tools/xg_quant.py "利物浦" "诺丁汉" --odds 1.30 4.75 6.70 --league-avg 1.35
# JSON输出（供Node调用）
python tools/xg_quant.py --today --json

# Dixon-Coles 纯引擎（手动λ/μ）
python tools/dixon_coles.py --lambda 1.448 --mu 1.139 --odds 2.40 3.40 2.95
```

## 关键技术点
1. **Understat 2025/26改版后**：xG数据不再内嵌HTML，改走
   `https://understat.com/getLeagueData/{league}/{season}` AJAX端点
2. **Cloudflare 穿透**：用 `curl_cffi`（模拟Chrome TLS指纹 JA3）+ Session保持cookie
   - 先访问 understat.com 主页建立会话，再调 getLeagueData
   - FBref 仍是 403（更重Turnstile盾），暂不可用
3. **赛季标识**：season="2026" = 当前赛季，"2025" = 上赛季
4. **季初收缩**：compute_npxg_summary 对小样本(≤5场)做先验收缩，
   防止单场大胜产生极端λ/μ

## 依赖
- Python 3.12
- curl_cffi（TLS指纹模拟，已装 0.16.2）
- 可选: soccerdata（装了但FBref被CF拦截，暂未用）