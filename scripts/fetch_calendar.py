#!/usr/bin/env python3
# 宏观日历预期值 → data/calendar_consensus.json
# 双源合并:
#   A. ForexFactory 免费公开周历 XML —— 本周 USD/CNY 高/中重要性事件, 带 预期/前值/实际
#   B. 东方财富财经日历 (RPT_CPH_FECALENDAR) —— 未来14天全球宏观数据+财经会议/大事,
#      中文名+北京时间, 覆盖中国数据(CPI/PMI/M1/外储/贸易)、欧日英加央行决议等, 但无预期值
# 合并逻辑: FF供预期值(仅本周), EM供全景骨架(14天); 前端按日期挂芯片
# 证据分层: L2·权威财经数据商汇编(底层均为官方机构预告)
# 单源失败不影响另一源; 全失败保留旧文件并标 stale。
import json, os, re, sys, datetime, xml.etree.ElementTree as ET

APP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(APP, 'data', 'calendar_consensus.json')
URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.xml'

CN_MAP = {
    # 美国
    'Non-Farm Employment Change': '非农就业变动', 'Unemployment Rate': '失业率',
    'Average Hourly Earnings m/m': '平均时薪环比', 'CPI m/m': 'CPI环比', 'Core CPI m/m': '核心CPI环比',
    'CPI y/y': 'CPI同比', 'Core CPI y/y': '核心CPI同比', 'PPI m/m': 'PPI环比', 'Core PPI m/m': '核心PPI环比',
    'PPI y/y': 'PPI同比', 'ISM Manufacturing PMI': 'ISM制造业PMI', 'ISM Services PMI': 'ISM服务业PMI',
    'ISM Manufacturing Prices': 'ISM制造业物价指数', 'JOLTS Job Openings': 'JOLTS职位空缺',
    'ADP Non-Farm Employment Change': 'ADP就业变动', 'Unemployment Claims': '初请失业金',
    'Retail Sales m/m': '零售销售环比', 'Core Retail Sales m/m': '核心零售环比',
    'Advance GDP q/q': 'GDP环比折年初值', 'GDP q/q': 'GDP环比折年',
    'Personal Spending m/m': '个人支出环比', 'Personal Income m/m': '个人收入环比',
    'Core PCE Price Index m/m': '核心PCE物价环比', 'PCE Price Index m/m': 'PCE物价环比',
    'PCE price index m/m': 'PCE物价环比',
    'CB Consumer Confidence': '咨商会消费者信心', 'Michigan Consumer Sentiment': '密歇根消费者信心',
    'Michigan Inflation Expectations': '密歇根通胀预期',
    'New Home Sales': '新屋销售', 'Existing Home Sales': '成屋销售', 'Pending Home Sales m/m': '成屋签约环比',
    'Building Permits': '营建许可', 'Housing Starts': '新屋开工',
    'Durable Goods Orders m/m': '耐用品订单环比', 'Core Durable Goods Orders m/m': '核心耐用品订单环比',
    'Trade Balance': '贸易差额', 'Factory Orders m/m': '工厂订单环比',
    'Empire State Manufacturing Index': '纽约联储制造业指数', 'Philly Fed Manufacturing Index': '费城联储制造业指数',
    'Richmond Manufacturing Index': '里奇蒙德制造业指数', 'Chicago PMI': '芝加哥PMI',
    'Industrial Production m/m': '工业产出环比', 'Capacity Utilization Rate': '产能利用率',
    'Import Prices m/m': '进口价格环比', 'Export Prices m/m': '出口价格环比',
    'Construction Spending m/m': '营建支出环比', 'Business Inventories m/m': '商业库存环比',
    'Wholesale Inventories m/m': '批发库存环比', 'Consumer Credit m/m': '消费信贷',
    'Final Manufacturing PMI': 'Markit制造业PMI终值', 'Final Services PMI': 'Markit服务业PMI终值',
    'Flash Manufacturing PMI': 'Markit制造业PMI初值', 'Flash Services PMI': 'Markit服务业PMI初值',
    'S&P/CS HPI Composite-20 y/y': '20城房价同比', 'Federal Funds Rate': '联邦基金利率',
    'FOMC Statement': 'FOMC声明', 'FOMC Press Conference': 'FOMC记者会',
    'Fed Chair Powell Speaks': '鲍威尔讲话', 'Crude Oil Inventories': 'EIA原油库存',
    'Natural Gas Storage': '天然气库存', 'Revised Nonfarm Productivity q/q': '非农生产力修正值',
    'Revised Unit Labor Costs q/q': '单位劳工成本修正值', 'Challenger Job Cuts y/y': '挑战者裁员同比',
    'Prelim UoM Consumer Sentiment': '密歇根消费者信心初值', 'Prelim UoM Inflation Expectations': '密歇根通胀预期初值',
    'Revised UoM Consumer Sentiment': '密歇根消费者信心终值', 'Revised UoM Inflation Expectations': '密歇根通胀预期终值',
    'FOMC Meeting Minutes': 'FOMC会议纪要', 'Beige Book': '美联储褐皮书',
    'Treasury Refunding Announcement': '财政部再融资公告(QRA)',
    # 中国
    'Chinese Manufacturing PMI': '中国官方制造业PMI', 'Chinese Non-Manufacturing PMI': '中国官方非制造业PMI',
    'Caixin Manufacturing PMI': '财新制造业PMI', 'Caixin Services PMI': '财新服务业PMI',
    'Chinese CPI y/y': '中国CPI同比', 'Chinese PPI y/y': '中国PPI同比',
    'Chinese Trade Balance': '中国贸易差额', 'Chinese GDP y/y': '中国GDP同比',
    'Chinese Industrial Production y/y': '中国工业增加值同比', 'Chinese Retail Sales y/y': '中国社零同比',
    'Chinese Fixed Asset Investment ytd/y': '中国固投累计同比', 'Chinese Unemployment Rate': '中国城镇调查失业率',
    'NBS Press Conference': '统计局发布会',
}
KEEP_IMP = {'High', 'Medium', 'Holiday'}
KEEP_CCY = {'USD', 'CNY'}

