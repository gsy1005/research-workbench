/* 研究工具箱 v1 · 日报/周报共用
   用法: researchToolbox(hostId)
   依赖: echarts, window.CHART_SERIES, window.MACRO_CATALOG(可选 window.MM_CATALOG)
   功能:
   - 模式: 折线/柱状/堆叠/涨跌幅/报酬率(归一)/季节性/相关性/分位回测
   - 四则运算: 字母引用已选序列(如 A/B*100), 结果入库可再选
   - 图表设定: 对数轴/平滑/时间范围
   - 导出: CSV / PNG
   - 组合收藏: localStorage 命名保存/一键载入
   - 统计条: 最新值/区间涨跌/2019以来分位 */
(function(){
const PAL=['#d4a944','#5b9bd5','#4caf7d','#e5534b','#b08ad9','#5bc0de','#e5a54b','#8a94a6'];
const LET='ABCDEFGH'.split('');
function css(){
  if(document.getElementById('rtb-css'))return;
  const s=document.createElement('style'); s.id='rtb-css';
  s.textContent=`
.rtb{background:#12161f;border:1px solid #262d3d;border-radius:6px;padding:14px 16px;margin-top:12px;color:#d7dde8;font-size:13px}
.rtb .row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:8px}
.rtb .seg{display:inline-flex;border:1px solid #262d3d;border-radius:4px;overflow:hidden}
.rtb .seg button{background:#1c2333;color:#8a94a6;border:none;padding:5px 11px;font-size:11px;cursor:pointer}
.rtb .seg button.on{background:#d4a944;color:#111;font-weight:600}
.rtb .tgl{background:#1c2333;color:#8a94a6;border:1px solid #262d3d;border-radius:4px;padding:4px 10px;font-size:11px;cursor:pointer}
.rtb .tgl.on{color:#d4a944;border-color:#d4a944}
.rtb input[type=text]{background:#1c2333;border:1px solid #262d3d;color:#d7dde8;border-radius:4px;padding:4px 8px;font-size:12px;width:180px}
.rtb .tags{display:flex;flex-wrap:wrap;gap:5px;max-height:132px;overflow-y:auto;padding:6px;border:1px dashed #262d3d;border-radius:4px}
.rtb .tag{font-size:11px;padding:2px 9px;border:1px solid #262d3d;border-radius:11px;cursor:pointer;color:#8a94a6;background:#161b26}
.rtb .tag:hover{border-color:#d4a944;color:#d4a944}
.rtb .chip{display:inline-flex;align-items:center;gap:5px;border:1px solid #d4a944;color:#d4a944;border-radius:4px;padding:2px 7px;font-size:11px;background:rgba(212,169,68,.08)}
.rtb .chip b{background:#d4a944;color:#111;border-radius:3px;padding:0 5px;font-weight:700}
.rtb .chip i{cursor:pointer;font-style:normal;font-weight:700}
.rtb .chart{width:100%;height:520px;margin-top:6px}
.rtb table{border-collapse:collapse;font-size:12px;margin-top:6px}
.rtb th{background:#1c2333;color:#aeb8c8;padding:5px 10px;text-align:left;font-weight:600}
.rtb td{padding:5px 10px;border-top:1px solid #262d3d}
.rtb .hint{font-size:10.5px;color:#8a94a6;margin-top:4px}
.rtb select{background:#1c2333;border:1px solid #262d3d;color:#d7dde8;border-radius:4px;padding:3px 6px;font-size:11px}`;
  document.head.appendChild(s);
}
function pearson(x,y){const n=x.length;if(n<10)return null;
  const mx=x.reduce((a,b)=>a+b,0)/n,my=y.reduce((a,b)=>a+b,0)/n;
  let sxy=0,sx=0,sy=0;for(let i=0;i<n;i++){sxy+=(x[i]-mx)*(y[i]-my);sx+=(x[i]-mx)**2;sy+=(y[i]-my)**2;}
  return sx&&sy?sxy/Math.sqrt(sx*sy):null;}
function pctile(arr,v){let c=0;arr.forEach(x=>{if(x<=v)c++;});return arr.length?Math.round(c/arr.length*100):null;}
/* 公式求值: 仅允许字母、数字、加减乘除、括号、小数点 */
function evalFormula(f,env,dates){
  const toks=f.toUpperCase().replace(/\s/g,'').match(/[A-H]|\d+\.?\d*|[+\-*/()]/g);
  if(!toks||toks.join('')!==f.toUpperCase().replace(/\s/g,''))return null;
  const used=[...new Set(toks.filter(t=>/^[A-H]$/.test(t)))];
  if(!used.length)return null;
  const maps={}; used.forEach(L=>{const s=env[L];if(!s)return;maps[L]={};s.forEach(p=>maps[L][p[0]]=p[1]);});
  if(used.some(L=>!maps[L]))return null;
  let ds=dates;
  if(used.length>1){const sets=used.map(L=>new Set(env[L].map(p=>p[0])));
    ds=dates.filter(d=>sets.every(st=>st.has(d)));}
  /* 逆波兰 */
  const prec={'+':1,'-':1,'*':2,'/':2}, out=[], ops=[];
  toks.forEach(t=>{
    if(/^[A-H]$/.test(t)||/^\d/.test(t))out.push(t);
    else if(t==='(')ops.push(t);
    else if(t===')'){while(ops.length&&ops[ops.length-1]!=='(')out.push(ops.pop());ops.pop();}
    else{while(ops.length&&prec[ops[ops.length-1]]>=prec[t])out.push(ops.pop());ops.push(t);}});
  while(ops.length)out.push(ops.pop());
  const res=[];
  ds.forEach(d=>{
    const stk=[];let bad=false;
    for(const t of out){
      if(/^[A-H]$/.test(t)){const v=maps[t][d];if(v==null){bad=true;break;}stk.push(v);}
      else if(/^\d/.test(t))stk.push(parseFloat(t));
      else{const b=stk.pop(),a=stk.pop();if(a==null||b==null){bad=true;break;}
        stk.push(t==='+'?a+b:t==='-'?a-b:t==='*'?a*b:(b===0?NaN:a/b));}
    }
    if(!bad&&stk.length===1&&isFinite(stk[0]))res.push([d,+stk[0].toFixed(6)]);
  });
  return res.length>2?res:null;
}
window.researchToolbox=function(hostId){
  css();
  const host=document.getElementById(hostId); if(!host)return;
  host.classList.add('rtb');
  const HIST=Object.assign({},window.CHART_SERIES||{});
  let CAT=(window.MACRO_CATALOG||[]).slice();
  if(window.MM_CATALOG)window.MM_CATALOG.forEach(m=>{if(!CAT.some(c=>c.id===m.id))CAT.push({id:m.id,name:m.name+'·MM',unit:m.unit||''});});
  CAT=CAT.filter(c=>(HIST[c.id]||[]).length>2);
  let sel=[], mode='line', rng='3y', logy=false, smooth=false, fxN=0;
  let comboSel='';
  host.innerHTML=`
  <div class="row"><b style="color:#d4a944;font-size:14px">研究工具箱</b>
    <span class="hint">全量指标库（${CAT.length}条）· 点选叠加≤8 · 字母四则运算 · 模式/范围自由切换</span></div>
  <div class="row"><div class="seg" data-k="mode">
    ${[['line','折线'],['bar','柱状'],['stack','堆叠'],['chg','涨跌幅'],['ret','报酬率'],['season','季节性'],['corr','相关性'],['bt','分位回测']].map(m=>`<button data-v="${m[0]}" class="${m[0]==='line'?'on':''}">${m[1]}</button>`).join('')}
  </div>
  <div class="seg" data-k="rng">
    ${[['1y','近1年'],['3y','近3年'],['y20','2020以来'],['all','全部']].map(m=>`<button data-v="${m[0]}" class="${m[0]==='3y'?'on':''}">${m[1]}</button>`).join('')}
  </div>
  <button class="tgl" data-k="logy">对数轴</button>
  <button class="tgl" data-k="smooth">平滑</button>
  <button class="tgl" id="rt-csv">导出CSV</button>
  <button class="tgl" id="rt-png">导出PNG</button>
  <select id="rt-combo"><option value="">组合收藏…</option></select>
  <button class="tgl" id="rt-save">保存当前组合</button>
  </div>
  <div class="row"><input type="text" id="rt-q" placeholder="搜索指标（名称/键名）…">
    <span class="hint">四则运算：</span><input type="text" id="rt-fx" placeholder="如 A/B*100 或 (A-B)" style="width:150px">
    <button class="tgl" id="rt-fxadd">＋运算入图</button></div>
  <div class="row" id="rt-chips" style="min-height:24px"></div>
  <div class="tags" id="rt-tags"></div>
  <div class="chart" id="rt-chart"></div>
  <div id="rt-extra"></div>
  <div class="hint">运算结果以⚙️标记入库可再叠加；相关性=日变化（率）Pearson系数；分位回测=样本内历史统计，非预测。数据源标注见主清单。</div>`;
  const $=id=>host.querySelector(id);
  const chart=echarts.init($('#rt-chart'),null,{renderer:'canvas'});
  const catOf=id=>CAT.find(c=>c.id===id)||{id,name:id,unit:''};
  function letterOf(id){return LET[sel.indexOf(id)]||'?';}
  function rangeStart(){
    const all=[];sel.forEach(id=>{(HIST[id]||[]).forEach(p=>all.push(p[0]))});
    if(!all.length)return null;
    const mx=all.sort()[all.length-1], y=parseInt(mx.slice(0,4));
    return rng==='1y'?(y-1)+mx.slice(4):rng==='3y'?(y-3)+mx.slice(4):rng==='y20'?'2020-01-01':null;
  }
  function renderTags(q){
    const tb=$('#rt-tags');tb.innerHTML='';
    const list=CAT.filter(c=>!q||c.name.toLowerCase().includes(q)||c.id.toLowerCase().includes(q)).slice(0,120);
    list.forEach(c=>{
      const t=document.createElement('span');t.className='tag';
      t.textContent=`${c.name} ${c.unit||''}`;
      t.onclick=()=>{if(sel.includes(c.id))return;if(sel.length>=8){alert('最多8个');return;}
        sel.push(c.id);renderChips();render();};
      tb.appendChild(t);
    });
  }
  function renderChips(){
    $('#rt-chips').innerHTML=sel.map((id,i)=>{const c=catOf(id);
      return `<span class="chip"><b>${LET[i]}</b>${c.name}<i data-rm="${id}">×</i></span>`;}).join('')
      ||'<span class="hint">尚未选择指标——从下方点选，或先做四则运算</span>';
  }
  $('#rt-chips').onclick=e=>{const id=e.target.dataset&&e.target.dataset.rm;if(!id)return;
    sel=sel.filter(x=>x!==id);renderChips();render();};
  $('#rt-q').oninput=e=>renderTags(e.target.value.trim().toLowerCase());
  host.querySelectorAll('.seg button').forEach(b=>b.onclick=()=>{
    const seg=b.parentElement;seg.querySelectorAll('button').forEach(x=>x.classList.remove('on'));
    b.classList.add('on');
    if(seg.dataset.k==='mode')mode=b.dataset.v;else rng=b.dataset.v;render();});
  host.querySelectorAll('.tgl[data-k]').forEach(b=>b.onclick=()=>{
    b.classList.toggle('on');const on=b.classList.contains('on');
    if(b.dataset.k==='logy')logy=on;else smooth=on;render();});
  $('#rt-fxadd').onclick=()=>{
    const f=$('#rt-fx').value.trim();if(!f)return;
    const env={};sel.forEach((id,i)=>env[LET[i]]=HIST[id]);
    const dates=[...new Set(sel.flatMap(id=>(HIST[id]||[]).map(p=>p[0])))].sort();
    const res=evalFormula(f,env,dates);
    if(!res){alert('公式无效或引用未选序列（仅支持 A-H/数字/+-*/()）');return;}
    fxN++;const fid='⚙️FX'+fxN;
    HIST[fid]=res;CAT.push({id:fid,name:'运算:'+f.toUpperCase(),unit:'⚙️'});
    sel.push(fid);$('#rt-fx').value='';renderChips();renderTags($('#rt-q').value.trim().toLowerCase());render();};
  /* 组合收藏 */
  const combos=()=>{try{return JSON.parse(localStorage.getItem('rt_combos')||'{}')}catch(e){return{}}};
  function renderCombos(){const c=combos();$('#rt-combo').innerHTML='<option value="">组合收藏…</option>'+
    Object.keys(c).map(n=>`<option>${n}</option>`).join('');}
  $('#rt-save').onclick=()=>{const n=prompt('组合名称：');if(!n)return;const c=combos();
    c[n]={sel:sel.slice(),mode,rng};localStorage.setItem('rt_combos',JSON.stringify(c));renderCombos();};
  $('#rt-combo').onchange=e=>{const c=combos()[e.target.value];if(!c)return;
    sel=c.sel.filter(id=>HIST[id]);mode=c.mode||'line';rng=c.rng||'3y';
    host.querySelectorAll('.seg button').forEach(b=>{
      const seg=b.parentElement.dataset.k;
      b.classList.toggle('on',(seg==='mode'&&b.dataset.v===mode)||(seg==='rng'&&b.dataset.v===rng));});
    renderChips();render();};
  renderCombos();
  /* 导出 */
  $('#rt-csv').onclick=()=>{
    if(!sel.length)return;
    const st=rangeStart();
    const dates=[...new Set(sel.flatMap(id=>(HIST[id]||[]).filter(p=>!st||p[0]>=st).map(p=>p[0])))].sort();
    const head=['date',...sel.map(id=>catOf(id).name)];
    const maps=sel.map(id=>{const m={};(HIST[id]||[]).forEach(p=>m[p[0]]=p[1]);return m;});
    const csv=head.join(',')+'\n'+dates.map(d=>[d,...maps.map(m=>m[d]??'')].join(',')).join('\n');
    const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['﻿'+csv],{type:'text/csv'}));
    a.download='研究工具箱_'+new Date().toISOString().slice(0,10)+'.csv';a.click();};
  $('#rt-png').onclick=()=>{
    const a=document.createElement('a');
    a.href=chart.getDataURL({pixelRatio:2,backgroundColor:'#12161f'});
    a.download='研究工具箱_'+new Date().toISOString().slice(0,10)+'.png';a.click();};
  function yAx(units){
    const ax=[{type:logy?'log':'value',scale:true,axisLabel:{color:'#8a94a6',fontSize:10},splitLine:{lineStyle:{color:'#222a3a'}}}];
    if(units.length>1)ax.push({type:logy?'log':'value',scale:true,position:'right',axisLabel:{color:'#8a94a6',fontSize:10},splitLine:{show:false}});
    return ax;}
  function render(){
    const ex=$('#rt-extra');ex.innerHTML='';
    if(!sel.length){chart.clear();return;}
    const st=rangeStart();
    const tip={trigger:'axis',backgroundColor:'#1c2333',borderColor:'#262d3d',textStyle:{color:'#d7dde8',fontSize:11}};
    if(mode==='corr')return renderCorr(st,tip,ex);
    if(mode==='bt')return renderBT(st,ex);
    if(mode==='season')return renderSeason(st,tip);
    /* line/bar/stack/chg/ret 共用主轴框架 */
    const series=[],units=[];
    sel.forEach((id,i)=>{
      const c=catOf(id);
      let data=(HIST[id]||[]).filter(p=>!st||p[0]>=st);
      if(!data.length)return;
      if(mode==='chg'){
        data=data.slice(1).map((p,j)=>{const pv=data[j][1];return [p[0],pv?+((p[1]-pv)/Math.abs(pv)*100).toFixed(3):null];}).filter(p=>p[1]!=null);
      }else if(mode==='ret'){
        const b=data[0][1];data=b?data.map(p=>[p[0],+((p[1]-b)/Math.abs(b)*100).toFixed(3)]):data;
      }
      let u=c.unit||'';if(mode==='chg'||mode==='ret')u='%';
      let ui=units.indexOf(u);if(ui<0){units.push(u);ui=units.length-1;}
      const t=mode==='bar'||mode==='stack'?'bar':'line';
      const s={name:`${LET[i]}·${c.name}`,type:t,yAxisIndex:ui>1?1:ui,showSymbol:false,data,
        itemStyle:{color:PAL[i%8]},lineStyle:{width:1.6,color:PAL[i%8]},smooth:smooth};
      if(mode==='stack')s.stack='total';
      if(t==='bar')s.barMaxWidth=14;
      series.push(s);});
    chart.clear();
    chart.setOption({backgroundColor:'transparent',tooltip:tip,
      legend:{textStyle:{color:'#aeb8c8',fontSize:11},top:0,type:'scroll'},
      grid:{left:56,right:units.length>1?56:20,top:34,bottom:52},
      xAxis:{type:'time',axisLabel:{color:'#8a94a6',fontSize:10},axisLine:{lineStyle:{color:'#333'}}},
      yAxis:yAx(units),
      dataZoom:[{type:'slider',height:16,bottom:8,borderColor:'#262d3d',backgroundColor:'#12161f',fillerColor:'rgba(212,169,68,.12)',handleStyle:{color:'#d4a944'},textStyle:{color:'#8a94a6',fontSize:9}}],
      series});
    renderStats(st,ex);
  }
  function renderStats(st,ex){
    let h='<table><tr><th></th><th>指标</th><th>最新值</th><th>截至</th><th>区间涨跌</th><th>2019以来分位</th></tr>';
    sel.forEach((id,i)=>{
      const c=catOf(id),s=(HIST[id]||[]);
      if(!s.length)return;
      const last=s[s.length-1];
      const d=(HIST[id]||[]).filter(p=>!st||p[0]>=st);
      const chg=d.length>1&&d[0][1]?((last[1]-d[0][1])/Math.abs(d[0][1])*100):null;
      const h19=s.filter(p=>p[0]>='2019-01-01').map(p=>p[1]);
      h+=`<tr><td><b style="color:${PAL[i%8]}">${LET[i]}</b></td><td>${c.name}</td><td><b>${last[1]}</b> ${c.unit||''}</td><td>${last[0]}</td>
        <td style="color:${chg==null?'#8a94a6':chg>0?'#e5534b':'#4caf7d'}">${chg==null?'—':(chg>0?'+':'')+chg.toFixed(1)+'%'}</td>
        <td>${h19.length>10?pctile(h19,last[1]):'—'}</td></tr>`;});
    ex.innerHTML=h+'</table>';
  }
  function renderSeason(st,tip){
    const grids=[],xA=[],yA=[],series=[],legs=[];
    const per=Math.floor(88/Math.max(sel.length,1));
    sel.forEach((id,gi)=>{
      const c=catOf(id);
      const raw=(HIST[id]||[]).filter(p=>!st||p[0]>=st);
      const byY={};raw.forEach(p=>{const y=p[0].slice(0,4);(byY[y]=byY[y]||{})[p[0].slice(5)]=p[1];});
      const years=Object.keys(byY).sort();
      const cats=[...new Set(raw.map(p=>p[0].slice(5)))].sort();
      grids.push({left:56,right:20,top:(gi*per+4)+'%',height:(per-9)+'%'});
      xA.push({type:'category',data:cats,gridIndex:gi,axisLabel:{color:'#8a94a6',fontSize:9,interval:Math.floor(cats.length/8)},axisLine:{lineStyle:{color:'#333'}}});
      yA.push({type:'value',gridIndex:gi,name:`${c.name} ${c.unit||''}`,nameTextStyle:{color:'#8a94a6',fontSize:10},axisLabel:{color:'#8a94a6',fontSize:9},splitLine:{lineStyle:{color:'#222a3a'}},scale:true});
      const maxY=years[years.length-1];
      years.forEach(y=>series.push({name:y,type:'line',xAxisIndex:gi,yAxisIndex:gi,showSymbol:false,
        data:cats.map(d=>byY[y][d]??null),connectNulls:false,
        lineStyle:{width:y===maxY?2.6:1,color:y===maxY?'#d4a944':'#3a4a65'},
        itemStyle:{color:y===maxY?'#d4a944':'#3a4a65'}}));
      legs.push({data:years,top:(gi*per+1)+'%',left:60,textStyle:{color:'#aeb8c8',fontSize:9},itemWidth:12,itemHeight:8,type:'scroll'});});
    chart.clear();
    chart.setOption({backgroundColor:'transparent',tooltip:tip,legend:legs,grid:grids,xAxis:xA,yAxis:yA,series});
  }
  function renderCorr(st,tip,ex){
    if(sel.length<2){ex.innerHTML='<div class="hint">相关性模式需至少选择2个指标</div>';chart.clear();return;}
    /* 日变化: %单位取差分, 其余取变动率 */
    const chg=sel.map(id=>{
      const s=(HIST[id]||[]).filter(p=>!st||p[0]>=st),u=catOf(id).unit;
      const out=[];
      for(let i=1;i<s.length;i++){
        const dv=u==='%'?s[i][1]-s[i-1][1]:(s[i-1][1]?(s[i][1]-s[i-1][1])/Math.abs(s[i-1][1]):null);
        if(dv!=null&&isFinite(dv))out.push([s[i][0],dv]);}
      return out;});
    const common=chg[0].map(p=>p[0]).filter(d=>chg.every(s=>s.some(p=>p[0]===d)));
    const cols=chg.map(s=>{const m={};s.forEach(p=>m[p[0]]=p[1]);return common.map(d=>m[d]);});
    let h='<table><tr><th>相关系数(日变化)</th>'+sel.map((id,i)=>`<th>${LET[i]} ${catOf(id).name}</th>`).join('')+'</tr>';
    cols.forEach((ci,i)=>{
      h+=`<tr><td><b style="color:${PAL[i%8]}">${LET[i]}</b> ${catOf(sel[i]).name}</td>`;
      cols.forEach((cj,j)=>{
        const r=i===j?1:pearson(ci,cj);
        const v=r==null?'—':r.toFixed(2);
        const col=r==null?'#8a94a6':Math.abs(r)>=0.7?'#d4a944':Math.abs(r)>=0.4?'#aeb8c8':'#5a6478';
        h+=`<td style="color:${col};font-weight:${Math.abs(r||0)>=0.7?700:400}">${v}</td>`;});
      h+='</tr>';});
    ex.innerHTML=h+'</table><div class="hint">样本=所选区间内共同交易日变化（%单位序列取差分，其余取变动率）；|r|≥0.7 金色加粗</div>';
    /* 滚动63日相关(前两序列) */
    const roll=[];const W=63;
    for(let i=W;i<common.length;i++){
      const x=cols[0].slice(i-W,i),y=cols[1].slice(i-W,i);
      const r=pearson(x,y);if(r!=null)roll.push([common[i],+r.toFixed(3)]);}
    chart.clear();
    chart.setOption({backgroundColor:'transparent',tooltip:tip,
      grid:{left:56,right:20,top:34,bottom:52},
      xAxis:{type:'time',axisLabel:{color:'#8a94a6',fontSize:10}},
      yAxis:{type:'value',min:-1,max:1,axisLabel:{color:'#8a94a6',fontSize:10},splitLine:{lineStyle:{color:'#222a3a'}}},
      dataZoom:[{type:'slider',height:16,bottom:8,textStyle:{color:'#8a94a6',fontSize:9}}],
      series:[{name:`滚动63日相关 ${LET[0]}×${LET[1]}`,type:'line',showSymbol:false,data:roll,
        lineStyle:{color:'#d4a944',width:1.6},itemStyle:{color:'#d4a944'},
        markLine:{symbol:'none',data:[{yAxis:0}],lineStyle:{color:'#5a6478'}}}]});
  }
  function renderBT(st,ex){
    const id=sel[0];if(!id){chart.clear();return;}
    const c=catOf(id),s=HIST[id]||[];
    const base=s.filter(p=>p[0]>='2019-01-01');
    const vals=base.map(p=>p[1]);
    /* 每个历史点: 全样本分位 → 未来20/60交易日变化 */
    const full=s.map(p=>p[1]);
    const bk=[0,0,0,0,0].map(()=>({f20:[],f60:[]}));
    for(let i=0;i<s.length;i++){
      const p=pctile(full,s[i][1]);const b=Math.min(4,Math.floor(p/20));
      const pct=u=>u!=null&&isFinite(u);
      const ch=(j)=>{const f=s[i+j];if(!f||!s[i][1])return null;
        return c.unit==='%'?f[1]-s[i][1]:(f[1]-s[i][1])/Math.abs(s[i][1])*100;};
      const v20=ch(20),v60=ch(60);
      if(pct(v20))bk[b].f20.push(v20);if(pct(v60))bk[b].f60.push(v60);}
    const stats=bk.map(b=>{const m=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;
      const md=a=>{if(!a.length)return null;const q=[...a].sort((x,y)=>x-y);return q[Math.floor(q.length/2)];};
      return{n:b.f20.length,m20:m(b.f20),md20:md(b.f20),m60:m(b.f60)};});
    const last=s[s.length-1],curP=pctile(full,last[1]);
    const u2=c.unit==='%'?'pt':'%';
    let h=`<table><tr><th colspan="5">分位回测 · ${c.name}（当前分位 <b style="color:#d4a944">${curP}</b> · 全样本${full.length}点${c.unit==='%'?'·差分pt':'·变动%'}）</th></tr>
      <tr><th>历史分位区间</th><th>样本数</th><th>未来20日均值(${u2})</th><th>未来20日中位(${u2})</th><th>未来60日均值(${u2})</th></tr>`;
    ['0-20','20-40','40-60','60-80','80-100'].forEach((b,i)=>{
      const t=stats[i];
      h+=`<tr${curP>=i*20&&curP<(i+1)*20?' style="background:rgba(212,169,68,.10)"':''}>
        <td>${b}${curP>=i*20&&curP<(i+1)*20?' ← 当前':''}</td><td>${t.n}</td>
        <td>${t.m20==null?'—':t.m20.toFixed(2)}</td><td>${t.md20==null?'—':t.md20.toFixed(2)}</td>
        <td>${t.m60==null?'—':t.m60.toFixed(2)}</td></tr>`;});
    ex.innerHTML=h+'</table><div class="hint">样本内历史统计（全样本分位→未来变化），不构成预测；首个选中指标生效</div>';
    chart.clear();
    chart.setOption({backgroundColor:'transparent',
      tooltip:{trigger:'axis',backgroundColor:'#1c2333',borderColor:'#262d3d',textStyle:{color:'#d7dde8',fontSize:11}},
      grid:{left:56,right:20,top:34,bottom:30},
      xAxis:{type:'category',data:['0-20','20-40','40-60','60-80','80-100'],axisLabel:{color:'#8a94a6',fontSize:10}},
      yAxis:{type:'value',name:u2,axisLabel:{color:'#8a94a6',fontSize:10},splitLine:{lineStyle:{color:'#222a3a'}}},
      series:[{name:'未来20日均值',type:'bar',barMaxWidth:36,itemStyle:{color:'#d4a944'},
        data:stats.map(t=>t.m20==null?null:+t.m20.toFixed(2))}]});
  }
  renderTags('');renderChips();
  window.addEventListener('resize',()=>chart.resize());
};
})();
