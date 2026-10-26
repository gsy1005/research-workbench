# -*- coding: utf-8 -*-
"""美股风险偏好与信用利差：ICE BofA / FRED / Yahoo Finance。"""
from pathlib import Path
import json, datetime, time, subprocess
from urllib.parse import quote
from bs4 import BeautifulSoup

BASE = Path(__file__).resolve().parents[1]
P = BASE / 'data' / 'chart_series.js'
raw = P.read_text(encoding='utf-8')
data = json.loads(raw[raw.index('{'):].rstrip(';\n'))

def curl_get(url):
    """系统 curl 在本机访问 FRED/Yahoo 比 Python TLS 连接稳定。"""
    last_error = None
    for attempt in range(3):
        try:
            r = subprocess.run(['curl.exe', '-fsSL', '--max-time', '60', url],
                               capture_output=True, timeout=70)
            if r.returncode or not r.stdout:
                raise RuntimeError(r.stderr.decode('utf-8', 'ignore')[:300])
            return r.stdout
        except (subprocess.SubprocessError, RuntimeError) as exc:
            last_error = exc
            time.sleep(2 * (attempt + 1))
    raise RuntimeError('Download failed: '+url) from last_error

def fred_many(sids):
    """FRED 表格镜像；当前 ICE 页面保留近3年，足够日报的1年视图。"""
    for sid in sids:
        text = curl_get('https://fred.stlouisfed.org/data/'+sid+'.txt').decode('utf-8', 'ignore')
        soup = BeautifulSoup(text, 'html.parser')
        out = []
        for row in soup.select('tr'):
            cells = row.find_all(['th', 'td'])
            if len(cells) == 2:
                d, v = cells[0].get_text(strip=True), cells[1].get_text(strip=True)
                try:
                    datetime.date.fromisoformat(d)
                    out.append([d, float(v)])
                except ValueError:
                    pass
        if not out: raise ValueError(sid+' empty')
        data[sid] = out
        print(sid, out[-1], flush=True)

def yahoo(key,sym):
    import requests
    path='/v8/finance/chart/'+quote(sym,safe='')+'?range=5y&interval=1d'
    raw_json = None
    for host in ['query2.finance.yahoo.com', 'query1.finance.yahoo.com']:
        try:
            r = requests.get('https://'+host+path, headers={'User-Agent':'Mozilla/5.0'}, timeout=35)
            r.raise_for_status()
            raw_json = r.content
            break
        except requests.RequestException:
            pass
    if raw_json is None:
        raw_json = curl_get('https://query2.finance.yahoo.com'+path)
    z=json.loads(raw_json)['chart']['result'][0]
    out=[]
    for t,v in zip(z.get('timestamp') or [],z['indicators']['quote'][0]['close']):
        if v is not None:out.append([datetime.datetime.fromtimestamp(t,datetime.UTC).strftime('%Y-%m-%d'),float(v)])
    if not out:raise ValueError(key+' empty')
    data[key]=out;print(key,out[-1],flush=True)

fred_many(['BAMLH0A1HYBB','BAMLH0A2HYB','BAMLH0A2HYBEY','BAMLH0A3HYC'])
for key,sym in [('Y_SPY','SPY'),('Y_RSP','RSP'),('Y_HYG','HYG'),('Y_TLT','TLT')]:
    yahoo(key,sym)

def combine(key,a,b,fn):
    bm={p[0]:p[1] for p in data[b]};out=[]
    for d,v in data[a]:
        if d in bm and bm[d] is not None:out.append([d,round(fn(v,bm[d]),6)])
    data[key]=out;print(key,out[-1])

combine('SPR_B_DGS10','BAMLH0A2HYBEY','DGS10',lambda a,b:(a-b)*100)
combine('SPR_HYG_TLT','Y_HYG','Y_TLT',lambda a,b:a-b)
combine('RATIO_RSP_SPY','Y_RSP','Y_SPY',lambda a,b:a/b*100)
combine('RATIO_RUT_GSPC','Y_RUT','Y_GSPC',lambda a,b:a/b*100)
P.write_text('window.CHART_SERIES = '+json.dumps(data,ensure_ascii=False,separators=(',',':'))+';\n',encoding='utf-8')
