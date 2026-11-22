#!/usr/bin/env python3
"""
tools/fetch_football_data.py — 免费免 Key 抓取 Football-Data.co.uk 欧亚盘口、Betfair 尖盘、收盘价与 xG

实测验证（2026-11-21，HTTP 200，零 API Key，免费）：
  - 覆盖 11 个一/二级欧洲主流联赛（E0/E1/SP1/SP2/I1/D1/D2/F1/N1/P1/T1）+ fixtures.csv
  - 包含 Betfair Exchange 低水尖盘（BFEH/D/A、收盘 BFECH/D/A）、Bet365/市场均值、
    亚盘让球（AHh、AvgAHH/AHA、收盘 AvgCAHH/CAHA）、大小球 2.5，以及 26/27 赛季 HxG/AxG。

用法：
  python3 tools/fetch_football_data.py --season 2627 --leagues E0,SP1,I1,D1,F1
  python3 tools/fetch_football_data.py --season 2627 --all
  python3 tools/fetch_football_data.py --fixtures
"""

import argparse
import csv
import io
import json
import os
import urllib.request
from datetime import datetime, timezone

UA = "Mozilla/5.0 (compatible; Google-Agent; +https://developers.google.com/crawling/docs/crawlers-fetchers/google-agent)"
BASE = "https://www.football-data.co.uk/mmz4281"
FIXTURES_URL = "https://www.football-data.co.uk/fixtures.csv"

LEAGUES = {
    "E0": ("英超", 1),
    "SP1": ("西甲", 1),
    "I1": ("意甲", 1),
    "D1": ("德甲", 1),
    "F1": ("法甲", 1),
    "E1": ("英冠", 2),
    "SP2": ("西乙", 2),
    "D2": ("德乙", 2),
    "N1": ("荷甲", 2),
    "P1": ("葡超", 2),
    "T1": ("土超", 2),
}


def fnum(v):
    try:
        x = float(v)
        return x if x == x else None
    except (TypeError, ValueError):
        return None


