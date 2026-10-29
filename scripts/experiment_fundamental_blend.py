# -*- coding: utf-8 -*-
"""比较纯市场风偏、基本面周期与固定比例组合，不按回测结果拟合权重。"""
from pathlib import Path
from datetime import datetime, timezone
import json
import math

import numpy as np
import pandas as pd

from build_risk_appetite import (
    CACHE, DATA, GPR_FILE, series, ret, pct_score, metrics, max_drawdown,
    fred, load_gpr,
)

OUT = DATA / "risk_fundamental_experiment.json"
NEW_FRED = ["CFNAI", "INDPRO", "RSAFS"]


def backtest(score, spy_adj, cash, start="2014-01-01"):
    dates = spy_adj.loc[start:].index
    s = score.reindex(dates).ffill()
    spy_ret = spy_adj.pct_change(fill_method=None).reindex(dates)
    cash_ret = cash.reindex(dates).ffill().fillna(0)
    position = (s / 100).shift(1)
    cost = position.diff().abs().fillna(0) * 0.0005
    strategy = position * spy_ret + (1 - position) * cash_ret - cost
    valid = s.notna() & spy_ret.notna() & position.notna()
    dates = dates[valid]
    s, spy_ret, cash_ret = s.loc[dates], spy_ret.loc[dates], cash_ret.loc[dates]
    position, strategy = position.loc[dates], strategy.loc[dates]
    curve = (1 + strategy).cumprod()
    buyhold = (1 + spy_ret).cumprod()
    forward21 = spy_adj.pct_change(21, fill_method=None).shift(-21).reindex(dates) * 100
    periods = {}
    for name, lo, hi in [
        ("2015–2019", "2015-01-01", "2019-12-31"),
        ("2020–2022", "2020-01-01", "2022-12-31"),
        ("2023至今", "2023-01-01", "2099-12-31"),
    ]:
        mask = (dates >= lo) & (dates <= hi)
        if mask.sum() > 20:
            periods[name] = {
                "strategy": metrics(strategy.loc[mask], cash_ret.loc[mask]),
                "buyhold": metrics(spy_ret.loc[mask], cash_ret.loc[mask]),
            }
    return {
        "start": dates[0].strftime("%Y-%m-%d"), "end": dates[-1].strftime("%Y-%m-%d"),
        "strategy": metrics(strategy, cash_ret), "buyhold": metrics(spy_ret, cash_ret),
        "average_position": float(position.mean() * 100),
        "annual_turnover": float(position.diff().abs().sum() / len(position) * 252 * 100),
        "rank_ic_21d": float(s.corr(forward21, method="spearman")),
        "periods": periods,
        "curve": [[d.strftime("%Y-%m-%d"), round(float(curve.loc[d]), 5),
                   round(float(buyhold.loc[d]), 5)] for d in dates],
    }


