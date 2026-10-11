#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
PMI · 2Y 利率敏感度系数跟踪（零 token · 全免费源）
====================================================
回答一个问题: "利率高企不伤 PMI" 是不是正在被数据证实？
把 v2 合成预测模型(ISM ~ 地区联储+ISM滞后+2Y滞后3季度)里的
2Y 利率项系数 b5 做成月度滚动跟踪:
  系数为负 = 2Y 利率越高 → 3季度后 PMI 越低(利率在咬经济)
  系数向 0 收窄 = 利率传导在失效(锁定低息融资/AI投资回报对利率不敏感...)
口径与 fetch_pmi_nowcast.py v2 完全一致(直接 import 复用), 两种窗:
  expanding  扩张窗走样本外(每月只用当月之前的数据, 与回测同口径)
  rolling60  60个月滚动窗(更平滑, 看局部结构)
产物: data/pmi_coef.json  (系数+t值全历史+⚙️解读)
      charts/pmi_coef.png  (系数曲线+显著性阴影+2021分界)
"""
import json, os, time, datetime

import numpy as np

from fetch_pmi_nowcast import (fred_series, fred_daily_monthly_avg, load_ism_actual,
                               build_table, FRED, DGS2_SID, TRAIN_MIN_OBS, FEAT_V2)

BASE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(BASE)
DATA = os.path.join(APP, 'data')
CHARTS = os.path.join(APP, 'charts')
DGS2_IDX = 5          # [const, empire, philly, dallas, ism_lag, dgs2_lag3q]
ROLL = 60             # 滚动窗月数
log = lambda *a: print(datetime.datetime.now().strftime('%H:%M:%S'), *a, flush=True)


def ols_coef_t(X, y, idx):
    """OLS 系数及 t 值, 返回 (coef, tstat)；样本不足返回 (None, None)"""
    Xd = np.column_stack([np.ones(len(X)), np.array(X, dtype=float)])
    y = np.array(y, dtype=float)
    n, k = Xd.shape
    if n <= k + 2:
        return None, None
    beta, *_ = np.linalg.lstsq(Xd, y, rcond=None)
    resid = y - Xd @ beta
    dof = n - k
    s2 = float(resid @ resid) / dof
    try:
        cov = s2 * np.linalg.inv(Xd.T @ Xd)
        se = float(np.sqrt(max(cov[idx, idx], 1e-12)))
    except np.linalg.LinAlgError:
        return float(beta[idx]), None
    return float(beta[idx]), float(beta[idx] / se)


def main():
    t0 = time.time()
    log('== 2Y利率敏感度系数跟踪开始 ==')
    regional = {}
    for name, sid in FRED.items():
        regional[name] = fred_series(sid)
        time.sleep(1.5)
    dgs2 = fred_daily_monthly_avg(DGS2_SID)
    ism = load_ism_actual()
    rows = build_table(regional, dgs2, ism)
    log('  完整案例 %d 个月 (%s ~ %s)' % (len(rows), rows[0][0], rows[-1][0]))

    X_all = [[r[1][j] for j in FEAT_V2] for r in rows]
    y_all = [r[2] for r in rows]

    exp_months, exp_coef, exp_t = [], [], []
    for i in range(TRAIN_MIN_OBS, len(rows)):
        c, t = ols_coef_t(X_all[:i], y_all[:i], DGS2_IDX)
        exp_months.append(rows[i][0]); exp_coef.append(c); exp_t.append(t)
    rol_months, rol_coef, rol_t = [], [], []
    for i in range(ROLL, len(rows) + 1):
        c, t = ols_coef_t(X_all[i - ROLL:i], y_all[i - ROLL:i], DGS2_IDX)
        rol_months.append(rows[i - 1][0]); rol_coef.append(c); rol_t.append(t)
    log('  扩张窗 %d 点, 滚动60窗 %d 点' % (len(exp_coef), len(rol_coef)))
    log('  最新: 扩张窗 %s b=%.3f t=%.2f | 滚动60 %s b=%.3f t=%.2f'
        % (exp_months[-1], exp_coef[-1], exp_t[-1] or 0, rol_months[-1], rol_coef[-1], rol_t[-1] or 0))

    # ⚙️ 规则解读: 2021 前后分段对比
    def seg_avg(ms, cs, y0):
        seg = [(m, c) for m, c in zip(ms, cs) if c is not None and int(m[:4]) >= y0]
        return (np.mean([c for _, c in seg]), len(seg)) if seg else (None, 0)
    pre_avg, pre_n = seg_avg(exp_months, exp_coef, 2016)
    pre_avg = None
    pre = [(m, c) for m, c in zip(exp_months, exp_coef) if c is not None and int(m[:4]) < 2021]
    post = [(m, c) for m, c in zip(exp_months, exp_coef) if c is not None and int(m[:4]) >= 2021]
    pre_m = float(np.mean([c for _, c in pre])) if pre else None
    post_m = float(np.mean([c for _, c in post])) if post else None
    lat3 = exp_coef[-3:]
    lat_m = float(np.mean([c for c in lat3 if c is not None]))
    rules = []
    if pre_m is not None and post_m is not None:
        chg = post_m - pre_m
        rules.append('2021年前均值 b=%.2f → 2021年后均值 b=%.2f：%s（PMI点/1pp 2Y利率，滞后3季度）'
                     % (pre_m, post_m, '系数收窄 %.2f, 利率敏感度下降' % chg if chg > 0 else '系数加深 %.2f, 利率敏感度上升' % chg))
    rules.append('近3个月系数均值 b=%.2f' % lat_m)
    t_now = exp_t[-1]
    rules.append('当前显著性: t=%.2f（%s）' % (t_now or 0, '显著' if t_now is not None and abs(t_now) >= 1.96 else '不显著'))
    note = '；'.join(rules)
    log('  %s' % note)

    out = {
        'updated': datetime.datetime.now().strftime('%Y-%m-%d %H:%M'),
        'desc': 'v2模型 2Y利率(滞后3季度)项系数月度跟踪: 负=利率咬经济, 向0收窄=传导失效; expanding=走样本外扩张窗, rolling60=60月滚动窗',
        'unit': 'PMI点 / 1pp 2Y收益率(滞后3季度)',
        'latest': {'month': exp_months[-1], 'coef': round(exp_coef[-1], 3), 'tstat': round(exp_t[-1], 2) if exp_t[-1] else None,
                   'coef_r60': round(rol_coef[-1], 3), 'tstat_r60': round(rol_t[-1], 2) if rol_t[-1] else None},
        'segments': {'pre2021_mean': round(pre_m, 3) if pre_m is not None else None,
                     'post2021_mean': round(post_m, 3) if post_m is not None else None,
                     'last3m_mean': round(lat_m, 3)},
        'note': note,
        'expanding': {'months': exp_months,
                      'coef': [round(c, 3) if c is not None else None for c in exp_coef],
                      'tstat': [round(t, 2) if t is not None else None for t in exp_t]},
        'rolling60': {'months': rol_months,
                      'coef': [round(c, 3) if c is not None else None for c in rol_coef],
                      'tstat': [round(t, 2) if t is not None else None for t in rol_t]},
    }
    os.makedirs(DATA, exist_ok=True)
    p_json = os.path.join(DATA, 'pmi_coef.json')
    with open(p_json, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    log('  写出 %s' % p_json)

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
        fig, ax = plt.subplots(figsize=(11, 4.4), dpi=130)
        ms = [datetime.datetime.strptime(m + '-01', '%Y-%m-%d') for m in exp_months]
        cs = np.array([np.nan if c is None else c for c in exp_coef])
        # 显著性阴影: |t|>=1.96 的时段加深
        ts = np.array([np.nan if t is None else t for t in exp_t])
        sig = np.abs(ts) >= 1.96
        ax.fill_between(ms, cs, 0, where=sig, color='#C0392B', alpha=0.18, lw=0, label='|t|≥1.96 显著区')
        ax.plot(ms, cs, color='#2E6DA4', lw=1.5, label='扩张窗系数（走样本外）')
        mr = [datetime.datetime.strptime(m + '-01', '%Y-%m-%d') for m in rol_months]
        ax.plot(mr, [np.nan if c is None else c for c in rol_coef], color='#d4a944', lw=1.6, label='60月滚动窗系数')
        ax.axhline(0, color='#555', lw=0.8)
        ax.axvline(datetime.datetime(2021, 1, 1), color='#888', lw=0.8, ls='--')
        ax.text(datetime.datetime(2021, 2, 1), ax.get_ylim()[1] * 0.9, '2021', fontsize=9, color='#888')
        ax.set_title('PMI 对 2Y 利率的敏感度系数（%s：b=%.2f，t=%.2f）——负=利率咬经济，向0收窄=传导失效'
                     % (exp_months[-1], exp_coef[-1], exp_t[-1] or 0), fontsize=11.5, fontweight='bold')
        ax.set_ylabel('系数（PMI点 / 1pp 2Y，滞后3季度）')
        ax.legend(loc='lower left', fontsize=9)
        ax.grid(alpha=0.25)
        fig.tight_layout()
        os.makedirs(CHARTS, exist_ok=True)
        p = os.path.join(CHARTS, 'pmi_coef.png')
        fig.savefig(p, bbox_inches='tight')
        log('  写出 %s' % p)
    except Exception as e:
        log('  !! 画图跳过', repr(e)[:100])
    log('== 完成 %.1fs ==' % (time.time() - t0))


if __name__ == '__main__':
    main()
