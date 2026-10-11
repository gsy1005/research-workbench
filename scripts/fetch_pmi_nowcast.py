#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ISM 制造业 PMI 合成预测模型 v2（零 token · 全免费源）
========================================================
原理: 每月中下旬发布的地区联储制造业扩散指数(Empire/Philly/Dallas)
      与次月首个工作日发布的 ISM 制造业 PMI 同源同方法(扩散指数),
      用 OLS 回归合成, 在 ISM 发布前 1-2 周给出预测值。
v2 改进: 加入 2Y 美债收益率滞后3个季度项(利率→PMI传导时滞实验表明
         该滞后区间走样本外最优: MAE 1.33→1.25, OOS R2 0.845→0.86),
         同时保留 v1(无利率项)作为对照。

数据源(全部免费/免key):
  FRED fredgraph.csv:
    GACDISA066MSFRBNY  纽约联储 Empire State 制造业(扩散指数)
    GACDFSA066MSFRBPHI 费城联储制造业(扩散指数)
    BACTSAMFRBDAL      达拉斯联储制造业(扩散指数)
    DGS2               2Y美债收益率(日频→月季均, 滞后3季度进入模型)
  v3 新增先行指标:
    T10Y2Y             10Y-2Y利差(日频→月均值, 深度倒挂持续→领先PMI下行6-12月, 取滞后9月)
    PERMIT             新屋建筑许可(月频, 同比→领先地产链PMI约2季度, 取滞后6月)
                       (注: MBA房贷申请量免费历史序列无公开接口, MBA官网仅当周新闻稿,
                        完整序列需订阅; 用建筑许可这一官方免费先行指标顶替同生态位)
    DRTSCIS            SLOOS银行对中小企业贷款标准净收紧%(季频→月度前向填充,
                       领先中小企业订单约2季度, 取滞后6月)
  ISM 实际值: 本仓库 data/ht_series_us_econ.js (月度更新后自动回填对比)

模型:
  v1: ISM_t = b0 + b1*Empire + b2*Philly + b3*Dallas + b4*ISM_{t-1}
  v2: v1 + b5*DGS2_{t-3季}
  v3: v2 + b6*T10Y2Y_{t-9月} + b7*PERMIT同比_{t-6月} + b8*SLOOS_{t-6月}
趋势: trend3m = ISM_{t+3} ~ ISM3月均 + 利差 + 许可同比 + SLOOS + 2Y3月均
      (回答"未来几个季度"的季度级趋势, 走样本外回测给误差带)
回测: 滚动起点走样本外预测(每月仅用该月之前的数据拟合)
产物: data/pmi_nowcast.json   (三版权重/回测统计/最新预测/趋势展望/逐月记录)
      charts/pmi_nowcast.png  (实际 vs 预测对比图)
用法:  python fetch_pmi_nowcast.py        # 常规更新
       python fetch_pmi_nowcast.py --full # 全量重算回测(一般不需要)
