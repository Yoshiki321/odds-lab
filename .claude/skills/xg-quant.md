---
name: xg-quant
description: xG量化精算系统 — Understat数据抓取(curl_cffi穿透Cloudflare) → Dixon-Coles修正泊松 → 去水+EV → 1/4凯利。五大联赛实力量化，辅助模型矩阵判断（季中启用）
---

# xG 量化精算系统（Dixon-Coles）

> **定位**：用预期进球(xG)量化两队攻防实力 → 算真实胜平负概率 → 对比机构赔率找 +EV。
> **状态**：框架已建，**赛季初期(每队<5场)决策未启用**，季中(5轮+)启用做辅助。
> **铁律**：季初小样本 npxG 产出虚假 +EV（实测卡利亚里主胜+171%），发现高 EV 先查样本量。

---

## 一、数据抓取（Understat，curl_cffi 穿透 Cloudflare）

### 关键：Understat 2025/26 改版
- **旧方法失效**：页面不再内嵌 `datesData = JSON.parse(...)`，正则抓不到
- **新端点**：`https://understat.com/getLeagueData/{league}/{season}`（AJAX，返回全队逐场 xG）

### 穿透方法（curl_cffi 模拟浏览器 TLS 指纹）
```bash
pip install curl_cffi   # 已装 0.16.2
```

```python
from curl_cffi import requests as cr
s = cr.Session(impersonate="chrome120")       # 模拟 Chrome TLS 指纹(JA3)
s.get("https://understat.com/", timeout=20)   # 先访问主页建 cookie（防 404）
r = s.get(f"https://understat.com/getLeagueData/EPL/2026",
          headers={"referer": "https://understat.com/league/EPL/2026",
                   "x-requested-with": "XMLHttpRequest"}, timeout=30)
data = r.json()
# data["teams"][id]["history"] = [{h_a,xG,xGA,npxG,npxGA,scored,missed,date,...}]
```

### 要点
- **season 陷阱**：`"2026"`=当前赛季(2026/27)，`"2025"`=上赛季。曾错抓 2025 导致利物浦 λ/μ 失真
- **务必先访问主页建 Session**，否则直接调 getLeagueData 会 404（Cloudflare 校验）
- 温和速率：每联赛间隔 1s，避免封 IP
- **FBref 不可用**：Cloudflare Turnstile 盾 + 数据中心 IP，curl_cffi 也 403。足球五大用 Understat 即可
- 联赛代码：`EPL/La_liga/Serie_A/Bundesliga/Ligue_1`

### 运行
```bash
python tools/fetch_xg.py            # 抓5大联赛，存 data/xg/raw_{lg}_{season}.json + npxg_summary.csv
python tools/fetch_xg.py --refresh  # 强制重抓
```

### 季初收缩（防止小样本极端值）
- 每队 <5 场样本时，用全局均值 1.3 做先行收缩（shrinkage）：
  `avg = w_cur×本季均值 + w_prior×1.3`（w_cur=0.6, w_prior=0.4）
- 已验证：拜仁 4.08→2.41、罗马 3.77→2.29（单场大胜噪音被压平）

---

## 二、Dixon-Coles 修正泊松分布

### 理论
两队预期进球（λ主/μ客）由攻防强度拟合。模型概率：
```
P(H=x, A=y) = τ(x,y) × Poisson(x;λ) × Poisson(y;μ)
```
低比分修正因子 τ（解决 0-0/1-0/0-1/1-1 系统性偏差）：
```
τ(0,0) = 1 - λμρ
τ(1,0) = 1 + μρ
τ(0,1) = 1 + λρ
τ(1,1) = 1 - ρ
其他     = 1
ρ ≈ -0.13
```
归一化后：主胜=Σ(x>y)，平=Σ(x=y)，客胜=Σ(x<y)。大小球2.5=Σ(x+y>2.5)。

### λ/μ 来源
- **标准**：log-linear 拟合 攻防参数 α/β（需要足够样本）
- **降级**（季初无参数）：用 npxG 近似
  ```python
  lam = home_for × (away_against / league_avg)   # league_avg≈1.35
  mu  = away_for × (home_against / league_avg)
  ```

### 运行
```bash
python tools/dixon_coles.py --lambda 1.448 --mu 1.139 --odds 2.40 3.40 2.95
```

---

## 三、机构赔率去水（De-margin）

比例去水法（Proportional Method）：
```
inv = [1/O_h, 1/O_d, 1/O_a]
margin = Σ(inv) - 1                 # 抽水率
fair_p_i = inv_i / Σ(inv)           # 无抽水隐含概率
```
- 抽水率 ~4.7-5%（五大联赛），去水后才是市场"真"概率
- 与模型真实概率对比，差异 >3pp 可能有价值

---

## 四、+EV 与凯利

### 期望值
```
EV = P_model × O_market - 1
EV > +3~5% 才有下注价值
```

### 1/4 凯利（防过拟合）
```
b = O - 1; p = P_model; q = 1-p
f* = (b·p - q) / b          # 全额凯利
bet = ¼ × f* × Capital      # 1/4 凯利
f* ≤ 0 → 不下注
```

---

## 五、量化分析流水线（xG→EV）

```bash
python tools/xg_quant.py --today            # 今日所有五大场次 EV 扫描
python tools/xg_quant.py "利物浦" "诺丁汉" --odds 1.30 4.75 6.70
python tools/xg_quant.py --today --json     # JSON 输出（供场景调用）
```

输出字段：`λ/μ`、`true_prob`（模型胜平负）、`market.margin_pct`、`ev`（主/平/客）、
`kelly_1over4`、`best.pick_cn/best.ev_pct/best.kelly_pct`、`sample.min_games/sample.warning`。

> **小样本告警（强制）**：当任一方队伍样本 `Sample_Games < 5` 时，脚本每次输出都会带上
> `[WARNING] 季初样本不足(N<5)，该EV仅供参考，不作为最终投注依据` 标签，JSON 输出含 `sample.warning` 字段。
> **带警告的 EV 一律不可直接下注**——先确认样本量再谈 EV。

### 球队名映射
中文竞彩名 → Understat 英文名用 `TEAM_MAP` 字典 + 模糊匹配。缺队就补 `tools/xg_quant.py` 的 TEAM_MAP。

---

## 六、决策纪律（与模型矩阵结合）

1. **季初(<5轮)禁用**：小样本 npxG → 假 +EV。宁可错过不硬上
2. **xG +EV 只是"辅助维度"**：不替代 M1-M5 盘口模型，需交叉验证
3. **五大 vs 非五大**：M1/P2a_gl1 排除五大；xG 系统专门补五大联赛的实力量化盲区
4. **发现高 EV 先查**：Sample_Games 是否 ≥5？λ/μ 是否合理（0.5~3.0）？实力悬殊是否被 npxG 抹平？
5. **赔率矛盾警示**：若模型 EV 与机构变盘方向冲突（如模型说守盘但机构临场压穿盘），信临场资金流

---

## 七、已验证数据（2026-08-29 实测）

- 五大联赛 2026/27 赛季逐场 xG 已抓取（每队1-3场，季初）
- Dixon-Coles 示例验证：阿森纳 42.56% vs 官方 43.25%（差0.7pp，模型正确）
- 季初虚假 EV 案例：卡利亚里主胜+171%（单场样本），利物浦客胜+150%（上季数据错抓）