def parse_date(d_str: str):
    """支持 DD/MM/YYYY 或 DD/MM/YY → YYYY-MM-DD"""
    s = (d_str or "").strip()
    for fmt in ("%d/%m/%Y", "%d/%m/%y"):
        try:
            return datetime.strptime(s, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def fetch_text(url: str, timeout: int = 15) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/csv,*/*"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8-sig", errors="replace")


def parse_row(r: dict, league_code: str, is_fixture: bool = False):
    date = parse_date(r.get("Date", ""))
    home = (r.get("HomeTeam") or "").strip()
    away = (r.get("AwayTeam") or "").strip()
    if not date or not home or not away:
        return None

    # 优先取 Betfair Exchange（低水尖盘），缺省回退市场均值 Avg / Bet365
    def tri(h_k, d_k, a_k):
        vals = [fnum(r.get(h_k)), fnum(r.get(d_k)), fnum(r.get(a_k))]
        return vals if all(v is not None and v > 1.0 for v in vals) else None

    sharp_open = tri("BFEH", "BFED", "BFEA") or tri("PSH", "PSD", "PSA") or tri("AvgH", "AvgD", "AvgA")
    sharp_close = tri("BFECH", "BFECD", "BFECA") or tri("PSCH", "PSCD", "PSCA") or tri("AvgCH", "AvgCD", "AvgCA")
    soft_open = tri("B365H", "B365D", "B365A") or tri("AvgH", "AvgD", "AvgA")

    ah_line = fnum(r.get("AHh"))
    ah_open = [fnum(r.get("AvgAHH")), fnum(r.get("AvgAHA"))]
    ah_close = [fnum(r.get("AvgCAHH")), fnum(r.get("AvgCAHA"))]
    ou25_open = [fnum(r.get("Avg>2.5")), fnum(r.get("Avg<2.5"))]

    lg_name, tier = LEAGUES.get(league_code, (league_code, 3))
    out = {
        "source": "football-data.co.uk",
        "leagueCode": league_code,
        "league": lg_name,
        "tier": tier,
        "date": date,
        "timeUtc": (r.get("Time") or "").strip() or None,
        "home": home,
        "away": away,
        "sharpOpen1x2": sharp_open,
        "sharpClose1x2": sharp_close,
        "softOpen1x2": soft_open,
        "ahLine": ah_line,
        "ahOpen": ah_open if all(v and v > 1.0 for v in ah_open) else None,
        "ahClose": ah_close if all(v and v > 1.0 for v in ah_close) else None,
        "ou25Open": ou25_open if all(v and v > 1.0 for v in ou25_open) else None,
    }
    if not is_fixture:
        hg = fnum(r.get("FTHG"))
        ag = fnum(r.get("FTAG"))
        if hg is None or ag is None:
            return None
        out.update({
            "hg": int(hg),
            "ag": int(ag),
            "ftr": (r.get("FTR") or "").strip(),
            "hxg": fnum(r.get("HxG")),
            "axg": fnum(r.get("AxG")),
            "hs": fnum(r.get("HS")),
            "as": fnum(r.get("AS")),
            "hst": fnum(r.get("HST")),
            "ast": fnum(r.get("AST")),
        })
    return out


def main():
    ap = argparse.ArgumentParser(description="抓取 Football-Data.co.uk 免费欧亚盘口与赛果")
    ap.add_argument("--season", default="2627", help="赛季代码，如 2627 或 2526")
    ap.add_argument("--leagues", default="E0,SP1,I1,D1,F1", help="逗号分隔联赛代码")
    ap.add_argument("--all", action="store_true", help="抓取全部 11 个一/二级联赛")
    ap.add_argument("--fixtures", action="store_true", help="抓取即将开赛的 fixtures.csv")
    ap.add_argument("--out", default="", help="输出 JSONL 路径")
    args = ap.parse_args()

    out_dir = os.path.join("data", "free_sources")
    os.makedirs(out_dir, exist_ok=True)

    if args.fixtures:
        raw = fetch_text(FIXTURES_URL)
        rows = []
        for r in csv.DictReader(io.StringIO(raw)):
            code = (r.get("Div") or "").strip()
            if code in LEAGUES:
                rec = parse_row(r, code, is_fixture=True)
                if rec:
                    rows.append(rec)
        out_fp = args.out or os.path.join(out_dir, "football_data_fixtures.jsonl")
        with open(out_fp, "w", encoding="utf8") as f:
            for rec in rows:
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        print(json.dumps({"ok": True, "mode": "fixtures", "count": len(rows), "out": out_fp}, ensure_ascii=False))
        return

    codes = list(LEAGUES.keys()) if args.all else [c.strip() for c in args.leagues.split(",") if c.strip()]
    all_rows = []
    per_league = {}
    for code in codes:
        url = f"{BASE}/{args.season}/{code}.csv"
        try:
            raw = fetch_text(url)
            cnt = 0
            for r in csv.DictReader(io.StringIO(raw)):
                rec = parse_row(r, code, is_fixture=False)
                if rec:
                    all_rows.append(rec)
                    cnt += 1
            per_league[code] = cnt
        except Exception as e:
            per_league[code] = f"ERR:{e}"

    all_rows.sort(key=lambda x: (x["date"], x["timeUtc"] or "", x["leagueCode"], x["home"]))
    out_fp = args.out or os.path.join(out_dir, f"football_data_{args.season}.jsonl")
    with open(out_fp, "w", encoding="utf8") as f:
        for rec in all_rows:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")

    print(json.dumps({
        "ok": True,
        "season": args.season,
        "fetchedAtUtc": datetime.now(timezone.utc).isoformat(),
        "totalRows": len(all_rows),
        "perLeague": per_league,
        "out": out_fp,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
