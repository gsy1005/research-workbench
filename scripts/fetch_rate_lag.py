#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
利率多久影响经济 · 传导时滞全证据（零 token · 全免费源）
==========================================================
回答: 利率变动(以2Y美债收益率为代理)影响实体经济的时滞有多长？
三组独立证据互相印证:
  1. 领先-滞后相关剖面: corr(Δ2Y_t, 变量_{t+k}), k=0..24月 —— 相关峰出现的月份
  2. 分布式滞后系数剖面: 单滞后回归 beta_k —— 每滞后1pp利率冲击, 变量k个月后响应多少
  3. 三轮加息周期事件研究: 2004-06 / 2015-12 / 2022-03 起36个月,
     地产(许可)→工业→就业→失业率 谁先倒、谁后倒
变量: PERMIT(建筑许可,地产链) / INDPRO(工业产出) / PAYEMS(非农,就业) /
      UNRATE(失业率) / ISM(本地库) / GPDI(私人投资,季度)
产物: data/rate_lag.json + charts/rate_lag_xcorr.png / rate_lag_profile.png / rate_cycles.png
"""
import json, os, time, datetime, csv, io, urllib.request

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
    'fedfunds': ('FEDFUNDS', 'm'),
    'dgs2': ('DGS2', 'd'),
    'permit': ('PERMIT', 'm'),
    'indpro': ('INDPRO', 'm'),
    'payems': ('PAYEMS', 'm'),
    'unrate': ('UNRATE', 'm'),
    'gpdi': ('GPDI', 'q'),
}
MAXLAG = 36
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


def fred_monthly(sid, kind='m'):
    t = http_get('https://fred.stlouisfed.org/graph/fredgraph.csv?id=%s&cosd=1985-01-01' % sid)
    if not t or 'observation_date' not in t[:200]:
        return {}
    acc = {}
    for row in csv.reader(io.StringIO(t)):
        if len(row) < 2 or row[0] == 'observation_date':
            continue
        v = row[1].strip()
        if v in ('.', '', 'NaN'):
            continue
        try:
            fv = float(v)
        except ValueError:
            continue
        if kind == 'd':
            acc.setdefault(row[0][:7], []).append(fv)
        else:
            acc[row[0][:7]] = fv
    if kind == 'd':
        return {k: sum(vs) / len(vs) for k, vs in acc.items()}
    return acc


def yoy(m):
    out = {}
    for mk, v in m.items():
        y, mo = int(mk[:4]), int(mk[5:7])
        pv = m.get('%04d-%02d' % (y - 1, mo))
        if pv:
            out[mk] = (v / pv - 1) * 100
    return out


def d12(m):
    """12个月差（pp 或 %）"""
    out = {}
    for mk, v in m.items():
        y, mo = int(mk[:4]), int(mk[5:7])
        pv = m.get('%04d-%02d' % (y - 1, mo))
        if pv is not None:
            out[mk] = v - pv
    return out


def qfill(qmap):
    """季频->月度前向填充"""
    out = {}
    if not qmap:
        return out
    items = sorted(qmap.items())
    y0, m0 = int(items[0][0][:4]), int(items[0][0][5:7])
    y1, m1 = int(items[-1][0][:4]), int(items[-1][0][5:7])
    n = (y1 - y0) * 12 + (m1 - m0)
    cur, qi = None, 0
    for k in range(n + 1):
        mk = '%04d-%02d' % (y0 + (m0 - 1 + k) // 12, (m0 - 1 + k) % 12 + 1)
        while qi < len(items) and items[qi][0] <= mk:
            cur = items[qi][1]
            qi += 1
        if cur is not None:
            out[mk] = cur
    return out


def lag_align(shock, target, k):
    """取 target 领先 shock k 个月的对齐序列"""
    xs, ys = [], []
    for mk, sv in shock.items():
        y, mo = int(mk[:4]), int(mk[5:7])
        t = y * 12 + mo - 1 + k
        tv = target.get('%04d-%02d' % (t // 12, t % 12 + 1))
        if tv is not None:
            xs.append(sv)
            ys.append(tv)
    return np.array(xs), np.array(ys)


def main():
    t0 = time.time()
    log('== 利率传导时滞全证据开始 ==')
    raw = {}
    for name, (sid, kind) in SERIES.items():
        raw[name] = fred_monthly(sid, kind)
        log('  %-8s %-10s %d' % (name, sid, len(raw[name])))
        time.sleep(1.2)

    # 冲击: 2Y 收益率 12 个月变化
    shock = d12(raw['dgs2'])
    # 变量: 各自平稳化变换
    vars_ = {
        '地产 建筑许可同比': yoy(raw['permit']),
        '工业 工业产出同比': yoy(raw['indpro']),
        '投资 私人投资同比(季)': yoy(qfill(raw['gpdi'])),
        '就业 非农就业同比': yoy(raw['payems']),
        '失业 失业率12个月变化': d12(raw['unrate']),
    }
    # ISM 本地库
    try:
        import re
        t = open(os.path.join(DATA, 'ht_series_us_econ.js'), encoding='utf-8').read()
        m = re.search(r'Object\.assign\(window\.HT_SERIES\|\|\{\},(\{.*\})\)', t, re.S)
        d = json.loads(m.group(1))
        for key in ('HT_us_econ_总表_ISM制造业PMI',):
            if key in d:
                ism = {dt[:7]: float(v) for dt, v in d[key]['series']}
                vars_['景气 ISM制造业PMI水平'] = ism
                break
    except Exception as e:
        log('  ISM 读取失败', repr(e)[:80])

    # ---------- 证据1+2: 相关剖面 与 单滞后beta剖面 ----------
    lags = list(range(0, MAXLAG + 1))
    xcorr, beta = {}, {}
    peak = {}
    for name, tgt in vars_.items():
        cs, bs = [], []
        for k in lags:
            x, y = lag_align(shock, tgt, k)
            if len(x) < 60:
                cs.append(np.nan)
                bs.append(np.nan)
                continue
            cs.append(float(np.corrcoef(x, y)[0, 1]))
            xd = np.column_stack([np.ones(len(x)), x])
            b, *_ = np.linalg.lstsq(xd, y, rcond=None)
            bs.append(float(b[1]))
        xcorr[name] = cs
        beta[name] = bs
        arr = np.array([np.nan if v is None else v for v in cs])
        # 传导峰: 6-30月窗内按经济理论方向取极值(活动类取负谷, 失业率取正峰)
        # 注: 12个月差分变换会把真实时滞右移约6个月, 报告口径需说明
        win = [(k, v) for k, v in zip(lags, cs) if v is not None and 6 <= k <= 30]
        if '失业' in name:
            k_pk, v_pk = max(win, key=lambda kv: kv[1])
        else:
            k_pk, v_pk = min(win, key=lambda kv: kv[1])
        peak[name] = {'trough_lag_months': k_pk, 'r': round(v_pk, 3)}
        log('  %-18s 传导谷 k=%2d 月 (r=%.2f)' % (name, k_pk, v_pk))

    # ---------- 证据3: 三轮加息周期事件研究 ----------
    cycles = [('2004-06', '2004-06~2007加息周期'), ('2015-12', '2015-12~2019加息周期'), ('2022-03', '2022-03~2024加息周期')]
    cyc_data = {}
    for start, label in cycles:
        y, mo = int(start[:4]), int(start[5:7])
        months = []
        for k in range(37):
            t = y * 12 + mo - 1 + k
            months.append('%04d-%02d' % (t // 12, t % 12 + 1))
        def idx_series(m):
            base = m.get(start)
            return [(m.get(mk) / base * 100 if base and m.get(mk) is not None else None) for mk in months]
        cyc_data[label] = {
            'months': months,
            'fedfunds': [raw['fedfunds'].get(mk) for mk in months],
            'permit_idx': idx_series(raw['permit']),
            'indpro_idx': idx_series(raw['indpro']),
            'payems_idx': idx_series(raw['payems']),
        }
        log('  周期 %s 提取完成' % label)

    out = {
        'updated': datetime.datetime.now().strftime('%Y-%m-%d %H:%M'),
        'shock': '2Y美债收益率(DGS2) 12个月变化, 单位pp',
        'lags_months': lags,
        'peak_lag': peak,
        'xcorr': {k: [None if v is None or (isinstance(v, float) and np.isnan(v)) else round(v, 3) for v in vs]
                  for k, vs in xcorr.items()},
        'beta': {k: [None if v is None or (isinstance(v, float) and np.isnan(v)) else round(v, 3) for v in vs]
                 for k, vs in beta.items()},
        'cycles': cyc_data,
    }
    os.makedirs(DATA, exist_ok=True)
    with open(os.path.join(DATA, 'rate_lag.json'), 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    log('  写出 rate_lag.json')

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
        os.makedirs(CHARTS, exist_ok=True)

        colors = ['#2E6DA4', '#d4a944', '#3fb950', '#e5534b', '#9b59b6', '#e67e22']
        # 图1: 相关剖面
        fig, ax = plt.subplots(figsize=(11, 4.6), dpi=130)
        for i, (name, cs) in enumerate(xcorr.items()):
            ax.plot(lags, [np.nan if v is None else v for v in cs], lw=1.6, color=colors[i % 6], label=name)
        ax.axvspan(18, 30, color='#d4a944', alpha=0.10)
        ax.text(24, ax.get_ylim()[1] * 0.90, '18-30月\n负效应兑现区\n(12月差分口径)', ha='center', fontsize=9, color='#8a6d1a')
        ax.axhline(0, color='#555', lw=0.7)
        ax.set_xlabel('利率冲击后月份 k')
        ax.set_ylabel('corr(Δ2Y_t, 变量_{t+k})')
        ax.set_title('证据1 · 领先-滞后相关剖面：相关峰落在第几个月', fontsize=12, fontweight='bold')
        ax.legend(fontsize=9, ncol=3)
        ax.grid(alpha=0.25)
        fig.tight_layout()
        fig.savefig(os.path.join(CHARTS, 'rate_lag_xcorr.png'), bbox_inches='tight')
        plt.close(fig)

        # 图2: beta剖面
        fig, ax = plt.subplots(figsize=(11, 4.6), dpi=130)
        for i, (name, bs) in enumerate(beta.items()):
            ax.plot(lags, [np.nan if v is None else v for v in bs], lw=1.6, color=colors[i % 6], label=name)
        ax.axhline(0, color='#555', lw=0.7)
        ax.set_xlabel('利率冲击后月份 k')
        ax.set_ylabel('β_k：k个月后对1pp利率冲击的响应')
        ax.set_title('证据2 · 分布式滞后系数剖面：响应的时序形状', fontsize=12, fontweight='bold')
        ax.legend(fontsize=9, ncol=3)
        ax.grid(alpha=0.25)
        fig.tight_layout()
        fig.savefig(os.path.join(CHARTS, 'rate_lag_profile.png'), bbox_inches='tight')
        plt.close(fig)

        # 图3: 三轮加息周期
        fig, axes = plt.subplots(3, 1, figsize=(11, 9), dpi=130, sharex=True)
        var_lines = [('permit_idx', '建筑许可(指数)', '#2E6DA4'),
                     ('indpro_idx', '工业产出(指数)', '#d4a944'),
                     ('payems_idx', '非农就业(指数)', '#3fb950')]
        for ax, (label, cd) in zip(axes, cyc_data.items()):
            xs = range(len(cd['months']))
            ax2 = ax.twinx()
            ax2.plot(xs, cd['fedfunds'], color='#C0392B', lw=1.8, ls='--', label='联邦基金利率(右)')
            ax2.set_ylabel('FFR %', color='#C0392B')
            ax2.tick_params(axis='y', labelcolor='#C0392B')
            for key, lbl, c in var_lines:
                ys = [np.nan if v is None else v for v in cd[key]]
                ax.plot(xs, ys, lw=1.5, color=c, label=lbl)
            ax.axhline(100, color='#888', lw=0.6, ls=':')
            ax.set_ylabel('加息起点=100')
            ax.set_title(label, fontsize=11)
            h1, l1 = ax.get_legend_handles_labels()
            h2, l2 = ax2.get_legend_handles_labels()
            ax.legend(h1 + h2, l1 + l2, fontsize=8, loc='lower left', ncol=4)
            ax.grid(alpha=0.2)
        axes[-1].set_xlabel('加息起点后月份')
        fig.suptitle('证据3 · 三轮加息周期事件研究：谁先倒？（所有变量在加息起点归一化=100）', fontsize=12, fontweight='bold')
        fig.tight_layout(rect=[0, 0, 1, 0.97])
        fig.savefig(os.path.join(CHARTS, 'rate_cycles.png'), bbox_inches='tight')
        log('  写出 3 张证据图')
    except Exception as e:
        log('  !! 画图跳过', repr(e)[:120])
    log('== 完成 %.1fs ==' % (time.time() - t0))


if __name__ == '__main__':
    main()