# —— 东财日历过滤规则 ——
EM_URL = ('https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_CPH_FECALENDAR'
          '&columns=START_DATE,END_DATE,FE_NAME,FE_TYPE,STD_TYPE_CODE,SPONSOR_NAME,CITY'
          '&sortColumns=START_DATE&sortTypes=1&pageSize=500'
          '&filter=(END_DATE>=%27{from}%27)(START_DATE<%27{to}%27)&source=WEB&client=WEB')
EM_KEEP_COUNTRY = ('中国', '美国', '欧元区', '日本', '英国', '加拿大', '澳大利亚', '德国', '法国', '瑞士', '欧盟')
EM_DROP_KW = [
    '引申需求', '燃料乙醇', '库欣', '精炼油', '车用汽油', '库存量:原油', 'EIA汽油', 'EIA精炼油',
    'DOE', '小麦', '棉花', '玉米', '大豆', '香港', '澳门', '台湾', '四周移动平均',
    '就业人数:政府', '全职', '兼职', '就业人口', '加拿大:15岁', '就业率',
    '平均每周制造业', '制造业平均小时工资', '新增非农私营', '新增就业人数:季调', '非农就业人数:季调',
    '累计同比', 'ISM:PMI:物价', 'ISM:PMI:产出', 'ISM:PMI:自有', 'ISM:PMI:就业',
    'ISM:PMI:供应商', 'ISM:PMI:新订单', '服务业PMI:物价', '服务业PMI:库存',
    '服务业PMI:就业', '服务业PMI:新订单', '服务业PMI:供应商', '出口金额:累计', '进出口金额:累计',
    '出口金额(报告期', '进口总额', 'PPI:全部工业品:累计',
    '库存:贸易矿', '库存:球团', '库存:精粉', '库存:块矿', '库存:电解铝',
    '边际贷款利率', '隔夜存款利率', '再融资利率',
    'PPI:环比:季调', 'PPI:最终需求', '核心PPI:非季调', 'PPI:季调:同比(报告期:2026年09月',
]
EM_KEEP_EVENT_TYPE = ('高峰论坛', '其他会议')  # 大事类(会议); 行业会议/其他 丢弃


def fetch_em(bjt_now):
    """东财财经日历: 未来14天, 返回 [{d,tm,name,kind}]"""
    d_from = bjt_now.strftime('%Y-%m-%d')
    d_to = (bjt_now + datetime.timedelta(days=14)).strftime('%Y-%m-%d')
    url = EM_URL.replace('{from}', d_from).replace('{to}', d_to)
    raw = fetch(url)
    rows = (json.loads(raw.decode('utf-8', 'ignore')).get('result') or {}).get('data') or []
    out = []
    for r in rows:
        name = (r.get('FE_NAME') or '').strip()
        ft = r.get('FE_TYPE')
        if not name:
            continue
        kind = None
        if ft == '经济数据':
            if not name.startswith(EM_KEEP_COUNTRY):
                continue
            if any(kw in name for kw in EM_DROP_KW):
                continue
            kind = 'data'
        elif ft in EM_KEEP_EVENT_TYPE:
            kind = 'event'
        elif ft is None and re.search(r'休市|假期|节\b', name):
            kind = 'holiday'
        if not kind:
            continue
        sd = r.get('START_DATE') or ''
        try:
            dt = datetime.datetime.strptime(sd[:16], '%Y-%m-%d %H:%M')
        except ValueError:
            continue
        # 名字精简: 去"(报告期:...)", 国家前缀后的冗余项保留
        nm = re.sub(r'\(报告期[:：][^)]*\)', '', name).strip()
        out.append({'d': '%d/%d' % (dt.month, dt.day),
                    'tm': '%02d:%02d' % (dt.hour, dt.minute) if dt.hour or dt.minute else '',
                    'name': nm, 'kind': kind})
    # 按日限量: 每日最多10条, 全天项(00:00)排后
    out.sort(key=lambda e: (int(e['d'].split('/')[0]), int(e['d'].split('/')[1]),
                            1 if not e['tm'] else 0, e['tm']))
    per_day = {}
    slim = []
    for e in out:
        n = per_day.get(e['d'], 0)
        if n >= 10:
            continue
        per_day[e['d']] = n + 1
        slim.append(e)
    return slim, len(rows)