def main():
    src = json.loads(CACHE.read_text(encoding="utf-8"))
    src.setdefault("fred", {})
    for sid in NEW_FRED:
        try:
            src["fred"][sid] = fred(sid)
            print("FRED", sid, src["fred"][sid][-1], flush=True)
        except Exception as exc:
            if sid not in src["fred"]:
                raise
            print("FRED_FAIL_USE_CACHE", sid, str(exc)[:120], flush=True)
    src["fetched_at"] = datetime.now(timezone.utc).isoformat()
    CACHE.write_text(json.dumps(src, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    y = {k: series(v.get("close"), k) for k, v in src["yahoo"].items()}
    spy_adj = series(src["yahoo"]["SPY"].get("adjclose"), "SPY_ADJ")
    f = {k: series(v, k) for k, v in src["fred"].items()}
    gpr = load_gpr()
    start = min(s.first_valid_index() for s in y.values() if not s.empty)
    end = max(s.last_valid_index() for s in y.values() if not s.empty)
    idx = pd.bdate_range(start, end)
    market = pd.DataFrame({k: s.reindex(idx).ffill(limit=5) for k, s in y.items()})
    cn_copper = series(src.get("sina", {}).get("SHFE_CU"), "SHFE_CU").reindex(idx, method="ffill")
    macro = pd.DataFrame({k: s.reindex(idx, method="ffill") for k, s in f.items()})
    macro["GPR7"] = gpr.reindex(idx, method="ffill")
    macro["NETLIQ"] = (macro["WALCL"] - macro["WTREGEN"] - macro["RRPONTSYD"] * 1000) / 1e6

    hy_oas = macro["BAMLH0A0HYM2"].shift(1)
    ig_oas = macro["BAMLC0A0CM"].shift(1)
    nfci = macro["NFCI"].shift(5)
    nfci_change = f["NFCI"].diff(13).reindex(idx, method="ffill").shift(5)
    claims = f["ICSA"].rolling(4).mean().pct_change(13, fill_method=None).reindex(idx, method="ffill").shift(5) * 100
    permits = f["PERMIT"].pct_change(12, fill_method=None).reindex(idx, method="ffill").shift(20) * 100
    wei = f["WEI"].diff(4).reindex(idx, method="ffill").shift(5)
    cfnai = f["CFNAI"].rolling(3).mean().reindex(idx, method="ffill").shift(20)
    indpro = ((f["INDPRO"] / f["INDPRO"].shift(3)) ** 4 - 1).reindex(idx, method="ffill").shift(15) * 100
    retail = ((f["RSAFS"] / f["RSAFS"].shift(3)) ** 4 - 1).reindex(idx, method="ffill").shift(15) * 100

    t = {
        "SPY 20日动量": ret(market["SPY"]),
        "纳指20日动量": ret(market["NASDAQ"]),
        "韩指20日动量": ret(market["KOSPI"]),
        "A股ASHR 20日动量": ret(market["CSI300"]),
        "沪深300ETF 20日动量": ret(market["CSI300_CN"]),
        "沪深300ETF 5日动量": ret(market["CSI300_CN"], 5),
        "RSP/SPY 20日变化": ret(market["RSP"] / market["SPY"]),
        "EEM/SPY 20日变化": ret(market["EEM"] / market["SPY"]),
        "IWM/SPY 20日变化": ret(market["IWM"] / market["SPY"]),
        "HYG/LQD 20日变化": ret(market["HYG"] / market["LQD"]),
        "高收益OAS": hy_oas,
        "投资级OAS": ig_oas,
        "VIX": market["VIX"], "MOVE": market["MOVE"],
        "SPY 20日已实现波动": market["SPY"].pct_change(fill_method=None).rolling(20).std() * math.sqrt(252) * 100,
        "铜/金20日变化": ret(market["COPPER"] / market["GOLD"]),
        "沪铜主连20日动量": ret(cn_copper),
        "EMB/TLT 20日变化": ret(market["EMB"] / market["TLT"]),
        "AUD/JPY 20日动量": ret(market["AUDJPY"]),
        "DXY 20日动量": ret(market["DXY"]), "NFCI": nfci,
        "净流动性4周变化": macro["NETLIQ"].diff(20).shift(5),
        "10Y实际利率20日变化": macro["DFII10"].diff(20).shift(1),
        "GPR地缘政治7日均值": macro["GPR7"], "布伦特5日动量": ret(market["BRENT"], 5),
        "10Y-3M国债利差": macro["T10Y3M"].shift(1),
        "初请4周均值13周变化": claims, "建筑许可同比": permits,
        "WEI周度经济指数4周变化": wei, "VIX3M/VIX期限结构": market["VIX3M"] / market["VIX"],
        "高收益OAS 20日变化": hy_oas.diff(20), "XLY/XLP 20日变化": ret(market["XLY"] / market["XLP"]),
        "NFCI 13周变化": nfci_change,
        "CFNAI三个月均值": cfnai, "工业产出3个月年化": indpro, "零售销售3个月年化": retail,
    }

    groups = [
        ("equity", 22, [("SPY 20日动量", 3, False), ("纳指20日动量", 3, False), ("韩指20日动量", 3, False),
                       ("沪深300ETF 20日动量", 2, False), ("A股ASHR 20日动量", 1, False),
                       ("沪深300ETF 5日动量", 2, False), ("RSP/SPY 20日变化", 3, False),
                       ("EEM/SPY 20日变化", 3, False), ("IWM/SPY 20日变化", 2, False)]),
        ("credit", 18, [("HYG/LQD 20日变化", 6, False), ("高收益OAS", 8, True), ("投资级OAS", 4, True)]),
        ("volatility", 13, [("VIX", 5, True), ("MOVE", 4, True), ("SPY 20日已实现波动", 4, True)]),
        ("cross_asset", 12, [("铜/金20日变化", 3, False), ("沪铜主连20日动量", 2, False),
                            ("EMB/TLT 20日变化", 4, False), ("AUD/JPY 20日动量", 3, False)]),
        ("liquidity", 12, [("DXY 20日动量", 3, True), ("NFCI", 3, True), ("净流动性4周变化", 3, False),
                         ("10Y实际利率20日变化", 3, True)]),
        ("geopolitical", 8, [("GPR地缘政治7日均值", 4, True), ("布伦特5日动量", 4, True)]),
        ("forward", 15, [("10Y-3M国债利差", 2.5, False), ("初请4周均值13周变化", 2.5, True),
                       ("建筑许可同比", 2, False), ("WEI周度经济指数4周变化", 2, False),
                       ("VIX3M/VIX期限结构", 2, False), ("高收益OAS 20日变化", 2, True),
                       ("XLY/XLP 20日变化", 1, False), ("NFCI 13周变化", 1, True)]),
    ]
    scores = pd.DataFrame(index=idx)
    for _, _, items in groups:
        for name, _, inverse in items:
            scores[name] = pct_score(t[name], inverse=inverse)
    group_scores = pd.DataFrame(index=idx)
    current = pd.Series(0.0, index=idx)
    for key, weight, items in groups:
        cols = [x[0] for x in items]
        weights = np.array([x[1] for x in items], dtype=float)
        values = scores[cols]
        valid_weight = values.notna().mul(weights, axis=1).sum(axis=1)
        gs = values.mul(weights, axis=1).sum(axis=1) / valid_weight.replace(0, np.nan)
        group_scores[key] = gs.where(valid_weight >= weights.sum() * 0.3)
        current = current + group_scores[key].fillna(0) * weight / 100
    weight_by_col = {x[0]: x[1] for _, _, items in groups for x in items}
    coverage = scores.notna().mul(pd.Series(weight_by_col), axis=1).sum(axis=1)
    current = current.where(group_scores.notna().all(axis=1) & (coverage >= 85))

    market_keys = ["equity", "credit", "volatility", "cross_asset", "liquidity", "geopolitical"]
    pure_market = sum(group_scores[k].fillna(0) * w for k, w, _ in groups if k in market_keys) / 85
    pure_market = pure_market.where(group_scores[market_keys].notna().all(axis=1))

    fundamental_specs = [
        ("10Y-3M国债利差", 10, False), ("初请4周均值13周变化", 15, True),
        ("建筑许可同比", 10, False), ("WEI周度经济指数4周变化", 10, False),
        ("NFCI 13周变化", 10, True), ("CFNAI三个月均值", 15, False),
        ("工业产出3个月年化", 15, False), ("零售销售3个月年化", 15, False),
    ]
    for name, _, inverse in fundamental_specs:
        if name not in scores:
            scores[name] = pct_score(t[name], inverse=inverse)
    fcols = [x[0] for x in fundamental_specs]
    fweights = np.array([x[1] for x in fundamental_specs], dtype=float)
    fvalues = scores[fcols]
    fvalid = fvalues.notna().mul(fweights, axis=1).sum(axis=1)
    fundamental = fvalues.mul(fweights, axis=1).sum(axis=1) / fvalid.replace(0, np.nan)
    fundamental = fundamental.where(fvalid >= 85)

    variants = {
        "current": {"name": "当前七板块", "score": current},
        "market": {"name": "纯市场风偏", "score": pure_market},
        "fundamental": {"name": "基本面周期", "score": fundamental},
        "blend15": {"name": "市场85% + 基本面15%", "score": pure_market * 0.85 + fundamental * 0.15},
        "blend25": {"name": "市场75% + 基本面25%", "score": pure_market * 0.75 + fundamental * 0.25},
        "blend40": {"name": "市场60% + 基本面40%", "score": pure_market * 0.60 + fundamental * 0.40},
    }
    cash = (macro["DGS3MO"] / 100 / 252)
    common_start = max(spec["score"].first_valid_index() for spec in variants.values())
    results = {}
    for key, spec in variants.items():
        valid_scores = spec["score"].dropna()
        print("SCORE_RANGE", key, float(valid_scores.min()), float(valid_scores.max()), flush=True)
        assert valid_scores.min() >= 0 and valid_scores.max() <= 100, key + "评分超出0–100"
        results[key] = {"name": spec["name"], **backtest(spec["score"], spy_adj, cash, start=common_start)}
        print(key, results[key]["strategy"], "IC", results[key]["rank_ic_21d"], flush=True)

    latest = min(spec["score"].dropna().index[-1] for spec in variants.values())
    latest_scores = {key: float(spec["score"].loc[:latest].dropna().iloc[-1]) for key, spec in variants.items()}
    output = {
        "asof": latest.strftime("%Y-%m-%d"),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "latest_scores": latest_scores,
        "fundamental_indicators": [
            {"name": name, "weight": weight, "inverse": inverse,
             "raw_value": float(t[name].loc[:latest].dropna().iloc[-1]),
             "score": float(scores[name].loc[:latest].dropna().iloc[-1])}
            for name, weight, inverse in fundamental_specs
        ],
        "variants": results,
        "method": "纯市场仅含六个跨资产板块；基本面含8个增长/周期指标；组合比例事先固定为15%/25%/40%。所有策略均为当日出分、次日执行，SPY复权、现金按3M美债、权重变化5bp。",
        "limitations": "月度公布时滞为近似规则，历史数据可能修订；不同组合使用相同样本但起点受基本面滚动窗口约束；结果为研究比较，不是独立样本外证明。",
    }
    OUT.write_text(json.dumps(output, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("WROTE", OUT)


if __name__ == "__main__":
    main()
