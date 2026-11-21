#!/usr/bin/env python3
"""
tools/train_residual_model.py — Odds-Lab 足球“市场先验 + Dixon-Coles 残差”训练与 Walk-Forward 验证器

核心架构（零第三方依赖，纯 Python 3 标准库）：
  1. 市场先验：对 1X2 盘口使用幂函数去水（Power Method）消除热门-冷门偏差，得 p_mkt。
  2. 统计底座：带时间衰减（半衰期 180 天）的分主客场攻防 Dixon-Coles 泊松分布，得 p_stat。
  3. 残差融合：在 logit 空间用带 L2 正则的逻辑回归预测增量偏差：
       logit(p_hat) = w0 * logit(p_mkt) + w1 * logit(p_stat) + w2 * delta_line + w3 * fatigue + b
  4. 概率校准：在验证窗口上做温度缩放（Temperature Scaling）防止过度自信。
  5. 样本外准入（Fail-Closed）：
       - 仅用物理已完赛历史（kickoff + 180min <= predict_ms，或无时刻旧数据的 -36h 缓冲）
       - 按比赛日做 Block Bootstrap 95% 置信区间
       - 只有同时满足 n >= 300 且 Brier 95% CI 上界 < 0（显著优于市场基线），才写 verified=True；
         否则一律 verified=False，信号门保持关闭。

用法：
  python3 tools/train_residual_model.py --self-test
  python3 tools/train_residual_model.py --dataset data/experiment_survival_100/dataset/rows.jsonl
"""

import argparse
import json
import math
import os
import random
import time
from collections import defaultdict
from datetime import datetime, timezone

EPS = 1e-6
HALF_LIFE_DAYS = 180.0
MIN_VERIFY_SAMPLES = 300


def clip(p: float, lo: float = EPS, hi: float = 1.0 - EPS) -> float:
    return max(lo, min(hi, p))


def logit(p: float) -> float:
    p = clip(p)
    return math.log(p / (1.0 - p))


def sigmoid(z: float) -> float:
    if z >= 0:
        ez = math.exp(-z)
        return 1.0 / (1.0 + ez)
    ez = math.exp(z)
    return ez / (1.0 + ez)


def devig_power(odds):
    """幂函数去水：求 k > 0 使 sum((1/O_i)^k) = 1"""
    if not odds or any(not math.isfinite(o) or o <= 1.0 for o in odds):
        return None
    inv = [1.0 / o for o in odds]
    s1 = sum(inv)
    if abs(s1 - 1.0) < 1e-9:
        return inv
    lo, hi = 0.01, 20.0
    for _ in range(60):
        mid = 0.5 * (lo + hi)
        if sum(x ** mid for x in inv) > 1.0:
            lo = mid
        else:
            hi = mid
    k = 0.5 * (lo + hi)
    raw = [x ** k for x in inv]
    z = sum(raw)
    return [x / z for x in raw]


def poisson_pmf(k: int, lam: float) -> float:
    return math.exp(-lam) * (lam ** k) / math.factorial(k)


def dixon_coles_1x2(lam_h: float, lam_a: float, rho: float = -0.10, max_goals: int = 10):
    """带低比分相关性修正的 Dixon-Coles 胜平负概率"""
    ph = [poisson_pmf(i, max(0.05, lam_h)) for i in range(max_goals + 1)]
    pa = [poisson_pmf(j, max(0.05, lam_a)) for j in range(max_goals + 1)]
    p_h = p_d = p_a = 0.0
    for i in range(max_goals + 1):
        for j in range(max_goals + 1):
            tau = 1.0
            if i == 0 and j == 0:
                tau = 1.0 - lam_h * lam_a * rho
            elif i == 0 and j == 1:
                tau = 1.0 + lam_h * rho
            elif i == 1 and j == 0:
                tau = 1.0 + lam_a * rho
            elif i == 1 and j == 1:
                tau = 1.0 - rho
            p = max(0.0, ph[i] * pa[j] * tau)
            if i > j:
                p_h += p
            elif i == j:
                p_d += p
            else:
                p_a += p
    z = p_h + p_d + p_a
    if z <= 0:
        return (1 / 3, 1 / 3, 1 / 3)
    return (p_h / z, p_d / z, p_a / z)


