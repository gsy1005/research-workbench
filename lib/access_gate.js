/* 轻量访问门禁：适用于 GitHub Pages 等纯静态站点。
   注意：这不是服务端权限控制，不能阻止懂技术者查看公开仓库或直接请求静态文件。 */
(function(){
  if(window.__RW_ACCESS_GATE__) return;
  window.__RW_ACCESS_GATE__ = true;
  var KEY = 'rw_access_ok_v1';
  var EXPECTED = '51ea2f8e80a11e431ef6b0827f602b7857804f185450600ca49d134780085306'; // gsy6067 的 SHA-256
  var meta = document.createElement('meta');
  meta.name = 'robots'; meta.content = 'noindex,nofollow,noarchive';
  document.head.appendChild(meta);
  function isOk(){ try{return sessionStorage.getItem(KEY)==='1';}catch(e){return false;} }
  if(/(?:[?&]logout=1|#logout)/.test(location.href)){
    try{sessionStorage.removeItem(KEY);}catch(e){}
  }
  if(isOk()) return;
  document.documentElement.classList.add('rw-lock');
  var css = document.createElement('style');
  css.textContent = ''
    + 'html.rw-lock body>*:not(.rw-gate){display:none!important;}'
    + '.rw-gate{position:fixed!important;inset:0!important;z-index:2147483647!important;display:flex!important;align-items:center!important;justify-content:center!important;background:#0d1117!important;color:#d7dde8!important;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif!important;}'
    + '.rw-card{width:min(92vw,380px);background:#161b26;border:1px solid #333d52;border-radius:14px;padding:28px;box-shadow:0 18px 60px rgba(0,0,0,.45);box-sizing:border-box;}'
    + '.rw-title{font-size:20px;font-weight:700;color:#fff;margin:0 0 8px;}'
    + '.rw-sub{font-size:12px;color:#8a94a6;line-height:1.7;margin:0 0 18px;}'
    + '.rw-form{display:flex;gap:8px;}'
    + '.rw-input{flex:1;min-width:0;background:#0d1117;border:1px solid #333d52;color:#fff;border-radius:8px;padding:11px 12px;font-size:15px;outline:none;}'
    + '.rw-input:focus{border-color:#d4a944;}'
    + '.rw-btn{background:#d4a944;color:#111;border:0;border-radius:8px;padding:0 18px;font-size:15px;font-weight:700;cursor:pointer;}'
    + '.rw-err{min-height:20px;color:#e5534b;font-size:12px;margin-top:10px;}';
  document.head.appendChild(css);
  function sha256(text){
    if(window.crypto && crypto.subtle){
      return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function(buf){
        return Array.from(new Uint8Array(buf)).map(function(b){return b.toString(16).padStart(2,'0');}).join('');
      });
    }
    return Promise.reject(new Error('当前浏览器不支持安全哈希'));
  }
  function unlock(){
    try{sessionStorage.setItem(KEY,'1');}catch(e){}
    document.documentElement.classList.remove('rw-lock');
    var g=document.querySelector('.rw-gate'); if(g)g.remove();
  }
  window.addEventListener('storage', function(e){ if(e.key===KEY && e.newValue==='1') unlock(); });
  function show(){
    if(isOk()) return unlock();
    var gate=document.createElement('div'); gate.className='rw-gate';
    gate.innerHTML = '<div class="rw-card"><p class="rw-title">宏观研究工作台</p>'
      + '<p class="rw-sub">此页面已设置访问密码。验证仅保存在当前浏览器会话，关闭标签页后需要重新输入。</p>'
      + '<form class="rw-form"><input class="rw-input" type="password" autocomplete="current-password" placeholder="请输入访问密码" aria-label="访问密码"><button class="rw-btn" type="submit">进入</button></form>'
      + '<div class="rw-err" aria-live="polite"></div></div>';
    document.body.appendChild(gate);
    var input=gate.querySelector('.rw-input'), err=gate.querySelector('.rw-err');
    setTimeout(function(){input.focus();},30);
    gate.querySelector('form').addEventListener('submit', function(ev){
      ev.preventDefault(); err.textContent='验证中…';
      sha256(input.value).then(function(h){
        if(h===EXPECTED){ unlock(); }
        else { err.textContent='密码不正确，请重试。'; input.select(); }
      }).catch(function(){ err.textContent='当前浏览器不支持访问验证，请更换浏览器。'; });
    });
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', show);
  else show();
})();
