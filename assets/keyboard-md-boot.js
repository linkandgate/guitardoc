/* 嵌入版播放器的启动脚本 —— 放在 keyboard-core.js 之后加载。
   页面上有 <div class="kb-md" data-song="…"> 就会自动载入数据并初始化。

   这份 boot 要和 keyboard-core.js 的版本「对得上」：静态播放页（静态播放.html）里
   由页面自己做的三件事，这里都要做，否则同一个 core 在站点页里会表现得不一样：
     1) 数据载入：KEYBOARD_DATA / data-song / ?data= / 直接拖 .js 进来；
     2) 播放器 DOM 对账：core 需要的 #bar/#barfill 等元素缺了就补上
        （mkdocs 页面的播放器 markup 是手写的，容易比静态页少东西）；
     3) 嵌进正文后的尺寸：站点 sticky 顶栏高度、整屏高度、缩放数字。

   data-song     数据文件（相对当前页面；默认 song.data.js）
   ?data=xxx     临时覆盖（调试用）
   data-title    给了这个属性才把 document.title 改成曲名，默认不动站点标题

   注意：core 里的键盘尺寸 / 谱面滚动策略由 window.KB_* 旗标控制，
   站点页里的 keyboard-md-flags.js 和静态播放页不同，想完全一致就把那边的旗标
   调成和静态播放页一样（静态页只设了 KB_NO_IMPORT）。 */
(function () {
  'use strict';

  var root = null;
  var hint = null;

  // ---------- 通用小工具 ----------
  function hasSong() {
    try { return !!(window.KeyboardPlayer && window.KeyboardPlayer.hasSong()); }
    catch (e) { return false; }
  }

  function showHint(msg) {
    if (!hint) return;
    if (msg) {
      var s = hint.querySelectorAll('span');
      if (s.length) s[0].textContent = msg;
      else {
        var b = hint.querySelector('b');
        if (b) b.textContent = msg;
      }
    }
    hint.hidden = false;
  }

  function failHint(msg) {
    if (!hasSong()) showHint(msg);
    try { console.warn('[播放器] ' + msg); } catch (e) { }
  }

  /* 播放器 DOM 对账：静态播放页里有、站点 markdown 里常常漏掉的元素。
     现在补的是进度条（#bar > #barfill）。
     注意：core 在加载时就把 #barfill 取进闭包了，所以页面 markup 里本来就有的
     进度条由 core 自己更新；漏了的话 core 拿到的是假对象，写宽度不落地——
     这时由 boot 自己按 #time 的文本把宽度画上去（见 paintBarFromTime）。
     已经有的不动，页面自己写的优先。 */
  var selfMadeBar = false;

  function ensureUi() {
    if (!root) return;
    var stage = root.querySelector('.stage') || root;
    if (!document.getElementById('bar')) {
      var bar = document.createElement('div');
      bar.id = 'bar';
      var fill = document.createElement('div');
      fill.id = 'barfill';
      bar.appendChild(fill);
      var top = stage.querySelector('.topbar');
      if (top && top.parentNode === stage) stage.insertBefore(bar, top);
      else stage.insertBefore(bar, stage.firstChild);
      selfMadeBar = true;
    } else if (!document.getElementById('barfill')) {
      var f = document.createElement('div');
      f.id = 'barfill';
      document.getElementById('bar').appendChild(f);
      selfMadeBar = true;
    }
  }

  /* 进度条兜底：只在「进度条是 boot 补出来的」时才跑。
     #time 是 core 每帧写的「0:12 / 2:04」，直接拿来算百分比，
     这样不用管 core 内部还剩多少秒，也不会和 core 抢着写同一个元素。 */
  function parseClock(s) {
    var m = /(\d+):(\d{2})/.exec(String(s || ''));
    return m ? (parseInt(m[1], 10) * 60 + parseInt(m[2], 10)) : -1;
  }

  function paintBar() {
    if (!selfMadeBar) return;
    var fill = document.getElementById('barfill');
    var tEl = document.getElementById('time');
    if (!fill || !tEl) return;
    var all = String(tEl.textContent || '').split('/');
    var cur = parseClock(all[0]), tot = parseClock(all[1] || '');
    var pct = (cur >= 0 && tot > 0) ? Math.max(0, Math.min(100, cur / tot * 100)) : 0;
    fill.style.width = pct.toFixed(2) + '%';
  }

  var barPainterOn = false;

  function paintBarFromTime() {
    if (!selfMadeBar || barPainterOn) return;
    barPainterOn = true;
    var tEl = document.getElementById('time');
    if (!tEl) return;
    paintBar();
    if (window.MutationObserver) {
      new MutationObserver(paintBar).observe(tEl, { childList: true, characterData: true, subtree: true });
    } else {
      setInterval(paintBar, 250);
    }
  }

  // ---------- 嵌进正文后的尺寸 ----------
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

  // ---------- 数据载入 ----------
  function boot(data, from) {
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
    var name = data.title || data.label || '';
    if (root) {
      if (name) root.setAttribute('title', name);
      else root.removeAttribute('title');
      if (name && root.getAttribute('data-title') !== null) {
        document.title = name + ' · 键盘播放器';
      }
    }
    ensureUi();
    paintBarFromTime();    // 页面 markup 没带进度条时，由 boot 按 #time 补画
    syncLayout();          // 谱面渲染会改变高度，载完再量一次
    return true;
  }

  function readDataFile(f) {
    if (!f) return;
    var fr = new FileReader();
    fr.onload = function () {
      var txt = String(fr.result || '').replace(/^\uFEFF/, '');
      if (txt.indexOf('KEYBOARD_DATA') < 0) {
        failHint('这个 JS 里没有 KEYBOARD_DATA（不是「导出数据 JS」生成的文件）');
        return;
      }
      var before = window.KEYBOARD_DATA;
      try {
        (new Function(txt))();
      } catch (e) {
        failHint('数据文件执行失败：' + (e && e.message ? e.message : e));
        return;
      }
      if (!window.KEYBOARD_DATA || window.KEYBOARD_DATA === before) {
        failHint('文件里没有可用的 KEYBOARD_DATA');
        return;
      }
      boot(window.KEYBOARD_DATA, f.name);
    };
    fr.onerror = function () { failHint('读取 ' + f.name + ' 失败'); };
    fr.readAsText(f);
  }

  function loadScript(src, done) {
    var s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = function () { done(true); };
    s.onerror = function () { done(false); };
    document.body.appendChild(s);
    return s;
  }

  // ---------- 启动 ----------
  function start() {
    root = document.querySelector('.kb-md');
    if (!root) return;
    hint = document.getElementById('emptyHint');

    if (!window.KeyboardPlayer) {
      failHint('播放引擎没加载：检查 keyboard-core.js 的路径');
      return;
    }
    ensureUi();
    watchLayout();



    // 1) 页面里已经用 <script> 引了数据文件
    if (window.KEYBOARD_DATA) { boot(window.KEYBOARD_DATA, 'KEYBOARD_DATA'); }
    else {
      // 2) ?data= 临时覆盖，否则 data-song
      var src = root.getAttribute('data-song') || 'song.data.js';
      try {
        var q = new URLSearchParams(location.search).get('data');
        if (q) src = q;
      } catch (e2) { }
      loadScript(src, function (ok) {
        if (!ok) { failHint('数据文件加载失败：' + src); return; }
        if (!boot(window.KEYBOARD_DATA, src)) failHint('没能从 ' + src + ' 读到数据');
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
