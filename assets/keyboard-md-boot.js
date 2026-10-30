/* 嵌入版播放器的启动脚本 —— 放在 keyboard-core.js 之后加载。
   页面上有 <div class="kb-md" data-song="…"> 就会自动载入数据并初始化。

   data-song  数据文件（相对当前页面；默认 song.data.js）
   ?data=xxx  临时覆盖（调试用）

   注意：这里不改 document.title，免得把网站页面标题改掉。 */
(function () {
  'use strict';

  var root = null;
  var hint = null;

  function hasSong() {
    try { return !!(window.KeyboardPlayer && window.KeyboardPlayer.hasSong()); }
    catch (e) { return false; }
  }

  function showHint(msg) {
    if (!hint) return;
    if (msg) {
      var s = hint.querySelectorAll('span');
      if (s.length) s[0].textContent = msg;
    }
    hint.hidden = false;
  }

  function failHint(msg) {
    if (!hasSong()) showHint(msg);
    try { console.warn('[播放器] ' + msg); } catch (e) { }
  }

  function syncZoom() {
    var zl = document.getElementById('zoomLevel');
    if (!zl || !window.KeyboardPlayer || !window.KeyboardPlayer.getZoom) return;
    zl.textContent = Math.round(window.KeyboardPlayer.getZoom() * 100) + '%';
  }

  var topOffset = 0;   // 站点 sticky 顶栏高度（px）
  var spacer = null;   // 播放器下面垫出来的一段空间，给「滑掉标题」用

  /* 播放器是正文最后一屏，但它上面还有页面标题。要同时满足两件事：
       1) 打开时键盘就在屏内（不能被标题挤到屏幕外，必须下拉才看到）；
       2) 往上滑一下，标题滑走、播放器顶到站点顶栏下面，谱面+键盘占满一屏。
     做法：静止时高度 = 可见高度 − 播放器位置；同时在播放器下面垫出
     「播放器位置 − 顶栏高度」的滚动空间（正好等于标题那一块的高度），
     滑动时播放器高度按滚动量同步加长 —— 屏幕底部始终贴着，标题一路滑出去，
     滑到头播放器顶端正好停在顶栏下面，页面也就到底了。
     高度不能用 100vh 硬算：真机（iPad / Android）工具栏收起时的 100vh 比可见区域大，
     键盘就会被推到屏幕外，所以一律用 innerHeight 量。 */
  function syncFit() {
    var kb = root;
    if (!kb) return;
    var vh = window.innerHeight || document.documentElement.clientHeight || 0;
    if (!vh) return;
    var scroll = window.pageYOffset || 0;
    var docTop = kb.getBoundingClientRect().top + scroll;   // 播放器在文档里的位置
    var room = Math.max(0, Math.round(docTop - topOffset));  // 能滑掉多少（≈ 标题高度）
    var base = Math.round(vh - docTop);                      // 静止时的高度（键盘贴底）
    var min = 360;                                           // 再挤就只剩谱面缝了
    if (base < min) base = min;
    var used = Math.min(Math.max(scroll, 0), room);
    var full = Math.round(vh - topOffset);                   // 滑到头时的整屏高度
    var h = Math.min(base + used, full);
    kb.style.setProperty('--kb-md-fit', h + 'px');

    var sp = ensureSpacer();
    if (sp) sp.style.height = Math.max(0, room - used) + 'px';
  }

  function ensureSpacer() {
    if (spacer && spacer.parentNode) return spacer;
    if (!root || !root.parentNode) return null;
    spacer = document.createElement('div');
    spacer.setAttribute('aria-hidden', 'true');
    spacer.style.cssText = 'height:0;margin:0;padding:0;border:0;background:transparent;' +
      'pointer-events:none;overflow-anchor:none';
    root.parentNode.insertBefore(spacer, root.nextSibling);
    return spacer;
  }

  /* 站点 sticky 顶栏的高度：顶栏会盖住顶部控制条，滑到底时要停在它下面。
     mkdocs material 是 48px，带导航标签栏时 96px；顶栏不吸顶就按 0 算。 */
  function syncTopOffset() {
    var bar = document.querySelector('.md-header') || document.querySelector('header');
    var h = 0;
    if (bar) {
      var pos = '';
      try { pos = getComputedStyle(bar).position; } catch (e) { }
      if (pos === 'fixed' || pos === 'sticky') {
        h = Math.round(bar.getBoundingClientRect().height) || 0;
      }
    }
    topOffset = h;
    document.documentElement.style.setProperty('--kb-md-top', h + 'px');
  }

  function syncLayout() {
    syncTopOffset();
    syncFit();
  }

  function watchLayout() {
    syncLayout();
    // 首屏字体/谱面渲染完再量一次，尺寸会变
    [80, 400, 1200].forEach(function (ms) { setTimeout(syncLayout, ms); });
    window.addEventListener('resize', syncLayout);
    window.addEventListener('orientationchange', syncLayout);
    // 滑动时按滚动量补偿高度：底部不跟着跑，标题才像是被「卷」上去
    window.addEventListener('scroll', syncFit, { passive: true });
    if (window.visualViewport) {
      // 真机工具栏收起/展开、软键盘弹出，只走 visualViewport
      window.visualViewport.addEventListener('resize', syncLayout);
    }
    var bar = document.querySelector('.md-header') || document.querySelector('header');
    if (bar && window.ResizeObserver) {
      try { new ResizeObserver(syncLayout).observe(bar); } catch (e) { }
    }
  }

  function boot(data) {
    if (!data) { showHint(); return false; }
    var ok = false;
    try {
      ok = window.KeyboardPlayer.loadData(data);
    } catch (e) {
      try { console.error('[播放器] 载入失败', e); } catch (e0) { }
      failHint('载入失败：' + (e && e.message ? e.message : e));
    }
    if (!ok) {
      failHint('这个数据文件里没有音符，换一个试试');
      return false;
    }
    if (hint) hint.hidden = true;
    if (root && data.label) root.setAttribute('title', data.label);
    syncZoom();
    syncLayout();          // 谱面渲染会改变高度，载完再量一次
    return true;
  }

  function start() {
    root = document.querySelector('.kb-md');
    if (!root) return;
    hint = document.getElementById('emptyHint');
    watchLayout();

    ['scoreMinus', 'scorePlus'].forEach(function (id) {
      var b = document.getElementById(id);
      if (b) b.addEventListener('click', syncZoom);
    });

    if (!window.KeyboardPlayer) {
      failHint('播放引擎没加载：检查 keyboard-core.js 的路径');
      return;
    }

    if (window.KEYBOARD_DATA) {           // 页面里已经用 <script> 引了数据文件
      boot(window.KEYBOARD_DATA);
      return;
    }

    var src = root.getAttribute('data-song') || 'song.data.js';
    try {
      var q = new URLSearchParams(location.search).get('data');
      if (q) src = q;
    } catch (e2) { }

    var s = document.createElement('script');
    s.src = src;
    s.onload = function () {
      if (!boot(window.KEYBOARD_DATA)) failHint('没能从 ' + src + ' 读到数据');
    };
    s.onerror = function () {
      failHint('数据文件加载失败：' + src);
    };
    document.body.appendChild(s);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
