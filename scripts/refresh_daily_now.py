# -*- coding: utf-8 -*-
"""刷新宏观日报当前使用的核心日度序列；保留各指标真实观测日。"""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
import csv, io, json, datetime, requests

BASE = Path(__file__).resolve().parents[1]
TARGET = BASE / 'data' / 'chart_series.js'
raw = TARGET.read_text(encoding='utf-8')
data = json.loads(raw[raw.index('{'):].rstrip(';\n'))
S = requests.Session()
S.headers['User-Agent'] = 'Mozilla/5.0'

FRED = [
 'DGS3MO','DGS2','DGS5','DGS10','DGS30','T10Y2Y','T10Y3M','DFII10',
 'SOFR','SOFR99','IORB','EFFR','OBFR','DFEDTARU','DFEDTARL','RRPONTSYAWARD',
 'RRPONTSYD','WTREGEN','WRESBAL','WALCL','WDTGAL','WLCFLPCL','NFCI',
 'DTWEXBGS','BAMLH0A0HYM2','BAMLH0A0HYM2EY','BAMLC0A4CBBB',
 'T10YIE','T5YIFR','T5YIE','WEI','ICSA','UNRATE','PAYEMS',
 'CPIAUCSL','CPILFESL','DCOILWTICO','DCOILBRENTEU','DEXCHUS',
 'MMMFFAQ027S'
]
YAHOO = {
 'Y_GSPC':'^GSPC','Y_IXIC':'^IXIC','Y_NDX':'^NDX','Y_RUT':'^RUT',
 'Y_GOLD':'GC=F','Y_SLV':'SI=F','Y_COPPER':'HG=F',
 'Y_DXY':'DX-Y.NYB','Y_EURUSD':'EURUSD=X','Y_USDJPY':'JPY=X',
 'Y_HSI':'^HSI','Y_000300SS':'510300.SS','Y_MOVE':'^MOVE',
 'Y_NVDA':'NVDA',
 'Y_GVZ':'^GVZ','Y_OVX':'^OVX','VIXCLS':'^VIX',
 'Y_TLT':'TLT','Y_HYG':'HYG','Y_LQD':'LQD','Y_EMB':'EMB'
}

def get_fred(sid):
    u=f'https://fred.stlouisfed.org/graph/fredgraph.csv?id={sid}&cosd=2017-01-01'
    r=S.get(u,timeout=35); r.raise_for_status()
    if 'observation_date' not in r.text[:200]: raise ValueError('not CSV')
    out=[]
    for row in csv.DictReader(io.StringIO(r.text)):
        try: out.append([row['observation_date'],float(row[sid])])
        except (ValueError,KeyError): pass
    return sid,out

def get_yahoo(item):
    key,sym=item
    u='https://query1.finance.yahoo.com/v8/finance/chart/'+requests.utils.quote(sym,safe='')+'?range=5y&interval=1d'
    r=S.get(u,timeout=35); r.raise_for_status()
    result=r.json()['chart']['result'][0]
    ts=result.get('timestamp') or []
    close=result['indicators']['quote'][0]['close']
    out=[]
    for t,v in zip(ts,close):
        if v is not None:
            d=datetime.datetime.fromtimestamp(t,datetime.UTC).strftime('%Y-%m-%d')
            out.append([d,round(float(v),6)])
    return key,out

ok=[]; fail=[]
with ThreadPoolExecutor(max_workers=20) as ex:
    jobs=[ex.submit(get_fred,k) for k in FRED]+[ex.submit(get_yahoo,x) for x in YAHOO.items()]
    for f in as_completed(jobs):
        try:
            key,points=f.result()
            if points:
                data[key]=points; ok.append((key,points[-1])); print('OK',key,points[-1],flush=True)
            else: fail.append((key,'empty'))
        except Exception as e:
            fail.append(('unknown',str(e)[:100])); print('FAIL',str(e)[:100],flush=True)

# 重新计算日度利差及周度净流动性，避免基础序列更新后衍生值滞后。
def spread(a,b,scale=100):
    if a not in data or b not in data:return
    bm={p[0]:p[1] for p in data[b]}
    data[f'SPR_{a}_{b}']=[[p[0],round((p[1]-bm[p[0]])*scale,6)] for p in data[a] if p[0] in bm]
for a,b in [('SOFR','IORB'),('SOFR','EFFR'),('EFFR','IORB'),('OBFR','IORB')]:spread(a,b)
if all(k in data for k in ('WALCL','WTREGEN','RRPONTSYD')):
    w=data['WALCL']; t={p[0]:p[1] for p in data['WTREGEN']}; r={p[0]:p[1] for p in data['RRPONTSYD']}
    tv=rv=None; out=[]
    for d,wv in w:
        if d in t:tv=t[d]
        if d in r:rv=r[d]
        if tv is not None and rv is not None:out.append([d,round((wv-tv-rv*1000)/1e6,6)])
    data['NETLIQ']=out
TARGET.write_text('window.CHART_SERIES = '+json.dumps(data,ensure_ascii=False,separators=(',',':'))+';\n',encoding='utf-8')
print('SUCCESS',len(ok),'FAIL',len(fail))
for k,last in sorted(ok):print(k,last)
for x in fail:print('FAILED',x)
