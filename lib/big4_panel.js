/* ============================================================================
   今日新出数据 · 四大发布面板 v1.0 · big4_panel.js
   覆盖：非农 / CPI / PPI / PCE（仅这四个最重要的发布，每周一随管线自动换新）
   数据：data/release_panels.json（scripts/fetch_release.py · 全部L1官方源）
   功能：
   - 按发布近远排序，近7日内发布标🔥；
   - 彭博式环比贡献堆积图（CPI，近13个月）+ 分项环比贡献表；
   - ⚙️规则解读（GMF框架：定性→贡献拆解→持续性→政策含义→市场反应），数据变→解读自动变。
   用法：renderBig4Panel('newDataBox', '../data/release_panels.json')
   ============================================================================ */
(function () {
'use strict';

function f2(x) { return x == null ? '—' : (+x).toFixed(2); }
function pp(x, d) { return x == null ? '—' : (x > 0 ? '+' : '') + (+x).toFixed(d == null ? 2 : d); }
function esc(s) { return String(s == null ? '' : s); }

/* 估计发布日（BJT规律）：period=YYYY-MM */
function estRelease(block, period) {
  if (!period) return null;
  var y = +period.slice(0, 4), m = +period.slice(5, 7), d;
  if (block === 'nfp') { d = new Date(y, m, 1); while (d.getDay() !== 5) d.setDate(d.getDate() + 1); }        /* 次月首个周五 */
  else if (block === 'cpi') { d = new Date(y, m, 12); }                                                /* 次月10-13取12 */
  else if (block === 'ppi') { d = new Date(y, m, 11); }                                                /* CPI前后一日 */
  else if (block === 'pce_price' || block === 'pce_real') { d = new Date(y, m, 26); } /* 次月末26-31 */
  else return null;
  return d;
}
function freshness(block, period) {
  var d = estRelease(block, period);
  if (!d) return { tag: '', hot: false, rel: null };
  var days = Math.floor((Date.now() - d.getTime()) / 864e5);
  var ds = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  if (days >= -1 && days <= 7) return { tag: '🔥本周新出（' + ds + '发布）', hot: true, rel: d };
  return { tag: '上一期（约' + ds + '发布，待下期更新）', hot: false, rel: d };
}

/* ---------------- 解读引擎（GMF框架·规则化） ---------------- */
/* 定性标签：与预期比（fc来自calendar_consensus注入，可选） */
function verdict(mom, fc, coreMom, coreFc) {
  var beat = fc != null && mom != null && mom > fc + 0.02;
  var coreBeat = coreFc != null && coreMom != null && coreMom > coreFc + 0.02;
  var coreMiss = coreFc != null && coreMom != null && coreMom < coreFc - 0.02;
  if (coreBeat && !beat) return '表鸽里鹰（整体温和、核心超预期）';
  if (!coreBeat && beat) return '表鹰里鸽（整体超预期、核心温和）';
  if (coreBeat && beat) return '全面超预期（鹰）';
  if (coreMiss) return '核心低于预期（鸽）';
  if (fc != null) return '大致符合预期';
  return null;
}

function cpiInterpret(b, cons) {
  var items = (b.items || []).filter(function (x) { return x.mom != null && x.w != null; });
  /* 环比贡献(pp)=权重×环比/100 */
  items.forEach(function (x) { x.mcontrib = +(x.w * x.mom / 100).toFixed(3); });
  var sorted = items.slice().sort(function (a, c) { return c.mcontrib - a.mcontrib; });
  var top = sorted.slice(0, 3), hedges = sorted.slice(-2).filter(function (x) { return x.mcontrib < 0; });
  var fc = cons && cons.cpi_mom, coreFc = cons && cons.core_mom;
  var vd = verdict(b.headline_mom, fc, b.core_mom, coreFc);
  var h = '<ul style="margin:0;padding-left:20px;font-size:12.5px;line-height:1.9;">';
  h += '<li><b>定性</b>：' + esc(b.period) + ' CPI环比 ' + pp(b.headline_mom, 2) + '%' + (fc != null ? '（预期' + pp(fc, 1) + '%）' : '') +
    '，核心环比 ' + pp(b.core_mom, 2) + '%' + (coreFc != null ? '（预期' + pp(coreFc, 1) + '%）' : '') + (vd ? '——<b>' + vd + '</b>。' : '。') + '</li>';
  h += '<li><b>贡献拆解</b>：' + top.map(function (x) {
    var share = b.headline_mom ? Math.round(x.mcontrib / b.headline_mom * 100) : 0;
    return x.name + '（环比' + pp(x.mom, 2) + '%，贡献' + pp(x.mcontrib, 3) + 'pp' + (share > 15 ? '，占整体' + share + '%' : '') + '）';
  }).join('、') + (hedges.length ? '；主要对冲项：' + hedges.map(function (x) { return x.name + '（' + pp(x.mcontrib, 3) + 'pp）'; }).join('、') : '') + '。</li>';
  /* 剔除高波动项的中枢 */
  var calm = items.filter(function (x) { return Math.abs(x.mom) <= 1.5; });
  var calmSum = calm.reduce(function (a, x) { return a + x.mcontrib; }, 0);
  var wild = items.filter(function (x) { return Math.abs(x.mom) > 1.5; }).map(function (x) { return x.name; });
  if (wild.length) h += '<li><b>持续性</b>：剔除高波动项（' + wild.join('、') + '）后，其余分项贡献合计约 ' + pp(calmSum, 2) + 'pp——' +
    (calmSum < (b.headline_mom || 0) - 0.1 ? '环比中枢仍温和，本期超预期部分大概率不可持续（高波动项历史回归快）。' : '中枢与读数接近，黏性真实存在。') + '</li>';
  else h += '<li><b>持续性</b>：本期无极端波动分项，读数成色较高。</li>';
  h += '<li><b>政策含义</b>：' + (b.core_mom != null && b.core_mom >= 0.3 ? '核心环比≥0.3%（年化3.7%+），联储难以转鸽，加息/高利率定价有支撑。' :
    b.core_mom != null && b.core_mom <= 0.15 ? '核心环比≤0.15%，"通胀下行舒适期"叙事延续，为鸽派提供弹药。' :
    '核心环比在0.2%附近，政策含义中性，联储按兵不动概率高。') + '</li>';
  return h + '</ul>';
}
function nfpInterpret(b, cons) {
  var items = (b.items || []).filter(function (x) { return x.name !== '非农总计'; });
  var sorted = items.slice().sort(function (a, c) { return c.chg - a.chg; });
  var top = sorted.slice(0, 3), drag = sorted.slice(-2).filter(function (x) { return x.chg < 0; });
  var hist = (b.history || []).slice(-3).map(function (x) { return x[1]; });
  var avg3 = hist.length ? Math.round(hist.reduce(function (a, x) { return a + x; }, 0) / hist.length) : null;
  var fc = cons && cons.nfp;
  var h = '<ul style="margin:0;padding-left:20px;font-size:12.5px;line-height:1.9;">';
  h += '<li><b>定性</b>：' + esc(b.period) + ' 非农 ' + pp(b.total_chg, 0) + '千人' + (fc != null ? '（预期' + pp(fc, 0) + '千人）' : '') +
    '，近3个月月均 ' + (avg3 == null ? '—' : (avg3 > 0 ? '+' : '') + avg3) + '千人——<b>' +
    (b.total_chg < 0 ? '负值，就业失速确认' : b.total_chg < 80 ? '明显降速' : b.total_chg < 150 ? '温和放缓' : '超预期韧性') + '</b>。</li>';
  h += '<li><b>结构</b>：' + top.map(function (x) { return x.name + '（' + pp(x.chg, 0) + '千）'; }).join('、') + '领涨' +
    (drag.length ? '；拖累项：' + drag.map(function (x) { return x.name + '（' + pp(x.chg, 0) + '千）'; }).join('、') : '') + '。' +
    (function () { var gov = items.filter(function (x) { return x.name === '政府部门'; })[0];
      return gov && b.total_chg && gov.chg / b.total_chg > 0.4 ? '<b>注意：政府贡献占比过高，私人部门成色不足。</b>' : ''; })() + '</li>';
  h += '<li><b>政策含义</b>：' + (b.total_chg < 0 ? '负非农动摇紧缩叙事，降息/停止加息定价升温，美债与金先受益。' :
    b.total_chg > 200 ? '强就业支撑"更高更久"，短端利率承压。' : '不强不弱，政策维持数据依赖。') + '</li>';
  return h + '</ul>';
}
function ppiInterpret(b) {
  var it = b.items || {};
  var h = '<ul style="margin:0;padding-left:20px;font-size:12.5px;line-height:1.9;">';
  h += '<li><b>定性</b>：' + esc(b.period) + ' PPI最终需求环比 ' + pp(it['最终需求'] && it['最终需求'].mom, 2) + '%、同比 ' + pp(it['最终需求'] && it['最终需求'].yoy, 2) +
    '%；核心（除食品能源贸易）环比 ' + pp(it['核心(除食品能源贸易)'] && it['核心(除食品能源贸易)'].mom, 2) + '%。</li>';
  var g = it['最终需求商品'], s = it['最终需求服务'];
  h += '<li><b>结构</b>：商品环比 ' + pp(g && g.mom, 2) + '% / 服务环比 ' + pp(s && s.mom, 2) + '%——' +
    (g && s ? (g.mom > s.mom + 0.2 ? '商品（含能源食品链）是本期主要推力，下游传导待观察。' :
     s.mom > g.mom + 0.2 ? '服务端推力更强，黏性特征更明显。' : '商品与服务均衡。') : '') + '</li>';
  h += '<li><b>政策含义</b>：PPI为CPI上游——' + (it['最终需求'] && it['最终需求'].mom >= 0.4 ? '上游压力明显，下游CPI有传导风险，偏鹰。' :
    it['最终需求'] && it['最终需求'].mom <= 0.1 ? '上游温和，对CPI传导压力有限，偏鸽。' : '中性。') + '</li>';
  return h + '</ul>';
}
function pceInterpret(b) {
  var items = (b.items || []).slice().sort(function (a, c) { return Math.abs(c.pp) - Math.abs(a.pp); });
  var top = items.slice(0, 4);
  var h = '<ul style="margin:0;padding-left:20px;font-size:12.5px;line-height:1.9;">';
  h += '<li><b>定性</b>：' + esc(b.period) + ' PCE价格环比贡献合计 ' + pp(b.total, 2) + 'pp（联储最关注的通胀口径）。</li>';
  h += '<li><b>结构</b>：' + top.map(function (x) { return x.name + '（' + pp(x.pp, 2) + 'pp）'; }).join('、') + '。</li>';
  h += '<li><b>政策含义</b>：' + (b.total != null && b.total >= 0.3 ? 'PCE环比偏热，联储鹰派有依据。' :
    b.total != null && b.total <= 0.15 ? 'PCE温和，支持暂停/转向。' : '中性，配合CPI交叉验证。') + '</li>';
  return h + '</ul>';
}

/* ---------------- 图表与表格 ---------------- */
var COLORS = { '食品': '#5b9bd5', '能源': '#e8734a', '核心商品': '#a06fc0', '核心服务': '#d4a944' };
function cpiHistChart(hostId, hist) {
  var el = document.getElementById(hostId);
  if (!el || !window.echarts || !hist || !hist.groups) return;
  var months = (hist.headline || []).map(function (x) { return x[0]; });
  if (!months.length) return;
  function mapOf(arr) { var m = {}; (arr || []).forEach(function (x) { m[x[0]] = x[1]; }); return m; }
  var hl = mapOf(hist.headline), cr = mapOf(hist.core);
  var series = Object.keys(hist.groups).map(function (g) {
    var mm = mapOf(hist.groups[g].mom);
    return { name: g + ' ' + pp(hist.groups[g].w * (mm[months[months.length - 1]] || 0) / 100, 3), type: 'bar', stack: 'c', barMaxWidth: 26,
      itemStyle: { color: COLORS[g] || '#888' },
      data: months.map(function (mo) { return mm[mo] != null ? +(hist.groups[g].w * mm[mo] / 100).toFixed(3) : null; }) };
  });
  series.push({ name: '所有项目', type: 'line', symbol: 'none', lineStyle: { color: '#e8ecf4', width: 2 },
    data: months.map(function (mo) { return hl[mo] != null ? hl[mo] : null; }) });
  series.push({ name: '核心CPI', type: 'line', symbol: 'none', lineStyle: { color: '#4fc3f7', width: 1.5, type: 'dashed' },
    data: months.map(function (mo) { return cr[mo] != null ? cr[mo] : null; }) });
  var ch = echarts.init(el);
  ch.setOption({
    backgroundColor: 'transparent', animation: false,
    legend: { textStyle: { color: '#8a94a6', fontSize: 10 }, top: 0, itemWidth: 12, itemHeight: 8 },
    grid: { left: 40, right: 10, top: 34, bottom: 40 },
    tooltip: { trigger: 'axis', backgroundColor: '#1c2333', borderColor: '#262d3d', textStyle: { color: '#d7dde8', fontSize: 11 } },
    xAxis: { type: 'category', data: months, axisLabel: { color: '#8a94a6', fontSize: 10 }, axisLine: { lineStyle: { color: '#333' } } },
    yAxis: { type: 'value', name: '环比贡献(pp)', nameTextStyle: { color: '#8a94a6', fontSize: 10 },
      axisLabel: { color: '#8a94a6', fontSize: 10 }, splitLine: { lineStyle: { color: '#222a3a' } } },
    series: series
  }, true);
  window.addEventListener('resize', function () { ch.resize(); });
}
function contribTable(items) {
  var rows = (items || []).filter(function (x) { return x.mom != null && x.w != null; }).map(function (x) {
    return { name: x.name, mom: x.mom, yoy: x.yoy, w: x.w, mc: +(x.w * x.mom / 100).toFixed(3) };
  }).sort(function (a, b) { return b.mc - a.mc; });
  var mx = Math.max.apply(null, rows.map(function (r) { return Math.abs(r.mc); }).concat([0.3]));
  var h = '<table style="font-size:12px;"><tr><th style="text-align:left">分项</th><th>权重</th><th>环比</th><th>同比</th><th style="width:34%">环比贡献(pp)</th><th>pp</th></tr>';
  rows.forEach(function (r) {
    var wpc = Math.min(Math.abs(r.mc) / mx * 50, 50);
    var pos = r.mc >= 0 ? 'left:50%;width:' + wpc + '%;background:#c05a5a' : 'right:50%;width:' + wpc + '%;background:#4f9d6b';
    h += '<tr><td style="text-align:left">' + r.name + '</td><td>' + f2(r.w) + '%</td><td>' + pp(r.mom, 2) + '%</td><td>' + pp(r.yoy, 2) + '%</td>' +
      '<td><div style="position:relative;height:12px;background:#141a26;border-radius:2px;"><div style="position:absolute;left:50%;top:0;bottom:0;width:1px;background:#3b4762;"></div><div style="position:absolute;top:1px;bottom:1px;border-radius:2px;' + pos + ';"></div></div></td>' +
      '<td><b style="color:' + (r.mc >= 0 ? '#e8734a' : '#4f9d6b') + '">' + pp(r.mc, 3) + '</b></td></tr>';
  });
  return h + '</table>';
}
function nfpBar(items) {
  var rows = (items || []).filter(function (x) { return x.name !== '非农总计'; }).sort(function (a, b) { return b.chg - a.chg; });
  var mx = Math.max.apply(null, rows.map(function (r) { return Math.abs(r.chg); }).concat([50]));
  var h = '<table style="font-size:12px;"><tr><th style="text-align:left">行业</th><th style="width:44%">当月变动(千人)</th><th>变动</th></tr>';
  rows.forEach(function (r) {
    var wpc = Math.min(Math.abs(r.chg) / mx * 50, 50);
    var pos = r.chg >= 0 ? 'left:50%;width:' + wpc + '%;background:#c05a5a' : 'right:50%;width:' + wpc + '%;background:#4f9d6b';
    h += '<tr><td style="text-align:left">' + r.name + '</td>' +
      '<td><div style="position:relative;height:12px;background:#141a26;border-radius:2px;"><div style="position:absolute;left:50%;top:0;bottom:0;width:1px;background:#3b4762;"></div><div style="position:absolute;top:1px;bottom:1px;border-radius:2px;' + pos + ';"></div></div></td>' +
      '<td><b>' + pp(r.chg, 1) + '</b></td></tr>';
  });
  return h + '</table>';
}

/* ---------------- 卡片 ---------------- */
function card(title, period, fr, chips, chartHtml, tableHtml, interpretHtml, srcNote) {
  var h = '<div class="card" style="margin-bottom:14px;' + (fr.hot ? 'border-color:var(--gold);' : 'opacity:.92;') + '">';
  h += '<p style="font-size:13.5px;margin:0 0 4px;"><b style="color:var(--gold)">' + title + '</b>' +
    '<span style="font-size:12px;color:var(--txt);margin-left:8px;">数据期 ' + esc(period) + '</span>' +
    '<span style="float:right;font-size:11px;' + (fr.hot ? 'color:#e8c34a;font-weight:700;' : 'color:var(--dim);') + '">' + fr.tag + '</span></p>';
  if (chips) h += '<p style="margin:0 0 8px;">' + chips + '</p>';
  if (chartHtml) h += chartHtml;
  if (tableHtml) h += '<details style="margin-top:6px"><summary style="cursor:pointer;color:#5b9bd5;font-size:12px">分项贡献明细（点击展开）</summary>' + tableHtml + '</details>';
  if (interpretHtml) h += '<div style="margin-top:8px;border-top:1px dashed #2a3346;padding-top:8px;"><p style="font-size:12px;margin:0 0 4px;color:var(--dim);"><b style="color:var(--gold)">⚙️规则解读</b>（GMF框架：定性→拆解→持续性→政策含义，数据变→解读自动变）</p>' + interpretHtml + '</div>';
  h += '<p style="font-size:10.5px;color:var(--dim);margin:8px 0 0;">' + esc(srcNote || '') + '</p></div>';
  return h;
}
function chip(label, val) {
  return '<span style="display:inline-block;background:#232c3f;border:1px solid #35405a;border-radius:4px;padding:3px 9px;font-size:12px;margin:0 6px 6px 0;">' + label + ' <b style="color:#d4a944">' + val + '</b></span>';
}

/* 从 calendar_consensus.json 抽预期值（可选，失败静默） */
function loadConsensus() {
  return fetch('../data/calendar_consensus.json?v=' + Date.now()).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
    var out = {};
    if (!d) return out;
    (d.events || []).forEach(function (e) {
      var n = e.tcn || e.ten || '', fc = parseFloat(String(e.fc || '').replace('%', ''));
      if (isNaN(fc)) return;
      if (/^CPI环比/.test(n)) out.cpi_mom = fc;
      if (/^核心CPI环比/.test(n)) out.core_mom = fc;
      if (/非农/.test(n) && /变动|就业/.test(n)) out.nfp = fc;
    });
    return out;
  }).catch(function () { return {}; });
}