"""
import csv, io, json, os, sys, time, datetime, re, urllib.request

import numpy as np

try:
    from curl_cffi import requests as _creq
    _SESS = _creq.Session(impersonate='chrome')
except Exception:
    _SESS = None

BASE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(BASE)
DATA = os.path.join(APP, 'data')
CHARTS = os.path.join(APP, 'charts')

FULL = '--full' in sys.argv

FRED = {
    'empire': 'GACDISA066MSFRBNY',
    'philly': 'GACDFSA066MSFRBPHI',
    'dallas': 'BACTSAMFRBDAL',
}
DGS2_SID = 'DGS2'
RATE_LAG_Q = 3                  # 2Y 收益率滞后季度数(v2 模型)
ISM_KEY_CANDIDATES = [
    'HT_us_econ_总表_ISM制造业PMI',
    'HT_us_econ_总表_ISM制造业PMI*',
    'HT_us_econ_工业生产_ISM制造业PMI',
]
TRAIN_MIN_OBS = 60            # 走样本外回测前的最少训练样本数(约5年)
ERR_BAND = 1.5                # 业界常用 ±1.5 点命中带
FEAT_V1 = [0, 1, 2, 3]        # empire, philly, dallas, ism_lag
FEAT_V2 = [0, 1, 2, 3, 4]     # + dgs2_lag3
FEAT_V3 = [0, 1, 2, 3, 4, 5, 6, 7]  # + curve_lag9, permit_yoy_lag6, sloos_lag6

# v3 先行指标（滞后=先行长度的中值）
LEADERS = {
    'curve': ('T10Y2Y', 'd', 9, '10Y-2Y利差(月均值,滞后9月)'),
    'permit': ('PERMIT', 'm', 6, '新屋建筑许可同比(滞后6月)'),
    'sloos': ('DRTSCIS', 'q', 6, 'SLOOS中小企业贷款收紧%(季→月,滞后6月)'),
}
TREND_H = 3                   # 趋势预测 horizon：未来3个月


def log(*a):
    print(datetime.datetime.now().strftime('%H:%M:%S'), *a, flush=True)


def http_get(url, timeout=20, retries=3, backoff=2.0):
    for i in range(retries):
        try:
            if _SESS is not None:
                r = _SESS.get(url, timeout=timeout)
                if r.status_code == 200:
                    return r.text
                raise RuntimeError('HTTP %s' % r.status_code)
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (research-workbench)'})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read().decode('utf-8', 'replace')
        except Exception as e:
            log('  retry', i + 1, repr(e)[:100], url[:70])
            time.sleep(backoff * (i + 1))
    return None


def fred_series(sid, cosd='1999-01-01'):
    """FRED 免key CSV(月频) -> {YYYY-MM: value}"""
    t = http_get('https://fred.stlouisfed.org/graph/fredgraph.csv?id=%s&cosd=%s' % (sid, cosd))
    out = {}
    if not t or 'observation_date' not in t[:200]:
        return out
    for row in csv.reader(io.StringIO(t)):
        if len(row) < 2 or row[0] == 'observation_date':
            continue
        d, v = row[0].strip(), row[1].strip()
        if v in ('.', '', 'NaN'):
            continue
        try:
            out[d[:7]] = float(v)
        except ValueError:
            pass
    return out


def fred_daily_monthly_avg(sid, cosd='1999-01-01'):
    """FRED 日频 -> 月季均 {YYYY-MM: val}"""
    t = http_get('https://fred.stlouisfed.org/graph/fredgraph.csv?id=%s&cosd=%s' % (sid, cosd))
    acc = {}
    if not t or 'observation_date' not in t[:200]:
        return {}
    for row in csv.reader(io.StringIO(t)):
        if len(row) < 2 or row[0] == 'observation_date':
            continue
        d, v = row[0].strip(), row[1].strip()
        if v in ('.', '', 'NaN'):
            continue
        try:
            acc.setdefault(d[:7], []).append(float(v))
        except ValueError:
            pass
    return {k: sum(vs) / len(vs) for k, vs in acc.items()}


def load_ism_actual():
    """从本仓库 ht_series_us_econ.js 读 ISM 制造业 PMI 实际值 -> {YYYY-MM: value}"""
    path = os.path.join(DATA, 'ht_series_us_econ.js')
    out = {}
    if not os.path.exists(path):
        log('  !! 未找到 ht_series_us_econ.js, ISM 实际值不可用')
        return out
    t = open(path, encoding='utf-8').read()
    m = re.search(r'Object\.assign\(window\.HT_SERIES\|\|\{\},(\{.*\})\)', t, re.S)
    if not m:
        return out
    try:
        d = json.loads(m.group(1))
    except Exception as e:
        log('  !! ht 解析失败', repr(e)[:80])
        return out
    for k in ISM_KEY_CANDIDATES:
        if k in d and d[k].get('series'):
            for dt, v in d[k]['series']:
                out[dt[:7]] = float(v)
            log('  ISM 实际值: %s, %d 个月, 最新 %s' % (k, len(out), max(out)))
            break
    return out


def prev_month(mk, k=1):
    y, m = int(mk[:4]), int(mk[5:7])
    t = y * 12 + m - 1 - k
    return '%04d-%02d' % (t // 12, t % 12 + 1)


def next_month(mk):
    return prev_month(mk, -1)


def build_table(regional, dgs2, ism):
    """对齐成 (month, [empire,philly,dallas,ism_lag,dgs2_lag3], ism) 完整案例表"""
    months = sorted(set(regional['empire']) & set(regional['philly']) & set(regional['dallas'])
                    & set(ism) & set(dgs2))
    rows = []
    for mk in months:
        i, ip = ism.get(mk), ism.get(prev_month(mk))
        r = dgs2.get(prev_month(mk, RATE_LAG_Q))
        if i is None or ip is None or r is None:
            continue
        rows.append((mk, [regional['empire'][mk], regional['philly'][mk], regional['dallas'][mk], ip, r], i))
    return rows


def qfill_to_monthly(qmap):
    """季频 {YYYY-MM: v}(月份为季首) -> 月度前向填充"""
    out = {}
    if not qmap:
        return out
    items = sorted(qmap.items())
    y0, m0 = int(items[0][0][:4]), int(items[0][0][5:7])
    y1, m1 = int(items[-1][0][:4]), int(items[-1][0][5:7])
    n = (y1 - y0) * 12 + (m1 - m0)
    cur = None
    qi = 0
    for k in range(n + 1):
        mk = '%04d-%02d' % (y0 + (m0 - 1 + k) // 12, (m0 - 1 + k) % 12 + 1)
        while qi < len(items) and items[qi][0] <= mk:
            cur = items[qi][1]
            qi += 1
        if cur is not None:
            out[mk] = cur
    return out


def yoy_map(mmap_, k=12):
    """{YYYY-MM: v} -> 同比% 映射"""
    out = {}
    for mk, v in mmap_.items():
        y, m = int(mk[:4]), int(mk[5:7])
        pv = mmap_.get('%04d-%02d' % (y - 1, m))
        if pv:
            out[mk] = (v / pv - 1) * 100
    return out


def build_table_v3(regional, dgs2, ism, curve, permit_yoy, sloos_m):
    """v3: 在 v2 特征上追加三个先行指标(按先行期滞后)"""
    months = sorted(set(regional['empire']) & set(regional['philly']) & set(regional['dallas'])
                    & set(ism) & set(dgs2) & set(curve) & set(permit_yoy) & set(sloos_m))
    rows = []
    for mk in months:
        base = None
        i, ip = ism.get(mk), ism.get(prev_month(mk))
        r3 = dgs2.get(prev_month(mk, RATE_LAG_Q))
        c9 = curve.get(prev_month(mk, 9))
        p6 = permit_yoy.get(prev_month(mk, 6))
        s6 = sloos_m.get(prev_month(mk, 6))
        if None in (i, ip, r3, c9, p6, s6):
            continue
        rows.append((mk, [regional['empire'][mk], regional['philly'][mk], regional['dallas'][mk],
                          ip, r3, c9, p6, s6], i))
    return rows


def build_trend_rows(ism, curve, permit_yoy, sloos_m, dgs2, h=TREND_H):
    """季度级趋势: 目标 ISM_{t+h}, 特征均为 t 时点已知量"""
    months = sorted(set(ism) & set(curve) & set(permit_yoy) & set(sloos_m) & set(dgs2))
    def ma(mmap_, mk, k=3):
        vs = [mmap_.get(prev_month(mk, j)) for j in range(k)]
        vs = [v for v in vs if v is not None]
        return sum(vs) / len(vs) if len(vs) >= 2 else None
    rows = []
    for mk in months:
        tgt = ism.get(prev_month(mk, -h))  # mk + h 个月的 ISM
        im = ma(ism, mk)
        dm = ma(dgs2, mk)
        cv, py, sl = curve.get(mk), permit_yoy.get(mk), sloos_m.get(mk)
        if None in (tgt, im, dm, cv, py, sl):
            continue
        rows.append((mk, [im, cv, py, sl, dm], tgt))
    return rows


def fit_coef(X, y):
    Xd = np.column_stack([np.ones(len(X)), np.array(X)])
    coef, *_ = np.linalg.lstsq(Xd, np.array(y), rcond=None)
    return coef


def fit_predict(X, y, Xp):
    coef = fit_coef(X, y)
    Xpd = np.concatenate([[1.0], np.atleast_1d(np.asarray(Xp, dtype=float))])
    return float(Xpd @ coef), coef


def backtest(rows, feat_idx):
    """滚动走样本外, 返回 (stats, 逐月记录)"""
    bt = []
    for i in range(TRAIN_MIN_OBS, len(rows)):
        X = [[r[1][j] for j in feat_idx] for r in rows[:i]]
        y = [r[2] for r in rows[:i]]
        Xp = [rows[i][1][j] for j in feat_idx]
        p, _ = fit_predict(X, y, Xp)
        bt.append({'month': rows[i][0], 'nowcast': round(p, 2), 'actual': rows[i][2]})
    errs = np.array([b['nowcast'] - b['actual'] for b in bt])
    acts = np.array([b['actual'] for b in bt])
    preds = np.array([b['nowcast'] for b in bt])
    oos_r2 = 1 - np.sum(errs ** 2) / np.sum((acts - acts.mean()) ** 2)
    dir_hits = sum(1 for i in range(1, len(bt))
                   if np.sign(preds[i] - bt[i - 1]['actual']) == np.sign(acts[i] - bt[i - 1]['actual']))
    return {
        'n': len(bt), 'oos_r2': round(float(oos_r2), 3),
        'mae': round(float(np.mean(np.abs(errs))), 2), 'rmse': round(float(np.sqrt(np.mean(errs ** 2))), 2),
        'dir_hit': round(dir_hits / max(1, len(bt) - 1), 3),
        'band_hit_1p5': round(float(np.mean(np.abs(errs) <= ERR_BAND)), 3),
        'cross50_hit': round(float(np.mean((preds - 50) * (acts - 50) > 0)), 3),
    }, bt


def main():
    t0 = time.time()
    log('== PMI nowcast v2 开始 ==')
    regional = {}
    for name, sid in FRED.items():
        regional[name] = fred_series(sid)
        log('  %-7s %s: %d 个月, 最新 %s' % (name, sid, len(regional[name]),
            max(regional[name]) if regional[name] else '-'))
        time.sleep(1.5)
    dgs2 = fred_daily_monthly_avg(DGS2_SID)
    log('  dgs2    %s: %d 个月, 最新 %s' % (DGS2_SID, len(dgs2), max(dgs2) if dgs2 else '-'))
    time.sleep(1.2)
    curve = fred_daily_monthly_avg(LEADERS['curve'][0])
    log('  curve   %s: %d 个月, 最新 %s' % (LEADERS['curve'][0], len(curve), max(curve) if curve else '-'))
    time.sleep(1.2)
    permit = fred_series(LEADERS['permit'][0])
    permit_yoy = yoy_map(permit)
    log('  permit  %s: %d 个月(同比%d), 最新 %s' % (LEADERS['permit'][0], len(permit), len(permit_yoy), max(permit_yoy) if permit_yoy else '-'))
    time.sleep(1.2)
    sloos_q = fred_series(LEADERS['sloos'][0])
    sloos_m = qfill_to_monthly(sloos_q)
    log('  sloos   %s: %d 季(填月%d), 最新季度 %s' % (LEADERS['sloos'][0], len(sloos_q), len(sloos_m), max(sloos_q) if sloos_q else '-'))
    ism = load_ism_actual()
    rows = build_table(regional, dgs2, ism)
    log('  v1/v2 对齐完整案例: %d 个月 (%s ~ %s)' % (len(rows), rows[0][0], rows[-1][0]))
    rows3 = build_table_v3(regional, dgs2, ism, curve, permit_yoy, sloos_m)
    log('  v3   对齐完整案例: %d 个月 (%s ~ %s)' % (len(rows3), rows3[0][0], rows3[-1][0]))

    # ---------- 三版模型走样本外回测 ----------
    stats_v1, bt_v1 = backtest(rows, FEAT_V1)
    stats_v2, bt_v2 = backtest(rows, FEAT_V2)
    stats_v3, bt_v3 = backtest(rows3, FEAT_V3) if len(rows3) > TRAIN_MIN_OBS + 12 else (None, [])
    log('  v1 回测: R2=%(oos_r2)s MAE=%(mae)s 方向=%(dir_hit)s ±1.5=%(band_hit_1p5)s 荣枯=%(cross50_hit)s' % stats_v1)
    log('  v2 回测: R2=%(oos_r2)s MAE=%(mae)s 方向=%(dir_hit)s ±1.5=%(band_hit_1p5)s 荣枯=%(cross50_hit)s' % stats_v2)
    if stats_v3:
        log('  v3 回测: R2=%(oos_r2)s MAE=%(mae)s 方向=%(dir_hit)s ±1.5=%(band_hit_1p5)s 荣枯=%(cross50_hit)s' % stats_v3)

    # ---------- 未来3个月趋势模型(季度级) ----------
    trend_rows = build_trend_rows(ism, curve, permit_yoy, sloos_m, dgs2)
    stats_tr, bt_tr = backtest(trend_rows, [0, 1, 2, 3, 4]) if len(trend_rows) > TRAIN_MIN_OBS else (None, [])
    if stats_tr:
        log('  trend3m 回测: R2=%(oos_r2)s MAE=%(mae)s 方向=%(dir_hit)s (n=%(n)s)'
            % stats_tr)

    # ---------- 最新预测(v2 做 headline, v3 若回测更优则并列展示) ----------
    X = [r[1] for r in rows]
    y = [r[2] for r in rows]
    X3 = [r[1] for r in rows3]
    y3 = [r[2] for r in rows3]
    latest_actual_month = max(ism) if ism else rows[-1][0]
    pred_month = None
    mk = next_month(latest_actual_month)
    for _ in range(3):
        have = sum(1 for s in regional if mk in regional[s])
        if mk in ism:
            break
        if have >= 2:
            pred_month = mk
            break
        mk = next_month(mk)
    nowcast = None
    if pred_month:
        ip = ism.get(prev_month(pred_month))
        r3 = dgs2.get(prev_month(pred_month, RATE_LAG_Q))
        Xp = [regional['empire'].get(pred_month), regional['philly'].get(pred_month),
              regional['dallas'].get(pred_month), ip, r3]
        if any(v is None for v in Xp[:3]) or r3 is None:
            log('  !! %s 输入不齐 %s, 缺失项用近24月均值回填' % (pred_month, Xp))
        Xf = [v if v is not None else float(np.mean([r[1][j] for r in rows[-24:]]))
              for j, v in enumerate(Xp)]
        p1, _ = fit_predict([[r[j] for j in FEAT_V1] for r in X], y, [Xf[j] for j in FEAT_V1])
        p2, coef2 = fit_predict(X, y, Xf)
        nowcast = {
            'month': pred_month,
            'value_v2': round(p2, 1),                     #  headline = v2
            'value_v1': round(p1, 1),
            'band': [round(p2 - stats_v2['mae'], 1), round(p2 + stats_v2['mae'], 1)],
            'inputs': {'empire': Xp[0], 'philly': Xp[1], 'dallas': Xp[2],
                       'ism_lag': ip, 'dgs2_lag%dq' % RATE_LAG_Q: r3},
            'note': '±%.1f 为 v2 回测平均绝对误差带; v2=v1+2Y滞后%d季' % (stats_v2['mae'], RATE_LAG_Q),
        }
        # v3 同月预测(先行指标滞后对齐到预测月)
        c9 = curve.get(prev_month(pred_month, 9))
        p6 = permit_yoy.get(prev_month(pred_month, 6))
        s6 = sloos_m.get(prev_month(pred_month, 6))
        if stats_v3 and r3 is not None and None not in (c9, p6, s6) and ip is not None:
            Xf3 = Xf[:4] + [Xf[4], c9, p6, s6]
            p3, _ = fit_predict(X3, y3, Xf3)
            nowcast['value_v3'] = round(p3, 1)
            nowcast['note'] += '; v3(含曲线/许可/SLOOS先行项)=%.1f' % p3
        log('  预测 %s ISM: v2=%.1f v1=%.1f (2Y滞后%d季=%.2f%%)'
            % (pred_month, p2, p1, RATE_LAG_Q, r3 if r3 else float('nan')))
    else:
        log('  本月 ISM 实际值已入库或地区数据未出, 无待预测月份')

    # ---------- 未来3个月趋势展望 ----------
    trend = None
    if stats_tr and len(trend_rows) > TRAIN_MIN_OBS + 6:
        tr_now = trend_rows[-1]
        Xtr = [r[1] for r in trend_rows]
        ytr = [r[2] for r in trend_rows]
        ptr, coef_tr = fit_predict(Xtr, ytr, tr_now[1])
        tgt_month = prev_month(tr_now[0], -TREND_H)
        fut = ism.get(tgt_month)
        trend = {
            'from_month': tr_now[0], 'target_month': tgt_month, 'h': TREND_H,
            'value': round(ptr, 1), 'band': [round(ptr - stats_tr['mae'], 1), round(ptr + stats_tr['mae'], 1)],
            'mae': stats_tr['mae'], 'oos_r2': stats_tr['oos_r2'], 'dir_hit': stats_tr['dir_hit'],
            'actual_filled': fut,
            'inputs': {'ism_ma3': tr_now[1][0], 'curve': tr_now[1][1], 'permit_yoy': tr_now[1][2],
                       'sloos': tr_now[1][3], 'dgs2_ma3': tr_now[1][4]},
        }
        if fut is not None:
            trend['err'] = round(ptr - fut, 2)
        log('  趋势展望: %s → %s ISM 预测 %.1f (MAE %.2f)' % (tr_now[0], tgt_month, ptr, stats_tr['mae']))

    # ---------- 合并历史预测记录 ----------
    out_path = os.path.join(DATA, 'pmi_nowcast.json')
    hist = {}
    if os.path.exists(out_path) and not FULL:
        try:
            old = json.load(open(out_path, encoding='utf-8'))
            for h in old.get('history', []):
                hist[h['month']] = h
        except Exception:
            pass
    for b1, b2 in zip(bt_v1, bt_v2):
        hist[b2['month']] = {'month': b2['month'],
                             'nowcast': b2['nowcast'], 'nowcast_v1': b1['nowcast'],
                             'actual': b2['actual'], 'err': round(b2['nowcast'] - b2['actual'], 2)}
    if bt_v3:
        for b3 in bt_v3:
            h = hist.get(b3['month'])
            if h:
                h['nowcast_v3'] = b3['nowcast']
                h['err_v3'] = round(b3['nowcast'] - b3['actual'], 2)
    if nowcast:
        h = hist.get(nowcast['month'], {'month': nowcast['month']})
        h['nowcast'] = nowcast['value_v2']
        h['nowcast_v1'] = nowcast['value_v1']
        hist[nowcast['month']] = h
    for mk_, h in list(hist.items()):
        if 'actual' not in h and mk_ in ism:
            h['actual'] = ism[mk_]
            if 'nowcast' in h:
                h['err'] = round(h['nowcast'] - ism[mk_], 2)

    coef2 = fit_coef(X, y)
    coef3 = fit_coef(X3, y3) if stats_v3 else None
    out = {
        'updated': datetime.datetime.now().strftime('%Y-%m-%d %H:%M'),
        'model': 'v2 headline: ISM ~ Empire+Philly+Dallas+ISM_lag+DGS2_lag3Q; '
                 'v3 = v2 + 曲线(滞后9月)+许可同比(滞后6月)+SLOOS(滞后6月); v1 为无利率项对照',
        'features': dict(FRED, dgs2=DGS2_SID + '(月季均,滞后%d季度)' % RATE_LAG_Q,
                         **{k: v[3] for k, v in LEADERS.items()}),
        'err_band': ERR_BAND,
        'stats': {'v1': stats_v1, 'v2': stats_v2, 'v3': stats_v3, 'trend3m': stats_tr},
        'weights_v2': {k: round(float(c), 4) for k, c in
                       zip(['const'] + list(FRED) + ['ism_lag', 'dgs2_lag%dq' % RATE_LAG_Q], coef2)},
        'weights_v3': ({k: round(float(c), 4) for k, c in
                        zip(['const'] + list(FRED) + ['ism_lag', 'dgs2_lag%dq' % RATE_LAG_Q,
                             'curve_lag9m', 'permit_yoy_lag6m', 'sloos_lag6m'], coef3)} if coef3 is not None else None),
        'trend3m': trend,
        'nowcast': nowcast,
        'history': sorted(hist.values(), key=lambda h: h['month'])[-120:],
    }
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    log('  写出 %s' % out_path)

    # ---------- 图 ----------
    try:
        import matplotlib
        matplotlib.use('Agg')
        import matplotlib.pyplot as plt
        try:
            from daimon_runtime import setup_plot
            setup_plot()
        except Exception:
            plt.rcParams['font.sans-serif'] = ['Microsoft YaHei', 'SimHei']
            plt.rcParams['axes.unicode_minus'] = False
        hs = out['history'][-60:]
        xs = [h['month'] for h in hs]
        fig, ax = plt.subplots(figsize=(10, 4.5), dpi=130)
        if any('actual' in h for h in hs):
            ax.plot(xs, [h.get('actual') for h in hs], lw=1.8, color='#333', marker='o', ms=2.5, label='ISM 实际值')
        ax.plot(xs, [h['nowcast'] for h in hs], lw=1.4, color='#d62728', ls='--', marker='s', ms=2, label='模型预测 v2（走样本外）')
        ax.axhline(50, color='#888', lw=0.8, ls=':')
        ax.set_title('ISM 制造业 PMI：实际 vs 合成预测 v2（含2Y利率滞后项，近60个月）')
        ax.legend(loc='lower left', fontsize=8)
        ax.grid(alpha=0.25)
        fig.autofmt_xdate(rotation=45)
        os.makedirs(CHARTS, exist_ok=True)
        p = os.path.join(CHARTS, 'pmi_nowcast.png')
        fig.savefig(p, bbox_inches='tight')
        log('  写出 %s' % p)
    except Exception as e:
        log('  !! 画图跳过', repr(e)[:100])

    log('== 完成, %.1fs ==' % (time.time() - t0))


if __name__ == '__main__':
    main()
