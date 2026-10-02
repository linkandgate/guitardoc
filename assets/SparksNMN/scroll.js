(function () {
    'use strict';
    const panel = document.getElementById('auto-scroll-panel');
    const speedInput = document.getElementById('auto-scroll-speed');
    const btn = document.getElementById('auto-scroll-btn');
    const resetBtn = document.getElementById('auto-scroll-reset');

    let running = false;
    let rafId = null;
    let lastTime = 0;
    let accum = 0;   // 累积不足 1px 的位移，避免低速时抖动

    /** 获取速度（px/s） */
    function getSpeed() {
        let s = parseFloat(speedInput.value);
        if (!isFinite(s) || s <= 0) s = 50;
        return s;
    }

    /** 单帧回调 */
    function step(now) {
        if (!running) return;

        if (!lastTime) lastTime = now;
        const dt = Math.min((now - lastTime) / 1000, 0.1); // 限制单帧最大 100ms，防止切后台后跳变
        lastTime = now;

        accum += getSpeed() * dt;

        const pixels = Math.floor(accum);
        if (pixels > 0) {
            accum -= pixels;
            window.scrollBy(0, pixels);
        }

        // 到页面底部自动停止
        const maxY = document.documentElement.scrollHeight - window.innerHeight;
        if (window.scrollY >= maxY - 1) {
            stop();
            return;
        }

        rafId = requestAnimationFrame(step);
    }

    function start() {
        if (running) return;
        running = true;
        lastTime = 0;
        accum = 0;
        btn.textContent = '停止';
        resetBtn.style.display = '';
        rafId = requestAnimationFrame(step);
    }

    function stop() {
        running = false;
        if (rafId) cancelAnimationFrame(rafId);
        rafId = null;
        btn.textContent = '开始';
    }

    function toggle() {
        running ? stop() : start();
    }

    // 按钮点击
    btn.addEventListener('click', toggle);

    // 回到顶部
    resetBtn.addEventListener('click', function () {
        stop();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        resetBtn.style.display = 'none';
    });

    // 空格键快捷开关（输入框聚焦时不触发）
    document.addEventListener('keydown', function (e) {
        if (e.code !== 'Space' && e.key !== ' ') return;
        const tag = (e.target && e.target.tagName) || '';
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON') return;
        e.preventDefault();
        toggle();
    });

    // 页面滚动条被用户手动拖动/滚轮滚动时，可以保持运行；如果需要手动暂停，取消下面的注释
    // window.addEventListener('wheel', stop, { passive: true });
    // window.addEventListener('touchstart', stop, { passive: true });
})();