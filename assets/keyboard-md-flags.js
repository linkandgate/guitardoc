/* 嵌入版开关 —— 必须在 keyboard-core.js 之前加载
   用在 mkdocs 里（extra_javascript 顺序）或自己的页面里。 */
window.KB_NO_IMPORT = true;     // 不接管站点的拖放导入
window.KB_NO_SPACEKEY = true;   // 不抢空格键（网站要用空格翻页）
window.KB_KEY_RATIO = 0.12;     // 键盘高 ÷ 舞台宽（16:9 横向舞台）
window.KB_SCROLL_SYSTEM = true; // 一组谱装不下时，优先滚到五线谱（光标那行）