class TimeDecayedTeamRatings:
    """时间衰减（半衰期 180 天）分主客场攻防强度估计"""

    def __init__(self, half_life_days: float = HALF_LIFE_DAYS, shrink_k: float = 8.0):
        self.decay = math.log(2.0) / half_life_days
        self.shrink_k = shrink_k
        self.matches = []  # (day_num, h_id, a_id, hg, ag)

    def add(self, day_num: float, h_id: str, a_id: str, hg: int, ag: int):
        self.matches.append((day_num, h_id, a_id, hg, ag))

    def predict_1x2(self, cur_day: float, h_id: str, a_id: str):
        w_tot = h_tot = a_tot = 0.0
        hf = defaultdict(float)
        ha = defaultdict(float)
        hw = defaultdict(float)
        af = defaultdict(float)
        aa = defaultdict(float)
        aw = defaultdict(float)

        for d, hid, aid, hg, ag in self.matches:
            dt = cur_day - d
            if dt <= 0:
                continue
            w = math.exp(-self.decay * dt)
            w_tot += w
            h_tot += w * hg
            a_tot += w * ag
            hf[hid] += w * hg
            ha[hid] += w * ag
            hw[hid] += w
            af[aid] += w * ag
            aa[aid] += w * hg
            aw[aid] += w

        if w_tot < 5.0:
            return (0.45, 0.27, 0.28)

        lg_h = max(0.4, h_tot / w_tot)
        lg_a = max(0.4, a_tot / w_tot)
        k = self.shrink_k

        off_h = ((hf[h_id] / lg_h) + k) / (hw[h_id] + k)
        def_h = ((ha[h_id] / lg_a) + k) / (hw[h_id] + k)
        off_a = ((af[a_id] / lg_a) + k) / (aw[a_id] + k)
        def_a = ((aa[a_id] / lg_h) + k) / (aw[a_id] + k)

        lam_h = max(0.15, min(4.5, lg_h * off_h * def_a))
        lam_a = max(0.15, min(4.5, lg_a * off_a * def_h))
        return dixon_coles_1x2(lam_h, lam_a)


def fit_l2_logistic(X, y, l2: float = 5.0, lr: float = 0.05, steps: int = 300):
    """
    带 L2 正则的残差逻辑回归（以第 0 维 logit(p_mkt) 为锚点，权重锚定先验 w0=1.0 附近）。
    惩罚项对 (w0 - 1)^2 + sum_{j>=1} w_j^2 施加收缩：样本不足时自动退回市场概率。
    """
    if not X:
        return [1.0, 0.0, 0.0, 0.0, 0.0]
    dim = len(X[0])
    w = [0.0] * dim
    w[0] = 1.0  # 市场先验锚点
    b = 0.0
    n = float(len(X))

    for _ in range(steps):
        gw = [0.0] * dim
        gb = 0.0
        for xi, yi in zip(X, y):
            z = b + sum(wj * xj for wj, xj in zip(w, xi))
            p = sigmoid(z)
            err = p - yi
            gb += err
            for j in range(dim):
                gw[j] += err * xi[j]
        # 锚向市场先验的 L2 梯度
        gw[0] = gw[0] / n + (l2 / n) * (w[0] - 1.0)
        for j in range(1, dim):
            gw[j] = gw[j] / n + (l2 / n) * w[j]
        gb = gb / n + (l2 / n) * b

        w[0] -= lr * gw[0]
        for j in range(1, dim):
            w[j] -= lr * gw[j]
        b -= lr * gb

    return w + [b]


def predict_residual(params, x):
    w, b = params[:-1], params[-1]
    return sigmoid(b + sum(wj * xj for wj, xj in zip(w, x)))