def fetch(url):
    # FF有限速(429), 退避重试
    import time
    last = None
    for wait in (0, 20, 50):
        if wait:
            time.sleep(wait)
        try:
            from curl_cffi import requests as creq
            r = creq.Session(impersonate='chrome').get(url, timeout=25)
            if r.status_code == 200:
                return r.content
            last = 'HTTP %s' % r.status_code
        except Exception as e:
            last = str(e)
    import requests
    r = requests.get(url, timeout=25, headers={'User-Agent': 'Mozilla/5.0'})
    if r.status_code == 200:
        return r.content
    raise RuntimeError('FF周历抓取失败: %s / HTTP %s' % (last, r.status_code))


def to_bjt(date_s, time_s):
    # date: MM-DD-YYYY ; time: '9:30am' / '12:30pm' / 'All Day' / 'Tentative' (GMT)
    try:
        dt = datetime.datetime.strptime(date_s, '%m-%d-%Y')
    except ValueError:
        return None, ''
    m = re.match(r'^(\d{1,2}):(\d{2})(am|pm)$', (time_s or '').strip().lower())
    if not m:
        return dt, ''  # 全天/待定
    hh = int(m.group(1)) % 12 + (12 if m.group(3) == 'pm' else 0)
    dt = dt.replace(hour=hh, minute=int(m.group(2))) + datetime.timedelta(hours=8)
    return dt, '%d:%02d' % (dt.hour, dt.minute)


def fetch_ff():
    """FF周历: 本周 USD/CNY 高/中重要性, 带预期值"""
    raw = fetch(URL)
    root = ET.fromstring(raw.decode('windows-1252', 'ignore'))
    events = []
    for ev in root.findall('event'):
        g = lambda t: (ev.findtext(t) or '').strip()
        ccy, imp, title = g('country'), g('impact'), g('title')
        if ccy not in KEEP_CCY or imp not in KEEP_IMP:
            continue
        dt, hm = to_bjt(g('date'), g('time'))
        if dt is None:
            continue
        events.append({
            'd': '%d/%d' % (dt.month, dt.day),          # BJT日期, 如 9/4
            'tm': hm,                                    # BJT时刻, ''=全天/待定
            'ccy': ccy, 'imp': imp,
            'tcn': CN_MAP.get(title, ''), 'ten': title,
            'fc': g('forecast'), 'pv': g('previous'), 'ac': g('actual'),
        })
    events.sort(key=lambda e: (int(e['d'].split('/')[0]), int(e['d'].split('/')[1]),
                               e['tm'] or '99', 0 if e['imp'] == 'High' else 1))
    return events


def main():
    bjt_now = datetime.datetime.now(datetime.UTC).replace(tzinfo=None) + datetime.timedelta(hours=8)
    old = None
    if os.path.exists(OUT):
        try:
            old = json.load(open(OUT, encoding='utf-8'))
        except Exception:
            old = None

    ff_events, em_events, fails = None, None, []
    try:
        ff_events = fetch_ff()
    except Exception as e:
        print('FF_FAIL:', e); fails.append('ff')
    try:
        em_events, em_raw_n = fetch_em(bjt_now)
        print('EM原始%d条 → 过滤后%d条' % (em_raw_n, len(em_events)))
    except Exception as e:
        print('EM_FAIL:', e); fails.append('em')

    if ff_events is None and em_events is None:
        if old:
            old['stale'] = True
            json.dump(old, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False)
            print('双源均失败,保留旧数据', old.get('asof'))
            return
        sys.exit(1)

    # 单源失败用旧文件的对应部分兜底
    if ff_events is None and old:
        ff_events = old.get('events', [])
    if em_events is None and old:
        em_events = old.get('em', [])

    out = {
        'asof': bjt_now.strftime('%Y-%m-%d %H:%M BJT'),
        'src': 'L2·预期值:ForexFactory周历 | 全景:东方财富财经日历(均为公开汇编,底层官方预告)',
        'note': '预期值覆盖本周(FF口径); 全景日历覆盖未来14天(东财口径); 时间均为北京时间',
        'events': ff_events or [],
        'em': em_events or [],
    }
    if fails:
        out['partial'] = fails
    json.dump(out, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False)
    hi = [e for e in out['events'] if e.get('imp') == 'High']
    print('OK FF %d条(High %d) + EM %d条 截至%s' % (len(out['events']), len(hi), len(out['em']), out['asof']))
    for e in hi:
        print(' ', e['d'], e['tm'], e['ccy'], e['tcn'] or e['ten'], '| 预期', e['fc'], '前值', e['pv'], '实际', e['ac'])


if __name__ == '__main__':
    main()
