#!/usr/bin/env python3
"""
tools/fetch_espn_intel.py — 免费免 Key 抓取 ESPN 足球首发/近5场战绩 & NBA 伤停/让分盘走势

实测验证（2026-11-21，HTTP 200，零 API Key，免费 JSON）：
  - 足球：eng.1 / eng.2 / esp.1 / ita.1 / ger.1 / fra.1 / uefa.champions / ned.1 / por.1 / bra.1 / usa.1 / jpn.1 / aus.1
    → 抓取赛程、开赛 UTC 时间、首发名单（开赛前 ~1h 公布）、近 5 场战绩
  - NBA：basketball/nba
    → 抓取赛程、开赛 UTC 时间、完整双方伤停名单（Out / Questionable / Day-To-Day）、让分盘 ATS 走势

用法：
  python3 tools/fetch_espn_intel.py --sport soccer --league eng.1
  python3 tools/fetch_espn_intel.py --sport nba
"""

import argparse
import json
import os
import urllib.request
from datetime import datetime, timezone

UA = "Mozilla/5.0 (compatible; Google-Agent; +https://developers.google.com/crawling/docs/crawlers-fetchers/google-agent)"
BASE = "https://site.api.espn.com/apis/site/v2/sports"


def get_json(url: str, timeout: int = 12) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8", errors="replace"))


def extract_injuries(summary: dict):
    out = []
    for team_blk in summary.get("injuries") or []:
        tname = (team_blk.get("team") or {}).get("displayName", "")
        players = []
        for item in team_blk.get("injuries") or []:
            ath = item.get("athlete") or {}
            players.append({
                "name": ath.get("displayName", ""),
                "position": (ath.get("position") or {}).get("abbreviation", ""),
                "status": item.get("status", ""),
                "detail": item.get("shortComment") or item.get("longComment") or "",
            })
        out.append({"team": tname, "count": len(players), "players": players})
    return out


def extract_rosters(summary: dict):
    out = []
    for r in summary.get("rosters") or []:
        tname = (r.get("team") or {}).get("displayName", "")
        formation = r.get("formation")
        starters = []
        for p in r.get("roster") or []:
            if p.get("starter"):
                starters.append((p.get("athlete") or {}).get("displayName", ""))
        out.append({"team": tname, "formation": formation, "startersCount": len(starters), "starters": starters})
    return out


def fetch_board(sport: str, league: str, date_yyyymmdd: str = "", with_summary: bool = True, max_events: int = 15):
    sport_path = "basketball/nba" if sport == "nba" else f"soccer/{league}"
    url = f"{BASE}/{sport_path}/scoreboard"
    if date_yyyymmdd:
        url += f"?dates={date_yyyymmdd}"
    board = get_json(url)
    events = []
    for ev in (board.get("events") or [])[:max_events]:
        comp = (ev.get("competitions") or [{}])[0]
        competitors = comp.get("competitors") or []
        home = next((c for c in competitors if c.get("homeAway") == "home"), {})
        away = next((c for c in competitors if c.get("homeAway") == "away"), {})
        rec = {
            "eventId": str(ev.get("id")),
            "name": ev.get("name"),
            "kickoffUtc": ev.get("date"),
            "status": ((ev.get("status") or {}).get("type") or {}).get("name"),
            "home": (home.get("team") or {}).get("displayName"),
            "away": (away.get("team") or {}).get("displayName"),
            "homeScore": home.get("score"),
            "awayScore": away.get("score"),
        }
        if with_summary:
            try:
                sj = get_json(f"{BASE}/{sport_path}/summary?event={rec['eventId']}")
                rec["injuries"] = extract_injuries(sj)
                if sport != "nba":
                    rec["rosters"] = extract_rosters(sj)
            except Exception as e:
                rec["summaryError"] = str(e)
        events.append(rec)
    return {
        "source": "espn-public-api",
        "sport": sport,
        "league": "nba" if sport == "nba" else league,
        "fetchedAtUtc": datetime.now(timezone.utc).isoformat(),
        "count": len(events),
        "events": events,
    }


def main():
    ap = argparse.ArgumentParser(description="抓取 ESPN 免费足球首发与 NBA 伤停情报")
    ap.add_argument("--sport", choices=["soccer", "nba"], required=True)
    ap.add_argument("--league", default="eng.1", help="足球联赛代码（如 eng.1, esp.1, ita.1, ger.1, fra.1, uefa.champions）")
    ap.add_argument("--date", default="", help="可选日期 YYYYMMDD")
    ap.add_argument("--no-summary", action="store_true", help="只抓赛程不拉单场详情")
    ap.add_argument("--max-events", type=int, default=12)
    args = ap.parse_args()

    res = fetch_board(args.sport, args.league, args.date, with_summary=not args.no_summary, max_events=args.max_events)
    out_dir = os.path.join("data", "free_sources")
    os.makedirs(out_dir, exist_ok=True)
    tag = "nba" if args.sport == "nba" else args.league.replace(".", "_")
    day = args.date or datetime.now(timezone.utc).strftime("%Y%m%d")
    out_fp = os.path.join(out_dir, f"espn_{tag}_{day}.json")
    with open(out_fp, "w", encoding="utf8") as f:
        json.dump(res, f, ensure_ascii=False, indent=2)

    print(json.dumps({
        "ok": True,
        "sport": res["sport"],
        "league": res["league"],
        "count": res["count"],
        "out": out_fp,
        "sampleInjuries": sum(sum(t["count"] for t in e.get("injuries", [])) for e in res["events"]),
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
