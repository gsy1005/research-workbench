#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
增长现报 · WEI 每周经济指数（零 token · 免费源）
========================================
纽约联储 WEI（现由达拉斯联储维护, Lewis-Mertens-Stock）：
10 个日/周频硬数据（首申失业金/粗钢/电力/铁路货运/燃料销售/
预扣税/消费者信心等）的第一主成分, 刻度对齐"四季度GDP同比增速"。
季均 WEI ≈ GDP 同比, 单周噪声大看趋势, 拐点监测价值 > 点位预测。

数据源:
  WEI     —— FRED 系列 WEI（周频, %, 免key）
  GDP同比 —— FRED 系列 GDPC1（实际GDP季调, 计算同比）
产物: data/wei.json   （最新读数/13周均值/GDP对照/全历史）
      charts/wei.png   （WEI周度 + 13周均线 + GDP同比对照图）
解读规则（⚙️规则引擎, 不构成观点）:
  WEI<0            → 衰退区间（周度增长为负）
  MA13 连续下行   → 增长动能衰减预警
  MA13 vs GDP同比 → 现报相对已发布数据的冷热差
"""
import csv, io, json, os, time, datetime, urllib.request

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


def fred(sid, cosd='2008-01-01'):
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
            out.append((row[0], float(v)))
        except ValueError:
            pass
    return out


def main():
    t0 = time.time()
    log('== WEI 增长现报开始 ==')
    wei = fred('WEI')
    log('  WEI   %d 周  (%s ~ %s)' % (len(wei), wei[0][0] if wei else '-', wei[-1][0] if wei else '-'))
    time.sleep(1.2)
    gdp = fred('GDPC1', cosd='2006-01-01')  # 实际GDP(季调, 2017链式美元)
    log('  GDPC1 %d 季' % len(gdp))
    if not wei:
        log('!! WEI 拉取失败, 保留旧数据')
        return

    w_dates = [d for d, _ in wei]
    w_vals = np.array([v for _, v in wei])
    ma13 = np.convolve(w_vals, np.ones(13) / 13, mode='valid')
    ma_dates = w_dates[12:]

    # GDP 同比
    gdp_yoy = []
    gmap = {d[:4] + '-Q' + str((int(d[5:7]) - 1) // 3 + 1): v for d, v in gdp}
    qlist = sorted(gmap)
    for i, q in enumerate(qlist):
        y, qq = int(q[:4]), int(q[-1])
        pq = '%04d-Q%d' % (y - 1, qq)
        if pq in gmap and gmap[pq]:
            gdp_yoy.append((q, round((gmap[q] / gmap[pq] - 1) * 100, 2)))

    latest_w, latest_v = w_dates[-1], round(float(w_vals[-1]), 2)
    prev_v = round(float(w_vals[-2]), 2)
    ma13_now = round(float(ma13[-1]), 2)
    ma13_prev = round(float(ma13[-2]), 2)
    gdp_latest = gdp_yoy[-1] if gdp_yoy else (None, None)

    # ⚙️ 规则引擎结论
    rules = []
    if latest_v < 0:
        rules.append('⚠️ WEI 周度读数为负: 周度经济活动在收缩')
    else:
        rules.append('✓ WEI 为正: 周度经济活动仍在扩张')
    if ma13_now < ma13_prev:
        rules.append('13周均值环比回落 %.2f→%.2f: 动能边际衰减' % (ma13_prev, ma13_now))
    else:
        rules.append('13周均值环比回升 %.2f→%.2f: 动能边际改善' % (ma13_prev, ma13_now))
    if gdp_latest[0]:
        gap = round(ma13_now - gdp_latest[1], 2)
        rules.append('13周均值 %.2f%% vs 已发布GDP同比 %s%%: 现报%s %.2f 个点'
                     % (ma13_now, gdp_latest[1], '偏热' if gap > 0 else '偏冷', abs(gap)))
    note = '；'.join(rules)

    out = {
        'updated': datetime.datetime.now().strftime('%Y-%m-%d %H:%M'),
        'latest': {'week_ending': latest_w, 'value': latest_v, 'prev': prev_v,
                   'ma13': ma13_now, 'ma13_prev': ma13_prev},
        'gdp': {'quarter': gdp_latest[0], 'yoy': gdp_latest[1]},
        'note': note,
        'source': 'FRED: WEI(周频, 刻度=四季度GDP增速) / GDPC1; 原始发布: 纽约联储→达拉斯联储, 每周四更新',
        'history': {'week_ending': w_dates, 'wei': [round(float(v), 2) for v in w_vals],
                    'ma13_dates': ma_dates, 'ma13': [round(float(v), 2) for v in ma13],
                    'gdp_quarters': [q for q, _ in gdp_yoy], 'gdp_yoy': [v for _, v in gdp_yoy]},
    }
    os.makedirs(DATA, exist_ok=True)
    with open(os.path.join(DATA, 'wei.json'), 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    log('  最新周 %s = %.2f%% | MA13 %.2f%% | GDP同比 %s %s%%' % (latest_w, latest_v, ma13_now, gdp_latest[0], gdp_latest[1]))
    log('  %s' % note)

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
        wtd = [datetime.datetime.strptime(d, '%Y-%m-%d') for d in w_dates]
        mtd = [datetime.datetime.strptime(d, '%Y-%m-%d') for d in ma_dates]
        fig, ax = plt.subplots(figsize=(11, 4.2), dpi=130)
        ax.fill_between(wtd, w_vals, 0, where=(w_vals >= 0), color='#2E6DA4', alpha=0.30, lw=0)
        ax.fill_between(wtd, w_vals, 0, where=(w_vals < 0), color='#C0392B', alpha=0.45, lw=0)
        ax.plot(wtd, w_vals, color='#2E6DA4', lw=0.7, alpha=0.7, label='WEI 周度')
        ax.plot(mtd, ma13, color='#d4a944', lw=1.8, label='WEI 13周均值')
        ax.axhline(0, color='#888', lw=0.7)
        ax.set_ylabel('WEI（刻度=四季度GDP增速 %）')
        ax.set_title('WEI 每周经济指数 vs GDP 同比 · 增长现报（%s 周读数 %.2f%%）' % (latest_w, latest_v), fontsize=12, fontweight='bold')
        ax2 = ax.twinx()
        gq = []
        for q, _ in gdp_yoy:
            y, qq = int(q[:4]), int(q[-1])
            gq.append(datetime.datetime(y, qq * 3 - 2, 1))
        ax2.plot(gq, [v for _, v in gdp_yoy], color='#e5534b', lw=1.6, ls='--', label='实际GDP同比(右轴)')
        ax2.set_ylabel('GDP 同比 %', color='#e5534b')
        ax2.tick_params(axis='y', labelcolor='#e5534b')
        ax2.set_ylim(ax.get_ylim())
        h1, l1 = ax.get_legend_handles_labels()
        h2, l2 = ax2.get_legend_handles_labels()
        ax.legend(h1 + h2, l1 + l2, loc='upper left', fontsize=9, framealpha=0.85)
        ax.grid(alpha=0.25)
        fig.tight_layout()
        os.makedirs(CHARTS, exist_ok=True)
        p = os.path.join(CHARTS, 'wei.png')
        fig.savefig(p, bbox_inches='tight')
        log('  写出 %s' % p)
    except Exception as e:
        log('  !! 画图跳过', repr(e)[:100])
    log('== 完成 %.1fs ==' % (time.time() - t0))


if __name__ == '__main__':
    main()
