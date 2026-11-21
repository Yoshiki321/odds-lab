# -*- coding: utf-8 -*-
"""
tools/ou_calc.py — 从欧赔推导大小球 (Over/Under) 盘口

核心思路：
  1. 输入 99家欧赔 (主胜/平/客胜)
  2. 去水 -> 公平概率 p(主) p(平) p(客)
  3. 用 Poisson/Dixon-Coles 反向拟合主客期望进球 lambda/mu
     （网格搜索，使模型算出的胜平负概率最接近公平概率）
  4. 用拟合出的 lambda/mu 计算 大小球 2.5 / 3.0 / 3.5 的 大/小 概率
  5. 输出公平大小球盘口与各线大球概率

用法:
  python tools/ou_calc.py --odds 1.35 5.45 7.18
  python tools/ou_calc.py --odds 1.35 5.45 7.18 --team "阿尔克马 vs 前进之鹰"
  python tools/ou_calc.py --json   # 输出JSON

说明: 从1X2反推lambda/mu是行业常用做法。若match有真实xG(xG_quant)可传入覆盖。
"""
import argparse
import json
import math
import sys

RHO = -0.13
MAX_GOALS = 8


def poisson_pmf(k, lam):
    return math.exp(-lam) * (lam ** k) / math.factorial(k)


def dixon_coles_tau(x, y, lam, mu, rho=RHO):
    if x == 0 and y == 0:
        return 1 - (lam * mu * rho)
    if x == 0 and y == 1:
        return 1 + (lam * rho)
    if x == 1 and y == 0:
        return 1 + (mu * rho)
    if x == 1 and y == 1:
        return 1 - rho
    return 1.0


def score_matrix(lam, mu, max_goals=MAX_GOALS, rho=RHO):
    total = 0.0
    m = {}
    for x in range(max_goals + 1):
        for y in range(max_goals + 1):
            p = (poisson_pmf(x, lam) * poisson_pmf(y, mu)
                 * dixon_coles_tau(x, y, lam, mu, rho))
            m[(x, y)] = p
            total += p
    for k in m:
        m[k] /= total
    return m


def probs_from_lam_mu(lam, mu):
    m = score_matrix(lam, mu)
    ph = sum(p for (x, y), p in m.items() if x > y)
    pd = sum(p for (x, y), p in m.items() if x == y)
    pa = sum(p for (x, y), p in m.items() if x < y)
    return ph, pd, pa


def de_margin(odds):
    inv = [1 / o for o in odds]
    s = sum(inv)
    return [i / s for i in inv]


def fit_lambda_mu(odds):
    """从1X2公平概率反推 lambda/mu（网格+局部优化）"""
    ph, pd, pa = de_margin(odds)
    best = None
    best_err = 1e9
    # 粗网格
    lam = 0.4
    while lam <= 3.2:
        mu = 0.4
        while mu <= 3.2:
            eh, ed, ea = probs_from_lam_mu(lam, mu)
            err = (eh - ph) ** 2 + (ed - pd) ** 2 + (ea - pa) ** 2
            if err < best_err:
                best_err = err
                best = (lam, mu)
            mu += 0.1
        lam += 0.1
    # 细化
    b_lam, b_mu = best
    for lam in [b_lam - 0.05, b_lam, b_lam + 0.05]:
        for mu in [b_mu - 0.05, b_mu, b_mu + 0.05]:
            if lam <= 0.2 or mu <= 0.2:
                continue
            eh, ed, ea = probs_from_lam_mu(lam, mu)
            err = (eh - ph) ** 2 + (ed - pd) ** 2 + (ea - pa) ** 2
            if err < best_err:
                best_err = err
                best = (lam, mu)
    return best[0], best[1]


def over_under(lam, mu, line, max_goals=MAX_GOALS):
    """计算某大小球盘口(如2.5,3.0,3.5)的大球概率"""
    m = score_matrix(lam, mu, max_goals)
    over = sum(p for (x, y), p in m.items() if x + y > line)
    return over, 1 - over


def fair_ou_odds(lam, mu, line):
    """去水后公平大/小赔率（含~3%边际可选）"""
    over, under = over_under(lam, mu, line)
    return 1 / over, 1 / under


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--odds', nargs=3, type=float, required=True,
                    help='99家欧赔 主胜/平/客胜')
    ap.add_argument('--team', default='')
    ap.add_argument('--json', action='store_true')
    args = ap.parse_args()

    oh, od, oa = args.odds
    lam, mu = fit_lambda_mu((oh, od, oa))
    ph, pd, pa = de_margin((oh, od, oa))

    res = {
        'team': args.team,
        'odds_99': {'home': oh, 'draw': od, 'away': oa},
        'fair_prob': {'home': round(ph, 4), 'draw': round(pd, 4), 'away': round(pa, 4)},
        'expected_goals': {'home_lambda': round(lam, 3), 'away_mu': round(mu, 3),
                           'total_goals': round(lam + mu, 3)},
        'over_under': {},
    }
    for line in (2.5, 3.0, 3.5, 4.0):
        over, under = over_under(lam, mu, line)
        res['over_under'][str(line)] = {
            'over_prob': round(over, 4), 'under_prob': round(under, 4),
            'fair_over_odds': round(1 / over, 3), 'fair_under_odds': round(1 / under, 3),
        }

    if args.json:
        print(json.dumps(res, ensure_ascii=False, indent=2))
        return

    print(f"=== 大小球推导 (来自99家欧赔 {oh}/{od}/{oa}) ===")
    if args.team:
        print(f"场次: {args.team}")
    print(f"公平胜平负: 主{ph:.1%} 平{pd:.1%} 客{pa:.1%}")
    print(f"期望进球: 主λ={lam:.2f} 客μ={mu:.2f} 总={lam+mu:.2f}")
    print("\n大小球盘口  |  大球概率  |  小球概率  |  公平大赔  |  公平小赔")
    for line in (2.5, 3.0, 3.5, 4.0):
        o = res['over_under'][str(line)]
        print(f"   {line}       |   {o['over_prob']:.0%}   |   {o['under_prob']:.0%}   |   {o['fair_over_odds']:.2f}   |   {o['fair_under_odds']:.2f}")


if __name__ == '__main__':
    main()
