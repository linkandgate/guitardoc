/* 简谱渲染所需字体清单（字体走 jsdelivr CDN）。
   只暴露数据；真正的 loadFonts 调用在页面里做，避免依赖 renderDocument。 */
window.fontLoadData = [{ "name": "CommonLight", "url": "noto_sans_sc_light/noto_sans_sc_light.woff2", "weight": "normal" }, { "name": "CommonLight", "url": "noto_sans_sc_light/noto_sans_sc_light-transformed-bold.woff2", "weight": "bold" }, { "name": "CommonSerif", "url": "uming_cn_dotfix/uming_cn_dotfix.woff2", "weight": "normal" }, { "name": "CommonSerif", "url": "uming_cn_dotfix/uming_cn_dotfix-transformed-bold.woff2", "weight": "bold" }, { "name": "CommonBlack", "url": "wqy_microhei/wqy_microhei.woff2", "weight": "normal" }, { "name": "Roman", "url": "roman/roman.woff2", "weight": "normal" }, { "name": "Roman", "url": "roman/roman-transformed-bold.woff2", "weight": "bold" }, { "name": "RomanItalic", "url": "roman_italic/roman_italic.woff2", "weight": "normal" }, { "name": "SparksNMN-EOPNumber", "url": "eop_number/eop_number.ttf", "weight": "normal" }, { "name": "SparksNMN-mscore-20", "url": "mscore-20/mscore-20.ttf", "weight": "normal" }, { "name": "SparksNMN-Bravura", "url": "bravura/bravura.woff", "weight": "normal" }]
window.fontCdnRoot = 'https://cdn.jsdmirror.com/gh/yezhiyi9670/sparks-notation-1@latest/packages/static-resources/core-resources/font'

   /* 字体根目录：按本脚本自己的地址推算（例如 .../docs/assets/jianpu-fonts.js → .../docs/assets/fonts/）。
      这样 note.md 在 docs/notes/a/b/ 这种多层目录里、页面地址变成 /notes/a/b/ 之后，
      @font-face 里的字体仍然指向 docs/assets/fonts，而不是 /notes/a/b/assets/fonts。
      也可以在页面里先设 window.fontLocalRoot 覆盖（比如走 CDN）。 */
   ; (function () {
      var src = (document.currentScript && document.currentScript.src) || '';
      if (!src) {
         var all = document.getElementsByTagName('script');
         for (var i = 0; i < all.length; i++) {
            if (/jianpu-fonts\.js(\?|$)/.test(all[i].src)) { src = all[i].src; break; }
         }
      }
      if (!window.fontLocalRoot) {
         window.fontLocalRoot = src ? src.replace(/[^/]*$/, '') + 'fonts/' : 'assets/fonts/';
      }
   })();
