/* 金十式财经日历渲染器(日报/周报共用):本周/下周/关键节点 三按钮切换;每卡只留星级最高的1条,其余折叠"其他+N"。
   数据 data/econ_calendar.json;来源与规则见 JSON 内 src/rule 字段。null 一律显示"—",不编造。 */
(function(){
  var cssInjected = false;
  function injectCss(){
    if(cssInjected) return; cssInjected = true;
    var st = document.createElement('style');
    st.textContent = ''
+ '.ec-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:8px}'
+ '@media(max-width:1400px){.ec-grid{grid-template-columns:repeat(3,1fr)}}'
+ '@media(max-width:1000px){.ec-grid{grid-template-columns:repeat(2,1fr)}}'
+ '@media(max-width:640px){.ec-grid{grid-template-columns:1fr}}'
+ '.ec-day{background:var(--card,#131a26);border:1px solid var(--line,#26303f);border-radius:10px;padding:8px 10px}'
+ '.ec-dh{font-size:12px;font-weight:700;color:var(--gold,#d4a94e);padding-bottom:6px;margin-bottom:6px;border-bottom:1px solid var(--line,#26303f)}'
+ '.ec-ev{padding:6px 8px;border-radius:7px;background:rgba(255,255,255,.02);margin-bottom:6px}'
+ '.ec-ev.hot{border:1px solid rgba(212,169,78,.55);background:rgba(212,169,78,.06)}'
+ '.ec-l1{display:flex;gap:6px;align-items:baseline;font-size:12px;line-height:1.5}'
+ '.ec-t{color:var(--blue,#5b9bd5);font-weight:700;white-space:nowrap}'
+ '.ec-n{color:var(--text,#e8ecf1);flex:1}'
+ '.ec-s{color:var(--gold,#d4a94e);white-space:nowrap;letter-spacing:1px}'
+ '.ec-l2{display:flex;flex-wrap:wrap;gap:4px 10px;font-size:11px;margin-top:3px;color:var(--muted,#8b95a5)}'
+ '.ec-l2 b{font-weight:700}'
+ '.ec-act{color:#ff7043}'
+ '.ec-exp{color:var(--gold,#d4a94e)}'
+ '.ec-prev{color:var(--muted,#8b95a5)}'
+ '.ec-more summary{cursor:pointer;font-size:11px;color:var(--muted,#8b95a5);padding:4px 2px;list-style:none}'
+ '.ec-more summary::-webkit-details-marker{display:none}'
+ '.ec-more summary:before{content:"▸ ";color:var(--gold,#d4a94e)}'
+ '.ec-more[open] summary:before{content:"▾ "}'
+ '.ec-btnbar{display:inline-flex;gap:8px;margin-top:10px;flex-wrap:wrap}'
+ '.ec-btn{cursor:pointer;background:transparent;border:1px solid var(--line,#26303f);color:var(--text,#e8ecf1);border-radius:8px;padding:7px 16px;font-size:12px;transition:all .15s}'
+ '.ec-btn:hover{border-color:var(--gold,#d4a94e)}'
+ '.ec-btn.on{background:var(--gold,#d4a94e);color:#16130a;border-color:var(--gold,#d4a94e);font-weight:700}'
+ '.ec-titlebtns{float:right}'
+ '.ec-titlebtns .ec-btnbar{margin-top:0}'
+ '.ec-titlebtns .ec-btn{font-family:"Helvetica Neue",Arial,"PingFang SC",sans-serif;font-weight:400;font-size:11px;padding:4px 12px;vertical-align:middle}'
+ '.ec-titlebtns .ec-btn.on{font-weight:700}'
+ '.ec-panel{display:none}'
+ '.ec-panel.on{display:block}'
+ '.ec-note{font-size:11px;color:var(--muted,#8b95a5);margin-top:8px;line-height:1.6}';
    document.head.appendChild(st);
  }
  function stars(n){ var s=''; for(var i=0;i<n;i++) s+='★'; return s; }
  function fmt(v){ return (v===null||v===undefined||v==='') ? '—' : v; }
  function evHtml(ev){
    var t=ev[0], name=ev[1], star=ev[2]||0, act=ev[3], exp=ev[4], prev=ev[5];
    var h = '<div class="ec-ev'+(star>=4?' hot':'')+'">';
    h += '<div class="ec-l1"><span class="ec-t">'+t+'</span><span class="ec-n">'+name+'</span>'+(star?'<span class="ec-s">'+stars(star)+'</span>':'')+'</div>';
    h += '<div class="ec-l2"><span>公布 <b class="ec-act">'+fmt(act)+'</b></span><span>预期 <b class="ec-exp">'+fmt(exp)+'</b></span><span>前值 <b class="ec-prev">'+fmt(prev)+'</b></span></div>';
    return h+'</div>';
  }
  /* 每张卡片只留星级最高的1条(并列取时间最早),其余折叠「其他+N」 */
  function dayCard(d){
    var evs = d.events||[];
    var topIdx = 0;
    evs.forEach(function(ev, i){ if((ev[2]||0) > (evs[topIdx][2]||0)) topIdx = i; });
    var main = evs.length ? [evs[topIdx]] : [];
    var rest = evs.filter(function(_, i){ return i!==topIdx; });
    var h = '<div class="ec-day"><div class="ec-dh">'+d.date+'</div>' + main.map(evHtml).join('');
    if(rest.length){
      h += '<details class="ec-more"><summary>其他 +'+rest.length+'</summary>' + rest.map(evHtml).join('') + '</details>';
    }
    return h+'</div>';
  }
  /* renderEconCal(hostId, ecJson, opts): 按 days[].grp 分组为按钮页签(默认第一组), opts.btnHostId 可把按钮条挪到标题旁 */
  window.renderEconCal = function(hostId, ec, opts){
    var host = document.getElementById(hostId);
    if(!host || !ec || !ec.days) return;
    injectCss();
    opts = opts||{};
    var grps = [], byGrp = {};
    ec.days.forEach(function(d){
      var g = d.grp || '本周';
      if(!byGrp[g]){ byGrp[g] = []; grps.push(g); }
      byGrp[g].push(d);
    });
    var h = '<div class="ec-btnbar">' + grps.map(function(g,i){
      return '<button class="ec-btn'+(i===0?' on':'')+'" data-ecp="'+i+'">'+g+'</button>';
    }).join('') + '</div>';
    h += grps.map(function(g,i){
      return '<div class="ec-panel'+(i===0?' on':'')+'" data-ecp="'+i+'"><div class="ec-grid">'
        + byGrp[g].map(dayCard).join('') + '</div></div>';
    }).join('');
    h += '<div class="ec-note">'+ (ec.rule||'') + ' · ' + (ec.src||'') + (ec.updated?(' · 快照 '+ec.updated):'') + '</div>';
    host.innerHTML = h;
    /* 按钮条可挪到标题旁(opts.btnHostId),面板留在原 host */
    var bar = host.querySelector('.ec-btnbar');
    if(bar && opts.btnHostId){
      var bh = document.getElementById(opts.btnHostId);
      if(bh){ bh.innerHTML=''; bh.appendChild(bar); }
    }
    if(bar){
      bar.querySelectorAll('.ec-btn').forEach(function(btn){
        btn.onclick = function(){
          var id = btn.getAttribute('data-ecp');
          bar.querySelectorAll('.ec-btn').forEach(function(b){ b.classList.toggle('on', b===btn); });
          host.querySelectorAll('.ec-panel').forEach(function(p){ p.classList.toggle('on', p.getAttribute('data-ecp')===id); });
        };
      });
    }
  };
  /* 便捷:fetch 后渲染,失败走 onFail(保留兜底) */
  window.loadEconCal = function(hostId, url, opts, onOk, onFail){
    fetch(url).then(function(r){ if(!r.ok) throw 0; return r.json(); }).then(function(ec){
      window.renderEconCal(hostId, ec, opts);
      if(onOk) onOk(ec);
    }).catch(function(){ if(onFail) onFail(); });
  };
})();
