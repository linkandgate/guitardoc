/* 嵌入版开关 —— 必须在 keyboard-core.js 之前加载
   用在 mkdocs 里（extra_javascript 顺序）或自己的页面里。 */
window.KB_NO_IMPORT = true;     // 不接管站点的拖放导入
window.KB_NO_SPACEKEY = true;   // 不抢空格键（网站要用空格翻页）
window.KB_KEY_RATIO = 0.12;     // 键盘高 ÷ 舞台宽（16:9 横向舞台）
window.KB_SCROLL_SYSTEM = true; // 一组谱装不下时，优先滚到五线谱（光标那行）

/* 简谱里的「中文字体」默认不加载：
   CommonLight / CommonSerif / CommonBlack 每个 2~8MB（Noto Sans SC / UMing / 文泉驿），
   合计约 19MB，而简谱里实际只有 "1=E"、小节号这类 ASCII，真正的曲名在五线谱 SVG 里。
   关掉后这些标签用系统字体，肉眼几乎没差别，首屏字体从 19MB 降到约 0.5MB。
   要恢复：改成 true（或在页面里删掉这行）。 */
window.KB_JP_TEXT_FONTS = false;
