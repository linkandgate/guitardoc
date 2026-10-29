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

  /* 平板整屏布局要用到站点 sticky 顶栏的高度（CSS 里算不到别的元素多高）：
     把真实高度写进 --kb-md-top，播放器高度 = 视口高 − 顶栏高。
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
    document.documentElement.style.setProperty('--kb-md-top', h + 'px');
  }

  function watchTopOffset() {
    syncTopOffset();
    window.addEventListener('resize', syncTopOffset);
    window.addEventListener('orientationchange', syncTopOffset);
    var bar = document.querySelector('.md-header') || document.querySelector('header');
    if (bar && window.ResizeObserver) {
      try { new ResizeObserver(syncTopOffset).observe(bar); } catch (e) { }
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
    return true;
  }

  function start() {
    root = document.querySelector('.kb-md');
    if (!root) return;
    hint = document.getElementById('emptyHint');
    watchTopOffset();

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
