/* ============================================================================
   鲜活面板加载器 v1.0 · fresh_panels.js
   作用：日报/周报共用的「政策与地缘」三卡（FedWatch / TACO / 美伊局势）与
        「数据预测」面板，全部直读【有管线维护】的 JSON：
          fedwatch.json（fedwatch.yml 工作日每2小时）
          trump_zone.json（daily_data.yml 每日2次）
          polymarket.json（同上）· geopolitics.json（Kimi维护）
          calendar_consensus.json（daily_data.yml 每日2次）
        不再读 live_snapshot.js（手工快照，9/2冻结，仅作历史兜底）。
   机制：在 renderLive（快照兜底渲染）之后异步覆盖对应盒子，
        并设置 __fwFresh/__tacoFresh/__iranFresh 标记防止快照回盖。
   ============================================================================ */
(function () {
'use strict';
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
function getJSON(url) {
  return fetch(url + (url.indexOf('?') >= 0 ? '&' : '?') + 'v=' + Date.now())
    .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
}
function fmtVol(v) {
  if (v == null) return '—';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
  return '$' + Math.round(v);
}
function md(iso) { return (iso || '').slice(5, 10).replace('-', '/'); }

/* 美伊局势·预测市场：关键词 → 中文行名（顺序即展示顺序） */
var IRAN_MAP = [
  { k: 'Hormuz traffic returns to normal by September 15', n: '霍尔木兹海峡恢复正常 · 9/15前' },
  { k: 'Hormuz traffic returns to normal by September 30', n: '霍尔木兹海峡恢复正常 · 9/30前' },
  { k: 'Hormuz traffic returns to normal by October', n: '霍尔木兹海峡恢复正常 · 10/31前' },
  { k: 'Hormuz traffic returns to normal by December', n: '霍尔木兹海峡恢复正常 · 12/31前' },
  { k: 'invade Iran', n: '美国2027年前入侵伊朗' },
  { k: 'Iran Effective Ceasefire', n: '美伊有效停火' },
  { k: 'US-Iran nuclear deal', n: '美伊核协议' },
  { k: 'Iran-Oman Hormuz', n: '伊朗-阿曼海峡协议' },
  { k: 'Bab el-Mandeb', n: '曼德海峡实质关闭' }
];

var FP = {
  _dates: [],
  _pushDate: function (d) { if (d) FP._dates.push(d); FP._stamp(); },
  _stamp: function () {
    var mx = '';
    FP._dates.forEach(function (d) { var s = String(d).slice(0, 10); if (s > mx) mx = s; });
    if (!mx) return;
    var els = document.querySelectorAll('.snapAsof');
    for (var i = 0; i < els.length; i++) els[i].textContent = '管线数据日：' + mx;
  },

  /* ① FedWatch：直读官方管线 fedwatch.json */
  fw: function (boxId, base) {
    var box = document.getElementById(boxId); if (!box) return;
    getJSON(base + 'fedwatch.json').then(function (F) {
      if (!F || !F.meetings || !F.meetings.length) return;
      var rows = F.meetings.slice(0, 6).map(function (m, i) {
        var hi = m.hike >= 50 ? 'up' : (m.ease >= 50 ? 'dn' : '');
        return '<tr style="' + (i === 0 ? 'background:rgba(212,169,68,.08);' : '') + '"><td>' + esc(m.meeting) + (i === 0 ? ' ◀最近' : '') + '</td>' +
          '<td style="text-align:right;">' + m.ease + '%</td><td style="text-align:right;">' + m.no_change + '%</td>' +
          '<td class="' + hi + '" style="text-align:right;font-weight:700;">' + m.hike + '%</td></tr>';
      }).join('');
      var concl = '';
      try { if (window.CE && window.CE.fwConclusion) concl = window.CE.fwConclusion(F); } catch (e) {}
      window.__fwFresh = true;
      box.innerHTML = '<table><tr><th>FOMC会议</th><th style="text-align:right;">降息</th><th style="text-align:right;">维持</th><th style="text-align:right;">加息</th></tr>' + rows + '</table>' +
        concl +
        '<div style="font-size:11px;color:var(--dim);margin-top:6px;">' + esc(F.source || 'CME FedWatch') + ' · 截至 ' + esc(F.asof) + ' · 官方管线工作日每2小时自动更新</div>';
      FP._pushDate(F.asof);
    });
  },

  /* ② TACO 压力指数：直读 trump_zone.json（管线每日2次） */
  taco: function (boxId, base) {
    var box = document.getElementById(boxId); if (!box) return;
    getJSON(base + 'trump_zone.json').then(function (tz) {
      var p = tz && tz.pressure; if (!p) return;
      var names = { approval: '净支持', dgs10: '10Y', move: 'MOVE', sp500: 'S&P', vix: 'VIX', bkevenpy02: 'CPI Now' };
      var c = p.latest_contrib || {};
      var chips = Object.keys(names).map(function (k) {
        var v = c[k]; if (v == null) return '';
        return '<span style="font-size:11px;border:1px solid var(--line);border-radius:10px;padding:2px 8px;margin:2px 4px 2px 0;display:inline-block;">' +
          names[k] + ' <b style="color:' + (v > 0 ? 'var(--up)' : 'var(--dn)') + '">' + (v > 0 ? '+' : '') + v.toFixed(1) + '</b></span>';
      }).join('');
      var evs = (tz.taco_events || []).slice(0, 3).map(function (e) {
        if (!e) return '';
        if (Array.isArray(e)) return '<div style="font-size:12px;padding:5px 0;border-top:1px dashed var(--line);"><span style="color:var(--dim);font-size:11px;">' + esc(e[0]) + '</span> ' + esc(e[1]) + '</div>';
        return '<div style="font-size:12px;padding:5px 0;border-top:1px dashed var(--line);"><span style="color:var(--dim);font-size:11px;">' +
          esc(e.range || e.end || '') + '</span> <b>' + esc(e.title || '') + '</b>：' + esc(e.retreat || e.threat || '') + '</div>';
      }).join('');
      window.__tacoFresh = true;
      box.innerHTML = '<div style="display:flex;align-items:baseline;gap:14px;">' +
        '<span class="big" style="color:' + (p.value > 0 ? 'var(--up)' : 'var(--dn)') + ';">' + (p.value > 0 ? '+' : '') + p.value + '%</span>' +
        '<span style="font-size:12px;color:var(--dim);">截至 ' + esc(p.asof) + ' · L3·ocmacro（管线每日2次）</span></div>' +
        '<div style="margin-top:6px;">' + chips + '</div>' +
        (evs ? '<div style="font-size:11px;color:var(--dim);margin-top:8px;">近期TACO事件：</div>' + evs : '') +
        '<div style="font-size:11px;color:var(--dim);margin-top:8px;">压力越高→TACO回撤概率越高；30条事件复盘、支持率、Truths跟踪见 ' +
        '<a href="../panels/trump_zone.html" style="color:var(--gold);text-decoration:none;">特朗普专区 ↗</a></div>';
      FP._pushDate(p.asof);
    });
  },

  /* ③ 美伊局势·预测市场跟踪：直读 polymarket.json + geopolitics.json */
  iran: function (boxId, base) {
    var box = document.getElementById(boxId); if (!box) return;
    Promise.all([getJSON(base + 'polymarket.json'), getJSON(base + 'geopolitics.json')]).then(function (rs) {
      var d = rs[0], g = rs[1]; if (!d) return;
      var fetched = (d.fetched_at || '').slice(0, 10);
      var rows = [];
      (d.markets || []).forEach(function (m) {
        var q = m.question || '';
        for (var i = 0; i < IRAN_MAP.length; i++) {
          if (q.indexOf(IRAN_MAP[i].k) < 0) continue;
          var yes = (m.outcomes && m.outcomes[0] && m.outcomes[0].price != null) ? m.outcomes[0].price * 100 : null;
          if (yes == null) break;
          /* 已到期的市场不再展示（本卡只跟踪前瞻定价） */
          if (m.end && m.end < fetched) break;
          var chg = '—', h = m.history || [];
          if (h.length >= 2) {
            var last = h[h.length - 1], ref = h[0];
            for (var j = h.length - 1; j >= 0; j--) { ref = h[j]; if ((new Date(last[0]) - new Date(h[j][0])) / 864e5 >= 6.5) break; }
            var dp = (last[1] - ref[1]) * 100;
            chg = md(ref[0]) + ' ' + (ref[1] * 100).toFixed(1) + '% → ' + (last[1] * 100).toFixed(1) + '%（' + (dp >= 0 ? '+' : '') + dp.toFixed(1) + 'pp）';
          }
          rows.push({ o: i, n: IRAN_MAP[i].n, yes: yes, vol: m.vol24, chg: chg });
          break;
        }
      });
      rows.sort(function (a, b) { return a.o - b.o; });
      rows = rows.slice(0, 6);
      var mk = rows.map(function (m) {
        return '<tr><td>' + esc(m.n) + '</td><td class="up" style="text-align:right;font-weight:700;">' +
          (m.yes < 1 ? m.yes.toFixed(2) : m.yes.toFixed(1)) + '%</td><td style="text-align:right;">' + fmtVol(m.vol) +
          '</td><td style="font-size:11px;color:var(--dim);">' + esc(m.chg) + '</td></tr>';
      }).join('');
      /* 最新进展：geopolitics.json 美伊线近4条 */
      var iev = '';
      if (g && g.lines) {
        for (var k = 0; k < g.lines.length; k++) {
          if (g.lines[k].id !== 'usiran') continue;
          var evs = g.lines[k].events || [];
          iev = evs.slice(-4).reverse().map(function (e) {
            return '<div style="font-size:12px;padding:5px 0;border-top:1px dashed var(--line);"><span style="color:var(--dim);font-size:11px;">' +
              esc(md(e[0])) + '</span> <b>' + esc(e[1]) + '</b>——' + esc(e[3]) + '</div>';
          }).join('');
        }
      }
      window.__iranFresh = true;
      box.innerHTML = '<table><tr><th>预测市场（Yes=达成/恢复）</th><th style="text-align:right;">概率</th><th style="text-align:right;">成交额(24h)</th><th>变动</th></tr>' + mk + '</table>' +
        (iev ? '<div style="font-size:11px;color:var(--dim);margin-top:8px;">最新进展：</div>' + iev : '') +
        '<div style="font-size:11px;color:var(--dim);margin-top:8px;">Polymarket（预测市场·L3·管线每日2次） · 数据日 ' + esc(fetched) +
        (g ? ' · 事件时间线更新 ' + esc(g.updated) : '') + '</div>';
      FP._pushDate(fetched);
    });
  },

  /* ④ 数据预测：共识日历（管线）置顶 + 投行矩阵（人工维护，带保鲜提醒） */
  forecast: function (boxId, base) {
    var box = document.getElementById(boxId); if (!box) return;
    getJSON(base + 'calendar_consensus.json').then(function (cal) {
      var h = '';
      if (cal && cal.events && cal.events.length) {
        var all = cal.events.filter(function (e) { return e.fc && e.imp === 'High'; });
        /* 以 asof 为界：未来/当日事件排前，已过的只留最近3条 */
        var am = +String(cal.asof).slice(5, 7), ad = +String(cal.asof).slice(8, 10), tk = am * 100 + ad;
        function k(e) { var p = String(e.d).split('/'); return (+p[0]) * 100 + (+p[1]); }
        var fut = all.filter(function (e) { return k(e) >= tk - 1; });
        var pst = all.filter(function (e) { return k(e) < tk - 1; }).slice(-3);
        var evs = fut.concat(pst);
        if (evs.length) {
          h += '<div style="font-size:12px;color:var(--gold);font-weight:700;margin:2px 0 6px;">即将公布 · 市场共识（管线每日2次自动更新）</div>' +
            '<table><tr><th>日期</th><th>事件</th><th style="text-align:right;">共识</th><th style="text-align:right;">前值</th><th style="text-align:right;">公布</th></tr>' +
            evs.map(function (e) {
              return '<tr><td style="white-space:nowrap;">' + esc(e.d) + ' ' + esc(e.tm) + '</td><td>' + esc(e.tcn || e.ten) +
                '</td><td style="text-align:right;color:var(--gold);font-weight:700;">' + esc(e.fc) +
                '</td><td style="text-align:right;color:var(--dim);">' + esc(e.pv || '—') +
                '</td><td style="text-align:right;">' + (e.ac ? '<b>' + esc(e.ac) + '</b>' : '<span style="color:var(--dim);">待公布</span>') + '</td></tr>';
            }).join('') + '</table>' +
            '<div style="font-size:10.5px;color:var(--dim);margin-top:2px;">' + esc(cal.src) + ' · 截至 ' + esc(cal.asof) + '</div>';
        }
      }
      getJSON(base + 'forecasts.json').then(function (F) {
        var asofEl = document.getElementById('bankAsof');
        if (asofEl) asofEl.textContent = '共识截至 ' + (cal ? cal.asof : '—');
        if (!F || !F.events || !F.events.length) { if (h) box.innerHTML = h; return; }
        /* 保鲜检查：超过10天提示 */
        var days = 999;
        try { days = Math.round((new Date() - new Date(String(F.asof).replace(/(\d{4})-(\d{2})-(\d{2}).*/, '$1-$2-$3T00:00:00'))) / 864e5); } catch (e) {}
        h += '<div style="font-size:12px;color:var(--gold);font-weight:700;margin:14px 0 6px;">投行预测矩阵（人工维护 · 整理截至 ' + esc(F.asof) + '）' +
          (days > 10 ? '<span style="color:#e5534b;font-weight:400;"> ⚠ 已超过10天未刷新——对Kimi说「更新数据预测」即可</span>' : '') + '</div>';
        h += F.events.map(function (ev) {
          var banks = (ev.banks && ev.banks.length) ?
            '<table style="margin-top:6px;"><tr><th>机构</th><th>数字预测</th><th>核心观点</th><th style="text-align:right;">口径日期</th></tr>' +
            ev.banks.map(function (b) {
              return '<tr><td style="white-space:nowrap;"><b>' + esc(b.bank) + '</b></td>' +
                '<td style="white-space:nowrap;color:var(--gold);font-weight:700;">' + esc(b.fc) + '</td>' +
                '<td style="font-size:12px;">' + esc(b.view) + '</td>' +
                '<td style="text-align:right;font-size:11px;color:var(--dim);white-space:nowrap;">' + esc(b.date) + ' · ' + esc(b.src) + '</td></tr>';
            }).join('') + '</table>' :
            '<div style="font-size:12px;color:var(--dim);margin-top:4px;">投行数字预测待补。</div>';
          var logic = (ev.logic && ev.logic.length) ? '<ol style="margin:6px 0 0;padding-left:20px;">' +
            ev.logic.map(function (l) { return '<li style="font-size:12px;line-height:1.7;color:var(--dim);">' + esc(l) + '</li>'; }).join('') + '</ol>' : '';
          return '<div style="border:1px solid var(--line);border-radius:8px;padding:10px 12px;margin-bottom:10px;">' +
            '<div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px;"><b style="font-size:13px;">' + esc(ev.name) + '</b>' +
            '<span style="font-size:12px;color:var(--gold);">公布：' + esc(ev.release) + '</span></div>' +
            '<div style="font-size:12px;margin-top:4px;">共识：<b style="color:var(--gold);">' + esc(ev.consensus) + '</b>' +
            '<span style="color:var(--dim);margin-left:12px;">前值：' + esc(ev.previous) + '</span></div>' + banks + logic + '</div>';
        }).join('');
        box.innerHTML = h;
        if (cal) FP._pushDate(cal.asof);
      });
    });
  },

  /* ⑤ 关键数据时间表（页面顶部箭头条）：直读 calendar_consensus，替代9/2快照 */
  keydates: function (boxId, base) {
    var box = document.getElementById(boxId); if (!box) return;
    getJSON(base + 'calendar_consensus.json').then(function (cal) {
      if (!cal || !cal.events) return;
      var am = +String(cal.asof).slice(5, 7), ad = +String(cal.asof).slice(8, 10), tk = am * 100 + ad;
      function k(e) { var p = String(e.d).split('/'); return (+p[0]) * 100 + (+p[1]); }
      var evs = cal.events.filter(function (e) { return e.imp === 'High' && k(e) >= tk - 1; }).slice(0, 6);
      if (!evs.length) return;
      window.__kdFresh = true;
      box.innerHTML = evs.map(function (e) {
        return '<div class="kd hot"><div class="kdd">' + esc(e.d) + '</div><div class="kde">' + esc(e.tcn || e.ten) +
          (e.fc ? ' 预期' + esc(e.fc) : '') + '</div><div class="kds">★★★★</div></div>';
      }).join('<div class="kdarr">→</div>');
    });
  },

  /* 自动装配：页面上存在哪个盒子就刷新哪个 */
  init: function (base) {
    base = base || '../data/';
    if (document.getElementById('fwBox') && !window.__fwFresh) FP.fw('fwBox', base);
    if (document.getElementById('tacoBox')) FP.taco('tacoBox', base);
    if (document.getElementById('iranBox')) FP.iran('iranBox', base);
    if (document.getElementById('bankBox')) FP.forecast('bankBox', base);
    if (document.getElementById('keyDateBar')) FP.keydates('keyDateBar', base);
  }
};
window.FreshPanels = FP;
function boot() { setTimeout(function () { FP.init(); }, 60); }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
})();