function draw(P, cons) {
  var B = P.blocks || {}, cards = [];
  var order = [];
  ['cpi', 'nfp', 'ppi', 'pce_price'].forEach(function (k) {
    var b = B[k];
    if (!b || b.empty) return;
    var fr = freshness(k === 'pce_price' ? 'pce_price' : k, b.period);
    order.push({ k: k, b: b, fr: fr });
  });
  order.sort(function (a, c) { return (c.fr.rel ? c.fr.rel.getTime() : 0) - (a.fr.rel ? a.fr.rel.getTime() : 0); });
  order.forEach(function (o) {
    if (o.k === 'cpi') {
      var chartId = 'b4CpiHist';
      cards.push(card('CPI · 消费者价格', o.b.period, o.fr,
        chip('整体环比', pp(o.b.headline_mom, 2) + '%') + chip('整体同比', pp(o.b.headline_yoy, 2) + '%') +
        chip('核心环比', pp(o.b.core_mom, 2) + '%') + chip('核心同比', pp(o.b.core_yoy, 2) + '%'),
        '<div id="' + chartId + '" style="width:100%;height:280px;margin:4px 0;"></div>' +
        '<p style="font-size:10.5px;color:var(--dim);margin:0;">近13个月环比贡献堆积（pp）· 白线=所有项目环比 · 蓝虚线=核心环比 · 口径同彭博贡献分解</p>',
        contribTable(o.b.items), cpiInterpret(o.b, cons), o.b.src + ' · ' + (o.b.weights_src || '')));
      setTimeout(function () { cpiHistChart(chartId, (P.blocks || {}).cpi_hist); }, 60);
    } else if (o.k === 'nfp') {
      cards.push(card('非农就业', o.b.period, o.fr,
        chip('总变动', pp(o.b.total_chg, 0) + '千人'),
        null, nfpBar(o.b.items), nfpInterpret(o.b, cons), o.b.src));
    } else if (o.k === 'ppi') {
      var it = o.b.items || {};
      cards.push(card('PPI · 生产者价格（最终需求）', o.b.period, o.fr,
        chip('环比', pp(it['最终需求'] && it['最终需求'].mom, 2) + '%') + chip('同比', pp(it['最终需求'] && it['最终需求'].yoy, 2) + '%') +
        chip('核心环比', pp(it['核心(除食品能源贸易)'] && it['核心(除食品能源贸易)'].mom, 2) + '%') +
        chip('商品/服务环比', pp(it['最终需求商品'] && it['最终需求商品'].mom, 2) + '% / ' + pp(it['最终需求服务'] && it['最终需求服务'].mom, 2) + '%'),
        null, null, ppiInterpret(o.b), o.b.src + ' · PPI不公布权重，贡献拆分以定性呈现'));
    } else if (o.k === 'pce_price') {
      cards.push(card('PCE价格 · 联储首选通胀口径', o.b.period, o.fr,
        chip('环比贡献合计', pp(o.b.total, 2) + 'pp'),
        null, contribPceTable(o.b.items), pceInterpret(o.b), o.b.src));
    }
  });
  var head = '<p style="font-size:11.5px;color:var(--dim);margin:0 0 10px;line-height:1.7;">只保留四大重要发布：<b>非农 / CPI / PPI / PCE</b>，按发布近远排序，🔥=近7日内发布；其余小数据看「政策与地缘」页宏观日历。数据更新：' + esc(P.updated || '—') + ' · 全部L1官方源（BLS/BEA），官网发布后管线自动跟新。</p>';
  return head + (cards.join('') || '<div class="card"><p style="color:var(--dim);font-size:13px;margin:0;">四大发布面板数据读取中或暂缺。</p></div>');
}
function contribPceTable(items) {
  var rows = (items || []).slice().sort(function (a, b) { return Math.abs(b.pp) - Math.abs(a.pp); });
  var mx = Math.max.apply(null, rows.map(function (r) { return Math.abs(r.pp); }).concat([0.3]));
  var h = '<table style="font-size:12px;"><tr><th style="text-align:left">分项</th><th style="width:44%">环比贡献(pp)</th><th>pp</th></tr>';
  rows.forEach(function (r) {
    var wpc = Math.min(Math.abs(r.pp) / mx * 50, 50);
    var pos = r.pp >= 0 ? 'left:50%;width:' + wpc + '%;background:#c05a5a' : 'right:50%;width:' + wpc + '%;background:#4f9d6b';
    h += '<tr><td style="text-align:left">' + r.name + '</td>' +
      '<td><div style="position:relative;height:12px;background:#141a26;border-radius:2px;"><div style="position:absolute;left:50%;top:0;bottom:0;width:1px;background:#3b4762;"></div><div style="position:absolute;top:1px;bottom:1px;border-radius:2px;' + pos + ';"></div></div></td>' +
      '<td><b>' + pp(r.pp, 2) + '</b></td></tr>';
  });
  return h + '</table>';
}

window.renderBig4Panel = function (hostId, src) {
  var host = document.getElementById(hostId);
  if (!host) return;
  host.innerHTML = '<p style="font-size:12px;color:var(--dim);">读取四大发布数据…</p>';
  Promise.all([
    fetch(src + (src.indexOf('?') > 0 ? '&' : '?') + 'v=' + Date.now()).then(function (r) { return r.json(); }),
    loadConsensus()
  ]).then(function (rs) {
    host.innerHTML = draw(rs[0], rs[1] || {});
  }).catch(function (e) {
    host.innerHTML = '<div class="card"><p style="color:var(--dim);font-size:13px;margin:0;">四大发布数据加载失败（' + e + '），点顶部「一键更新」重试。</p></div>';
  });
};
})();
