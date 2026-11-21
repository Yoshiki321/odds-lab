#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_xg.py — Understat xG 数据抓取器 (curl_cffi 穿透 Cloudflare)

从 Understat 抓取欧洲五大联赛的最新逐场 xG/xGA/npxG/npxGA 数据，
计算各队最近 N 场的滑动平均 npxG (非点球预期进球) 攻防指标。

用法:
    python tools/fetch_xg.py                  # 抓默认5大联赛，缓存原生数据
    python tools/fetch_xg.py --leagues EPL La_liga   # 指定联赛
    python tools/fetch_xg.py --last 10        # 最近10场滑动平均
    python tools/fetch_xg.py --refresh        # 强制重新抓取(忽略缓存)

数据输出:
    data/xg/raw_{league}_{season}.json     # 原生逐场数据
    data/xg/npxg_summary.csv               # 近N场npxG汇总CSV
"""

import argparse
import csv
import json
import os
import sys
import time
from datetime import datetime

from curl_cffi import requests as cr

# Understat 联赛代码 (按需增删)
# season: "2026" = 2026/27 当前赛季 (今天的盘口是 2026-08-29)
LEAGUES = {
    "EPL": "2026",        # 英超
    "La_liga": "2026",    # 西甲
    "Serie_A": "2026",    # 意甲
    "Bundesliga": "2026", # 德甲
    "Ligue_1": "2026",    # 法甲
}

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "xg")
RAW_CACHE_TTL = 6 * 3600  # 原生数据缓存 6 小时

# 联赛中文名映射
LEAGUE_CN = {
    "EPL": "英超",
    "La_liga": "西甲",
    "Serie_A": "意甲",
    "Bundesliga": "德甲",
    "Ligue_1": "法甲",
}


class UnderstatClient:
    """Understat API 客户端 (curl_cffi 模拟浏览器 TLS 指纹)"""

    def __init__(self):
        self.session = cr.Session(impersonate="chrome120")
        self.session.headers.update({
            "accept": "*/*",
            "accept-language": "en-US,en;q=0.9",
        })

    def _probe(self):
        """建立会话+cookie（访问主页，规避初次 404）"""
        self.session.get(
            "https://understat.com/",
            headers={"referer": "https://understat.com/"},
            timeout=20,
        )
        time.sleep(1.5)

    def get_league_data(self, league, season):
        """获取联赛逐场数据（含每队每场 xG/xGA/npxG/npxGA）"""
        url = f"https://understat.com/getLeagueData/{league}/{season}"
        r = self.session.get(
            url,
            headers={
                "referer": f"https://understat.com/league/{league}/{season}",
                "x-requested-with": "XMLHttpRequest",
            },
            timeout=30,
        )
        r.raise_for_status()
        return r.json()


def fetch_league(client, league, season, raw_path, force=False):
    """抓取单个联赛，优先用缓存"""
    if os.path.exists(raw_path) and not force:
        age = time.time() - os.path.getmtime(raw_path)
        if age < RAW_CACHE_TTL:
            print(f"  R: {league}: 用缓存 ({int(age//60)}min前)")
            with open(raw_path, "r", encoding="utf-8") as f:
                return json.load(f)

    print(f"  → {league}: 抓取 getLeagueData/{league}/{season} ...")
    try:
        data = client.get_league_data(league, season)
        with open(raw_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
        print(f"    [OK]  {league}: {len(data.get('teams', {}))} 队")
        time.sleep(1.0)  # 温和速率，避免封IP
        return data
    except Exception as e:
        print(f"    [X]  {league} 失败: {e}")
        return None


def compute_npxg_summary(raw_data, last_n=10, prior_weights=(0.4, 0.6)):
    """
    从原生数据计算各队最近 N 场加权滑动平均 npxG/npxGA。

    prior_weights: (本季权重, 上季基线权重) 二元组。
    赛季初期本季样本少(<5场)，用上赛季基线做收缩(shrinkage)，
    避免单场大胜造成 4.08 这类极端噪音。
    """
    teams = raw_data.get("teams", {})
    rows = []
    for tid, t in teams.items():
        title = t.get("title", f"ID{tid}")
        history = t.get("history", [])
        if not history:
            continue
        recent = history[-last_n:]  # 最近的N场（历史按时间顺序）
        n = len(recent)
        if n == 0:
            continue
        if n >= 5:
            # 样本足够，直接本季平均
            w_cur, w_prior = 1.0, 0.0
        else:
            w_cur, w_prior = prior_weights
        avg_npxg_for = sum(g["npxG"] for g in recent) / n
        avg_npxg_against = sum(g["npxGA"] for g in recent) / n
        # 若启用先验收缩，用上季整体均值（从同队上季数据或全局均值兜底）
        # 这里简单实现：季初用全局均值 1.3 收缩，防止极端值
        if w_prior > 0:
            GLOBAL = 1.3
            avg_npxg_for = w_cur * avg_npxg_for + w_prior * GLOBAL
            avg_npxg_against = w_cur * avg_npxg_against + w_prior * GLOBAL
        rows.append({
            "Team": title,
            "Sample_Games": n,
            "Avg_npxG_For": round(avg_npxg_for, 3),
            "Avg_npxG_Against": round(avg_npxg_against, 3),
            "Net_npxG_Diff": round(avg_npxg_for - avg_npxg_against, 3),
        })
    rows.sort(key=lambda r: r["Net_npxG_Diff"], reverse=True)
    return rows


def main():
    ap = argparse.ArgumentParser(description="Understat xG 数据抓取器")
    ap.add_argument("--leagues", nargs="+", default=list(LEAGUES.keys()),
                    help="联赛代码，默认全部")
    ap.add_argument("--last", type=int, default=10,
                    help="滑动平均窗口（场次）默认10")
    ap.add_argument("--refresh", action="store_true",
                    help="强制重新抓取(忽略缓存)")
    args = ap.parse_args()

    os.makedirs(DATA_DIR, exist_ok=True)
    client = UnderstatClient()
    client._probe()

    print(f"[*] Understat xG 抓取开始 ({datetime.now().strftime('%H:%M:%S')})")
    raw_data = {}
    for league in args.leagues:
        if league not in LEAGUES:
            print(f"  ! 未知联赛 {league}, 跳过")
            continue
        season = LEAGUES[league]
        raw_path = os.path.join(DATA_DIR, f"raw_{league}_{season}.json")
        d = fetch_league(client, league, season, raw_path, args.refresh)
        if d is not None:
            raw_data[league] = d

    if not raw_data:
        print("[!] 未获取到任何数据")
        sys.exit(1)

    # 汇总 npxG
    all_rows = []
    for league, d in raw_data.items():
        rows = compute_npxg_summary(d, last_n=args.last)
        for r in rows:
            r["League"] = LEAGUE_CN.get(league, league)
        all_rows.extend(rows)

    # 排序并写 CSV
    all_rows.sort(key=lambda r: (r["League"], -r["Net_npxG_Diff"]))
    summary_path = os.path.join(DATA_DIR, "npxg_summary.csv")
    with open(summary_path, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=["League", "Team", "Sample_Games",
                                               "Avg_npxG_For", "Avg_npxG_Against",
                                               "Net_npxG_Diff"])
        writer.writeheader()
        writer.writerows(all_rows)

    print(f"\n[+] npxG 汇总已存: {summary_path} ({len(all_rows)} 条)")
    print(f"[+] 最近 {args.last} 场平均 npxG 头部:")
    for r in all_rows[:12]:
        print(f"    {r['League']:5} {r['Team']:22} "
              f"{r['Avg_npxG_For']:.2f}/{(r['Avg_npxG_Against']):.2f} "
              f"净{r['Net_npxG_Diff']:+.2f}")


if __name__ == "__main__":
    main()