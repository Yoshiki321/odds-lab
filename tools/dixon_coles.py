#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
dixon_coles.py — Dixon-Coles 修正泊松分布量化引擎
核心算法库（纯数学，可被 Node.js 通过 json 调用，也可独立运行）

功能:
  1. 根据两队攻防强度拟合预期进球 λ/μ
  2. 低比分修正因子 τ(x,y) 生成比分概率矩阵
  3. 推导胜平负概率 + 大小球2.5概率
  4. 机构赔率去水 (De-margin) → 纯净隐含概率
  5. +EV 期望值计算
  6. 1/4 凯利注码控制

输入: 两队预期进球 (λ, μ) 或 从 npxG/让球盘反推的攻防参数
用法示例:
    python tools/dixon_coles.py --lambda 1.65 --mu 0.95 --odds 1.95 3.40 4.10
"""

import argparse
import json
import math

RHO = -0.13  # Dixon-Coles 低比分相关性修正系数


# ============================================================
# 1. Dixon-Coles 修正泊松概率
# ============================================================
def poisson_pmf(k, lam):
    """泊松概率质量函数 P(X=k)"""
    return (lam ** k) * math.exp(-lam) / math.factorial(k)


def dixon_coles_tau(x, y, lam, mu, rho=RHO):
    """低比分修正因子 τ(x,y)，解决 0-0/1-0/0-1/1-1 偏差"""
    if x == 0 and y == 0:
        return 1 - (lam * mu * rho)
    elif x == 1 and y == 0:
        return 1 + (mu * rho)
    elif x == 0 and y == 1:
        return 1 + (lam * rho)
    elif x == 1 and y == 1:
        return 1 - rho
    else:
        return 1.0


def calculate_match_probabilities(lam, mu, max_goals=8, rho=RHO):
    """由预期进球 λ/μ 生成比分概率矩阵 + 胜平负/大小球"""
    matrix = [[0.0] * (max_goals + 1) for _ in range(max_goals + 1)]
    total = 0.0

    for x in range(max_goals + 1):
        for y in range(max_goals + 1):
            p = (poisson_pmf(x, lam) * poisson_pmf(y, mu)
                 * dixon_coles_tau(x, y, lam, mu, rho))
            matrix[x][y] = p
            total += p

    # 归一化
    for x in range(max_goals + 1):
        for y in range(max_goals + 1):
            matrix[x][y] /= total

    # 胜平负概率
    home_win = sum(matrix[x][y] for x in range(max_goals + 1)
                   for y in range(max_goals + 1) if x > y)
    draw = sum(matrix[x][x] for x in range(max_goals + 1))
    away_win = sum(matrix[x][y] for x in range(max_goals + 1)
                   for y in range(max_goals + 1) if x < y)

    # 大小球 2.5
    over_25 = sum(matrix[x][y] for x in range(max_goals + 1)
                  for y in range(max_goals + 1) if x + y > 2.5)
    under_25 = 1.0 - over_25

    # 比分概率 Top5
    scores = []
    for x in range(max_goals + 1):
        for y in range(max_goals + 1):
            scores.append((f"{x}-{y}", matrix[x][y]))
    scores.sort(key=lambda s: -s[1])

    return {
        "lambda_home": round(lam, 3),
        "mu_away": round(mu, 3),
        "home_win": round(home_win, 5),
        "draw": round(draw, 5),
        "away_win": round(away_win, 5),
        "over_2.5": round(over_25, 5),
        "under_2.5": round(under_25, 5),
        "top_scores": scores[:5],
    }


# ============================================================
# 2. 机构赔率去水 (De-margin)
# ============================================================
def de_margin(odds):
    """比例去水法。odds=(oh, od, oa) → (margin, fair_probs)"""
    oh, od, oa = odds
    if not all(math.isfinite(x) and x > 1.0 for x in (oh, od, oa)):
        raise ValueError(f"invalid odds (must all be > 1.0): {odds}")
    inv = [1 / oh, 1 / od, 1 / oa]
    margin = sum(inv) - 1.0
    fair = [i / sum(inv) for i in inv]
    return margin, fair


# ============================================================
# 3. +EV 与凯利
# ============================================================
def calc_ev(model_prob, market_odds):
    """EV = (模型概率 × 市场赔率) - 1"""
    return (model_prob * market_odds) - 1.0


def fractional_kelly(model_prob, market_odds, fraction=0.25):
    """1/4 凯利注码"""
    if not (math.isfinite(market_odds) and market_odds > 1.0 and math.isfinite(model_prob) and 0.0 < model_prob < 1.0):
        return 0.0
    b = market_odds - 1.0
    p = model_prob
    q = 1.0 - p
    f_star = (b * p - q) / b
    return max(0.0, f_star * fraction)  # 负值 = 不下注


# ============================================================
# 4. 从 npxG 反推攻防强度 (可选)
# ============================================================
def fit_lambda_mu(att_team, def_team, league_avg_goal=1.35):
    """
    简化版：从两队 npxG 攻防净差反推预期进球。
    实际应使用 Dixon-Coles 的 log-linear 参数拟合，
    此处提供直觉近似，供无完整参数时的降级路径。
    """
    # 修复防守项符号反向：def_team 为对手场均失球，失球越多防守越弱，预期进球越高
    lam = max(0.1, att_team * (def_team / league_avg_goal))
    return lam


# ============================================================
# 5. 完整报告
# ============================================================
def full_report(lam, mu, market_odds, home_team="", away_team=""):
    """生成完整精算报告 dict"""
    prob = calculate_match_probabilities(lam, mu)
    margin, fair = de_margin(market_odds)
    oh, od, oa = market_odds

    ev = {
        "home": calc_ev(prob["home_win"], oh),
        "draw": calc_ev(prob["draw"], od),
        "away": calc_ev(prob["away_win"], oa),
    }
    kelly = {
        "home": fractional_kelly(prob["home_win"], oh),
        "draw": fractional_kelly(prob["draw"], od),
        "away": fractional_kelly(prob["away_win"], oa),
    }

    # 找最佳 +EV
    best = max(ev, key=lambda k: ev[k])
    report = {
        "teams": {"home": home_team, "away": away_team},
        "true_prob": {
            "home_win": prob["home_win"],
            "draw": prob["draw"],
            "away_win": prob["away_win"],
        },
        "market": {
            "odds": {"home": oh, "draw": od, "away": oa},
            "margin_pct": round(margin * 100, 2),
            "fair_prob": {"home": fair[0], "draw": fair[1], "away": fair[2]},
        },
        "ev": {"home": round(ev["home"], 4), "draw": round(ev["draw"], 4),
               "away": round(ev["away"], 4)},
        "kelly_1over4": {"home": kelly["home"], "draw": kelly["draw"],
                         "away": kelly["away"]},
        "over_2.5": prob["over_2.5"],
        "top_scores": prob["top_scores"],
        "best_value": {
            "pick": best,
            "ev_pct": round(ev[best] * 100, 2),
            "kelly_pct": round(kelly[best] * 100, 2),
        },
    }
    return report


def _print_report(r):
    print("=" * 60)
    print(f"  盘口精算报告: {r['teams']['home']} vs {r['teams']['away']}")
    print("=" * 60)
    p = r["true_prob"]
    print(f"模型真实概率: 主胜 {p['home_win']:.2%} | 平 {p['draw']:.2%} | 客胜 {p['away_win']:.2%}")
    print(f"大2.5球: {r['over_2.5']:.2%}")
    print(f"机构抽水: {r['market']['margin_pct']}%")
    f = r["market"]["fair_prob"]
    print(f"去水隐含: 主 {f['home']:.2%} | 平 {f['draw']:.2%} | 客 {f['away']:.2%}")
    ev = r["ev"]
    print(f"+EV: 主 {ev['home']:+.2%} | 平 {ev['draw']:+.2%} | 客 {ev['away']:+.2%}")
    bv = r["best_value"]
    print(f"[最优] {bv['pick']} EV {bv['ev_pct']:+.2f}% | 1/4凯利 {bv['kelly_pct']:.2f}%")
    print("Top比分:", ", ".join(f"{s}({p:.1%})" for s, p in r["top_scores"][:3]))


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Dixon-Coles 盘口精算引擎")
    ap.add_argument("--lambda", type=float, dest="lam", required=True,
                    help="主队预期进球 λ")
    ap.add_argument("--mu", type=float, required=True, help="客队预期进球 μ")
    ap.add_argument("--odds", nargs=3, type=float, required=True,
                    help="机构欧赔: 主 平 客")
    ap.add_argument("--home", default="", help="主队名")
    ap.add_argument("--away", default="", help="客队名")
    ap.add_argument("--json", action="store_true", help="输出JSON")
    args = ap.parse_args()

    report = full_report(args.lam, args.mu, tuple(args.odds),
                         args.home, args.away)
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        _print_report(report)