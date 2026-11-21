#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
xg_quant.py — xG → Dixon-Coles → +EV 量化分析流水线

把 Understat 抓到的 npxG 攻防数据接入 Dixon-Coles 模型，
对竞彩场次做完整精算:
  1. 用两队最近 N 场 npxG 攻防净差 → 拟合预期进球 λ/μ
  2. Dixon-Coles 生成比分概率
  3. 机构欧赔去水
  4. +EV 期望值 + 1/4 凯利

用法:
    python tools/xg_quant.py "利物浦" "诺丁汉" --odds 1.30 4.75 6.70 --league 英超
    python tools/xg_quant.py --today            # 分析今日所有有xG数据的五大联赛场次
    python tools/xg_quant.py --today --json     # 输出JSON(供Node调用)

球队名匹配: sporttery中文名 ↔ npxg_summary.csv 英文名，靠映射表+模糊匹配
"""

import argparse
import csv
import json
import os
import re
import sys

from dixon_coles import calculate_match_probabilities, de_margin, calc_ev, fractional_kelly

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "xg")
TODAY_FILE = os.path.join(os.path.dirname(__file__), "..", "data", "today", "2026-08-29.json")

# sporttery中文名 → Understat英文名 映射（常用，可扩展）
TEAM_MAP = {
    # 英超
    "利物浦": "Liverpool", "诺丁汉": "Nottingham Forest", "诺丁汉森林": "Nottingham Forest",
    "阿森纳": "Arsenal", "曼城": "Man City", "曼彻斯特城": "Man City",
    "热刺": "Tottenham", "纽卡斯尔": "Newcastle", "伯恩茅斯": "Bournemouth",
    "埃弗顿": "Everton", "曼联": "Man United", "曼彻斯特联": "Man United",
    "维拉": "Aston Villa", "阿斯顿维拉": "Aston Villa", "伊普斯": "Ipswich",
    "伊普斯维奇": "Ipswich", "富勒姆": "Fulham", "桑德兰": "Sunderland",
    "利兹联": "Leeds United", "布伦特": "Brentford", "布伦特福德": "Brentford",
    "考文垂": "Coventry", "赫尔城": "Hull City", "切尔西": "Chelsea",
    "水晶宫": "Crystal Palace", "狼队": "Wolves", "南安普顿": "Southampton",
    "布莱顿": "Brighton", "西汉姆": "West Ham",
    # 德甲
    "拜仁": "Bayern Munich", "多特": "Borussia Dortmund", "勒沃库森": "Bayer Leverkusen",
    "莱比锡": "RasenBallsport Leipzig", "霍芬海姆": "Hoffenheim", "科隆": "FC Cologne",
    "沃尔夫斯堡": "Wolfsburg", "斯图加特": "VfB Stuttgart", "弗赖堡": "Freiburg",
    "奥格斯堡": "Augsburg", "法兰克福": "Eintracht Frankfurt", "柏林联合": "Union Berlin",
    "美因茨": "Mainz 05", "门兴": "Borussia M.Gladbach", "海登海姆": "FC Heidenheim",
    "波鸿": "Bochum", "圣保利": "St. Pauli", "不莱梅": "Werder Bremen",
    # 意甲
    "国际米兰": "Inter", "AC米兰": "AC Milan", "尤文": "Juventus",
    "那不勒斯": "Napoli", "罗马": "Roma", "拉齐奥": "Lazio", "亚特兰大": "Atalanta",
    # 西甲
    "皇马": "Real Madrid", "巴萨": "Barcelona", "巴塞罗那": "Barcelona",
    "马竞": "Atletico Madrid", "马德里竞技": "Atletico Madrid", "塞维利亚": "Sevilla",
    "毕尔巴鄂": "Athletic Club", "皇家社会": "Real Sociedad",
    # 法甲
    "巴黎": "PSG", "巴黎圣日耳曼": "PSG", "马赛": "Marseille",
    "里昂": "Lyon", "摩纳哥": "Monaco", "里尔": "Lille",
    "朗斯": "Lens", "斯特拉斯": "Strasbourg", "尼斯": "Nice",
    "巴黎FC": "Paris FC", "南特": "Nantes", "雷恩": "Rennes",
    "图卢兹": "Toulouse", "昂热": "Angers", "欧塞尔": "Auxerre",
    "勒阿弗尔": "Le Havre", "布雷斯特": "Brest", "梅斯": "Metz",
    "洛里昂": "Lorient",
    # 意甲
    "莱切": "Lecce", "博洛尼亚": "Bologna", "卡利亚里": "Cagliari",
    "科莫": "Como", "佛罗伦萨": "Fiorentina", "热那亚": "Genoa",
    "都灵": "Torino", "乌迪内斯": "Udinese", "帕尔马": "Parma Calcio 1913",
    "萨索洛": "Sassuolo", "维罗纳": "Verona", "克雷莫纳": "Cremonese",
    "比萨": "Pisa",
    # 西甲
    "奥萨苏纳": "Osasuna", "赫塔费": "Getafe", "皇家社会": "Real Sociedad",
    "西班牙人": "Espanyol", "贝蒂斯": "Real Betis", "莱万特": "Levante",
    "巴伦西亚": "Valencia", "塞尔塔": "Celta Vigo", "毕尔巴鄂": "Athletic Club",
    "塞维利亚": "Sevilla", "马竞": "Atletico Madrid", "马德里竞技": "Atletico Madrid",
    "阿拉维斯": "Alaves", "吉罗纳": "Girona", "马洛卡": "Mallorca",
    "巴列卡诺": "Rayo Vallecano", "奥维耶多": "Real Oviedo", "埃尔切": "Elche",
    "比利亚雷亚尔": "Villarreal", "拉科": "Deportivo",
    # 德甲补充
    "多特蒙德": "Borussia Dortmund", "莱红牛": "RasenBallsport Leipzig",
    "勒沃库森": "Bayer Leverkusen", "不来梅": "Werder Bremen",
    "汉堡": "Hamburger SV", "沙尔克04": "Schalke 04", "圣保利": "St. Pauli",
    # 英超补充
    "纽卡斯尔": "Newcastle United", "曼彻斯特联": "Manchester United",
    "曼彻斯特城": "Manchester City", "利兹联": "Leeds",
    "狼队": "Wolverhampton Wanderers", "伯恩利": "Burnley",
}


def load_npxg():
    """读取 npxg_summary.csv → {英文队名: {for, against, net, league}}"""
    path = os.path.join(DATA_DIR, "npxg_summary.csv")
    if not os.path.exists(path):
        print(f"[!] 无 npxg 数据，先运行 tools/fetch_xg.py")
        sys.exit(1)
    teams = {}
    with open(path, "r", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            teams[row["Team"]] = {
                "for": float(row["Avg_npxG_For"]),
                "against": float(row["Avg_npxG_Against"]),
                "net": float(row["Net_npxG_Diff"]),
                "league": row["League"],
                "games": int(row.get("Sample_Games") or 0),
            }
    return teams


def resolve_team(name, teams):
    """中文名 → npxG英文名（精确映射 + 模糊）"""
    if name in TEAM_MAP:
        key = TEAM_MAP[name]
        if key in teams:
            return key, teams[key]
    # 模糊匹配：英文名子串
    for en in teams:
        if name and (name.lower() in en.lower() or en.lower() in name.lower()):
            return en, teams[en]
    return None, None


def fit_lambda_mu(home_xg, away_xg, league_avg=1.35):
    """
    由两队 npxG 攻防净差拟合预期进球。
    用简化的相对攻防强度 + 主场优势近似：
      attack = 近N场 npxG_for
      defense = 近N场 npxG_against
      lambda = home_for * (away_against / league_avg)  (进攻×对方防守)
      mu     = away_for * (home_against / league_avg)
    """
    lam = home_xg["for"] * (away_xg["against"] / league_avg)
    mu = away_xg["for"] * (home_xg["against"] / league_avg)
    return max(0.1, lam), max(0.1, mu)


def analyze_match(home_cn, away_cn, odds, league_avg=1.35, teams=None):
    """单场完整精算，返回 dict 或错误信息"""
    if teams is None:
        teams = load_npxg()
    h_en, h_xg = resolve_team(home_cn, teams)
    a_en, a_xg = resolve_team(away_cn, teams)

    if not h_xg or not a_xg:
        return {"ok": False, "home": home_cn, "away": away_cn,
                "home_en": h_en, "away_en": a_en,
                "reason": f"缺xG数据: {home_cn}({h_en}) vs {away_cn}({a_en})"}

    lam, mu = fit_lambda_mu(h_xg, a_xg, league_avg)
    prob = calculate_match_probabilities(lam, mu)
    margin, fair = de_margin(odds)
    oh, od, oa = odds
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
    best = max(ev, key=lambda k: ev[k])
    best_cn = {"home": "主胜", "draw": "平局", "away": "客胜"}[best]

    # 季初小样本告警：任一方样本 < 5 场时，EV 仅供参考，不作为最终投注依据
    min_games = min(h_xg.get("games", 0), a_xg.get("games", 0))
    sample_warning = min_games < 5

    return {
        "ok": True,
        "home": home_cn, "away": away_cn,
        "home_en": h_en, "away_en": a_en,
        "npxg": {"home_for": h_xg["for"], "home_ag": h_xg["against"],
                 "away_for": a_xg["for"], "away_ag": a_xg["against"]},
        "lambda_mu": {"lambda": round(lam, 3), "mu": round(mu, 3)},
        "true_prob": {"home": prob["home_win"], "draw": prob["draw"],
                      "away": prob["away_win"]},
        "market": {"odds": list(odds), "margin_pct": round(margin * 100, 2),
                   "fair": list(fair)},
        "ev": {"home": round(ev["home"], 4), "draw": round(ev["draw"], 4),
               "away": round(ev["away"], 4)},
        "kelly_1over4": {"home": kelly["home"], "draw": kelly["draw"],
                         "away": kelly["away"]},
        "over_2.5": prob["over_2.5"],
        "best": {"pick": best, "pick_cn": best_cn,
                 "ev_pct": round(ev[best] * 100, 2),
                 "kelly_pct": round(kelly[best] * 100, 2)},
        "sample": {"min_games": min_games, "warning": sample_warning},
    }


def main():
    ap = argparse.ArgumentParser(description="xG → Dixon-Coles 量化分析")
    ap.add_argument("teams", nargs="*", help="主队 客队")
    ap.add_argument("--odds", nargs=3, type=float, help="欧赔 主 平 客")
    ap.add_argument("--league-avg", type=float, default=1.35, help="联赛平均进球")
    ap.add_argument("--today", action="store_true", help="分析今日场次")
    ap.add_argument("--json", action="store_true", help="输出JSON")
    args = ap.parse_args()

    teams = load_npxg()

    if args.today:
        if not os.path.exists(TODAY_FILE):
            print(f"[!] 无 {TODAY_FILE}")
            sys.exit(1)
        with open(TODAY_FILE, "r", encoding="utf-8") as f:
            t = json.load(f)
        arr = t if isinstance(t, list) else t.get("matches", t.get("data", []))
        results = []
        for m in arr:
            lg = m.get("league", "")
            if lg not in ("英超", "西甲", "意甲", "德甲", "法甲"):
                continue
            had = m.get("had") or {}
            if not had.get("h") or not had.get("d") or not had.get("a"):
                continue
            odds = [float(had["h"]), float(had["d"]), float(had["a"])]
            if any(o <= 1 for o in odds):
                continue
            r = analyze_match(m.get("home", ""), m.get("away", ""), tuple(odds),
                              args.league_avg, teams)
            r["num"] = m.get("num", ""); r["matchId"] = m.get("matchId", "")
            r["time"] = m.get("matchTime", "")
            results.append(r)
        results.sort(key=lambda r: r["num"])
        if args.json:
            print(json.dumps(results, ensure_ascii=False, indent=2))
        else:
            for r in results:
                if not r["ok"]:
                    print(f"{r.get('num','')} {r['home']}vs{r['away']}: {r['reason']}")
                    continue
                print(f"{r['num']} {r['home']}vs{r['away']} "
                      f"λ{r['lambda_mu']['lambda']}/μ{r['lambda_mu']['mu']} "
                      f"胜{r['true_prob']['home']:.0%}/平{r['true_prob']['draw']:.0%}/负{r['true_prob']['away']:.0%} "
                      f"EV胜{r['ev']['home']:+.1%}/平{r['ev']['draw']:+.1%}/负{r['ev']['away']:+.1%} "
                      f"[最优{r['best']['pick_cn']} {r['best']['ev_pct']:+.1f}%]"
                      f"{' [WARNING] 季初样本不足(N<5)，EV仅供参考，不作为最终投注依据' if r['sample']['warning'] else ''}")
        return

    if len(args.teams) != 2 or not args.odds:
        print("用法: python tools/xg_quant.py 主队 客队 --odds 主 平 客 [--league-avg X]")
        sys.exit(1)

    r = analyze_match(args.teams[0], args.teams[1], tuple(args.odds),
                      args.league_avg, teams)
    if args.json:
        print(json.dumps(r, ensure_ascii=False, indent=2))
    else:
        if not r["ok"]:
            print(f"[!] {r['reason']}")
        else:
            print(f"=== {r['home']} vs {r['away']} ===")
            print(f"npxG: {r['home']} {r['npxg']['home_for']}进/{r['npxg']['home_ag']}失"
                  f" vs {r['away']} {r['npxg']['away_for']}进/{r['npxg']['away_ag']}失")
            print(f"预期进球: λ={r['lambda_mu']['lambda']} μ={r['lambda_mu']['mu']}")
            print(f"真实概率: 主{r['true_prob']['home']:.2%} 平{r['true_prob']['draw']:.2%} 负{r['true_prob']['away']:.2%}")
            print(f"大2.5: {r['over_2.5']:.2%}")
            print(f"机构抽水: {r['market']['margin_pct']}%")
            print(f"+EV: 主{r['ev']['home']:+.2%} 平{r['ev']['draw']:+.2%} 负{r['ev']['away']:+.2%}")
            print(f"1/4凯利: 主{r['kelly_1over4']['home']:.3%} 平{r['kelly_1over4']['draw']:.3%} 负{r['kelly_1over4']['away']:.3%}")
            print(f"[最优] {r['best']['pick_cn']} EV{r['best']['ev_pct']:+.2f}% 仓位{r['best']['kelly_pct']:.2f}%")
            if r["sample"]["warning"]:
                print(f"[WARNING] 季初样本不足(N={r['sample']['min_games']}<5)，该EV仅供参考，不作为最终投注依据")


if __name__ == "__main__":
    main()