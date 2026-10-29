# -*- coding: utf-8 -*-
"""构建可解释的跨资产风险偏好评分，并进行无未来函数的说明性历史回测。"""
from pathlib import Path
from datetime import datetime, timezone
import io
import json
import math
import time

import numpy as np
import pandas as pd
import requests

BASE = Path(__file__).resolve().parents[1]
DATA = BASE / "data"
CACHE = DATA / "risk_appetite_source.json"
OUT = DATA / "risk_appetite.json"
BACKTEST = DATA / "risk_appetite_backtest.csv"
GPR_FILE = DATA / "gpr_daily_recent.xls"
SESSION = requests.Session()
SESSION.headers["User-Agent"] = "Mozilla/5.0 (compatible; research-workbench-risk-score/1.0)"

YAHOO = {
    "SPY": "SPY", "NASDAQ": "^IXIC", "KOSPI": "^KS11", "CSI300": "ASHR",
    "CSI300_CN": "000300.SS",
    "RSP": "RSP", "EEM": "EEM", "IWM": "IWM", "XLY": "XLY", "XLP": "XLP",
    "HYG": "HYG", "LQD": "LQD", "TLT": "TLT", "EMB": "EMB",
    "VIX": "^VIX", "VIX3M": "^VIX3M", "MOVE": "^MOVE", "COPPER": "HG=F",
    "GOLD": "GC=F", "AUDJPY": "AUDJPY=X", "DXY": "DX-Y.NYB", "BRENT": "BZ=F",
}
FRED = [
    "BAMLH0A0HYM2", "BAMLC0A0CM", "NFCI", "WALCL", "WTREGEN", "RRPONTSYD",
    "DFII10", "DGS3MO", "T10Y3M", "ICSA", "PERMIT", "WEI",
]


