# -*- coding: utf-8 -*-
"""
tools/ou_all.py — 批量计算今日竞彩场次的大小球盘口（来自99家欧赔）

读取 data/today/YYYY-MM-DD.json 的竞彩场次，用对应用户的99家欧赔
（优先用 okooo 缓存，否则用竞彩胜平负），输出每场 大小球2.5/3.0/3.5 概率与公平赔率。

用法:
  python tools/ou_all.py                    # 今日场次
  python tools/ou_all.py --date 2026-08-29  # 指定日期
  python tools/ou_all.py --json             # JSON输出
"""
import argparse
import json
import io
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ou_calc import fit_lambda_mu, over_under, de_margin

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OU_DIR = os.path.join(ROOT, 'data', 'ou')


def load_okooo_list():
    """读取 okooo 竞彩列表，返回 [{num,league,homeTeam,awayTeam,matchId,rq}]"""
    list_path = os.path.join(ROOT, 'data', 'okooo_cache', 'jingcai_list.json')
    if not os.path.exists(list_path):
        return []
    try:
        d = json.load(open(list_path, encoding='utf-8'))
        return d.get('matches', [])
    except Exception:
        return []


def load_okooo_99():
    """从 okooo 详情缓存取每场 99家欧赔（key=okooomatchId -> (h,d,a)）"""
    cache_dir = os.path.join(ROOT, 'data', 'okooo_cache')
    result = {}
    if not os.path.isdir(cache_dir):
        return result
    for f in os.listdir(cache_dir):
        if not f.endswith('.json') or f == 'jingcai_list.json':
            continue
        try:
            d = json.load(open(os.path.join(cache_dir, f), encoding='utf-8'))
        except Exception:
            continue
        hr = (d.get('homeRecent') or [])
        if hr and hr[0].get('odds99Home'):
            mid = d.get('matchId')
            result[mid] = (hr[0]['odds99Home'], hr[0]['odds99Draw'], hr[0]['odds99Away'])
    return result


def match_okooo(matches, okooo_list, okooo_99):
    """为竞彩场次关联 okooo 的 99家欧赔（优先真实市场盘，用首字匹配队伍）"""
    mapped = {}
    for om in okooo_list:
        oh, oa = str(om.get('homeTeam', '')), str(om.get('awayTeam', ''))
        mid = str(om.get('matchId', ''))
        odds = okooo_99.get(mid)
        if not odds:
            continue
        mapped[(oh[:1], oa[:1])] = odds
    out = {}
    for m in matches:
        h, a = str(m['home'])[:1], str(m['away'])[:1]
        if (h, a) in mapped:
            out[m['num']] = mapped[(h, a)]
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--date', default=None)
    ap.add_argument('--json', action='store_true')
    args = ap.parse_args()

    import datetime
    date = args.date or datetime.date.today().isoformat()
    today_path = os.path.join(ROOT, 'data', 'today', f'{date}.json')
    if not os.path.exists(today_path):
        print(f'[X] 无今日文件: {today_path}')
        return

    today = json.load(open(today_path, encoding='utf-8'))
    okooo_list = load_okooo_list()
    okooo_99 = load_okooo_99()
    mapped_odds = match_okooo(today.get('matches', []), okooo_list, okooo_99)

    results = []
    for m in today.get('matches', []):
        home, away = m['home'], m['away']
        had = m.get('had') or {}
        # 优先: okooo 99家欧赔（真实市场，结算口径）; 备选: 竞彩胜平负
        odds = mapped_odds.get(m['num'])
        source = 'okooo_99'
        if not odds:
            try:
                if had.get('h') and had.get('d') and had.get('a'):
                    odds = (float(had['h']), float(had['d']), float(had['a']))
                    source = 'jingcai_had'
            except Exception:
                odds = None
        if not odds:
            continue

        lam, mu = fit_lambda_mu(odds)
        ph, pd, pa = de_margin(odds)
        lines = {}
        for line in (2.5, 3.0, 3.5):
            over, under = over_under(lam, mu, line)
            lines[str(line)] = {
                'over_prob': round(over, 4), 'under_prob': round(under, 4),
                'fair_over': round(1 / over, 3), 'fair_under': round(1 / under, 3),
            }
        results.append({
            'num': m['num'], 'league': m['league'],
            'home': home, 'away': away, 'kickoff': m.get('matchTime'),
            'expected_goals': {'home': round(lam, 2), 'away': round(mu, 2), 'total': round(lam + mu, 2)},
            'fair_prob': {'home': round(ph, 3), 'draw': round(pd, 3), 'away': round(pa, 3)},
            'ou': lines,
            'odds_source': source,
            'odds': odds,
        })

    os.makedirs(OU_DIR, exist_ok=True)
    out_path = os.path.join(OU_DIR, f'ou_{date}.json')
    json.dump({'date': date, 'generatedAt': datetime.datetime.now().isoformat(), 'matches': results},
              open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)

    if args.json:
        print(json.dumps({'date': date, 'count': len(results), 'file': out_path},
                         ensure_ascii=False))
        return

    buf = io.StringIO()
    buf.write(f'=== 大小球批量推导 ({date}) ===\n')
    for r in results:
        buf.write(f"{r['num']} {r['league']} {r['home']} vs {r['away']} 总球~{r['expected_goals']['total']:.2f}\n")
        for line, v in r['ou'].items():
            buf.write(f"   >{line}: 大{v['over_prob']:.0%}@公平{v['fair_over']:.2f} / 小{v['under_prob']:.0%}@公平{v['fair_under']:.2f}\n")
    buf.write(f"\n写入: {out_path}\n")
    print(buf.getvalue())


if __name__ == '__main__':
    main()