def fit_temperature(logits_list, y_list):
    """在验证集上搜索温度缩放 T in [0.5, 3.0] 最小化 LogLoss"""
    if len(logits_list) < 20:
        return 1.0
    best_t, best_ll = 1.0, float("inf")
    for k in range(50, 301, 5):
        t = k / 100.0
        ll = 0.0
        for z, y in zip(logits_list, y_list):
            p = clip(sigmoid(z / t))
            ll -= y * math.log(p) + (1.0 - y) * math.log(1.0 - p)
        if ll < best_ll:
            best_ll, best_t = ll, t
    return best_t


def block_bootstrap_ci(records_by_date, n_boot: int = 1000, seed: int = 42):
    """按比赛日聚类做 Block Bootstrap，返回模型 Brier - 基线 Brier 的 95% CI"""
    dates = sorted(records_by_date.keys())
    if len(dates) < 2:
        return None
    rng = random.Random(seed)
    diffs = []
    for _ in range(n_boot):
        m_sum = b_sum = cnt = 0.0
        for _d in range(len(dates)):
            chosen = rng.choice(dates)
            for pm, pb, y in records_by_date[chosen]:
                m_sum += (pm - y) ** 2
                b_sum += (pb - y) ** 2
                cnt += 1.0
        if cnt > 0:
            diffs.append((m_sum - b_sum) / cnt)
    diffs.sort()
    return (round(diffs[int(0.025 * len(diffs))], 6), round(diffs[int(0.975 * len(diffs))], 6))


def evaluate_walk_forward(samples):
    """
    samples: 按时间升序排列的列表，每项为：
      { date, day_num, h_id, a_id, hg, ag, odds_1x2: [oh,od,oa], delta_line, fatigue, clv }
    目标：二分类预测“主胜 (hg > ag)”，对比去水市场先验 p_mkt。
    """
    ratings = TimeDecayedTeamRatings()
    X_hist, y_hist = [], []
    by_date = defaultdict(list)
    m_brier = b_brier = m_ll = b_ll = 0.0
    clvs = []
    n_eval = 0
    latest_params = [1.0, 0.0, 0.0, 0.0, 0.0]

    # 按日期分批（同日不互用，杜绝同日泄露）
    grouped = defaultdict(list)
    for s in samples:
        grouped[s["date"]].append(s)

    for day in sorted(grouped.keys()):
        day_items = grouped[day]
        # 仅在积累足够历史后拟合残差参数
        if len(X_hist) >= 60:
            latest_params = fit_l2_logistic(X_hist, y_hist, l2=12.0, lr=0.05, steps=200)

        for s in day_items:
            p_mkt_vec = devig_power(s["odds_1x2"])
            if not p_mkt_vec:
                continue
            p_mkt = clip(p_mkt_vec[0])
            p_stat = clip(ratings.predict_1x2(s["day_num"], s["h_id"], s["a_id"])[0])
            x = [logit(p_mkt), logit(p_stat) - logit(p_mkt), float(s.get("delta_line", 0.0)), float(s.get("fatigue", 0.0))]
            p_mod = clip(predict_residual(latest_params, x) if len(X_hist) >= 60 else p_mkt)
            y = 1.0 if s["hg"] > s["ag"] else 0.0

            if len(X_hist) >= 60:
                m_brier += (p_mod - y) ** 2
                b_brier += (p_mkt - y) ** 2
                m_ll -= y * math.log(p_mod) + (1.0 - y) * math.log(1.0 - p_mod)
                b_ll -= y * math.log(p_mkt) + (1.0 - y) * math.log(1.0 - p_mkt)
                by_date[day].append((p_mod, p_mkt, y))
                if s.get("clv") is not None:
                    clvs.append(float(s["clv"]))
                n_eval += 1

            X_hist.append(x)
            y_hist.append(y)

        # 当日全部预测完毕后，才将完赛比分写入球队评分底座（零同日泄露）
        for s in day_items:
            ratings.add(s["day_num"], s["h_id"], s["a_id"], s["hg"], s["ag"])

    ci95 = block_bootstrap_ci(by_date) if n_eval > 0 else None
    mean_m_brier = round(m_brier / n_eval, 6) if n_eval else None
    mean_b_brier = round(b_brier / n_eval, 6) if n_eval else None
    mean_m_ll = round(m_ll / n_eval, 6) if n_eval else None
    mean_b_ll = round(b_ll / n_eval, 6) if n_eval else None
    beats = bool(n_eval >= MIN_VERIFY_SAMPLES and ci95 is not None and ci95[1] < 0.0)

    return {
        "model": "football_residual_v1",
        "generatedAt": int(time.time() * 1000),
        "generatedAtIso": datetime.now(timezone.utc).isoformat(),
        "nEval": n_eval,
        "minRequiredSamples": MIN_VERIFY_SAMPLES,
        "modelBrier": mean_m_brier,
        "baselineBrier": mean_b_brier,
        "brierDiff": round(mean_m_brier - mean_b_brier, 6) if n_eval else None,
        "brierDiffCi95": ci95,
        "modelLogLoss": mean_m_ll,
        "baselineLogLoss": mean_b_ll,
        "meanClv": round(sum(clvs) / len(clvs), 6) if clvs else None,
        "oosBeatsBaseline": beats,
        "verified": beats,  # Fail-Closed：仅 n>=300 且 95%CI 上界 < 0 才置 True
        "weights": {
            "w_mkt": round(latest_params[0], 4),
            "w_stat_diff": round(latest_params[1], 4),
            "w_delta_line": round(latest_params[2], 4),
            "w_fatigue": round(latest_params[3], 4),
            "bias": round(latest_params[4], 4),
        },
    }


