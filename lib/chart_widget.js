/* 可编辑图表组件 v2 · 日报/周报共用
   用法: chartWidget(hostId, presetSel, allowIds, defMode)
   - hostId: 容器元素 id
   - presetSel: 预选指标 id 数组 (如 ['DGS10','DFII10'])
   - allowIds: 可选指标白名单 (null=全部 CATALOG)
   - defMode: 'line' | 'bar' | 'seasonal'
   依赖: echarts, window.CHART_SERIES, 全局 CATALOG=[{id,name,unit}]
   功能: 折线/柱状/季节性三模式 · 叠加指标(≤4, 单位不同自动右轴) · 时间范围切换 */
(function(){
const PALETTE=['#d4a944','#5b9bd5','#4caf7d','#e5534b'];
window.chartWidget=function(hostId, presetSel, allowIds, defMode){
  const host=document.getElementById(hostId); if(!host) return;
  const HIST = window.CHART_SERIES||{};
  const CATG = (typeof CATALOG!=='undefined'&&CATALOG)||window.MACRO_CATALOG||[];
  const CATS = CATG.filter(c=>!allowIds||allowIds.includes(c.id));
  let sel=(presetSel||[]).slice(), mode=defMode||'line', rng='3y';
  host.innerHTML = `<div class="ctl">
      <div class="seg2" data-k="mode">
        <button data-v="line" class="${mode==='line'?'on':''}">折线图</button>
        <button data-v="bar" class="${mode==='bar'?'on':''}">柱状图</button>
        <button data-v="seasonal" class="${mode==='seasonal'?'on':''}">季节性图</button></div>
      <div class="seg2" data-k="rng"><button data-v="1y">近1年</button><button data-v="3y" class="on">近3年</button><button data-v="y20">2020以来</button><button data-v="all">全部</button></div>
    </div>
    <details><summary>▸ 指标选项（点击展开，点选叠加，最多4个）</summary><div class="tags"></div></details>
    <div class="chart"></div>
    <div class="cn">折线/柱状：多指标自动分配左右轴，可拖动滑块缩放。季节性：同一指标按年叠线（当年金色加粗），多选分图显示。</div>`;
  const tagsEl=host.querySelector('.tags'), chartEl=host.querySelector('.chart');
  const chart=echarts.init(chartEl,null,{renderer:'canvas'});
  function renderTags(){
    tagsEl.innerHTML='';
    CATS.forEach(c=>{
      const t=document.createElement('span');
      t.className='tag2'+(sel.includes(c.id)?' on':'');
      t.innerHTML=`${c.name}<span class="u"> ${c.unit}</span>`;
      t.onclick=()=>{
        if(sel.includes(c.id)) sel=sel.filter(x=>x!==c.id);
        else { if(sel.length>=4){alert('最多同时叠加4个指标');return;} sel.push(c.id); }
        renderTags(); render();
      };
      tagsEl.appendChild(t);
    });
  }
  host.querySelectorAll('.seg2 button').forEach(b=>b.onclick=()=>{
    const seg=b.parentElement;
    seg.querySelectorAll('button').forEach(x=>x.classList.remove('on'));
    b.classList.add('on');
    if(seg.dataset.k==='mode') mode=b.dataset.v; else rng=b.dataset.v;
    render();
  });
  function rangeStart(){
    const all=[]; sel.forEach(id=>{(HIST[id]||[]).forEach(p=>all.push(p[0]))});
    if(!all.length) return null;
    const mx=all.sort()[all.length-1];
    const y=parseInt(mx.slice(0,4));
    if(rng==='1y') return (y-1)+mx.slice(4);
    if(rng==='3y') return (y-3)+mx.slice(4);
    if(rng==='y20') return '2020-01-01';
    return null;
  }
  function render(){
    if(!sel.length){chart.clear();return;}
    if(mode==='seasonal') renderSeasonal(); else renderMain();
  }
  function renderMain(){
    const st=rangeStart();
    const series=[]; const yAxis=[];
    sel.forEach((id,i)=>{
      const c=CATG.find(x=>x.id===id)||{name:id,unit:''};
      let data=(HIST[id]||[]).filter(p=>!st||p[0]>=st);
      let yi=0;
      if(i>0){
        const fu=(CATG.find(x=>x.id===sel[0])||{}).unit;
        if(c.unit!==fu) yi=1;
      }
      if(!yAxis[yi]) yAxis[yi]={type:'value',name:c.unit,position:yi===0?'left':'right',axisLabel:{color:'#8a94a6',fontSize:10},splitLine:{lineStyle:{color:'#222a3a'}},scale:true};
      const s={name:`${c.name}(${c.unit})`,type:mode==='bar'?'bar':'line',yAxisIndex:yi,showSymbol:false,data,
        lineStyle:{width:1.6,color:PALETTE[i%4]},itemStyle:{color:PALETTE[i%4]}};
      if(mode==='bar'){s.barMaxWidth=14;delete s.lineStyle;}
      series.push(s);
    });
    chart.clear();
    chart.setOption({backgroundColor:'transparent',
      tooltip:{trigger:'axis',backgroundColor:'#1c2333',borderColor:'#262d3d',textStyle:{color:'#d7dde8',fontSize:11}},
      legend:{textStyle:{color:'#aeb8c8',fontSize:11},top:0,type:'scroll'},
      grid:{left:56,right:56,top:34,bottom:52},
      xAxis:{type:'time',axisLabel:{color:'#8a94a6',fontSize:10},axisLine:{lineStyle:{color:'#333'}}},
      yAxis:yAxis.filter(Boolean),
      dataZoom:[{type:'slider',height:16,bottom:8,borderColor:'#262d3d',backgroundColor:'#12161f',fillerColor:'rgba(212,169,68,.12)',handleStyle:{color:'#d4a944'},textStyle:{color:'#8a94a6',fontSize:9}}],
      series});
  }
  function renderSeasonal(){
    const grids=[],xAxes=[],yAxes=[],series=[],legends=[];
    const per=Math.floor(88/Math.max(sel.length,1));
    const st=rangeStart();
    sel.forEach((id,gi)=>{
      const c=CATG.find(x=>x.id===id)||{name:id,unit:''};
      const raw=(HIST[id]||[]).filter(p=>!st||p[0]>=st);
      const byY={};
      raw.forEach(p=>{const y=p[0].slice(0,4);(byY[y]=byY[y]||{})[p[0].slice(5)]=p[1];});
      const years=Object.keys(byY).sort();
      const days=new Set(); raw.forEach(p=>days.add(p[0].slice(5)));
      const cats=[...days].sort();
      grids.push({left:56,right:20,top:(gi*per+4)+'%',height:(per-9)+'%'});
      xAxes.push({type:'category',data:cats,gridIndex:gi,axisLabel:{color:'#8a94a6',fontSize:9,interval:Math.floor(cats.length/8)},axisLine:{lineStyle:{color:'#333'}}});
      yAxes.push({type:'value',gridIndex:gi,name:`${c.name} ${c.unit}`,nameTextStyle:{color:'#8a94a6',fontSize:10},axisLabel:{color:'#8a94a6',fontSize:9},splitLine:{lineStyle:{color:'#222a3a'}},scale:true});
      const maxY=years[years.length-1];
      years.forEach(y=>{
        const cur=(y===maxY);
        series.push({name:y,type:'line',xAxisIndex:gi,yAxisIndex:gi,showSymbol:false,
          data:cats.map(d=>byY[y][d]??null),connectNulls:false,
          lineStyle:{width:cur?2.6:1,color:cur?'#d4a944':'#3a4a65'},
          itemStyle:{color:cur?'#d4a944':'#3a4a65'},emphasis:{lineStyle:{width:2.4}}});
      });
      legends.push({data:years,top:(gi*per+1)+'%',left:60,textStyle:{color:'#aeb8c8',fontSize:9},itemWidth:12,itemHeight:8,type:'scroll'});
    });
    chart.clear();
    chart.setOption({backgroundColor:'transparent',
      tooltip:{trigger:'axis',backgroundColor:'#1c2333',borderColor:'#262d3d',textStyle:{color:'#d7dde8',fontSize:11}},
      legend:legends, grid:grids, xAxis:xAxes, yAxis:yAxes, series});
  }
  renderTags(); render();
  window.addEventListener('resize',()=>chart.resize());
};
})();