def yahoo(symbol):
    url = "https://query1.finance.yahoo.com/v8/finance/chart/" + requests.utils.quote(symbol, safe="")
    r = SESSION.get(url, params={"period1": 631152000, "period2": int(time.time()) + 86400,
                                  "interval": "1d", "events": "div,splits"}, timeout=60)
    r.raise_for_status()
    result = r.json()["chart"]["result"][0]
    ts = result.get("timestamp") or []
    close = result["indicators"]["quote"][0]["close"]
    adj = result["indicators"].get("adjclose", [{}])[0].get("adjclose", close)
    dates = [datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m-%d") for t in ts]
    return {
        "close": [[d, float(v)] for d, v in zip(dates, close) if v is not None],
        "adjclose": [[d, float(v)] for d, v in zip(dates, adj) if v is not None],
    }


def fred(sid):
    # 当前网络下curl对FRED长CSV更稳定；仍直接读取官方FRED地址。
    import subprocess
    url = f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={sid}&cosd=2005-01-01"
    r = subprocess.run(["curl", "-L", "--max-time", "50", "-sS", url],
                       capture_output=True, check=True, timeout=60)
    text = r.stdout.decode("utf-8-sig")
    if "observation_date" not in text[:100]:
        raise ValueError("FRED返回内容不是CSV")
    d = pd.read_csv(io.StringIO(text), na_values=["."])
    d.columns = ["date", "value"]
    d = d.dropna()
    return [[str(x.date), float(x.value)] for x in d.itertuples()]


def load_sources():
    cache = json.loads(CACHE.read_text(encoding="utf-8")) if CACHE.exists() else {"yahoo": {}, "fred": {}}
    cache.setdefault("yahoo", {})
    cache.setdefault("fred", {})

    def save():
        cache["fetched_at"] = datetime.now(timezone.utc).isoformat()
        CACHE.write_text(json.dumps(cache, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    for name, symbol in YAHOO.items():
        try:
            cache["yahoo"][name] = yahoo(symbol)
            save()  # 网络中断时保留已下载序列，便于断点续跑。
            print("YAHOO", name, cache["yahoo"][name]["close"][-1], flush=True)
            time.sleep(0.15)
        except Exception as exc:
            print("YAHOO_FAIL", name, str(exc)[:160], flush=True)
    for sid in FRED:
        try:
            cache["fred"][sid] = fred(sid)
            save()
            print("FRED", sid, cache["fred"][sid][-1], flush=True)
            time.sleep(0.5)
        except Exception as exc:
            print("FRED_FAIL", sid, str(exc)[:160], flush=True)
    save()
    return cache


def series(points, name=None):
    if not points:
        return pd.Series(dtype=float, name=name)
    s = pd.Series({pd.Timestamp(d): float(v) for d, v in points}, name=name).sort_index()
    return s[~s.index.duplicated(keep="last")]


def load_gpr():
    url = "https://www.matteoiacoviello.com/gpr_files/data_gpr_daily_recent.xls"
    try:
        r = SESSION.get(url, timeout=90)
        r.raise_for_status()
        GPR_FILE.write_bytes(r.content)
    except Exception as exc:
        print("GPR_DOWNLOAD_FAIL", str(exc)[:160], flush=True)
    d = pd.read_excel(GPR_FILE, sheet_name=0)
    d["date"] = pd.to_datetime(d["date"])
    return d.set_index("date")["GPRD_MA7"].astype(float).rename("GPR7")


def pct_score(s, inverse=False, window=756, min_periods=504):
    """仅用当日及过去约三年的观测计算分位；inverse=True 时高值代表低风险偏好。"""
    rank = s.rolling(window, min_periods=min_periods).rank(pct=True) * 100
    return (100 - rank) if inverse else rank


def ret(s, n=20):
    return s.pct_change(n, fill_method=None) * 100


def max_drawdown(returns):
    curve = (1 + returns.fillna(0)).cumprod()
    return float((curve / curve.cummax() - 1).min() * 100)


def metrics(returns, cash):
    r = returns.dropna()
    c = cash.reindex(r.index).fillna(0)
    n = len(r)
    annual = float(((1 + r).prod() ** (252 / n) - 1) * 100)
    vol = float(r.std() * math.sqrt(252) * 100)
    sharpe = float((r - c).mean() / r.std() * math.sqrt(252)) if r.std() > 0 else None
    return {
        "days": n, "annual_return": annual, "annual_vol": vol, "sharpe": sharpe,
        "max_drawdown": max_drawdown(r), "total_return": float(((1 + r).prod() - 1) * 100),
    }


def regime(score):
    if score < 20:
        return "极度避险"
    if score < 40:
        return "偏避险"
    if score < 60:
        return "中性"
    if score < 80:
        return "偏风偏"
    return "强风偏"


def main():
    src = load_sources()
    y = {k: series(v.get("close"), k) for k, v in src["yahoo"].items()}
    spy_adj = series(src["yahoo"].get("SPY", {}).get("adjclose"), "SPY_ADJ")
    f = {k: series(v, k) for k, v in src["fred"].items()}
    gpr = load_gpr()

    start = min(s.first_valid_index() for s in y.values() if not s.empty)
    end = max(s.last_valid_index() for s in y.values() if not s.empty)
    idx = pd.bdate_range(start, end)
    market = pd.DataFrame({k: s.reindex(idx).ffill(limit=5) for k, s in y.items()})
    # method='ffill' 保留周末/非交易日公布的周度数据，再对齐到最近一个交易日。
    macro = pd.DataFrame({k: s.reindex(idx, method="ffill") for k, s in f.items()})
    macro["GPR7"] = gpr.reindex(idx, method="ffill")
    macro["NETLIQ"] = (macro["WALCL"] - macro["WTREGEN"] - macro["RRPONTSYD"] * 1000) / 1e6

    # 低频数据按近似公布时滞后再进入历史评分，降低“数据所属期可见”的前视偏差。
    # 这不是实时 vintage 数据库，仍是保守的说明性回测。
    hy_oas = macro["BAMLH0A0HYM2"].shift(1)
    ig_oas = macro["BAMLC0A0CM"].shift(1)
    nfci = macro["NFCI"].shift(5)
    nfci_change = f["NFCI"].diff(13).reindex(idx, method="ffill").shift(5)
    claims_trend = f["ICSA"].rolling(4).mean().pct_change(13, fill_method=None).reindex(idx, method="ffill").shift(5) * 100
    permits_yoy = f["PERMIT"].pct_change(12, fill_method=None).reindex(idx, method="ffill").shift(20) * 100
    wei_change = f["WEI"].diff(4).reindex(idx, method="ffill").shift(5)

    transformed = {}
    transformed["SPY 20日动量"] = ret(market["SPY"])
    transformed["纳指20日动量"] = ret(market["NASDAQ"])
    transformed["韩指20日动量"] = ret(market["KOSPI"])
    transformed["A股ASHR 20日动量"] = ret(market["CSI300"])
    transformed["沪深300 20日动量"] = ret(market["CSI300_CN"])
    transformed["RSP/SPY 20日变化"] = ret(market["RSP"] / market["SPY"])
    transformed["EEM/SPY 20日变化"] = ret(market["EEM"] / market["SPY"])
    transformed["IWM/SPY 20日变化"] = ret(market["IWM"] / market["SPY"])
    transformed["HYG/LQD 20日变化"] = ret(market["HYG"] / market["LQD"])
    transformed["高收益OAS"] = hy_oas
    transformed["投资级OAS"] = ig_oas
    transformed["VIX"] = market["VIX"]
    transformed["MOVE"] = market["MOVE"]
    transformed["SPY 20日已实现波动"] = market["SPY"].pct_change(fill_method=None).rolling(20).std() * math.sqrt(252) * 100
    transformed["铜/金20日变化"] = ret(market["COPPER"] / market["GOLD"])
    transformed["EMB/TLT 20日变化"] = ret(market["EMB"] / market["TLT"])
    transformed["AUD/JPY 20日动量"] = ret(market["AUDJPY"])
    transformed["DXY 20日动量"] = ret(market["DXY"])
    transformed["NFCI"] = nfci
    transformed["净流动性4周变化"] = macro["NETLIQ"].diff(20).shift(5)
    transformed["10Y实际利率20日变化"] = macro["DFII10"].diff(20).shift(1)
    transformed["GPR地缘政治7日均值"] = macro["GPR7"]
    transformed["布伦特5日动量"] = ret(market["BRENT"], 5)
    transformed["10Y-3M国债利差"] = macro["T10Y3M"].shift(1)
    transformed["初请4周均值13周变化"] = claims_trend
    transformed["建筑许可同比"] = permits_yoy
    transformed["WEI周度经济指数4周变化"] = wei_change
    transformed["VIX3M/VIX期限结构"] = market["VIX3M"] / market["VIX"]
    transformed["高收益OAS 20日变化"] = hy_oas.diff(20)
    transformed["XLY/XLP 20日变化"] = ret(market["XLY"] / market["XLP"])
    transformed["NFCI 13周变化"] = nfci_change

    groups = [
        {"key": "equity", "name": "全球权益与广度", "weight": 22, "items": [
            ("SPY 20日动量", 4, False), ("纳指20日动量", 3, False), ("韩指20日动量", 3, False),
            ("沪深300 20日动量", 2, False), ("A股ASHR 20日动量", 1, False),
            ("RSP/SPY 20日变化", 4, False),
            ("EEM/SPY 20日变化", 3, False), ("IWM/SPY 20日变化", 2, False)]},
        {"key": "credit", "name": "信用", "weight": 18, "items": [
            ("HYG/LQD 20日变化", 6, False), ("高收益OAS", 8, True), ("投资级OAS", 4, True)]},
        {"key": "volatility", "name": "波动率", "weight": 13, "items": [
            ("VIX", 5, True), ("MOVE", 4, True), ("SPY 20日已实现波动", 4, True)]},
        {"key": "cross_asset", "name": "跨资产确认", "weight": 12, "items": [
            ("铜/金20日变化", 5, False), ("EMB/TLT 20日变化", 4, False), ("AUD/JPY 20日动量", 3, False)]},
        {"key": "liquidity", "name": "美元与流动性", "weight": 12, "items": [
            ("DXY 20日动量", 3, True), ("NFCI", 3, True), ("净流动性4周变化", 3, False),
            ("10Y实际利率20日变化", 3, True)]},
        {"key": "geopolitical", "name": "地缘与中东", "weight": 8, "items": [
            ("GPR地缘政治7日均值", 4, True), ("布伦特5日动量", 4, True)]},
        {"key": "forward", "name": "前瞻与周期", "weight": 15, "items": [
            ("10Y-3M国债利差", 2.5, False), ("初请4周均值13周变化", 2.5, True),
            ("建筑许可同比", 2, False), ("WEI周度经济指数4周变化", 2, False),
            ("VIX3M/VIX期限结构", 2, False), ("高收益OAS 20日变化", 2, True),
            ("XLY/XLP 20日变化", 1, False), ("NFCI 13周变化", 1, True)]},
    ]

    scores = pd.DataFrame(index=idx)
    specs = []
    for group in groups:
        for name, weight, inverse in group["items"]:
            col = group["key"] + "__" + name
            scores[col] = pct_score(transformed[name], inverse=inverse)
            specs.append({"group": group["key"], "group_name": group["name"], "name": name,
                          "weight": weight, "inverse": inverse, "column": col, "raw": transformed[name]})

    group_scores = pd.DataFrame(index=idx)
    total = pd.Series(0.0, index=idx)
    for group in groups:
        cols = [group["key"] + "__" + x[0] for x in group["items"]]
        weights = np.array([x[1] for x in group["items"]], dtype=float)
        values = scores[cols]
        valid_weight = values.notna().mul(weights, axis=1).sum(axis=1)
        group_score = values.mul(weights, axis=1).sum(axis=1) / valid_weight.replace(0, np.nan)
        # 早期OAS历史不足时由长期ETF信用比率承接；板块至少有30%权重才有效。
        group_scores[group["key"]] = group_score.where(valid_weight >= weights.sum() * 0.3)
        total = total + group_scores[group["key"]].fillna(0) * group["weight"] / 100
    # 七个板块均有效且总权重覆盖至少85%才出分，缺失板块不再按0分处理。
    weight_by_col = pd.Series({s["column"]: s["weight"] for s in specs})
    coverage = scores.notna().mul(weight_by_col, axis=1).sum(axis=1)
    complete = group_scores.notna().all(axis=1) & (coverage >= 85)
    total = total.where(complete)

    # 回测：当日收盘出分，下一交易日执行；SPY使用复权价，现金按3M美债利率计息。
    bt_idx = spy_adj.loc["2014-01-01":].index
    bt_score = total.reindex(bt_idx).ffill()
    spy_ret = spy_adj.pct_change(fill_method=None).reindex(bt_idx)
    cash_ret = (macro["DGS3MO"] / 100 / 252).reindex(bt_idx).ffill().fillna(0)
    position = (bt_score / 100).shift(1)
    cost = position.diff().abs().fillna(0) * 0.0005
    strategy_ret = position * spy_ret + (1 - position) * cash_ret - cost
    valid = bt_score.notna() & spy_ret.notna() & position.notna()
    bt_idx = bt_idx[valid]
    bt_score = bt_score.loc[bt_idx]
    spy_ret = spy_ret.loc[bt_idx]
    cash_ret = cash_ret.loc[bt_idx]
    position = position.loc[bt_idx]
    strategy_ret = strategy_ret.loc[bt_idx]
    strategy_curve = (1 + strategy_ret).cumprod()
    buyhold_curve = (1 + spy_ret).cumprod()

    bands = []
    forward21 = spy_adj.pct_change(21, fill_method=None).shift(-21).reindex(bt_idx) * 100
    rank_ic = bt_score.corr(forward21, method="spearman")
    forward_rank_ic = group_scores["forward"].reindex(bt_idx).corr(forward21, method="spearman")
    for lo, hi, label in [(0, 20, "0–20 极度避险"), (20, 40, "20–40 偏避险"),
                          (40, 60, "40–60 中性"), (60, 80, "60–80 偏风偏"), (80, 101, "80–100 强风偏")]:
        mask = (bt_score >= lo) & (bt_score < hi) & forward21.notna()
        values = forward21[mask]
        bands.append({"band": label, "count": int(values.size),
                      "avg_forward_21d": float(values.mean()) if len(values) else None,
                      "median_forward_21d": float(values.median()) if len(values) else None,
                      "win_rate": float((values > 0).mean() * 100) if len(values) else None})

    yearly = []
    for year in sorted(set(bt_idx.year)):
        yr = bt_idx[bt_idx.year == year]
        yearly.append({"year": int(year),
                       "strategy_return": float(((1 + strategy_ret.loc[yr]).prod() - 1) * 100),
                       "buyhold_return": float(((1 + spy_ret.loc[yr]).prod() - 1) * 100),
                       "strategy_max_drawdown": max_drawdown(strategy_ret.loc[yr]),
                       "buyhold_max_drawdown": max_drawdown(spy_ret.loc[yr])})

    latest_date = total.dropna().index[-1]
    latest_score = float(total.loc[latest_date])
    latest_groups = []
    for group in groups:
        latest_groups.append({"key": group["key"], "name": group["name"], "weight": group["weight"],
                              "score": float(group_scores[group["key"]].loc[latest_date])})
    latest_indicators = []
    for spec in specs:
        raw = spec.pop("raw")
        raw_date = raw.loc[:latest_date].last_valid_index()
        if raw_date is None:
            raise ValueError("指标没有有效原始值：" + spec["name"])
        latest_indicators.append({**spec, "raw_date": raw_date.strftime("%Y-%m-%d"),
                                  "raw_value": float(raw.loc[raw_date]),
                                  "score": float(scores[spec["column"]].loc[latest_date])})

    middle_east = []
    pm_path = DATA / "polymarket.json"
    if pm_path.exists():
        pm = json.loads(pm_path.read_text(encoding="utf-8"))
        for market in pm.get("markets", []):
            q = market.get("question", "")
            if any(x in q for x in ["Iran", "Hormuz"]):
                middle_east.append({"question": q, "yes": market.get("outcomes", [{}])[0].get("price"),
                                    "fetched_at": pm.get("fetched_at")})

    hist = total.loc["2014-01-01":].dropna()
    # 图表保留全部日度评分；净值曲线与CSV逐日可复核。
    result = {
        "asof": latest_date.strftime("%Y-%m-%d"),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "score": latest_score,
        "regime": regime(latest_score),
        "score_change_1d": float(total.loc[:latest_date].dropna().diff().iloc[-1]),
        "score_change_5d": float(total.loc[:latest_date].dropna().diff(5).iloc[-1]),
        "groups": latest_groups,
        "indicators": latest_indicators,
        "group_definitions": [{k: v for k, v in g.items()} for g in groups],
        "history": [[d.strftime("%Y-%m-%d"), round(float(v), 3)] for d, v in hist.items()],
        "group_history": {g["key"]: [[d.strftime("%Y-%m-%d"), round(float(group_scores[g["key"]].loc[d]), 3)]
                                     for d in hist.index if pd.notna(group_scores[g["key"]].loc[d])] for g in groups},
        "middle_east": middle_east,
        "method": {
            "range": "0–100，越高越偏风险追逐",
            "bands": "0–20极度避险；20–40偏避险；40–60中性；60–80偏风偏；80–100强风偏",
            "normalization": "各指标仅在当日及过去756个交易日内计算滚动分位，至少504个观测；逆向指标取100减分位",
            "weights": "七大板块固定权重：权益22%、信用18%、波动率13%、跨资产12%、流动性12%、地缘8%、前瞻15%；不依据回测收益拟合",
            "execution": "当日收盘出分，下一交易日执行；SPY复权收益，剩余仓位按3M美债计息，单边权重变化收取5bp",
            "release_lag": "OAS与实际利率滞后1个交易日，NFCI/初请/WEI/净流动性滞后5个交易日，建筑许可滞后20个交易日；周度数据先保留周末观测再对齐交易日",
            "coverage": "七个板块均须有效，且指标总权重覆盖至少85%；板块内按当时可用权重归一化，早期OAS不足时由长期ETF信用比率承接",
            "limitations": "固定权重含研究者判断，回测不是独立样本外证明；公布时滞为近似规则，NFCI、WEI、GPR等历史可能修订，非严格实时vintage；早期信用指标构成与当前不同；跨市场日期以前值填充；21日收益为重叠窗口描述统计，秩相关不代表可交易收益；未计税费、滑点和汇率对冲成本。",
        },
        "backtest": {
            "start": bt_idx[0].strftime("%Y-%m-%d"), "end": bt_idx[-1].strftime("%Y-%m-%d"),
            "strategy": metrics(strategy_ret, cash_ret), "buyhold": metrics(spy_ret, cash_ret),
            "average_position": float(position.mean() * 100), "annual_turnover": float(position.diff().abs().sum() / len(position) * 252 * 100),
            "rank_ic_21d": float(rank_ic), "forward_rank_ic_21d": float(forward_rank_ic),
            "bands": bands, "yearly": yearly,
            "curves": [[d.strftime("%Y-%m-%d"), round(float(strategy_curve.loc[d]), 5),
                        round(float(buyhold_curve.loc[d]), 5), round(float(position.loc[d] * 100), 2)] for d in bt_idx],
        },
        "sources": [
            {"name": "IMF：风险偏好常用波动率、信用、流动性、美元与黄金等跨资产指标", "url": "https://www.imf.org/external/pubs/ft/wp/2008/wp0885.pdf"},
            {"name": "Chicago Fed NFCI：正值偏紧、负值偏松，周度且历史可能修订", "url": "https://www.chicagofed.org/research/data/nfci/current-data"},
            {"name": "Caldara–Iacoviello GPR：基于报纸文本的地缘政治风险指数", "url": "https://www.matteoiacoviello.com/gpr.htm"},
            {"name": "FRED：ICE BofA信用OAS、利率曲线、初请、建筑许可与WEI", "url": "https://fred.stlouisfed.org/series/BAMLH0A0HYM2"},
            {"name": "Yahoo Finance：全球指数、ETF、VIX期限结构与商品历史行情", "url": "https://finance.yahoo.com/"},
        ],
    }
    OUT.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    csv_data = pd.DataFrame({"score": bt_score, "position": position, "spy_return": spy_ret,
                             "cash_return": cash_ret, "strategy_return": strategy_ret,
                             "strategy_nav": strategy_curve, "buyhold_nav": buyhold_curve})
    for group in groups:
        csv_data[group["key"]] = group_scores[group["key"]].reindex(csv_data.index)
    csv_data.index.name = "date"
    csv_data.to_csv(BACKTEST, encoding="utf-8-sig", float_format="%.8f")

    print("LATEST", result["asof"], round(latest_score, 2), result["regime"])
    print("BACKTEST", result["backtest"]["start"], result["backtest"]["end"])
    print("STRATEGY", result["backtest"]["strategy"])
    print("BUYHOLD", result["backtest"]["buyhold"])
    print("BANDS", bands)
    print("WROTE", OUT, BACKTEST)


if __name__ == "__main__":
    main()
