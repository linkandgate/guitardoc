/* 简谱渲染所需字体清单 + 字体来源。
   当前：**强制走远程 CDN**（即使本地 assets/fonts 存在也不读）。
   只暴露数据；真正的 loadFonts 调用在页面里做，避免依赖 renderDocument。

   注意：fontLoadData 必须是「数组」，每项 { name, url, weight }，url 是相对字体根目录的路径。
   换 CDN 只改下面的 fontRootList，不要动这个数组。 */
window.fontLoadData = [{ "name": "CommonLight", "url": "noto_sans_sc_light/noto_sans_sc_light.woff2", "weight": "normal" }, { "name": "CommonLight", "url": "noto_sans_sc_light/noto_sans_sc_light-transformed-bold.woff2", "weight": "bold" }, { "name": "CommonSerif", "url": "uming_cn_dotfix/uming_cn_dotfix.woff2", "weight": "normal" }, { "name": "CommonSerif", "url": "uming_cn_dotfix/uming_cn_dotfix-transformed-bold.woff2", "weight": "bold" }, { "name": "CommonBlack", "url": "wqy_microhei/wqy_microhei.woff2", "weight": "normal" }, { "name": "Roman", "url": "roman/roman.woff2", "weight": "normal" }, { "name": "Roman", "url": "roman/roman-transformed-bold.woff2", "weight": "bold" }, { "name": "RomanItalic", "url": "roman_italic/roman_italic.woff2", "weight": "normal" }, { "name": "SparksNMN-EOPNumber", "url": "eop_number/eop_number.ttf", "weight": "normal" }, { "name": "SparksNMN-mscore-20", "url": "mscore-20/mscore-20.ttf", "weight": "normal" }, { "name": "SparksNMN-Bravura", "url": "bravura/bravura.woff", "weight": "normal" }]

/* ===== 字体源：强制 CDN =====
   @font-face 的 src 会把这些地址全部列出来，浏览器按顺序尝试，哪个能下载成功就用哪个。
   这里不列任何本地路径，所以 assets/fonts 不会被请求。
   想改回「本地优先」：把 fontRootList 删掉（或设成 null），
   然后 fontLocalRoot = window.fontLocalFallback、fontCdnRoot = 下面第一个地址即可。 */
window.fontRootList = [
   'https://fastly.jsdelivr.net/gh/yezhiyi9670/sparks-notation-1@latest/packages/static-resources/core-resources/font/',
   'https://cdn.jsdelivr.net/gh/yezhiyi9670/sparks-notation-1@latest/packages/static-resources/core-resources/font/'
   // 国内镜像（2026-10-28 起证书过期，续期后可以解注作为第三兜底）：
   // 'https://jsd.onmicrosoft.cn/gh/yezhiyi9670/sparks-notation-1@latest/packages/static-resources/core-resources/font/'
];

/* 兼容旧变量：引擎在没有 fontRootList 时才读它们，这里也指向 CDN，保持一致 */
window.fontLocalRoot = window.fontRootList[0];
window.fontCdnRoot = '';

/* 提前和 CDN 建立连接（省掉一次 TLS 握手，字体能早 100~300ms 开始下载）。
   对每个字体源只在 head 里加一次 <link rel=preconnect crossorigin>。 */
; (function () {
   var head = document.head || document.getElementsByTagName('head')[0];
   if (!head) return;
   var seen = {};
   var roots = window.fontRootList || [];
   for (var i = 0; i < roots.length; i++) {
      try {
         var o = new URL(roots[i], location.href).origin;
         if (!o || seen[o]) continue;
         seen[o] = 1;
         var l = document.createElement('link');
         l.rel = 'preconnect';
         l.href = o;
         l.crossOrigin = 'anonymous';
         head.appendChild(l);
      } catch (e) { }
   }
})();

/* 本地字体目录：只做「回退用」记录，当前不参与加载。
   按本脚本自己的地址推算（.../docs/assets/jianpu-fonts.js → .../docs/assets/fonts/）。 */
; (function () {
   var src = (document.currentScript && document.currentScript.src) || '';
   if (!src) {
      var all = document.getElementsByTagName('script');
      for (var i = 0; i < all.length; i++) {
         if (/jianpu-fonts\.js(\?|$)/.test(all[i].src)) { src = all[i].src; break; }
      }
   }
   window.fontLocalFallback = src ? src.replace(/[^/]*$/, '') + 'fonts/' : 'assets/fonts/';
})();
