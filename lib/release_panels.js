/* 数据发布·分项贡献面板 — 非农/CPI/零售/PCE/GDP/FedWatch
   数据: data/release_panels.json (scripts/fetch_release.py 管线产出; 零售分项=普查局口径经L2媒体转引)
   用法: renderReleasePanels('rp-host', '../data/release_panels.json') */
(function () {
  var CSS = `
  .rlp{font:inherit;color:#d7dde8}
  .rlp .rp-refresh{float:right;background:#2a3346;border:1px solid #3b4762;color:#d4a944;border-radius:5px;padding:5px 14px;cursor:pointer;font-size:12px}
  .rlp .rp-refresh:hover{background:#33405a}
  .rlp .rp-meta{font-size:11px;color:#8a94a6;margin:2px 0 14px}
  .rlp .rp-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  @media(max-width:1100px){.rlp .rp-grid{grid-template-columns:1fr}}
  .rlp .rp-card{background:#1a2130;border:1px solid #2a3346;border-radius:6px;padding:12px 14px}
  .rlp .rp-card.full{grid-column:1/-1}
  .rlp .rp-t{font-size:14px;font-weight:600;color:#e8ecf3;margin-bottom:2px}
  .rlp .rp-t .per{color:#d4a944;font-size:12px;margin-left:8px}
  .rlp .rp-src{font-size:10px;color:#7c8698;margin-bottom:8px}
  .rlp .rp-chips{margin:4px 0 10px}
  .rlp .chip{display:inline-block;background:#232c3f;border:1px solid #35405a;border-radius:4px;padding:3px 9px;font-size:12px;margin:0 6px 6px 0}
  .rlp .chip b{color:#d4a944;font-weight:600}
  .rlp table{width:100%;border-collapse:collapse;font-size:12px}
  .rlp td,.rlp th{padding:3px 6px;text-align:right;white-space:nowrap}
  .rlp td:first-child,.rlp th:first-child{text-align:left}
  .rlp th{color:#8a94a6;font-weight:400;border-bottom:1px solid #2a3346;font-size:11px}
  .rlp .bar-row{display:flex;align-items:center;height:18px}
  .rlp .bar-wrap{position:relative;flex:1;height:12px;background:#141a26;border-radius:2px}
  .rlp .bar-mid{position:absolute;left:50%;top:0;bottom:0;width:1px;background:#3b4762}
  .rlp .bar{position:absolute;top:1px;bottom:1px;border-radius:2px}
  .rlp .pos{background:#c05a5a}.rlp .neg{background:#4f9d6b}
  .rlp .posG{background:#d4a944}.rlp .negG{background:#5a7fb8}
  .rlp .fw-m{margin-bottom:10px}
  .rlp .fw-h{display:flex;justify-content:space-between;font-size:12px;color:#aeb7c6;margin-bottom:3px}
  .rlp .fw-seg{display:flex;height:16px;border-radius:3px;overflow:hidden;background:#141a26}
  .rlp .fw-seg div{height:100%;border-right:1px solid #10151f}
  .rlp .fw-lab{font-size:10px;color:#7c8698;display:flex;justify-content:space-between;margin-top:2px}
  .rlp .stale{color:#8a94a6;font-size:12px;padding:10px 0}
  .rlp .mini{display:flex;align-items:flex-end;gap:2px;height:34px;margin-top:6px}
  .rlp .mini i{flex:1;background:#3d6ea8;min-height:1px;border-radius:1px 1px 0 0}
  .rlp .mini i.ng{background:#4f9d6b}
  `;
  function el(h) { var d = document.createElement('div'); d.innerHTML = h; return d.firstElementChild; }
  function fmt(v, suf, dec) { if (v === null || v === undefined || isNaN(v)) return '—'; return (+v).toFixed(dec === undefined ? 1 : dec) + (suf || ''); }
  function barTable(rows, valKey, maxAbs, unit, gold) {
    // rows: [{name, val, extra...}] 发散条形表
    var h = '<table>';
    rows.forEach(function (r) {
      if (r[valKey] === null || r[valKey] === undefined) return;
      var v = r[valKey], w = Math.min(Math.abs(v) / maxAbs * 50, 50);
      var cls = v >= 0 ? (gold ? 'posG' : 'pos') : (gold ? 'negG' : 'neg');
      var pos = v >= 0 ? 'left:50%;width:' + w + '%' : 'right:50%;width:' + w + '%';
      h += '<tr><td' + (r.dim ? ' style="color:#8a94a6"' : '') + '>' + r.name + '</td>' +
        '<td style="width:34%">' + (r.pre || '') + '</td>' +
        '<td style="width:38%"><div class="bar-row"><div class="bar-wrap"><div class="bar-mid"></div><div class="bar ' + cls + '" style="' + pos + '"></div></div></div></td>' +
        '<td style="width:12%">' + fmt(v, unit) + '</td></tr>';
    });
    return h + '</table>';
  }
  function srcLine(b, extra) {
    return '<div class="rp-src">' + (b.src || '') + (b.weights_src ? ' · 权重: ' + b.weights_src : '') +
      (b.gap_note ? ' · ⚠' + b.gap_note : '') + ' · 下次发布: ' + (b.next || '—') + (extra || '') + '</div>';
  }

  function renderFed(b) {
    if (b.empty) return '<div class="rp-card"><div class="rp-t">FedWatch 利率概率</div><div class="stale">⚪ 待首次抓取——CME结算价端点仅工作日可得,管线下个交易日自动补齐(' + (b.note || '') + ')</div></div>';
    var h = '<div class="rp-card"><div class="rp-t">FedWatch 利率概率<span class="per">ZQ结算 ' + b.settle_date + '</span></div>';
    h += srcLine(b, '');
    h += '<div class="rp-chips"><span class="chip">EFFR <b>' + fmt(b.effr, '%', 2) + '</b></span>' +
      '<span class="chip">当前目标区间 <b>' + b.target + '%</b></span>' +
      '<span class="chip" style="color:#8a94a6">' + (b.cal_src || '') + '</span></div>';
    (b.meetings || []).slice(0, 6).forEach(function (m) {
      h += '<div class="fw-m"><div class="fw-h"><span>FOMC ' + m.date + '</span><span>隐含会后 ' + fmt(m.post, '%', 2) + '</span></div><div class="fw-seg">';
      var colors = ['#4f9d6b', '#d4a944', '#c05a5a', '#8a6db8'];
      m.probs.forEach(function (p, i) { h += '<div style="width:' + p.pct + '%;background:' + colors[i % 4] + '"></div>'; });
      h += '</div><div class="fw-lab">';
      m.probs.forEach(function (p) { h += '<span>' + fmt(p.rate, '%', 2) + ' · ' + fmt(p.pct, '%', 1) + '</span>'; });
      h += '</div></div>';
    });
    return h + '<div class="rp-src" style="margin-top:6px">行=会议,色块=各目标利率概率(降=绿/持平=金/加=红);与官网QuikStrike数值或差数点,方向一致</div></div>';
  }
  function renderNfp(b) {
    if (!b || b.empty || !b.items) return '';
    window.__rpNfp = b;
    var mx = Math.max.apply(null, b.items.map(function (x) { return Math.abs(x.chg); }).concat([50]));
    var rows = b.items.map(function (x) { return { name: x.name, chg: x.chg, dim: x.name[0] === '·' }; });
    var h = '<div class="rp-card"><div class="rp-t">非农就业分项 · 行业贡献<span class="per">' + b.period + '</span></div>' + srcLine(b);
    h += '<div class="rp-chips"><span class="chip">总变动 <b>' + fmt(b.total_chg, '千人', 0) + '</b></span></div>';
    h += '<div id="rpNfpBar" style="width:100%;height:300px;margin:6px 0 2px;"></div>';
    h += '<details class="rp-det" style="margin-top:4px"><summary style="cursor:pointer;color:var(--blue,#5b9bd5);font-size:12px">分项明细表（点击展开）</summary>' + barTable(rows, 'chg', mx, '', false).replace(/<td style="width:12%">([\s\S]*?)<\/td>/g, function (m, g) { return '<td style="width:12%">' + g.trim() + '</td>'; }) + '</details>';
    h += '<div class="rp-src" style="margin:8px 0 2px">近14个月总变动(千人)</div><div class="mini">';
    var mh = Math.max.apply(null, b.history.map(function (x) { return Math.abs(x[1]); }).concat([1]));
    b.history.forEach(function (x) { h += '<i class="' + (x[1] < 0 ? 'ng' : '') + '" style="height:' + Math.max(Math.abs(x[1]) / mh * 100, 3) + '%" title="' + x[0] + ' ' + x[1] + '"></i>'; });
    return h + '</div><div class="rp-src" style="margin-top:4px">行业当月变动(千人) · 红=增员 绿=减员 · ⚙️按行业就业变动直接加总,合计或与非农总数小幅不符(含未列示行业/舍入)</div></div>';
  }
  function drawNfpBar() {
    var el = document.getElementById('rpNfpBar');
    var b = window.__rpNfp;
    if (!el || !b || !b.items || !window.echarts) return;
    var items = b.items.filter(function (x) { return x.name[0] !== '·'; }).slice().sort(function (a, c) { return c.chg - a.chg; });
    var ch = echarts.init(el);
    window.__rpNfpChart = ch;
    ch.setOption({
      backgroundColor: 'transparent', animation: false,
      grid: { left: 44, right: 12, top: 22, bottom: 64 },
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' }, backgroundColor: '#1c2333', borderColor: '#262d3d',
        textStyle: { color: '#d7dde8', fontSize: 11 },
        formatter: function (ps) {
          var it = items[ps[0].dataIndex];
          return '<b>' + it.name + '</b><br>当月变动 <b style="color:#d4a944">' + (it.chg >= 0 ? '+' : '') + it.chg + ' 千人</b>' + (it.level ? '<br>行业就业规模 ' + Number(it.level).toFixed(1) + ' 百万人' : '');
        }
      },
      xAxis: {
        type: 'category', data: items.map(function (x) { return x.name; }),
        axisLabel: { color: '#8a94a6', fontSize: 10, interval: 0, rotate: 38 }, axisLine: { lineStyle: { color: '#333' } }
      },
      yAxis: {
        type: 'value', name: '变动(千人)', nameTextStyle: { color: '#8a94a6', fontSize: 10 },
        axisLabel: { color: '#8a94a6', fontSize: 10 }, splitLine: { lineStyle: { color: '#222a3a' } }
      },
      series: [{
        type: 'bar', barMaxWidth: 26,
        data: items.map(function (x) {
          return { value: x.chg, itemStyle: { color: x.chg >= 0 ? '#e5534b' : '#4caf7d', borderRadius: x.chg >= 0 ? [3, 3, 0, 0] : [0, 0, 3, 3] } };
        }),
        label: { show: true, position: 'top', fontSize: 9, color: '#aeb8c8', formatter: function (p) { return (p.value >= 0 ? '+' : '') + p.value; } },
        markLine: { symbol: 'none', label: { show: false }, lineStyle: { color: '#3b4762' }, data: [{ yAxis: 0 }] }
      }]
    }, true);
  }
  function renderRetail(b) {
    if (!b || b.empty || !b.items) return '';
    window.__rpRetail = b;
    var rows = b.items.map(function (x) {
      return { name: x.name, mom: x.mom === 'gap' ? null : x.mom, pre: x.yoy !== undefined && x.yoy !== null ? '同比' + fmt(x.yoy, '%', 1) : '', dim: x.mom === 'gap' };
    });
    var vals = b.items.filter(function (x) { return x.mom !== 'gap' && x.mom !== null && x.mom !== undefined; }).map(function (x) { return Math.abs(x.mom); });
    var mx = Math.max.apply(null, vals.concat([1]));
    var h = '<div class="rp-card"><div class="rp-t">零售销售分项 · 环比<span class="per">' + b.period + '</span></div>' + srcLine(b);
    h += '<div class="rp-chips"><span class="chip">整体 环比<b>' + fmt(b.headline_mom, '%', 1) + '</b> 同比<b>' + fmt(b.headline_yoy, '%', 1) + '</b></span>' +
      (b.core_mom !== undefined ? '<span class="chip">核心(剔汽车) 环比<b>' + fmt(b.core_mom, '%', 1) + '</b></span>' : '') +
      (b.control_mom !== undefined ? '<span class="chip">控制组 环比<b>' + fmt(b.control_mom, '%', 1) + '</b></span>' : '') +
      (b.total_usd_bln ? '<span class="chip">总额 <b>' + b.total_usd_bln + '十亿美元</b></span>' : '') + '</div>';
    h += '<div id="rpRetailBar" style="width:100%;height:300px;margin:6px 0 2px;"></div>';
    h += '<details class="rp-det" style="margin-top:4px"><summary style="cursor:pointer;color:var(--blue,#5b9bd5);font-size:12px">分项明细表（点击展开）</summary>' + barTable(rows, 'mom', mx, '%', false) + '</details>';
    return h + '<div class="rp-src" style="margin-top:4px">红=环比正贡献 绿=负贡献 · 灰=当月值暂缺(待普查局修订/终端补数)</div></div>';
  }
  function drawRetailBar() {
    var el = document.getElementById('rpRetailBar');
    var b = window.__rpRetail;
    if (!el || !b || !b.items || !window.echarts) return;
    var items = b.items.filter(function (x) { return x.mom !== 'gap' && x.mom !== null && x.mom !== undefined; }).slice().sort(function (a, c) { return c.mom - a.mom; });
    var ch = echarts.init(el);
    window.__rpRetailChart = ch;
    ch.setOption({
      backgroundColor: 'transparent', animation: false,
      grid: { left: 44, right: 12, top: 22, bottom: 64 },
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' }, backgroundColor: '#1c2333', borderColor: '#262d3d',
        textStyle: { color: '#d7dde8', fontSize: 11 },
        formatter: function (ps) {
          var it = items[ps[0].dataIndex];
          return '<b>' + it.name + '</b><br>环比 <b style="color:#d4a944">' + (it.mom >= 0 ? '+' : '') + it.mom + '%</b>' + (it.yoy !== undefined && it.yoy !== null ? '<br>同比 ' + (it.yoy >= 0 ? '+' : '') + it.yoy + '%' : '');
        }
      },
      xAxis: {
        type: 'category', data: items.map(function (x) { return x.name; }),
        axisLabel: { color: '#8a94a6', fontSize: 10, interval: 0, rotate: 38 }, axisLine: { lineStyle: { color: '#333' } }
      },
      yAxis: {
        type: 'value', name: '环比(%)', nameTextStyle: { color: '#8a94a6', fontSize: 10 },
        axisLabel: { color: '#8a94a6', fontSize: 10 }, splitLine: { lineStyle: { color: '#222a3a' } }
      },
      series: [{
        type: 'bar', barMaxWidth: 26,
        data: items.map(function (x) {
          return { value: x.mom, itemStyle: { color: x.mom >= 0 ? '#e5534b' : '#4caf7d', borderRadius: x.mom >= 0 ? [3, 3, 0, 0] : [0, 0, 3, 3] } };
        }),
        label: { show: true, position: 'top', fontSize: 9, color: '#aeb8c8', formatter: function (p) { return (p.value >= 0 ? '+' : '') + Number(p.value).toFixed(1); } },
        markLine: { symbol: 'none', label: { show: false }, lineStyle: { color: '#3b4762' }, data: [{ yAxis: 0 }] }
      }]
    }, true);
  }
  function renderCpi(b) {
    if (!b || b.empty || !b.items) return '';
    window.__rpCpi = b;
    var rows = b.items.map(function (x) {
      return { name: x.name, contrib: x.contrib, pre: '权重' + fmt(x.w, '%', 1) + ' · 环比' + fmt(x.mom, '%', 1) + (x.mom_gap ? '*' : '') + ' · 同比' + fmt(x.yoy, '%', 1) };
    });
    var mx = Math.max.apply(null, b.items.map(function (x) { return Math.abs(x.contrib || 0); }).concat([0.5]));
    var h = '<div class="rp-card"><div class="rp-t">CPI分项 · 同比贡献分布<span class="per">' + b.period + '</span></div>' + srcLine(b);
    h += '<div class="rp-chips"><span class="chip">整体 环比<b>' + fmt(b.headline_mom, '%', 1) + '</b> 同比<b>' + fmt(b.headline_yoy, '%', 1) + '</b></span>' +
      '<span class="chip">核心 环比<b>' + fmt(b.core_mom, '%', 1) + '</b> 同比<b>' + fmt(b.core_yoy, '%', 1) + '</b></span></div>';
    h += '<div id="rpCpiBar" style="width:100%;height:300px;margin:6px 0 2px;"></div>';
    h += '<details class="rp-det" style="margin-top:4px"><summary style="cursor:pointer;color:var(--blue,#5b9bd5);font-size:12px">分项明细表（点击展开）</summary>' + barTable(rows, 'contrib', mx, '', true) + '</details>';
    return h + '<div class="rp-src" style="margin-top:4px">同比贡献(pp)≈权重×分项同比/100 · *=停摆缺月为跨期环比 · 红=推升通胀 绿=拖累</div></div>';
  }
  function drawCpiBar() {
    var el = document.getElementById('rpCpiBar');
    var b = window.__rpCpi;
    if (!el || !b || !b.items || !window.echarts) return;
    var items = b.items.slice().sort(function (a, c) { return (c.contrib || 0) - (a.contrib || 0); });
    var ch = echarts.init(el);
    window.__rpCpiChart = ch;
    ch.setOption({
      backgroundColor: 'transparent', animation: false,
      grid: { left: 44, right: 12, top: 22, bottom: 64 },
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' }, backgroundColor: '#1c2333', borderColor: '#262d3d',
        textStyle: { color: '#d7dde8', fontSize: 11 },
        formatter: function (ps) {
          var it = items[ps[0].dataIndex];
          return '<b>' + it.name + '</b><br>同比贡献 <b style="color:#d4a944">' + (it.contrib >= 0 ? '+' : '') + Number(it.contrib).toFixed(3) + 'pp</b>' +
            '<br>权重 ' + it.w + '% · 环比 ' + (it.mom >= 0 ? '+' : '') + it.mom + '%' + (it.mom_gap ? '*' : '') + ' · 同比 ' + (it.yoy >= 0 ? '+' : '') + it.yoy + '%';
        }
      },
      xAxis: {
        type: 'category', data: items.map(function (x) { return x.name; }),
        axisLabel: { color: '#8a94a6', fontSize: 10, interval: 0, rotate: 38 }, axisLine: { lineStyle: { color: '#333' } }
      },
      yAxis: {
        type: 'value', name: '贡献(pp)', nameTextStyle: { color: '#8a94a6', fontSize: 10 },
        axisLabel: { color: '#8a94a6', fontSize: 10 }, splitLine: { lineStyle: { color: '#222a3a' } }
      },
      series: [{
        type: 'bar', barMaxWidth: 26,
        data: items.map(function (x) {
          return { value: x.contrib, itemStyle: { color: x.contrib >= 0 ? '#e5534b' : '#4caf7d', borderRadius: x.contrib >= 0 ? [3, 3, 0, 0] : [0, 0, 3, 3] } };
        }),
        label: { show: true, position: 'top', fontSize: 9, color: '#aeb8c8', formatter: function (p) { return (p.value >= 0 ? '+' : '') + Number(p.value).toFixed(2); } },
        markLine: { symbol: 'none', label: { show: false }, lineStyle: { color: '#3b4762' }, data: [{ yAxis: 0 }] }
      }]
    }, true);
  }
  function renderBea(key, title, dec) {
    var b = P.blocks[key]; if (!b || b.empty || !b.items) return '';
    var rows = b.items.map(function (x) { return { name: x.name, pp: x.pp, dim: x.name[0] === '·' }; });
    var mx = Math.max.apply(null, b.items.map(function (x) { return Math.abs(x.pp); }).concat([0.5]));
    var h = '<div class="rp-card"><div class="rp-t">' + title + '<span class="per">' + b.period + '</span></div>' + srcLine(b);
    h += '<div class="rp-chips"><span class="chip">总计 <b>' + fmt(b.total, key === 'gdp' ? '%' : 'pp', 1) + '</b></span></div>';
    h += barTable(rows, 'pp', mx, '', key !== 'gdp');
    return h + '</div>';
  }

  var P = null;
  function draw(host) {
    var B = P.blocks || {};
    var h = '<div style="overflow:hidden"><button class="rp-refresh" id="rp-re">⟳ 一键刷新</button>' +
      '<div class="rp-meta">数据更新: ' + (P.updated || '—') + ' · ' + (P.src_note || '') + '<br>一键刷新=重新读取管线最新快照; 官网发布日20:30(冬令21:30)北京时间后管线自动跟新, 急用可在对话喊我即时跑一遍</div></div>';
    h += '<div class="rp-grid">';
    h += renderFed(B.fedwatch || { empty: true });
    h += renderNfp(B.nfp || {});
    h += renderCpi(B.cpi || {});
    h += renderRetail(B.retail || {});
    h += renderBea('pce_price', 'PCE价格分项 · 环比贡献', 2);
    h += renderBea('pce_real', '实际PCE分项 · 环比贡献', 2);
    h += renderBea('gdp', 'GDP分项 · 环比折年率贡献', 1);
    h += '</div>';
    host.innerHTML = h;
    host.querySelector('#rp-re').onclick = function () { load(host, true); };
    drawCpiBar(); drawNfpBar(); drawRetailBar();
    window.addEventListener('resize', function () {
      if (window.__rpCpiChart) window.__rpCpiChart.resize();
      if (window.__rpNfpChart) window.__rpNfpChart.resize();
      if (window.__rpRetailChart) window.__rpRetailChart.resize();
    });
  }
  function load(host, bust) {
    host.innerHTML = '<div class="rp-meta">读取面板数据…</div>';
    var url = host.dataset.src + (bust ? (host.dataset.src.indexOf('?') > 0 ? '&' : '?') + 't=' + Date.now() : '');
    fetch(url).then(function (r) { return r.json(); }).then(function (j) { P = j; draw(host); })
      .catch(function (e) { host.innerHTML = '<div class="rp-meta">面板数据读取失败: ' + e + '</div>'; });
  }
  window.renderReleasePanels = function (hostId, src) {
    var host = document.getElementById(hostId);
    if (!host) return;
    host.classList.add('rlp');
    host.dataset.src = src;
    if (!document.getElementById('rlp-css')) {
      var st = document.createElement('style'); st.id = 'rlp-css'; st.textContent = CSS;
      document.head.appendChild(st);
    }
    load(host, false);
  };
})();
