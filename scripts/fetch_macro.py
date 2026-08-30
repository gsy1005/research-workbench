#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
宏观免费数据管道 v1 —— 特朗普专区12板块 + 日报/周报图表墙
数据源(全部免费/免key):
  FRED fredgraph.csv  (美联储经济数据, 免key)
  Yahoo Finance chart API (行情)
  Treasury FiscalData API (联邦债务, 免key)
  TSA 旅客安检量 (网页抓取, 尽力而为)
产物:
  data/chart_series.js   全量序列(增量合并, 绝不删除MM上传的键)
  data/macro_series.json 板块元数据(不含数据本体)
  data/macro_catalog.js  周报目录合并用
"""
import csv, io, json, os, re, sys, time, datetime, urllib.request, urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed

BASE = os.path.dirname(os.path.abspath(__file__))
APP  = os.path.dirname(BASE)
DATA = os.path.join(APP, 'data')

def log(*a): print(datetime.datetime.now().strftime('%H:%M:%S'), *a, flush=True)

def http_get(url, timeout=15, retries=2, backoff=1.0):
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (research-workbench)'})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read().decode('utf-8', 'replace')
        except Exception as e:
            log('  retry', i + 1, repr(e)[:110], url[:70])
            time.sleep(backoff * (i + 1))
    return None

# ---------- 抓取器 ----------
def fred(sid, limit=1700):
    t = http_get('https://fred.stlouisfed.org/graph/fredgraph.csv?id=%s' % sid,
                 timeout=20, retries=3, backoff=3.0)
    if not t or 'observation_date' not in t[:200]:
        return []
    out = []
    for row in csv.reader(io.StringIO(t)):
        if len(row) < 2 or row[0] == 'observation_date':
            continue
        d, v = row[0].strip(), row[1].strip()
        if v in ('.', '', 'NaN'):
            continue
        try:
            out.append([d, round(float(v), 4)])
        except ValueError:
            pass
    return out[-limit:]

def fred_batch(sids, limit=1700):
    """fredgraph 支持逗号分隔多条序列, 12条/批; 批失败回退单条"""
    out = {}
    for i in range(0, len(sids), 12):
        chunk = sids[i:i + 12]
        t = http_get('https://fred.stlouisfed.org/graph/fredgraph.csv?id=' + ','.join(chunk),
                     timeout=30, retries=3, backoff=4.0)
        rows = []
        if t and 'observation_date' in t[:200]:
            rows = list(csv.reader(io.StringIO(t)))
        if len(rows) > 1:
            col = {name: idx for idx, name in enumerate(rows[0])}
            for sid in chunk:
                if sid not in col:
                    out[sid] = []
                    continue
                ci = col[sid]
                ser = []
                for row in rows[1:]:
                    if len(row) <= ci:
                        continue
                    v = row[ci].strip()
                    if v in ('.', '', 'NaN'):
                        continue
                    try:
                        ser.append([row[0].strip(), round(float(v), 4)])
                    except ValueError:
                        pass
                out[sid] = ser[-limit:]
        else:
            log('  批失败, 回退单条:', ','.join(chunk))
            for sid in chunk:
                out[sid] = fred(sid)
                time.sleep(0.6)
        time.sleep(1.0)
    return out

def yahoo(sym, rng='5y'):
    url = 'https://query1.finance.yahoo.com/v8/finance/chart/%s?range=%s&interval=1d' % (urllib.parse.quote(sym, safe=''), rng)
    t = http_get(url)
    if not t:
        return []
    try:
        res = (json.loads(t).get('chart', {}).get('result') or [None])[0]
    except Exception:
        return []
    if not res:
        return []
    ts = res.get('timestamp') or []
    cl = ((res.get('indicators', {}).get('quote') or [{}])[0].get('close')) or []
    out = []
    for a, b in zip(ts, cl):
        if b is None:
            continue
        out.append([datetime.datetime.utcfromtimestamp(a).strftime('%Y-%m-%d'), round(float(b), 4)])
    return out

def us_debt():
    url = ('https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/'
           'accounting/od/debt_to_penny?sort=-record_date&page[size]=3000'
           '&fields=record_date,tot_pub_debt_out_amt')
    t = http_get(url)
    if not t:
        return []
    try:
        rows = json.loads(t).get('data', [])
    except Exception:
        return []
    out = []
    for r in rows:
        try:
            v = float(str(r.get('tot_pub_debt_out_amt', '')).replace(',', '')) / 1e12
            out.append([r['record_date'], round(v, 4)])
        except Exception:
            pass
    out.sort()
    return out

def tsa_pax():
    """TSA 每日安检旅客量(本年), 失败返回[]"""
    t = http_get('https://www.tsa.gov/travel/passenger-volumes', timeout=40, retries=2)
    if not t:
        return []
    out = []
    cur = str(datetime.datetime.now().year)
    for m in re.finditer(r'<tr>\s*<td[^>]*>\s*(\d{1,2}/\d{1,2}/\d{4})\s*</td>\s*<td[^>]*>\s*([\d,]+)\s*</td>', t):
        ds, num = m.group(1), m.group(2)
        if not ds.endswith(cur):
            continue
        try:
            dt = datetime.datetime.strptime(ds, '%m/%d/%Y').strftime('%Y-%m-%d')
            out.append([dt, round(int(num.replace(',', '')) / 1e6, 4)])
        except Exception:
            pass
    out.sort()
    return out

# ---------- 衍生计算 ----------
def yoy(series, n):
    out = []
    for i in range(n, len(series)):
        prev = series[i - n][1]
        if prev:
            out.append([series[i][0], round((series[i][1] / prev - 1) * 100, 3)])
    return out

def diff(series, n=1):
    return [[series[i][0], round(series[i][1] - series[i - n][1], 3)] for i in range(n, len(series))]

# ---------- 序列注册表 ----------
# (id, 名称, 单位, 板块, 来源标注, 抓取方式)
S = []
def add(sid, name, unit, sec, src, how):
    S.append(dict(id=sid, name=name, unit=unit, sec=sec, src=src, how=how))

# 利率 rate
add('DGS10', '美债10Y收益率', '%', 'rate', 'L1·FRED', ('fred', 'DGS10'))
add('DGS2', '美债2Y收益率', '%', 'rate', 'L1·FRED', ('fred', 'DGS2'))
add('DGS30', '美债30Y收益率', '%', 'rate', 'L1·FRED', ('fred', 'DGS30'))
add('T10Y2Y', '10Y-2Y利差', '%', 'rate', 'L1·FRED', ('fred', 'T10Y2Y'))
add('DFII10', '10Y实际利率TIPS', '%', 'rate', 'L1·FRED', ('fred', 'DFII10'))
add('DFF', '联邦基金有效利率', '%', 'rate', 'L1·FRED', ('fred', 'DFF'))
add('SOFR', 'SOFR', '%', 'rate', 'L1·FRED', ('fred', 'SOFR'))
add('BAMLH0A0HYM2', '高收益债利差OAS', '%', 'rate', 'L1·FRED/ICE', ('fred', 'BAMLH0A0HYM2'))
add('MORTGAGE30US', '30年房贷利率', '%', 'rate', 'L1·FRED', ('fred', 'MORTGAGE30US'))
# 物价 price
add('CPIAUCSL_YOY', 'CPI同比', '%', 'price', 'L1·FRED/BLS⚙️同比', ('yoy', 'CPIAUCSL', 12))
add('CPILFESL_YOY', '核心CPI同比', '%', 'price', 'L1·FRED/BLS⚙️同比', ('yoy', 'CPILFESL', 12))
add('PCEPI_YOY', 'PCE同比', '%', 'price', 'L1·FRED/BEA⚙️同比', ('yoy', 'PCEPI', 12))
add('PCEPILFE_YOY', '核心PCE同比', '%', 'price', 'L1·FRED/BEA⚙️同比', ('yoy', 'PCEPILFE', 12))
add('PPIACO_YOY', 'PPI同比', '%', 'price', 'L1·FRED/BLS⚙️同比', ('yoy', 'PPIACO', 12))
add('T10YIE', '10Y盈亏平衡通胀', '%', 'price', 'L1·FRED', ('fred', 'T10YIE'))
add('T5YIE', '5Y盈亏平衡通胀', '%', 'price', 'L1·FRED', ('fred', 'T5YIE'))
add('MICH', '密歇根1年通胀预期', '%', 'price', 'L1·FRED/UMich', ('fred', 'MICH'))
# 就业 jobs
add('UNRATE', '失业率U3', '%', 'jobs', 'L1·FRED/BLS', ('fred', 'UNRATE'))
add('U6RATE', '失业率U6', '%', 'jobs', 'L1·FRED/BLS', ('fred', 'U6RATE'))
add('PAYEMS_CHG', '非农新增(月)', '千人', 'jobs', 'L1·FRED/BLS⚙️差分', ('diff', 'PAYEMS', 1))
add('ICSA', '初请失业金(周)', '千人', 'jobs', 'L1·FRED/DOL', ('fred', 'ICSA'))
add('JTSJOL', 'JOLTS职位空缺', '千人', 'jobs', 'L1·FRED/BLS', ('fred', 'JTSJOL'))
add('CES0500000003_YOY', '平均时薪同比', '%', 'jobs', 'L1·FRED/BLS⚙️同比', ('yoy', 'CES0500000003', 12))
add('MANEMP', '制造业就业', '千人', 'jobs', 'L1·FRED/BLS', ('fred', 'MANEMP'))
# 能源 energy
add('DCOILWTICO', 'WTI原油', '美元/桶', 'energy', 'L1·FRED/EIA', ('fred', 'DCOILWTICO'))
add('DCOILBRENTEU', '布伦特原油', '美元/桶', 'energy', 'L1·FRED/EIA', ('fred', 'DCOILBRENTEU'))
add('DHHNGSP', 'HenryHub天然气', '美元/MMBtu', 'energy', 'L1·FRED/EIA', ('fred', 'DHHNGSP'))
add('GASREGW', '全美汽油零售价', '美元/加仑', 'energy', 'L1·FRED/EIA', ('fred', 'GASREGW'))
add('WCRFPUS2', '美国原油产量(周)', '百万桶/日', 'energy', 'L1·FRED/EIA', ('fred', 'WCRFPUS2'))
# 财政 fiscal
add('US_DEBT', '联邦债务总额', '万亿美元', 'fiscal', 'L1·财政部FiscalData', ('debt',))
add('MTSDS133FMS', '联邦月度赤字(-)/盈余', '百万美元', 'fiscal', 'L1·FRED/财政部', ('fred', 'MTSDS133FMS'))
add('A091RC1Q027SBEA', '联邦净利息支出(年化)', '十亿美元', 'fiscal', 'L1·FRED/BEA', ('fred', 'A091RC1Q027SBEA'))
add('WTREGEN', 'TGA财政部现金(周)', '十亿美元', 'fiscal', 'L1·FRED', ('fred', 'WTREGEN'))
add('GFDEGDQ188S', '联邦债务/GDP', '%', 'fiscal', 'L1·FRED', ('fred', 'GFDEGDQ188S'))
# 贸易 trade
add('BOPGSTB', '商品与服务贸易差额', '百万美元', 'trade', 'L1·FRED/BEA', ('fred', 'BOPGSTB'))
add('EXPGS', '商品与服务出口', '百万美元', 'trade', 'L1·FRED/BEA', ('fred', 'EXPGS'))
add('IMPGS', '商品与服务进口', '百万美元', 'trade', 'L1·FRED/BEA', ('fred', 'IMPGS'))
# 美中竞赛 cn
add('DEXCHUS', '美元兑人民币', '元/美元', 'cn', 'L1·FRED', ('fred', 'DEXCHUS'))
add('Y_000300SS', '沪深300ETF', '元', 'cn', 'L2·Yahoo', ('yahoo', '510300.SS'))
add('Y_HSI', '恒生指数', '点', 'cn', 'L2·Yahoo', ('yahoo', '^HSI'))
add('IRLTLT01CNM156N', '中国10Y国债收益率', '%', 'cn', 'L1·FRED/OECD', ('fred', 'IRLTLT01CNM156N'))
add('IMPCH', '美国自中国进口', '百万美元', 'cn', 'L1·FRED/Census', ('fred', 'IMPCH'))
add('EXPCH', '美国对中国出口', '百万美元', 'cn', 'L1·FRED/Census', ('fred', 'EXPCH'))
add('CNTRADE', '美国对华贸易差额', '百万美元', 'cn', 'L1·FRED/Census⚙️计算', ('calc_cn',))
add('B235RC1Q027SBEA', '联邦关税收入(年化)', '十亿美元', 'cn', 'L1·FRED/BEA', ('fred', 'B235RC1Q027SBEA'))
# 资产 asset
add('Y_GSPC', '标普500', '点', 'asset', 'L2·Yahoo', ('yahoo', '^GSPC'))
add('Y_IXIC', '纳斯达克综指', '点', 'asset', 'L2·Yahoo', ('yahoo', '^IXIC'))
add('VIXCLS', 'VIX波动率', '点', 'asset', 'L1·FRED/CBOE', ('fred', 'VIXCLS'))
add('Y_DXY', '美元指数DXY', '点', 'asset', 'L2·Yahoo', ('yahoo', 'DX-Y.NYB'))
add('Y_GOLD', 'COMEX黄金', '美元/盎司', 'asset', 'L2·Yahoo', ('yahoo', 'GC=F'))
add('Y_BTC', '比特币', '美元', 'asset', 'L2·Yahoo', ('yahoo', 'BTC-USD'))
add('CSUSHPISA_YOY', 'CS房价指数同比', '%', 'asset', 'L1·FRED/S&P⚙️同比', ('yoy', 'CSUSHPISA', 12))
add('HOUST', '新屋开工', '千户', 'asset', 'L1·FRED/Census', ('fred', 'HOUST'))
add('WALCL', '美联储总资产(周)', '十亿美元', 'asset', 'L1·FRED', ('fred', 'WALCL'))
# 制造业 mfg
add('INDPRO_YOY', '工业产出同比', '%', 'mfg', 'L1·FRED⚙️同比', ('yoy', 'INDPRO', 12))
add('IPMAN_YOY', '制造业产出同比', '%', 'mfg', 'L1·FRED⚙️同比', ('yoy', 'IPMAN', 12))
add('TCU', '产能利用率', '%', 'mfg', 'L1·FRED', ('fred', 'TCU'))
add('DGORDER_YOY', '耐用品订单同比', '%', 'mfg', 'L1·FRED/Census⚙️同比', ('yoy', 'DGORDER', 12))
add('NEWORDER', '核心资本品订单', '百万美元', 'mfg', 'L1·FRED/Census', ('fred', 'NEWORDER'))
# 国际移动 move
add('TSA_PAX', 'TSA日均安检旅客', '百万人', 'move', 'L1·TSA', ('tsa',))
# 民调 poll 补充(支持率主图在 trump_zone.json)
add('UMCSENT', '密歇根消费者信心', '点', 'poll', 'L1·FRED/UMich', ('fred', 'UMCSENT'))
# 仅刷新不进板块(周报已在用的序列)
for extra in ['EFFR', 'RRPONTSYD', 'WEI', 'GDPNOW', 'BAMLC0A4CBBB', 'PAYEMS',
              'CPIAUCSL', 'CPILFESL', 'PCEPILFE', 'PERMIT', 'EXHOSLUSM495S',
              'CSUSHPISA', 'HOSSUPUSM673N', 'INDPRO', 'BUSINV', 'ISRATIO',
              'RSAFS', 'PCEC96', 'PSAVERT', 'DSPIC96', 'CES0500000003']:
    add(extra, extra, '', None, 'L1·FRED', ('fred', extra))

SECTIONS = [
    ('poll',   '民调'),
    ('pm',     '市场政策预期'),
    ('cn',     '美中竞赛'),
    ('fiscal', '财政'),
    ('trade',  '贸易'),
    ('price',  '物价'),
    ('rate',   '利率'),
    ('jobs',   '就业'),
    ('energy', '能源'),
    ('asset',  '资产'),
    ('mfg',    '制造业'),
    ('move',   '国际移动'),
]

def main():
    os.makedirs(DATA, exist_ok=True)
    cs_path = os.path.join(DATA, 'chart_series.js')
    hist = {}
    if os.path.exists(cs_path):
        s = open(cs_path, encoding='utf-8').read()
        try:
            hist = json.loads(s[s.index('{'):s.rindex('}') + 1])
        except Exception:
            hist = {}
    # 1) 收集所有基础抓取任务(含衍生序列的底座)
    fred_ids, other_jobs = [], {}
    for it in S:
        how = it['how']; kind = how[0]
        if kind in ('fred', 'yoy', 'diff'):
            if how[1] not in fred_ids: fred_ids.append(how[1])
        elif kind == 'yahoo':
            other_jobs[it['id']] = (lambda sym: lambda: yahoo(sym))(how[1])
        elif kind == 'debt':
            other_jobs['US_DEBT'] = us_debt
        elif kind == 'tsa':
            other_jobs['TSA_PAX'] = tsa_pax
    raw = {}
    # 2a) FRED: 12条/批合并请求(绕开限流)
    log('FRED批量抓取', len(fred_ids), '条…')
    t0 = time.time()
    raw.update(fred_batch(fred_ids))
    log('FRED完成, 用时%.0fs' % (time.time() - t0))
    # 2b) Yahoo/财政部/TSA 并发
    with ThreadPoolExecutor(max_workers=6) as ex:
        futs = {ex.submit(fn): key for key, fn in other_jobs.items()}
        for fu in as_completed(futs):
            key = futs[fu]
            try:
                raw[key] = fu.result() or []
            except Exception as e:
                raw[key] = []
                log('  x', key, repr(e)[:120])
    # 2) 计算+入库
    ok, fail = [], []
    for it in S:
        how = it['how']; kind = how[0]
        try:
            if kind in ('fred', 'debt', 'tsa'):
                ser = raw.get(how[1] if kind == 'fred' else it['id'], [])
            elif kind == 'yahoo':
                ser = raw.get(it['id'], [])
            elif kind == 'yoy':
                ser = yoy(raw.get(how[1], []), how[2])
            elif kind == 'diff':
                ser = diff(raw.get(how[1], []), how[2])
            elif kind == 'calc_cn':
                bd = dict(raw.get('EXPCH', []))
                ser = [[d, round(v - bd[d], 1)] for d, v in raw.get('IMPCH', []) if d in bd]
            else:
                ser = []
            if ser and len(ser) >= 3:
                hist[it['id']] = ser
                ok.append(it['id'])
            else:
                fail.append(it['id'])
        except Exception as e:
            fail.append(it['id'])
            log('  x', it['id'], repr(e)[:120])
    # 写 chart_series.js (只更新本次抓到的键, MM上传的键原样保留)
    with open(cs_path, 'w', encoding='utf-8') as f:
        f.write('window.CHART_SERIES = ' + json.dumps(hist, separators=(',', ':')) + ';')
    # 板块元数据
    meta = {'updated': datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).strftime('%Y-%m-%d %H:%M') + ' 北京',
            'sections': []}
    for key, name in SECTIONS:
        items = [{'id': it['id'], 'name': it['name'], 'unit': it['unit'], 'src': it['src'],
                  'n': len(hist.get(it['id'], [])), 'last': (hist.get(it['id']) or [[None, None]])[-1]}
                 for it in S if it['sec'] == key]
        meta['sections'].append({'key': key, 'name': name, 'items': items})
    with open(os.path.join(DATA, 'macro_series.json'), 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, separators=(',', ':'))
    with open(os.path.join(DATA, 'macro_catalog.js'), 'w', encoding='utf-8') as f:
        cat = [{'id': it['id'], 'name': it['name'], 'unit': it['unit']} for it in S if it['sec']]
        f.write('window.MACRO_CATALOG = ' + json.dumps(cat, ensure_ascii=False, separators=(',', ':')) + ';')
    log('完成: 成功%d 失败%d | chart_series键数%d' % (len(ok), len(fail), len(hist)))
    log('失败:', ','.join(fail) if fail else '无')

if __name__ == '__main__':
    main()
