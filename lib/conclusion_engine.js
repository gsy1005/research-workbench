/* ============================================================================
   结论规则引擎 v1.0 · conclusion_engine.js
   作用：把日报/周报的"文字观点"从人工冻结改为【规则×最新数据】自动生成。
   输入：window.CHART_SERIES（data/chart_series.js，管线每日两次更新）。
   特点：
   - 全部结论 = 公开规则函数（本文件即规则文档），数据变 → 文字自动变；
   - 每个区块带"数据日"戳，哪天的数据说话一目了然；
   - 只写 host div（ce-*），不碰页面其他逻辑；渲染失败不影响页面其余部分。
   维护：改阈值/措辞直接改本文件对应函数即可。
   ============================================================================ */
(function () {
'use strict';
var CE = { version: '1.0' };

/* ---------- 基础取数 ---------- */
function raw(id) {
  var a = (window.CHART_SERIES || {})[id];
  if (!a || !a.length) return null;
  var f = [], i;
  for (i = 0; i < a.length; i++) if (a[i] && a[i][1] != null && isFinite(a[i][1])) f.push(a[i]);
  return f.length ? f : null;
}
function pctileOf(arr, v) {
  var c = 0, i;
  for (i = 0; i < arr.length; i++) if (arr[i][1] <= v) c++;
  return Math.round(c / arr.length * 1000) / 10;
}
function S(id) {
  var f = raw(id);
  if (!f) return null;
  var last = f[f.length - 1], prev = f.length > 1 ? f[f.length - 2] : null;
  return {
    id: id, v: last[1], d: last[0],
    pv: prev ? prev[1] : null, pd: prev ? prev[0] : null,
    chg: prev ? last[1] - prev[1] : null,
    pct: (prev && prev[1]) ? (last[1] / prev[1] - 1) * 100 : null,
    pctile: pctileOf(f, last[1]), n: f.length, arr: f
  };
}
function chgN(s, n) { /* n个点前至今的变化量 */
  if (!s || !s.arr || s.arr.length <= n) return null;
  return s.v - s.arr[s.arr.length - 1 - n][1];
}
function pctN(s, n) {
  if (!s || !s.arr || s.arr.length <= n) return null;
  var b = s.arr[s.arr.length - 1 - n][1];
  return b ? (s.v / b - 1) * 100 : null;
}

/* ---------- 格式化 ---------- */
function f2(x) { return x == null ? '—' : (+x).toFixed(2); }
function f1(x) { return x == null ? '—' : (+x).toFixed(1); }
function f0(x) { return x == null ? '—' : Math.round(+x) + ''; }
function bp(x) { return x == null ? '—' : (x > 0 ? '+' : '') + Math.round(x * 100) + 'bp'; }
function nfpK(s2){ if(!s2) return '—'; return (s2.v>0?'+':'')+Math.round(s2.v); }
function bpRaw(x) { return x == null ? '—' : (x > 0 ? '+' : '') + Math.round(+x) + 'bp'; }
function pp(x) { return x == null ? '—' : (x > 0 ? '+' : '') + (+x).toFixed(2); }
function pct1(x) { return x == null ? '—' : (x > 0 ? '+' : '') + (+x).toFixed(2) + '%'; }
function wan(x) { return x == null ? '—' : (x / 10000).toFixed(1) + '万'; }
function cls(chgVal, invert) { /* 涨跌配色：债市/利差类invert=true时升=红 */
  if (chgVal == null) return 'flat';
  var up = chgVal > 0;
  if (invert) up = !up;
  return Math.abs(chgVal) < 1e-12 ? 'flat' : (up ? 'up' : 'dn');
}
function arrow(x) { return x == null ? '→' : (x > 0 ? '↑' : (x < 0 ? '↓' : '→')); }

/* ---------- 数据事实集 ---------- */
var IDS = ['DGS10', 'DGS2', 'DGS30', 'DFF', 'DFII10', 'T5YIE', 'T10YIE', 'T5YIFR', 'T10Y2Y', 'T10Y3M', 'ACMTP10',
  'BAMLC0A4CBBB', 'BAMLH0A0HYM2', 'VIXCLS', 'Y_MOVE', 'Y_GSPC', 'Y_IXIC', 'Y_GOLD', 'Y_SLV', 'GOLD_SILVER_RATIO',
  'Y_DXY', 'DTWEXBGS', 'Y_USDJPY', 'Y_EURUSD', 'DEXCHUS', 'DCOILWTICO', 'DCOILBRENTEU', 'GASREGW',
  'ICSA', 'PAYEMS_CHG', 'UNRATE', 'CPIAUCSL_YOY', 'CPILFESL_YOY', 'PCEPILFE_YOY', 'STICKCPIM157SFRBATL',
  'SOFR', 'IORB', 'RRPONTSYD', 'WRESBAL', 'SPR_SOFR_IORB', 'LIQ_SRF', 'NETLIQ', 'NFCI',
  'CFTC_TY_NET', 'CFTC_TU_NET', 'CFTC_US_NET', 'CFTC_GC_NET', 'CFTC_DX_NET', 'CFTC_JY_NET', 'CFTC_HG_NET',
  'EM_CGB10Y', 'EM_CGB2Y', 'EM_CGB30Y', 'SPR_USCN10Y', 'IF_000300SH', 'IF_000001SH',
  'EM_CN_PMI_MFG', 'EM_CN_PMI_NMFG', 'EM_CN_CPI_YOY', 'EM_CN_PPI_YOY', 'EM_CN_M2_YOY', 'EM_CN_M1_YOY',
  'EM_CN_GDP_YOY', 'EM_RETAIL_YOY', 'EM_CN_IAV_YOY', 'MORTGAGE30US', 'US_DEBT',
  'US_AUC_2Y_BTC', 'US_AUC_10Y_BTC', 'US_AUC_30Y_BTC', 'JP_UST_HOLD', 'CN_UST_HOLD'];
var _F = null;
function facts() {
  if (_F) return _F;
  var F = {};
  IDS.forEach(function (k) { F[k] = S(k); });
  /* 全站数据日 = 核心日频序列最新日期的最大值 */
  var mx = '';
  ['DGS10', 'Y_GOLD', 'Y_DXY', 'Y_GSPC', 'SOFR', 'EM_CGB10Y'].forEach(function (k) {
    if (F[k] && F[k].d > mx) mx = F[k].d;
  });
  F.asof = mx || '—';
  /* 派生 */
  F.spUSCN = (F.DGS10 && F.EM_CGB10Y) ? (F.DGS10.v - F.EM_CGB10Y.v) : null; /* 中美10Y利差(%) */
  F.debtYoY = null;
  if (F.US_DEBT && F.US_DEBT.arr && F.US_DEBT.arr.length > 260) {
    var b = F.US_DEBT.arr[F.US_DEBT.arr.length - 261][1];
    F.debtYoY = b ? (F.US_DEBT.v / b - 1) * 100 : null;
  }
  _F = F;
  return F;
}
function stamp() {
  return '<span style="font-size:11px;color:var(--dim);">⚙️规则引擎自动生成 · 数据日 <b style="color:var(--gold)">' + facts().asof +
    '</b> · 规则公开：lib/conclusion_engine.js · 数据变→结论自动变</span>';
}
function setHost(id, html) {
  var el = document.getElementById(id);
  if (el) el.innerHTML = html;
}

/* ============================================================================
   ① 日度结论（替代 views.json 冻结块）
   ============================================================================ */
function dailyConclusion() {
  var F = facts();
  var aWin = F.DFII10 && F.Y_GOLD && F.DFII10.v >= 2.45 && F.Y_GOLD.v < 4520;
  var bWin = F.Y_DXY && F.Y_GOLD && F.Y_DXY.v < 98.5 && F.Y_GOLD.v > 4700;
  var abState = aWin
    ? '<b style="color:#e5534b">A端已确认</b>（联合阈值规则：实际利率' + f2(F.DFII10.v) + '%≥2.45% 且 金' + f0(F.Y_GOLD.v) + '&lt;4520，两个条件同时满足 → 按0902冻结的规则，宣告A端成立）'
    : (bWin ? '<b style="color:#4caf7d">B端翻盘确认</b>（DXY回落至98.5下方且金收复4700）'
      : '<b>读秒/僵持</b>：A端条件 ' + (F.DFII10 && F.DFII10.v >= 2.45 ? '✅实际利率' : '❌实际利率') + ' / ' +
        (F.Y_GOLD && F.Y_GOLD.v < 4520 ? '✅金破4520' : '❌金未破') + '；B端条件均远未满足');
  var d2_20 = chgN(F.DGS2, 20);
  var h = '<div class="card concl">';
  h += '<p style="margin:0 0 8px;">' + stamp() + ' · 人工旧观点存档：<a href="daily_2026-09-02.html" style="color:var(--gold)">9/2版 ↗</a></p>';
  h += '<p><b>【中心矛盾裁决】</b>' + abState + '。</p>';
  h += '<p><b>【政策腿】</b>FFR ' + f2(F.DFF && F.DFF.v) + '%；2Y美债 ' + f2(F.DGS2 && F.DGS2.v) + '%（近20日' + bp(d2_20) +
    '）；10Y实际利率 ' + f2(F.DFII10 && F.DFII10.v) + '%（历史' + f0(F.DFII10 && F.DFII10.pctile) + '分位）——' +
    (d2_20 != null && d2_20 > 0.1 ? '短端快速上行=紧缩预期前移，政策腿主导资产定价。' :
     (d2_20 != null && d2_20 < -0.1 ? '短端回落=紧缩预期退潮，政策压力边际缓解。' : '短端窄幅波动，政策预期暂稳。')) + '</p>';
  h += '<p><b>【通胀腿】</b>CPI同比 ' + f2(F.CPIAUCSL_YOY && F.CPIAUCSL_YOY.v) + '%（' + (F.CPIAUCSL_YOY ? F.CPIAUCSL_YOY.d : '—') +
    '）、核心 ' + f2(F.CPILFESL_YOY && F.CPILFESL_YOY.v) + '%；5Y盈亏平衡 ' + f2(F.T5YIE && F.T5YIE.v) + '%；WTI ' + f2(F.DCOILWTICO && F.DCOILWTICO.v) +
    '美元（20日' + pct1(pctN(F.DCOILWTICO, 20)) + '）——' +
    (F.DCOILWTICO && pctN(F.DCOILWTICO, 20) > 5 ? '油价急升=通胀下行舒适期结束的判断被强化。' :
     (F.T5YIE && F.T5YIE.v < 2.3 ? '通胀预期锚定较好，通胀腿暂不主导。' : '通胀黏性与供给扰动并存，舒适期结束判断维持。')) + '</p>';
  h += '<p><b>【资产映射】</b>①贵金属：金 ' + f0(F.Y_GOLD && F.Y_GOLD.v) + '（' + (F.Y_GOLD ? F.Y_GOLD.d : '') + '，20日' + pct1(pctN(F.Y_GOLD, 20)) +
    '），相对4520线 ' + (F.Y_GOLD ? (F.Y_GOLD.v < 4520 ? '下方' + f0(4520 - F.Y_GOLD.v) + '美元' : '上方') : '—') +
    '；②美债：10Y ' + f2(F.DGS10 && F.DGS10.v) + '%、曲线10Y-2Y ' + bp(F.T10Y2Y && F.T10Y2Y.v) +
    '；③美股：标普 ' + f0(F.Y_GSPC && F.Y_GSPC.v) + '（5日' + pct1(pctN(F.Y_GSPC, 5)) + '），VIX ' + f2(F.VIXCLS && F.VIXCLS.v) +
    '；④美元：DXY ' + f2(F.Y_DXY && F.Y_DXY.v) + '。</p>';
  h += '<p><b>【中国腿】</b>制造业PMI ' + f1(F.EM_CN_PMI_MFG && F.EM_CN_PMI_MFG.v) + '（' + (F.EM_CN_PMI_MFG ? F.EM_CN_PMI_MFG.d : '—') + '）、CPI ' + f2(F.EM_CN_CPI_YOY && F.EM_CN_CPI_YOY.v) +
    '%、PPI ' + f2(F.EM_CN_PPI_YOY && F.EM_CN_PPI_YOY.v) + '%、M1 ' + f1(F.EM_CN_M1_YOY && F.EM_CN_M1_YOY.v) + '%/M2 ' + f1(F.EM_CN_M2_YOY && F.EM_CN_M2_YOY.v) +
    '%；中债10Y ' + f2(F.EM_CGB10Y && F.EM_CGB10Y.v) + '%，中美利差 ' + (F.spUSCN != null ? '-' + f0(Math.abs(F.spUSCN) * 100) + 'bp' : '—') + '。</p>';
  h += '<p style="font-size:11px;color:var(--dim);margin:8px 0 0;">说明：以上为规则引擎按最新数据生成的框架性结论（阈值见0902面板与lib/conclusion_engine.js），深度叙事解读仍以人工版为准、以注记追加；事后数据不回填。</p>';
  return h + '</div>';
}

/* ============================================================================
   ② 重要数据总览结论（dp14）
   ============================================================================ */
function overview() {
  var F = facts();
  var q = quadrant(F);
  var h = '<div class="card"><p style="font-size:13px;margin:0 0 6px;"><b style="color:var(--gold)">总览结论（⚙️' + F.asof + ' 自动生成）</b>：<b>' + q.headline + '</b></p>';
  h += '<ul style="margin:0;padding-left:20px;font-size:12.5px;line-height:1.85;">';
  h += '<li><b>美元</b>：DXY ' + f2(F.Y_DXY && F.Y_DXY.v) + '（' + (F.Y_DXY ? F.Y_DXY.d : '') + '，20日' + pct1(pctN(F.Y_DXY, 20)) + '）；CFTC美元净多 ' +
    wan(F.CFTC_DX_NET && F.CFTC_DX_NET.v) + '手（' + f0(F.CFTC_DX_NET && F.CFTC_DX_NET.pctile) + '分位）——' +
    (F.CFTC_DX_NET && F.CFTC_DX_NET.pctile > 80 ? '多头拥挤，追高谨慎' : '多头不拥挤，走强尚有持续性空间') + '；</li>';
  h += '<li><b>美债</b>：10Y ' + f2(F.DGS10 && F.DGS10.v) + '%（' + bp(F.DGS10 && F.DGS10.chg) + '）、30Y ' + f2(F.DGS30 && F.DGS30.v) + '%、10Y-2Y ' +
    bp(F.T10Y2Y && F.T10Y2Y.v) + '；实际利率 ' + f2(F.DFII10 && F.DFII10.v) + '%（' + f0(F.DFII10 && F.DFII10.pctile) + '分位）是估值真正的压力源；</li>';
  h += '<li><b>外汇</b>：USDJPY ' + f2(F.Y_USDJPY && F.Y_USDJPY.v) + (F.Y_USDJPY && F.Y_USDJPY.v >= 155 ? '（干预雷区⚠）' : '') + '、USDCNY ' +
    f2(F.DEXCHUS && F.DEXCHUS.v) + '、EURUSD ' + f2(F.Y_EURUSD && F.Y_EURUSD.v) + '；</li>';
  h += '<li><b>原油</b>：Brent ' + f2(F.DCOILBRENTEU && F.DCOILBRENTEU.v) + ' / WTI ' + f2(F.DCOILWTICO && F.DCOILWTICO.v) + '美元（20日' +
    pct1(pctN(F.DCOILWTICO, 20)) + '）——' + (pctN(F.DCOILWTICO, 20) > 5 ? '供给冲击定价中，滞胀腿强化' : '油价暂非主导矛盾') + '。</li>';
  h += '</ul><p style="font-size:11.5px;color:var(--dim);margin:8px 0 0;">' + stamp() + '</p></div>';
  return h;
}
function quadrant(F) {
  var spx = F.Y_GSPC ? F.Y_GSPC.pct : null, ust = F.DGS10 ? F.DGS10.chg : null, dxy = F.Y_DXY ? F.Y_DXY.pct : null;
  if (spx == null || ust == null || dxy == null) return { name: '数据不足', headline: '象限待数据', stockUp: null };
  var stockUp = spx > 0, bondUp = ust < 0, dxyUp = dxy > 0;
  var name, desc;
  if (stockUp && bondUp && !dxyUp) { name = '宽松交易'; desc = '股债双涨+美元弱=定价宽松'; }
  else if (!stockUp && bondUp) { name = '衰退交易'; desc = '股跌债涨=避险衰退定价'; }
  else if (stockUp && !bondUp && dxyUp) { name = '增长/软着陆'; desc = '股涨债跌美元强=增长定价'; }
  else if (!stockUp && !bondUp && dxyUp) { name = '滞胀紧缩（现金为王）'; desc = '股跌债跌美元强=A端全面兑现区'; }
  else if (!stockUp && !bondUp && !dxyUp) { name = '普跌（流动性冲击）'; desc = '股债汇三杀=现金荒特征'; }
  else { name = '过渡象限'; desc = '信号混杂'; }
  return {
    name: name, stockUp: stockUp, bondUp: bondUp, dxyUp: dxyUp, desc: desc,
    headline: '最新交易日：股' + (stockUp ? '涨' : '跌') + '、债' + (bondUp ? '涨' : '跌（收益率' + (ust > 0 ? '升' : '降') + '）') +
      '、美元' + (dxyUp ? '强' : '弱') + ' → <b style="color:#e5534b">' + name + '象限</b>（' + desc + '）'
  };
}

/* ============================================================================
   ③ 九维状态检视（dp2）
   ============================================================================ */
function dim(status, clsName, vote) {
  return { st: status, cls: clsName, vote: vote };
}
function nineDim() {
  var F = facts(), rows = [];
  /* 1 货币政策 */
  var d2c = chgN(F.DGS2, 5);
  rows.push(['货币政策',
    'FFR ' + f2(F.DFF && F.DFF.v) + '%；2Y ' + f2(F.DGS2 && F.DGS2.v) + '%（5日' + bp(d2c) + '）；10Y实际利率 ' + f2(F.DFII10 && F.DFII10.v) + '%（' + f0(F.DFII10 && F.DFII10.pctile) + '分位）',
    d2c != null && d2c > 0.05 ? dim('紧缩预期重定价中', 'dn', 'A端强支撑') : (d2c != null && d2c < -0.05 ? dim('紧缩退潮', 'up', 'B端喘息') : dim('高位僵持', 'flat', 'A端支撑'))]);
  /* 2 美债 */
  rows.push(['美债',
    '10Y ' + f2(F.DGS10 && F.DGS10.v) + '% / 30Y ' + f2(F.DGS30 && F.DGS30.v) + '%；实际利率' + f2(F.DFII10 && F.DFII10.v) + '%+盈亏平衡' + f2(F.T10YIE && F.T10YIE.v) +
    '%；期限溢价ACM ' + f2(F.ACMTP10 && F.ACMTP10.v) + '%；CFTC 10Y净' + wan(F.CFTC_TY_NET && F.CFTC_TY_NET.v) + '手',
    F.DGS10 && F.DGS10.v >= 4.9 ? dim('破4.90%失序警报线', 'dn', 'A端（详见债市）') : dim('实际利率熊压，非通胀恐慌', 'dn', 'A端（详见债市）')]);
  /* 3 通胀 */
  var oil20 = pctN(F.DCOILWTICO, 20);
  rows.push(['通胀',
    'CPI ' + f2(F.CPIAUCSL_YOY && F.CPIAUCSL_YOY.v) + '%/核心 ' + f2(F.CPILFESL_YOY && F.CPILFESL_YOY.v) + '%（' + (F.CPIAUCSL_YOY ? F.CPIAUCSL_YOY.d : '—') + '）；5Y盈亏平衡 ' +
    f2(F.T5YIE && F.T5YIE.v) + '%；WTI 20日' + pct1(oil20),
    (oil20 != null && oil20 > 5) ? dim('供给冲击，上行风险', 'dn', 'A端（滞胀腿）') : dim('黏性未消', 'flat', 'A端（滞胀腿）')]);
  /* 4 就业 */
  var nfpBad = F.PAYEMS_CHG && F.PAYEMS_CHG.v < 0, urBad = F.UNRATE && F.UNRATE.v >= 4.3;
  rows.push(['就业',
    '非农 ' + nfpK(F.PAYEMS_CHG) + '千人（' + (F.PAYEMS_CHG ? F.PAYEMS_CHG.d : '—') + '）；失业率 ' + f1(F.UNRATE && F.UNRATE.v) + '%；初请 ' + f0(F.ICSA && F.ICSA.v) + '千人',
    (nfpBad || urBad) ? dim('失速确认', 'dn', 'B端论据成立') : (F.PAYEMS_CHG && F.PAYEMS_CHG.v < 100 ? dim('降速边缘', 'flat', 'B端论据积累中') : dim('韧性', 'up', 'A端（软着陆腿）'))]);
  /* 5 地缘/油价 */
  rows.push(['地缘与供给',
    'Brent ' + f2(F.DCOILBRENTEU && F.DCOILBRENTEU.v) + ' / WTI ' + f2(F.DCOILWTICO && F.DCOILWTICO.v) + '美元（20日' + pct1(oil20) + '）；汽油零售 ' + f2(F.GASREGW && F.GASREGW.v) + '美元/加仑',
    (oil20 != null && oil20 > 5) ? dim('供给冲击升级', 'dn', '双向：通胀↑助A端 / 避险↑助B端实物腿') : dim('风险溢价暂稳', 'flat', '双向')]);
  /* 6 美元流动性 */
  rows.push(['美元流动性',
    'SOFR-IORB ' + bpRaw(F.SPR_SOFR_IORB && F.SPR_SOFR_IORB.v) + '；ON RRP ' + f2(F.RRPONTSYD && F.RRPONTSYD.v) + '十亿$；准备金 ' + f2(F.WRESBAL && F.WRESBAL.v / 1e6) + '万亿$',
    F.SPR_SOFR_IORB && F.SPR_SOFR_IORB.v >= 10 ? dim('货币市场失压', 'dn', '尾部风险') : (F.RRPONTSYD && F.RRPONTSYD.v < 20 ? dim('缓冲垫耗尽，冲击直达价格', 'flat', '脆弱性积累') : dim('缓冲尚可', 'up', '中性'))]);
  /* 7 美元 */
  rows.push(['美元（汇率）',
    'DXY ' + f2(F.Y_DXY && F.Y_DXY.v) + '（20日' + pct1(pctN(F.Y_DXY, 20)) + '）；USDJPY ' + f2(F.Y_USDJPY && F.Y_USDJPY.v) + '；USDCNY ' + f2(F.DEXCHUS && F.DEXCHUS.v) + '；净多' + wan(F.CFTC_DX_NET && F.CFTC_DX_NET.v) + '手',
    pctN(F.Y_DXY, 20) > 0.5 ? dim('紧缩型走强', 'dn', 'A端（详见外汇）') : (pctN(F.Y_DXY, 20) < -0.5 ? dim('走弱', 'up', 'B端（宽松交易）') : dim('盘整', 'flat', '中性'))]);
  /* 8 头寸与情绪 */
  rows.push(['头寸与情绪',
    'VIX ' + f2(F.VIXCLS && F.VIXCLS.v) + '（' + f0(F.VIXCLS && F.VIXCLS.pctile) + '分位）；信用利差(BBB) ' + f2(F.BAMLC0A4CBBB && F.BAMLC0A4CBBB.v) + '%（' + f0(F.BAMLC0A4CBBB && F.BAMLC0A4CBBB.pctile) +
    '分位）；MOVE ' + f1(F.Y_MOVE && F.Y_MOVE.v),
    (F.VIXCLS && F.VIXCLS.pctile < 25 && F.BAMLC0A4CBBB && F.BAMLC0A4CBBB.pctile < 25) ? dim('自满定价，脆弱性积累', 'up', '反转风险警示') :
    (F.VIXCLS && F.VIXCLS.v >= 20 ? dim('恐慌定价', 'dn', 'risk-off') : dim('中性', 'flat', '—'))]);
  /* 9 中国 */
  rows.push(['中国因素',
    '沪深300 ' + f0(F.IF_000300SH && F.IF_000300SH.v) + '；中债10Y ' + f2(F.EM_CGB10Y && F.EM_CGB10Y.v) + '%；PMI ' + f1(F.EM_CN_PMI_MFG && F.EM_CN_PMI_MFG.v) + '；M1 ' +
    f1(F.EM_CN_M1_YOY && F.EM_CN_M1_YOY.v) + '%；中美利差' + (F.spUSCN != null ? '-' + f0(Math.abs(F.spUSCN) * 100) + 'bp' : '—'),
    F.EM_CN_PMI_MFG && F.EM_CN_PMI_MFG.v >= 50 ? dim('扩张修复', 'up', 'B端底仓支撑') : dim('外压下的稳态', 'flat', 'B端底仓支撑')]);
  var h = '<table class="radar"><tr><th style="width:92px;">维度</th><th>关键证据（数据日 ' + F.asof + '）</th><th style="width:120px;">当前状态</th><th style="width:130px;">指向</th></tr>';
  rows.forEach(function (r) {
    h += '<tr><td><b>' + r[0] + '</b></td><td>' + r[1] + '</td><td class="' + r[2].cls + '">' + r[2].st + '</td><td>' + r[2].vote + '</td></tr>';
  });
  return h + '</table><p style="font-size:11px;color:var(--dim);margin:6px 0 0;">' + stamp() + '</p>';
}

/* ============================================================================
   ④ 证伪雷达（dp2）
   ============================================================================ */
function falsify() {
  var F = facts(), rows = [];
  function line(thesis, trigger, cur, dist, state, stateCls) {
    rows.push('<tr><td>' + thesis + '</td><td>' + trigger + '</td><td class="' + stateCls + '">' + cur + ' → ' + state + '</td></tr>');
  }
  /* A端联合阈值 */
  var a1 = F.DFII10 && F.DFII10.v >= 2.45, a2 = F.Y_GOLD && F.Y_GOLD.v < 4520;
  line('A端：实际利率与美元高位压制实物资产', '10Y实际利率≥2.45% 且 金&lt;4520（联合阈值，0902冻结）',
    '实际利率' + f2(F.DFII10 && F.DFII10.v) + '%(' + (a1 ? '✅' : '距线' + f2(2.45 - (F.DFII10 ? F.DFII10.v : 2.45)) + '%') + ') / 金' + f0(F.Y_GOLD && F.Y_GOLD.v) + '(' + (a2 ? '✅' : '❌') + ')',
    '', (a1 && a2) ? '已触发：A端确认' : '读秒中', (a1 && a2) ? 'dn' : 'flat');
  /* B端翻盘 */
  var b1 = F.Y_DXY && F.Y_DXY.v < 98.5, b2 = F.Y_GOLD && F.Y_GOLD.v > 4700;
  line('B端：实物资产重估翻盘', 'DXY&lt;98.5 且 金&gt;4700',
    'DXY ' + f2(F.Y_DXY && F.Y_DXY.v) + '(' + (b1 ? '✅' : '❌') + ') / 金' + f0(F.Y_GOLD && F.Y_GOLD.v) + '(' + (b2 ? '✅' : '❌') + ')',
    '', (b1 && b2) ? '已触发：B端翻盘' : '两个条件均未接近', (b1 && b2) ? 'up' : 'flat');
  /* 美股 risk-on */
  var oas = F.BAMLC0A4CBBB, vix = F.VIXCLS;
  var rTrig = oas && oas.v >= 1.2 && vix && vix.v >= 18;
  line('美股risk-on结构未破', '信用利差(BBB口径)≥1.20% 且 VIX≥18',
    '利差' + f2(oas && oas.v) + '% / VIX ' + f2(vix && vix.v), '',
    rTrig ? '已触发：risk-on破坏' : (oas && oas.v >= 1.05 || (vix && vix.v >= 17) ? '逼近，警惕' : '远离触发线'), rTrig ? 'dn' : 'up');
  /* 曲线走陡 */
  var st = F.T10Y2Y;
  line('曲线走陡头寸', '10Y-2Y 回落至 &lt;20bp',
    '当前 ' + bp(st && st.v) + '（5日' + bp(chgN(st, 5)) + '）', '',
    st && st.v < 0.2 ? '已触发：退出纪律生效' : (st && st.v < 0.3 ? '贴线，收紧纪律' : '浮盈区'), st && st.v < 0.2 ? 'dn' : 'up');
  /* 就业失速 */
  var jTrig = (F.PAYEMS_CHG && F.PAYEMS_CHG.v < 0) || (F.UNRATE && F.UNRATE.v >= 4.3);
  line('就业失速', '非农再度为负 或 失业率≥4.3%',
    '非农' + nfpK(F.PAYEMS_CHG) + '千人 / 失业率' + f1(F.UNRATE && F.UNRATE.v) + '%', '',
    jTrig ? '已触发' : (F.PAYEMS_CHG && F.PAYEMS_CHG.v < 100 ? '临近观察区' : '未触发'), jTrig ? 'dn' : 'flat');
  /* 流动性 */
  var lTrig = F.SPR_SOFR_IORB && F.SPR_SOFR_IORB.v >= 10;
  line('货币市场缓冲垫', 'SOFR-IORB≥+10bp 或 SRF异常放量',
    'SOFR-IORB ' + bpRaw(F.SPR_SOFR_IORB && F.SPR_SOFR_IORB.v) + ' / RRP ' + f2(F.RRPONTSYD && F.RRPONTSYD.v) + '十亿$', '',
    lTrig ? '已触发：准备金稀缺' : (F.RRPONTSYD && F.RRPONTSYD.v < 20 ? '垫子耗尽，贴线观察' : '安全'), lTrig ? 'dn' : 'flat');
  /* 金双底 */
  var g = F.Y_GOLD, g2down = false;
  if (g && g.arr && g.arr.length > 1) g2down = g.arr[g.arr.length - 1][1] < 4360 && g.arr[g.arr.length - 2][1] < 4360;
  line('金4363-4366双底支撑', '连续两日收盘&lt;4360 → 下看4220(MA50)',
    '最新两收 ' + (g && g.arr.length > 1 ? f0(g.arr[g.arr.length - 2][1]) + ' / ' + f0(g.v) : '—'), '',
    g2down ? '已触发：双底失效' : (g && g.v < 4400 ? '贴线测试中' : '支撑有效'), g2down ? 'dn' : 'flat');
  /* 美元走强确认 */
  line('美元紧缩型走强确认', 'DXY ≥ 102',
    'DXY ' + f2(F.Y_DXY && F.Y_DXY.v) + '（距线 ' + f2(102 - (F.Y_DXY ? F.Y_DXY.v : 102)) + '）', '',
    F.Y_DXY && F.Y_DXY.v >= 102 ? '已触发' : '未触发', F.Y_DXY && F.Y_DXY.v >= 102 ? 'dn' : 'flat');
  /* 债市失序 */
  var dTrig = F.DGS10 && F.DGS10.v >= 4.9 && F.Y_MOVE && F.Y_MOVE.v >= 90;
  line('美债有序重定价', '10Y≥4.90% 且 MOVE≥90 → 无序抛售',
    '10Y ' + f2(F.DGS10 && F.DGS10.v) + '% / MOVE ' + f1(F.Y_MOVE && F.Y_MOVE.v), '',
    dTrig ? '已触发：无序抛售' : (F.DGS10 && F.DGS10.v >= 4.8 ? '接近警报线' : '有序区'), dTrig ? 'dn' : 'up');
  var h = '<table class="radar"><tr><th>活跃结论</th><th>证伪触发器</th><th>当前状态（' + F.asof + '）</th></tr>' + rows.join('') + '</table>';
  return h + '<p style="font-size:11px;color:var(--dim);margin:6px 0 0;">' + stamp() + ' · 触发线量化自0902人工面板，规则不变、状态随数据每日重判</p>';
}

/* ============================================================================
   ⑤ A/B端检验说明书（dp2）
   ============================================================================ */
function abNote() {
  var F = facts();
  var aWin = F.DFII10 && F.Y_GOLD && F.DFII10.v >= 2.45 && F.Y_GOLD.v < 4520;
  var aTxt = aWin
    ? '金已破（' + f0(F.Y_GOLD.v) + '），实际利率' + f2(F.DFII10.v) + '%已站上2.45%——<b style="color:#e5534b">联合阈值满足，A端"官宣胜利"</b>。'
    : '金' + (F.Y_GOLD && F.Y_GOLD.v < 4520 ? '已破（' + f0(F.Y_GOLD.v) + '）' : '未破（' + f0(F.Y_GOLD && F.Y_GOLD.v) + '）') +
      '，实际利率' + f2(F.DFII10 && F.DFII10.v) + '%' + (F.DFII10 && F.DFII10.v >= 2.45 ? '已破线' : '距触发线' + f2(2.45 - (F.DFII10 ? F.DFII10.v : 0)) + '%') + '——读秒阶段。';
  var bGapDxy = F.Y_DXY ? (F.Y_DXY.v - 98.5).toFixed(2) : '—', bGapGold = F.Y_GOLD ? (4700 - F.Y_GOLD.v).toFixed(0) : '—';
  var h = '<div class="card" style="margin-top:14px;"><p style="font-size:13px;margin:0 0 6px;"><b style="color:var(--gold)">A端/B端检验说明书（⚙️随数据自动更新）</b><span style="font-size:11px;color:var(--dim);"> 把中心矛盾翻译成白话</span></p>';
  h += '<ul style="margin:0;padding-left:20px;font-size:12.5px;line-height:1.9;">';
  h += '<li><b>A端 = "紧缩压制"主线</b>：财政发债多+通胀黏性 → 实际利率与美元高位 → 黄金白银被压着打。<b>官宣线=10Y实际利率≥2.45% 且 金收不回4520</b>。现在：' + aTxt + '</li>';
  h += '<li><b>B端 = "实物重估"主线</b>：央行购金+矿紧+AI抢电抢铜 → 实物资产该涨。<b>翻盘线=DXY&lt;98.5 且 金&gt;4700</b>——目前 DXY还差' + bGapDxy + '、金还差' + bGapGold + '美元，' +
    ((F.Y_DXY && F.Y_DXY.v - 98.5 < 1.5) ? 'DXY已接近，盯紧' : '两个都远没够着') + '。</li>';
  h += '<li><b>一句话</b>：' + (aWin ? 'A端已官宣，接下来的问题是"压制持续多久"——盯实际利率能否站稳2.45%上方与金能否收复4520。' : 'A端是"现在进行时"，B端是"中场休息"（支撑还在但攻不出去）。') + '九维表里每一维的"指向"列，就是在给这两端投票。</li>';
  return h + '</ul><p style="font-size:11px;color:var(--dim);margin:8px 0 0;">' + stamp() + '</p></div>';
}

/* ============================================================================
   ⑥ 黄金×有色 利空利多坐标象限（⚙️规则打分 0-10）
   X(压制/利空) 规则：实际利率分位(≥90:3,≥75:2,≥50:1) + DXY20日(>+0.5%:2,>-0.5%:1) 
     + CFTC金净多分位(≥80:2,≥60:1) + 2Y20日(>+10bp:2,>0:1) + 金20日动量(<0:1)
   Y(支撑/利多) 规则：央行购金常态2 + 油价分位(≥70:2,≥50:1) + 美债存量同比(≥5%:2,≥3%:1)
     + 金价分位(≥80:2,≥60:1) + 货币市场紧张(SOFR-IORB≥5bp:2,≥3bp:1)
   ============================================================================ */
function metalScores() {
  var F = facts();
  function band(p, hi, mid) { return p == null ? 0 : (p >= hi ? 2 : (p >= mid ? 1 : 0)); }
  var X = 0;
  X += F.DFII10 ? (F.DFII10.pctile >= 90 ? 3 : (F.DFII10.pctile >= 75 ? 2 : (F.DFII10.pctile >= 50 ? 1 : 0))) : 0;
  var dxy20 = pctN(F.Y_DXY, 20);
  X += dxy20 == null ? 0 : (dxy20 > 0.5 ? 2 : (dxy20 > -0.5 ? 1 : 0));
  X += band(F.CFTC_GC_NET && F.CFTC_GC_NET.pctile, 80, 60);
  var d2 = chgN(F.DGS2, 20);
  X += d2 == null ? 0 : (d2 > 0.1 ? 2 : (d2 > 0 ? 1 : 0));
  var g20 = pctN(F.Y_GOLD, 20);
  X += g20 != null && g20 < 0 ? 1 : 0;
  var Y = 2; /* 央行购金（事实常态项，连续20+月） */
  Y += band(F.DCOILBRENTEU && F.DCOILBRENTEU.pctile, 70, 50);
  Y += F.debtYoY == null ? 0 : (F.debtYoY >= 5 ? 2 : (F.debtYoY >= 3 ? 1 : 0));
  Y += band(F.Y_GOLD && F.Y_GOLD.pctile, 80, 60);
  Y += F.SPR_SOFR_IORB ? (F.SPR_SOFR_IORB.v >= 5 ? 2 : (F.SPR_SOFR_IORB.v >= 3 ? 1 : 0)) : 0;
  X = Math.min(10, Math.round(X * 10) / 10); Y = Math.min(10, Math.round(Y * 10) / 10);
  var gsr = F.GOLD_SILVER_RATIO;
  var Xs = Math.min(10, X + (gsr && gsr.pctile >= 60 ? 1 : 0)), Ys = Math.max(0, Math.round((Y - 1.5) * 10) / 10);
  var Xc = Math.max(0, X - 1) + (F.PAYEMS_CHG && F.PAYEMS_CHG.v < 50 ? 2 : 0);
  Xc = Math.min(10, Xc);
  var Yc = Math.min(10, 3 + (F.EM_CN_PMI_MFG && F.EM_CN_PMI_MFG.v >= 50 ? 1.5 : 0) + band(F.CFTC_HG_NET && F.CFTC_HG_NET.pctile, 70, 50));
  return {
    gold: { x: X, y: Y }, silver: { x: Math.round(Xs * 10) / 10, y: Ys }, copper: { x: Math.round(Xc * 10) / 10, y: Math.round(Yc * 10) / 10 },
    parts: {
      goldX: '实际利率' + f0(F.DFII10 && F.DFII10.pctile) + '分位 + DXY20日' + pct1(dxy20) + ' + 金净多' + f0(F.CFTC_GC_NET && F.CFTC_GC_NET.pctile) + '分位 + 2Y20日' + bp(d2),
      goldY: '央行购金 + 油价' + f0(F.DCOILBRENTEU && F.DCOILBRENTEU.pctile) + '分位 + 美债存量同比' + pct1(F.debtYoY) + ' + 金价' + f0(F.Y_GOLD && F.Y_GOLD.pctile) + '分位 + 货币市场' + bpRaw(F.SPR_SOFR_IORB && F.SPR_SOFR_IORB.v)
    }
  };
}
function metalQuad() {
  var F = facts(), m = metalScores();
  function cx(x) { return 30 + x / 10 * 400; }
  function cy(y) { return 430 - y / 10 * 400; }
  function dot(x, y, color, label, dy) {
    return '<circle cx="' + cx(x) + '" cy="' + cy(y) + '" r="7" fill="' + color + '"/>' +
      '<text x="' + cx(x) + '" y="' + (cy(y) + (dy || -13)) + '" fill="' + color + '" font-size="12" text-anchor="middle" font-weight="bold">' + label + '(' + x + ', ' + y + ')</text>';
  }
  var svg = '<svg viewBox="0 0 460 460" style="width:100%;max-width:460px;background:#10131a;border:1px solid var(--line);border-radius:8px;">' +
    '<rect x="230" y="30" width="200" height="200" fill="#2a2410" opacity="0.35"/><rect x="230" y="230" width="200" height="200" fill="#3d1518" opacity="0.35"/>' +
    '<rect x="30" y="30" width="200" height="200" fill="#10301e" opacity="0.35"/><rect x="30" y="230" width="200" height="200" fill="#151a24" opacity="0.35"/>' +
    '<line x1="230" y1="20" x2="230" y2="440" stroke="#3a4256" stroke-width="1.5"/><line x1="20" y1="230" x2="440" y2="230" stroke="#3a4256" stroke-width="1.5"/>' +
    '<text x="436" y="222" fill="#8a94a6" font-size="11" text-anchor="end">A端压制力（利空）→</text><text x="238" y="32" fill="#8a94a6" font-size="11">↑ B端支撑力（利多）</text>' +
    '<text x="330" y="55" fill="#c9a227" font-size="12" text-anchor="middle" font-weight="bold">高压制×高支撑</text><text x="330" y="70" fill="#8a94a6" font-size="10" text-anchor="middle">拉锯震荡·看哪边先破</text>' +
    '<text x="335" y="420" fill="#c96a5d" font-size="12" text-anchor="middle" font-weight="bold">高压制×低支撑</text><text x="335" y="434" fill="#8a94a6" font-size="10" text-anchor="middle">趋势利空</text>' +
    '<text x="128" y="55" fill="#5fae7f" font-size="12" text-anchor="middle" font-weight="bold">低压制×高支撑</text><text x="128" y="70" fill="#8a94a6" font-size="10" text-anchor="middle">趋势利多</text>' +
    '<text x="128" y="420" fill="#5b6478" font-size="12" text-anchor="middle" font-weight="bold">双低</text><text x="128" y="434" fill="#8a94a6" font-size="10" text-anchor="middle">无方向·垃圾时间</text>' +
    dot(m.gold.x, m.gold.y, '#e8c34a', '黄金') + dot(m.silver.x, m.silver.y, '#c8ccd4', '白银', 20) + dot(m.copper.x, m.copper.y, '#c97b4a', '铜', 20) + '</svg>';
  function reading(p) {
    if (p.x >= 6 && p.y >= 6) return '高压制×高支撑=拉锯震荡，逢支撑看反弹不追空';
    if (p.x >= 6 && p.y < 6) return '高压制×低支撑=趋势利空区';
    if (p.x < 6 && p.y >= 6) return '低压制×高支撑=趋势利多区';
    return '双低=无方向垃圾时间';
  }
  var h = '<div class="card"><div style="display:flex;flex-wrap:wrap;gap:18px;align-items:flex-start;">' + svg +
    '<div style="flex:1;min-width:300px;"><table style="font-size:12px;">' +
    '<tr><th>品种</th><th>压制分构成（X/利空）</th><th>支撑分构成（Y/利多）</th><th style="width:150px;">读法</th></tr>' +
    '<tr><td><b style="color:#e8c34a">黄金</b><br>X=' + m.gold.x + ' Y=' + m.gold.y + '</td><td>' + m.parts.goldX + '</td><td>' + m.parts.goldY + '</td><td>' + reading(m.gold) + '</td></tr>' +
    '<tr><td><b style="color:#c8ccd4">白银</b><br>X=' + m.silver.x + ' Y=' + m.silver.y + '</td><td>同金 + 波动放大器' + (F.GOLD_SILVER_RATIO ? '（金银比' + f1(F.GOLD_SILVER_RATIO.v) + '，' + f0(F.GOLD_SILVER_RATIO.pctile) + '分位）' : '') + '</td><td>工业需求（光伏/AI）+ 避险跟随</td><td>' + reading(m.silver) + '，弹性大于金</td></tr>' +
    '<tr><td><b style="color:#c97b4a">铜/有色</b><br>X=' + m.copper.x + ' Y=' + m.copper.y + '</td><td>利率敏感低于金 + 美元 + 就业' + (F.PAYEMS_CHG && F.PAYEMS_CHG.v < 50 ? '失速→需求担忧+2' : '未失速') + '</td><td>AI电力资本开支 + 矿紧 + 中国PMI' + f1(F.EM_CN_PMI_MFG && F.EM_CN_PMI_MFG.v) + '</td><td>' + reading(m.copper) + '</td></tr>' +
    '</table><p style="font-size:11.5px;color:var(--dim);margin:8px 0 0;">' + stamp() + ' · ⚙️评分为规则化量化（每项0-10），输入全部来自本报告L1/L2数据，打分公式见本文件注释</p></div></div></div>';
  return h;
}

/* ============================================================================
   ⑦ 美元-美股-美债 三角稳定评分（0-100，五腿各20）
   规则：美债秩序(MOVE/10Y/期限溢价30日变动/30Y) 美股秩序(VIX/信用利差/标普20日)
        美元秩序(USDJPY/DXY5日波动) 流动性缓冲(SOFR-IORB/RRP/SRF) 政策可信度(盈亏平衡5日变动/NFCI/2Y5日)
   ============================================================================ */
function triangle() {
  var F = facts(), legs = [];
  /* 美债秩序 */
  var s1 = 20, n1 = [];
  if (F.Y_MOVE) { if (F.Y_MOVE.v >= 90) { s1 -= 6; n1.push('MOVE ' + f1(F.Y_MOVE.v) + '破90(-6)'); } else if (F.Y_MOVE.v >= 80) { s1 -= 3; n1.push('MOVE ' + f1(F.Y_MOVE.v) + '偏高(-3)'); } else n1.push('MOVE ' + f1(F.Y_MOVE.v) + '低位'); }
  if (F.DGS10) { if (F.DGS10.v >= 4.9) { s1 -= 5; n1.push('10Y ' + f2(F.DGS10.v) + '%破4.90(-5)'); } else if (F.DGS10.v >= 4.7) { s1 -= 2; n1.push('10Y ' + f2(F.DGS10.v) + '%高位(-2)'); } else n1.push('10Y ' + f2(F.DGS10.v) + '%'); }
  var tp30 = chgN(F.ACMTP10, 22);
  if (tp30 != null && tp30 >= 0.2) { s1 -= 3; n1.push('期限溢价月+' + f2(tp30) + 'pt急升(-3)'); } else if (F.ACMTP10) n1.push('期限溢价' + f2(F.ACMTP10.v) + '%');
  if (F.DGS30 && F.DGS30.v >= 5.3) { s1 -= 2; n1.push('30Y ' + f2(F.DGS30.v) + '%(-2)'); }
  s1 = Math.max(0, s1);
  legs.push(['美债秩序', s1, n1.join('；'), '10Y破4.90%且MOVE破90 → 直接扣到5以下']);
  /* 美股秩序 */
  var s2 = 20, n2 = [];
  if (F.VIXCLS) { if (F.VIXCLS.v >= 20) { s2 -= 5; n2.push('VIX ' + f2(F.VIXCLS.v) + '≥20(-5)'); } else if (F.VIXCLS.v >= 18) { s2 -= 2; n2.push('VIX ' + f2(F.VIXCLS.v) + '(-2)'); } else n2.push('VIX ' + f2(F.VIXCLS.v) + '（' + f0(F.VIXCLS.pctile) + '分位）'); }
  if (F.BAMLC0A4CBBB) { if (F.BAMLC0A4CBBB.v >= 1.2) { s2 -= 5; n2.push('信用利差' + f2(F.BAMLC0A4CBBB.v) + '%破线(-5)'); } else if (F.BAMLC0A4CBBB.pctile < 10) { s2 -= 2; n2.push('利差' + f2(F.BAMLC0A4CBBB.v) + '%极度自满=没缓冲(-2)'); } else n2.push('利差' + f2(F.BAMLC0A4CBBB.v) + '%'); }
  var spx20 = pctN(F.Y_GSPC, 20);
  if (spx20 != null && spx20 <= -3) { s2 -= 3; n2.push('标普20日' + pct1(spx20) + '(-3)'); } else if (spx20 != null) n2.push('标普20日' + pct1(spx20));
  s2 = Math.max(0, s2);
  legs.push(['美股秩序', s2, n2.join('；'), '信用利差破1.20%且VIX破18（证伪雷达同线）']);
  /* 美元秩序 */
  var s3 = 20, n3 = [];
  if (F.Y_USDJPY) { if (F.Y_USDJPY.v >= 158) { s3 -= 5; n3.push('USDJPY ' + f2(F.Y_USDJPY.v) + '干预雷区(-5)'); } else if (F.Y_USDJPY.v >= 155) { s3 -= 3; n3.push('USDJPY ' + f2(F.Y_USDJPY.v) + '贴雷区(-3)'); } else n3.push('USDJPY ' + f2(F.Y_USDJPY.v)); }
  var dxy5 = pctN(F.Y_DXY, 5);
  if (dxy5 != null && Math.abs(dxy5) >= 1.5) { s3 -= 3; n3.push('DXY 5日' + pct1(dxy5) + '波动过大(-3)'); } else if (dxy5 != null) n3.push('DXY 5日' + pct1(dxy5) + '有序');
  s3 = Math.max(0, s3);
  legs.push(['美元秩序', s3, n3.join('；'), '日本干预落地→DXY单日波动>1.5%']);
  /* 流动性缓冲 */
  var s4 = 20, n4 = [];
  if (F.SPR_SOFR_IORB) { if (F.SPR_SOFR_IORB.v >= 10) { s4 -= 6; n4.push('SOFR-IORB ' + bpRaw(F.SPR_SOFR_IORB.v) + '(-6)'); } else if (F.SPR_SOFR_IORB.v >= 5) { s4 -= 3; n4.push('SOFR-IORB ' + bpRaw(F.SPR_SOFR_IORB.v) + '偏高(-3)'); } else n4.push('SOFR-IORB ' + bpRaw(F.SPR_SOFR_IORB.v)); }
  if (F.RRPONTSYD) { if (F.RRPONTSYD.v < 20) { s4 -= 4; n4.push('ON RRP仅' + f2(F.RRPONTSYD.v) + '十亿$=缓冲垫耗尽(-4)'); } else n4.push('RRP ' + f2(F.RRPONTSYD.v) + '十亿$'); }
  if (F.LIQ_SRF && F.LIQ_SRF.v > 10) { s4 -= 3; n4.push('SRF用量' + f1(F.LIQ_SRF.v) + '(-3)'); }
  s4 = Math.max(0, s4);
  legs.push(['流动性缓冲', s4, n4.join('；'), 'SOFR-IORB破10bp或SRF异常放量']);
  /* 政策可信度 */
  var s5 = 20, n5 = [];
  var be5 = chgN(F.T5YIFR, 5);
  if (be5 != null && Math.abs(be5) >= 0.15) { s5 -= 4; n5.push('5y5y通胀预期5日' + bp(be5) + '失锚(-4)'); } else if (F.T5YIFR) n5.push('5y5y ' + f2(F.T5YIFR.v) + '%锚定');
  var d25 = chgN(F.DGS2, 5);
  if (d25 != null && Math.abs(d25) >= 0.15) { s5 -= 3; n5.push('2Y 5日' + bp(d25) + '预期剧烈摇摆(-3)'); } else if (d25 != null) n5.push('2Y 5日' + bp(d25));
  if (F.NFCI && F.NFCI.v > -0.3) { s5 -= 3; n5.push('NFCI ' + f2(F.NFCI.v) + '金融条件收紧(-3)'); } else if (F.NFCI) n5.push('NFCI ' + f2(F.NFCI.v) + '宽松');
  s5 = Math.max(0, s5);
  legs.push(['政策可信度', s5, n5.join('；'), '点阵图与市场定价背离>30bp']);
  var total = s1 + s2 + s3 + s4 + s5;
  var zone = total >= 70 ? '稳态扩张' : total >= 55 ? '正常波动' : total >= 40 ? '脆弱平衡区' : total >= 25 ? '失序边缘' : '危机';
  var h = '<div class="card"><p style="font-size:14px;margin:0 0 4px;"><b style="color:var(--gold)">当前评分：' + total + ' / 100 —— ' + zone + '</b><span style="font-size:11px;color:var(--dim);">（≥70稳态扩张 · 55-70正常波动 · 40-54脆弱平衡 · &lt;40失序边缘 · &lt;25危机）· 数据日 ' + F.asof + '</span></p>';
  h += '<table style="font-size:12px;margin-top:8px;"><tr><th>腿</th><th style="width:70px;">得分/20</th><th>评分依据（⚙️规则自动分解）</th><th>失序警报线</th></tr>';
  legs.forEach(function (L) {
    h += '<tr><td><b>' + L[0] + '</b></td><td class="' + (L[1] <= 10 ? 'dn' : '') + '"><b>' + L[1] + '</b></td><td>' + L[2] + '</td><td>' + L[3] + '</td></tr>';
  });
  h += '</table><p style="font-size:11px;color:var(--dim);margin:8px 0 0;">' + stamp() + ' · 五腿各20分，扣分规则见lib/conclusion_engine.js注释，随数据每日重算</p></div>';
  return h;
}

/* ============================================================================
   ⑧ 债市结论 + 债市看板（dp12）
   ============================================================================ */
function bondConclusion() {
  var F = facts();
  var realDrive = F.DFII10 && F.T10YIE && chgN(F.DFII10, 5) != null && chgN(F.T10YIE, 5) != null &&
    Math.abs(chgN(F.DFII10, 5)) > Math.abs(chgN(F.T10YIE, 5));
  var h = '<div class="card"><p style="font-size:13px;margin:0 0 6px;"><b style="color:var(--gold)">债市结论（⚙️' + F.asof + ' 自动生成）</b>：<b>' +
    (realDrive ? '本轮名义10Y变动仍由"实际利率"主导，而非通胀恐慌——盈亏平衡相对平稳。' : '近期通胀预期与实际利率同向波动，定价"财政供给+政策高位"的混合压力。') + '</b></p>';
  h += '<ul style="margin:0;padding-left:20px;font-size:12.5px;line-height:1.85;">';
  h += '<li><b>结构拆解</b>：10Y名义 ' + f2(F.DGS10 && F.DGS10.v) + '%（' + (F.DGS10 ? F.DGS10.d : '') + '，' + bp(F.DGS10 && F.DGS10.chg) + '）= 实际利率 ' + f2(F.DFII10 && F.DFII10.v) + '%（' + f0(F.DFII10 && F.DFII10.pctile) +
    '分位，5日' + bp(chgN(F.DFII10, 5)) + '）+ 盈亏平衡 ' + f2(F.T10YIE && F.T10YIE.v) + '%（5日' + bp(chgN(F.T10YIE, 5)) + '）；期限溢价ACM ' + f2(F.ACMTP10 && F.ACMTP10.v) + '%（月变动' + pp(chgN(F.ACMTP10, 22)) + 'pt）。</li>';
  h += '<li><b>曲线</b>：10Y-2Y ' + bp(F.T10Y2Y && F.T10Y2Y.v) + '（5日' + bp(chgN(F.T10Y2Y, 5)) + '）、10Y-3M ' + bp(F.T10Y3M && F.T10Y3M.v) + '；30Y ' + f2(F.DGS30 && F.DGS30.v) + '%——' +
    (F.T10Y2Y && F.T10Y2Y.v > 0.3 ? '陡峭化结构延续。' : '曲线走平，2Y随政策预期领涨。') + '</li>';
  h += '<li><b>需求端</b>：拍卖投标倍数 2Y ' + f2(F.US_AUC_2Y_BTC && F.US_AUC_2Y_BTC.v) + ' / 10Y ' + f2(F.US_AUC_10Y_BTC && F.US_AUC_10Y_BTC.v) + ' / 30Y ' + f2(F.US_AUC_30Y_BTC && F.US_AUC_30Y_BTC.v) +
    '；TIC日本持债 ' + f0(F.JP_UST_HOLD && F.JP_UST_HOLD.v) + '十亿$（' + (F.JP_UST_HOLD ? F.JP_UST_HOLD.d : '—') + '）、中国 ' + f0(F.CN_UST_HOLD && F.CN_UST_HOLD.v) + '；CFTC净空仓 10Y ' + wan(F.CFTC_TY_NET && F.CFTC_TY_NET.v) +
    '手 / 2Y ' + wan(F.CFTC_TU_NET && F.CFTC_TU_NET.v) + '手 / 超长债 ' + wan(F.CFTC_US_NET && F.CFTC_US_NET.v) + '手——' +
    (F.CFTC_TY_NET && F.CFTC_TY_NET.pctile < 15 ? '极端空头区，反弹燃料在积累。' : '空头未极端。') + '</li>';
  h += '<li><b>全球共振</b>：中债10Y ' + f2(F.EM_CGB10Y && F.EM_CGB10Y.v) + '%，中美利差 ' + (F.spUSCN != null ? '-' + f0(Math.abs(F.spUSCN) * 100) + 'bp' : '—') + '——债市无孤岛。</li>';
  h += '<li><b>升级/降级线</b>：10Y名义破4.90%或MOVE（现' + f1(F.Y_MOVE && F.Y_MOVE.v) + '）破90 → "有序重定价"转"无序抛售"；若FOMC转鸽 → 极端空仓回补触发快速下行。</li>';
  return h + '</ul><p style="font-size:11px;color:var(--dim);margin:8px 0 0;">' + stamp() + '</p></div>';
}
function bondBoard() {
  var F = facts();
  function row(tag, name, val, chgTxt, chgCls, note, badge) {
    return '<tr><td><b>' + tag + '</b></td><td style="text-align:left">' + name + '</td><td style="text-align:right;"><b>' + val + '</b></td><td class="' + chgCls + '" style="text-align:right;">' + chgTxt + '</td><td>' + note + '</td><td><span class="badge ' + (badge || 'b1') + '">' + (badge === 'b2' ? 'L2' : 'L1') + '</span></td></tr>';
  }
  var h = '<div class="card" style="margin-top:12px;"><p style="font-size:13px;margin:0 0 8px;"><b style="color:var(--gold)">债市看板</b><span style="font-size:11px;color:var(--dim);">（⚙️自动 · 数据日 ' + F.asof + '；官方序列有1-4日滞后）</span></p><table>';
  h += '<tr><th>板块</th><th style="text-align:left">指标</th><th style="text-align:right">最新</th><th style="text-align:right">日变动</th><th>数据日/说明</th><th></th></tr>';
  h += row('美债名义', '10Y收益率', f2(F.DGS10 && F.DGS10.v) + '%', bp(F.DGS10 && F.DGS10.chg), cls(F.DGS10 && F.DGS10.chg, true), (F.DGS10 ? F.DGS10.d : '') + ' FRED');
  h += row('美债名义', '30Y收益率', f2(F.DGS30 && F.DGS30.v) + '%', bp(F.DGS30 && F.DGS30.chg), cls(F.DGS30 && F.DGS30.chg, true), (F.DGS30 ? F.DGS30.d : ''));
  h += row('美债名义', '2Y收益率', f2(F.DGS2 && F.DGS2.v) + '%', bp(F.DGS2 && F.DGS2.chg), cls(F.DGS2 && F.DGS2.chg, true), (F.DGS2 ? F.DGS2.d : ''));
  h += row('美债名义', '10Y-2Y / 10Y-3M', bp(F.T10Y2Y && F.T10Y2Y.v) + ' / ' + bp(F.T10Y3M && F.T10Y3M.v), bp(chgN(F.T10Y2Y, 1)), 'flat', '利差');
  h += row('实际利率', '10Y TIPS实际利率', f2(F.DFII10 && F.DFII10.v) + '%', bp(F.DFII10 && F.DFII10.chg), cls(F.DFII10 && F.DFII10.chg, true), f0(F.DFII10 && F.DFII10.pctile) + '分位 · ' + (F.DFII10 ? F.DFII10.d : ''));
  h += row('通胀预期', '5Y/10Y盈亏平衡', f2(F.T5YIE && F.T5YIE.v) + '% / ' + f2(F.T10YIE && F.T10YIE.v) + '%', bp(chgN(F.T10YIE, 1)), 'flat', '通胀预期' + (F.T10YIE && F.T10YIE.pctile < 60 ? '锚定' : '升温'));
  h += row('通胀预期', '5y5y远期 / 期限溢价ACM', f2(F.T5YIFR && F.T5YIFR.v) + '% / ' + f2(F.ACMTP10 && F.ACMTP10.v) + '%', pp(chgN(F.ACMTP10, 22)) + 'pt/月', 'flat', (F.ACMTP10 ? F.ACMTP10.d : ''));
  h += row('信用', '信用利差(BBB站口径)', f2(F.BAMLC0A4CBBB && F.BAMLC0A4CBBB.v) + '%', bp(F.BAMLC0A4CBBB && F.BAMLC0A4CBBB.chg), cls(F.BAMLC0A4CBBB && F.BAMLC0A4CBBB.chg, true), f0(F.BAMLC0A4CBBB && F.BAMLC0A4CBBB.pctile) + '分位 · 线1.20%');
  h += row('信用', '高收益债OAS', f2(F.BAMLH0A0HYM2 && F.BAMLH0A0HYM2.v) + '%', bp(F.BAMLH0A0HYM2 && F.BAMLH0A0HYM2.chg), cls(F.BAMLH0A0HYM2 && F.BAMLH0A0HYM2.chg, true), f0(F.BAMLH0A0HYM2 && F.BAMLH0A0HYM2.pctile) + '分位');
  h += row('波动率', 'MOVE（债市恐慌指数）', f1(F.Y_MOVE && F.Y_MOVE.v), pp(F.Y_MOVE && F.Y_MOVE.chg), cls(F.Y_MOVE && F.Y_MOVE.chg, true), f0(F.Y_MOVE && F.Y_MOVE.pctile) + '分位', 'b2');
  h += row('供给·需求', '拍卖投标倍数 2Y/10Y/30Y', f2(F.US_AUC_2Y_BTC && F.US_AUC_2Y_BTC.v) + ' / ' + f2(F.US_AUC_10Y_BTC && F.US_AUC_10Y_BTC.v) + ' / ' + f2(F.US_AUC_30Y_BTC && F.US_AUC_30Y_BTC.v), '—', 'flat', '财政部月度');
  h += row('供给·需求', 'TIC外资持仓 日本/中国', f0(F.JP_UST_HOLD && F.JP_UST_HOLD.v) + ' / ' + f0(F.CN_UST_HOLD && F.CN_UST_HOLD.v) + '十亿$', (F.JP_UST_HOLD ? pp(F.JP_UST_HOLD.chg) : '—'), cls(F.JP_UST_HOLD && F.JP_UST_HOLD.chg), (F.JP_UST_HOLD ? F.JP_UST_HOLD.d : ''));
  h += row('头寸', 'CFTC净空仓 10Y/2Y/超长债', wan(F.CFTC_TY_NET && F.CFTC_TY_NET.v) + ' / ' + wan(F.CFTC_TU_NET && F.CFTC_TU_NET.v) + ' / ' + wan(F.CFTC_US_NET && F.CFTC_US_NET.v) + '手', (F.CFTC_TY_NET ? wan(F.CFTC_TY_NET.chg) : '—'), 'flat', (F.CFTC_TY_NET ? F.CFTC_TY_NET.d : '') + ' CFTC');
  h += row('全球', '中债10Y / 中美利差', f2(F.EM_CGB10Y && F.EM_CGB10Y.v) + '% / ' + (F.spUSCN != null ? '-' + f0(Math.abs(F.spUSCN) * 100) + 'bp' : '—'), bp(F.EM_CGB10Y && F.EM_CGB10Y.chg), cls(F.EM_CGB10Y && F.EM_CGB10Y.chg, true), (F.EM_CGB10Y ? F.EM_CGB10Y.d : ''), 'b2');
  return h + '</table><p style="font-size:11px;color:var(--dim);margin:8px 0 0;">' + stamp() + '</p></div>';
}

/* ============================================================================
   ⑨ 美国资产象限裁决（dp12）
   ============================================================================ */
function usQuad() {
  var F = facts(), q = quadrant(F);
  var h = '<div class="card" style="margin-top:14px;border-color:var(--gold);"><p style="font-size:13px;margin:0 0 8px;"><b style="color:var(--gold)">美国资产象限裁决（⚙️' + F.asof + ' 自动生成）</b><span style="font-size:11px;color:var(--dim);"> 美股 × 美债 × 美元 → 四象限定性，映射本框架中心矛盾</span></p>';
  h += '<table><tr><th>资产</th><th style="text-align:right;">最新交易日表现</th><th>方向</th></tr>';
  h += '<tr><td>美股（标普500）</td><td style="text-align:right;"><b>' + f0(F.Y_GSPC && F.Y_GSPC.v) + '（' + pct1(F.Y_GSPC && F.Y_GSPC.pct) + '）</b></td><td class="' + (q.stockUp ? 'up' : 'dn') + '">' + (q.stockUp == null ? '—' : q.stockUp ? '涨' : '跌') + '</td></tr>';
  h += '<tr><td>美债（10Y收益率）</td><td style="text-align:right;"><b>' + f2(F.DGS10 && F.DGS10.v) + '%（' + bp(F.DGS10 && F.DGS10.chg) + '）</b></td><td class="' + (q.bondUp ? 'up' : 'dn') + '">' + (q.bondUp == null ? '—' : q.bondUp ? '涨（收益率降）' : '跌（收益率升）') + '</td></tr>';
  h += '<tr><td>美元（DXY）</td><td style="text-align:right;"><b>' + f2(F.Y_DXY && F.Y_DXY.v) + '（' + pct1(F.Y_DXY && F.Y_DXY.pct) + '）</b></td><td class="' + (q.dxyUp ? 'up' : 'dn') + '">' + (q.dxyUp == null ? '—' : q.dxyUp ? '强' : '弱') + '</td></tr></table>';
  h += '<p style="font-size:12.5px;margin:10px 0 6px;line-height:1.8;">四象限定位：<b>股涨债涨美元弱=宽松交易 ｜ 股跌债涨=衰退交易 ｜ 股涨债跌美元强=增长/软着陆 ｜ 股跌债跌美元强=滞胀紧缩（现金为王）</b></p>';
  h += '<p style="font-size:13px;margin:0 0 6px;"><b style="color:#e5534b;">当前象限：' + q.name + '。</b>' + q.desc + '。</p>';
  h += '<ul style="margin:0;padding-left:20px;font-size:12.5px;line-height:1.85;">';
  var aWin = F.DFII10 && F.Y_GOLD && F.DFII10.v >= 2.45 && F.Y_GOLD.v < 4520;
  h += '<li><b>框架映射</b>：' + (q.name.indexOf('滞胀') >= 0 ? '该象限=A端全面兑现区——对各类资产的典型压制顺序为金→债→股。' :
    q.name.indexOf('衰退') >= 0 ? '该象限=紧缩叙事退潮、避险升温——黄金与美债先受益。' :
    q.name.indexOf('宽松') >= 0 ? '该象限=B端友好区——实物资产与风险资产同涨。' :
    q.name.indexOf('增长') >= 0 ? '该象限=软着陆定价——股强金弱，A端暂退。' : '信号混杂，等下一个数据裁决。') + '</li>';
  h += '<li><b>联合阈值</b>：A端官宣线=实际利率≥2.45%且金&lt;4520 → ' + (aWin ? '<b style="color:#e5534b">已满足（实际利率' + f2(F.DFII10.v) + '%、金' + f0(F.Y_GOLD.v) + '）</b>' : '未同时满足') + '；B端翻盘线=DXY&lt;98.5且金&gt;4700 → 未满足。</li>';
  h += '<li><b>象限切换信号（事前冻结）</b>：DXY回落至98.5下方 + 10Y名义止升 → 切向"衰退交易"（股跌债涨），届时黄金先受益；反之10Y破4.90%+VIX破18 → 深化为"无序抛售"，全面降风险。</li>';
  return h + '</ul><p style="font-size:11px;color:var(--dim);margin:8px 0 0;">' + stamp() + '</p></div>';
}

/* ============================================================================
   ⑩ 外汇结论 + 外汇看板（dp13）
   ============================================================================ */
function fxConclusion() {
  var F = facts();
  var dxy20 = pctN(F.Y_DXY, 20);
  var h = '<div class="card"><p style="font-size:13px;margin:0 0 6px;"><b style="color:var(--gold)">外汇结论（⚙️' + F.asof + ' 自动生成）</b>：<b>' +
    (dxy20 != null && dxy20 > 0.5 ? '美元处"紧缩型走强"——靠息差而非避险，与美债收益率同向同因。' :
     dxy20 != null && dxy20 < -0.5 ? '美元走弱——若伴随债涨则属"宽松/衰退交易"定价。' : '美元横盘，等待政策或数据破局。') + '</b></p>';
  h += '<ul style="margin:0;padding-left:20px;font-size:12.5px;line-height:1.85;">';
  h += '<li><b>美元</b>：DXY ' + f2(F.Y_DXY && F.Y_DXY.v) + '（20日' + pct1(dxy20) + '），广义贸易加权 ' + f2(F.DTWEXBGS && F.DTWEXBGS.v) + '；CFTC美元净多 ' + wan(F.CFTC_DX_NET && F.CFTC_DX_NET.v) + '手（' + f0(F.CFTC_DX_NET && F.CFTC_DX_NET.pctile) + '分位）——' +
    (F.CFTC_DX_NET && F.CFTC_DX_NET.pctile > 80 ? '多头拥挤，追高风险大。' : '多头不拥挤，走强尚有持续性空间。') + '</li>';
  h += '<li><b>日元</b>：USDJPY ' + f2(F.Y_USDJPY && F.Y_USDJPY.v) + '；CFTC日元净' + wan(F.CFTC_JY_NET && F.CFTC_JY_NET.v) + '手——' +
    (F.Y_USDJPY && F.Y_USDJPY.v >= 155 ? '<b style="color:#e5534b">已在干预雷区（155+）</b>，警惕官方干预制造的波动。' : '日美利差主导定价，市场不信日央行能追上。') + '</li>';
  h += '<li><b>欧元</b>：EURUSD ' + f2(F.Y_EURUSD && F.Y_EURUSD.v) + '（20日' + pct1(pctN(F.Y_EURUSD, 20)) + '）——随美元被动波动。</li>';
  h += '<li><b>人民币</b>：USDCNY ' + f2(F.DEXCHUS && F.DEXCHUS.v) + '（' + (F.DEXCHUS ? F.DEXCHUS.d : '—') + '）；中美利差 ' + (F.spUSCN != null ? '-' + f0(Math.abs(F.spUSCN) * 100) + 'bp' : '—') + '——' +
    (F.spUSCN != null && F.spUSCN > 3 ? '利差压力极大，靠购金储备+结汇盘维持稳态；DXY若破102，贬值压力测试升级。' : '利差压力可控。') + '</li>';
  h += '<li><b>美元微笑定位</b>：当前处微笑' + (dxy20 != null && dxy20 > 0.5 ? '<b>右端</b>（美国紧缩+全球承压→美元强）；若非农再度失速，微笑切至<b>左端</b>（衰退避险）——美元仍强但驱动从"息差"换成"避险"，届时美债与金先于美元转向。' : '<b>中段</b>（方向未定），非农/CPI决定滑向哪一端。') + '</li>';
  return h + '</ul><p style="font-size:11px;color:var(--dim);margin:8px 0 0;">' + stamp() + '</p></div>';
}
function fxBoard() {
  var F = facts();
  function row(tag, name, val, chgTxt, chgCls, note, badge) {
    return '<tr><td><b>' + tag + '</b></td><td style="text-align:left">' + name + '</td><td style="text-align:right;"><b>' + val + '</b></td><td class="' + chgCls + '" style="text-align:right;">' + chgTxt + '</td><td>' + note + '</td><td><span class="badge ' + (badge || 'b1') + '">' + (badge === 'b2' ? 'L2' : 'L1') + '</span></td></tr>';
  }
  var h = '<div class="card" style="margin-top:12px;"><p style="font-size:13px;margin:0 0 8px;"><b style="color:var(--gold)">外汇看板</b><span style="font-size:11px;color:var(--dim);">（⚙️自动 · 数据日 ' + F.asof + '）</span></p><table>';
  h += '<tr><th>板块</th><th style="text-align:left">指标</th><th style="text-align:right">最新</th><th style="text-align:right">日变动</th><th>数据日/说明</th><th></th></tr>';
  h += row('美元', '美元指数DXY', f2(F.Y_DXY && F.Y_DXY.v), pct1(F.Y_DXY && F.Y_DXY.pct), cls(F.Y_DXY && F.Y_DXY.pct, true), (F.Y_DXY ? F.Y_DXY.d : ''), 'b2');
  h += row('美元', '广义贸易加权美元', f2(F.DTWEXBGS && F.DTWEXBGS.v), pp(F.DTWEXBGS && F.DTWEXBGS.chg), cls(F.DTWEXBGS && F.DTWEXBGS.chg, true), f0(F.DTWEXBGS && F.DTWEXBGS.pctile) + '分位');
  h += row('日元', 'USDJPY', f2(F.Y_USDJPY && F.Y_USDJPY.v), pp(F.Y_USDJPY && F.Y_USDJPY.chg), cls(F.Y_USDJPY && F.Y_USDJPY.chg, true), F.Y_USDJPY && F.Y_USDJPY.v >= 155 ? '干预雷区⚠' : (F.Y_USDJPY ? F.Y_USDJPY.d : ''), 'b2');
  h += row('日元', 'CFTC日元净持仓', wan(F.CFTC_JY_NET && F.CFTC_JY_NET.v) + '手', wan(F.CFTC_JY_NET && F.CFTC_JY_NET.chg), 'flat', (F.CFTC_JY_NET ? F.CFTC_JY_NET.d : ''));
  h += row('欧元', 'EURUSD', f2(F.Y_EURUSD && F.Y_EURUSD.v), pct1(F.Y_EURUSD && F.Y_EURUSD.pct), cls(F.Y_EURUSD && F.Y_EURUSD.pct), (F.Y_EURUSD ? F.Y_EURUSD.d : ''), 'b2');
  h += row('人民币', '在岸USDCNY', f2(F.DEXCHUS && F.DEXCHUS.v), pp(F.DEXCHUS && F.DEXCHUS.chg), 'flat', (F.DEXCHUS ? F.DEXCHUS.d : ''), 'b2');
  h += row('人民币', '中美10Y利差', F.spUSCN != null ? '-' + f0(Math.abs(F.spUSCN) * 100) + 'bp' : '—', '—', 'flat', '美' + f2(F.DGS10 && F.DGS10.v) + '% - 中' + f2(F.EM_CGB10Y && F.EM_CGB10Y.v) + '%');
  h += row('头寸', 'CFTC美元净多', wan(F.CFTC_DX_NET && F.CFTC_DX_NET.v) + '手', wan(F.CFTC_DX_NET && F.CFTC_DX_NET.chg), 'flat', f0(F.CFTC_DX_NET && F.CFTC_DX_NET.pctile) + '分位');
  return h + '</table><p style="font-size:11px;color:var(--dim);margin:8px 0 0;">' + stamp() + '</p></div>';
}

/* ============================================================================
   ⑪ 周报用：中心矛盾动态卡 / 资产周表现表 / 下周闸门
   ============================================================================ */
function weeklyOv() {
  var F = facts();
  var aWin = F.DFII10 && F.Y_GOLD && F.DFII10.v >= 2.45 && F.Y_GOLD.v < 4520;
  var h = '<div class="card"><p style="font-size:13px;margin:0;"><b style="color:var(--gold);">中心矛盾（⚙️' + F.asof + ' 动态）：A端</b>（财政主导+通胀黏性 → 实际利率与美元高位）<b style="color:var(--gold);">vs B端</b>（央行购金+矿紧+AI电力资本开支 → 实物资产重估）。联合阈值规则下——金' +
    (F.Y_GOLD && F.Y_GOLD.v < 4520 ? '破4520✅（现' + f0(F.Y_GOLD.v) + '）' : '未破❌（现' + f0(F.Y_GOLD && F.Y_GOLD.v) + '）') + '、10Y实际利率' +
    (F.DFII10 && F.DFII10.v >= 2.45 ? '破2.45%✅（现' + f2(F.DFII10.v) + '%）' : '未破❌（现' + f2(F.DFII10 && F.DFII10.v) + '%）') + '——<b>' +
    (aWin ? '两条件同时满足，按0902规则宣告A端成立' : '未同时满足，不宣告A胜，观点不跨零直翻') + '</b>。<span style="font-size:11px;color:var(--dim);">' + stamp() + '</span></p></div>';
  return h;
}
function weeklyTable() {
  var F = facts();
  function wk(s) { return pctN(s, 5); }
  function row(name, s, unit, dec, invertColor, note) {
    if (!s) return '';
    var w = wk(s);
    return '<tr><td>' + name + '</td><td>' + (dec === 0 ? f0(s.v) : f2(s.v)) + (unit || '') + '</td><td class="' + cls(s.pct, invertColor) + '">' + pct1(s.pct) + '</td><td class="' + cls(w, invertColor) + '">周' + pct1(w) + '</td><td>' + (note || '') + '</td></tr>';
  }
  var h = '<table><tr><th>资产</th><th>最新</th><th>最新交易日</th><th>近5交易日</th><th>一句话</th></tr>';
  h += row('标普500', F.Y_GSPC, '', 0, false, F.VIXCLS && F.VIXCLS.v < 18 ? '紧缩未传导为risk-off' : '波动率抬头');
  h += row('纳斯达克', F.Y_IXIC, '', 0, false, '');
  h += row('美债10Y', F.DGS10, '%', 2, true, F.DGS10 && F.DGS10.v >= 4.9 ? '破4.90%警报线' : '高位');
  h += row('美债30Y', F.DGS30, '%', 2, true, F.DGS30 && F.DGS30.v >= 5.3 ? '5.3%关口上方' : '');
  h += row('美债2Y', F.DGS2, '%', 2, true, '政策预期温度计');
  h += row('COMEX黄金', F.Y_GOLD, '', 0, false, F.Y_GOLD && F.Y_GOLD.v < 4520 ? '4520线下方' : '4520上方');
  h += row('COMEX白银', F.Y_SLV, '', 2, false, '跟随黄金，弹性更大');
  h += row('WTI原油', F.DCOILWTICO, '', 2, false, pctN(F.DCOILWTICO, 5) > 3 ? '供给冲击定价' : '');
  h += row('美元指数DXY', F.Y_DXY, '', 2, true, pctN(F.Y_DXY, 5) > 0.3 ? '鹰派定价' : '');
  return h + '</table><p style="font-size:11px;color:var(--dim);margin:6px 0 0;">' + stamp() + ' · 板块正文为当周人工存档，最新数据以本表与图表为准</p>';
}
function weeklyNext() {
  var F = facts();
  var h = '<div class="card"><p style="font-size:13px;margin:0 0 6px;"><b style="color:var(--gold);">下周闸门与证伪清单（⚙️' + F.asof + ' 自动）</b></p>';
  h += '<p style="font-size:12.5px;line-height:1.85;margin:0;">';
  h += '<b style="color:var(--gold);">发布规律：</b>非农=每月首个周五20:30（冬令21:30）；CPI=每月10-13日20:30；PPI=CPI前后一日；PCE=每月末。具体日期见上方宏观日历。<br>';
  h += '<b style="color:var(--gold);">证伪雷达（周度）：</b>';
  h += '①A端：实际利率≥2.45%且金&lt;4520 → 当前' + f2(F.DFII10 && F.DFII10.v) + '%/' + f0(F.Y_GOLD && F.Y_GOLD.v) + '，' +
    ((F.DFII10 && F.DFII10.v >= 2.45 && F.Y_GOLD && F.Y_GOLD.v < 4520) ? '<b style="color:#e5534b">已触发</b>' : '未触发') + '；';
  h += '②美股risk-on：信用利差≥1.20%且VIX≥18 → 当前' + f2(F.BAMLC0A4CBBB && F.BAMLC0A4CBBB.v) + '%/' + f2(F.VIXCLS && F.VIXCLS.v) + '，' +
    ((F.BAMLC0A4CBBB && F.BAMLC0A4CBBB.v >= 1.2 && F.VIXCLS && F.VIXCLS.v >= 18) ? '已触发' : '未触发') + '；';
  h += '③曲线走陡：10Y-2Y&lt;20bp → 当前' + bp(F.T10Y2Y && F.T10Y2Y.v) + '；';
  h += '④债市失序：10Y≥4.90%且MOVE≥90 → 当前' + f2(F.DGS10 && F.DGS10.v) + '%/' + f1(F.Y_MOVE && F.Y_MOVE.v) + '。</p>';
  return h + '<p style="font-size:11px;color:var(--dim);margin:8px 0 0;">' + stamp() + '</p></div>';
}

/* ============================================================================
   单序列一句话结论（图表区：每个选中指标按钮自动配一条规则结论）
   规则公开：①近3年分位定水位 ②周(5点)/月(21点)变动定方向 ③THRESH关键阈值表
   （阈值源自0902面板证伪体系及常用宏观经验线，全部写死在下表，可审计）
   ============================================================================ */
var THRESH = {
  VIXCLS: function (v) { return v >= 25 ? '≥25＝恐慌区，风险资产承压' : v >= 18 ? '≥18＝风险预算收紧线（0902体系·风偏开启条件之一）' : v <= 14 ? '≤14＝极度平静，警惕自满回吐' : '平静区（14–18）'; },
  Y_MOVE: function (v) { return v >= 90 ? '≥90＝债市失序警戒线（叠加10Y≥4.90%即触发）' : v >= 75 ? '接近90失序线，留意' : '低于90失序线，债市波动可控'; },
  EDB_GLB_MOVE: function (v) { return THRESH.Y_MOVE(v); },
  MOVE_X: function (v) { return THRESH.Y_MOVE(v); },
  BAMLC0A4CBBB: function (v) { return v >= 5 ? '≥5%＝信用压力显性化' : v >= 4 ? '利差走阔，信用风险升温' : v <= 3 ? '≤3%＝利差收窄，风偏健康' : '中性区（3–4%）'; },
  BAMLH0A0HYM2: function (v) { return THRESH.BAMLC0A4CBBB(v); },
  BAMLH0A0HYM2EY: function (v) { return v >= 9 ? '高收益收益率≥9%＝融资环境苛刻' : v >= 7.5 ? '偏高' : '温和'; },
  DFII10: function (v) { return v >= 2.45 ? '≥2.45%＝触及A端确认线（实际利率高位压制金）' : v >= 2.0 ? '2%上方高位区' : '温和区'; },
  DGS10: function (v) { return v >= 4.9 ? '≥4.90%＝触及债市失序线（0902体系）' : v >= 4.5 ? '4.5%上方高位区' : v <= 3.5 ? '低位区' : '常态波动区'; },
  DGS2: function (v) { return v >= 5 ? '≥5%＝政策预期极度紧缩' : '—'; },
  T10Y2Y: function (v) { return v < 0 ? '倒挂＝衰退信号' : v < 0.2 ? '<20bp＝贴近倒挂线（0902曲线观察线）' : v > 1 ? '>100bp＝陡峭化（再通胀/财政供给定价）' : '正常区间'; },
  T10Y3M: function (v) { return v < 0 ? '倒挂（联储最关注的衰退曲线）' : '正斜率'; },
  T5YIE: function (v) { return v >= 3 ? '≥3%＝通胀预期脱锚风险区' : v >= 2.5 ? '偏高，留意通胀黏性' : v <= 2 ? '≤2%＝锚定良好' : '锚定区（2–2.5%）'; },
  SPR_SOFR_IORB: function (v) { return v >= 10 ? '≥+10bp＝触及流动性预警线（0902体系·钱荒信号）' : v >= 5 ? '偏高，留意准备金边际' : '走廊内正常'; },
  SOFR: function (v, o) { return '政策利率走廊参考'; },
  NFCI: function (v) { return v > 0 ? '>0＝金融条件净收紧' : v < -0.5 ? '明显宽松' : '温和宽松'; },
  STLFSI4: function (v) { return v > 0 ? '>0＝金融压力高于历史均值' : '低于均值，无系统性压力'; },
  WRESBAL: function (v) { var w = v / 1e6; return '折合约' + w.toFixed(2) + '万亿美元，' + (w < 3 ? '<3万亿＝充裕度警戒线下方' : '充裕线上方'); },
  RRPONTSYD: function (v) { return v < 200 ? 'ON RRP缓冲垫近耗尽，缩表直接抽准备金' : '缓冲垫尚存'; },
  DCOILWTICO: function (v) { return v >= 90 ? '≥90美元＝通胀冲击区' : v <= 65 ? '≤65美元＝低价区（供给过剩/需求弱定价）' : '中性区间'; },
  DCOILBRENTEU: function (v) { return THRESH.DCOILWTICO(v); },
  GOLD_SILVER_RATIO: function (v) { return v >= 90 ? '≥90＝避险极值/白银滞涨' : v <= 75 ? '≤75＝白银强势（风偏修复/工业需求）' : '常态区'; },
  Y_GOLD: function (v) { return v >= 4700 ? '≥4700＝触及B端确认线（0902体系）' : v < 4520 ? '跌破4520＝A端确认条件之一已满足（0902体系）' : '4520–4700对峙区'; },
  SPR_USCN10Y: function (v) { return v < 0 ? '中美利差倒挂，人民币承压逻辑未改' : '转正，资本流出压力缓解'; },
  EM_CGB10Y: function (v) { return v <= 2 ? '≤2%＝增长通胀双弱定价' : '—'; }
};
function levelWord(p) { if (p == null) return '样本不足'; return p >= 85 ? '历史极高水位' : p >= 65 ? '偏高位' : p >= 35 ? '中性区间' : p >= 15 ? '偏低位' : '历史极低水位'; }
function dWord(x) { if (x == null || !isFinite(x)) return '—'; var ax = Math.abs(x); return (x > 0 ? '+' : '') + (ax >= 100 ? x.toFixed(0) : ax >= 10 ? x.toFixed(1) : x.toFixed(2)); }
/* 图表区单指标结论：返回一行HTML（无序列数据返回空串） */
CE.seriesConclusion = function (id, name, unit) {
  var o = S(id);
  if (!o || o.v == null) return '';
  name = name || id; unit = unit || '';
  var w5 = chgN(o, 5), w21 = chgN(o, 21);
  /* 近3年分位（相对最新数据日回溯） */
  var p3 = null;
  try {
    var end = new Date(o.d); end.setFullYear(end.getFullYear() - 3);
    var cut = end.toISOString().slice(0, 10);
    var sub = o.arr.filter(function (p) { return p[0] >= cut; });
    if (sub.length >= 30) p3 = pctileOf(sub, o.v);
  } catch (e) {}
  var th = '';
  if (THRESH[id]) { try { th = THRESH[id](o.v, o) || ''; } catch (e) {} if (th === '—') th = ''; }
  var cls3 = p3 == null ? '' : (p3 >= 65 ? 'up' : p3 <= 35 ? 'dn' : '');
  return '<div style="font-size:12px;line-height:1.8;padding:6px 10px;border-left:3px solid var(--gold);' +
    'background:rgba(212,169,68,.05);border-radius:0 6px 6px 0;margin-top:6px;">' +
    '<b style="color:var(--gold);">' + name + '</b>：最新 <b>' + f2(o.v) + (unit ? ' ' + unit : '') + '</b>（' + o.d + '）｜' +
    '周Δ <span class="' + (w5 > 0 ? 'up' : w5 < 0 ? 'dn' : '') + '">' + dWord(w5) + '</span>｜' +
    '月Δ ' + dWord(w21) + '｜近3年分位 <span class="' + cls3 + '">' + (p3 == null ? '—' : Math.round(p3) + '%') + '</span>（' + levelWord(p3) + '）' +
    (th ? '｜' + th : '') + '</div>';
};
CE.stamp = stamp;
/* FedWatch官方表结论（五、政策定价面板用）：最近会议定方向+锁死度，相邻会议定路径 */
CE.fwConclusion = function (F) {
  if (!F || !F.meetings || !F.meetings.length) return '';
  var m0 = F.meetings[0], m1 = F.meetings[1] || null;
  var dir = m0.hike >= 50 ? '加息' : (m0.ease >= 50 ? '降息' : '按兵不动');
  var lock = Math.max(m0.hike || 0, m0.no_change || 0, m0.ease || 0);
  var lockWord = lock >= 80 ? '接近完全定价' : lock >= 60 ? '定价过半但未锁死' : '分歧仍大';
  var path = '';
  if (m1) {
    var d = (m1.hike || 0) - (m0.hike || 0);
    if (d >= 10) path = '；下次会议加息概率续升至 ' + m1.hike + '%，紧缩预期沿曲线加码';
    else if (d <= -10) path = '；下次会议加息概率回落至 ' + m1.hike + '%，市场倾向“加一次就停”';
    else path = '；相邻会议定价平缓，暂无连续加码预期';
  }
  var ease = (m0.ease || 0) >= 10 ? '；降息尾部分项 ' + m0.ease + '%，仍可对冲鹰派意外' : '';
  return '<div style="font-size:12.5px;line-height:1.8;padding:8px 12px;border-left:3px solid var(--gold);' +
    'background:rgba(212,169,68,.06);border-radius:0 6px 6px 0;margin-top:8px;">' +
    '<b style="color:var(--gold);">⚙️定价解读</b>：最近会议（' + m0.meeting + '）市场主定价<b>' + dir + '</b>' +
    '（加息 ' + (m0.hike || 0) + '% / 维持 ' + (m0.no_change || 0) + '%' + ((m0.ease || 0) ? ' / 降息 ' + m0.ease + '%' : '') + '），' +
    lockWord + path + ease + '。</div>';
};

/* ============================================================================
   渲染入口
   ============================================================================ */
CE.renderDaily = function () {
  try { setHost('ceDailyConclusion', dailyConclusion()); } catch (e) {}
  try { setHost('ceOverview', overview()); } catch (e) {}
  try { setHost('ceNineDim', nineDim()); } catch (e) {}
  try { setHost('ceFalsify', falsify()); } catch (e) {}
  try { setHost('ceAB', abNote()); } catch (e) {}
  try { setHost('ceMetalQuad', metalQuad()); } catch (e) {}
  try { setHost('ceTriangle', triangle()); } catch (e) {}
  try { setHost('ceBond', bondConclusion()); } catch (e) {}
  try { setHost('ceBondBoard', bondBoard()); } catch (e) {}
  try { setHost('ceUSQuad', usQuad()); } catch (e) {}
  try { setHost('ceFx', fxConclusion()); } catch (e) {}
  try { setHost('ceFxBoard', fxBoard()); } catch (e) {}
};
CE.renderWeekly = function () {
  try { setHost('ceWeeklyOv', weeklyOv()); } catch (e) {}
  try { setHost('ceWeeklyTable', weeklyTable()); } catch (e) {}
  try { setHost('ceWeeklyNext', weeklyNext()); } catch (e) {}
};
CE.facts = facts;
CE._reset = function () { _F = null; };
window.CE = CE;
})();