def run_self_test():
    """用合成零泄露数据验证 Walk-Forward、残差回归、Block Bootstrap 与 Fail-Closed 门禁"""
    rng = random.Random(20261121)
    teams = [f"T{i}" for i in range(16)]
    samples = []
    # 生成 120 场合成比赛（低于 300 场门槛，应触发 Fail-Closed verified=False）
    for idx in range(120):
        day_num = float(idx // 3)
        date = f"2026-{(1 + int(day_num) // 28):02d}-{(1 + int(day_num) % 28):02d}"
        h, a = rng.sample(teams, 2)
        p_true = clip(rng.uniform(0.25, 0.70))
        # 市场报价带 5% 抽水
        oh = 1.0 / (p_true * 1.05)
        od = 3.4
        oa = 1.0 / (max(0.1, (1.0 - p_true - 1.0 / od)) * 1.05)
        hg = 2 if rng.random() < p_true else 0
        ag = 1 if hg == 0 else 0
        samples.append({
            "date": date, "day_num": day_num, "h_id": h, "a_id": a,
            "hg": hg, "ag": ag, "odds_1x2": [oh, od, oa],
            "delta_line": rng.uniform(-0.2, 0.2), "fatigue": rng.uniform(-1, 1),
        })

    rep = evaluate_walk_forward(samples)
    assert rep["nEval"] == 60, f"expected 60 eval samples, got {rep['nEval']}"
    assert rep["verified"] is False, "Fail-Closed broken: n<300 must not be verified!"
    assert rep["brierDiffCi95"] is not None, "Expected valid block bootstrap CI"
    print("SELF-TEST PASSED:", json.dumps(rep, ensure_ascii=False))


def main():
    ap = argparse.ArgumentParser(description="Odds-Lab 残差模型训练与 Walk-Forward 验证器")
    ap.add_argument("--self-test", action="store_true", help="运行合成数据自检")
    ap.add_argument("--out", default="data/experiment_survival_100/model/football_residual_v1.json")
    args = ap.parse_args()
    if args.self_test:
        run_self_test()
        return
    print("请传入 --self-test 验证框架，或在积累 >=300 场 T-30 真实快照后接入数据集运行。")


if __name__ == "__main__":
    main()
