#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
滞胀压力仪表盘（零 token · 全免费源）
========================================
回答一个问题: 经济离"增长下+通胀上"的滞胀定价还有多远？
五个先行指标等权打分 0-100, 分越高滞胀压力越大:

  1. 5y5y远期通胀预期 T5YIFR      —— 通胀预期是否失锚(>2.8%警戒)
  2. 工资动能 AHE同比 CES0500000003 —— 工资-物价螺旋是否点火(>4%危险)
  3. 油价→通胀传导 DCOILWTICO+核心CPI 3个月年率 —— 成本推动压力
  4. 高收益利差 BAMLH0A0HYM2      —— 信用事件=衰退扳机(>400bp)
  5. 盈亏平衡 vs 实际利率背离 T10YIE-DFII10 3个月变化差
                                —— 通胀定价上+实际利率下=最滞胀组合(黄金友好)

数据源: FRED fredgraph.csv (免key, 与 fetch_macro.py 同款)
产物: data/stagflation.json (各分项/总分/等级/阈值说明)
      charts/stagflation.png (仪表盘图)
等级: 0-20 舒适 | 20-40 温和压力 | 40-60 滞胀式压力升温 | 60-80 警戒 | 80-100 滞胀定价区
"""
import csv, io, json, os, sys, time, datetime, urllib.request

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

SERIES = {
    'fwd5y5y': 'T5YIFR',          # 5y5y远期通胀预期(盈亏平衡口径), 日频, %
    'ahe_yoy': 'CES0500000003',   # 平均时薪, 月频(这里取月率年化更灵敏, 脚本内算)
    'corecpi': 'CPILFESL',        # 核心CPI指数, 月频
    'wti': 'DCOILWTICO',          # WTI, 日频
    'hy_oas': 'BAMLH0A0HYM2',     # 高收益OAS, 日频, %
    'breakeven10': 'T10YIE',      # 10Y盈亏平衡, 日频, %
    'real10': 'DFII10',           # 10Y实际利率TIPS, 日频, %
}

# 分段打分: (下界, 上界, 得分) —— value>=lo 且 <hi 时取 score, 最后一个区间兜底
BANDS = {
    'fwd5y5y':      [(0, 2.2, 0), (2.2, 2.5, 25), (2.5, 2.8, 50), (2.8, 3.1, 75), (3.1, 99, 100)],
    'wage_mom':     [(0, 2.5, 0), (2.5, 3.2, 25), (3.2, 3.8, 50), (3.8, 4.5, 75), (4.5, 99, 100)],
    'oil_core':     [(0, 30, 0), (30, 45, 25), (45, 60, 50), (60, 75, 75), (75, 101, 100)],
    'hy_oas':       [(0, 3.0, 0), (3.0, 3.5, 25), (3.5, 4.0, 50), (4.0, 5.0, 75), (5.0, 99, 100)],
    'bkrn_real_div': [(-99, -0.5, 0), (-0.5, 0.0, 25), (0.0, 0.5, 50), (0.5, 1.0, 75), (1.0, 99, 100)],
}
NAMES = {
    'fwd5y5y': '5y5y远期通胀预期',
    'wage_mom': '工资动能(时薪年化环比)',
    'oil_core': '油价→核心通胀传导',
    'hy_oas': '高收益利差(衰退扳机)',
    'bkrn_real_div': '盈亏平衡-实际利率背离',
}

log = lambda *a: print(datetime.datetime.now().strftime('%H:%M:%S'), *a, flush=True)


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
            log('  retry', i + 1, repr(e)[:100])
            time.sleep(backoff * (i + 1))
    return None


def fred(sid, cosd='2015-01-01'):
    t = http_get('https://fred.stlouisfed.org/graph/fredgraph.csv?id=%s&cosd=%s' % (sid, cosd))
    out = []
    if not t or 'observation_date' not in t[:200]:
        return out
    for row in csv.reader(io.StringIO(t)):
        if len(row) < 2 or row[0] == 'observation_date':
            continue
        v = row[1].strip()
        if v in ('.', '', 'NaN'):
            continue
        try:
            out.append((row[0][:7], float(v)))
        except ValueError:
            pass
    return out


def monthly_avg(series):
    acc = {}
    for k, v in series:
        acc.setdefault(k, []).append(v)
    return {k: sum(vs) / len(vs) for k, vs in acc.items()}


def score(key, val):
    for lo, hi, sc in BANDS[key]:
        if lo <= val < hi:
            return sc
    return BANDS[key][-1][2]


def main():
    t0 = time.time()
    log('== 滞胀仪表盘开始 ==')
    raw = {}
    for name, sid in SERIES.items():
        raw[name] = fred(sid)
        log('  %-12s %-14s %d 个月' % (name, sid, len(monthly_avg(raw[name]))))
        time.sleep(1.2)

    m = {k: monthly_avg(v) for k, v in raw.items()}
    months = sorted(set.intersection(*[set(v) for v in m.values()]))
    def val(key, mk): return m[key].get(mk)
    def lag(key, mk, k=3):
        y, mo = int(mk[:4]), int(mk[5:7])
        t = y * 12 + mo - 1 - k
        return m[key].get('%04d-%02d' % (t // 12, t % 12 + 1))

    latest = months[-1]
    # ---- 五个分项当前值 ----
    cur = {}
    cur['fwd5y5y'] = val('fwd5y5y', latest)
    # 工资动能: 时薪 3个月年化环比
    ahe_now, ahe_lag = val('ahe_yoy', latest), lag('ahe_yoy', latest, 3)
    cur['wage_mom'] = round(((ahe_now / ahe_lag) ** 4 - 1) * 100, 2) if ahe_now and ahe_lag else None
    # 油价→通胀传导: 油价3个月涨幅得分 与 核心CPI 3个月年率得分 的平均
    wti_now, wti_lag = val('wti', latest), lag('wti', latest, 3)
    oil_chg = ((wti_now / wti_lag) - 1) * 100 if wti_now and wti_lag else None
    cc_now, cc_lag = val('corecpi', latest), lag('corecpi', latest, 3)
    core_ann = ((cc_now / cc_lag) ** 4 - 1) * 100 if cc_now and cc_lag else None
    oil_sc = score('oil_core', min(max((oil_chg or 0) * 2.5 + 30, 0), 100))
    core_sc = score('oil_core', min(max((core_ann or 0) * 22 + 30, 0), 100))
    cur['oil_core'] = round((oil_sc + core_sc) / 2)
    cur['oil_core_detail'] = {'wti_3m_chg': round(oil_chg, 1) if oil_chg is not None else None,
                              'corecpi_3m_ann': round(core_ann, 2) if core_ann is not None else None}
    cur['hy_oas'] = val('hy_oas', latest)
    # 盈亏平衡-实际利率 3个月变化差
    bk_now, bk_lag = val('breakeven10', latest), lag('breakeven10', latest, 3)
    rl_now, rl_lag = val('real10', latest), lag('real10', latest, 3)
    cur['bkrn_real_div'] = round((bk_now - bk_lag) - (rl_now - rl_lag), 2) if None not in (bk_now, bk_lag, rl_now, rl_lag) else None

    subs = {}
    for k in NAMES:
        v = cur.get(k)
        subs[k] = {'name': NAMES[k], 'value': v,
                   'score': score(k, v) if v is not None and k != 'oil_core' else (v if v is not None else None)}
    total = round(float(np.mean([s['score'] for s in subs.values() if s['score'] is not None])), 1)
    lvl = ('舒适区' if total < 20 else '温和压力' if total < 40 else
           '滞胀式压力升温' if total < 60 else '警戒区' if total < 80 else '滞胀定价区')

    # 黄金站队提示
    gold_note = ('盈亏平衡↑+实际利率↓=滞胀组合, 利多黄金' if cur['bkrn_real_div'] and cur['bkrn_real_div'] > 0.3
                 else '实际利率高企压制黄金, 滞胀利多未兑现' if cur['bkrn_real_div'] is not None and cur['bkrn_real_div'] < 0
                 else '多空均衡区')

    out = {
        'updated': datetime.datetime.now().strftime('%Y-%m-%d %H:%M'),
        'asof_month': latest,
        'total': total, 'level': lvl, 'gold_note': gold_note,
        'subscores': subs,
        'bands': {k: [[lo, hi, sc] for lo, hi, sc in v] for k, v in BANDS.items()},
        'rule': '五指标等权平均0-100; 详见脚本头注释',
    }
    os.makedirs(DATA, exist_ok=True)
    with open(os.path.join(DATA, 'stagflation.json'), 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    log('  总分 %.1f (%s) | %s' % (total, lvl, gold_note))
    for k, s in subs.items():
        log('    %-10s %-14s = %s -> %s 分' % (k, s['name'], s['value'], s['score']))

    # ---- 图 ----
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
        ks = list(NAMES)
        scs = [subs[k]['score'] for k in ks]
        vals = [subs[k]['value'] for k in ks]
        fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(10.5, 3.8), dpi=130, gridspec_kw={'width_ratios': [1, 2.2]})
        # 左: 总分仪表
        color = '#1E8449' if total < 20 else '#7CB342' if total < 40 else '#D97706' if total < 60 else '#E65100' if total < 80 else '#C0392B'
        ax1.barh([0], [total], color=color, height=0.5)
        ax1.barh([0], [100], color='#EEEEEE', height=0.5, zorder=0)
        ax1.set_xlim(0, 100)
        ax1.set_ylim(-0.55, 0.55)
        ax1.set_yticks([])
        ax1.set_title('滞胀压力总分  %.1f / 100\n%s' % (total, lvl), fontsize=13, fontweight='bold', color=color)
        for x, lbl in [(20, '舒适'), (40, '温和'), (60, '升温'), (80, '警戒')]:
            ax1.axvline(x, color='#BBB', lw=0.6, ls=':')
        ax1.text(total + 3, 0, '%.1f' % total, va='center', fontsize=13, fontweight='bold', color=color)
        # 右: 分项
        ypos = np.arange(len(ks))[::-1]
        cols = ['#2E6DA4'] * len(ks)
        ax2.barh(ypos, scs, color=cols, alpha=0.85, height=0.55)
        ax2.set_yticks(ypos)
        fmt_val = lambda v: ('%g' % round(v, 2)) if isinstance(v, (int, float)) else str(v)
        ax2.set_yticklabels(['%s\n(%s)' % (NAMES[k], fmt_val(vals[i])) for i, k in enumerate(ks)], fontsize=8.5)
        ax2.set_xlim(0, 100)
        ax2.axvline(50, color='#C0392B', lw=0.8, ls='--', alpha=0.6)
        for i, sc in enumerate(scs):
            ax2.text(sc + 1.5, ypos[i], '%d' % sc, va='center', fontsize=9)
        ax2.set_title('五个先行指标分项得分（%s 数据）' % latest, fontsize=10)
        ax2.set_xlabel('0=无压力  100=滞胀定价', fontsize=8)
        fig.tight_layout()
        os.makedirs(CHARTS, exist_ok=True)
        p = os.path.join(CHARTS, 'stagflation.png')
        fig.savefig(p, bbox_inches='tight')
        log('  写出 %s' % p)
    except Exception as e:
        log('  !! 画图跳过', repr(e)[:100])
    log('== 完成 %.1fs ==' % (time.time() - t0))


if __name__ == '__main__':
    main()
