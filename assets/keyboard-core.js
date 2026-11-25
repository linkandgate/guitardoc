/* 键盘演示 / 键盘播放器共用的播放引擎
   来源：save-jp-keyboard/keyboard-svg-vertical.html 原本内联的 IIFE。
   页面里放齐它需要的 DOM（见 keyboard-svg-vertical.html / keyboard-player.html），
   再引入本文件，右侧舞台（五线谱 + 简谱 + 键盘 + 播放）就能直接跑。
   数据接口：window.KeyboardPlayer.exportData() / download() / loadData(data)
   数据文件：window.KEYBOARD_DATA = { ... }（「导出数据 JS」按钮生成） */
    (function () {
      'use strict';

      // ---------- DOM ----------
      // 演示页和播放页共用这份引擎，但两边 DOM 不一样：播放页只保留舞台 + 控制条，
      // 其它的（导入按钮、导出视频、状态栏、图例…）都没有。这里用 ui() 取元素，
      // 取不到就给一个「空元素」顶着 —— 相关功能自然失效，但不会报错。
      function ui(id, fallback) {
        var el = document.getElementById(id);
        if (el) return el;
        var o = {
          style: {}, className: '', textContent: '', innerHTML: '',
          value: '', checked: false, disabled: false, hidden: false, options: [],
          classList: {
            add: function () { }, remove: function () { },
            toggle: function () { }, contains: function () { return false; }
          },
          addEventListener: function () { },
          removeEventListener: function () { },
          appendChild: function () { return null; },
          querySelector: function () { return null; },
          querySelectorAll: function () { return []; },
          getBoundingClientRect: function () {
            return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
          }
        };
        if (fallback) {
          for (var k in fallback) o[k] = fallback[k];
        }
        return o;
      }

      var keysRoot = ui('keys');
      var fileInput = ui('file');
      var playBtn = ui('playBtn');
      var restartBtn = ui('restartBtn');
      var soundChk = ui('soundChk', { checked: true });
      var labelChk = ui('labelChk', { checked: true });
      var colorModeSel = ui('colorMode', { value: 'octave' });
      var fullChk = ui('fullChk', { checked: true });
      var startMeasSel = document.getElementById('startMeas');
      var volInput = ui('vol', { value: '100' });
      var statusEl = ui('status');
      var timeEl = ui('time');
      var barfill = ui('barfill');
      var legendEl = ui('legend');
      var expBtn = ui('expBtn');

      // ---------- 键盘绘制 ----------
      var BLACK = { 1: 1, 3: 1, 6: 1, 8: 1, 10: 1 };
      // 黑键命名沿用教学惯例：D♭ E♭ F♯ A♭ B♭
      var NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
      var keyEls = {};          // midi -> element
      var viewLow = 21, viewHigh = 108;
      // 黑键比例：固定值，不提供滑块。页面键盘与视频导出共用这两个数。
      var KW = 0.75;            // 黑键宽度 ÷ 白键宽度
      var KH = 0.56;            // 黑键长度 ÷ 白键长度

      function isWhite(m) { return !BLACK[m % 12]; }
      function noteName(m) { return NAMES[m % 12] + (Math.floor(m / 12) - 1); }

      // 按下时的配色方案
      var COLOR_MODE = 'octave';

      // 每个八度一种颜色：低八度蓝紫 → 高八度红，全部取深色（明度 42%）
      function octaveHue(o) {
        return Math.round(265 - Math.max(0, Math.min(8, o)) * 33.125);
      }
      function octaveColor(m) {
        var o = Math.floor(m / 12) - 1;                 // A0~B0 → 0，C8 → 8
        return 'hsl(' + octaveHue(o) + ', 66%, 42%)';
      }

      // 音区配色：低音蓝紫 → 高音红，连续渐变
      function pitchHue(m) {
        var t = Math.max(0, Math.min(1, (m - 21) / 87));
        return 250 - 250 * t;
      }
      function pitchColor(m) {
        return 'hsl(' + Math.round(pitchHue(m)) + ', 68%, 44%)';
      }

      function colorOf(n) {
        if (COLOR_MODE === 'octave') return octaveColor(n.midi);
        if (COLOR_MODE === 'track') return n.trackColor || '#2f81f7';
        if (COLOR_MODE === 'keytype') return isWhite(n.midi) ? '#2f81f7' : '#ffb86b';
        if (COLOR_MODE === 'pitch') return pitchColor(n.midi);
        return '#2f81f7';                               // uniform
      }

      // 只画 low~high（两端都落在白键上），像教学键盘那样一段一段地看
      function buildKeyboard(low, high) {
        low = Math.max(21, Math.min(108, low));
        high = Math.min(108, Math.max(low + 12, high));
        while (low > 21 && !isWhite(low)) low--;
        while (high < 108 && !isWhite(high)) high++;

        var items = [], wi = 0, m;
        for (m = low; m <= high; m++) {
          if (isWhite(m)) { items.push({ m: m, black: false, wi: wi }); wi++; }
          else items.push({ m: m, black: true, wi: wi - 1 });
        }

        var W = 100 / wi;                       // 一个白键的宽度（百分比）
        var pxW = keysRoot.clientWidth / wi;    // 一个白键的像素宽，用来定字号
        var fWhite = Math.max(7, Math.min(11, pxW * 0.36));
        var fBlack = Math.max(6, Math.min(9, pxW * 0.30));
        var blackNarrow = (pxW * KW) < 15;      // 黑键太窄时省掉八度数字

        keysRoot.innerHTML = '';
        keyEls = {};
        prevOn = {};
        pressedStyle = {};

        items.forEach(function (it) {
          var d = document.createElement('div');
          d.className = 'key ' + (it.black ? 'black' : 'white');
          d.dataset.midi = String(it.m);   // 供外部校验/工具识别键位（不影响渲染）
          if (it.black) {
            var bw = W * KW, cx = (it.wi + 1) * W;
            d.style.left = (cx - bw / 2) + '%';
            d.style.width = 'calc(' + bw + '% + 0.4px)';
            d.style.height = (KH * 100) + '%';
          } else {
            // 宽度多给 0.5px：百分比定位在小数累加时会出现亚像素缝隙
            // （表现就是某两个键之间露出一条背景线），重叠一点即可消除。
            d.style.left = (it.wi * W) + '%';
            d.style.width = 'calc(' + W + '% + 0.5px)';
          }
          var lab = document.createElement('span');
          lab.className = 'lab';
          // 键太窄时整体隐藏；能显示时一律带音区（C4 / D4），不再退化成纯字母
          var tooNarrow = pxW < 11;
          if (it.black || tooNarrow) {
            lab.textContent = '';
            lab.style.visibility = 'hidden';
          } else {
            lab.textContent = noteName(it.m);
            lab.style.fontSize = fWhite + 'px';
            lab.style.visibility = labelChk.checked ? 'visible' : 'hidden';
          }
          d.appendChild(lab);
          keysRoot.appendChild(d);
          keyEls[it.m] = d;
        });

        viewLow = low;
        viewHigh = high;
      }

      // 按曲子实际用到的音域取景，至少 2 个八度
      function fitRange(list) {
        var lo = 108, hi = 21;
        list.forEach(function (n) {
          if (n.midi < lo) lo = n.midi;
          if (n.midi > hi) hi = n.midi;
        });
        if (hi - lo < 24) {
          var pad = Math.ceil((24 - (hi - lo)) / 2);
          lo -= pad; hi += pad;
        }
        return [Math.max(21, lo), Math.min(108, hi)];
      }

      buildKeyboard(viewLow, viewHigh);

      // ---------- 状态 ----------
      var notes = [];        // { midi, time, dur, vel, color }
      var total = 0;         // 总时长（秒）
      var prevOn = {};       // 上一帧亮着的键
      var active = [];       // 正在响的音符（增量维护，避免每帧扫全表）
      var recentOn = [];     // 最近 0.2 秒内新按下的音符（做回弹用）
      var pressedStyle = {}; // midi -> 已写入的 transform，避免重复赋值
      var lastUi = 0;        // 进度条/时间文字的上次刷新时间
      var schedPtr = 0;      // 已调度的音符下标
      var visPtr = 0;        // 已触发过弹奏动效的音符下标
      var lastStart = {};    // midi -> 最近一次按下的时间（画布导出用）
      var startTime = 0;     // 音乐 0 时刻对应的 audioContext 时间
      var playing = false;
      var nodes = [];        // 已创建的振荡器，用于重播时清理

      // ---------- 音频 ----------
      var ac = null, master = null, pianoWave = null;
      var capDest = null;    // 录音用：master → 这个节点 → MediaStream（期间断开扬声器）

      function ensureAudio() {
        if (!ac) {
          var Ctx = window.AudioContext || window.webkitAudioContext;
          if (!Ctx) return false;
          try { ac = new Ctx({ latencyHint: 'playback' }); }   // 缓冲大一点，少爆音
          catch (e) { ac = new Ctx(); }
          master = ac.createGain();
          master.gain.value = (volInput.value / 100) * 0.9;
          master.connect(ac.destination);
          // 一次性生成的谐波波表：比每个音符叠两三个振荡器省得多
          try {
            pianoWave = ac.createPeriodicWave(
              new Float32Array([0, 1, 0.45, 0.22, 0.11, 0.05]),
              new Float32Array(6)
            );
          } catch (e) { pianoWave = null; }
        }
        if (ac.state === 'suspended') ac.resume();
        return true;
      }

      // 录音用音频出口：on=true 返回 MediaStream（同时断开扬声器，录的时候不出声）；
      // on=false 复原扬声器。外部录制脚本用它拿音轨，和画面合成一条片子。
      function audioTap(on) {
        if (!ensureAudio()) return null;
        if (!capDest) capDest = ac.createMediaStreamDestination();
        if (on) {
          try { master.disconnect(ac.destination); } catch (e) { }
          try { master.connect(capDest); } catch (e) { }
          return capDest.stream;
        }
        try { master.disconnect(capDest); } catch (e) { }
        try { master.connect(ac.destination); } catch (e) { }
        return null;
      }

      // 每个音符只建 2 个节点（振荡器 + 增益），减少音频图抖动
      function playNote(n, when) {
        if (!ac) return;
        var t = Math.max(when, ac.currentTime + 0.005);
        var f = 440 * Math.pow(2, (n.midi - 69) / 12);
        var dur = n.dur;
        var peak = 0.18 * Math.max(0.15, Math.min(1, n.vel || 0.8));

        var g = ac.createGain();
        g.connect(master);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(peak, t + 0.008);
        g.gain.exponentialRampToValueAtTime(peak * 0.4, t + 0.12);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.35);

        var o = ac.createOscillator();
        if (pianoWave) o.setPeriodicWave(pianoWave);
        else o.type = 'triangle';
        o.frequency.value = f;
        o.connect(g);

        var end = t + dur + 0.4;
        o.start(t);
        o.stop(end);
        nodes.push(o);

        if (nodes.length > 900) nodes = nodes.slice(450); // 只留引用，已调度的节点由引擎回收
      }

      function stopAllNodes() {
        nodes.forEach(function (o) { try { o.stop(); } catch (e) { } });
        nodes = [];
      }

      // ---------- 高亮 ----------
      function clearHighlights() {
        for (var m in prevOn) {
          if (keyEls[m]) keyEls[m].classList.remove('on');
        }
        prevOn = {};
        for (var k in pressedStyle) {
          if (keyEls[k]) keyEls[k].style.transform = '';
        }
        pressedStyle = {};
        clearScoreHi();
        try { jpClearAll(); } catch (eCH) { }   // 简谱高亮也一并收掉（重播/换曲时别留着上一次的亮块）
        gPtr = -1;          // 下一个 tick 重新定位到「当前该在的那一组」
        gLastK = -1;
      }

      // ---------- 主循环 ----------
      function tick() {
        if (!playing) return;
        var t = ac.currentTime - startTime;
        var i, n, m, el;

        // 0) 谱面播放框 / 简谱高亮：按「音符组」推进（同一拍的和弦 / 琶音算一组，只挪一次）。
        //    这里用播放时间驱动，所以某一组在谱面上没配上时，也会照常切到下一组。
        //    没有 MusicXML（score 为空）时退回「按 MIDI 音符顺序推」的老办法。
        var gok = false;
        try { if (svgReady) gok = syncGroupCursor(t); } catch (eGrp) { }
                try { jpHiFollowActive(); } catch (eHiF) { }
        // 谱面滚动：按播放时间连续驱动，快到下一行时慢慢滚（见 scrollYAt）
        try { applyScrollAt(t); } catch (eScr) { }
        if (!gok) {
          try {
            if (svgReady && visPtr > 0) {
              var kFb = svgIndexForMidi(visPtr - 1);
              if (kFb >= 0 && kFb !== gLastK) {
                clearSvgHi();
                paintSvgAt(kFb);
                positionSvgCursorAt(kFb);
                gLastK = kFb;
              }
            }
          } catch (eSvgFb) { }
        }

        // 1) 提前 0.6 秒把音符排进音频图（留给主线程足够的余量）
        while (schedPtr < notes.length && notes[schedPtr].time <= t + 0.6) {
          n = notes[schedPtr++];
          if (soundChk.checked) playNote(n, startTime + n.time);
        }

        // 1.5) 新按下的音符：记录时刻，并塞进“正在响”的活动表
        //      （用下标推进 + 活动表，避免每帧扫描整首曲子的所有音符）
        while (visPtr < notes.length && notes[visPtr].time <= t) {
          n = notes[visPtr++];
          n.__mi = visPtr - 1;
          lastStart[n.midi] = n.time;
          active.push(n);
          recentOn.push(n);
          try { hitScore(visPtr - 1, n, t); } catch (eScore) { }   // 谱面出错也不影响播放
        }
        expireScore(t);

        // 1.6) 清理已经结束 / 已经过了弹跳窗口的
        for (i = active.length - 1; i >= 0; i--) {
          if (t >= active[i].time + active[i].dur) active.splice(i, 1);
        }
        for (i = recentOn.length - 1; i >= 0; i--) {
          if (t - recentOn[i].time > 0.2) recentOn.splice(i, 1);
        }

        // 2) 当前按下的键
        var cur = {}, curColor = {};
        for (i = 0; i < active.length; i++) {
          cur[active[i].midi] = 1;
          curColor[active[i].midi] = colorOf(active[i]);
        }

        // 3) 只对变化做 DOM 操作
        for (m in cur) {
          if (!prevOn[m]) {
            el = keyEls[m];
            if (el) {
              if (curColor[m]) el.style.setProperty('--c', curColor[m]);
              el.classList.add('on');
            }
          }
        }
        for (m in prevOn) {
          if (!cur[m]) {
            el = keyEls[m];
            if (el) el.classList.remove('on');
          }
        }
        prevOn = cur;

        // 3.5) 按压位移：按下 1px，新按下再叠一个 3px 的回弹
        //      直接在 rAF 里写 transform，不再用 WAAPI（每音符一个动画对象会很吃 CPU）
        var want = {}, e, d;
        for (m in cur) want[m] = 1;
        for (i = 0; i < recentOn.length; i++) {
          n = recentOn[i];
          e = t - n.time;
          if (e >= 0 && e < 0.14) {
            d = 1 + 3 * (1 - e / 0.14);
            if (!(n.midi in want) || want[n.midi] < d) want[n.midi] = d;
          }
        }
        for (m in want) {
          var tr = 'translateY(' + want[m].toFixed(2) + 'px)';
          if (pressedStyle[m] !== tr) {
            el = keyEls[m];
            if (el) { el.style.transform = tr; pressedStyle[m] = tr; }
          }
        }
        for (m in pressedStyle) {
          if (!(m in want)) {
            el = keyEls[m];
            if (el) el.style.transform = '';
            delete pressedStyle[m];
          }
        }

        // 4) 进度（10Hz 就够，不用每帧写 DOM）
        var nowMs = (window.performance && performance.now) ? performance.now() : Date.now();
        if (nowMs - lastUi > 90) {
          lastUi = nowMs;
          barfill.style.width = (total > 0 ? Math.max(0, Math.min(100, t / total * 100)) : 0) + '%';
          timeEl.textContent =
            (curMeasureNo >= 0 ? '第 ' + (curMeasureNo + 1) + ' 小节 · ' : '') +
            fmt(t) + ' / ' + fmt(total);
        }

        // 4.4) 底部字幕：按曲长平均分给每一行，播放到哪行显示哪行
        try { updateCaption(t); } catch (eCap) { }

        // 4.5) 导出中：每帧都要画（这个不能节流）
        if (STG && STG.on) {
          stgTick(t, cur, curColor);      // 舞台录制：canvas 重绘 + WebCodecs 编码
        }

        // 5) 结束
        if (t > total + 0.6) {
          playing = false;
          playBtn.textContent = '播放';
          try { document.body.classList.toggle('cleanplay', !!playing); } catch (eCP) { }
          startTime = 0; schedPtr = 0; visPtr = 0;
          lastStart = {};
          active = [];
          recentOn = [];
          clearHighlights();
          stopAllNodes();
          if (exporting) stopExport(true);
          return;
        }
        requestAnimationFrame(tick);
      }

      function fmt(s) {
        s = Math.max(0, s || 0);
        var m = Math.floor(s / 60), r = Math.floor(s % 60);
        return m + ':' + (r < 10 ? '0' : '') + r;
      }

      // ---------- 控制 ----------
      // ---------------- 从指定小节开始 ----------------
      var playFromTime = 0;

      // 第一个 time >= t 的音符下标
      function firstNoteIndexAtOrAfter(t) {
        var lo = 0, hi = notes.length - 1, ans = notes.length;
        while (lo <= hi) {
          var mid = (lo + hi) >> 1;
          if (notes[mid].time >= t - 1e-6) { ans = mid; hi = mid - 1; }
          else lo = mid + 1;
        }
        return ans;
      }

      // 第 m 小节（1 基）对应的播放时间
      function measureStartTime(m) {
        if (!notes.length) return 0;
        var mi = Math.max(0, (parseInt(m, 10) || 1) - 1);
        if (mi <= 0) return 0;                       // 第一小节：从头
        if (!score || !score.notes || !score.notes.length) return 0;
        if (!scoreMap) return 0;
        var i, best = -1;
        for (i = 0; i < notes.length; i++) {
          var si = scoreMap[i];
          if (si < 0) continue;
          var rec = score.notes[si];
          if (rec && rec.measure >= mi) { best = i; break; }
        }
        if (best < 0) return 0;
        return Math.max(0, notes[best].time - 0.2);  // 提前一点点，别把第一个音切掉
      }

      // 让五线谱框和简谱高亮立刻落到「起播位置」，两者用同一个音符下标
      function previewAtTime(t) {
        if (!notes.length || !flowReady) return;
        var idx = firstNoteIndexAtOrAfter(t);
        if (idx >= notes.length) idx = notes.length - 1;
        if (idx < 0) return;
        if (!scoreMap || scoreMap[idx] < 0) return;
        // 优先按「组」落位（和弦 / 琶音整组一起亮；后面播到下一组时也从这里接着走）
        try { if (seekGroupToScore(scoreMap[idx])) return; } catch (eG) { }
        var k = svgIndexOfScore(scoreMap[idx]);
        if (k < 0) return;
        try { clearSvgHi(); paintSvgAt(k); positionSvgCursorAt(k, scoreMap[idx]); } catch (e) { }
      }

      // 填小节下拉框
      function refreshMeasureOptions() {
        if (!startMeasSel) return;
        var n = (score && score.measures) ? score.measures : 0;
        var ok = n > 0 && notes.length > 0 && !!scoreMap;
        var cur = parseInt(startMeasSel.value, 10) || 1;
        startMeasSel.innerHTML = '';
        for (var i = 1; i <= Math.max(1, n); i++) {
          var o = document.createElement('option');
          o.value = String(i);
          o.textContent = String(i);
          startMeasSel.appendChild(o);
        }
        startMeasSel.disabled = !ok;
        if (ok && cur >= 1 && cur <= n) startMeasSel.value = String(cur);
        var row = document.getElementById('startMeasRow');
        if (row) row.title = ok ? '从指定小节开始播放' : '需要同时载入 MusicXML 与 MIDI 才能按小节定位';
        playFromTime = ok ? measureStartTime(parseInt(startMeasSel.value, 10) || 1) : 0;
      }

      // 选中小节后：停下来、把播放位置挪到该小节，并立刻让框/高亮对齐
      function applyStartMeasure() {
        var v = parseInt(startMeasSel && startMeasSel.value, 10) || 1;
        playFromTime = measureStartTime(v);
        playing = false;
        playBtn.textContent = '播放';
        try { document.body.classList.toggle('cleanplay', false); } catch (e) { }
        try { if (ac) ac.suspend(); } catch (e2) { }
        stopAllNodes();
        startTime = 0;
        schedPtr = firstNoteIndexAtOrAfter(playFromTime);
        visPtr = schedPtr;
        lastStart = {};
        active = [];
        recentOn = [];
        curMeasureNo = -1;
        try { clearHighlights(); } catch (e3) { }
        barfill.style.width = (total > 0 ? Math.min(100, playFromTime / total * 100) : 0) + '%';
        timeEl.textContent = fmt(playFromTime) + ' / ' + fmt(total);
        try { previewAtTime(playFromTime); } catch (e4) { }
        if (statusEl) statusEl.textContent = '将从第 ' + v + ' 小节开始（' + fmt(playFromTime) + '）';
      }

      function togglePlay() {
        if (!notes.length) return;
        if (playing) {
          playing = false;
          playBtn.textContent = '播放';
          try { document.body.classList.toggle('cleanplay', !!playing); } catch (eCP) { }
          if (ac) ac.suspend();
          return;
        }
        if (!ensureAudio()) {
          statusEl.textContent = '当前浏览器不支持 Web Audio';
          return;
        }
        if (startTime === 0) {
          var _from = playFromTime || 0;
          startTime = ac.currentTime + 0.15 - _from;
          schedPtr = firstNoteIndexAtOrAfter(_from);
          visPtr = schedPtr;
          active = [];
          recentOn = [];
          clearHighlights();
        }
        ac.resume();
        playing = true;
        playBtn.textContent = '暂停';
        try { document.body.classList.toggle('cleanplay', !!playing); } catch (eCP) { }
        requestAnimationFrame(tick);
      }

      function restart() {
        playing = false;
        playBtn.textContent = '播放';
        try { document.body.classList.toggle('cleanplay', !!playing); } catch (eCP) { }
        stopAllNodes();
        if (ac) ac.suspend();
        startTime = 0;
        schedPtr = firstNoteIndexAtOrAfter(playFromTime || 0);
        visPtr = schedPtr;
        lastStart = {};
        active = [];
        recentOn = [];
        clearHighlights();
        barfill.style.width = (total > 0 ? Math.min(100, (playFromTime || 0) / total * 100) : 0) + '%';
        curMeasureNo = -1; try { clearSvgHi(); hideFlowCursor(); } catch (e) { }
        timeEl.textContent = fmt(playFromTime || 0) + ' / ' + fmt(total);
        try { previewAtTime(playFromTime || 0); } catch (e5) { }
      }

      // ---------- 导出视频（canvas 渲染 + MediaRecorder） ----------
      var exporting = false;

      function downloadBlob(blob, name) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 5000);
      }

      // ---------- 导出视频（MP4）：WebCodecs 编码 + mp4-muxer 封装 ----------
      // 由 recordStage() 驱动：舞台被 canvas 逐帧重画（stgRenderFrame），
      //   画布帧 → VideoEncoder(H.264) ┐
      //   播放音频 → AudioEncoder(AAC) ┴→ mp4-muxer → Blob → 上传给本地服务
      var mp4 = {
        on: false, muxer: null, venc: null, aenc: null,
        t0: 0, nextUs: 0, frameUs: 0, fps: 30,
        vCount: 0, aCount: 0, chunks: [], frames: 0,
        sampleRate: 48000, sp: null, spZero: null, wantAudio: false, err: ''
      };

      function mp4MuxerLib() { return window.Mp4Muxer || null; }

      function pickAvcCodec(w, h, fps) {
        // H.264 High profile。Chrome 112 的 H.264 编码器只认 avc1.640028 这一档，
        // 写成 level 4.2/5.0 会报 "Encoder initialization error."，所以固定用它。
        return 'avc1.640028';
      }

      // 屏幕共享的画面比 DOM 晚一点出来（编码/合成有延迟），声音是按实时的，
      // 所以默认在音频**前面补 syncMs 的静音**，让声画对齐；成片里声音快了就调大，慢了就调小。
      function startPcmCapture(syncMs) {
        stopPcmCapture();
        if (!ac || !master) return;
        mp4.sampleRate = Math.round(ac.sampleRate || 48000);
        mp4.chunks = [];
        mp4.frames = 0;
        var pad = Math.max(0, Math.round((parseFloat(syncMs) || 0) / 1000 * mp4.sampleRate));
        if (pad > 0) {
          mp4.chunks.push(new Float32Array(pad));
          mp4.chunks.push(new Float32Array(pad));
          mp4.frames += pad;
        }
        try {
          var sp = ac.createScriptProcessor(4096, 2, 2);
          sp.onaudioprocess = function (ev) {
            if (!mp4.on) return;
            var ib = ev.inputBuffer;
            var n = ib.length;
            var c0 = ib.getChannelData(0);
            var c1 = ib.numberOfChannels > 1 ? ib.getChannelData(1) : c0;
            var L = new Float32Array(n), R = new Float32Array(n);
            L.set(c0);
            R.set(c1);
            mp4.chunks.push(L);
            mp4.chunks.push(R);
            mp4.frames += n;
          };
          var zero = ac.createGain();
          zero.gain.value = 0;
          master.connect(sp);
          sp.connect(zero);
          zero.connect(ac.destination);
          mp4.sp = sp;
          mp4.spZero = zero;
        } catch (e) { mp4.sp = null; }
      }

      function stopPcmCapture() {
        try { if (mp4.sp) mp4.sp.disconnect(); } catch (e) { }
        try { if (mp4.spZero) mp4.spZero.disconnect(); } catch (e2) { }
        try { if (mp4.sp && master) master.disconnect(mp4.sp); } catch (e3) { }
        mp4.sp = null;
        mp4.spZero = null;
      }

      // 把录到的 PCM 拼成 AudioData 喂给 AAC 编码器
      function encodeCapturedAudio() {
        var AE = window.AudioEncoder;
        if (!AE || !mp4.aenc || !mp4.frames) return Promise.resolve();
        var rate = mp4.sampleRate, total = mp4.frames;
        var L = new Float32Array(total), R = new Float32Array(total);
        var pos = 0;
        for (var i = 0; i + 1 < mp4.chunks.length; i += 2) {
          var a = mp4.chunks[i], b = mp4.chunks[i + 1];
          var n = Math.min(a.length, total - pos);
          L.set(a.subarray(0, n), pos);
          R.set(b.subarray(0, n), pos);
          pos += n;
          if (pos >= total) break;
        }
        mp4.chunks = [];
        var CH = 1024, p = 0;
        while (p < total) {
          var n2 = Math.min(CH, total - p);
          var buf = new Float32Array(n2 * 2);
          buf.set(L.subarray(p, p + n2), 0);
          buf.set(R.subarray(p, p + n2), n2);
          try {
            var ad = new AudioData({
              format: 'f32-planar', sampleRate: rate, numberOfFrames: n2,
              numberOfChannels: 2, timestamp: Math.round(p / rate * 1e6), data: buf
            });
            mp4.aenc.encode(ad);
            ad.close();
          } catch (e) { break; }
          p += n2;
        }
        try { return mp4.aenc.flush(); } catch (e2) { return Promise.resolve(); }
      }

      // ============ 导出视频：屏幕共享（当前标签页）+ 裁剪舞台 + MP4 ============
      // 仿 simple-jp-keyboard 的做法：录「页面上真实的 9:16 画面」，所见即所得
      // （曲名/作品信息/调号速度拍号/简谱/键盘/节拍都在），不再用 canvas 重画谱面。

      function mp4InitFor(s, useAudio) {
        var lib = mp4MuxerLib();
        if (!lib || !window.VideoEncoder || !window.VideoFrame) return false;
        // 60fps 时 Chrome 的 H.264 编码器不支持，改用 VP9 编，服务端再用 ffmpeg 转回 H.264 60fps
        var encVp9 = (s.fps >= 50);
        mp4.on = true;
        mp4.err = '';
        mp4.vencErr = '';
        mp4.encErr = '';
        mp4.vCount = 0;
        mp4.aCount = 0;
        mp4.fps = s.fps;
        mp4.frameUs = 1e6 / s.fps;
        mp4.nextUs = 0;
        mp4.wantAudio = useAudio;
        mp4.sampleRate = Math.round((ac && ac.sampleRate) || 48000);
        try {
          mp4.muxer = new lib.Muxer({
            target: new lib.ArrayBufferTarget(),
            video: { codec: encVp9 ? 'vp9' : 'avc', width: s.W, height: s.H },
            audio: useAudio
              ? { codec: 'aac', numberOfChannels: 2, sampleRate: mp4.sampleRate }
              : undefined,
            fastStart: 'in-memory',
            firstTimestampBehavior: 'offset'
          });
        } catch (e) {
          mp4.err = '封装器初始化失败：' + (e && e.message ? e.message : e);
          return false;
        }
        try {
          mp4.venc = new window.VideoEncoder({
            output: function (chunk, meta) {
            try {
              if (!mp4.meta0) {
                mp4.meta0 = meta ? ('keys=' + Object.keys(meta).join(',') + ';dc=' + (meta.decoderConfig ? Object.keys(meta.decoderConfig).join(',') : 'null')) : 'no-meta';
              }
              mp4.muxer.addVideoChunk(chunk, meta);
            } catch (e) { mp4.err = '写视频帧失败：' + (e && e.message ? e.message : e); }
          },
            error: function (e) {
              if (!mp4.vencErr) mp4.vencErr = '视频编码错误：' + (e && e.message ? e.message : e);
              mp4.err = mp4.vencErr;
            }
          });
          var vcfg = {
            codec: encVp9 ? 'vp09.00.10.08' : pickAvcCodec(s.W, s.H, s.fps), width: s.W, height: s.H,
            framerate: s.fps,
            // 谱面是「文字 + 细线」，给足码率才不糊（原来的 0.12 偏小）
            bitrate: Math.round(s.W * s.H * Math.min(s.fps, 45) * 0.26),
            // 1080p60 硬件编码器在部分机器上初始化失败，60fps 走软件编码更稳
            hardwareAcceleration: (s.fps >= 50 ? 'prefer-software' : 'no-preference'),
            latencyMode: 'quality'
          };
          try {
            mp4.venc.configure(vcfg);
          } catch (eCfg) {
            delete vcfg.latencyMode;          // 老版本不认这个字段
            mp4.venc.configure(vcfg);
          }
        } catch (e2) {
          mp4.err = 'H.264 编码器不可用：' + (e2 && e2.message ? e2.message : e2);
          return false;
        }
        if (useAudio) {
          try {
            mp4.aenc = new window.AudioEncoder({
              output: function (chunk, meta) {
                try { mp4.muxer.addAudioChunk(chunk, meta); mp4.aCount++; } catch (e) { }
              },
              error: function (e) { try { console.warn('[导出] 音频编码错误', e); } catch (e2) { } }
            });
            mp4.aenc.configure({
              codec: 'mp4a.40.2', sampleRate: mp4.sampleRate,
              numberOfChannels: 2, bitrate: 128000
            });
          } catch (e3) { mp4.aenc = null; }
        }
        return true;
      }

      // 舞台录制（recordStage）的收尾入口：歌曲播完 / Esc / 外部取消都会走这里
      function stopExport(keep) {
        if (STG && STG.on) stgFinish(!!keep);
      }

      // ---------------- 导出：曲谱快照 ----------------
      var curMeasureNo = -1;      // 当前正在播放的小节（0 基）

      // 导出用：每组五线谱 + 简谱各一张位图
      var scoreBitmaps = [];
      var jpBitmaps = [];

      function shootScore(done) {
        scoreBitmaps = [];
        if (!blocks.length) { if (done) done(); return; }

        var pending = blocks.length, failed = 0;
        blocks.forEach(function (b, i) {
          var svgEl = b.svg || (b.el && b.el.querySelector('svg'));
          if (!svgEl) { if (--pending === 0) finish(); return; }

          var clone = svgEl.cloneNode(true);
          clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
          var wAttr = parseFloat(clone.getAttribute('width')) || 1000;
          var hAttr = parseFloat(clone.getAttribute('height')) || 300;

          var str;
          try { str = new XMLSerializer().serializeToString(clone); }
          catch (e) { if (--pending === 0) finish(); return; }

          var url = URL.createObjectURL(new Blob([str], { type: 'image/svg+xml;charset=utf-8' }));
          var img = new Image();
          img.onload = function () {
            try {
              var c = document.createElement('canvas');
              c.width = Math.round(wAttr);
              c.height = Math.round(hAttr);
              var cc = c.getContext('2d');
              cc.fillStyle = '#ffffff';
              cc.fillRect(0, 0, c.width, c.height);
              cc.drawImage(img, 0, 0, c.width, c.height);
              scoreBitmaps[i] = c;
            } catch (e2) { failed++; }
            URL.revokeObjectURL(url);
            if (--pending === 0) finish();
          };
          img.onerror = function () {
            failed++;
            URL.revokeObjectURL(url);
            if (--pending === 0) finish();
          };
          img.src = url;
        });

        function finish() {
          try { shootJianpu(); } catch (eJ) { }
          try {
            console.log('[导出] 五线谱位图 ' + scoreBitmaps.length + '/' + blocks.length +
              (failed ? ('，失败 ' + failed) : ''));
          } catch (e) { }
          if (done) done();
        }
      }

      // 简谱是 HTML+CSS（时值线用 box-shadow、形状用 clip-path），
      // canvas 画不了，这里按真实渲染几何重绘一遍。
      // 把 clip-path: polygon(...) 解析成 0~1 的相对点。
      // 简谱的音符高亮块本身是个 37×55 的大方块，靠 clip-path 裁成「贴着数字」的小块，
      // 只记外框矩形会被画成一个大方框，所以必须把多边形一起记下来。
      function expPolyOf(el) {
        var cp = '';
        try { cp = getComputedStyle(el).clipPath || ''; } catch (e) { }
        if (cp.indexOf('polygon') !== 0) return null;
        var body = cp.slice(cp.indexOf('(') + 1, cp.lastIndexOf(')'));
        var r = el.getBoundingClientRect();
        var seg = body.split(','), pts = [], i, xy, fx, fy, nx, ny;
        for (i = 0; i < seg.length; i++) {
          xy = seg[i].trim().split(/\s+/);
          if (xy.length < 2) continue;
          fx = xy[0]; fy = xy[1];
          nx = fx.indexOf('%') >= 0 ? parseFloat(fx) / 100 : parseFloat(fx) / Math.max(1, r.width);
          ny = fy.indexOf('%') >= 0 ? parseFloat(fy) / 100 : parseFloat(fy) / Math.max(1, r.height);
          if (isNaN(nx) || isNaN(ny)) continue;
          pts.push([nx, ny]);
        }
        return pts.length >= 3 ? pts : null;
      }

      // 把简谱里所有高亮方块先全部藏起来，返回还原函数。
      // 为什么不能用 jpHiReset([])：它只认识 jpHiNow 里记着的那几个 —— 上一次播放/上一次录制
      // 留下的点亮（后来 jpHiNow 被清掉了）它管不到，那些方块就会被烤进简谱位图，
      // 于是成片里「播过的音符一直亮着」。
      function jpHideAll() {
        var saved = [];
        try {
          var els = document.querySelectorAll('#svgHost .SparksNMN-notehl');
          for (var i = 0; i < els.length; i++) {
            saved.push([els[i], els[i].style.cssText]);
            els[i].style.visibility = 'hidden';
            els[i].style.opacity = '0';
          }
        } catch (eHA) { }
        jpHiNow = [];
        return function () {
          for (var j = 0; j < saved.length; j++) {
            try { saved[j][0].style.cssText = saved[j][1]; } catch (eHR) { }
          }
        };
      }

      // 收尾/重播时把简谱高亮彻底清干净：jpHiReset([]) 只认 jpHiNow 记得的那些，
      // 记不住的就一直亮着（成片里最后一组会一直高亮到结尾）

      function jpClearAll() {
        try { jpHiReset([]); } catch (eJC) { }
        try {
          var els = document.querySelectorAll('#svgHost .SparksNMN-notehl');
          for (var i = 0; i < els.length; i++) {
            var e = els[i];
            if (e.style.visibility === 'visible') {
              e.style.visibility = 'hidden';
              e.style.opacity = '0';
              e.style.filter = '';
              e.classList.remove('jpHit');
            }
          }
        } catch (eJC2) { }
        jpHiNow = [];
      }

      function shootJianpu() {
        jpBitmaps = [];
        // 截图前先收掉所有播放高亮，否则点亮过的方块会被烤进位图（成片里一直亮着）
        var jpRestore = jpHideAll();
        for (var i = 0; i < blocks.length; i++) {
          var b = blocks[i];
          var inner = b.jpEl ? b.jpEl.querySelector('div') : null;
          if (!inner) { jpBitmaps[i] = null; continue; }

          // DomPaint 根 div 的子元素全是绝对定位，自身高度是 0；
          // 真正有尺寸的是外面这层框（简谱行），量它才对。
          var frame = inner.parentElement || inner;
          var w = frame.offsetWidth, h = frame.offsetHeight;
          if (!w || !h) { jpBitmaps[i] = null; continue; }

          var S = 2;
          var cv = document.createElement('canvas');
          cv.width = Math.max(1, Math.round(w * S));
          cv.height = Math.max(1, Math.round(h * S));
          var cx = cv.getContext('2d');
          cx.scale(S, S);
          cx.fillStyle = '#ffffff';
          cx.fillRect(0, 0, w, h);

          var ir = frame.getBoundingClientRect();

          var all = inner.querySelectorAll('*');

          for (var k = 0; k < all.length; k++) {
            var el = all[k];
            var cs;
            try { cs = getComputedStyle(el); } catch (e) { continue; }
            if (cs.visibility === 'hidden' || cs.display === 'none') continue;
            // 高亮方块（.SparksNMN-notehl）只是「播放时点亮」的覆盖层，不属于谱面本身：
            // 无论当时是否亮着，都不许烤进简谱位图，否则成片里会一直亮着。
            // 所有 SparksNMN-* 的高亮覆盖层（notehl / sechl / secsel …）都属于「播放时点亮」，
            // 不是谱面本身 —— 它们的背景色是调色板，一旦被烤进位图，成片里就会整行常亮。
            var clsAll = String(el.className || '');
            // 还有一类高亮覆盖层没有 class，只有内联的调色板背景 + clip-path：
            // 谱面文字/线条都是黑白的，所以「背景带明显色相」的元素一律当作高亮，不进位图。
            var bgm = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(cs.backgroundColor || '');
            if (bgm) {
              var mr = +bgm[1], mg = +bgm[2], mb = +bgm[3];
              if (Math.max(mr, mg, mb) - Math.min(mr, mg, mb) > 30) continue;
            }
            if (clsAll.indexOf('SparksNMN-') >= 0) continue;

            var r = el.getBoundingClientRect();
            if (r.width < 0.3 || r.height < 0.3) continue;
            var x = r.left - ir.left, y = r.top - ir.top;

            // 线条：clip-path + box-shadow 颜色
            var cp = cs.clipPath || '';
            if (cp.indexOf('polygon') === 0) {
              var pts = cp.slice(cp.indexOf('(') + 1, cp.lastIndexOf(')')).split(',');
              cx.save();
              cx.beginPath();
              for (var pi2 = 0; pi2 < pts.length; pi2++) {
                var xy = pts[pi2].trim().split(/\s+/);
                var px2 = x + parseFloat(xy[0]) / 100 * r.width;
                var py2 = y + parseFloat(xy[1]) / 100 * r.height;
                if (pi2 === 0) cx.moveTo(px2, py2); else cx.lineTo(px2, py2);
              }
              cx.closePath();
              cx.clip();
              var cm = /rgba?\([^)]+\)|#[0-9a-f]{3,6}/i.exec(cs.boxShadow || '');
              cx.fillStyle = cm ? cm[0] : '#000000';
              cx.fillRect(x, y, r.width, r.height);
              cx.restore();
              continue;
            }

            // 文字
            var txt = '';
            for (var c2 = 0; c2 < el.childNodes.length; c2++) {
              if (el.childNodes[c2].nodeType === 3) txt += el.childNodes[c2].nodeValue;
            }
            txt = txt.replace(/\s+/g, ' ').trim();
            if (!txt) continue;

            var sc = 1, ms = (el.style.transform || '').match(/scale\(([\d.]+)\)/g);
            if (ms) { for (var mi = 0; mi < ms.length; mi++) sc *= parseFloat(/scale\(([\d.]+)\)/.exec(ms[mi])[1]); }
            var fs = parseFloat(cs.fontSize) * sc;
            if (!isFinite(fs) || fs < 0.8) continue;

            cx.fillStyle = cs.color || '#000000';
            cx.font = (cs.fontWeight || '400') + ' ' + fs.toFixed(2) + 'px ' + cs.fontFamily;
            cx.textBaseline = 'middle';
            var al = (cs.textAlign === 'left') ? 'left' : (cs.textAlign === 'right') ? 'right' : 'center';
            cx.textAlign = al;
            var tx = x + (al === 'center' ? r.width / 2 : al === 'right' ? r.width : 0);
            cx.fillText(txt, tx, y + r.height / 2);
          }

          jpBitmaps[i] = cv;
        }
        try {
          var ok = 0;
          for (var z = 0; z < jpBitmaps.length; z++) if (jpBitmaps[z]) ok++;
          console.log('[导出] 简谱位图 ' + ok + '/' + blocks.length);
        } catch (e) { }
        try { jpRestore(); } catch (eJR) { }
      }

      // 把谱面画到导出画布上：
      //   · 按宽度铺满
      //   · 纵向按「整行」取景，并做缓动，换行时不跳
      //   · 光标框是 DOM 元素、不在 SVG 位图里，这里单独补画
      var exportScrollY = null;

      // 回弹位移：页面上是 tick 里写 translateY(1px)，最近 0.14s 内按下再多 3px，
      // 都是固定像素（不随键高变），这里照抄同样的数值。
      function dipOf(m, t, kbH, held) {
        var d = held ? 1 : 0;
        var st = lastStart[m];
        if (st === undefined) return d;
        var e = t - st;
        if (e < 0 || e > 0.14) return d;
        return 1 + 3 * (1 - e / 0.14);
      }

      // ================= 五线谱：OpenSheetMusicDisplay 渲染 + 与 MIDI 对齐 =================
      // 渲染交给 OSMD（内部是 VexFlow），我们只做三件事：
      //   1) 把 XML 交给 osmd.load()
      //   2) 从它的图形对象里摊平出「每个音符的音高 + 绝对时间」
      //   3) 按音高序列和 MIDI 对齐，播放时用 GraphicalNote.setColor() 逐个点亮
      var scoreWrap = document.getElementById('scoreWrap');
      var scoreEl = document.getElementById('score');
      var xmlInput = ui('xmlFile');   // 播放页没有这个控件，用空元素顶替

      var NOTE_ON_COLOR = '#d92b25';   // 正在弹
      var NOTE_OFF_COLOR = '#1c1c1c';   // 常态

      var osmdBusy = false;
      var score = null;         // { title, notes:[{gn, halfTone, ts}], measureCount, staffCount }
      var scoreMap = null;      // MIDI 音符下标 → score.notes 下标
      var scoreTime = null;     // score.notes 下标 → 真正发声的时刻（秒，琶音各音不同）
      var scoreOn = [];         // 正在高亮的 { gn, until }
      var alignInfo = null;     // 对齐统计

      // ---------------- 曲名 / 制谱者 ----------------
      var scoreMeta = null;

      var CREDIT_ROLE_RE = /制谱|记谱|扒谱|作曲|编曲|编配|打谱|transcri|arrang|compos/i;

      function xmlEsc(t) {
        return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      }

      // ---------------- 自研 MusicXML 解析（替代 OSMD） ----------------
      var STEP_SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

      function stepToMidi(step, octave, alter) {
        var base = STEP_SEMI[String(step || 'C').toUpperCase()];
        if (base === undefined) base = 0;
        return (octave + 1) * 12 + base + (alter || 0);
      }

      // 返回 { notes: [{halfTone(midi), ts(四分音符), measure, part, grace}], measures, parts }
      // notes 已按 (时间, 音高) 排序 —— 和谱面的阅读顺序一致。
      function parseMusicXML(text) {
        var doc;
        try { doc = new DOMParser().parseFromString(text, 'text/xml'); } catch (e) { return null; }
        if (!doc || doc.getElementsByTagName('parsererror').length) return null;
        var root = doc.documentElement;
        if (!root) return null;

        var parts = root.getElementsByTagName('part');
        if (!parts.length) return null;

        var notes = [], measures = 0, pi, tiedOpen = {};
        for (pi = 0; pi < parts.length; pi++) {
          var ms = parts[pi].getElementsByTagName('measure');
          if (ms.length > measures) measures = ms.length;

          var divisions = 1, t = 0, mi;
          for (mi = 0; mi < ms.length; mi++) {
            var meas = ms[mi];
            var lastOnset = t;
            var kids = meas.childNodes;

            for (var ci = 0; ci < kids.length; ci++) {
              var node = kids[ci];
              if (node.nodeType !== 1) continue;
              var tag = node.tagName;

              if (tag === 'attributes') {
                var dv = node.getElementsByTagName('divisions')[0];
                if (dv && parseFloat(dv.textContent)) divisions = parseFloat(dv.textContent);
              } else if (tag === 'backup') {
                var bd = node.getElementsByTagName('duration')[0];
                if (bd) t -= (parseFloat(bd.textContent) || 0) / divisions;
              } else if (tag === 'forward') {
                var fd = node.getElementsByTagName('duration')[0];
                if (fd) t += (parseFloat(fd.textContent) || 0) / divisions;
              } else if (tag === 'note') {
                var isChord = !!node.getElementsByTagName('chord')[0];
                var isGrace = !!node.getElementsByTagName('grace')[0];
                var isRest = !!node.getElementsByTagName('rest')[0];
                var durEl = node.getElementsByTagName('duration')[0];
                var dur = durEl ? (parseFloat(durEl.textContent) || 0) / divisions : 0;

                var onset = isChord ? lastOnset : t;
                if (!isChord) lastOnset = t;

                if (!isRest) {
                  var pt = node.getElementsByTagName('pitch')[0];
                  if (pt) {
                    var st = pt.getElementsByTagName('step')[0];
                    var oc = pt.getElementsByTagName('octave')[0];
                    var al = pt.getElementsByTagName('alter')[0];
                    var midi = stepToMidi(
                      st ? st.textContent : 'C',
                      oc ? parseInt(oc.textContent, 10) : 4,
                      al ? parseFloat(al.textContent) : 0);
                    var voiceEl = node.getElementsByTagName('voice')[0];
                    var vk = pi + '|' + midi + '|' + (voiceEl ? voiceEl.textContent : '1');

                    // 连音线：跨小节的延音在 MIDI 里不会重新触发，谱面上却会再画一个符头。
                    // 这里标成 tie=true —— 仍然留在 notes 里（和 SVG 符头一一对应），
                    // 但不算「这一拍新起的音」（简谱高亮按小节配对时要跳过它们）。
                    var tieStop = false, tieStart = false, ti;
                    var tieEls = node.getElementsByTagName('tie');
                    if (!tieEls.length) tieEls = node.getElementsByTagName('tied');
                    for (ti = 0; ti < tieEls.length; ti++) {
                      var ty = tieEls[ti].getAttribute('type');
                      if (ty === 'stop') tieStop = true;
                      if (ty === 'start') tieStart = true;
                    }
                    var isTieCont = tieStop && !!tiedOpen[vk];

                    notes.push({
                      halfTone: midi,
                      ts: onset,
                      measure: mi,
                      part: pi,
                      grace: isGrace,
                      tie: isTieCont
                    });

                    if (isTieCont && !tieStart) delete tiedOpen[vk];
                    if (tieStart) tiedOpen[vk] = 1;
                  }
                }
                if (!isChord) t += dur;
              }
            }
          }
        }

        if (!notes.length) return null;
        // 同一时间点：装饰音排在主音符之前（谱面上装饰音画在左边）。
        // 否则按音高排序会把两者位置交换，导致高亮在该处回跳一格。
        notes.sort(function (a, b) {
          if (a.ts !== b.ts) return a.ts - b.ts;
          if (a.grace !== b.grace) return a.grace ? -1 : 1;
          return a.halfTone - b.halfTone;
        });
        return { notes: notes, measures: measures, parts: parts.length, info: readScoreInfo(root) };
      }

      // MusicXML 里的 调号 / 拍号 / 速度（给顶部「谱面信息」用）
      function readScoreInfo(root) {
        var info = { tempo: 0, beats: 0, beatType: 0, fifths: null };
        try {
          var sounds = root.getElementsByTagName('sound');
          for (var i = 0; i < sounds.length; i++) {
            var v = parseFloat(sounds[i].getAttribute('tempo'));
            if (v > 0) { info.tempo = v; break; }
          }
          if (!info.tempo) {
            var per = root.getElementsByTagName('per-minute')[0];
            if (per) info.tempo = parseFloat(per.textContent) || 0;
          }
          var t = root.getElementsByTagName('time')[0];
          if (t) {
            var b = t.getElementsByTagName('beats')[0];
            var bt = t.getElementsByTagName('beat-type')[0];
            info.beats = b ? (parseInt(b.textContent, 10) || 0) : 0;
            info.beatType = bt ? (parseInt(bt.textContent, 10) || 0) : 0;
          }
          var k = root.getElementsByTagName('key')[0];
          if (k) {
            var f = k.getElementsByTagName('fifths')[0];
            if (f) {
              var n = parseInt(f.textContent, 10);
              if (isFinite(n)) info.fifths = n;
            }
          }
        } catch (e) { }
        return info;
      }

      // 从 <credit> 里挖出文字，字号最大的当标题
      function parseCredits(xml) {
        var out = { title: '', subtitle: '', composer: '', raw: [] };
        try {
          var credits = xml.match(/<credit\b[^>]*>[\s\S]*?<\/credit>/g) || [];
          for (var i = 0; i < credits.length; i++) {
            var ws = credits[i].match(/<credit-words\b[^>]*>[\s\S]*?<\/credit-words>/g) || [];
            for (var j = 0; j < ws.length; j++) {
              var t = ws[j].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
              if (!t) continue;
              var mSize = ws[j].match(/font-size="([\d.]+)"/);
              out.raw.push({ text: t, size: mSize ? parseFloat(mSize[1]) : 0 });
            }
          }

          var bySize = out.raw.slice().sort(function (a, b) { return b.size - a.size; });
          if (bySize.length) out.title = bySize[0].text;

          for (var k = 0; k < out.raw.length; k++) {
            if (CREDIT_ROLE_RE.test(out.raw[k].text)) { out.composer = out.raw[k].text; break; }
          }

          var rest = [];
          for (var q = 0; q < out.raw.length; q++) {
            var r = out.raw[q];
            if (r.text === out.title) continue;
            if (r.text === out.composer) continue;
            if (CREDIT_ROLE_RE.test(r.text)) continue;
            rest.push(r);
          }
          rest.sort(function (a, b) { return b.size - a.size; });
          if (rest.length) out.subtitle = rest[0].text;
        } catch (e) { }
        return out;
      }

      function renderScoreInfo() {
        var el = document.getElementById('scoreInfo');
        if (!el) return;
        var meta = scoreMeta;
        if (!meta || (!meta.title && !meta.composer && !meta.subtitle)) {
          el.hidden = true;
          return;
        }
        var html = [];
        if (meta.title) html.push('<b>《' + xmlEsc(meta.title) + '》</b>');
        if (meta.subtitle) html.push('<span>· ' + xmlEsc(meta.subtitle) + '</span>');
        if (meta.composer) html.push('<span>· ' + xmlEsc(meta.composer) + '</span>');
        el.innerHTML = html.join('&nbsp;&nbsp;');
        el.hidden = false;
      }

      // ---------- 谱面顶部的「谱面信息」：曲名 + 1=X | NN BPM | 4/4 ----------
      // 数据来源：MusicXML（key/time/sound tempo）优先，其次 MIDI（header.tempos /
      // timeSignatures / keySignatures）。没有对应字段就不显示那一项。
      var KEY_NAMES = ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#'];
      var midiInfo = { tempo: 0, beats: 0, beatType: 0, key: '' };

      function jianpuKeyName(fifths) {
        if (typeof fifths !== 'number' || !isFinite(fifths)) return '';
        var i = Math.max(-7, Math.min(7, Math.round(fifths))) + 7;
        return '1=' + KEY_NAMES[i].replace(/#/g, '♯').replace(/b/g, '♭');
      }

      // MIDI 的 keySignatures 给的是 'C' / 'Am' 这种，换成简谱的 1=X
      // （小调和它的关系大调同调号，所以直接按五度数查表即可）
      function midiKeyToJianpu(k) {
        var s = String(k || '').trim().replace(/m$/i, '');
        var map = {
          'Cb': -7, 'Gb': -6, 'Db': -5, 'Ab': -4, 'Eb': -3, 'Bb': -2, 'F': -1,
          'C': 0, 'G': 1, 'D': 2, 'A': 3, 'E': 4, 'B': 5, 'F#': 6, 'C#': 7
        };
        if (!s || !(s in map)) return '';
        return jianpuKeyName(map[s]);
      }

      function escHtml(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
          .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      }

      // 去掉文件后缀（作品标题不应出现 .musicxml / .mid 等扩展名）
      function stripFileExt(s) {
        return String(s == null ? '' : s).replace(/\.(musicxml|mxl|xml|mid|midi|svg|mp3|wav|flac|ogg|jpg|jpeg|png|webp|gif|txt|json|js)$/i, '');
      }

      // 自动值：曲名、以及「调号 | 速度 | 拍号」那一行
      function autoHeadTitle() {
        var t = (scoreMeta && scoreMeta.title) || '';
        if (!t) t = titleFromJp() || '';
        if (!t) t = (score && score.title) || '';
        if (!t) t = String(curLabel || '');
        return stripFileExt(t).trim();
      }

      function autoHeadMeta() {
        var info = (score && score.info) || {};
        var key = jianpuKeyName(info.fifths) || midiKeyToJianpu(midiInfo.key);
        var tempo = Math.round(info.tempo || midiInfo.tempo || 0);
        var beats = info.beats || midiInfo.beats || 0;
        var beatType = info.beatType || midiInfo.beatType || 0;
        var meta = [];
        if (key) meta.push(key);
        if (tempo > 0) meta.push(tempo + ' BPM');
        if (beats && beatType) meta.push(beats + '/' + beatType);
        return meta.join(' | ');
      }

      // 集合（如「原神谱 · 4集」）的水平位置：页面里 window.KB_COL_LEFT（距左 px，默认 30）
      // 或 window.KB_COL_RIGHT（距右 px，写了它贴右边并忽略 KB_COL_LEFT）
      // 集合用字：默认「期」（小红书），抖音/快手页面里写 window.KB_COL_UNIT = '集'
      function colUnit() {
        var u = window.KB_COL_UNIT;
        return (typeof u === 'string' && u.trim()) ? u.trim().slice(0, 2) : '期';
      }
      function colPos() {
        var r = parseFloat(window.KB_COL_RIGHT);
        if (isFinite(r)) return { right: r };
        var l = parseFloat(window.KB_COL_LEFT);
        return { left: isFinite(l) ? l : 30 };
      }
      function applyColStyle() {
        var head = document.getElementById('scoreHead') || document.querySelector('.stage');
        if (!head) return;
        var p = colPos();
        if (p.right != null) {
          head.style.setProperty('--kb-col-right', p.right + 'px');
          head.style.removeProperty('--kb-col-left');
        } else {
          head.style.setProperty('--kb-col-left', p.left + 'px');
          head.style.removeProperty('--kb-col-right');
        }
      }

      // 集合文字里的「期 / 集」跟着当前平台走：作品信息是跨平台共享的，
      // 但小红书用「期」、抖音/快手用「集」，换平台时只换这个尾字，数字和其余文字不动。
      function colTextForPlatform(col) {
        var s = String(col || '').trim();
        if (!s) return '';
        var u = colUnit();
        if (u === '期' || u === '集') {
          if (/[期集]$/.test(s)) s = s.slice(0, -1) + u;
          else if (/\d$/.test(s)) s = s + u;   // 只写了数字（如「4」）就补上平台用字
        }
        return s;
      }

      function renderScoreHead() {
        var el = document.getElementById('scoreHead');
        if (!el) return;
        if (window.KB_NO_SCORE_HEAD) { el.hidden = true; return; }
        var e = headEdits.songs[headSongKey()] || {};
        var title = String(e.title || autoHeadTitle() || '').trim();
        var meta = String(e.meta || autoHeadMeta() || '').trim();
        var sub = String(headEdits.sub || '').trim();
        // 集合信息（例如「原神谱 · 4期」）和副标题同一行：集合绝对定位在左侧，副标题仍居中；
        // 曲名单独一行、照样居中，所以集合不参与任何居中计算
        var col = colTextForPlatform(e.col);
        if (!title && !meta && !sub && !col) { el.hidden = true; el.innerHTML = ''; return; }
        var colCls = 'sh-col' + (colPos().right != null ? ' to-right' : '');
        // 横版：副标题放到标题右侧（间隔 50px），竖版保持原来「标题一行、副标题一行」
        var subInline = HORIZ && !!sub && !!title;
        el.classList.toggle('h-head', HORIZ);
        // 横版：副标题在标题右侧，集合浮在左上角（不占行高）
        var rowHasText = !!(sub && !subInline);
        var colHtml = col ? '<div class="' + colCls + (HORIZ ? ' h-corner' : '') + '">' + escHtml(col) + '</div>' : '';
        var rowHtml = (rowHasText || (col && !HORIZ))
          ? '<div class="sh-row' + (rowHasText ? '' : ' col-only') + '">' +
            ((sub && !subInline) ? '<div class="sh-sub">' + escHtml(sub) + '</div>' : '') +
            (HORIZ ? '' : colHtml) +
            '</div>'
          : '';
        el.innerHTML =
          (title ? '<div class="sh-title">' +
            '<span class="sh-name">' + escHtml(title) + '</span>' +
            (subInline ? '<span class="sh-sub">' + escHtml(sub) + '</span>' : '') +
            '</div>' : '') +
          rowHtml +
          (HORIZ ? colHtml : '') +
          (meta ? '<div class="sh-meta">' + escHtml(meta) + '</div>' : '');
        applyColStyle();
        applyHeadSizes();
        el.hidden = false;
      }

      // ---------- 谱面信息的手动修改 ----------
      // 副标题（作品信息，例如「原神 · 璃月」）按页面记；标题 / 谱面信息按曲目记。
      // 都存在 localStorage（键 kb-head:<页面>），刷新还在。
      var headEdits = { sub: '', songs: {}, sizes: { title: 0, sub: 0 } };
      // 字号（px，0 = 用 CSS 默认）：标题 25 / 副标题 13
      var headSizes = { title: 0, sub: 0 };
      function headPageName() {
        var base = 'page';
        try { base = String(location.pathname || '').split('/').pop() || 'page'; } catch (e) { }
        // 合并页（一个文件装多个平台）用 window.KB_PAGE_NS 做后缀，
        // 各平台的 键盘位置/字幕位置/标题距顶 分开存：kb-*:<页面>|<平台>
        var ns = String(window.KB_PAGE_NS || '').trim();
        return base + (ns ? '|' + ns : '');
      }
      // 作品信息（标题 / 副标题 / 集合 / 谱面信息 / 字号）是「这首曲子」的属性，
      // 跟发到哪个平台无关：换平台要显示同一套，所以键里不带平台后缀。
      function workPageName() {
        try { return String(location.pathname || '').split('/').pop() || 'page'; } catch (e) { return 'page'; }
      }
      function headStoreKey() { return 'kb-head:' + workPageName(); }
      function headLegacyKey() { return 'kb-head:' + headPageName(); }
      function headSongKey() { return autoHeadTitle() || '(未命名)'; }

      // 抬头（集合 / 副标题 / 谱面信息）跟着舞台宽度等比放大：
      // 编辑页舞台约 540 宽、录制页是 1080 宽，字号如果写死 px，成片里就只剩一半大小。
      // 这里把「舞台宽 ÷ 540」写成 CSS 变量 --kb-ui-scale，CSS 里用 calc(14px * var(--kb-ui-scale))，
      // 于是页面上看到的比例和 1080×1920 成片里完全一致。
      var UI_REF_W = 540;
      function uiScale() {
        var st = document.querySelector('.stage');
        var w = st ? st.clientWidth : 0;
        if (!(w > 0)) return 1;
        return Math.max(0.55, Math.min(2.6, w / UI_REF_W));
      }
      function syncUiScale() {
        var st = document.querySelector('.stage');
        if (!st) return;
        var w = st.clientWidth || 0;
        st.style.setProperty('--kb-ui-scale', uiScale().toFixed(3));
        // 还有一套「按 1080 画布写的 px」：字幕距底边、琴键高这些参数说的都是「成片 1080 宽下多少 px」，
        // 编辑页（540 宽）显示时要乘 0.5，录制页（1080 宽）就是原值 —— 这样预览和成片位置一致
        if (w > 0) st.style.setProperty('--kb-px-scale', (Math.max(0.2, Math.min(3, w / 1080))).toFixed(4));
      }

      // 字号默认值也允许写在页面文件里：window.KB_HEAD_TITLE_SIZE / window.KB_HEAD_SUB_SIZE
      // （单位同样是编辑页 540 宽的 px；副标题会按舞台比例放大，集合信息跟着副标题一起变）
      function headSizeFallback(which) {
        var v = parseFloat(which === 'title' ? window.KB_HEAD_TITLE_SIZE : window.KB_HEAD_SUB_SIZE);
        return (isFinite(v) && v > 0) ? v : 0;
      }

      function applyHeadSizes() {
        var head = document.getElementById('scoreHead') || document.querySelector('.stage');
        if (!head) return;
        syncUiScale();
        var t = headSizes.title > 0 ? headSizes.title : headSizeFallback('title');
        var s = headSizes.sub > 0 ? headSizes.sub : headSizeFallback('sub');
        if (t > 0) head.style.setProperty('--kb-head-title-size', t + 'px');
        else head.style.removeProperty('--kb-head-title-size');
        // 副标题填的是「540 宽」下的 px，乘舞台比例这件事交给 CSS 的 calc 做（--kb-ui-scale 会随窗口变），
        // 这里只存原始数字；集合信息用的是同一个变量，所以副标题改多大它就多大
        if (s > 0) head.style.setProperty('--kb-head-sub-size', s + 'px');
        else head.style.removeProperty('--kb-head-sub-size');
      }

      function setHeadSizes(t, s) {
        var tv = parseFloat(t), sv = parseFloat(s);
        headSizes.title = (isFinite(tv) && tv > 0) ? Math.max(8, Math.min(120, tv)) : 0;
        headSizes.sub = (isFinite(sv) && sv > 0) ? Math.max(6, Math.min(80, sv)) : 0;
        headEdits.sizes = { title: headSizes.title, sub: headSizes.sub };
        applyHeadSizes();
      }

      function loadHeadEdits() {
        headEdits = { sub: '', songs: {}, sizes: { title: 0, sub: 0 } };
        headSizes = { title: 0, sub: 0 };
        try {
          var raw = localStorage.getItem(headStoreKey());
          // 老版本把作品信息按平台分开存（kb-head:<页面>|<平台>）：读到旧键就迁移到公共键
          if (!raw) {
            raw = localStorage.getItem(headLegacyKey());
            if (raw) { try { localStorage.setItem(headStoreKey(), raw); } catch (eM) { } }
          }
          var o = JSON.parse(raw || 'null');
          if (o && typeof o === 'object') {
            headEdits.sub = String(o.sub || '');
            headEdits.songs = (o.songs && typeof o.songs === 'object') ? o.songs : {};
            if (o.sizes && typeof o.sizes === 'object') {
              var tv = parseFloat(o.sizes.title), sv = parseFloat(o.sizes.sub);
              headSizes.title = (isFinite(tv) && tv > 0) ? Math.max(8, Math.min(120, tv)) : 0;
              headSizes.sub = (isFinite(sv) && sv > 0) ? Math.max(6, Math.min(80, sv)) : 0;
              headEdits.sizes = { title: headSizes.title, sub: headSizes.sub };
            }
          }
        } catch (e) { }
        // 兼容旧的「作品信息」键
        if (!headEdits.sub) {
          try {
            headEdits.sub = String(localStorage.getItem('kb-work:' + workPageName())
              || localStorage.getItem('kb-work:' + headPageName()) || '');
          } catch (e2) { }
        }
        applyHeadSizes();
      }
      function saveHeadEdits() {
        try { localStorage.setItem(headStoreKey(), JSON.stringify(headEdits)); } catch (e) { }
        try { localStorage.removeItem(headLegacyKey()); } catch (eL2) { }
        try { localStorage.removeItem('kb-work:' + workPageName()); } catch (e2) { }
        try { localStorage.removeItem('kb-work:' + headPageName()); } catch (e3) { }
      }
      // ---------- 标题与舞台顶边的距离（--kb-head-top）----------
      // 来源优先级：本次打开时按钮调的 > 页面里写的 window.KB_HEAD_TOP >
      // localStorage 里记住的值（kb-head-top:<页面名>）> 默认 10
      function headTopStoreKey() { return 'kb-head-top:' + headPageName(); }
      function headTopPx() {
        var el = document.getElementById('scoreHead');
        var v = el ? parseFloat(getComputedStyle(el).paddingTop) : 10;
        return isFinite(v) ? Math.round(v) : 10;
      }
      function fileHeadTop() {
        var v = parseFloat(window.KB_HEAD_TOP);
        return isFinite(v) ? Math.max(0, Math.min(300, v)) : null;
      }
      function syncHeadTop(px) {
        var stage = document.querySelector('.stage');
        if (!stage) return;
        var v = (px == null) ? 10 : Math.max(0, Math.min(300, px));
        stage.style.setProperty('--kb-head-top', v.toFixed(0) + 'px');
      }
      function setHeadTop(px) {
        var v = parseFloat(px);
        if (!isFinite(v)) return;
        v = Math.max(0, Math.min(300, v));
        // 文件里写了默认值就不写 localStorage（每次打开都回到文件值）
        if (fileHeadTop() === null) {
          try { localStorage.setItem(headTopStoreKey(), String(Math.round(v))); } catch (e) { }
        }
        syncHeadTop(v);
      }
      function loadHeadTop() {
        var v = fileHeadTop();
        if (v === null) {
          try {
            var s = parseFloat(localStorage.getItem(headTopStoreKey()));
            if (isFinite(s)) v = s;
          } catch (e) { }
        }
        syncHeadTop(isFinite(v) ? v : 10);
      }

      function setWorkLabel(v) {
        headEdits.sub = String(v == null ? '' : v).trim();
        saveHeadEdits();
        try { renderScoreHead(); } catch (e2) { }
      }

      // ---------- 底部字幕：显示在键盘下方那块空白里，按曲长平均分给每一行 ----------
      // 按钮「字幕」弹窗里填多行文本 + 距底边 px；
      // 第 i 行显示区间 = [i*dur/n, (i+1)*dur/n)，空白行就是一段空白。
      // 「距底边」留空（null）= 在那块空白里上下左右都居中。
      var captionLines = [], captionOffset = null, captionLastIdx = -2;   // null = 居中

      function fileCaptionBottom() {
        var v = parseFloat(window.KB_CAPTION_BOTTOM);
        return isFinite(v) ? Math.max(0, Math.min(400, v)) : null;
      }

      // 平台默认字幕：平台参数里写的那句（三家可以各写一份），页面里没存过字幕时用它
      function fileCaptionText() {
        var t = window.KB_CAPTION_TEXT;
        return (t == null) ? '' : String(t).replace(/\r\n/g, '\n');
      }

      function captionStoreKey() { return 'kb-caption:' + headPageName(); }
      function captionEl() { return document.getElementById('kbCaption'); }

      function applyCaptionStyle() {
        var st = document.querySelector('.stage');
        if (st) {
          if (captionOffset == null) st.style.removeProperty('--kb-caption-bottom');
          else st.style.setProperty('--kb-caption-bottom', Math.max(0, captionOffset) + 'px');
        }
        var el = captionEl();
        if (el) el.classList.toggle('center', captionOffset == null);
      }

      function normalizeCaptionLines(text) {
        var arr = String(text == null ? '' : text).replace(/\r\n/g, '\n').split('\n');
        while (arr.length && !String(arr[arr.length - 1]).trim()) arr.pop();
        return arr;
      }

      function setCaptionText(text, offset) {
        captionLines = normalizeCaptionLines(text);
        // 对话框填什么就用什么（留空 = 居中）；页面里的 KB_CAPTION_BOTTOM 只是「默认值」，
        // 刷新后会回到它，这里不强制覆盖
        if (offset === '' || offset == null) captionOffset = null;   // 留空 = 居中
        else if (isFinite(parseFloat(offset))) {
          captionOffset = Math.max(0, Math.min(400, parseFloat(offset)));
        }
        captionLastIdx = -2;
        applyCaptionStyle();
        try {
          var keep = { text: captionLines.join('\n') };
          if (fileCaptionBottom() === null) keep.offset = captionOffset;
          localStorage.setItem(captionStoreKey(), JSON.stringify(keep));
        } catch (e) { }
        updateCaption(captionNow());
      }

      function loadCaption() {
        var fixed = fileCaptionBottom();
        // 先清空再读：切平台时换的是另一条存档键，不清空就会把上一家的字幕/位置带过来
        captionLines = [];
        captionOffset = null;
        try {
          var o = JSON.parse(localStorage.getItem(captionStoreKey()) || 'null');
          if (o && typeof o === 'object') {
            captionLines = normalizeCaptionLines(o.text || '');
            if (fixed === null && o.offset !== undefined) {
              captionOffset = (o.offset === null || o.offset === '') ? null
                : (isFinite(parseFloat(o.offset)) ? Math.max(0, Math.min(400, parseFloat(o.offset))) : null);
            }
          }
        } catch (e) { }
        // 没存过、或者存的是空字幕 → 用平台默认字幕（三家各一份；想彻底不要就把平台参数里那句删掉）
        if (!captionLines.length || !captionLines.join('').trim()) {
          var dftCap = fileCaptionText();
          if (dftCap && dftCap.trim()) captionLines = normalizeCaptionLines(dftCap);
        }
        if (fixed !== null) captionOffset = fixed;
        applyCaptionStyle();
        updateCaption(0);
      }

      function captionNow() {
        try {
          if (playing && ac && startTime) return Math.max(0, ac.currentTime - startTime);
        } catch (e) { }
        return 0;
      }

      function updateCaption(t) {
        var el = captionEl();
        if (!el) return;
        if (!captionLines.length || !captionLines.join('').trim()) {
          el.hidden = true;
          el.textContent = '';
          return;
        }
        var n = captionLines.length;
        var dur = (typeof total === 'number' && total > 0.2) ? total : 0;
        var idx = 0;
        if (dur > 0) idx = Math.min(n - 1, Math.max(0, Math.floor((t || 0) / (dur / n))));
        if (idx === captionLastIdx) return;
        captionLastIdx = idx;
        el.textContent = captionLines[idx] || '';
        el.hidden = !String(el.textContent).trim();
      }

      // 弹窗：多行文本 + 距底边像素
      function ensureCaptionModal() {
        var m = document.getElementById('captionModal');
        if (m) return m;
        m = document.createElement('div');
        m.className = 'modal';
        m.id = 'captionModal';
        m.hidden = true;
        m.innerHTML =
          '<div class="modal-card cap-card">' +
          '<h3>底部字幕</h3>' +
          '<label class="head-field"><span>文本（回车分一行，一行显示一段）</span>' +
          '<textarea id="capText" rows="8" spellcheck="false"></textarea></label>' +
          '<label class="head-field"><span>距底边（px，0~400；留空 = 在空白区里居中）</span>' +
          '<input type="text" id="capGap" inputmode="numeric"></label>' +
          '<div class="tip">每行显示时长 = 歌曲时长 ÷ 行数（平均分）。留一行空白就空一段；'
          + '文字显示在键盘下方那块空白里。</div>' +
          '<div class="row">' +
          '<button class="btn" id="capClear">清除</button>' +
          '<button class="btn" id="capCancel">取消</button>' +
          '<button class="btn primary" id="capSave">保存</button>' +
          '</div></div>';
        document.body.appendChild(m);
        var save = document.getElementById('capSave');
        var cancel = document.getElementById('capCancel');
        var clear = document.getElementById('capClear');
        if (save) save.addEventListener('click', function () {
          var tEl = document.getElementById('capText');
          var gEl = document.getElementById('capGap');
          setCaptionText(tEl ? tEl.value : '', gEl ? gEl.value : captionOffset);
          m.hidden = true;
        });
        if (cancel) cancel.addEventListener('click', function () { m.hidden = true; });
        if (clear) clear.addEventListener('click', function () {
          var tEl = document.getElementById('capText');
          if (tEl) tEl.value = '';
          setCaptionText('', captionOffset);
          m.hidden = true;
        });
        m.addEventListener('click', function (ev) { if (ev.target === m) m.hidden = true; });
        m.addEventListener('keydown', function (ev) {
          if (ev.key === 'Escape') m.hidden = true;
          else if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) {
            ev.preventDefault();
            if (save) save.click();
          }
        });
        return m;
      }

      function openCaptionEditor() {
        var m = ensureCaptionModal();
        var tEl = document.getElementById('capText');
        var gEl = document.getElementById('capGap');
        if (tEl) tEl.value = captionLines.join('\n');
        if (gEl) gEl.value = (captionOffset == null) ? '' : String(captionOffset);
        m.hidden = false;
        try { if (tEl) tEl.focus(); } catch (e) { }
      }

      // 曲名：优先 MusicXML 的 <credit>/<work-title>，没有就取简谱里字号最大的一行字
      // （sparks 导出把「曲名-简谱」写成 font-size:7em 的 span，比音符的 4.6em 大）。
      // 直接读 efData 的 HTML 字符串，不依赖那一节有没有被排进对照流。
      function titleFromJp() {
        var ef = window.efData || [];
        var best = '', bestFs = 0;
        for (var i = 0; i < ef.length && i < 4; i++) {
          var html = String(ef[i].element || '');
          var re = /font-size:\s*([\d.]+)em[^>]*>([^<]{1,80})</g;
          var m;
          while ((m = re.exec(html))) {
            var fs = parseFloat(m[1]) || 0;
            var t = m[2].replace(/\s+/g, ' ').trim();
            if (!t || /^[0-9.\-=+#♭♯b\s]+$/.test(t)) continue;
            if (fs > bestFs) { bestFs = fs; best = t; }
          }
          if (best) break;
        }
        if (!best) {
          var sp = document.querySelector('.flowJp span');
          if (sp) best = '';
        }
        return String(best || '').replace(/\s*[-—·]?\s*(简谱|五线谱)\s*$/, '').trim();
      }

      function describeScore() {
        if (!score) return '';
        return score.notes.length + ' 个音符 · ' + score.measures + ' 小节' +
          (score.parts > 1 ? ' · ' + score.parts + ' 声部' : '');
      }

      // ---------------- MIDI 与谱面的音符对齐 ----------------
      // 两边都是按时间排好序的音符序列，用「同音高、向后推进」的贪心匹配：
      //   · 起点允许回退 3 个，避免贪心提前跳过谱面音符后无法回补
      //   · 只有整体匹配率很低时才启用「同音名不同八度」
      function matchPass(midiList, sList, usePitchClass) {
        var map = new Array(midiList.length);
        var used = new Array(sList.length);
        var si = 0, matched = 0, mi, k;

        for (mi = 0; mi < midiList.length; mi++) {
          map[mi] = -1;
          var target = midiList[mi].midi;
          var from = Math.max(0, si - 3);
          var limit = Math.min(sList.length, si + 48);
          var found = -1;

          for (k = from; k < limit; k++) {
            if (!used[k] && sList[k].midi === target) { found = k; break; }
          }
          if (found < 0 && usePitchClass) {
            for (k = from; k < limit; k++) {
              if (!used[k] && (sList[k].midi % 12) === (target % 12)) { found = k; break; }
            }
          }
          if (found >= 0) {
            used[found] = true;
            map[mi] = sList[found].scoreIndex;
            if (found + 1 > si) si = found + 1;
            matched++;
          }
        }
        return { map: map, matched: matched };
      }

      // 顺序贪心一旦往前跳过头就再也回不来，后半程会全灭。
      // 这里补一个完全不依赖顺序的匹配：把两边时间都归一化到 [0,1]，
      // 按「时间接近 + 同音高」找最近的未使用音符。
      function matchByTime(midiList, sList) {
        var n = midiList.length, m = sList.length;
        var map = new Array(n), used = new Array(m);
        var i, k, matched = 0;
        for (i = 0; i < n; i++) map[i] = -1;
        if (!n || !m) return { map: map, matched: 0 };

        var tMax = 0, sMax = 0;
        for (i = 0; i < n; i++) if ((midiList[i].time || 0) > tMax) tMax = midiList[i].time;
        for (i = 0; i < m; i++) if ((sList[i].ts || 0) > sMax) sMax = sList[i].ts;
        if (!tMax || !sMax) return { map: map, matched: 0 };

        var tol = 0.10;   // 时间容差（占全曲比例）
        for (i = 0; i < n; i++) {
          var tn = (midiList[i].time || 0) / tMax;
          var best = -1, bestD = 1e9;
          for (k = 0; k < m; k++) {
            if (used[k]) continue;
            if (sList[k].midi !== midiList[i].midi) {
              if ((sList[k].midi % 12) !== (midiList[i].midi % 12)) continue;
            }
            var d = Math.abs((sList[k].ts || 0) / sMax - tn);
            if (d > tol) continue;
            if (d < bestD) { bestD = d; best = k; }
          }
          if (best >= 0) {
            used[best] = 1;
            map[i] = sList[best].scoreIndex;
            matched++;
          }
        }
        return { map: map, matched: matched };
      }

      // MIDI 和谱面里「同一时刻的和弦 / 双手音符」先后顺序可能不同，
      // 贪心匹配偶尔会把靠后的 MIDI 音符对到更靠前的谱面音符上，
      // 表现出来就是「光标回退一个音符」。这里强制映射单调不回退。
      // 强制映射「跨时间点」单调：光标只能往前走。
      // 同一时刻的和弦 / 双手音在 MIDI 和谱面里的先后顺序本来就可能不同（谱面 36 在前、
      // MIDI 76 在前都很正常），所以同一组的音不做限制，否则和弦的两个音会被压成同一个。
      function monotoneScoreMap(map, midiList) {
        var last = -1, prevT = -1e9, i, v, t, sameGroup;
        for (i = 0; i < map.length; i++) {
          v = map[i];
          if (v < 0) continue;
          t = (midiList && midiList[i]) ? (midiList[i].time || 0) : 0;
          sameGroup = Math.abs(t - prevT) <= 0.02;
          if (!sameGroup && v < last) map[i] = last;
          if (map[i] > last) last = map[i];
          prevT = t;
        }
      }

      // 按「起音时刻分组」对齐：两边各自把同一时刻的音符分到一组，组与组按时间
      // 顺序对应（允许相邻组复用，处理滚奏/拆开的和弦），组内再按音高（先同音高、
      // 再同音级）配对。这样天然按时间单调，不会出现「光标回退一个音符」。
      function matchGroups(midiList, sList) {
        var n = midiList.length, m = sList.length, i, q;
        var map = new Array(n);
        for (i = 0; i < n; i++) map[i] = -1;
        if (!n || !m) return { map: map, matched: 0, ordered: true };

        function groupsOf(list, isMidi, eps) {
          var gs = [], cur = null;
          for (var z = 0; z < list.length; z++) {
            var tv = isMidi ? (list[z].time || 0) : (list[z].ts || 0);
            if (!cur || Math.abs(tv - cur.t) > eps) { cur = { t: tv, idx: [] }; gs.push(cur); }
            cur.idx.push(z);
          }
          return gs;
        }
        var mg = groupsOf(midiList, true, 0.02);
        var sg = groupsOf(sList, false, 1e-6);

        var tMax = 0, sMax = 0;
        for (q = 0; q < n; q++) if ((midiList[q].time || 0) > tMax) tMax = midiList[q].time;
        for (q = 0; q < m; q++) if ((sList[q].ts || 0) > sMax) sMax = sList[q].ts;
        if (!tMax || !sMax) return { map: map, matched: 0, ordered: true };
        var ratio = sMax / tMax;

        var used = [], matched = 0, si = 0, gi, k, b, z;
        var hist = [];                 // 已匹配的锚点（时间 → 谱面 ts），用来估当前速度

        // 预测「这一组 MIDI 大概在谱面第几个 ts」。
        // 用最近几十个锚点做一次最小二乘：整首的速度会有起伏（这首 0.75 → 0.78 秒/拍），
        // 只拿全曲平均比例外推，几十秒之后就会偏一个多小节，组会挑错。
        function localModel() {
          var n = hist.length;
          if (n >= 6) {
            var i0 = Math.max(0, n - 40), cnt = 0, sx = 0, sy = 0, sxx = 0, sxy = 0, q, h;
            for (q = i0; q < n; q++) {
              h = hist[q];
              sx += h.t; sy += h.ts; sxx += h.t * h.t; sxy += h.t * h.ts; cnt++;
            }
            var den = cnt * sxx - sx * sx;
            if (den > 1e-9) {
              var a = (cnt * sxy - sx * sy) / den;
              var bb = (sy - a * sx) / cnt;
              if (isFinite(a) && a > 0) return { a: a, b: bb, slack: 1.0 };
            }
          }
          return { a: ratio, b: 0, slack: 4.0 };   // 刚开始：只用全曲比例，窗口放宽
        }

        // 这个谱面组能对上这一组 MIDI 里几个音（同音高）
        function groupScore(k, g) {
          var grp = sg[k], cnt = 0, b2, z2, kk2, target;
          for (b2 = 0; b2 < g.idx.length; b2++) {
            target = midiList[g.idx[b2]].midi;
            for (z2 = 0; z2 < grp.idx.length; z2++) {
              kk2 = grp.idx[z2];
              if (!used[kk2] && sList[kk2].midi === target) { cnt++; break; }
            }
          }
          return cnt;
        }

        for (gi = 0; gi < mg.length; gi++) {
          var g = mg[gi];
          var model = localModel();
          var want = model.a * g.t + model.b;
          // 在指针附近找候选组：先看「能对上几个音」，再看时间离得近不近。
          // 只看时间的话，速度一飘就会挑到隔壁组，然后整条链都跟着偏。
          var best = -1, bestD = 1e9, bestCnt = -1;
          for (k = Math.max(0, si - 2); k <= Math.min(sg.length - 1, si + 8); k++) {
            var dd = Math.abs(sg[k].t - want);
            if (dd > model.slack) continue;
            var sc2 = groupScore(k, g);
            if (sc2 > bestCnt || (sc2 === bestCnt && dd < bestD)) {
              bestCnt = sc2; bestD = dd; best = k;
            }
          }
          if (best < 0) continue;

          function pickFrom(group, target) {
            for (z = 0; z < group.idx.length; z++) {
              var kk = group.idx[z];
              if (!used[kk] && sList[kk].midi === target) return kk;
            }
            for (z = 0; z < group.idx.length; z++) {
              var kc = group.idx[z];
              if (!used[kc] && (sList[kc].midi % 12) === (target % 12)) return kc;
            }
            return -1;
          }

          var anyMatch = false;
          for (b = 0; b < g.idx.length; b++) {
            var mi = g.idx[b], target = midiList[mi].midi;
            var pick = pickFrom(sg[best], target);
            if (pick < 0) {
              var nb = [best - 1, best + 1], w;
              for (w = 0; w < nb.length && pick < 0; w++) {
                if (nb[w] >= 0 && nb[w] < sg.length) pick = pickFrom(sg[nb[w]], target);
              }
            }
            if (pick >= 0) {
              used[pick] = 1;
              map[mi] = sList[pick].scoreIndex;
              matched++;
              anyMatch = true;
            }
          }
          if (anyMatch) {
            hist.push({ t: g.t, ts: sg[best].t });
            if (best + 1 > si) si = best + 1;
          }
        }
        // 第二轮：首轮没配上的音符，在「前后已匹配点」之间插值补配。
        // 后半程 MIDI 比谱面密的地方也能逐个跟上，不会卡在一个位置不动。
        var pairs = [];
        for (i = 0; i < n; i++) if (map[i] >= 0) pairs.push({ t: midiList[i].time || 0, ts: sList[map[i]].ts || 0 });
        var pi = 0;
        for (i = 0; i < n; i++) {
          if (map[i] >= 0) continue;
          var tt = midiList[i].time || 0;
          while (pi < pairs.length && pairs[pi].t <= tt + 1e-6) pi++;
          var lo = pi > 0 ? pairs[pi - 1] : null;
          var hi = pi < pairs.length ? pairs[pi] : null;
          var w2 = (lo && hi && hi.t > lo.t) ? (lo.ts + (tt - lo.t) * (hi.ts - lo.ts) / (hi.t - lo.t))
            : (lo ? (lo.ts + (tt - lo.t) * ratio) : (tt * ratio));
          var loTs = lo ? lo.ts : -1e9, hiTs = hi ? hi.ts : 1e9;
          var tgt = midiList[i].midi, sel = -1, bd2, mode, z2;
          for (mode = 0; mode < 3 && sel < 0; mode++) {
            bd2 = 1e9;
            for (z2 = 0; z2 < m; z2++) {
              if (used[z2]) continue;
              var ts2 = sList[z2].ts || 0;
              if (ts2 < loTs - 1e-9 || ts2 > hiTs + 1e-9) continue;
              if (mode === 0 && sList[z2].midi !== tgt) continue;
              if (mode === 1 && (sList[z2].midi % 12) !== (tgt % 12)) continue;
              var dd2 = Math.abs(ts2 - w2);
              if (dd2 > 2.5) continue;
              if (dd2 < bd2) { bd2 = dd2; sel = z2; }
            }
          }
          if (sel >= 0) {
            used[sel] = 1;
            map[i] = sList[sel].scoreIndex;
            matched++;
          }
        }
        return { map: map, matched: matched, ordered: true };
      }

      // ============ MIDI ↔ 谱面 对齐 ============
      // 先按音高/顺序试几套匹配，再统一补洞。
      // 补洞不能把没配上的音符全钉在「最后一个已匹配的音符」上：MIDI 比谱面长
      // （比如整首弹了两遍）时，那样会让后半程几十秒停在一个音上，光标和简谱都不动。

      // 谱面里有多少个不同的音符被对上了（0~1）：用来比较哪套对齐更靠谱
      function mapCoverage(map, scoreLen) {
        if (!scoreLen) return 0;
        var seen = {}, n = 0, i;
        for (i = 0; i < map.length; i++) {
          var v = map[i];
          if (v < 0 || seen[v]) continue;
          seen[v] = 1;
          n++;
        }
        return n / scoreLen;
      }

      // 补齐没配上的音符。
      // 要点：按「同一时刻的音」成组处理 —— 和弦各音在 MIDI 和谱面里的先后顺序不一样，
      // 组内下标本来就会来回跳，不能因为这个丢掉配对（丢了就会把整小节第一个和弦对错）；
      // 只有跨时间点才要求单调。
      function fillMapGaps(map, midiList, sList) {
        var n = map.length, i, k, j;
        if (!n) return;

        // 1) 按起音时刻分组（20ms 内算同一组）
        var groups = [], cur = null;
        for (i = 0; i < n; i++) {
          var t = (midiList[i] && midiList[i].time) || 0;
          if (!cur || Math.abs(t - cur.t) > 0.02) {
            cur = { t: t, idx: [] };
            groups.push(cur);
          }
          cur.idx.push(i);
        }

        // 2) 每组取一个代表值：组内已配对谱面下标的中位数
        var reps = [], vals;
        for (k = 0; k < groups.length; k++) {
          vals = [];
          for (i = 0; i < groups[k].idx.length; i++) {
            if (map[groups[k].idx[i]] >= 0) vals.push(map[groups[k].idx[i]]);
          }
          if (vals.length) {
            vals.sort(function (a, b) { return a - b; });
            reps.push(vals[vals.length >> 1]);
          } else {
            reps.push(-1);
          }
        }

        // 3) 跨组单调：代表值往回退的组，配对作废，整组交给插值
        var last = -1;
        for (k = 0; k < groups.length; k++) {
          if (reps[k] < 0) continue;
          if (reps[k] < last) {
            reps[k] = -1;
            for (i = 0; i < groups[k].idx.length; i++) map[groups[k].idx[i]] = -1;
            continue;
          }
          last = reps[k];
        }

        // 4) 没有代表值的组：在前后代表之间按组序号插值
        var prevK = -1, nextK = -1;
        for (k = 0; k < groups.length; k++) {
          if (reps[k] >= 0) { prevK = k; continue; }
          nextK = -1;
          for (j = k + 1; j < groups.length; j++) {
            if (reps[j] >= 0) { nextK = j; break; }
          }
          if (prevK >= 0 && nextK >= 0) {
            reps[k] = reps[prevK] +
              Math.round((reps[nextK] - reps[prevK]) * (k - prevK) / (nextK - prevK));
          } else if (prevK >= 0) {
            reps[k] = reps[prevK];
          } else if (nextK >= 0) {
            reps[k] = reps[nextK];
          } else {
            reps[k] = 0;
          }
        }

        // 5) 写回：组内没配上的音符用该组代表值（同一和弦的音落在同一处）
        for (k = 0; k < groups.length; k++) {
          for (i = 0; i < groups[k].idx.length; i++) {
            var q = groups[k].idx[i];
            if (map[q] < 0) map[q] = reps[k];
          }
        }
      }

      // MIDI 把整首曲子弹了两遍？（第二遍音符序列与第一遍完全一致）
      // 是的话返回第一遍的音符数，否则返回 0。
      function detectExactRepeat(list) {
        var n = list.length;
        if (n < 60) return 0;
        var mid = Math.round(n / 2), d, k;
        for (d = -3; d <= 3; d++) {
          var s = mid + d;
          if (s < 20 || n - s < s * 0.9 || n - s > s * 1.1) continue;
          var off = list[s].time - list[0].time, ok = true;
          for (k = 0; s + k < n; k++) {
            var a = list[k], b = list[s + k];
            if (!a || !b || a.midi !== b.midi) { ok = false; break; }
            if (Math.abs((b.time - a.time) - off) > 0.08) { ok = false; break; }
          }
          if (ok) return s;
        }
        return 0;
      }

      var alignSList = null;       // 最近一次对齐用的谱面列表（调试用）

      function scoreListForOffset(off) {
        var sList = [], i;
        for (i = 0; i < score.notes.length; i++) {
          sList.push({
            midi: score.notes[i].halfTone + off,
            scoreIndex: i,
            ts: score.notes[i].ts
          });
        }
        return sList;
      }

      // ---------- 按顺序的最长公共子序列（音高） ----------
      // 前面几套都是「先猜位置再配对」，一旦速度/节奏和谱面名义时值不一致（有人弹得赶、
      // 有 rubato、有华彩），预测就会偏，挑到隔壁拍，然后整条链跟着偏。
      // 这里换成最稳的做法：两边都按顺序、音高相同就配对，取最长的一串。
      // 时间只用来「在同样长的几种对法里挑最贴合的」（第二关键字），不再决定配对与否。
      function matchLCS(midiList, sList) {
        var n = midiList.length, m = sList.length;
        var map = new Array(n), i, k;
        for (i = 0; i < n; i++) map[i] = -1;
        if (!n || !m) return { map: map, matched: 0, ordered: true };

        var tMax = 0, sMax = 0;
        for (i = 0; i < n; i++) if ((midiList[i].time || 0) > tMax) tMax = midiList[i].time;
        for (k = 0; k < m; k++) if ((sList[k].ts || 0) > sMax) sMax = sList[k].ts;
        var secPerTs = (tMax > 0 && sMax > 0) ? (tMax / sMax) : 0;

        var BIG = 10000000, CAP = 4000;       // 1 个配对值 1e7，时间误差最多扣 4000
        var W = m + 1;
        // Float64：匹配数 × 1e7 会超过 Int32 上限（几百个音就溢出了）
        var dp = new Float64Array((n + 1) * W);
        var tsSec = [], pAt = [];
        for (k = 0; k < m; k++) {
          tsSec.push(secPerTs ? secPerTs * (sList[k].ts || 0) : 0);
          pAt.push(sList[k].midi | 0);
        }
        for (i = 1; i <= n; i++) {
          var mt = midiList[i - 1].time || 0, mm = midiList[i - 1].midi | 0;
          var row = i * W, prev = row - W;
          for (k = 1; k <= m; k++) {
            var up = dp[prev + k], left = dp[row + k - 1];
            var v = up > left ? up : left;
            if (pAt[k - 1] === mm) {
              var d = Math.abs(tsSec[k - 1] - mt) * 1000;
              if (d > CAP) d = CAP;
              var dg = dp[prev + k - 1] + BIG - (d | 0);
              if (dg > v) v = dg;
            }
            dp[row + k] = v;
          }
        }

        i = n; k = m;
        var matched = 0;
        while (i > 0 && k > 0) {
          var cur = dp[i * W + k];
          var mm2 = midiList[i - 1].midi | 0;
          if (pAt[k - 1] === mm2) {
            var d2 = Math.abs(tsSec[k - 1] - (midiList[i - 1].time || 0)) * 1000;
            if (d2 > CAP) d2 = CAP;
            if (cur === dp[(i - 1) * W + k - 1] + BIG - (d2 | 0)) {
              map[i - 1] = k - 1;
              matched++;
              i--; k--;
              continue;
            }
          }
          if (cur === dp[(i - 1) * W + k]) { i--; continue; }
          k--;
        }
        return { map: map, matched: matched, ordered: true };
      }

      // LCS 只按「顺序」配，遇到和弦里 MIDI 和谱面音高顺序不一致时会漏掉一两个音
      // （比如谱面写 36+76、MIDI 先 76 后 36）。这里补一刀：同一时刻的和弦，
      // 把 LCS 没配上的 MIDI 音按音高配到同一拍里还没被占用的谱面音符上。
      function augmentChords(map, midiList, sList) {
        var n = map.length, m = sList.length, i, k, j, g;
        var used = {};
        for (i = 0; i < n; i++) if (map[i] >= 0) used[map[i]] = 1;

        var gs = [], cur = null;
        for (i = 0; i < n; i++) {
          var t = midiList[i].time || 0;
          if (!cur || Math.abs(t - cur.t) > 0.02) { cur = { t: t, idx: [] }; gs.push(cur); }
          cur.idx.push(i);
        }

        var added = 0;
        for (g = 0; g < gs.length; g++) {
          var grp = gs[g], tsList = [];
          for (j = 0; j < grp.idx.length; j++) {
            k = map[grp.idx[j]];
            if (k >= 0) tsList.push(sList[k].ts || 0);
          }
          if (!tsList.length) continue;
          tsList.sort(function (a, b) { return a - b; });
          var tsRef = tsList[tsList.length >> 1];

          for (j = 0; j < grp.idx.length; j++) {
            var mi = grp.idx[j];
            if (map[mi] >= 0) continue;
            var target = midiList[mi].midi;
            for (k = 0; k < m; k++) {
              if (used[k]) continue;
              if (Math.abs((sList[k].ts || 0) - tsRef) > 0.01) continue;
              if (sList[k].midi !== target) continue;
              used[k] = 1;
              map[mi] = k;
              added++;
              break;
            }
          }
        }
        return added;
      }

      // 和弦里有一两个音会被 LCS 配到「下一个同音高的音」上：比如一小节里
      // 第 1 拍和第 2 拍都有 56，MIDI 把 56 弹在 84/94/96 后面，LCS 只能往后找，
      // 于是 56 被配到第 2 拍，高亮就比实际晚了半拍/一拍。
      // 这里按「同一时刻这一组音的 ts 中位数」把跑偏的音拉回来（同音高、还没被占用的才动）。
      function fixChordStrays(map, midiList, sList) {
        var n = map.length, m = sList.length, i, k, j, g;
        var used = {};
        for (i = 0; i < n; i++) if (map[i] >= 0) used[map[i]] = 1;

        var gs = [], cur = null;
        for (i = 0; i < n; i++) {
          var t = midiList[i].time || 0;
          if (!cur || Math.abs(t - cur.t) > 0.02) { cur = { t: t, idx: [] }; gs.push(cur); }
          cur.idx.push(i);
        }

        var moved = 0;
        for (g = 0; g < gs.length; g++) {
          var grp = gs[g], tsList = [];
          for (j = 0; j < grp.idx.length; j++) {
            k = map[grp.idx[j]];
            if (k >= 0) tsList.push(sList[k].ts || 0);
          }
          if (tsList.length < 2) continue;
          tsList.sort(function (a, b) { return a - b; });
          var tsRef = tsList[tsList.length >> 1];

          for (j = 0; j < grp.idx.length; j++) {
            var mi = grp.idx[j], k0 = map[mi];
            if (k0 < 0) continue;
            if (Math.abs((sList[k0].ts || 0) - tsRef) <= 0.5) continue;   // 没跑偏
            var target = midiList[mi].midi;
            for (k = 0; k < m; k++) {
              if (used[k]) continue;
              if (Math.abs((sList[k].ts || 0) - tsRef) > 0.01) continue;
              if (sList[k].midi !== target) continue;
              used[k0] = 0;
              used[k] = 1;
              map[mi] = k;
              moved++;
              break;
            }
          }
        }
        return moved;
      }

      // 把 midiList 对到 sList 上，返回 { map, matched }
      // 注意：和弦 / 双手同时按下的地方，前向逐个匹配（matchPass）匹配掉一个音就把
      // 指针推过去了，同一时刻剩下的音全都会漏掉 —— 表现就是「每小节第一个和弦对不上」。
      // 现在优先用按顺序的 LCS（最稳），再用和弦补配；贪心几套只在大曲目（LCS 太占内存）时兜底。
      function alignList(midiList, sList) {
        var minLen = Math.max(1, midiList.length);
        var pass = matchPass(midiList, sList, false);
        var grouped = null, lcs = null, chordAdd = 0;
        var cand = pass;

        if (midiList.length * sList.length <= 8e6) {
          lcs = matchLCS(midiList, sList);
          if (lcs.matched >= pass.matched) {
            chordAdd = augmentChords(lcs.map, midiList, sList);
            fixChordStrays(lcs.map, midiList, sList);
            chordAdd += augmentChords(lcs.map, midiList, sList);   // 修完跑偏的音会空出位置，再补一遍
            lcs.matched += chordAdd;
            cand = lcs;
          }
        }
        if (cand === pass) {
          grouped = matchGroups(midiList, sList);
          if (grouped && grouped.matched > pass.matched) cand = grouped;
        }
        var byTime = null, byPitch = null;
        if (!cand.ordered && cand.matched / minLen < 0.9) {
          byTime = matchByTime(midiList, sList);
          if (byTime.matched > cand.matched) cand = byTime;
        }
        if (!cand.ordered && cand.matched / minLen < 0.7) {
          byPitch = matchPass(midiList, sList, true);
          if (byPitch.matched > cand.matched) cand = byPitch;
        }
        return {
          map: cand.map.slice(),
          matched: cand.matched,
          dbg: {
            pass: pass.matched,
            lcs: lcs ? lcs.matched : -1,
            chord: chordAdd,
            grouped: grouped ? grouped.matched : -1,
            byTime: byTime ? byTime.matched : -1,
            byPitch: byPitch ? byPitch.matched : -1,
            picked: cand === pass ? 'pass' : (cand === lcs ? 'lcs' : (cand === grouped ? 'grouped'
              : (cand === byTime ? 'byTime' : 'byPitch')))
          }
        };
      }

      function alignScoreToMidi() {
        scoreMap = null;
        alignInfo = null;
        if (!score || !score.notes.length || !notes.length) return;

        // 1) 先确定音高偏移（谱面和 MIDI 可能差一个八度）。
        //    两阶段：严格同音高先试，实在不行再按时间挑。
        var offsets = [0, 12, -12];
        var oi, off, probe, i;
        var bestOff = 0, bestExact = -1;
        var repeatLen = 0;
        try { repeatLen = detectExactRepeat(notes); } catch (eRep) { repeatLen = 0; }
        var probeList = repeatLen ? notes.slice(0, repeatLen) : notes;
        var minLen = Math.max(1, probeList.length);

        for (oi = 0; oi < offsets.length; oi++) {
          off = offsets[oi];
          probe = matchPass(probeList, scoreListForOffset(off), false).matched;
          if (probe > bestExact ||
            (probe === bestExact && Math.abs(off) < Math.abs(bestOff))) {
            bestExact = probe;
            bestOff = off;
          }
        }
        if (bestExact / minLen < 0.5) {
          var bestByTime = -1;
          for (oi = 0; oi < offsets.length; oi++) {
            off = offsets[oi];
            probe = matchByTime(probeList, scoreListForOffset(off)).matched;
            if (probe > bestByTime ||
              (probe === bestByTime && Math.abs(off) < Math.abs(bestOff))) {
              bestByTime = probe;
              bestOff = off;
            }
          }
        }
        off = bestOff;
        var sList = scoreListForOffset(off);
        alignSList = sList;             // 调试用（__dbg.rawAlign）

        // 2) 整首对一次（贪心几套 + 单调 LCS，取配得多的那套）
        var full = alignList(notes, sList);
        var covFull = mapCoverage(full.map, score.notes.length);
        var chosen = full, chosenList = notes;

        // 3) MIDI 把整首弹了两遍时，只拿第一遍对齐，第二遍照抄第一遍的下标。
        //    不这样做的话第二遍会被硬塞进谱面末尾，后半程光标卡住不动。
        //    判据：第一遍就能覆盖掉大半谱面（否则说明谱面本身也包含两遍，不能循环）。
        var covFirst = 0;
        if (repeatLen) {
          var first = alignList(notes.slice(0, repeatLen), sList);
          covFirst = mapCoverage(first.map, score.notes.length);
          if (covFirst >= 0.55 && covFirst >= covFull - 0.15) {
            chosen = first;
            chosenList = notes.slice(0, repeatLen);
          }
        }

        scoreMap = chosen.map;
        svgScoreMap = null;
        fillMapGaps(scoreMap, chosenList, sList);
        // 最后一关：强制单调（光标只能往前走）。
        // 贪心/补洞都可能在同音高重复的地方把某个音对到更靠前的谱面音符上，
        // 表现就是「光标突然回退一格，简谱高亮也跟着跳回去」。
        monotoneScoreMap(scoreMap, chosenList);

        if (chosen !== full) {
          // 展开到整首：第二遍与第一遍逐音对应
          var looped = new Array(notes.length);
          for (i = 0; i < notes.length; i++) looped[i] = -1;
          for (i = 0; i < chosenList.length && i < notes.length; i++) looped[i] = scoreMap[i];
          for (i = repeatLen; i < notes.length; i++) {
            looped[i] = looped[i - repeatLen];
          }
          scoreMap = looped;
        }
        // 简谱按 scoreFrom/scoreTo 取音：谱面先到就先算，SVG 之后到了会在建谱处再算一次
        try { buildSvgScoreMap(); } catch (eB) { }
        // 记下每个谱面音符「真正开始发声」的时刻（秒）：MIDI 里同一次和弦常被弹成琶音，
        // 各音差几十毫秒，简谱高亮要按这个时刻逐个点亮。没配上的留 null，用组时间兜底。
        scoreTime = new Array(score.notes.length);
        for (i = 0; i < scoreTime.length; i++) scoreTime[i] = null;
        for (i = 0; i < scoreMap.length; i++) {
          var siT = scoreMap[i];
          if (siT < 0 || siT >= scoreTime.length) continue;
          var tT = (notes[i] && typeof notes[i].time === 'number') ? notes[i].time : null;
          if (tT === null) continue;
          if (scoreTime[siT] === null || tT < scoreTime[siT]) scoreTime[siT] = tT;
        }

        alignInfo = {
          matched: Math.min(notes.length, chosen !== full ? chosen.matched * 2 : chosen.matched),
          total: notes.length,
          scoreNotes: score.notes.length,
          offset: off,
          repeat: repeatLen || 0,
          covFull: Math.round(covFull * 100) / 100,
          covFirst: Math.round(covFirst * 100) / 100,
          dbgFull: full.dbg,
          dbgFirst: chosen !== full ? chosen.dbg : null,
          looped: chosen !== full
        };
      }

      // ---------------- 渲染 + 每行小节数 ----------------
      var targetPerLine = 6;     // 0 = 交给 OSMD 自动断行

      function doRender() {
        /* 已移除 OSMD */
      }

      // OSMD 靠页面宽度断行，所以「每行小节数」只能通过改容器宽度来逼。
      // 先按比例估一次，再迭代校正（最多 3 轮，防止来回震荡）。
      function applyPerLine() {
        /* 已移除 OSMD：谱面排版由 SVG 决定 */
      }

      function renderScore() {
        /* 已移除 OSMD */
      }

      // ---------------- 竖向滚动框（自绘） ----------------
      // 之前用 osmd.cursor 踩了两次坑：一次是时间戳单位不一致（全音符 vs 小节），
      // 一次是缓存的 iterator 引用失效导致条件永不成立、一路推到谱末。
      // 现在改成自己在谱面 SVG 上叠一个 div —— 位置直接由 PositionAndShape 换算像素，
      // 和滚动共用同一套换算，不依赖 OSMD 的任何内部状态。
      var diagSeen = {};

      // 滚动只认框自己的像素位置，不做任何单位换算
      var scoreScrollLock = 0;
      // ---------------- 播放时高亮 ----------------
      function hitScore() {
        /* 已移除 OSMD 高亮 */
      }

      function expireScore() {
        /* 已移除 OSMD */
      }

      function clearScoreHi() {
        /* 已移除 OSMD */
      }

      // 让正在弹的音符保持在可视区内（长曲子需要滚动）。
      // OSMD 的坐标是它自己的单位，换算失败就算了，绝不能影响播放。
      var scoreScrollLock = 0;
      var scrollBadY = 0;     // 坐标明显不合理时累计次数，太多就彻底关掉自动滚动
      // ---------------- 读文件 ----------------
      function loadScoreFromText(text, name) {
        statusEl.textContent = '正在解析 MusicXML…';

        scoreMeta = null;
        try { scoreMeta = parseCredits(text); } catch (e) { }

        var res = null;
        try { res = parseMusicXML(text); } catch (e2) { res = null; }
        if (!res || !res.notes.length) {
          statusEl.textContent = 'MusicXML 解析失败（文件不是有效的 MusicXML？）';
          return;
        }

        score = {
          notes: res.notes,
          title: (scoreMeta && scoreMeta.title) || stripFileExt(name) || '',
          measures: res.measures,
          parts: res.parts,
          info: res.info || null
        };

        // jp2：保留原始 MusicXML 文本，供新简谱渲染器做富解析（音高/时值/装饰音/连音/多连音）。
        try { jp2Prepare(text); } catch (eJp) { }

        try {
          console.log('[MusicXML] 音符 ' + res.notes.length +
            '，小节 ' + res.measures + '，声部 ' + res.parts +
            '（已取代 OSMD 解析）');
          if (svgFlat.length) {
            console.log('[对齐] SVG 音符 ' + svgFlat.length + ' vs MusicXML ' + res.notes.length +
              (svgFlat.length === res.notes.length ? '  ✅ 数量一致' : '  ⚠️ 数量不一致，按比例映射'));
          }
        } catch (e3) { }

        alignScoreToMidi();
        renderScoreInfo();
        try { renderScoreHead(); } catch (eH) { }
        updateStatus();
        try { refreshMeasureOptions(); } catch (e6) { }
        // SVG 已就位时，XML 一到就重建流程，让 jp2 简谱立刻取代 efData。
        if (pendingPages.length) {
          try { waitFonts(function () { try { buildFlow(); } catch (eB) { } }); } catch (eW) { }
        }
      }

      function readXMLFile(f) {
        // 自研解析器只吃文本，所以这里必须先把文件读成字符串。
        // （OSMD 已移除，压缩包 .mxl 不再支持，请直接导入 .musicxml / .xml）
        if (!f) return;
        statusEl.textContent = '正在读取五线谱…';
        var fr = new FileReader();
        fr.onload = function () { loadScoreFromText(String(fr.result || ''), f.name); };
        fr.onerror = function () { statusEl.textContent = '读取五线谱失败'; };
        fr.readAsText(f);
      }

      function isXMLName(n) { return /\.(xml|musicxml|mxl)$/i.test(n); }

      // ---------------- 批量导入：文件夹 / 多文件自动识别 ----------------
      function fileKind(name) {
        var m = /\.([a-z0-9]+)\s*$/i.exec(String(name || ''));
        var ext = m ? m[1].toLowerCase() : '';
        if (ext === 'mid' || ext === 'midi') return 'midi';
        if (ext === 'musicxml' || ext === 'xml') return 'xml';
        if (ext === 'js') return 'jp';
        if (ext === 'svg') return 'svg';
        return '';
      }

      function relPathOf(f) {
        return String((f && (f.__rel || f.webkitRelativePath)) || (f && f.name) || '');
      }

      // ---- 导入文件快照（IndexedDB）-----------------------------------------
      // 页面导入的谱面存一份，导出视频时由录制页（同源）直接读这份快照，
      // 不再依赖服务端到 F:\钢琴曲谱 里按曲名猜目录。
      var KBF_DB = 'kb-import', KBF_ST = 'files';
      var KBF_KEEP = /\.(mid|midi|xml|musicxml|svg|js|json|txt)$/i;
      var KBF_MAX_FILES = 400, KBF_MAX_BYTES = 80 * 1024 * 1024;

      function kbfDb() {
        return new Promise(function (res, rej) {
          if (!window.indexedDB) { rej(new Error('这个浏览器不支持 IndexedDB')); return; }
          var r = indexedDB.open(KBF_DB, 1);
          r.onupgradeneeded = function () {
            var db = r.result;
            if (!db.objectStoreNames.contains(KBF_ST)) db.createObjectStore(KBF_ST);
          };
          r.onsuccess = function () { res(r.result); };
          r.onerror = function () { rej(r.error || new Error('打不开 IndexedDB')); };
        });
      }

      function kbfFolderOf(files) {
        for (var i = 0; i < files.length; i++) {
          var rel = String(files[i].webkitRelativePath || files[i].__rel || '');
          if (rel.indexOf('/') > 0) return rel.split('/')[0];
        }
        return '';
      }

      /** 覆盖保存这批文件（只留谱面相关的，超量就截断） */
      function kbfSave(files) {
        var keep = [], bytes = 0, folder = kbfFolderOf(files), i;
        for (i = 0; i < files.length && keep.length < KBF_MAX_FILES; i++) {
          var f = files[i];
          if (!f || !KBF_KEEP.test(String(f.name || ''))) continue;
          bytes += f.size || 0;
          if (bytes > KBF_MAX_BYTES) break;
          keep.push(f);
        }
        if (!keep.length) return Promise.resolve(null);
        return kbfDb().then(function (db) {
          return new Promise(function (res, rej) {
            var tx = db.transaction(KBF_ST, 'readwrite');
            var st = tx.objectStore(KBF_ST);
            st.clear();
            for (var k = 0; k < keep.length; k++) {
              st.put({
                name: keep[k].name,
                rel: relPathOf(keep[k]),
                type: keep[k].type || '',
                order: k,
                blob: keep[k]
              }, 'f' + k);
            }
            st.put({ name: '@info', folder: folder, count: keep.length, bytes: bytes, at: Date.now() }, '@info');
            tx.oncomplete = function () { res({ count: keep.length, bytes: bytes, folder: folder }); };
            tx.onerror = function () { rej(tx.error); };
          });
        }).catch(function (e) {
          try { console.warn('[快照] 保存失败：' + (e && e.message)); } catch (x) { }
          return null;
        });
      }

      function kbfRows() {
        return kbfDb().then(function (db) {
          return new Promise(function (res, rej) {
            var tx = db.transaction(KBF_ST, 'readonly');
            var st = tx.objectStore(KBF_ST);
            var out = [];
            st.openCursor().onsuccess = function (ev) {
              var c = ev.target.result;
              if (!c) { res(out); return; }
              if (c.key !== '@info') out.push(c.value);
              c.continue();
            };
            tx.onerror = function () { rej(tx.error); };
          });
        }).then(function (rows) {
          rows.sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
          return rows;
        }).catch(function () { return []; });
      }

      /** 快照里的文件，重新包成 File[]（fileKind 只看扩展名，够用） */
      function kbfFiles() {
        return kbfRows().then(function (rows) {
          var out = [];
          for (var i = 0; i < rows.length; i++) {
            var r = rows[i];
            var f;
            try {
              f = new File([r.blob], r.name, { type: r.type || '' });
            } catch (e) {
              f = r.blob;
            }
            // 保留导入时的相对路径：谱面按路径排序（xxx-1.svg、xxx-2.svg…）
            try { f.__rel = r.rel || r.name; } catch (e) { }
            out.push(f);
          }
          return out;
        });
      }

      function kbfInfo() {
        return kbfDb().then(function (db) {
          return new Promise(function (res, rej) {
            var tx = db.transaction(KBF_ST, 'readonly');
            var g = tx.objectStore(KBF_ST).get('@info');
            g.onsuccess = function () { res(g.result || null); };
            g.onerror = function () { rej(g.error); };
          });
        }).then(function (info) {
          if (!info) return null;
          // 顺手把文件清单（名字 + 大小）带出去：浏览器拿不到文件夹的绝对路径，
          // 服务端只能靠这份清单到磁盘上反查那层目录
          return kbfRows().then(function (rows) {
            var list = [];
            for (var i = 0; i < rows.length; i++) {
              var r = rows[i];
              if (!r || r.name === '@info') continue;
              list.push({ name: r.name, size: (r.blob && r.blob.size) || 0 });
            }
            info.list = list;
            return info;
          });
        }).catch(function () { return null; });
      }

      function kbfClear() {
        return kbfDb().then(function (db) {
          return new Promise(function (res, rej) {
            var tx = db.transaction(KBF_ST, 'readwrite');
            tx.objectStore(KBF_ST).clear();
            tx.oncomplete = function () { res(true); };
            tx.onerror = function () { rej(tx.error); };
          });
        }).catch(function () { return false; });
      }

      // 递归收集拖入的文件夹 / 文件（webkitGetAsEntry）
      function collectDropFiles(dt, done) {
        var out = [];
        function push(f, rel) {
          if (!f) return;
          try { f.__rel = rel || f.webkitRelativePath || f.name; } catch (e) { }
          out.push(f);
        }
        // 目录里的文件只能通过 entry.file() 拿（失败时记一条日志，不静默吞掉）
        function fileFromEntry(entry, cb) {
          try {
            entry.file(function (f) { push(f, entry.fullPath || f.name); cb(); },
              function (err) {
                try {
                  console.warn('[导入] 读取失败：' + (entry.fullPath || entry.name) + ' ' + (err && err.name));
                } catch (e) { }
                cb();
              });
          } catch (e) { cb(); }
        }
        function walk(entry, cb) {
          if (!entry) { cb(); return; }
          if (entry.isFile) { fileFromEntry(entry, cb); return; }
          if (!entry.isDirectory) { cb(); return; }
          var reader;
          try { reader = entry.createReader(); } catch (e) { cb(); return; }
          (function next() {
            try {
              reader.readEntries(function (ents) {
                if (!ents || !ents.length) { cb(); return; }
                var left = ents.length;
                for (var i = 0; i < ents.length; i++) {
                  walk(ents[i], function () { if (--left === 0) next(); });
                }
              }, function () { cb(); });
            } catch (e) { cb(); }
          })();
        }

        var items = (dt && dt.items) ? dt.items : null;
        var n = items ? items.length : 0;
        var dirs = [], needEntry = [];
        for (var i = 0; i < n; i++) {
          var it = items[i];
          if (!it || it.kind !== 'file') continue;
          var en = null;
          try { en = (it.webkitGetAsEntry && it.webkitGetAsEntry()) || null; } catch (e) { en = null; }
          if (en && en.isDirectory) { dirs.push(en); continue; }
          // 普通文件优先用 getAsFile()：直接给出可读的 File；
          // 某些环境（含 file:// 页面、部分拖放来源）entry.file() 会报 EncodingError。
          var f0 = null;
          try { f0 = (it.getAsFile && it.getAsFile()) || null; } catch (e) { f0 = null; }
          if (f0) { push(f0, f0.name); continue; }
          if (en && en.isFile) needEntry.push(en);
        }

        function finishAll() {
          if (!out.length) {
            var fl = (dt && dt.files) || [];
            for (var k = 0; k < fl.length; k++) {
              push(fl[k], fl[k].webkitRelativePath || fl[k].name);
            }
          }
          try {
            console.log('[导入] 收到拖放：条目 ' + n + ' 个（其中文件夹 ' + dirs.length +
              ' 个），读到文件 ' + out.length + ' 个');
          } catch (e) { }
          done(out, dirs.length);
        }
        var pending = dirs.length + needEntry.length;
        if (!pending) { finishAll(); return; }
        var one = function () { if (--pending === 0) finishAll(); };
        for (var d = 0; d < dirs.length; d++) walk(dirs[d], one);
        for (var e2 = 0; e2 < needEntry.length; e2++) fileFromEntry(needEntry[e2], one);
      }

      // 执行一段简谱数据脚本（window.efData = [...]）
      function loadJpText(txt, name) {
        txt = String(txt || '').replace(/document\.title\s*=\s*("[^"]*"|'[^']*')\s*;?/g, '');
        try {
          (new Function(txt))();
        } catch (err) {
          if (statusEl) statusEl.textContent = '简谱数据执行失败：' + (err && err.message ? err.message : err);
          return false;
        }
        var n = (window.efData && window.efData.length) || 0;
        if (!n) {
          if (statusEl) statusEl.textContent = '该文件里没有 efData';
          return false;
        }
        var lines = 0;
        for (var i = 0; i < window.efData.length; i++) {
          if (/^musicLine--/.test(String(window.efData[i].label || ''))) lines++;
        }
        if (statusEl) statusEl.textContent = '已载入简谱 ' + n + ' 节 / ' + lines + ' 行' +
          (name ? '（' + name + '）' : '');
        if (pendingPages.length) buildFlow();
        return true;
      }

      function readJpFile(f) {
        if (!f) return;
        var fr = new FileReader();
        fr.onload = function () { loadJpText(String(fr.result || ''), f.name); };
        fr.onerror = function () { if (statusEl) statusEl.textContent = '读取简谱数据失败'; };
        fr.readAsText(f);
      }

      // 一组 .js 里挑出简谱数据：先看文本里有没有 efData，避免执行无关脚本
      function tryJpFiles(list, idx, done) {
        if (!list || idx >= list.length) { if (done) done(false); return; }
        var f = list[idx];
        var fr = new FileReader();
        fr.onload = function () {
          var txt = String(fr.result || '');
          if (txt.indexOf('efData') < 0) { tryJpFiles(list, idx + 1, done); return; }
          loadJpText(txt, f.name);
          if (done) done(true);
        };
        fr.onerror = function () { tryJpFiles(list, idx + 1, done); };
        fr.readAsText(f);
      }

      // 一批文件按扩展名自动分派：SVG → 简谱 → MusicXML → MIDI
      function loadImportedFiles(files, opts) {
        if (!files || !files.length) return 0;
        // 记住这批文件（IndexedDB 快照）：导出视频时录制页直接从这里取，不再靠服务端猜磁盘目录
        if (!opts || opts.snapshot !== false) kbfSave(files);
        var svgs = [], jps = [], mids = [], xmls = [], other = 0, i;
        for (i = 0; i < files.length; i++) {
          var kind = fileKind(files[i].name);
          if (kind === 'svg') svgs.push(files[i]);
          else if (kind === 'jp') jps.push(files[i]);
          else if (kind === 'midi') mids.push(files[i]);
          else if (kind === 'xml') xmls.push(files[i]);
          else other++;
        }
        function byPath(a, b) {
          return relPathOf(a).localeCompare(relPathOf(b), undefined, { numeric: true });
        }
        svgs.sort(byPath); jps.sort(byPath); mids.sort(byPath); xmls.sort(byPath);

        var found = [];
        if (svgs.length) found.push(svgs.length + ' 个 SVG');
        if (jps.length) found.push(jps.length + ' 个 JS');
        if (xmls.length) found.push('MusicXML');
        if (mids.length) found.push('MIDI');
        if (!found.length) {
          if (statusEl) statusEl.textContent = '没识别到可用的文件（要 .svg / .js / .mid / .musicxml）';
          return 0;
        }
        try {
          console.log('[导入] 共 ' + files.length + ' 个文件，识别到 ' + found.join(' + ') +
            (other ? ('，忽略 ' + other + ' 个其它文件') : '') +
            (xmls.length > 1 ? ('，MusicXML 取第 1 个') : '') +
            (mids.length > 1 ? ('，MIDI 取第 1 个') : ''));
        } catch (e) { }
        if (statusEl) statusEl.textContent = '识别到 ' + found.join(' + ') + '，开始载入…';

        if (svgs.length) readSvgFiles(svgs);
        if (jps.length) tryJpFiles(jps, 0, function (ok) {
          if (!ok) { try { console.warn('[导入] 没有找到含 efData 的简谱 JS'); } catch (e) { } }
        });
        if (xmls.length) readXMLFile(xmls[0]);
        if (mids.length) readFile(mids[0]);
        return found.length;
      }

      function importFromDataTransfer(dt) {
        if (!dt) return;
        if (statusEl) statusEl.textContent = '正在读取拖入的文件…';
        try {
          collectDropFiles(dt, function (files, dirCount) {
            if (!files.length) {
              if (statusEl) {
                if (dirCount && location.protocol === 'file:') {
                  // file:// 页面拿不到拖入文件夹里的文件内容（浏览器限制），引导用按钮
                  statusEl.textContent = '本地页面（file://）读不到拖入文件夹里的文件：请点「导入文件夹」，' +
                    '或把文件夹里的文件全选一起拖进来';
                } else if (dirCount) {
                  statusEl.textContent = '文件夹里没读到可用的文件（可能为空或没有 .svg/.js/.mid/.musicxml）';
                } else {
                  statusEl.textContent = '没读到文件：拖入文件夹或 .svg/.js/.mid/.musicxml 试试';
                }
              }
              return;
            }
            loadImportedFiles(files);
          });
        } catch (e) {
          if (statusEl) statusEl.textContent = '读取拖入内容失败：' + (e && e.message ? e.message : e);
        }
      }


      // ---------- 装载数据 ----------
      var curLabel = '';
      var curLegend = [];

      // 按开关决定键区：固定 88 键，或跟随曲子音域
      function applyRange() {
        var lo, hi, r;
        if (fullChk.checked || !notes.length) { lo = 21; hi = 108; }
        else { r = fitRange(notes); lo = r[0]; hi = r[1]; }
        buildKeyboard(lo, hi);
        clearHighlights();
      }

      function updateStatus() {
        if (!curLabel) { statusEl.textContent = '拖入 .mid 与 MusicXML 开始'; return; }
        var s = curLabel + ' · ' + notes.length + ' 个音符 · ' + fmt(total) +
          ' · 键区 ' + noteName(viewLow) + '–' + noteName(viewHigh);
        // 谱面对齐情况：对不上说明这份 MIDI 和这份谱不是同一首，或者调性不同
        if (score && alignInfo) {
          var pct = alignInfo.total ? Math.round(alignInfo.matched / alignInfo.total * 100) : 0;
          s += ' · 谱面对齐 ' + alignInfo.matched + '/' + alignInfo.total + '（' + pct + '%）';
          if (pct < 60) s += ' ⚠️ 谱与音频可能不是同一首';
          s += ' · ' + describeScore();
        }
        statusEl.textContent = s;
      }

      function setNotes(list, label, legend) {
        playing = false;
        playBtn.textContent = '播放';
        try { document.body.classList.toggle('cleanplay', !!playing); } catch (eCP) { }
        stopAllNodes();
        clearHighlights();
        if (ac) ac.suspend();

        notes = list.sort(function (a, b) { return a.time - b.time; });
        total = notes.reduce(function (mx, n) { return Math.max(mx, n.time + n.dur); }, 0);
        startTime = 0;
        schedPtr = 0;
        visPtr = 0;
        lastStart = {};
        active = [];
        recentOn = [];
        curLabel = label;

        applyRange();

        playBtn.disabled = false;
        restartBtn.disabled = false;
        expBtn.disabled = false;
        var dataBtnRef = document.getElementById('dataBtn');
        if (dataBtnRef) dataBtnRef.disabled = false;
        var infoBtnRef = document.getElementById('infoBtn');
        if (infoBtnRef) infoBtnRef.disabled = false;
        barfill.style.width = '0%';
        curMeasureNo = -1; try { clearSvgHi(); hideFlowCursor(); } catch (e) { } timeEl.textContent = '0:00 / ' + fmt(total);
        updateStatus();

        curLegend = legend || [];
        refreshLegend();

        // 有了 MIDI，就能把谱面和音符对起来了
        if (score) { alignScoreToMidi(); updateStatus(); }
        groupsDirty();                       // 曲目换了，音符组要重建
        try { refreshMeasureOptions(); } catch (e7) { }
      }

      // 底部图例随配色方案变化
      function refreshLegend() {
        if (!notes.length) { renderLegend([]); return; }
        if (COLOR_MODE === 'octave') {
          var used = {}, items = [], o, i;
          for (i = 0; i < notes.length; i++) used[Math.floor(notes[i].midi / 12) - 1] = 1;
          for (o = 0; o <= 8; o++) {
            if (used[o]) items.push({ name: '八度 ' + o, color: 'hsl(' + octaveHue(o) + ', 66%, 42%)' });
          }
          renderLegend(items);
          return;
        }
        if (COLOR_MODE === 'track') { renderLegend(curLegend); return; }
        if (COLOR_MODE === 'pitch') {
          renderLegend([
            { name: '低音区', color: pitchColor(33) },
            { name: '中音区', color: pitchColor(64) },
            { name: '高音区', color: pitchColor(96) }
          ]);
          return;
        }
        if (COLOR_MODE === 'keytype') {
          renderLegend([
            { name: '白键', color: '#2f81f7' },
            { name: '黑键', color: '#ffb86b' }
          ]);
          return;
        }
        renderLegend([{ name: '全部按键（单色）', color: '#2f81f7', count: notes.length }]);
      }

      // 底部那句提示：播放页可以在引入本文件前用 window.KB_LEGEND_HINT 换掉
      function legendHint() {
        var t = window.KB_LEGEND_HINT;
        if (typeof t === 'string' && t) return t;
        return '空格键 = 播放/暂停 · 拖入文件夹或 .mid/.musicxml/.svg/简谱 .js 自动识别';
      }

      function renderLegend(items) {
        legendEl.innerHTML = items.map(function (it) {
          var cnt = it.count ? ' <b>' + it.count + '</b>' : '';
          return '<span class="lg"><i style="background:' + it.color + '"></i>' +
            esc(it.name) + cnt + '</span>';
        }).join('') + '<span class="hint">' + esc(legendHint()) + '</span>';
      }

      function esc(s) {
        return String(s).replace(/[&<>"]/g, function (c) {
          return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
        });
      }

      var PALETTE = ['#2f81f7', '#ffb86b', '#7ee787', '#d2a8ff', '#ff7b72', '#79c0ff'];

      function parseMidi(buf, name) {
        var lib = window.Midi;
        var Ctor = lib && (lib.Midi || lib);
        if (!Ctor) {
          statusEl.textContent = 'MIDI 解析库没加载成功，请检查网络后刷新';
          return;
        }
        var midi = new Ctor(buf);
        var all = [], legend = [];

        // MIDI 头里的速度 / 拍号 / 调号，给顶部「谱面信息」兜底
        try {
          var hdr = midi.header || {};
          var tp = hdr.tempos && hdr.tempos[0];
          var ts = hdr.timeSignatures && hdr.timeSignatures[0];
          var ks = hdr.keySignatures && hdr.keySignatures[0];
          midiInfo = {
            tempo: tp ? Math.round(tp.bpm) : 0,
            beats: (ts && ts.timeSignature && ts.timeSignature[0]) || 0,
            beatType: (ts && ts.timeSignature && ts.timeSignature[1]) || 0,
            key: ks ? String(ks.key || '') : ''
          };
        } catch (eH) { midiInfo = { tempo: 0, beats: 0, beatType: 0, key: '' }; }

        midi.tracks.forEach(function (tr, idx) {
          if (tr.channel === 9) return;                  // 跳过打击乐
          if (!tr.notes || !tr.notes.length) return;
          var color = PALETTE[legend.length % PALETTE.length];
          legend.push({
            name: tr.name || ('轨道 ' + (idx + 1)),
            color: color,
            count: tr.notes.length
          });
          tr.notes.forEach(function (n) {
            all.push({
              midi: n.midi,
              time: n.time,
              dur: Math.max(0.06, n.duration),
              vel: n.velocity,
              trackColor: color
            });
          });
        });

        if (!all.length) {
          statusEl.textContent = '这个文件里没有可显示的音符';
          return;
        }
        setNotes(all, name, legend);
        try { renderScoreHead(); } catch (eH2) { }
      }

      function readFile(file) {
        var reader = new FileReader();
        reader.onload = function () {
          try {
            parseMidi(reader.result, file.name);
          } catch (e) {
            statusEl.textContent = '解析失败：' + (e && e.message ? e.message : e);
          }
        };
        reader.onerror = function () { statusEl.textContent = '读取文件失败'; };
        reader.readAsArrayBuffer(file);
      }

      // ---------- 事件 ----------
      playBtn.addEventListener('click', togglePlay);
      restartBtn.addEventListener('click', restart);
      if (startMeasSel) {
        startMeasSel.addEventListener('change', function () { try { applyStartMeasure(); } catch (e) { } });
      }

      fileInput.addEventListener('change', function (e) {
        var f = e.target.files && e.target.files[0];
        if (f) readFile(f);
        e.target.value = '';           // 允许重复选择同一个文件
      });

      xmlInput.addEventListener('change', function (e) {
        var f = e.target.files && e.target.files[0];
        if (f) readXMLFile(f);
        e.target.value = '';
      });

      volInput.addEventListener('input', function () {
        if (master) master.gain.value = (volInput.value / 100) * 0.9;
      });

      // 「导出视频」按钮由页面里的 wireExportService() 接管（弹服务弹窗）；
      // 真正开录走 recordStage()，所以这里不再挂任何监听。

      labelChk.addEventListener('change', function () {
        var show = labelChk.checked;
        Object.keys(keyEls).forEach(function (m) {
          keyEls[m].querySelector('.lab').style.visibility = show ? 'visible' : 'hidden';
        });
      });

      // 配色方案切换：清掉当前高亮，下一帧会用新颜色重新点亮
      colorModeSel.addEventListener('change', function () {
        COLOR_MODE = colorModeSel.value;
        clearHighlights();
        refreshLegend();
      });

      // 88 键 / 跟随音域
      fullChk.addEventListener('change', function () {
        applyRange();
        updateStatus();
      });

      // 每行小节数
      (function wirePerLine() {
        var sel = document.getElementById('perLineSel');
        // SVG 版排版由 SVG 决定，「每行小节数」已无作用，隐藏它
        if (sel && sel.parentNode) sel.parentNode.style.display = 'none';
        if (!sel) return;
        sel.addEventListener('change', function () {
          targetPerLine = parseInt(sel.value, 10) || 0;
          if (!score) return;
          if (!targetPerLine) {
            scoreEl.style.width = '';      // 回到跟随容器宽度
            doRender();
          } else {
            applyPerLine();
          }
          updateStatus();
        });
      })();

      // 黑键宽、长已固定成常量（宽度 0.75，长度 0.56），不再提供滑块。
      // 想调整比例直接改上面的 KW / KH 即可，页面键盘和视频导出会一起生效。

      // 窗口尺寸变化后按新宽度重排（字号也跟着变）
      var rzTimer = null;
      window.addEventListener('resize', function () {
        clearTimeout(rzTimer);
        rzTimer = setTimeout(function () {
          buildKeyboard(viewLow, viewHigh);
          clearHighlights();
          if (score) renderScore();     // 谱面按新宽度重新分行
        }, 160);
      });

      document.addEventListener('keydown', function (e) {
        if (window.KB_NO_SPACEKEY) return;   // 嵌入到网页里时别抢空格（页面要翻页）
        if (e.code === 'Space' && e.target.tagName !== 'INPUT') {
          e.preventDefault();
          togglePlay();
        }
      });

      // 拖放（演示页用来导入 .mid/.musicxml/.svg/简谱 js；
      // 播放页设了 window.KB_NO_IMPORT，整段跳过，只认页面自己处理的「数据 js」）
      ['dragenter', 'dragover'].forEach(function (ev) {
        if (window.KB_NO_IMPORT) return;
        document.addEventListener(ev, function (e) {
          e.preventDefault();
          document.body.style.outline = '2px dashed #2f81f7';
          document.body.style.outlineOffset = '-6px';
        });
      });
      ['dragleave', 'drop'].forEach(function (ev) {
        if (window.KB_NO_IMPORT) return;
        document.addEventListener(ev, function (e) {
          e.preventDefault();
          document.body.style.outline = 'none';
        });
      });
      document.addEventListener('drop', function (e) {
        if (window.KB_NO_IMPORT) return;
        if (!e.dataTransfer) return;
        try {
          console.log('[导入] drop：items=' + (e.dataTransfer.items ? e.dataTransfer.items.length : 0) +
            ' files=' + (e.dataTransfer.files ? e.dataTransfer.files.length : 0));
        } catch (err) { }
        // 文件夹 / 多文件：递归收集后按扩展名自动分派
        importFromDataTransfer(e.dataTransfer);
      });

      // 收尾
      renderLegend([]);
      // ================= 诊断 =================
      var errLog = [];
      try {
        window.addEventListener('error', function (e) {
          errLog.push('ERR ' + (e.message || '?') + ' @' + (e.lineno || '?'));
          if (errLog.length > 12) errLog.shift();
        });
        window.addEventListener('unhandledrejection', function (e) {
          var r = e && e.reason;
          errLog.push('REJECT ' + (r && r.message ? r.message : String(r)));
          if (errLog.length > 12) errLog.shift();
        });
      } catch (e0) { }

      function buildDiag() {
        var L = [];
        function a(k, v) { L.push(k + ': ' + v); }

        L.push('==== 环境 ====');
        a('UA', navigator.userAgent);
        a('解析器', '内置 MusicXML 解析（无 OSMD）' +
          ' OpenSheetMusicDisplay=' + (window.OpenSheetMusicDisplay ? 'Y' : 'N'));
        a('谱面来源', svgFlat.length ? ('SVG ' + svgFlat.length + ' 个音符 / ' + svgSystems.length + ' 行') : '未导入 SVG');
        a('Midi 库', window.Midi ? 'Y' : 'N');

        L.push('');
        L.push('==== 谱面 ====');
        if (score) {
          a('标题', score.title);
          a('音符', score.notes.length);
          a('小节', score.measures);
          a('声部', score.parts);
          a('装饰音', (function () {
            var g = 0;
            for (var gi = 0; gi < score.notes.length; gi++) if (score.notes[gi].grace) g++;
            return g;
          })());
        } else { a('score', '未载入'); }
        a('解析出的曲名', scoreMeta
          ? ('[' + scoreMeta.title + '] [' + scoreMeta.subtitle + '] [' + scoreMeta.composer + ']')
          : '无');
        try {
          if (svgFlat.length && svgSystems.length) {
            var perSys = [], ps;
            for (ps = 0; ps < svgSystems.length; ps++) {
              var c = 0;
              for (var pn = 0; pn < svgFlat.length; pn++) {
                if (svgFlat[pn].blk === ps) c++;
              }
              perSys.push(c);
            }
            a('SVG 每行音符', perSys.join('/'));
          }
        } catch (eR) { }

        L.push('');
        L.push('==== SVG ====');
        a('已导入', svgFlat.length ? 'Y' : 'N（请点「导入 SVG」多选全部页面）');
        a('页数', svgPages.length);
        a('行数', svgSystems.length);
        a('SVG 音符', svgFlat.length);
        a('MusicXML 音符', score ? score.notes.length : 0);
        if (svgFlat.length && score) {
          a('数量匹配', svgFlat.length === score.notes.length
            ? '✅ 一致（按序号 1:1 对应）'
            : ('⚠️ 不一致（' + svgFlat.length + ' vs ' + score.notes.length + '），按比例映射'));
        }
        for (var blkIdx = 0; blkIdx < blocks.length; blkIdx++) {
          var bO = blocks[blkIdx];
          var bR = (bO.svg || bO.el).getBoundingClientRect();
          a('组 ' + (blkIdx + 1),
            '页 ' + (bO.page + 1) + ' 行 ' + (bO.sys + 1) +
            '  音符 ' + bO.noteCount +
            '  渲染 ' + Math.round(bR.width) + 'x' + Math.round(bR.height));
        }

        if (score && score.notes.length > 1) {
          var bad = -1, maxTs = -1e9;
          for (var q = 0; q < score.notes.length; q++) {
            var qs = score.notes[q].ts;
            if (qs < maxTs - 1e-6) { bad = q; break; }
            if (qs > maxTs) maxTs = qs;
          }
          a('ts 单调', bad < 0 ? 'Y' :
            ('N  首次倒序在 #' + bad + ' (前一个 ' + maxTs + ' > ' + score.notes[bad].ts + ')'));
        }

        L.push('');
        L.push('==== 音符抽样 ====');
        if (score && score.notes.length) {
          var n0 = score.notes.length;
          var idxs = [0, 1, 2, Math.floor(n0 / 2), Math.floor(n0 / 2) + 1, n0 - 1];
          for (var i = 0; i < idxs.length; i++) {
            var n = score.notes[idxs[i]];
            if (!n) continue;
            var sv = svgIndexOfScore(idxs[i]);
            var geo = '无';
            if (sv >= 0 && svgFlat[sv] && blocks[svgFlat[sv].blk]) {
              var bb0 = blocks[svgFlat[sv].blk];
              geo = '(' + Math.round(svgFlat[sv].x) + ',' + Math.round(svgFlat[sv].y) +
                ') 页' + (bb0.page + 1) + ' 行' + (bb0.sys + 1);
            }
            L.push('  #' + idxs[i] + ' midi=' + n.halfTone + ' ts=' + Math.round(n.ts * 100) / 100 +
              ' 小节=' + (n.measure + 1) + (n.grace ? '(装饰)' : '') +
              ' SVG=' + (sv >= 0 ? ('#' + sv + ' ' + geo) : '未对应'));
          }
        }

        L.push('');
        L.push('==== 对齐 ====');
        if (alignInfo) {
          a('matched/total', alignInfo.matched + '/' + alignInfo.total);
          a('offset', alignInfo.offset);
          a('谱面音符', alignInfo.scoreNotes);
          if (scoreMap) {
            var head = [], tail = [], i2;
            for (i2 = 0; i2 < Math.min(8, scoreMap.length); i2++) head.push(scoreMap[i2]);
            for (i2 = Math.max(0, scoreMap.length - 4); i2 < scoreMap.length; i2++) tail.push(scoreMap[i2]);
            a('scoreMap 前 8', head.join(','));
            a('scoreMap 后 4', tail.join(','));
          }
        } else { a('alignInfo', '无'); }

        L.push('');
        L.push('==== MIDI ====');
        a('音符', notes.length);
        a('时长', fmt(total));

        L.push('');
        L.push('==== 滚动框 ====');
        var cb = document.getElementById('cursorBox');
        if (cb) {
          a('存在', 'Y');
          a('display', cb.style.display || '(空)');
          a('style', 'left=' + cb.style.left + ' top=' + cb.style.top +
            ' w=' + cb.style.width + ' h=' + cb.style.height);
          var cr = cb.getBoundingClientRect();
          a('实际矩形', Math.round(cr.left) + ',' + Math.round(cr.top) +
            ' ' + Math.round(cr.width) + 'x' + Math.round(cr.height));
        } else { a('存在', 'N'); }
        a('scoreWrap', 'scrollTop=' + Math.round(scoreWrap.scrollTop) +
          ' scrollHeight=' + Math.round(scoreWrap.scrollHeight) +
          ' clientHeight=' + Math.round(scoreWrap.clientHeight) +
          ' hidden=' + (scoreWrap.hidden ? 'Y' : 'N'));
        var svgWrapDiag = document.getElementById('svgWrap');
        if (svgWrapDiag) {
          a('svgWrap', 'scrollTop=' + Math.round(svgWrapDiag.scrollTop) +
            ' scrollHeight=' + Math.round(svgWrapDiag.scrollHeight) +
            ' clientHeight=' + Math.round(svgWrapDiag.clientHeight) +
            ' hidden=' + (svgWrapDiag.hidden ? 'Y' : 'N'));
        }

        L.push('');
        L.push('==== 简谱高亮 ====');
        var hiDiag = 0, hiAllDiag = document.querySelectorAll('.SparksNMN-notehl');
        for (var hiIdx = 0; hiIdx < hiAllDiag.length; hiIdx++) {
          if (hiAllDiag[hiIdx].style.visibility === 'visible') hiDiag++;
        }
        a('当前点亮', hiDiag + ' 个音符');
        if (blocks.length) {
          var anTotDiag = 0, anOkDiag = 0, dz2;
          for (dz2 = 0; dz2 < blocks.length; dz2++) {
            var anLDiag = jpNoteAnchors(blocks[dz2]);
            if (anLDiag.length) anOkDiag++;
            anTotDiag += anLDiag.length;
          }
          a('组数', blocks.length);
          a('音符锚点', anTotDiag + ' 个 / ' + anOkDiag + ' 组有锚点（发声 ' + jpSounding(blocks[0]).length +
            ' 个，首组音符 ' + ((blocks[0].noteTo || 0) - (blocks[0].noteFrom || 0)) + '）');
          a('首组音符', ((blocks[0].noteTo || 0) - (blocks[0].noteFrom || 0)));
        } else { a('组数', 0); }

        L.push('');
        L.push('==== 播放 ====');
        a('playing', playing);
        a('起播', '第 ' + ((startMeasSel && startMeasSel.value) || 1) + ' 小节 / ' + fmt(playFromTime));
        try {
          a('进度', fmt(ac && startTime ? (ac.currentTime - startTime) : 0));
        } catch (e4) { a('进度', '?'); }

        L.push('');
        L.push('==== 错误日志 ====');
        L.push(errLog.length ? errLog.join('\n') : '（无）');

        return L.join('\n');
      }

      function showDiag() {
        var txt;
        try { txt = buildDiag(); }
        catch (e) { txt = '生成诊断失败：' + (e && e.message ? e.message : e); }
        try { console.log(txt); } catch (e2) { }
        var out = document.getElementById('diagOut');
        if (out) out.textContent = txt;
        var md = document.getElementById('diagModal');
        if (md) md.hidden = false;
      }

      (function wireDiag() {
        var b = document.getElementById('diagBtn');
        if (b) b.addEventListener('click', showDiag);
        var c = document.getElementById('diagClose');
        if (c) c.addEventListener('click', function () {
          document.getElementById('diagModal').hidden = true;
        });
        var cp = document.getElementById('diagCopy');
        if (cp) cp.addEventListener('click', function () {
          var t = document.getElementById('diagOut').textContent;
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(t).then(function () {
              cp.textContent = '已复制';
              setTimeout(function () { cp.textContent = '复制'; }, 1500);
            }, function () { });
          }
        });
      })();

      // ================= 「音符信息」：按组列出四个来源识别到的音符 =================
      function dWidth(s) {                 // 等宽输出的显示宽度（中日文按 2 列算）
        s = String(s);
        var w = 0, i, c;
        for (i = 0; i < s.length; i++) {
          c = s.charCodeAt(i);
          w += (c > 0x1100 && (
            c <= 0x115f || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) ||
            (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe6f) ||
            (c >= 0xff00 && c <= 0xff60) || (c >= 0xffe0 && c <= 0xffe6))) ? 2 : 1;
        }
        return w;
      }
      function padR(s, n) { s = String(s); while (dWidth(s) < n) s += ' '; return s; }
      function padL(s, n) { s = String(s); while (dWidth(s) < n) s = ' ' + s; return s; }
      function secs2(t) {
        t = Math.max(0, t || 0);
        var m = Math.floor(t / 60), r = t % 60;
        return m + ':' + (r < 10 ? '0' : '') + r.toFixed(2);
      }

      function buildNoteInfo() {
        var L = [], i, gi, mm;
        function a(k, v) { L.push(padR(k, 12) + v); }

        if (!GROUPS) { try { buildGroups(); } catch (e0) { } }

        L.push('音符识别信息 —— 按「音符组」（小节内同一拍的和弦 / 琶音算一组）');
        L.push('');
        L.push('==== 四个来源 ====');
        a('MusicXML', score
          ? ('音符 ' + score.notes.length + ' · 小节 ' + score.measures + ' · 声部 ' + score.parts)
          : '未载入');
        a('MIDI', notes.length ? ('音符 ' + notes.length + ' · 时长 ' + fmt(total)) : '未载入');
        a('SVG', svgFlat.length
          ? ('页 ' + svgPages.length + ' · 行 ' + svgSystems.length + ' · 块 ' + blocks.length + ' · 符头 ' + svgFlat.length)
          : '未导入');
        var hlN = 0, sndN = 0;
        try { hlN = document.querySelectorAll('#svgHost .SparksNMN-notehl').length; } catch (e1) { }
        try { for (i = 0; i < blocks.length; i++) sndN += jpSounding(blocks[i]).length; } catch (e2) { }
        a('efData', (hlN || sndN) ? ('高亮块 ' + hlN + ' · 发声锚点 ' + sndN) : '未载入');
        a('谱面对齐', alignInfo
          ? (alignInfo.matched + '/' + alignInfo.total +
            '（' + Math.round(alignInfo.matched / Math.max(1, alignInfo.total) * 100) + '%）' +
            ' · 音高偏移 ' + alignInfo.offset + (alignInfo.repeat ? ' · 重复段 ' + alignInfo.repeat : ''))
          : '未对齐（缺 MusicXML 或 MIDI）');

        if (!GROUPS || !GROUPS.list.length) {
          L.push('');
          L.push('（还没有可用的音符组：需要 MusicXML 才能按小节 / 拍分组）');
          return L.join('\n');
        }

        var list = GROUPS.list, chordN = 0, badN = 0;
        for (gi = 0; gi < list.length; gi++) {
          if (list[gi].members.length > 1) chordN++;
          var mt0 = 0;
          for (mm = 0; mm < list[gi].members.length; mm++) {
            if (GROUPS.tOf[list[gi].members[mm]] >= 0) mt0++;
          }
          if (mt0 < list[gi].members.length) badN++;
        }
        a('音符组', list.length + ' 组 · 其中和弦/琶音 ' + chordN + ' 组 · MIDI 未全配 ' + badN + ' 组');
        a('当前组', gPtr >= 0 ? ('#' + (gPtr + 1) + '（小节 ' + (list[gPtr].measure + 1) + '）') : '不在播放');

        L.push('');
        L.push('==== 组（小节内同一拍算一组；同组只挪一次框） ====');
        L.push(padR('组', 6) + padR('小节', 7) + padR('起播', 10) +
          padR('MusicXML 音符', 28) + padL('MIDI', 7) + padL('SVG', 7) + '  ' + '简谱');
        var cap = Math.min(list.length, 300);
        for (gi = 0; gi < cap; gi++) {
          var g = list[gi], names = [], mt = 0, ms = 0, jpOk = false;
          for (mm = 0; mm < g.members.length; mm++) {
            var si = g.members[mm], rec = score.notes[si];
            if (names.length < 8) names.push(noteName(rec.halfTone) + (rec.grace ? '·g' : ''));
            if (GROUPS.tOf[si] >= 0) mt++;
            if (svgIndexOfScore(si) >= 0) ms++;
          }
          if (g.members.length > 8) names.push('…');
          try {
            var k0 = svgIndexOfScore(g.lead);
            if (k0 >= 0 && svgFlat[k0] && blocks[svgFlat[k0].blk]) {
              jpOk = !!jpAnchorFor(blocks[svgFlat[k0].blk], g.lead);
            }
          } catch (e3) { }
          var flag = (mt < g.members.length ? '⚠MIDI ' : '') + (ms < g.members.length ? '⚠SVG ' : '');
          L.push(padR('#' + (gi + 1), 6) +
            padR('m' + (g.measure + 1), 7) +
            padR(secs2(GROUPS.t[gi]), 10) +
            padR(names.join(' ') + (g.members.length > 1 ? ' (' + g.members.length + ')' : ''), 28) +
            padL(mt + '/' + g.members.length, 7) +
            padL(ms + '/' + g.members.length, 7) +
            '  ' + (jpOk ? '✓' : '·') +
            (gi === gPtr ? '   ⟵播放中' : '') +
            (flag ? '   ' + flag : ''));
        }
        if (list.length > cap) L.push('… 还有 ' + (list.length - cap) + ' 组（只显示前 ' + cap + ' 组）');
        L.push('');
        L.push('说明：MIDI 3/3 = 这一组 3 个音在 MIDI 里都配到了播放时刻；SVG 3/3 = 3 个符头都定位到了谱面；');
        L.push('      简谱 ✓ = 这一组的 lead 音符在简谱行里找到了对应的高亮块；⚠ 表示该来源在这一组缺音符。');
        return L.join('\n');
      }

      function showNoteInfo() {
        var txt;
        try { txt = buildNoteInfo(); }
        catch (e) { txt = '生成音符信息失败：' + (e && e.message ? e.message : e); }
        var out = document.getElementById('infoOut');
        if (out) out.textContent = txt;
        var md = document.getElementById('infoModal');
        if (md) md.hidden = false;
      }

      (function wireNoteInfo() {
        var b = document.getElementById('infoBtn');
        if (b) b.addEventListener('click', showNoteInfo);
        var c = document.getElementById('infoClose');
        if (c) c.addEventListener('click', function () {
          var md = document.getElementById('infoModal');
          if (md) md.hidden = true;
        });
        var cp = document.getElementById('infoCopy');
        if (cp) cp.addEventListener('click', function () {
          var out = document.getElementById('infoOut');
          var t = out ? out.textContent : '';
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(t).then(function () {
              cp.textContent = '已复制';
              setTimeout(function () { cp.textContent = '复制'; }, 1500);
            }, function () { });
          }
        });
      })();

      // ================= 对照流：SVG 五线谱 + 简谱 =================
      var MEAS_PER_LINE = 4;
      var flowZoom = 0.85;              // 谱面缩放（默认不铺满）
      // 横版（16:9）页面在加载 core 之前设 window.KB_HORIZ = true：
      // 谱面排成一条横向滚动的带子，镜头按 scrollLeft 跟随；竖版完全不受影响。
      var HORIZ = !!window.KB_HORIZ;
      var hFitPass = 0;                 // 横版按列高校正宽度的次数（最多 3 次）
      var hHead = 86;                   // 横版：每列「谱表顶」上方统一留多少（px，按行里最高的音/装饰取）
      var hBandPct = (function () {     // 横版：谱面区占可视高度的比例（侧栏「谱面」的数值）
        var v = parseFloat(window.KB_H_BAND);
        return (isFinite(v) && v >= 0.5 && v <= 0.98) ? v : 0.92;
      })();
      var blocks = [];                  // 每个五线谱块
      var svgFlat = [];                 // 全局音符顺序
      var flowReady = false;
      var sysNow = -1;
      var svgReady = false, svgPages = [], svgSystems = [];
      var pendingPages = [];            // [{svg, vbW, vbH, x0, x1, inkW, systems, decors}]

      function wrapEl() { return document.getElementById('svgWrap'); }
      function hostEl() { return document.getElementById('svgHost'); }
      function cursorEl() { return document.getElementById('svgCursor'); }
      function cursorJpEl() { return document.getElementById('jpCursor'); }

      function matrixXY(el) {
        var tr = el.getAttribute('transform');
        if (!tr) return null;
        var m = /matrix\(\s*([^)]+)\)/.exec(tr);
        if (!m) return null;
        var v = m[1].split(',');
        if (v.length !== 6) return null;
        return { x: parseFloat(v[4]), y: parseFloat(v[5]) };
      }

      function pathYRange(d) {
        if (!d) return null;
        var nums = d.match(/-?\d+(?:\.\d+)?/g);
        if (!nums || nums.length < 4) return null;
        var minY = Infinity, maxY = -Infinity;
        for (var i = 0; i + 1 < nums.length; i += 2) {
          var y = parseFloat(nums[i + 1]);
          if (isNaN(y)) continue;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
        if (!isFinite(minY)) return null;
        return { minY: minY, maxY: maxY, mid: (minY + maxY) / 2 };
      }

      function parseSvgDoc(text) {
        var doc;
        try { doc = new DOMParser().parseFromString(text, 'image/svg+xml'); } catch (e) { return null; }
        var svg = doc && doc.documentElement;
        if (!svg || svg.tagName === 'parsererror') return null;

        var vb = svg.getAttribute('viewBox');
        if (!vb) return null;
        var p = vb.split(/[\s,]+/).map(Number);
        if (p.length < 4) return null;
        var vbW = p[2], vbH = p[3];

        var ys = [], ls = svg.querySelectorAll('.StaffLines'), i;
        var x0 = Infinity, x1 = -Infinity;
        for (i = 0; i < ls.length; i++) {
          var pts = ls[i].getAttribute('points') || '';
          var nums = pts.match(/-?\d+(?:\.\d+)?/g) || [];
          if (nums.length >= 2) {
            var ya = parseFloat(nums[1]);
            if (!isNaN(ya)) ys.push(ya);
          }
          for (var q2 = 0; q2 + 1 < nums.length; q2 += 2) {
            var xa = parseFloat(nums[q2]);
            if (isNaN(xa)) continue;
            if (xa < x0) x0 = xa;
            if (xa > x1) x1 = xa;
          }
        }
        if (!isFinite(x0) || !isFinite(x1) || x1 <= x0) { x0 = 0; x1 = vbW; }
        ys.sort(function (a, b) { return a - b; });

        var groups = [], cur = null;
        for (i = 0; i < ys.length; i++) {
          if (!cur || ys[i] - cur[cur.length - 1] > 40) { cur = [ys[i]]; groups.push(cur); }
          else cur.push(ys[i]);
        }
        var staves = [];
        for (i = 0; i < groups.length; i++) {
          if (groups[i].length >= 3) staves.push({ top: groups[i][0], bottom: groups[i][groups[i].length - 1] });
        }
        var systems = [];
        for (i = 0; i + 1 < staves.length; i += 2) {
          systems.push({ top: staves[i].top - 130, bottom: staves[i + 1].bottom + 130 });
        }
        if (!systems.length && staves.length) {
          systems.push({ top: staves[0].top - 130, bottom: staves[0].bottom + 130 });
        }

        // 谱表之外的图形（小节号会被抬高、连音线弧顶等）
        var decors = [];
        var dsel = svg.querySelectorAll(
          '.MeasureNumber, .SlurSegment, .Tuplet, .Dynamic, .Tempo, .Harmony,' +
          '.Fingering, .RehearsalMark, .StaffText, .SystemText, .Marker, .Articulation');
        for (i = 0; i < dsel.length; i++) {
          var dr = pathYRange(dsel[i].getAttribute('d'));
          if (dr) decors.push(dr);
        }

        return {
          svg: svg, vbW: vbW, vbH: vbH, x0: x0, x1: x1, inkW: (x1 - x0),
          systems: systems, decors: decors, text: text
        };
      }

      // ---------- 简谱字体 ----------
      // 简谱真正离不开的只有下面这几个「符号/数字」字体（加起来 ~400KB）：
      //   SparksNMN-EOPNumber 3KB 数字、SparksNMN-Bravura 328KB 小节线/符号、
      //   SparksNMN-mscore-20 20KB 升降号、Roman 51KB 调号等文字
      // 中文大字体（CommonLight / CommonSerif / CommonBlack）已移除：jp2 简谱的中文
      // 标题/文字一律走系统字体（body 的 Microsoft YaHei 等），不再加载 4~8MB 的 CJK 字体。
      var CORE_FAMS = ['Roman', 'RomanItalic', 'SparksNMN-EOPNumber',
        'SparksNMN-mscore-20', 'SparksNMN-Bravura'];
      var TEXT_FAMS = [];
      var FAMS = TEXT_FAMS.concat(CORE_FAMS);
      var fontsReady = false, fontsInjected = false;

      function fmtFor(u) {
        if (/\.woff2$/i.test(u)) return ' format("woff2")';
        if (/\.woff$/i.test(u)) return ' format("woff")';
        if (/\.ttf$/i.test(u)) return ' format("truetype")';
        if (/\.otf$/i.test(u)) return ' format("opentype")';
        return '';
      }

      // 字体来源，优先级：
      //   1) window.fontRootList = [ 'https://…/font/', … ]  多源兜底，按顺序尝试（推荐）
      //   2) window.fontLocalRoot（+ 可选的 window.fontCdnRoot）  单个源
      // 每个源后面的路径都是 fontLoadData 里的 url（如 roman/roman.woff2），
      // 所以以 "/" 结尾的目录最省心；没写结尾的会自动补上。
      function fontRoots() {
        var roots = [];
        var list = window.fontRootList;
        if (list && list.length) {
          for (var i = 0; i < list.length; i++) {
            var r = String(list[i] || '').trim();
            if (!r) continue;
            if (!/\/$/.test(r)) r += '/';
            roots.push(r);
          }
          if (roots.length) return roots;
        }
        var local = window.fontLocalRoot || 'assets/fonts/';
        if (!/\/$/.test(local)) local += '/';
        roots.push(local);
        var cdn = String(window.fontCdnRoot || '').trim();
        if (cdn) {
          if (!/\/$/.test(cdn)) cdn += '/';
          roots.push(cdn);
        }
        return roots;
      }

      function injectFonts() {
        if (fontsInjected) return;
        fontsInjected = true;
        var list = window.fontLoadData || [];
        if (!list.length) return;
        var skipText = (window.KB_JP_TEXT_FONTS === false);   // 关掉中文大字体（4~8MB/个）
        var roots = fontRoots();
        var css = [];
        var skipped = 0;
        for (var i = 0; i < list.length; i++) {
          var f = list[i];
          if (skipText && TEXT_FAMS.indexOf(f.name) >= 0) { skipped++; continue; }
          var parts = [];
          for (var r = 0; r < roots.length; r++) {
            parts.push('url("' + roots[r] + f.url + '")' + fmtFor(f.url));
          }
          css.push('@font-face{font-family:"' + f.name + '";src:' + parts.join(',') +
            ';font-weight:' + (f.weight || 'normal') + ';font-display:swap;}');
        }
        var st = document.createElement('style');
        st.id = 'jpFontCss';
        st.textContent = css.join('\n');
        document.head.appendChild(st);
        if (skipped) {
          try {
            console.log('[字体] KB_JP_TEXT_FONTS=false：跳过 ' + skipped +
              ' 个中文字体，简谱里的中文用系统字体显示');
          } catch (e) { }
        }
      }

      // 字体是否真的用上了：canvas 里比较「带这个字体」和「纯 fallback」的文本宽度。
      // （document.fonts.check() 在字体族名/字重对不上时会误报 false，这里不用它。）
      function fontUsable(name) {
        try {
          var cv = document.createElement('canvas').getContext('2d');
          if (!cv) return true;
          var t = '0123456789';
          cv.font = '40px monospace';
          var w0 = cv.measureText(t).width;
          cv.font = '40px "' + name + '", monospace';
          var w1 = cv.measureText(t).width;
          return Math.abs(w0 - w1) > 0.5;
        } catch (e) { return true; }
      }

      // 只等「核心符号字体」（~400KB）就放行渲染；中文字体（4~8MB/个）不阻塞首屏，
      // 等它到位浏览器会自动换字形（位置都是按 em 算的，不会因为换字体而重排）。
      function waitFonts(cb) {
        injectFonts();
        var done = false;
        var fin = function () {
          if (done) return;
          done = true;
          fontsReady = true;
          try {
            if (!fontUsable('SparksNMN-EOPNumber')) {
              console.warn('[字体] 简谱字体没加载上（可能是字体源不可达 / 被拦截）。' +
                '当前字体源：' + fontRoots().join('  |  '));
            }
          } catch (e) { }
          cb();
        };
        var jobs = [];
        try {
          if (document.fonts && document.fonts.load) {
            for (var i = 0; i < CORE_FAMS.length; i++) {
              jobs.push(document.fonts.load('16px "' + CORE_FAMS[i] + '"'));
            }
          }
        } catch (e) { }
        if (!jobs.length) { fin(); return; }
        Promise.all(jobs).then(fin).catch(fin);
        setTimeout(fin, 3000);
      }

      // ---------- 简谱分节 ----------
      function buildJpSections(width) {
        var data = window.efData || [];
        if (!data.length) return [];
        var BASE = 100;
        var probe = document.createElement('div');
        probe.style.cssText = 'position:absolute;left:-99999px;top:0;visibility:hidden;';
        document.body.appendChild(probe);

        var probes = [], i, k;
        for (i = 0; i < data.length; i++) {
          var d = document.createElement('div');
          d.style.cssText = 'position:relative;width:1px;font-size:' + BASE + 'px;';
          d.innerHTML = data[i].element;
          probe.appendChild(d);
          probes.push(d);
        }

        var maxW = 0;
        for (i = 0; i < data.length; i++) {
          if (!/^musicLine--/.test(String(data[i].label || ''))) continue;
          var pr = probes[i].getBoundingClientRect();
          var all = probes[i].querySelectorAll('*');
          for (k = 0; k < all.length; k++) {
            var kr = all[k].getBoundingClientRect();
            if (kr.width < 0.5 && kr.height < 0.5) continue;
            var right = kr.right - pr.left;
            if (right > maxW) maxW = right;
          }
        }
        probe.innerHTML = '';
        document.body.removeChild(probe);

        var U = (maxW > 10) ? (width * BASE / maxW) : (width / 64);
        U *= 0.985;

        var out = [];
        for (i = 0; i < data.length; i++) {
          var sec = data[i];
          var box = document.createElement('div');
          // line-height 必须和 sparks 导出的 .wcl-equifield-root 一样是 1.15：
          // efData 的 span 全是「top:0 + transform:translateY(Nem)」绝对定位，
          // 字形在自身行盒里居中，行高变了字形的落点就跟着变。之前继承了页面的 1.5，
          // 八度点（字号只有数字的一半）比数字多下移 0.087em，就压到下面的音上、
          // 几个点糊在一起。改成 1.15 后和参考页（sparks 导出的 -简谱.html）逐点对齐。
          box.style.cssText = 'position:relative;overflow:hidden;margin:0 auto;line-height:1.15;' +
            'width:' + width + 'px;font-size:' + U + 'px;' +
            'height:' + Math.max(1, Math.round((sec.height || 0) * U)) + 'px;';
          box.innerHTML = sec.element;
          out.push({ sec: sec, el: box });
        }
        try { console.log('[简谱] 内容宽 ' + maxW.toFixed(1) + 'px → 字号 ' + U.toFixed(2) + 'px'); } catch (e) { }
        return out;
      }

      // ---------- 构建对照流 ----------
      var portraitMode = false;
      var lastGroupW = 0;
      var hFitTimers = [];
      // 横版：量「当前 DOM 里所有列」的最高值（blocks[] 里可能还有上一轮留下的旧列）
      function hColMax() {
        var host = hostEl();
        if (!host) return 0;
        var list = host.querySelectorAll('.flowCol');
        var h = 0;
        for (var i = 0; i < list.length; i++) {
          var x = list[i].offsetHeight || 0;
          if (x > h) h = x;
        }
        return h;
      }
      // 横版：简谱/字体是排完以后才量得准的，buildFlow 里那次校正可能量早了。
      // 排完 350ms / 1400ms / 2600ms 各再量一次，仍偏差就再校正（受 hFitPass 上限约束）。
      function scheduleHFit(delay) {
        if (!HORIZ) return;
        var wait = delay || 350;
        hFitTimers.push(setTimeout(function () {
          try {
            if (!HORIZ || !blocks.length || hFitPass >= 3) return;
            var wrap = wrapEl();
            if (!wrap) return;
            var hView = wrap.clientHeight || 0;
            if (hView < 80) return;
            var colH = hColMax();
            var budgetH = Math.max(120, Math.round((hView - 8) * hBandPct));
            if (colH > 0 && lastGroupW > 0 &&
              Math.abs(colH - budgetH) > Math.max(8, budgetH * 0.02)) {
              hFitPass++;
              console.log('[横版·延迟校正] 列高 ' + colH + ' / 预算 ' + budgetH +
                '，组宽 ' + lastGroupW);
              buildFlow(Math.max(200, Math.round(lastGroupW * budgetH / colH)));
            }
          } catch (eSHF) { }
        }, wait));
      }
      var boardAspect = 0;      // 键盘自身的高宽比（首次记录）

      function rebuildKeys(tries) {
        var keys = document.getElementById('keys');
        if (!keys) return;
        if (keys.clientWidth > 0) {
          try { buildKeyboard(); } catch (e) { }
          return;
        }
        if ((tries || 0) < 10) {
          requestAnimationFrame(function () { rebuildKeys((tries || 0) + 1); });
        }
      }

      // 键盘整体上移：默认「2 个键盘高」。三种来源，优先级从小到大：
      //   1) 引擎兜底 2（键盘高度的倍数）
      //   2) 页面里写的默认值 window.KB_BOARD_LIFT（倍数）/ window.KB_BOARD_LIFT_PX（像素）
      //      —— 写了它就不读 localStorage，每次打开都是文件里的值
      //   3) 运行时用「键盘」输入框 / 键盘 ↑↓ 调的（只影响本次打开，不写 localStorage）
      // 没写页面默认值时，运行时调整才按页面记住（localStorage key: kb-lift:<页面名>）。
      var boardLiftPx = null;          // 运行时调过的绝对值；null = 用默认值

      function liftStoreKey() { return 'kb-lift:' + headPageName(); }

      function fileLift(v) {
        var px = parseFloat(window.KB_BOARD_LIFT_PX);
        if (isFinite(px) && px >= 0) return Math.min(px, Math.max(120, v * 8));
        var pct = parseFloat(window.KB_BOARD_LIFT);
        if (isFinite(pct) && pct >= 0) return Math.max(0, Math.min(4, pct)) * v;
        return null;
      }

      function hasFileLift() {
        var px = parseFloat(window.KB_BOARD_LIFT_PX);
        if (isFinite(px) && px >= 0) return true;
        var pct = parseFloat(window.KB_BOARD_LIFT);
        return isFinite(pct) && pct >= 0;
      }

      function loadBoardLift() {
        boardLiftPx = null;
        if (hasFileLift()) return;      // 文件里定死了默认值，就不读上次存的
        try {
          var v = parseFloat(localStorage.getItem(liftStoreKey()));
          boardLiftPx = isFinite(v) ? Math.max(0, v) : null;
        } catch (e) { boardLiftPx = null; }
      }

      // 录制页收到的「键盘上移」是跟舞台宽成比例的值（编辑页 540、录制页 1080，px 不能直接搬），
      // 存成比例，每次同步时按当前舞台宽算 px —— 这样舞台变宽（进 rec-mode）后也不会停在旧 px 上。
      var boardLiftRatio = null;

      // 横版的「键盘高低 / 琴键高」按舞台高的比例记，数值对外显示成当前舞台下的 px，
      // 这样 0 就是贴底，窗口缩放后比例不变。
      var hLiftRatio = null, hKeyRatio = null;
      function hStageH() {
        var st = document.querySelector('.stage');
        return st ? (st.clientHeight || 0) : 0;
      }
      function hLiftPx() {
        var H = hStageH();
        return (hLiftRatio != null && H > 0) ? Math.round(hLiftRatio * H) : 0;
      }
      function hKeyPx() {
        var H = hStageH();
        if (!(H > 0)) return 0;
        if (hKeyRatio != null) return Math.round(hKeyRatio * H);
        // 默认键高 = 舞台高的 20%；页面可用 window.KB_H_KEY_RATIO 改（0.06 ~ 0.45）
        var v = parseFloat(window.KB_H_KEY_RATIO);
        return Math.round(H * ((isFinite(v) && v >= 0.06 && v <= 0.45) ? v : 0.20));
      }
      function setHLift(px) {
        var H = hStageH();
        if (!(H > 0)) return;
        var v = parseFloat(px);
        hLiftRatio = isFinite(v) ? Math.max(0, Math.min(0.45, v / H)) : 0;
        var bd = document.getElementById('board');
        if (bd) bd.style.marginBottom = Math.round(hLiftRatio * H) + 'px';
        try { syncBoardLift(); } catch (e) { }
        hRelayout();
      }
      function setHKey(px) {
        var H = hStageH();
        if (!(H > 0)) return;
        var v = parseFloat(px);
        hKeyRatio = isFinite(v) ? Math.max(0.06, Math.min(0.45, v / H)) : 0.20;
        applyHKeyHeight();
        hRelayout();
      }
      function applyHKeyHeight() {
        var st = document.querySelector('.stage');
        if (!st || !HORIZ) return;
        st.style.setProperty('--kb-key-h', hKeyPx() + 'px');
        try { syncBoardLift(); } catch (e) { }
        if (typeof window.refreshStepInputs === 'function') {
          try { window.refreshStepInputs(); } catch (eR) { }
        }
      }
      // 谱面区 / 键盘高度变了，整条谱要重排（防抖，避免连续输入时反复排）
      var hRelayoutTimer = null;
      function hRelayout() {
        if (!HORIZ) return;
        if (hRelayoutTimer) clearTimeout(hRelayoutTimer);
        hRelayoutTimer = setTimeout(function () {
          hRelayoutTimer = null;
          try { buildFlow(); } catch (e) { }
        }, 40);
      }

      function liftTarget(h) {
        if (HORIZ) return hLiftPx();                    // 横版：0 = 键盘贴舞台底
        if (boardLiftRatio !== null) {
          var stW = (document.querySelector('.stage') || {}).clientWidth || 0;
          if (stW > 0) return boardLiftRatio * stW;
        }
        if (boardLiftPx !== null) return boardLiftPx;   // 本次打开时调过的
        var fl = fileLift(h);                            // 页面文件里的默认值
        if (fl !== null) return fl;
        return h * 2;                                    // 引擎兜底：2 个键盘高
      }

      function setBoardLiftRatio(r) {
        var v = parseFloat(r);
        boardLiftRatio = isFinite(v) ? Math.max(0, Math.min(1.2, v)) : null;
        boardLiftPx = null;
        syncBoardLift();
      }

      function syncBoardLift() {
        var st = document.querySelector('.stage');
        var bd = document.getElementById('board');
        if (!st || !bd) return;
        var h = bd.getBoundingClientRect().height || 0;
        if (HORIZ) {
          // 横版：键盘在舞台底部，--kb-lift 换成 margin-bottom（0 = 贴底）
          bd.style.marginBottom = Math.round(hLiftPx()) + 'px';
        }
        st.style.setProperty('--kb-lift', liftTarget(h).toFixed(1) + 'px');
        if (typeof window.refreshStepInputs === 'function') {
          try { window.refreshStepInputs(); } catch (eR) { }
        }
      }

      // 键盘 ↑ / ↓：调过之后按页面存绝对值（除非文件里写了默认值）
      function nudgeBoardLift(delta) {
        var st = document.querySelector('.stage');
        var bd = document.getElementById('board');
        if (!st || !bd) return;
        var h = bd.getBoundingClientRect().height || 0;
        var max = Math.max(120, (st.getBoundingClientRect().height || 800) * 0.6);
        var next = Math.min(max, Math.max(0, liftTarget(h) + delta));
        boardLiftPx = next;
        if (!hasFileLift()) {
          try { localStorage.setItem(liftStoreKey(), String(Math.round(next))); } catch (e) { }
        }
        syncBoardLift();
        try { console.log('[键盘] 上移 ' + Math.round(next) + 'px'); } catch (e2) { }
      }

      function setBoardLift(px) {
        var v = parseFloat(px);
        boardLiftPx = isFinite(v) ? Math.max(0, v) : 0;
        if (!hasFileLift()) {
          try { localStorage.setItem(liftStoreKey(), String(Math.round(boardLiftPx))); } catch (e) { }
        }
        syncBoardLift();
      }

      (function wireKbButtons() {
        var up = document.getElementById('kbUp');
        var down = document.getElementById('kbDown');
        // 一格 12px；按住 Shift 点 = 微调 4px
        function step(ev) { return (ev && ev.shiftKey) ? 4 : 12; }
        if (up && up.addEventListener) up.addEventListener('click', function (ev) { nudgeBoardLift(-step(ev)); });
        if (down && down.addEventListener) down.addEventListener('click', function (ev) { nudgeBoardLift(step(ev)); });
      })();
      loadBoardLift();

      // 页面里写的默认谱面缩放（window.KB_FLOW_ZOOM），启动就生效；
      // 之后用输入框/按钮调整仍然可以在运行时改
      (function applyPageZoom() {
        var z = parseFloat(window.KB_FLOW_ZOOM);
        if (isFinite(z) && z > 0) flowZoom = Math.max(0.25, Math.min(1.4, z));
      })();

      // 竖屏：键盘宽度对齐谱面组宽，高度按原比例缩放
      // 竖屏下不对键盘做宽度/高度缩放：
      // 白键黑键都是按容器宽度算绝对坐标，容器一变窄而键位没来得及重算，
      // 就会全部跑到可视区外（表现为整块黑）。这里只保证样式干净。
      function applyPortraitWidth() {
        var board = document.getElementById('board');
        if (!board) return;
        board.style.maxWidth = '';
        board.style.margin = '';
        board.style.height = '';
        board.style.minHeight = '';
      }

      // ================= jp2：MusicXML + SVG 驱动的简谱渲染器 =================
      // 不再依赖 efData.js。直接解析 MusicXML 的音高/时值/装饰音/连音/多连音，
      // 用 SVG 符头的横向坐标给每个简谱数字定位，做到「数字位置对应五线谱音符位置」。
      // 所有线条/八度点/弧线都用 div{background+clip-path+box-shadow} 画，
      // 数字/标签用文本 span —— 与 shootJianpu 的位图光栅化契约完全兼容。
      var jp2Rich = null;        // 富解析结果 {notes,rests,measures,fifths,beats,beatType}
      var jp2SourceText = '';    // 原始 MusicXML 文本（导出 song.data.js 给播放器重建简谱用）
      var jp2Reg = {};           // si -> {bi, col}，跨行弧线用
      var JP2_NUM_FONT = "'SparksNMN-EOPNumber','Roman',serif";
      var JP2_SYM_FONT = "'Roman','Times New Roman',serif";

      function jp2KeyAlter(fifths) {
        var map = { C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0 };
        var sharpOrder = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
        var flatOrder = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];
        var i;
        if (fifths > 0) { for (i = 0; i < fifths && i < 7; i++) map[sharpOrder[i]] = 1; }
        else if (fifths < 0) { for (i = 0; i < -fifths && i < 7; i++) map[flatOrder[i]] = -1; }
        return map;
      }

      // 富解析：保留 voice/staff/type/dots/accidental/slur/tuplet/beam/tie/rest/chord/grace。
      // 时间轴逻辑与 parseMusicXML 完全一致（measure 用 0-based 下标 mi，便于和 score.notes 对键）。
      function parseJpXml(text) {
        var doc;
        try { doc = new DOMParser().parseFromString(text, 'text/xml'); } catch (e) { return null; }
        if (!doc || doc.getElementsByTagName('parsererror').length) return null;
        var root = doc.documentElement;
        if (!root) return null;
        var parts = root.getElementsByTagName('part');
        if (!parts.length) return null;
        var notes = [], rests = [], measures = [];
        var gFifths = 0, gBeats = 4, gBeatType = 4, order = 0;
        var STEP_ORDER = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
        for (var pi = 0; pi < parts.length; pi++) {
          var ms = parts[pi].getElementsByTagName('measure');
          var divisions = 1, t = 0;
          var fifths = gFifths, beats = gBeats, beatType = gBeatType;
          for (var mi = 0; mi < ms.length; mi++) {
            var m = ms[mi];
            var mnum = parseInt(m.getAttribute('number'), 10) || (mi + 1);
            var lastOnset = t;
            var attrs = m.getElementsByTagName('attributes')[0];
            if (attrs) {
              var dv = attrs.getElementsByTagName('divisions')[0];
              if (dv && parseFloat(dv.textContent)) divisions = parseFloat(dv.textContent);
              var kf = attrs.getElementsByTagName('fifths')[0];
              if (kf) fifths = parseInt(kf.textContent, 10) || 0;
              var tb = attrs.getElementsByTagName('beats')[0];
              if (tb) beats = parseInt(tb.textContent, 10) || beats;
              var tt = attrs.getElementsByTagName('beat-type')[0];
              if (tt) beatType = parseInt(tt.textContent, 10) || beatType;
            }
            if (pi === 0) {
              measures[mnum] = { fifths: fifths, beats: beats, beatType: beatType };
              if (mi === 0) { gFifths = fifths; gBeats = beats; gBeatType = beatType; }
            }
            var kids = m.childNodes;
            for (var ci = 0; ci < kids.length; ci++) {
              var node = kids[ci];
              if (node.nodeType !== 1) continue;
              var tag = node.tagName;
              if (tag === 'backup') { var bd = node.getElementsByTagName('duration')[0]; if (bd) t -= (parseFloat(bd.textContent) || 0) / divisions; continue; }
              if (tag === 'forward') { var fd = node.getElementsByTagName('duration')[0]; if (fd) t += (parseFloat(fd.textContent) || 0) / divisions; continue; }
              if (tag !== 'note') continue;
              var isChord = !!node.getElementsByTagName('chord')[0];
              var graceEl = node.getElementsByTagName('grace')[0];
              var isGrace = !!graceEl;
              var graceSlash = isGrace && graceEl.getAttribute('slash') === 'yes';
              var isRest = !!node.getElementsByTagName('rest')[0];
              var durEl = node.getElementsByTagName('duration')[0];
              var dur = durEl ? (parseFloat(durEl.textContent) || 0) / divisions : 0;
              var onset = isChord ? lastOnset : t;
              if (!isChord) lastOnset = t;
              var step = 'C', octave = 4, alter = 0;
              var pt = node.getElementsByTagName('pitch')[0];
              if (pt) {
                var st = pt.getElementsByTagName('step')[0]; if (st) step = st.textContent.trim();
                var oc = pt.getElementsByTagName('octave')[0]; if (oc) octave = parseInt(oc.textContent, 10) || 4;
                var al = pt.getElementsByTagName('alter')[0]; if (al) alter = parseFloat(al.textContent) || 0;
              }
              var midi = (octave + 1) * 12 + (STEP_SEMI[step] || 0) + alter;
              var voiceEl = node.getElementsByTagName('voice')[0];
              var voice = voiceEl ? voiceEl.textContent.trim() : '1';
              var staffEl = node.getElementsByTagName('staff')[0];
              var staff = staffEl ? parseInt(staffEl.textContent, 10) : 0;
              var typeEl = node.getElementsByTagName('type')[0];
              var type = typeEl ? typeEl.textContent.trim() : '';
              var dots = node.getElementsByTagName('dot').length;
              var accEl = node.getElementsByTagName('accidental')[0];
              var accidental = accEl ? accEl.textContent.trim() : '';
              var tieStart = false, tieStop = false;
              var tieEls = node.getElementsByTagName('tie');
              if (!tieEls.length) tieEls = node.getElementsByTagName('tied');
              for (var ti = 0; ti < tieEls.length; ti++) {
                var ty = tieEls[ti].getAttribute('type');
                if (ty === 'start') tieStart = true;
                if (ty === 'stop') tieStop = true;
              }
              var slurs = [], tuplets = [], beams = [];
              // 连音数（actual/normal）在 <time-modification>（note 的直接子元素），不在 <tuplet> 元素内。
              var tmEl = node.getElementsByTagName('time-modification')[0];
              var tmActual = 0, tmNormal = 0;
              if (tmEl) {
                var an0 = tmEl.getElementsByTagName('actual-notes')[0];
                var nn0 = tmEl.getElementsByTagName('normal-notes')[0];
                tmActual = an0 ? (parseInt(an0.textContent, 10) || 0) : 0;
                tmNormal = nn0 ? (parseInt(nn0.textContent, 10) || 0) : 0;
              }
              var nots = node.getElementsByTagName('notations')[0];
              if (nots) {
                var sl = nots.getElementsByTagName('slur');
                for (var sli = 0; sli < sl.length; sli++) slurs.push({ number: sl[sli].getAttribute('number') || '1', type: sl[sli].getAttribute('type') || '' });
                var tu = nots.getElementsByTagName('tuplet');
                for (var tui = 0; tui < tu.length; tui++) {
                  var an = tu[tui].getElementsByTagName('actual-notes')[0];
                  var nn = tu[tui].getElementsByTagName('normal-notes')[0];
                  tuplets.push({ number: tu[tui].getAttribute('number') || '1', type: tu[tui].getAttribute('type') || '', actual: an ? (parseInt(an.textContent, 10) || tmActual) : tmActual, normal: nn ? (parseInt(nn.textContent, 10) || tmNormal) : tmNormal });
                }
              }
              var bm = node.getElementsByTagName('beam');
              for (var bmi = 0; bmi < bm.length; bmi++) beams.push({ number: parseInt(bm[bmi].getAttribute('number'), 10) || 1, value: bm[bmi].textContent.trim() });
              var rec = {
                part: pi, measure: mi, mnum: mnum, ts: onset, dur: dur, halfTone: midi,
                step: step, octave: octave, alter: alter, stepOrder: STEP_ORDER[step] || 0,
                voice: voice, staff: staff, type: type, dots: dots, accidental: accidental,
                grace: isGrace, graceSlash: graceSlash, chord: isChord, rest: isRest,
                tieStart: tieStart, tieStop: tieStop, slurs: slurs, tuplets: tuplets, beams: beams,
                docOrder: order++, si: -1, svgK: -1, col: null,
                // 渲染期填充
                degree: 1, oct: 0, accSign: '', under: 0, dashes: 0, augDots: 0,
                digitX: 0, topExt: 0, botExt: 0
              };
              if (isRest) rests.push(rec); else notes.push(rec);
              if (!isChord) t += dur;
            }
          }
        }
        if (!notes.length) return null;
        return { notes: notes, rests: rests, measures: measures, fifths: gFifths, beats: gBeats, beatType: gBeatType };
      }

      function jp2Prepare(xmlText) {
        jp2Rich = null; jp2Reg = {}; jp2SourceText = xmlText || '';
        if (!xmlText) return;
        try { jp2Rich = parseJpXml(xmlText); } catch (e) { jp2Rich = null; }
      }

      // 把富解析音符和 score.notes（播放/高亮用的权威序列）按多重键消费式配对，拿到 si。
      function jp2LinkSi() {
        if (!jp2Rich || !score || !score.notes) return;
        var map = {}, i;
        for (i = 0; i < score.notes.length; i++) {
          var n = score.notes[i];
          var key = n.part + '|' + n.measure + '|' + n.ts.toFixed(4) + '|' + n.halfTone + '|' + (n.grace ? 1 : 0);
          (map[key] = map[key] || []).push(i);
        }
        var used = {};
        for (i = 0; i < jp2Rich.notes.length; i++) {
          var r = jp2Rich.notes[i];
          var k = r.part + '|' + r.measure + '|' + r.ts.toFixed(4) + '|' + r.halfTone + '|' + (r.grace ? 1 : 0);
          var arr = map[k];
          if (arr) { for (var j = 0; j < arr.length; j++) { if (!used[arr[j]]) { r.si = arr[j]; used[arr[j]] = 1; break; } } }
        }
      }

      // 终止线（细+粗双线）会被当成两条小节线，间距很近的合并成一条。
      function jp2MergeBars(barXs, thr) {
        thr = thr || 30;
        var out = [];
        for (var i = 0; i < barXs.length; i++) {
          if (out.length && barXs[i] - out[out.length - 1] < thr) continue;
          out.push(barXs[i]);
        }
        return out;
      }

      // ---- DOM 小工具（全部内联样式，导出安全）----
      function jp2Div(parent, x, y, w, h, bg) {
        var d = document.createElement('div');
        d.style.cssText = 'position:absolute;left:' + x.toFixed(2) + 'px;top:' + y.toFixed(2) + 'px;width:' + Math.max(0.3, w).toFixed(2) + 'px;height:' + Math.max(0.3, h).toFixed(2) + 'px;background:' + (bg || '#000') + ';';
        parent.appendChild(d);
        return d;
      }
      // 色带：clip-path 多边形 + box-shadow 取色，shootJianpu 能光栅化。
      function jp2Band(parent, x, y, w, h, poly, color) {
        var d = jp2Div(parent, x, y, w, h, color || '#000');
        d.style.clipPath = 'polygon(' + poly + ')';
        d.style.boxShadow = '0 0 0 0 ' + (color || '#000');
        return d;
      }
      // 直线（小节线/增时线/减时线）：矩形色带，shootJianpu 能光栅化。
      function jp2Rule(parent, x, y, w, h, color) {
        return jp2Band(parent, x, y, w, h, '0 0,100% 0,100% 100%,0 100%', color || '#000');
      }
      function jp2Text(parent, x, y, w, h, text, fontPx, fam, color, align, weight) {
        var s = document.createElement('span');
        s.style.cssText = 'position:absolute;left:' + x.toFixed(2) + 'px;top:' + y.toFixed(2) + 'px;width:' + w.toFixed(2) + 'px;height:' + h.toFixed(2) + 'px;line-height:' + h.toFixed(2) + 'px;font-size:' + fontPx.toFixed(2) + 'px;font-family:' + (fam || JP2_NUM_FONT) + ';color:' + (color || '#000') + ';text-align:' + (align || 'center') + ';font-weight:' + (weight || '400') + ';white-space:nowrap;overflow:visible;';
        s.textContent = text;
        parent.appendChild(s);
        return s;
      }
      // 拍号分数式：分子（上）+ 横线（中）+ 分母（下），整体以 cy 为中心竖直居中（需求 m01986：分子分母间横线、间距合适）
      function jp2TimeSig(parent, left, cy, w, fs, beats, beatType) {
        var gap = 0.30 * fs;                       // 分子/分母与横线的间距（需求 m02038：加大间距）
        var barTh = Math.max(1, 0.07 * fs);        // 横线粗细
        jp2Text(parent, left, cy - gap - fs, w, fs, String(beats), fs, JP2_NUM_FONT, '#000', 'center');
        jp2Rule(parent, left, cy - barTh / 2, w, barTh, '#000');
        jp2Text(parent, left, cy + gap, w, fs, String(beatType), fs, JP2_NUM_FONT, '#000', 'center');
      }
      // 二次贝塞尔弧线 → 采样成带宽度的 clip-path 多边形。
      function jp2Arc(parent, x0, y0, x1, y1, apexY, th, color) {
        var cx = (x0 + x1) / 2, cy = 2 * apexY - (y0 + y1) / 2;
        var N = 16, up = [], dn = [], i, t, mt, bx, by;
        var minX = Math.min(x0, x1), maxX = Math.max(x0, x1);
        var minY = Math.min(y0, y1, apexY), maxY = Math.max(y0, y1, apexY);
        for (i = 0; i <= N; i++) {
          t = i / N; mt = 1 - t;
          bx = mt * mt * x0 + 2 * mt * t * cx + t * t * x1;
          by = mt * mt * y0 + 2 * mt * t * cy + t * t * y1;
          up.push([bx, by - th / 2]); dn.push([bx, by + th / 2]);
          if (bx < minX) minX = bx; if (bx > maxX) maxX = bx;
          if (by - th / 2 < minY) minY = by - th / 2; if (by + th / 2 > maxY) maxY = by + th / 2;
        }
        var w = Math.max(0.6, maxX - minX), h = Math.max(0.6, maxY - minY);
        var pts = up.concat(dn.reverse()), poly = [];
        for (i = 0; i < pts.length; i++) {
          poly.push(((pts[i][0] - minX) / w * 100).toFixed(2) + '% ' + ((pts[i][1] - minY) / h * 100).toFixed(2) + '%');
        }
        return jp2Band(parent, minX, minY, w, h, poly.join(','), color);
      }

      // 时值 → 减时线数 / 增时线数
      function jp2Duration(rec) {
        var t = rec.type;
        var under = 0, dashes = 0;
        if (t === 'whole') dashes = 3;
        else if (t === 'half') dashes = 1;
        else if (t === 'eighth') under = 1;
        else if (t === '16th') under = 2;
        else if (t === '32nd') under = 3;
        else if (t === '64th') under = 4;
        else if (t === 'breve') dashes = 7;
        else {
          // 没有 type 时按 dur 兜底
          var d = rec.dur;
          if (d >= 3.5) dashes = 3; else if (d >= 1.5) dashes = 1;
          else if (d >= 0.75) under = 0; else if (d >= 0.375) under = 1;
          else if (d >= 0.1875) under = 2; else under = 3;
        }
        rec.under = under; rec.dashes = dashes; rec.augDots = rec.dots || 0;
      }

      // 音高 → 简谱数字 / 八度点 / 临时记号
      function jp2Pitch(rec, fifths) {
        var tonicName = KEY_NAMES[(fifths + 7) % 15] || 'C';
        var tonicStep = tonicName.charAt(0);
        var tonicAlter = tonicName.length > 1 ? (tonicName.charAt(1) === '#' ? 1 : -1) : 0;
        var STEP_ORDER = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
        var tonicIdx = 4 * 7 + STEP_ORDER[tonicStep];
        var noteIdx = rec.octave * 7 + rec.stepOrder;
        var diff = noteIdx - tonicIdx;
        var oct = Math.floor(diff / 7);
        var degree = ((diff % 7) + 7) % 7 + 1;
        rec.degree = degree; rec.oct = oct;
        var keyAlter = jp2KeyAlter(fifths);
        var acc = rec.accidental;
        var sign = '';
        if (acc === 'natural') sign = '♮';
        else if (acc === 'sharp') sign = '♯';
        else if (acc === 'flat') sign = '♭';
        else if (acc === 'double-sharp') sign = '×';
        else if (acc === 'flat-flat') sign = '♭♭';
        else if (acc === 'natural-sharp') sign = '♮♯';
        else if (acc === 'natural-flat') sign = '♮♭';
        else {
          var d = rec.alter - (keyAlter[rec.step] || 0);
          if (d > 0) sign = d === 2 ? '×' : new Array(d + 1).join('♯');
          else if (d < 0) sign = new Array(-d + 1).join('♭');
        }
        rec.accSign = sign;
      }

      // 主入口：给每个五线谱块建一行简谱。在 buildFlow 的 noteFrom/noteTo 之后调用。
      function buildJp2Rows(groupW) {
        if (!jp2Rich || !score || !blocks || !blocks.length) return false;
        jp2LinkSi();
        jp2Reg = {};
        var HORIZ = !!window.KB_HORIZ;
        var padX = HORIZ ? 8 : 10;
        var F = Math.max(9, Math.min(30, groupW * 0.026));
        var sx = groupW / (blocks[0].vbW || groupW);
        var okCount = 0;
        // 第一遍：给每块分配小节、把 XML 音符/休止 zip 到 SVG 符头，建列。
        var M = 0, i;
        for (i = 0; i < jp2Rich.notes.length; i++) if (jp2Rich.notes[i].mnum > M) M = jp2Rich.notes[i].mnum;
        for (i = 0; i < jp2Rich.rests.length; i++) if (jp2Rich.rests[i].mnum > M) M = jp2Rich.rests[i].mnum;
        // 每块合并后的小节线数 → 小节数。
        // 双小节线（转调/变拍/反复/终止）的两条线间距可达 ~135，固定阈值 30 合并不掉 →
        // 小节数虚高、与 XML 小节数 M 不等 → 退化成按音数 DP 分配，会漏掉每行末尾小节（如第 4 小节）。
        // 这里从小到大试合并阈值，用「合并后总小节数 == M」校验，取首个吻合者（真实小节间距通常 >300，不会被误并）。
        var thrCandidates = [30, 80, 150, 220, 320];
        var blkBars = [], totalMeasures = 0, prevBB = null, prevTM = 0;
        for (var ti = 0; ti < thrCandidates.length; ti++) {
          var thr = thrCandidates[ti];
          var bb = [], tm = 0;
          for (i = 0; i < blocks.length; i++) {
            var mb = jp2MergeBars(blocks[i].barXs || [], thr);
            bb.push(mb);
            tm += Math.max(1, mb.length - 1);
          }
          if (tm === M) { blkBars = bb; totalMeasures = tm; break; }
          if (tm < M) { blkBars = prevBB || bb; totalMeasures = prevTM || tm; break; } // 阈值过大并掉了真实小节，回退上一档
          prevBB = bb; prevTM = tm; blkBars = bb; totalMeasures = tm;
        }
        var sequential = (totalMeasures === M);
        var mStart = 1;
        for (i = 0; i < blocks.length; i++) {
          var blk = blocks[i];
          var bars = blkBars[i];
          var nMeas = Math.max(1, bars.length - 1);
          var m0, m1;
          if (sequential) { m0 = mStart; m1 = mStart + nMeas - 1; mStart = m1 + 1; }
          else { m0 = (blk.mFrom || 0) + 1; m1 = blk.mTo || m0; }
          blk.jp2m0 = m0; blk.jp2m1 = m1;
          jp2MapBlock(blk, i, bars, m0, m1, sx, groupW);
        }
        // 第二遍：渲染每行（需要 jp2Reg 已建好，跨行弧线才能找到伙伴）。
        for (i = 0; i < blocks.length; i++) {
          var b2 = blocks[i];
          if (!b2.jp2cols || !b2.jp2cols.length) { continue; }
          jp2RenderRow(b2, i, groupW, F, sx, padX, HORIZ);
          okCount++;
        }
        // 用精确映射覆盖 svgScoreMap / svgToScore。
        var map = [], inv = [], si;
        for (si = 0; si < score.notes.length; si++) map[si] = -1;
        for (i = 0; i < jp2Rich.notes.length; i++) {
          var r = jp2Rich.notes[i];
          if (r.si >= 0 && r.svgK >= 0) { map[r.si] = r.svgK; if (inv[r.svgK] === undefined) inv[r.svgK] = r.si; }
        }
        var filled = 0;
        for (si = 0; si < map.length; si++) if (map[si] >= 0) filled++;
        if (filled > score.notes.length * 0.5) { svgScoreMap = map; svgToScore = inv; }
        return okCount > 0;
      }

      // 把一块的 XML 音符/休止按小节 zip 到 SVG 符头，并建简谱列。
      function jp2MapBlock(blk, bi, bars, m0, m1, sx, groupW) {
        var vbTop = blk.vbTop, sysH = blk.sysH;
        var cropLeft = blk.vbLeft;
        // SVG 符头（含 grace），中心 = x + 16.25*a
        var svgNotes = [];
        var noteEls = blk.svg.querySelectorAll('.Note');
        for (var i = 0; i < noteEls.length; i++) {
          var el = noteEls[i];
          var tr = el.getAttribute('transform') || '';
          var mm = /matrix\(([^)]+)\)/.exec(tr);
          var a = 1, X = 0, Y = 0;
          if (mm) { var p = mm[1].split(',').map(parseFloat); a = p[0]; X = p[4]; Y = p[5]; }
          else { var xy = matrixXY(el); X = xy.x; Y = xy.y; }
          if (Y < vbTop - 1 || Y > vbTop + sysH + 1) continue;
          svgNotes.push({ el: el, x: X, y: Y, a: a, cx: X + 16.25 * a, grace: a < 0.8 });
        }
        svgNotes.sort(function (p, q) { return Math.abs(p.x - q.x) > 3 ? p.x - q.x : q.y - p.y; });
        // SVG 休止
        var svgRests = [];
        var restEls = blk.svg.querySelectorAll('.Rest');
        for (i = 0; i < restEls.length; i++) {
          var rel = restEls[i];
          var rxy = matrixXY(rel);
          if (rxy.y < vbTop - 1 || rxy.y > vbTop + sysH + 1) continue;
          svgRests.push({ el: rel, x: rxy.x, y: rxy.y, cx: rxy.x + 10 });
        }
        svgRests.sort(function (p, q) { return p.x - q.x; });
        // 按小节分箱
        function binOf(cx) {
          var jj = 0;
          for (var q = 1; q < bars.length; q++) { if (cx >= bars[q] - 1) jj = q; }
          return Math.min(jj, Math.max(0, bars.length - 2));
        }
        var noteBins = [], restBins = [], b;
        for (b = 0; b < Math.max(1, bars.length - 1); b++) { noteBins.push([]); restBins.push([]); }
        for (i = 0; i < svgNotes.length; i++) { var nb = binOf(svgNotes[i].cx); if (noteBins[nb]) noteBins[nb].push(svgNotes[i]); }
        for (i = 0; i < svgRests.length; i++) { var rb = binOf(svgRests[i].cx); if (restBins[rb]) restBins[rb].push(svgRests[i]); }
        // 本块的 XML 音符/休止（按 mnum 过滤）
        var xmlNotes = [], xmlRests = [];
        for (i = 0; i < jp2Rich.notes.length; i++) { var rn = jp2Rich.notes[i]; if (rn.mnum >= m0 && rn.mnum <= m1) xmlNotes.push(rn); }
        for (i = 0; i < jp2Rich.rests.length; i++) { var rr = jp2Rich.rests[i]; if (rr.mnum >= m0 && rr.mnum <= m1) xmlRests.push(rr); }
        // 小节内排序：ts, grace 优先, 音高升序, part 降序, docOrder
        function noteCmp(p, q) {
          if (p.ts !== q.ts) return p.ts - q.ts;
          if (p.grace !== q.grace) return p.grace ? -1 : 1;
          if (p.halfTone !== q.halfTone) return p.halfTone - q.halfTone;
          if (p.part !== q.part) return q.part - p.part;
          return p.docOrder - q.docOrder;
        }
        var cols = [];
        var measCount = Math.max(1, bars.length - 1);
        for (b = 0; b < measCount; b++) {
          var mnum = m0 + b;
          var xn = xmlNotes.filter(function (r) { return r.mnum === mnum; }).sort(noteCmp);
          var sn = noteBins[b] || [];
          // 装饰音与正常音分别配对：SVG 里装饰符头刻在节拍左侧（x 最小），
          // 而 XML 排序后装饰音未必排在最前（如低音和弦先于高音装饰音），
          // 直接按序号 zip 会把装饰音错配到正常符头、低音错配到装饰符头，
          // 导致简谱装饰音列与主音列重叠。按 grace 标志拆成两组各自 zip 即可对齐。
          var xnG = [], xnR = [], snG = [], snR = [];
          for (i = 0; i < xn.length; i++) (xn[i].grace ? xnG : xnR).push(xn[i]);
          for (i = 0; i < sn.length; i++) (sn[i].grace ? snG : snR).push(sn[i]);
          function zipPair(xa, sa) {
            var c = Math.min(xa.length, sa.length), j;
            for (j = 0; j < c; j++) {
              xa[j].svgK = svgFlatIndexOf(blk, sa[j].el);
              xa[j].svgCx = sa[j].cx;
              xa[j].svgGrace = sa[j].grace;
            }
            // 若 XML 比 SVG 多（罕见），多出的用比例兜底定位
            for (j = c; j < xa.length; j++) {
              var frac = xa.length > 1 ? j / (xa.length - 1) : 0.5;
              var bx0 = bars[b] || cropLeft, bx1 = bars[b + 1] || (cropLeft + blk.vbW);
              xa[j].svgCx = bx0 + (bx1 - bx0) * (0.15 + 0.7 * frac);
              xa[j].svgK = -1;
            }
          }
          zipPair(xnG, snG);
          zipPair(xnR, snR);
          var xr = xmlRests.filter(function (r) { return r.mnum === mnum; }).sort(function (p, q) { return p.ts - q.ts || p.docOrder - q.docOrder; });
          var sr = restBins[b] || [];
          for (i = 0; i < xr.length; i++) {
            if (i < sr.length) { xr[i].svgCx = sr[i].cx; xr[i].svgK = -1; }
            else { var bx0r = bars[b] || cropLeft, bx1r = bars[b + 1] || (cropLeft + blk.vbW); xr[i].svgCx = (bx0r + bx1r) / 2; }
          }
        }
        // 每声部各建一组列（简谱一行一个声部）：非 grace 按 ts 合并和弦列；grace/休止独立列。
        function buildColsFor(recs) {
          var byTs = {}, out = [];
          for (var ii = 0; ii < recs.length; ii++) {
            var rec = recs[ii];
            var px = (rec.svgCx - cropLeft) * sx;
            rec.px = px;
            if (rec.rest) out.push({ members: [rec], x: px, grace: false, rest: true, ts: rec.ts });
            else if (rec.grace) {
              // 同一拍的装饰音归为一列（纵向叠置），避免多个装饰音 x 相近时横向重叠（需求 m02686 第2点）
              var gkey = 'g' + rec.ts.toFixed(4);
              if (!byTs[gkey]) { byTs[gkey] = { members: [], x: 0, grace: true, rest: false, ts: rec.ts }; out.push(byTs[gkey]); }
              byTs[gkey].members.push(rec);
            }
            else {
              var key = rec.ts.toFixed(4);
              if (!byTs[key]) { byTs[key] = { members: [], x: 0, grace: false, rest: false, ts: rec.ts }; out.push(byTs[key]); }
              byTs[key].members.push(rec);
            }
          }
          for (var ii2 = 0; ii2 < out.length; ii2++) {
            var c = out[ii2];
            if (c.members.length > 1 && !c.rest) c.members.sort(function (p, q) { return p.halfTone - q.halfTone || p.part - q.part; });
            var sum = 0; for (var jj = 0; jj < c.members.length; jj++) sum += c.members[jj].px;
            c.x = sum / c.members.length;
          }
          out.sort(function (p, q) { return p.x - q.x; });
          return out;
        }
        var all = xmlNotes.concat(xmlRests);
        // 全局声部列表（与 SVG 谱表自上而下一致：P1 高音在上，P2 低音在下）
        var partSet = {};
        for (i = 0; i < jp2Rich.notes.length; i++) partSet[jp2Rich.notes[i].part] = 1;
        for (i = 0; i < jp2Rich.rests.length; i++) partSet[jp2Rich.rests[i].part] = 1;
        var parts = Object.keys(partSet).map(Number).sort(function (a, b) { return a - b; });
        if (!parts.length) parts = [0];
        var partCols = {};
        for (var pi = 0; pi < parts.length; pi++) {
          var pp = parts[pi];
          partCols[pp] = buildColsFor(all.filter(function (r) { return r.part === pp; }));
        }
        blk.jp2parts = parts;
        blk.jp2partCols = partCols;
        blk.jp2bars = bars;
        blk.jp2sx = sx;
        blk.jp2cropLeft = cropLeft;
        // 扁平 cols（兼容 arcs / 统计）
        var cols = [];
        for (pi = 0; pi < parts.length; pi++) cols = cols.concat(partCols[parts[pi]]);
        blk.jp2cols = cols;
        // 注册 si → 列（跨行弧线用）
        for (i = 0; i < cols.length; i++) {
          var cc = cols[i];
          cc.bi = bi;
          for (var mj = 0; mj < cc.members.length; mj++) {
            var mr = cc.members[mj];
            mr.col = cc;
            if (mr.si >= 0) jp2Reg[mr.si] = { bi: bi, col: cc };
          }
        }
        // 更新 scoreFrom/scoreTo/mFrom/mTo 与既有约定一致
        var sFrom = -1, sTo = -1;
        for (i = 0; i < score.notes.length; i++) {
          var mn = score.notes[i].measure + 1; // score.notes.measure 是 0-based
          if (mn >= m0 && mn <= m1) { if (sFrom < 0) sFrom = i; sTo = i + 1; }
        }
        if (sFrom >= 0) { blk.scoreFrom = sFrom; blk.scoreTo = sTo; blk.mFrom = m0 - 1; blk.mTo = m1; }
      }

      function svgFlatIndexOf(blk, el) {
        for (var i = 0; i < svgFlat.length; i++) {
          if (svgFlat[i].blk === blocks.indexOf(blk) && svgFlat[i].el === el) return i;
        }
        // 兜底：按元素引用全局找
        for (i = 0; i < svgFlat.length; i++) if (svgFlat[i].el === el) return i;
        return -1;
      }

      // 渲染一行简谱。
      function jp2RenderRow(blk, bi, groupW, F, sx, padX, HORIZ) {
        var bars = blk.jp2bars;
        var cropLeft = blk.jp2cropLeft;
        var parts = blk.jp2parts || [0];
        var partCols = blk.jp2partCols || { 0: blk.jp2cols || [] };
        var graceScale = 0.62;
        // 容器：shootJianpu 取 .flowJp 第一个 div 作为 inner，须包含所有声部子行。
        // margin:0 auto 与 .flowSys svg 的居中方式一致 → 简谱 x 原点严格对齐五线谱 SVG。
        var container = document.createElement('div');
        container.setAttribute('data-jp2', '1');
        container.style.cssText = 'position:relative;width:' + groupW.toFixed(2) + 'px;margin:0 auto;overflow:visible;';
        var bySi = {}, anchors = [], allCols = [], rows = [];
        var yOffset = 0;

        // 渲染单个声部子行，返回 {root, bySi, anchors, h, cols}
        function renderPart(cols, part, showKey, yOff) {
          var i, j, c, r;
          var pF = F;
          // 音高/时值
          for (i = 0; i < cols.length; i++) {
            c = cols[i];
            for (j = 0; j < c.members.length; j++) {
              r = c.members[j];
              var fifths = (jp2Rich.measures[r.mnum] && jp2Rich.measures[r.mnum].fifths) || jp2Rich.fifths;
              if (!r.rest) jp2Pitch(r, fifths);
              jp2Duration(r);
            }
          }
          // 精确 x 对齐：每列中心严格 = 对应 SVG 音符 x，不做碰撞松弛（用户要求音符 x 对齐五线谱）。
          // 自适应字号只缩小数字宽度，列中心 c.x 不变 → 对齐始终保持。
          var dotStep, dotR, underGap, lineTh, digitW, chordGap, minGap;
          function layoutFor(fF) {
            dotStep = 0.30 * fF; dotR = 0.10 * fF;
            underGap = 0.24 * fF; lineTh = Math.max(1, 0.07 * fF);
            digitW = 0.58 * fF; chordGap = 0.05 * fF; minGap = 0.12 * fF;
            for (i = 0; i < cols.length; i++) {
              c = cols[i];
              var n = c.members.length;
              var scale = c.grace ? graceScale : 1;
              var dw = digitW * scale;
              var base = (c.grace && n > 1) ? (n * (dw + chordGap) - chordGap) : dw; // 装饰音并排横排（m02816）；柱式和弦纵向叠置列宽=单数字宽
              var maxExt = base;
              for (j = 0; j < n; j++) {
                r = c.members[j];
                var ext = base + 0.12 * fF + r.augDots * 0.28 * fF; // 增时线“-”已去除；附点间距加大更清晰
                if (ext > maxExt) maxExt = ext;
              }
              c.base = base; c.w = maxExt; c.dw = dw; c.scale = scale;
              c.left = c.x - base / 2; // 严格居中于 SVG 音符 x
            }
            cols.sort(function (p, q) { return p.left - q.left; });
            for (i = 0; i < cols.length; i++) {
              c = cols[i];
              for (j = 0; j < c.members.length; j++) {
                // 装饰音并排：横向逐个排开同一水平线（m02816）；柱式和弦：同 x 纵向叠置
                c.members[j].digitX = (c.grace && c.members.length > 1) ? (c.left + j * (c.dw + chordGap)) : c.left;
              }
            }
            return cols.length ? cols[cols.length - 1].left + cols[cols.length - 1].w : 0;
          }
          var right = layoutFor(pF);
          for (var fit = 0; fit < 6 && right > groupW - 2 && pF > 9; fit++) {
            pF = Math.max(9, pF * (groupW - 2) / right * 0.99);
            right = layoutFor(pF);
          }
          // 垂直度量（柱式和弦：同列数字纵向叠置，低音在下、高音在上）
          var vGap = 0.14 * pF;
          for (i = 0; i < cols.length; i++) {
            c = cols[i];
            for (j = 0; j < c.members.length; j++) {
              r = c.members[j];
              var A = r.rest ? 0 : Math.max(0, r.oct);
              var B = r.rest ? 0 : Math.max(0, -r.oct);
              var L = r.grace ? 0 : r.under; // 装饰音不画减时线，也不占减时线高度
              var top = A > 0 ? (0.62 * pF + (A - 1) * dotStep + dotR) : 0.5 * pF;
              var underBot = L > 0 ? (0.52 * pF + (L - 1) * underGap + lineTh) : 0;
              var lowDotBot = B > 0 ? ((L > 0 ? underBot + 0.20 * pF : 0.66 * pF) + (B - 1) * dotStep + dotR) : 0;
              var bot = Math.max(0.5 * pF, underBot, lowDotBot);
              r.topExt = top; r.botExt = bot; r.A = A; r.B = B;
              r.upReach = top;
              r.downReach = B > 0 ? (0.66 * pF + (B - 1) * dotStep + dotR) : 0.5 * pF;
              r.vOff = 0;
            }
          }
          var maxTop = 0.5 * pF, maxBot = 0.5 * pF;
          for (i = 0; i < cols.length; i++) {
            c = cols[i];
            var n = c.members.length;
            var isChord = n > 1 && !c.rest && !c.grace; // 装饰音并排不纵向叠置（m02816）
            c.chordUnder = 0;
            if (isChord) {
              // members 已按 halfTone 升序（低→高）：j=0 最低，置底部
              // 装饰音和弦用更紧凑的叠置间距（graceScale），避免小字号装饰音纵向重叠（需求 m02686 第2点）
              var gsc = c.grace ? graceScale : 1;
              var raw = [0];
              for (j = 1; j < n; j++) {
                var vstep = (c.members[j].downReach + c.members[j - 1].upReach + vGap) * gsc;
                raw.push(raw[j - 1] - vstep);
              }
              var span = -raw[n - 1];
              // 不居中：以最低音（j=0, raw=0）为整行水平基准线，上方音往上叠，
              // 这样柱式和弦的最低音与单音同高，减时线/低音点定位一致。
              for (j = 0; j < n; j++) c.members[j].vOff = raw[j];
              var chordUnder = 0;
              for (j = 0; j < n; j++) if (c.members[j].under > chordUnder) chordUnder = c.members[j].under;
              c.chordUnder = chordUnder;
              // 共享减时线在最低音下方；上方音不再单独画减时线
              var bottom = c.members[0];
              var sharedUnderBot = chordUnder > 0 ? (0.52 * pF + (chordUnder - 1) * underGap + lineTh) : 0;
              var bottomLow = bottom.B > 0 ? (sharedUnderBot + 0.20 * pF + (bottom.B - 1) * dotStep + dotR) : 0;
              bottom.botExt = Math.max(0.5 * pF, sharedUnderBot, bottomLow);
              for (j = 1; j < n; j++) c.members[j].botExt = c.members[j].downReach;
            }
            c.topExt = 0.5 * pF; c.botExt = 0.5 * pF;
            for (j = 0; j < n; j++) {
              r = c.members[j];
              var t = r.topExt - r.vOff;
              var b = r.vOff + r.botExt;
              if (t > c.topExt) c.topExt = t;
              if (b > c.botExt) c.botExt = b;
            }
            if (c.topExt > maxTop) maxTop = c.topExt;
            if (c.botExt > maxBot) maxBot = c.botExt;
          }
          // 弧线（先算几何，确定是否需要额外上方空间）
          var arcs = jp2CollectArcs(blk, bi, cols, pF, dotStep, dotR);
          var arcSpace = 0;
          for (i = 0; i < arcs.length; i++) {
            var d = arcs[i].apexDist + arcs[i].th;
            if (arcs[i].kind === 'tuplet' && arcs[i].label) d = arcs[i].apexDist + 0.30 * pF; // 括号顶部数字高度
            if (d > arcSpace) arcSpace = d;
          }
          // 转调 / 变拍号事件：本行小节范围内（不含首小节——首小节调号已在最左显示）相对上一小节的变化，
          // 在简谱上方对应小节线处标注新调号 / 新拍号（需求 m01350）。
          var changeEvents = [];
          if (showKey && jp2Rich.measures) {
            for (var mm = blk.jp2m0 + 1; mm <= blk.jp2m1; mm++) {
              var curA = jp2Rich.measures[mm], prevA = jp2Rich.measures[mm - 1];
              if (!curA || !prevA) continue;
              var keyCh = curA.fifths !== prevA.fifths;
              var timeCh = (curA.beats !== prevA.beats) || (curA.beatType !== prevA.beatType);
              if (!keyCh && !timeCh) continue;
              var bIdx = mm - blk.jp2m0;
              var evX = (bars[bIdx] != null) ? (bars[bIdx] - cropLeft) * sx : null;
              changeEvents.push({ mnum: mm, fifths: curA.fifths, beats: curA.beats, beatType: curA.beatType, keyCh: keyCh, timeCh: timeCh, x: evX });
            }
          }
          var markSpace = 0, anyTimeCh = false, anyKeyCh = false;
          for (i = 0; i < changeEvents.length; i++) { if (changeEvents[i].timeCh) anyTimeCh = true; if (changeEvents[i].keyCh) anyKeyCh = true; }
          if (changeEvents.length) markSpace = (anyTimeCh ? 1.5 : 1.0) * pF;
          // 左侧拍号分数式（首行或行首变拍号）需要额外上下空间，避免加大间距后分子/分母被裁切（需求 m02038）
          if (showKey) {
            var ra0 = jp2Rich.measures[blk.jp2m0], pa0 = jp2Rich.measures[blk.jp2m0 - 1];
            var showLeftTs = (bi === 0) || (ra0 && pa0 && (ra0.beats !== pa0.beats || ra0.beatType !== pa0.beatType));
            if (showLeftTs) {
              var tsHalf = 0.74 * pF;
              if (tsHalf > maxTop) maxTop = tsHalf;
              if (tsHalf > maxBot) maxBot = tsHalf;
            }
          }
          var padTop = 0.15 * pF, padBot = 0.22 * pF;
          var y0 = padTop + markSpace + Math.max(maxTop, arcSpace);
          var H = y0 + maxBot + padBot;
          // 声部子行根 div（相对定位，正常流堆叠）
          var inner = document.createElement('div');
          inner.setAttribute('data-jp2-part', String(part));
          inner.style.cssText = 'position:relative;width:' + groupW.toFixed(2) + 'px;height:' + H.toFixed(2) + 'px;overflow:visible;';
          // 小节线
          var barTop = y0 - Math.max(0.8 * pF, maxTop);
          var barBot = y0 + Math.max(0.8 * pF, maxBot);
          for (i = 1; i < bars.length; i++) {
            var bx = (bars[i] - cropLeft) * sx;
            if (bx < 0 || bx > groupW) continue;
            // 全曲最后一小节用终止小节线（细线 + 粗线，粗线在右）
            var isFinal = (bi === blocks.length - 1) && (i === bars.length - 1);
            if (isFinal) {
              var thickW = lineTh * 3;
              var fGap = lineTh * 1.6;
              jp2Rule(inner, bx - thickW / 2, barTop, thickW, barBot - barTop, '#000');
              jp2Rule(inner, bx - thickW / 2 - fGap - lineTh, barTop, lineTh, barBot - barTop, '#000');
            } else {
              jp2Rule(inner, bx - lineTh / 2, barTop, lineTh, barBot - barTop, '#000');
            }
          }
          // 升降号字号倍数：页面里写 window.KB_ACC_SCALE 手动调（相对数字字号 fs 的倍数，默认 0.55，调大更醒目）
          var accScale = parseFloat(window.KB_ACC_SCALE);
          if (!isFinite(accScale) || accScale <= 0) accScale = 0.55;
          // 数字 / 八度点 / 增时线 / 附点 / 临时记号
          for (i = 0; i < cols.length; i++) {
            c = cols[i];
            for (j = 0; j < c.members.length; j++) {
              r = c.members[j];
              var fs = pF * c.scale;
              var dw2 = c.dw;
              var dx = r.digitX;
              var cy = y0 + (r.vOff || 0); // 柱式和弦各音纵向中心
              var isChord = c.members.length > 1 && !c.grace && !c.rest;
              var isBottom = isChord && j === 0;
              var glyph = r.rest ? '0' : String(r.degree);
              jp2Text(inner, dx, cy - fs / 2, dw2, fs, glyph, fs, JP2_NUM_FONT, '#000', 'center');
              if (r.accSign) {
                // 升降号字号/位置随数字字号 fs 同步缩放（fs=pF*c.scale）：谱面缩放、装饰音小字号时升降号一起变（需求 m02686 第1点）
                // 字号倍数 accScale 可由页面 window.KB_ACC_SCALE 手动调（默认 0.55）；盒尺寸随字号同比放大，中心锚定数字左上不变
                var afs = accScale * fs;
                var ak = accScale / 0.55;
                var aw = 0.46 * fs * ak, ah = 0.56 * fs * ak;
                var acx = dx - 0.27 * fs, acy = cy - 0.40 * fs;
                jp2Text(inner, acx - aw / 2, acy - ah / 2, aw, ah, r.accSign, afs, JP2_SYM_FONT, '#000', 'center');
              }
              for (var a = 0; a < r.A; a++) {
                var hcy = cy - 0.62 * pF - a * dotStep;
                jp2Dot(inner, dx + dw2 / 2, hcy, dotR);
              }
              var lowBase;
              if (isChord && !isBottom) {
                lowBase = cy + 0.66 * pF; // 柱式上方音：低音点紧贴数字下方
              } else if (isBottom) {
                lowBase = c.chordUnder > 0 ? (cy + 0.52 * pF + (c.chordUnder - 1) * underGap + lineTh + 0.20 * pF) : (cy + 0.66 * pF);
              } else {
                lowBase = r.under > 0 ? (cy + 0.52 * pF + (r.under - 1) * underGap + lineTh + 0.20 * pF) : (cy + 0.66 * pF);
              }
              for (var bb = 0; bb < r.B; bb++) {
                var cy2 = lowBase + bb * dotStep;
                jp2Dot(inner, dx + dw2 / 2, cy2, dotR);
              }
              r._beamedLevels = {};
              // 增时线“-”已去除（时值由五线谱对齐体现）；附点保留，与八度点同一大小（清晰一致）
              for (var ad = 0; ad < r.augDots; ad++) {
                var dotX = dx + dw2 + 0.12 * pF + ad * 0.28 * pF;
                jp2Dot(inner, dotX, cy, dotR);
              }
            }
          }
          jp2DrawUnderlines(blk, inner, cols, pF, y0, underGap, lineTh, digitW);
          for (i = 0; i < arcs.length; i++) jp2DrawArc(inner, arcs[i], y0, pF, groupW);
          // 高亮锚点块
          var pBySi = {}, pAnchors = [];
          for (i = 0; i < cols.length; i++) {
            c = cols[i];
            var hlTop = y0 - c.topExt - 0.12 * pF;
            var hlH = c.topExt + c.botExt + 0.24 * pF;
            var hl = document.createElement('div');
            hl.className = 'SparksNMN-notehl jp2hl';
            var isRestCol = c.rest;
            var bg = isRestCol ? 'rgba(150,150,150,0.18)' : 'rgba(47,129,247,0.18)';
            hl.style.cssText = 'position:absolute;left:' + (c.left - 0.10 * pF).toFixed(2) + 'px;top:' + hlTop.toFixed(2) + 'px;width:' + (c.w + 0.20 * pF).toFixed(2) + 'px;height:' + hlH.toFixed(2) + 'px;background:' + bg + ';visibility:hidden;border-radius:2px;';
            inner.appendChild(hl);
            var leadSi = -1;
            for (j = 0; j < c.members.length; j++) { if (c.members[j].si >= 0) { leadSi = c.members[j].si; break; } }
            var anchor = {
              el: hl, cx: padX + c.left + c.w / 2, top: yOff + hlTop, w: c.w + 0.20 * pF,
              snd: !isRestCol, row: '', _partList: null, si: leadSi, col: c, part: part
            };
            anchor._partList = [anchor];
            c.anchor = anchor;
            pAnchors.push(anchor);
            for (j = 0; j < c.members.length; j++) {
              var mr = c.members[j];
              if (mr.si >= 0) pBySi[mr.si] = anchor;
            }
            if (leadSi >= 0) hl.setAttribute('data-si', String(leadSi));
          }
          // 调号 / 拍号（仅每个系统的第一个声部行显示）
          if (showKey) {
            // 最左调号同步「当前行」起始小节的调性（转调后各行显示各自的 1=X，需求 m01350）
            var rowAttr = jp2Rich.measures[blk.jp2m0] || { fifths: jp2Rich.fifths, beats: jp2Rich.beats, beatType: jp2Rich.beatType };
            var keyName = jianpuKeyName(rowAttr.fifths) || '1=C';
            var firstLeft = cols.length ? cols[0].left : groupW;
            var keyFs = 0.6 * pF;
            var keyW = 1.3 * pF;
            // 1=C 放在五线谱最左小节线的外侧（左边）：右缘紧贴该小节线左缘（容许负 x，渲染到左侧留白）
            var bar0px = bars.length ? (bars[0] - cropLeft) * sx : 0;
            var keyX = bar0px - keyW - 0.10 * pF;
            var keyTop = y0 - keyFs / 2;
            jp2Text(inner, keyX, keyTop, keyW, keyFs, keyName, keyFs, JP2_SYM_FONT, '#000', 'left');
            // 拍号：首行第一节，或拍号在本行起始小节发生变化时，显示在左侧（需求 m01986 第2点）
            var prevAttr = jp2Rich.measures[blk.jp2m0 - 1];
            var rowTimeCh = prevAttr && (rowAttr.beats !== prevAttr.beats || rowAttr.beatType !== prevAttr.beatType);
            if (bi === 0 || rowTimeCh) {
              // 拍号放在最左小节线右侧、与 1=C 拉开距离（避免调号/拍号重叠），且仍在首列音符左侧
              var tsLeft = bar0px + 1.0 * pF;
              var tsFs = 0.55 * pF;
              if (firstLeft > tsLeft + 0.8 * pF) {
                jp2TimeSig(inner, tsLeft, y0, 0.7 * pF, tsFs, rowAttr.beats, rowAttr.beatType);
              }
            }
            // 行内转调 / 变拍号：在简谱上方对应小节线处标注新调号 / 新拍号
            for (var ei = 0; ei < changeEvents.length; ei++) {
              var ev = changeEvents[ei];
              if (ev.x == null) continue;
              var mFs = 0.6 * pF, mW = 1.7 * pF, my = padTop;
              var tFs = 0.5 * pF;
              if (ev.keyCh && ev.timeCh) {
                // 调号与拍号同一水平并排（需求 m03084）：调号在左、拍号在右，整体居中于小节线，竖直中心对齐，不再上下叠放
                var keyW2 = mW, timeW2 = 0.7 * pF, gap2 = 1.0 * pF;
                var totalW = keyW2 + gap2 + timeW2;
                var bandH = 2.6 * tFs;                 // 拍号分数式整体高
                var ccy = my + bandH / 2;              // 调号 / 拍号共同的竖直中心
                var gLeft = ev.x - totalW / 2;
                if (gLeft < 2) gLeft = 2;
                if (gLeft + totalW > groupW - 2) gLeft = groupW - 2 - totalW;
                jp2Text(inner, gLeft, ccy - mFs / 2, keyW2, mFs, jianpuKeyName(ev.fifths) || '1=C', mFs, JP2_SYM_FONT, '#000', 'center');
                jp2TimeSig(inner, gLeft + keyW2 + gap2, ccy, timeW2, tFs, ev.beats, ev.beatType);
              } else {
                if (ev.keyCh) {
                  jp2Text(inner, ev.x - mW / 2, my, mW, mFs, jianpuKeyName(ev.fifths) || '1=C', mFs, JP2_SYM_FONT, '#000', 'center');
                }
                if (ev.timeCh) {
                  // 分数式拍号（分子+横线+分母），整体顶部对齐 my
                  jp2TimeSig(inner, ev.x - 0.35 * pF, my + 0.30 * tFs + tFs, 0.7 * pF, tFs, ev.beats, ev.beatType);
                }
              }
            }
          }
          return { root: inner, bySi: pBySi, anchors: pAnchors, h: H, cols: cols };
        }

        // 声部行之间留出间隔（按需求 m01095：声部要有间隔距离）
        var partGap = Math.max(8, Math.round(0.5 * F));
        for (var pi = 0; pi < parts.length; pi++) {
          var pp = parts[pi];
          var pcols = partCols[pp] || [];
          var rr = renderPart(pcols, pp, pi === 0, yOffset);
          container.appendChild(rr.root);
          var gapAfter = (pi < parts.length - 1) ? partGap : 0;
          rr.root.style.marginBottom = gapAfter + 'px';
          yOffset += rr.h + gapAfter;
          for (var kk in rr.bySi) bySi[kk] = rr.bySi[kk];
          anchors = anchors.concat(rr.anchors);
          allCols = allCols.concat(rr.cols);
          rows.push({ part: pp, inner: rr.root, h: rr.h, cols: rr.cols });
        }
        container.style.height = yOffset.toFixed(2) + 'px';
        // 装进 .flowJp
        var jpEl = blk.jpEl;
        if (!jpEl) {
          jpEl = document.createElement('div');
          jpEl.className = 'flowJp';
          blk.jpEl = jpEl;
          if (HORIZ && blk.el && blk.el.parentElement && blk.el.parentElement.classList.contains('flowCol')) {
            blk.el.parentElement.appendChild(jpEl);
          } else if (blk.el && blk.el.parentElement) {
            blk.el.parentElement.insertBefore(jpEl, blk.el.nextSibling);
          } else {
            var host = hostEl(); if (host) host.appendChild(jpEl);
          }
        }
        jpEl.innerHTML = '';
        jpEl.setAttribute('data-jp2', '1');
        // 与 .flowSys 同一盒模型（border-box + 宽度自适应 + 水平 padding=padX），
        // 容器 margin:0 auto 居中 → 简谱与五线谱 SVG 的 x 原点完全一致（小节线/音符严格对齐）。
        var vPad = HORIZ ? 4 : 10;
        jpEl.style.width = '';
        jpEl.style.height = (yOffset + 2 * vPad).toFixed(2) + 'px';
        jpEl.style.padding = (HORIZ ? '4px ' : '0px ') + padX + 'px';
        jpEl.style.margin = HORIZ ? '0px 0 0' : '0px auto 0';
        jpEl.style.boxSizing = 'border-box';
        jpEl.appendChild(container);
        blk.jp2 = { inner: container, bySi: bySi, anchors: anchors, padX: padX, w: groupW, h: yOffset, cols: allCols, rows: rows };
      }

      function jp2Dot(parent, cx, cy, r) {
        var d = Math.max(1.2, r * 2);
        var div = jp2Div(parent, cx - d / 2, cy - d / 2, d, d, '#000');
        // 圆点用 clip-path 近似圆（16 边形，更圆滑清晰）
        var poly = [], N = 16;
        for (var i = 0; i < N; i++) {
          var ang = i / N * Math.PI * 2;
          poly.push((50 + 50 * Math.cos(ang)).toFixed(2) + '% ' + (50 + 50 * Math.sin(ang)).toFixed(2) + '%');
        }
        div.style.clipPath = 'polygon(' + poly.join(',') + ')';
        div.style.boxShadow = '0 0 0 0 #000';
        return div;
      }

      // 减时线：按 (part,voice,beam level) 的 begin/continue/end 画连接线，其余单音画短线。
      function jp2DrawUnderlines(blk, inner, cols, F, y0, underGap, lineTh, digitW) {
        var i, j, r;
        for (i = 0; i < cols.length; i++) {
          cols[i]._beamedLevels = {};
          for (j = 0; j < cols[i].members.length; j++) { r = cols[i].members[j]; r._cy = y0 + (r.vOff || 0); }
        }
        // 减时线统一基线高度：符杠/和弦共享/单音减时线都画在同一水平基线，层级递增 underGap（需求 m02596 第2点：高度一致）
        var baseY = y0 + 0.52 * F;
        // 连接符杠：按 XML beam（part|voice|level 的 begin/continue/end）分组，与五线谱符杠链接方式一致（需求 m02596 第1点）
        var recs = [];
        for (i = 0; i < cols.length; i++) for (j = 0; j < cols[i].members.length; j++) recs.push(cols[i].members[j]);
        recs.sort(function (p, q) { return p.docOrder - q.docOrder; });
        var open = {}, spans = [];
        for (i = 0; i < recs.length; i++) {
          r = recs[i]; if (r.rest || r.grace) continue;
          for (j = 0; j < r.beams.length; j++) {
            var bm = r.beams[j], lvl = bm.number || 1, key = r.part + '|' + r.voice + '|' + lvl;
            if (bm.value === 'begin') open[key] = { level: lvl, notes: [r] };
            else if (bm.value === 'continue' || bm.value === 'end') {
              var sp = open[key]; if (!sp) { sp = open[key] = { level: lvl, notes: [] }; }
              sp.notes.push(r);
              if (bm.value === 'end') { spans.push(sp); delete open[key]; }
            }
          }
        }
        for (var ok in open) if (open[ok].notes.length >= 2) spans.push(open[ok]);
        // 标记被符杠覆盖的层级（记在「列」上：柱式和弦任一成员带 beam 即整列被覆盖，避免重复画线）
        for (i = 0; i < spans.length; i++) {
          var spn = spans[i];
          for (j = 0; j < spn.notes.length; j++) {
            var nc = spn.notes[j].col; if (nc) { nc._beamedLevels = nc._beamedLevels || {}; nc._beamedLevels[spn.level] = spn; }
          }
        }
        // 画连接符杠：同一基线高度，水平连接整组（宽度随组跨度，厚度 lineTh 统一）
        var drawn = {};
        for (i = 0; i < spans.length; i++) {
          var s = spans[i]; if (s.notes.length < 2) continue;
          var key2 = s.level + '|' + s.notes[0].docOrder + '|' + s.notes[s.notes.length - 1].docOrder;
          if (drawn[key2]) continue; drawn[key2] = true;
          var first = s.notes[0], last = s.notes[s.notes.length - 1];
          var x0 = first.digitX, x1 = last.digitX + (last.col ? last.col.dw : digitW);
          var y = baseY + (s.level - 1) * underGap;
          jp2Rule(inner, x0, y - lineTh / 2, Math.max(0.6, x1 - x0), lineTh, '#000');
        }
        // 柱式和弦共享减时线（未被符杠覆盖的层级），同一基线、等宽 digitW
        for (i = 0; i < cols.length; i++) {
          var cc = cols[i];
          if (!(cc.members.length > 1 && !cc.grace && !cc.rest)) continue;
          for (var cl = 1; cl <= cc.chordUnder; cl++) {
            if (cc._beamedLevels && cc._beamedLevels[cl]) continue;
            var cyy = baseY + (cl - 1) * underGap;
            jp2Rule(inner, cc.left, cyy - lineTh / 2, digitW, lineTh, '#000');
          }
        }
        // 单音减时线（未被符杠覆盖），同一基线、等宽 digitW
        for (i = 0; i < cols.length; i++) {
          var c2 = cols[i];
          if (c2.members.length > 1 && !c2.grace && !c2.rest) continue;
          for (j = 0; j < c2.members.length; j++) {
            r = c2.members[j];
            if (r.rest || r.grace) continue;
            for (var lv = 1; lv <= r.under; lv++) {
              if (c2._beamedLevels && c2._beamedLevels[lv]) continue;
              var yy = baseY + (lv - 1) * underGap;
              jp2Rule(inner, r.digitX, yy - lineTh / 2, digitW, lineTh, '#000');
            }
          }
        }
      }

      // 收集弧线（tie/slur/tuplet/grace），几何用「距 y0 上方距离」表示。
      function jp2CollectArcs(blk, bi, cols, F, dotStep, dotR) {
        var arcs = [];
        var i, j, r;
        var recs = [];
        for (i = 0; i < cols.length; i++) for (j = 0; j < cols[i].members.length; j++) recs.push(cols[i].members[j]);
        recs.sort(function (p, q) { return p.docOrder - q.docOrder; });
        function topOf(rr) { return (rr.topExt || 0.5 * F) - (rr.vOff || 0); }
        function colOf(rr) { return rr.col; }
        function noteX(rr) { return rr.digitX + (rr.col ? rr.col.dw : 0.62 * F) / 2; }
        // tie：按 part|voice|midi FIFO
        var tieQ = {};
        for (i = 0; i < recs.length; i++) {
          r = recs[i];
          if (r.rest) continue;
          var tk = r.part + '|' + r.voice + '|' + r.halfTone;
          if (r.tieStop && tieQ[tk] && tieQ[tk].length) {
            var from = tieQ[tk].shift();
            arcs.push(jp2MakeArc(from, r, 'tie', F, bi));
          }
          if (r.tieStart) { (tieQ[tk] = tieQ[tk] || []).push(r); }
        }
        // 连奏线（slur）弧线已去除：简谱只保留延音线（tie）与三连音直角括号（需求 m02686）。
        // tuplet：按 part|number
        var tupQ = {};
        for (i = 0; i < recs.length; i++) {
          r = recs[i];
          for (j = 0; j < r.tuplets.length; j++) {
            var tp = r.tuplets[j];
            var tuk = r.part + '|' + tp.number;
            if (tp.type === 'start') { (tupQ[tuk] = tupQ[tuk] || []).push({ rec: r, actual: tp.actual }); }
            else if (tp.type === 'stop') {
              if (tupQ[tuk] && tupQ[tuk].length) {
                var tf = tupQ[tuk].shift();
                var ta = jp2MakeArc(tf.rec, r, 'tuplet', F, bi);
                ta.label = String(tf.actual || '');
                // 横梁高度取整组连音跨度的最高音符（含中间和弦），避免括号压到音符
                var fc2 = tf.rec.col, tc2 = r.col, spanMax = 0;
                if (fc2 && tc2) {
                  var loX = Math.min(fc2.left, tc2.left) - 0.01, hiX = Math.max(fc2.left, tc2.left) + 0.01;
                  for (var ci = 0; ci < cols.length; ci++) {
                    var cc = cols[ci];
                    if (cc.left >= loX && cc.left <= hiX && cc.topExt > spanMax) spanMax = cc.topExt;
                  }
                }
                if (spanMax > 0) ta.apexDist = spanMax + 0.55 * F;
                arcs.push(ta);
              }
            }
          }
        }
        // 装饰音不画弧线（按需求 m01095：装饰音不需要弧线）
        return arcs;
      }

      function jp2MakeArc(fromRec, toRec, kind, F, bi) {
        var fc = fromRec.col, tc = toRec.col;
        var sameRow = (fc && tc && fc.bi === bi && tc.bi === bi);
        var x0, x1, apexDist, th = Math.max(1, 0.06 * F);
        var fTop = (fromRec.topExt || 0.5 * F) - (fromRec.vOff || 0), tTop = (toRec.topExt || 0.5 * F) - (toRec.vOff || 0);
        var fx = fromRec.digitX + (fc ? fc.dw : 0.62 * F) / 2;
        var tx = toRec.digitX + (tc ? tc.dw : 0.62 * F) / 2;
        if (kind === 'tie') {
          x0 = fromRec.digitX + (fc ? fc.dw : 0.62 * F) + 0.06 * F;
          x1 = toRec.digitX - 0.06 * F;
          apexDist = Math.max(fTop, tTop) + 0.16 * F + 0.20 * F;
        } else if (kind === 'grace') {
          x0 = fx; x1 = tx;
          apexDist = Math.max(fTop, tTop) + 0.18 * F + 0.20 * F;
        } else if (kind === 'tuplet') {
          // 直角括号：横梁盖住整组连音，两端竖腿向下；x 范围扩到首尾数字外侧
          x0 = fromRec.digitX - 0.10 * F;
          x1 = toRec.digitX + (tc ? tc.dw : 0.62 * F) + 0.10 * F;
          apexDist = Math.max(fTop, tTop) + 0.55 * F;
        } else { // slur
          x0 = fx; x1 = tx;
          apexDist = Math.max(fTop, tTop) + 0.30 * F + 0.40 * F;
        }
        return { kind: kind, from: fromRec, to: toRec, x0: x0, x1: x1, apexDist: apexDist, th: th, sameRow: sameRow, bi: bi, label: '' };
      }

      function jp2DrawArc(inner, arc, y0, F, groupW) {
        var x0 = arc.x0, x1 = arc.x1;
        var baseY0 = y0 - ((arc.from.topExt || 0.5 * F) - (arc.from.vOff || 0)) + 0.02 * F;
        var baseY1 = y0 - ((arc.to.topExt || 0.5 * F) - (arc.to.vOff || 0)) + 0.02 * F;
        var apexY = y0 - arc.apexDist;
        // 连音（三连音/四连音…）：直角括号盖住整组，顶部中央显示数字（需求 m01881）
        if (arc.kind === 'tuplet') {
          if (x1 < x0) { var tt = x0; x0 = x1; x1 = tt; }
          var bY = apexY, legH = 0.30 * F, bth = arc.th;
          var numFs = 0.50 * F, numW = 0.55 * F, mid = (x0 + x1) / 2, gap = numW + 0.16 * F;
          if (arc.sameRow) {
            var gl = mid - gap / 2, gr = mid + gap / 2;
            if (gl > x0) jp2Rule(inner, x0, bY, gl - x0, bth, '#000');
            if (x1 > gr) jp2Rule(inner, gr, bY, x1 - gr, bth, '#000');
            jp2Rule(inner, x0, bY, bth, legH, '#000');
            jp2Rule(inner, x1 - bth, bY, bth, legH, '#000');
          } else {
            var toRight2 = (arc.to.col && arc.to.col.bi > arc.bi);
            if (toRight2) {
              jp2Rule(inner, x0, bY, groupW - 1 - x0, bth, '#000');
              jp2Rule(inner, x0, bY, bth, legH, '#000');
            } else {
              jp2Rule(inner, 1, bY, x1 - 1, bth, '#000');
              jp2Rule(inner, x1 - bth, bY, bth, legH, '#000');
            }
          }
          if (arc.label) jp2Text(inner, mid - numW / 2, bY - numFs / 2, numW, numFs, arc.label, numFs, JP2_NUM_FONT, '#000', 'center');
          return;
        }
        if (arc.sameRow) {
          if (x1 < x0) { var tmp = x0; x0 = x1; x1 = tmp; }
          jp2Arc(inner, x0, baseY0, x1, baseY1, apexY, arc.th, '#000');
          if (arc.label) {
            jp2Text(inner, (x0 + x1) / 2 - 0.3 * F, apexY - 0.55 * F, 0.6 * F, 0.5 * F, arc.label, 0.45 * F, JP2_NUM_FONT, '#000', 'center');
          }
        } else {
          // 跨行：画到行边缘的半弧
          var toRight = (arc.to.col && arc.to.col.bi > arc.bi);
          if (toRight) {
            jp2Arc(inner, x0, baseY0, groupW - 1, apexY + 0.1 * F, apexY, arc.th, '#000');
          } else {
            jp2Arc(inner, 1, apexY + 0.1 * F, x1, baseY1, apexY, arc.th, '#000');
          }
        }
      }

      // jp2 锚点查询：jpAnchorFor 顶部拦截后走这里。
      function jp2AnchorFor(blk, si) {
        // 用户要求：删除简谱自身的音符高亮，改用五线谱播放滚动框（已延长到简谱位置）。
        // 返回 null → jpHighlightAt / buildHiEls / jpHiSounding 都不再点亮简谱锚点。
        return null;
      }
      function buildFlow(forceW) {
        var host = hostEl();
        if (!host) return;
        if (!pendingPages.length) return;
        if (!forceW) hFitPass = 0;
        for (var hti = 0; hti < hFitTimers.length; hti++) clearTimeout(hFitTimers[hti]);
        hFitTimers.length = 0;

        // 量宽度前必须可见：隐藏元素 clientWidth 是 0，组宽会算成兜底值
        var wrapNow = wrapEl();
        if (wrapNow) wrapNow.hidden = false;

        // 重排会重建所有简谱行：先收掉播放框，锚点缓存一并作废
        try { hideFlowCursor(); } catch (eHide) { }
        // 自动滚动自己带缓动，别让 CSS 的 smooth 再叠一层
        try { var wr0 = wrapEl(); if (wr0) wr0.style.scrollBehavior = 'auto'; } catch (eSb) { }

        var width = Math.max(280, (host.clientWidth || 800) - 4);
        var groupW = Math.round(forceW || (width * flowZoom));
        if (groupW < 240) groupW = 240;

        // 一行的裁切范围（竖版 / 横版共用同一套几何，避免两套算法算出不同高度）
        function sysGeom(pg, sys, isFirst) {
          var cropLeft = pg.x0;
          var cropW = pg.inkW;

          // 整页音符，用来决定上下要留多少
          var pageNotes = [], pnEls = pg.svg.querySelectorAll('.Note'), pn;
          for (pn = 0; pn < pnEls.length; pn++) {
            var ppos = matrixXY(pnEls[pn]);
            if (ppos) pageNotes.push(ppos);
          }
          // 上界放到「上一系统底与本系统顶的中点」，这样高音 / 加线音符才会被纳入 minY，
          // 又不会把上一系统的低音（加线）抓进来——否则上一系统低音落在本系统裁剪窗里，
          // 会在两系统之间留下残留音符（如 m63-66 与 m67-70 之间）。首系统则本系统顶上方 400。
          // 下界仍收 230，避免抓到下一系统的音符。
          var sysIdx = pg.systems.indexOf(sys);
          var prevSys = sysIdx > 0 ? pg.systems[sysIdx - 1] : null;
          var winTop = prevSys ? (prevSys.bottom + sys.top) / 2 : sys.top - 400;
          var winBot = sys.bottom - 230;
          var minY = Infinity, maxY = -Infinity;
          for (pn = 0; pn < pageNotes.length; pn++) {
            if (pageNotes[pn].y < winTop || pageNotes[pn].y > winBot) continue;
            if (pageNotes[pn].y < minY) minY = pageNotes[pn].y;
            if (pageNotes[pn].y > maxY) maxY = pageNotes[pn].y;
          }
          if (!isFinite(minY)) { minY = sys.top + 130; maxY = sys.bottom - 130; }

          // sys.top 已经是「谱表顶 - 130」，那 130 就是小节号的余量
          var realTop = Math.min(sys.top, minY - 150);
          var realBot = Math.max(sys.bottom, maxY + 90);

          // 再按真实图形包围盒扩展（小节号会被抬高）
          if (pg.decors && pg.decors.length) {
            for (var dz = 0; dz < pg.decors.length; dz++) {
              var dc = pg.decors[dz];
              if (dc.mid < sys.top || dc.mid > sys.bottom) continue;
              if (dc.minY - 12 < realTop) realTop = dc.minY - 12;
              if (dc.maxY + 12 > realBot) realBot = dc.maxY + 12;
            }
          }

          // 横版是一条横向的带子，上下空白要省着用：
          // 上面只留小节号的位置（sys.top 是「谱表顶 - 130」，这里收回到 -70），
          // 下面留歌词/dynamics 的距离即可。
          if (HORIZ) {
            var hBot = sys.bottom - 60;
            if (realBot > hBot) realBot = hBot;
            // 上边距统一成 hHead（横版预排时按所有行里最高处算出来的），
            // 这样各行谱表顶在列里的位置一致，高音 / 8va / 延音线也不会被裁掉。
            var hCropT = Math.round(sys.top + 130 - hHead);
            var hCropB = Math.round(realBot + 14);
            return {
              cropLeft: cropLeft, cropW: cropW,
              cropTop: hCropT, cropBot: hCropB,
              sysH: Math.max(60, hCropB - hCropT)
            };
          }

          var cropTop = isFirst ? 0 : Math.round(realTop - 20);
          var cropBot = Math.round(realBot + 20);
          return {
            cropLeft: cropLeft, cropW: cropW,
            cropTop: cropTop, cropBot: cropBot,
            sysH: Math.max(80, cropBot - cropTop)
          };
        }

        // 横版：先量出「谱表顶上方最高能到哪」（高音音符、8va、延音线都算），
        // 取所有行里最大的那个当统一上边距——既不会裁掉高处的符号，各行又仍然对齐。
        if (HORIZ) {
          var needHead = 86;
          for (var hq1 = 0; hq1 < pendingPages.length; hq1++) {
            var hpg = pendingPages[hq1];
            var hPts = [], hEls = hpg.svg.querySelectorAll('.Note');
            for (var hn = 0; hn < hEls.length; hn++) {
              var hp = matrixXY(hEls[hn]);
              if (hp) hPts.push(hp);
            }
            for (var hq2 = 0; hq2 < hpg.systems.length; hq2++) {
              var hsy = hpg.systems[hq2];
              var hStaffT = hsy.top + 130;
              var hMin = hStaffT;
              for (var hp2 = 0; hp2 < hPts.length; hp2++) {
                var q = hPts[hp2];
                if (q.y >= hsy.top && q.y <= hsy.bottom && q.y < hMin) hMin = q.y;
              }
              if (hpg.decors && hpg.decors.length) {
                for (var hd = 0; hd < hpg.decors.length; hd++) {
                  var hdc = hpg.decors[hd];
                  if (hdc.mid < hsy.top || hdc.mid > hsy.bottom) continue;
                  if (hdc.minY < hMin) hMin = hdc.minY;
                }
              }
              var hNeed = hStaffT - hMin + 14;
              if (hNeed > needHead) needHead = hNeed;
            }
          }
          hHead = Math.min(240, Math.max(86, Math.round(needHead)));
        }

        // 横版：先量出最高的一行，按「最高行刚好放进谱面区」定统一缩放。
        // 这样每行高度不同、但比例一致（列宽也一致），排成一条横向带子。
        if (HORIZ && !forceW) {
          var HMAX = 0, HCROPW = 0;
          for (var q1 = 0; q1 < pendingPages.length; q1++) {
            var qpg = pendingPages[q1];
            for (var q2 = 0; q2 < qpg.systems.length; q2++) {
              var qg = sysGeom(qpg, qpg.systems[q2], false);
              if (qg.sysH > HMAX) HMAX = qg.sysH;
              if (!HCROPW) HCROPW = qg.cropW;
            }
          }
          var bandH = Math.max(200, ((wrapNow && wrapNow.clientHeight) || host.clientHeight || 600) - 26);
          var kH = bandH / Math.max(1, HMAX);
          groupW = Math.max(240, Math.round(kH * Math.max(1, HCROPW)));
        }

        // jp2：有 MusicXML 富解析结果时不再用 efData 简谱，改由 buildJp2Rows 按 SVG 坐标生成。
        var jpAll = (score && jp2Rich) ? [] : buildJpSections(groupW);
        var jpLines = [];
        for (var ji = 0; ji < jpAll.length; ji++) {
          if (/^musicLine--/.test(String(jpAll[ji].sec.label || ''))) jpLines.push(jpAll[ji]);
        }

        if (hCamRaf) { try { cancelAnimationFrame(hCamRaf); } catch (eCam) { } hCamRaf = 0; }
        hCamCol = null;
        host.innerHTML = '';
        blocks = [];
        svgFlat = [];
        if (HORIZ) {
          host.classList.add('hFlow');
          try { wrapNow.scrollLeft = 0; } catch (eHL) { }
        } else {
          host.classList.remove('hFlow');
          host.style.paddingTop = '';
          host.style.paddingBottom = '';
        }

        var pairCount = 0;
        for (var pi = 0; pi < pendingPages.length; pi++) {
          var pg = pendingPages[pi];
          for (var si = 0; si < pg.systems.length; si++) {
            var sys = pg.systems[si];
            // 横版不带页首标题（标题另有「作品信息」区），每行都从谱表上沿裁，
            // 这样所有列高度一致、拼起来才像一条谱。
            var gm = sysGeom(pg, sys, !HORIZ && pi === 0 && si === 0);
            var cropLeft = gm.cropLeft, cropW = gm.cropW;
            var cropTop = gm.cropTop, cropBot = gm.cropBot, sysH = gm.sysH;

            var clone = pg.svg.cloneNode(true);
            clone.removeAttribute('width');
            clone.removeAttribute('height');
            clone.setAttribute('viewBox', cropLeft + ' ' + cropTop + ' ' + cropW + ' ' + sysH);
            clone.setAttribute('preserveAspectRatio', 'xMidYMid meet');
            clone.setAttribute('width', groupW);
            clone.setAttribute('height', Math.round(groupW * sysH / cropW));

            var notes = [], ns = clone.querySelectorAll('.Note');
            for (var ni = ns.length - 1; ni >= 0; ni--) {
              var el = ns[ni];
              var pos = matrixXY(el);
              if (!pos) { el.parentNode.removeChild(el); continue; }
              if (pos.y < cropTop || pos.y > cropBot) { el.parentNode.removeChild(el); continue; }
              notes.push({ el: el, x: pos.x, y: pos.y });
            }
            notes.sort(function (a, b) {
              if (Math.abs(a.x - b.x) > 3) return a.x - b.x;
              return b.y - a.y;
            });

            var blkSys = document.createElement('div');
            blkSys.className = 'flowSys';
            blkSys.appendChild(clone);
            var flowHost = host;
            if (HORIZ) {
              // 横版：五线谱 + 简谱装进同一列，整列横着排
              flowHost = document.createElement('div');
              flowHost.className = 'flowCol';
              flowHost.appendChild(blkSys);
              host.appendChild(flowHost);
            } else {
              host.appendChild(blkSys);
            }

            var blkJp = null;
            if (pairCount < jpLines.length) {
              blkJp = document.createElement('div');
              blkJp.className = 'flowJp';
              blkJp.appendChild(jpLines[pairCount].el);
              flowHost.appendChild(blkJp);
            }

            var blkIndex = blocks.length;
            // 小节线：MuseScore 导出的 <polyline class="BarLine"> 是绝对坐标，
            // 拿它的 x 就能把这一行的音符精确分到各小节里（不用再按行均分）。
            var barXs = [];
            try {
              var bls = clone.querySelectorAll('.BarLine');
              for (var bi2 = 0; bi2 < bls.length; bi2++) {
                var pts = (bls[bi2].getAttribute('points') || '').trim().split(/\s+/);
                var bx = null, by1 = null, by2 = null;
                for (var pi2 = 0; pi2 < pts.length; pi2++) {
                  var xy = pts[pi2].split(',');
                  if (xy.length < 2) continue;
                  var xx2 = parseFloat(xy[0]), yy2 = parseFloat(xy[1]);
                  if (!isFinite(xx2) || !isFinite(yy2)) continue;
                  if (bx === null || xx2 < bx) bx = xx2;
                  by1 = (by1 === null) ? yy2 : Math.min(by1, yy2);
                  by2 = (by2 === null) ? yy2 : Math.max(by2, yy2);
                }
                if (bx === null || by1 === null) continue;
                if (by2 < cropTop || by1 > cropBot) continue;
                barXs.push(bx);
              }
            } catch (eBar) { barXs = []; }
            barXs.sort(function (p, q) { return p - q; });
            var barUniq = [];
            for (var bu = 0; bu < barXs.length; bu++) {
              if (!barUniq.length || Math.abs(barXs[bu] - barUniq[barUniq.length - 1]) > 2) barUniq.push(barXs[bu]);
            }
            blocks.push({
              el: blkSys, jpEl: blkJp, svg: clone,
              vbTop: cropTop, vbLeft: cropLeft, vbW: cropW, sysH: sysH,
              staffTop: sys.top + 130, staffBottom: sys.bottom - 130,
              page: pi, sys: si, noteCount: notes.length, barXs: barUniq
            });

            for (var q = 0; q < notes.length; q++) {
              svgFlat.push({ blk: blkIndex, el: notes[q].el, x: notes[q].x, y: notes[q].y });
            }
            pairCount++;
          }
        }

        flowReady = svgFlat.length > 0;
        svgReady = flowReady;
        svgScoreMap = null;
        svgToScore = null;
        // 谱面重建后立刻重算「行 ↔ 小节」切分，简谱高亮要用 blocks[].scoreFrom/scoreTo
        try { buildSvgScoreMap(); } catch (eBm) { }
        svgPages = pendingPages.slice();
        svgSystems = blocks.slice();
        try { resetScrollPlan(); } catch (eRS) { }   // 谱面重建：滚动时间轴作废

        // 每组在全局音符序列里的区间，简谱列框按这个比例定位
        var accN = 0;
        for (var biN = 0; biN < blocks.length; biN++) {
          blocks[biN]._bars = null;
          blocks[biN].noteFrom = accN;
          accN += blocks[biN].noteCount;
          blocks[biN].noteTo = accN;
        }

        // jp2：用 MusicXML+SVG 生成简谱行（取代 efData）。在 noteFrom/noteTo 之后、锚点统计之前。
        try { if (score && jp2Rich) buildJp2Rows(groupW); } catch (eJp2) { try { console.warn('[jp2] 渲染失败', eJp2); } catch (eL) { } }

        var w = wrapEl();
        if (w) w.hidden = (blocks.length === 0);
        ensureCursor();

        // 简谱音符锚点统计（排查用）：没有锚点说明这份 efData 里没带音符高亮块
        try {
          var anTotal = 0, anLines = 0, anSnd = 0;
          for (var biA = 0; biA < blocks.length; biA++) {
            var aa = jpNoteAnchors(blocks[biA]);
            if (aa.length) anLines++;
            anTotal += aa.length;
            anSnd += jpSounding(blocks[biA]).length;
          }
          console.log('[简谱高亮] 音符锚点 ' + anTotal + ' 个（发声 ' + anSnd + ' 个），覆盖 ' +
            anLines + '/' + blocks.length + ' 组');
        } catch (eAn) { }

        try {
          console.log('[对照流] 五线谱块 ' + blocks.length + '，简谱行 ' + jpLines.length +
            '，音符 ' + svgFlat.length + '，MusicXML ' + (score ? score.notes.length : 0) +
            '，组宽 ' + groupW);
          console.log('[对照流] 每行音符 ' +
            blocks.map(function (b) { return b.noteCount; }).join('/'));
        } catch (e) { }

        if (statusEl) {
          statusEl.textContent = '已载入 ' + pendingPages.length + ' 页 SVG，' +
            blocks.length + ' 组，' + svgFlat.length + ' 个音符';
        }

        curGroup = 0;
        lastGroupW = groupW;
        try { applyPortraitWidth(groupW); } catch (eP) { }
        try { fixJpDots(); } catch (eFix) { }
        try { renderScoreHead(); } catch (eHead) { }
        try { syncBoardLift(); } catch (eLift) { }

        // 竖屏：让「一组 = 五线谱 + 简谱」正好装进可视区
        if (portraitMode && !forceW && blocks.length) {
          var flowH = wrapEl() ? wrapEl().clientHeight : 0;
          if (flowH > 120) {
            var sysH0 = blocks[0].el.offsetHeight || 0;
            var jpH0 = blocks[0].jpEl ? (blocks[0].jpEl.offsetHeight || 0) : 0;
            var pairH = sysH0 + jpH0;
            var budget = flowH * 0.90;
            if (pairH > budget && groupW > 200) {
              var nw = Math.max(200, Math.round(groupW * budget / pairH * 0.98));
              try {
                console.log('[竖屏] 组高 ' + pairH + ' > 预算 ' + Math.round(budget) +
                  '，组宽 ' + groupW + ' → ' + nw);
              } catch (e) { }
              buildFlow(nw);
              return;
            }
          }
        }
        // 横版：高度要连简谱一起装进谱面区。先按「最高的一行」粗算，
        // 排完量实际列高（含简谱）再按比例校正；简谱高度不是严格随宽度线性缩放的，
        // 所以最多校正 3 次（hFitPass），让内容占可视高度的 92%，上下各留一点空隙。
        if (HORIZ && blocks.length && hFitPass < 3) {
          var hView = wrapEl() ? wrapEl().clientHeight : 0;
          if (hView > 80) {
            var colH = hColMax();
            var budgetH = Math.max(120, Math.round((hView - 8) * hBandPct));
            if (colH > 0 && Math.abs(colH - budgetH) > Math.max(8, budgetH * 0.02)) {
              var nw2 = Math.max(200, Math.round(groupW * budgetH / colH));
              try {
                console.log('[横版] 列高 ' + colH + ' / 可视 ' + hView +
                  '，组宽 ' + groupW + ' → ' + nw2);
              } catch (eHL2) { }
              hFitPass++;
              buildFlow(nw2);
              return;
            }
          }
        }
        // 横版：内容只占 hBandPct 的高度，剩下的空白平均分到谱面区上下，
        // 这样五线谱 + 简谱这一整块在谱面区里垂直居中（各列五线谱顶仍然对齐）。
        if (HORIZ) {
          var availH2 = wrapEl() ? wrapEl().clientHeight : 0;
          var mxH = hColMax();
          if (availH2 > 0 && mxH > 0) {
            var padV = Math.round((availH2 - mxH) / 2);
            if (!(padV > 0)) padV = 0;
            host.style.paddingTop = padV + 'px';
            host.style.paddingBottom = padV + 'px';
          }
        }
        if (HORIZ) { scheduleHFit(350); scheduleHFit(1400); scheduleHFit(2600); }
      }
      // 和弦里的八度点会撞上「上面那个音」：简谱行距约 12.7px，而八度点固定画在
      // 自己那个音上方约 14px（盒子），正好落在上面那个音的笔画里。
      // 这里把这类点挪到两个音之间的空白处：仍然跟着它自己的音，不压字、不挪音符。
      // 注意：点的盒子是整行高，墨迹偏下（约在盒高的 64% 处），数字墨迹才是居中的；
      // 所以落点必须按「墨迹中心」算，否则会压到它自己那个音上。
      // 低八度点（画在音下方）同理，只是往上挪。宽度变了会重建对照流，重建后重新算。
      var JP_DOT_INK = 0.67;     // 点的墨迹中心 ÷ 盒子高（盒子是整行高，墨迹贴底；实测 0.144~0.21，取中间）
      var JP_DIGIT_INK = 0.5;    // 数字的墨迹中心 ÷ 盒子高（居中）
      var JP_DIGIT_HALF = 0.236; // 数字墨迹半高 ÷ 盒子高
      var JP_DOT_HALF = 0.05;    // 点的墨迹半高 ÷ 盒子高

      // 简谱的八度点有两件事要修：
      //  A) 一个音「两个八度以上」会有 2、3、4 个点，导出数据里它们只隔 2.9px（约 0.12em），
      //     小字号下会糊成一个；中间音的点还会顶进下面那个音的笔画里。
      //  B) 单个八度点有时会压到相邻音的笔画上（和弦里常见）。
      // 点的归属直接按 DOM 顺序认：数字后面紧跟的那几个点就是这个数字的
      // （sparks 导出的顺序就是「数字, 点, 点, …」），不靠坐标猜。
      function fixJpDots() {
        var lines = document.querySelectorAll('.flowJp');
        for (var li = 0; li < lines.length; li++) {
          if (lines[li].getAttribute('data-jp2')) continue; // jp2 行自己管八度点，不走 efData 防碰撞
          var spans = lines[li].querySelectorAll('span');
          var items = [];
          for (var k = 0; k < spans.length; k++) {
            var sp = spans[k];
            if (sp.querySelector('span,div')) continue;
            var txt = (sp.textContent || '').trim();
            if (!txt) continue;
            var r = sp.getBoundingClientRect();
            if (r.width < 0.2 || r.height < 0.2) continue;
            var cur = parseFloat(sp.style.marginTop) || 0;
            var isDot = (txt === '.');
            var h = r.height;
            items.push({
              el: sp, txt: txt, h: h, cur: cur, isDot: isDot,
              cx: r.left + r.width / 2,
              ink: (r.top - cur) + (isDot ? JP_DOT_INK : JP_DIGIT_INK) * h,
              half: (isDot ? JP_DOT_HALF : JP_DIGIT_HALF) * h
            });
          }

          var digits = [];
          for (var i = 0; i < items.length; i++) {
            if (!items[i].isDot && /^[0-9]$/.test(items[i].txt)) digits.push(items[i]);
          }
          if (!digits.length) continue;

          // 按 DOM 顺序分组：数字 → 紧跟其后的若干点。
          // 只收「正上方/正下方」的八度点（x 与数字对齐）；附点（附点音符那个点）
          // 是往右偏 ~0.2em 的，不参与分组、也不动它。
          var groups = [], curG = null;
          for (var j = 0; j < items.length; j++) {
            var it = items[j];
            if (it.isDot) {
              if (curG && Math.abs(it.cx - curG.digit.cx) <= 1.2) curG.dots.push(it);
            } else if (/^[0-9]$/.test(it.txt)) {
              curG = { digit: it, dots: [] };
              groups.push(curG);
            } else curG = null;
          }

          for (var gi = 0; gi < groups.length; gi++) {
            var d = groups[gi].digit, ds = groups[gi].dots;
            if (!ds.length) continue;
            var hh = d.h, dotH = (JP_DOT_HALF * 2) * hh;

            var mean = 0;
            for (var m = 0; m < ds.length; m++) mean += ds[m].ink;
            mean /= ds.length;
            var isUp = mean < d.ink;              // 点在数字上方（高八度）

            // 同列、该方向上的相邻音（用来算可用空隙）
            var nb = null;
            for (var q = 0; q < digits.length; q++) {
              var o = digits[q];
              if (o === d) continue;
              if (Math.abs(o.cx - d.cx) > 1.2) continue;
              if (isUp ? (o.ink < d.ink) : (o.ink > d.ink)) {
                if (!nb || Math.abs(o.ink - d.ink) < Math.abs(nb.ink - d.ink)) nb = o;
              }
            }

            if (ds.length === 1) {
              // 单点：只修「压在别人笔画里」的情况，挪到两个音中间的空白
              var hit = null;
              var touch = (JP_DIGIT_HALF + JP_DOT_HALF) * hh + 0.6;
              for (var t = 0; t < digits.length; t++) {
                var g2 = digits[t];
                if (g2 === d || Math.abs(g2.cx - ds[0].cx) > 1.2) continue;
                if (Math.abs(ds[0].ink - g2.ink) <= touch) hit = g2;
              }
              if (hit && Math.abs(d.ink - hit.ink) >= 6) {
                var mv = (hit.ink + d.ink) / 2 - ds[0].ink;
                if (Math.abs(mv) > 0.4) ds[0].el.style.marginTop = (ds[0].cur + mv).toFixed(2) + 'px';
              }
              continue;
            }

            // 多个点：**按导出位置原样保留**（和 sparks 导出的 -简谱.html 逐点一致：
            // 第 1 个点在数字下方 0.172em，之后每多一个八度再 +0.115em）。
            // 只有真的叠在一起（墨迹之间不到 0.3px）才把后面的点往外推一点点，
            // 保证「有几个八度就看得见几个点」，绝不改第一个点的位置。
            var sorted = ds.slice().sort(function (a, b) { return a.ink - b.ink; });
            var dotH2 = 2 * (JP_DOT_HALF * hh);
            var minGap = Math.max(0.3, 0.02 * hh);
            var prevInk = null;
            for (var p = 0; p < sorted.length; p++) {
              var target = sorted[p].ink;
              if (prevInk !== null && target < prevInk + dotH2 + minGap) {
                target = prevInk + dotH2 + minGap;
              }
              var move = target - sorted[p].ink;
              if (Math.abs(move) >= 0.05) {
                sorted[p].el.style.marginTop = (sorted[p].cur + move).toFixed(2) + 'px';
              }
              prevInk = target;
            }
          }
        }
      }

      var curGroup = 0, curNoteGeo = null;

      // MusicXML 音符下标 → SVG 音符下标。
      // 以前是「全曲按比例」：floor(si * SVG总数 / 谱面总数)。
      // 只要有两个音没画出来（这次 314 → 310），从缺音处往后整首歌的框都会差一个音，
      // 第 8 小节以后就明显「框不落在音符上」。
      // 现在改成：先把小节按「每行音符数」分给 9 行（DP 最小误差），
      // 再在每一行内部按比例定位——误差只可能留在那一行里，不会顺延到下一行。
      var svgScoreMap = null;
      var svgToScore = null;              // SVG 下标 → MusicXML 下标（反查，取第一个）
      function buildSvgScoreMap() {
        svgScoreMap = null;
        svgToScore = null;
        try {
          if (!flowReady || !score || !score.notes || !score.notes.length || !blocks.length) return;
          var n = score.notes.length, i, m, b, p;
          var counts = {}, maxM = 0;
          for (i = 0; i < n; i++) {
            var mm = score.notes[i].measure | 0;
            counts[mm] = (counts[mm] || 0) + 1;
            if (mm > maxM) maxM = mm;
          }
          var ms = [];
          for (m = 0; m <= maxM; m++) ms.push(counts[m] || 0);
          var nb = blocks.length, M = ms.length;
          if (nb < 1 || M < nb) return;               // 小节比行还少：没法分，退回按比例

          var pref = [0];
          for (m = 0; m < M; m++) pref.push(pref[m] + ms[m]);

          // dp[b][m]：前 b 行正好覆盖前 m 个小节的最小「音符数误差」
          var dp = [], from = [];
          for (b = 0; b <= nb; b++) {
            var row = [], rowF = [];
            for (m = 0; m <= M; m++) { row.push(Infinity); rowF.push(-1); }
            dp.push(row); from.push(rowF);
          }
          dp[0][0] = 0;
          for (b = 1; b <= nb; b++) {
            var want = blocks[b - 1].noteCount | 0;
            for (m = b; m <= M - (nb - b); m++) {     // 每行至少 1 个小节，后面的行也要留够
              for (p = b - 1; p < m; p++) {
                if (dp[b - 1][p] === Infinity) continue;
                var cost = dp[b - 1][p] + Math.abs((pref[m] - pref[p]) - want);
                if (cost < dp[b][m]) { dp[b][m] = cost; from[b][m] = p; }
              }
            }
          }
          if (dp[nb][M] === Infinity) return;

          var cuts = [M];
          for (b = nb; b >= 1; b--) cuts.unshift(from[b][cuts[0]]);

          var map = new Array(n);
          for (i = 0; i < n; i++) map[i] = -1;
          var bs = 0;
          for (b = 0; b < nb; b++) {
            var m0 = cuts[b], m1 = cuts[b + 1];
            var s0 = pref[m0], s1 = pref[m1];
            var cv = blocks[b].noteCount | 0, cs = s1 - s0;
            // 这一行在「MusicXML 谱面」和「SVG」里各自的音符区间。
            // 简谱高亮那边要按 score.notes 取音，必须用 scoreFrom/scoreTo，
            // 不能再用 noteFrom/noteTo（那是 svgFlat 的下标）。
            blocks[b].scoreFrom = s0;
            blocks[b].scoreTo = s1;
            blocks[b].mFrom = m0;
            blocks[b].mTo = m1 - 1;
            if (cv > 0 && cs > 0) {
              var bx0 = blocks[b].barXs || [];
              var useBars = (bx0.length >= 2 && (bx0.length - 1) === (m1 - m0));
              if (useBars) {
                // 精确：先按真实小节线把 SVG 音符分到各小节，再在小节内对号入座。
                // 这样某一行少画了几个音（本曲第 7、8 行各少 2 个）也只会影响那几个小节，
                // 不会像按行比例那样把误差带到整行。
                var localM = [], q0;
                for (q0 = 0; q0 < cv; q0++) {
                  var xk = svgFlat[bs + q0] ? svgFlat[bs + q0].x : 0;
                  var jj = 0;
                  for (var qi = 1; qi < bx0.length; qi++) { if (xk >= bx0[qi] - 1) jj = qi; }
                  localM.push(Math.min(jj, bx0.length - 2));
                }
                for (m = m0; m < m1; m++) {
                  var rel = m - m0;
                  var svgIdx = [], scIdx = [], q1;
                  for (q1 = 0; q1 < cv; q1++) { if (localM[q1] === rel) svgIdx.push(bs + q1); }
                  for (q1 = pref[m]; q1 < pref[m + 1]; q1++) scIdx.push(q1);
                  if (!svgIdx.length) continue;
                  for (q1 = 0; q1 < scIdx.length; q1++) {
                    var kk2 = (scIdx.length === svgIdx.length) ? q1
                      : Math.min(svgIdx.length - 1, Math.round(q1 * (svgIdx.length - 1) / Math.max(1, scIdx.length - 1)));
                    map[scIdx[q1]] = svgIdx[kk2];
                  }
                }
              } else {
                // 这一行音符数正好对得上：一一对应，最准；
                // 对不上（有音符被裁掉）就在这一行内部按序号比例补，误差不会带到下一行。
                for (var s = s0; s < s1; s++) {
                  var k = (cs === cv) ? (s - s0)
                    : Math.min(cv - 1, Math.round((s - s0) * cv / cs));
                  map[s] = bs + k;
                }
              }
            }
            bs += cv;
          }
          svgScoreMap = map;
          var inv = new Array(svgFlat.length);
          for (i = 0; i < inv.length; i++) inv[i] = -1;
          for (i = 0; i < n; i++) {
            var sk = map[i];
            if (sk >= 0 && sk < inv.length && inv[sk] < 0) inv[sk] = i;
          }
          svgToScore = inv;
          try {
            console.log('[谱面映射] 每行小节 ' + cuts.slice(0, -1).map(function (c, idx) {
              return c + '-' + (cuts[idx + 1] - 1);
            }).join(' / '));
          } catch (eL) { }
        } catch (e) { svgScoreMap = null; }
      }

      function svgIndexOfScore(si) {
        if (!flowReady) return -1;
        var n = score ? score.notes.length : 0;
        if (!n) return -1;
        if (svgFlat.length === n) return si;
        if (!svgScoreMap) buildSvgScoreMap();
        if (svgScoreMap && si >= 0 && si < svgScoreMap.length && svgScoreMap[si] >= 0) {
          return svgScoreMap[si];
        }
        return Math.min(svgFlat.length - 1, Math.max(0, Math.floor(si * svgFlat.length / n)));
      }

      // SVG 音符下标 → MusicXML 音符下标。
      // 简谱高亮的入口拿到的是 SVG 下标（positionSvgCursorAt 传进来的 k），
      // 但简谱那边要用 score.notes 找音，所以这里先换回来。
      function scoreOfSvg(k) {
        var n = (score && score.notes) ? score.notes.length : 0;
        if (!n) return -1;
        if (svgFlat.length === n) return k;
        if (!svgScoreMap) buildSvgScoreMap();
        if (svgToScore && k >= 0 && k < svgToScore.length && svgToScore[k] >= 0) return svgToScore[k];
        var guess = Math.floor(k * n / Math.max(1, svgFlat.length));
        return Math.max(0, Math.min(n - 1, guess));
      }

      function clearSvgHi() {
        for (var i = 0; i < svgFlat.length; i++) {
          if (svgFlat[i].el.classList.contains('svghl')) svgFlat[i].el.classList.remove('svghl');
        }
      }

      function ensureCursor() {
        var b = cursorEl(), host = hostEl();
        if (!b) { b = document.createElement('div'); b.id = 'svgCursor'; }
        if (host && b.parentNode !== host) host.appendChild(b);
        var j = cursorJpEl();
        if (!j) { j = document.createElement('div'); j.id = 'jpCursor'; }
        if (host && j.parentNode !== host) host.appendChild(j);
        return b;
      }




      // 从简谱分节里找出「细竖线」（= 小节线），返回它们在行宽中的比例
      function jpBarFracs(blk) {
        if (!blk) return [];
        if (blk._bars) return blk._bars;
        var inner = blk.jpEl && blk.jpEl.querySelector('div');
        if (!inner) { blk._bars = []; return []; }

        var ir = inner.getBoundingClientRect();
        if (!ir.width) return [];

        // 小节线 = SparksNMN-Bravura 字体 + 窄高的 span，
        // 横向位置在 transform 的 translateX(Nem) 里（em 是它自己字号的倍数）
        var out = [];
        var spans = inner.querySelectorAll('span');
        for (var i = 0; i < spans.length; i++) {
          var el = spans[i];
          var cs;
          try { cs = getComputedStyle(el); } catch (e) { continue; }
          if ((cs.fontFamily || '').indexOf('Bravura') < 0) continue;

          var r = el.getBoundingClientRect();
          if (r.height < ir.height * 0.15) continue;          // 太矮的肯定不是小节线

          var tr = el.style.transform || '';
          var m = /translateX\(([-\d.]+)em\)/.exec(tr);
          if (!m) continue;

          var fs = parseFloat(cs.fontSize) || 0;
          var xpx = parseFloat(m[1]) * fs;                    // → 像素
          if (!isFinite(xpx)) continue;
          out.push(xpx / ir.width);
        }

        out.sort(function (a, b) { return a - b; });
        // 去掉几乎重合的
        var uniq = [];
        for (var k = 0; k < out.length; k++) {
          if (!uniq.length || out[k] - uniq[uniq.length - 1] > 0.01) uniq.push(out[k]);
        }

        blk._bars = uniq;
        try {
          if (uniq.length) console.log('[简谱小节线] 第 ' + (blk.page + 1) + '页 第 ' + (blk.sys + 1) +
            '组：' + uniq.length + ' 条 ' + uniq.map(function (f) { return f.toFixed(3); }).join(' '));
        } catch (e) { }
        return uniq;
      }

      // 这一组简谱行在 MusicXML 谱面里的音符区间（[scoreFrom, scoreTo)）。
      // 旧代码用 blk.noteFrom/noteTo —— 那是 svgFlat 的下标，和 score.notes 不是一套；
      // 谱面音符数和 SVG 音符数不同时（本曲 314 vs 310），从缺音处起简谱就会错位。
      function blkScoreRange(blk) {
        if (!blk) return [0, 0];
        var a = (typeof blk.scoreFrom === 'number') ? blk.scoreFrom : (blk.noteFrom || 0);
        var b = (typeof blk.scoreTo === 'number') ? blk.scoreTo : (blk.noteTo || 0);
        return [a | 0, b | 0];
      }

      // score 下标 → 所在的五线谱块下标（-1 表示没有）
      function blockOfScore(si) {
        if (!blocks || si < 0) return -1;
        for (var i = 0; i < blocks.length; i++) {
          var rg = blkScoreRange(blocks[i]);
          if (si >= rg[0] && si < rg[1]) return i;
        }
        return -1;
      }

      // 当前小节在本组简谱行里的横向起止比例（按小节均分）
      function measureSpan(blk, idx) {
        try {
          var rng = blkScoreRange(blk);
          if (score && score.notes && blk && idx >= rng[0] && idx < rng[1]) {
            var a = score.notes[rng[0]];
            var b = score.notes[rng[1] - 1];
            var cur = score.notes[idx];
            if (a && b && cur && b.measure >= a.measure) {
              var n = b.measure - a.measure + 1;
              var mi = Math.max(0, Math.min(n - 1, cur.measure - a.measure));

              // 优先用真实小节线，但必须【正好】 n+1 条边界，
              // 否则说明漏检/多检了，用错位的相邻两条会跨两个小节。
              var bars = jpBarFracs(blk);
              // 常见情况：只检出 n 条（各小节右边界），最左边那条是括号、被过滤
              // → 用等间距推出来补上
              if (bars && bars.length === n && n > 0) {
                var stepB = (bars.length > 1) ? (bars[1] - bars[0]) : (1 / n);
                var lead = Math.max(0, bars[0] - stepB);
                bars = [lead].concat(bars);
              }
              if (bars && bars.length === n + 1) {
                return [bars[mi], bars[mi + 1]];
              }
              if (bars && bars.length !== n + 1) {
                try {
                  console.log('[简谱小节线] 第 ' + (blk.page + 1) + ' 页第 ' + (blk.sys + 1) +
                    ' 组：检测到 ' + bars.length + ' 条，应为 ' + (n + 1) + ' 条 → 退回均分');
                } catch (e) { }
              }
              return [mi / n, (mi + 1) / n];
            }
          }
        } catch (e) { }
        return [0, 1];
      }

      // 当前音符在本组内的横向比例：优先按时间(ts)，退化才按序号
      function groupFrac(blk, idx) {
        try {
          var rng = blkScoreRange(blk);
          if (score && score.notes && blk && idx >= rng[0] && idx < rng[1]) {
            var a = score.notes[rng[0]];
            var b = score.notes[rng[1] - 1];
            var cur = score.notes[idx];
            if (a && b && cur && b.ts > a.ts) {
              var f = (cur.ts - a.ts) / (b.ts - a.ts);
              return Math.max(0, Math.min(1, f));
            }
          }
        } catch (e) { }
        var r2 = blkScoreRange(blk);
        if (r2[1] > r2[0]) {
          return Math.max(0, Math.min(1, (idx - r2[0]) / (r2[1] - r2[0])));
        }
        return 0.5;
      }

      // ================= 简谱播放框：跟着音符走 =================
      // efData 里每个音符除了数字本身，还有一个隐藏的 SparksNMN-notehl-<uuid> 方块
      // （demo 播放时点亮的也是它）。这些方块就是音符在简谱行里的锚点：
      // 拿它定位，播放框能一个音符一个音符地走，而不必按小节均分
      // （小节线检测失败时，均分会让整行的框都错位）。
      var jpAnchorsCache = { blk: null, w: 0, list: [] };
      var jpHiNow = [];               // 当前点亮的简谱音符方块
      var flowScrollToken = 0;        // 滚动动画令牌：新的一次滚动会作废上一次

      function jpInner(blk) {
        if (!blk || !blk.jpEl) return null;
        // efData 经常把一条简谱线拆成好几个 DomPaint 根 div（第二段的和弦层就在另一个 div 里），
        // 只取第一个 div 会漏掉整段锚点。这里统一用整块的容器当参照，
        // 收集方块、算横向比例都用同一个矩形，坐标才自洽。
        return blk.jpEl;
      }

      // 收集一组简谱行里的音符锚点，按横向位置排序
      function jpNoteAnchors(blk) {
        var inner = jpInner(blk);
        if (!inner) return [];
        var ir = inner.getBoundingClientRect();
        if (!ir.width) return [];
        if (jpAnchorsCache.blk === blk && Math.abs(jpAnchorsCache.w - ir.width) < 0.5) {
          return jpAnchorsCache.list;
        }
        var els = inner.querySelectorAll('.SparksNMN-notehl');
        var list = [], i;
        for (i = 0; i < els.length; i++) {
          var r = els[i].getBoundingClientRect();
          if (r.width < 1 || r.height < 1) continue;
          var vis = '', snd = true;
          try {
            var csA = getComputedStyle(els[i]);
            vis = (csA.visibility === 'hidden') ? 'hidden' : '';
            // 发声音符的高亮块是彩色（rgb(r,g,b)）；休止 0、延长 - 是灰色，不能算进音高对应里
            var mbg = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(csA.backgroundColor || '');
            if (mbg) {
              var cr = +mbg[1], cg = +mbg[2], cb = +mbg[3];
              if (Math.abs(cr - cg) < 2 && Math.abs(cg - cb) < 2) snd = false;
            }
          } catch (e) { }
          list.push({
            el: els[i],
            cx: (r.left - ir.left) + r.width / 2,
            top: r.top,
            row: (function (cn) { var m0 = /notehl-(\d+)-/.exec(cn || ''); return m0 ? m0[1] : ''; })(els[i].className),
            w: r.width,
            vis: vis,
            snd: snd,
            op0: els[i].style.opacity,
            flt0: els[i].style.filter
          });
        }
        // 同一列（和弦）里简谱是从上往下画：高音在上、低音在下，所以同 cx 时按 top 升序。
        list.sort(function (a, b) { return (a.cx - b.cx) || (a.top - b.top); });
        // 相邻音符列的间距（取中位数）：用来把播放高亮限制在「当前这一列」
        var gaps = [], gi;
        for (gi = 1; gi < list.length; gi++) {
          var gd = list[gi].cx - list[gi - 1].cx;
          if (gd > 0.5) gaps.push(gd);
        }
        gaps.sort(function (a, b) { return a - b; });
        var gap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0;
        var sndList = [];
        for (i = 0; i < list.length; i++) {
          if (list[i].snd) sndList.push(list[i]);
        }
        if (!sndList.length) sndList = list.slice();
        jpAnchorsCache = { blk: blk, w: ir.width, list: list, snd: sndList, gap: gap };
        return list;
      }

      // 当前音符在本组简谱行里的横向范围（占行宽的比例）
      function jpBoxFrac(blk, k) {
        var a = jpAnchorFor(blk, k);
        var inner = jpInner(blk);
        var ir = inner ? inner.getBoundingClientRect() : null;
        if (a && ir && ir.width > 0) {
          var w = Math.max(a.w, ir.width * 0.022);
          return [
            Math.max(0, (a.cx - w / 2) / ir.width),
            Math.min(1, (a.cx + w / 2) / ir.width)
          ];
        }
        // 旧版 efData 没有高亮方块：退回按组内时间比例，框宽取一个音符的估计值
        var fr = groupFrac(blk, k);
        var rng0 = blkScoreRange(blk);
        var cnt = rng0[1] - rng0[0];
        if (!(cnt > 0)) cnt = blk.noteCount || 1;
        var half = 0.42 / Math.max(1, cnt);
        return [Math.max(0, fr - half), Math.min(1, fr + half)];
      }

      // 简谱播放高亮统一用一种颜色：efData 给每个音级配了不同底色（7 粉 / 2 橙 / 6 紫 …），
      // 一屏十几块同时亮时花花绿绿、反而看不清「现在弹的是哪一格」。
      // 现在所有音符都用这一个色，只靠位置表示「正在响」。
      // 白字压在这个蓝上对比度 ≈4.6:1，缩到成片里也还看得清。
      var JP_HI_COLOR = '#2f81f7';

      // 点亮 / 熄灭当前音符（demo 的播放高亮用的就是这些 notehl 方块）
      function jpHiReset(keep) {
        var i;
        for (i = 0; i < jpHiNow.length; i++) {
          var old = jpHiNow[i];
          if (keep && keep.indexOf(old) >= 0) continue;
          try {
            // 熄灭用「规范态」而不是回放当初记下的值：锚点缓存有可能是在
            // 这一块正亮着的时候建立的，那记下来的「原值」本身就是亮（visible/0.9），
            // 回放它等于永远熄灭不了 —— 成片里就会越积越多块高亮。
            old.el.style.visibility = 'hidden';
            old.el.style.opacity = '';
            old.el.style.filter = '';
            // 底色也要还原成 efData 自带的那份（点亮时被换成了高饱和版）
            if (old.el.dataset && old.el.dataset.jpBase) {
              old.el.style.backgroundColor = old.el.dataset.jpBase;
              old.el.dataset.jpBase = '';
            }
            old.el.classList.remove('jpHit');
          } catch (e) { }
        }
        jpHiNow = keep ? keep.slice() : [];
        for (i = 0; i < jpHiNow.length; i++) {
          try {
            var elH = jpHiNow[i].el;
            elH.style.visibility = 'visible';
            // 高亮要「一眼看见」：不透明 + 统一的强调色（原来每级一个淡粉/淡橙，
            // 在浅色谱面上几乎和数字融在一起，而且花花绿绿）。
            // 只在这一块第一次点亮时换色，之后每帧只切 visibility，避免反复写样式。
            if (elH.dataset && !elH.dataset.jpBase) {
              elH.dataset.jpBase = elH.style.backgroundColor || '';
              elH.style.backgroundColor = JP_HI_COLOR;
            }
            elH.style.opacity = '1';
            elH.style.filter = 'saturate(1.1)';
            // 同一列连续两下时也要重新触发脉动
            if (elH.classList.contains('jpHit')) {
              elH.classList.remove('jpHit');
              void elH.offsetWidth;
            }
            elH.classList.add('jpHit');
          } catch (e2) { }
        }
      }

      // 相邻音符列的间距（中位数），播放框宽度与高亮容差都用它
      function jpGap(blk) {
        jpNoteAnchors(blk);
        return (jpAnchorsCache.blk === blk && jpAnchorsCache.gap) ? jpAnchorsCache.gap : 0;
      }

      // 只取「发声音符」的锚点：休止 0 / 延长 - 的灰色块不参与音高对应，
      // 否则第一小节开头几个 0 会让整行的高亮整体后移（五线谱对不上简谱）。
      function jpSounding(blk) {
        var all = jpNoteAnchors(blk);
        if (!all.length) return [];
        var snd = (jpAnchorsCache.blk === blk) ? jpAnchorsCache.snd : null;
        return (snd && snd.length) ? snd : all;
      }

      // 简谱里的「声部带」：把发声方块按纵向 y 聚成带，自上而下就是声部顺序。
      // 简谱里一个声部可能被拆成好几段 DomPaint（类名里的行号 A 会变），
      // 但每段内部仍是「上下两行」：上=右手、下=左手。所以：
      //   1) 先按行号 A 分「行」；
      //   2) 把 x 范围相接的行归成同一段；
      //   3) 段内按纵向 y 排序 → 第 1 行是 part0、第 2 行是 part1；
      //   4) 同名次的行跨段拼接，段内按 x 排 = 这个声部整行的时顺序。
      var jpPartCache = { blk: null, w: 0, parts: null };
      function jpPartAnchors(blk) {
        var inner = jpInner(blk), ir = inner ? inner.getBoundingClientRect() : null;
        if (!ir || !ir.width) return [];
        if (jpPartCache.blk === blk && Math.abs(jpPartCache.w - ir.width) < 0.5 && jpPartCache.parts) {
          return jpPartCache.parts;
        }
        var list = jpSounding(blk), byRow = {}, i, a, rid;
        for (i = 0; i < list.length; i++) {
          a = list[i];
          rid = a.row || 'x';
          if (!byRow[rid]) byRow[rid] = { id: rid, list: [], top: 0 };
          byRow[rid].list.push(a);
        }
        var rows = [], k;
        for (rid in byRow) {
          if (!byRow.hasOwnProperty(rid)) continue;
          var rr = byRow[rid], sum = 0;
          rr.list.sort(function (p, q) { return p.cx - q.cx; });
          for (i = 0; i < rr.list.length; i++) sum += rr.list[i].top;
          rr.top = sum / Math.max(1, rr.list.length);
          rr.x0 = rr.list[0].cx;
          rr.x1 = rr.list[rr.list.length - 1].cx;
          rows.push(rr);
        }
        rows.sort(function (p, q) { return p.x0 - q.x0; });
        var segs = [], cur = null;
        for (i = 0; i < rows.length; i++) {
          if (!cur || rows[i].x0 - cur.x1 > 20) { cur = { x0: rows[i].x0, x1: rows[i].x1, rows: [] }; segs.push(cur); }
          cur.rows.push(rows[i]);
          if (rows[i].x1 > cur.x1) cur.x1 = rows[i].x1;
        }
        var parts = [], s;
        for (s = 0; s < segs.length; s++) {
          segs[s].rows.sort(function (p, q) { return p.top - q.top; });
          for (k = 0; k < segs[s].rows.length; k++) {
            if (!parts[k]) parts[k] = { top: segs[s].rows[k].top, list: [] };
            parts[k].list = parts[k].list.concat(segs[s].rows[k].list);
          }
        }
        for (k = 0; k < parts.length; k++) {
          parts[k].list.sort(function (p, q) { return p.cx - q.cx; });
          for (i = 0; i < parts[k].list.length; i++) parts[k].list[i]._partList = parts[k].list;
        }
        try {
          window.__jpRows = rows.map(function (r) {
            return { id: r.id, n: r.list.length, x0: Math.round(r.x0), x1: Math.round(r.x1), top: Math.round(r.top) };
          });
          window.__jpParts = parts.map(function (p) { return p.list.length; });
        } catch (eRows) { }
        jpPartCache = { blk: blk, w: ir.width, parts: parts };
        return parts;
      }

      // 按「声部内第几个音」对齐：同一组简谱行里，每个声部的发声方块是按时间顺序排的，
      // 数量与五线谱该声部在本组的音符数一致时，直接一一对应（最稳，不受拆行/小节号影响）。
      function jpAnchorByOrder(blk, k) {
        if (!score || !score.notes || !blk) return null;
        var rng = blkScoreRange(blk);
        if (!(k >= rng[0] && k < rng[1])) return null;
        var parts = jpPartAnchors(blk);
        if (!parts.length) return null;
        var rec = score.notes[k];
        if (!rec) return null;
        var pids = [], seen = {}, i;
        for (i = rng[0]; i < rng[1]; i++) {
          var r0 = score.notes[i];
          if (!r0) continue;
          if (!seen[r0.part]) { seen[r0.part] = 1; pids.push(r0.part); }
        }
        pids.sort(function (p, q) { return p - q; });
        var pi = pids.indexOf(rec.part);
        if (pi < 0) pi = 0;
        if (pi >= parts.length) return null;
        var part = parts[pi];
        var mine = [];
        for (i = rng[0]; i < rng[1]; i++) {
          var rr = score.notes[i];
          if (!rr || rr.part !== rec.part) continue;
          if (rr.grace) continue;          // 装饰音不占简谱的格子，序号也不能算进去
          mine.push(i);
        }
        // 和弦（同一 ts 的多个音）在简谱里是从上往下画：高音在前、低音在后，
        // 所以同 ts 时按 halfTone 降序，才能和 jp 里的顺序对上。
        mine.sort(function (p, q) {
          return (score.notes[p].ts - score.notes[q].ts) ||
                 (score.notes[q].halfTone - score.notes[p].halfTone) || (p - q);
        });
        var pos = mine.indexOf(k);
        if (pos < 0) {
          // k 本身是装饰音：挂到下一个起播音符（没有就挂上一个非装饰音）
          for (i = 0; i < mine.length; i++) if (mine[i] > k) { pos = i; break; }
          if (pos < 0) pos = mine.length - 1;
        }
        if (pos < 0) return null;
        var idx;
        if (mine.length === part.list.length) {
          idx = pos;                                  // 数量一致：一一对应
        } else if (part.list.length > 1 && mine.length > 1) {
          idx = Math.round(pos * (part.list.length - 1) / (mine.length - 1));
        } else {
          return null;                                // 数量差太多：交给小节/时间那条路
        }
        idx = Math.max(0, Math.min(part.list.length - 1, idx));
        return part.list[idx];
      }

      // 每个小节的起止 ts（四分音符）：起点 = 该小节最早的 ts，终点 = 下一小节起点。
      // 简谱高亮要在小节内按「时间比例」定位；只按整行序号比例会越走越偏（一行能差 2~3 个音）。
      var measureTsCache = null, measureTsOwner = null;

      function measureTsBounds() {
        if (!score || !score.notes || !score.notes.length) return null;
        if (measureTsCache && measureTsOwner === score) return measureTsCache;

        var n = score.measures || 0, i;
        if (n <= 0) {
          for (i = 0; i < score.notes.length; i++) {
            if (score.notes[i].measure + 1 > n) n = score.notes[i].measure + 1;
          }
        }
        var start = [], last = [], end = [];
        for (i = 0; i < n; i++) { start.push(Infinity); last.push(-Infinity); }

        for (i = 0; i < score.notes.length; i++) {
          var r = score.notes[i], m = r.measure, ts = r.ts || 0;
          if (!(m >= 0 && m < n)) continue;
          if (ts < start[m]) start[m] = ts;
          if (ts > last[m]) last[m] = ts;
        }
        for (i = 0; i < n; i++) {
          if (!isFinite(start[i])) {
            start[i] = (i > 0 && isFinite(end[i - 1])) ? end[i - 1]
              : (i > 0 ? start[i - 1] + 4 : 0);
            last[i] = start[i];
          }
        }
        for (i = 0; i < n; i++) {
          var next = Infinity, j;
          for (j = i + 1; j < n; j++) {
            if (isFinite(start[j])) { next = start[j]; break; }
          }
          end[i] = isFinite(next) ? next : (last[i] + 4);
          if (!(end[i] > start[i])) end[i] = start[i] + 4;
        }

        measureTsCache = { start: start, end: end, count: n };
        measureTsOwner = score;
        return measureTsCache;
      }

      // 本块（一行谱）里每个小节的音符下标
      function blockNotesByMeasure(blk) {
        if (blk._byMeas) return blk._byMeas;
        var out = {}, i;
        var rng = blkScoreRange(blk);
        for (i = rng[0]; i < rng[1]; i++) {
          var rec = score && score.notes ? score.notes[i] : null;
          if (!rec) continue;
          // 连音线的延续符头在简谱里也有对应的「-」块，所以这里仍然算进去
          (out[rec.measure] = out[rec.measure] || []).push(i);
        }
        blk._byMeas = out;
        return out;
      }

      // 本小节在简谱行里的锚点（按横向位置排序；和弦同 x 也各自算一列）
      function jpMeasureAnchors(blk, span) {
        var list = jpSounding(blk);
        var inner = jpInner(blk), ir = inner ? inner.getBoundingClientRect() : null;
        var out = [];
        if (!ir || !ir.width) return out;
        var lo = span[0] - 0.012, hi = span[1] + 0.012, i;
        for (i = 0; i < list.length; i++) {
          var f = list[i].cx / ir.width;
          if (f < lo || f > hi) continue;
          out.push({ a: list[i], frac: f });
        }
        out.sort(function (p, q) { return p.frac - q.frac; });
        return out;
      }

      // 音符 k 在简谱行里的目标横向比例（0~1）
      function jpNoteFrac(blk, k) {
        var rng = blkScoreRange(blk);
        var n = rng[1] - rng[0];
        var fallback = n > 0 ? Math.max(0, Math.min(1, (k - rng[0] + 0.5) / n)) : 0.5;
        if (!score || !score.notes || !blk) return fallback;
        if (k < rng[0] || k >= rng[1]) return fallback;
        var rec = score.notes[k];
        if (!rec) return fallback;

        var sp = measureSpan(blk, k);
        if (!sp || !(sp[1] > sp[0])) return fallback;

        // ① 本小节「音符数 == 简谱锚点数」→ 按顺序一一对应。
        //    每行开头都有「1=F」之类的前缀，按比例算会整体偏左，这种情况必须一一对应。
        var list = blockNotesByMeasure(blk)[rec.measure] || [];
        var cols = jpMeasureAnchors(blk, sp);
        var pos = list.indexOf(k);
        if (pos >= 0 && list.length > 0 && cols.length === list.length) {
          return cols[pos].frac;
        }

        // ② 数量不一致 → 用音符在「本小节谱面里的相对位置」换到简谱这一小节。
        //    谱面排版本身带音值间距，按它换算比按序号/纯时间更贴合眼睛看到的位置。
        var cols2 = cols;
        if (cols2.length && list.length > 1) {
          var p = list.indexOf(k);
          if (p >= 0) {
            // 这里的 list / k 都是 score 下标，svgFlat 要的是 SVG 下标 → 先换算。
            var a0 = svgFlat[svgIndexOfScore(list[0])];
            var a1 = svgFlat[svgIndexOfScore(list[list.length - 1])];
            var ac = svgFlat[svgIndexOfScore(k)];
            if (a0 && a1 && ac && a1.x > a0.x + 1) {
              var fx = (ac.x - a0.x) / (a1.x - a0.x);
              fx = Math.max(0, Math.min(1, fx));
              return cols2[0].frac + (cols2[cols2.length - 1].frac - cols2[0].frac) * fx;
            }
          }
        }

        // ③ 再不行就按小节内时间(ts)比例
        var bound = measureTsBounds();
        if (!bound) return fallback;
        var ts0 = bound.start[rec.measure], ts1 = bound.end[rec.measure];
        if (!isFinite(ts0) || !isFinite(ts1) || ts1 <= ts0) return fallback;

        var f = (rec.ts - ts0) / (ts1 - ts0);
        f = Math.max(0, Math.min(1, f));
        return sp[0] + (sp[1] - sp[0]) * f;
      }

      // ===== 简谱「行 / 列」结构化布局：让每个音符精确落进自己那一格 =====
      // efData 里每个音符方块的类名是 SparksNMN-notehl-<A>-<B>-<C>：
      //   A = 简谱的哪一行（一个声部一行，同一组里唯一，不重复）
      //   B = 该行内第几小节（0..3）
      //   C = 该行该小节里的第几格（数字、延音 - 、休止 0 各占自己的格号）
      // 以前把两行的方块混在一个池子里按 x 排序、再用容差去凑，双手同拍时会被对方顶掉；
      // 这里改成：按 A 分行 → 声部序号对应行 → 在「本行本小节」里用非灰色格依次对齐音符。
      var jpLayoutCache = { blk: null, w: 0, data: null };

      function jpLayoutReset() { jpLayoutCache = { blk: null, w: 0, data: null }; }

      function jpLayout(blk) {
        if (!blk || !blk.jpEl) return null;
        var inner = jpInner(blk);
        if (!inner) return null;
        var ir = inner.getBoundingClientRect();
        if (!ir.width || !ir.height) return null;
        if (jpLayoutCache.blk === blk && Math.abs(jpLayoutCache.w - ir.width) < 0.5) return jpLayoutCache.data;

        // 锚点可能散在多个 DomPaint 根 div 里（和弦层常常单独一层），所以扫整个 jpEl
        var els = blk.jpEl.querySelectorAll('.SparksNMN-notehl');
        var rows = {}, i, j, key;
        for (i = 0; i < els.length; i++) {
          var el = els[i];
          var r = el.getBoundingClientRect();
          if (r.width < 1 || r.height < 1) continue;
          var m = /notehl-(\d+)-(\d+)-(\d+)/.exec(String(el.className || ''));
          if (!m) continue;
          var rid = m[1], sys = +m[2], seq = +m[3];
          // 数字就在方块的下一个兄弟节点上（efData 按「方块 + 数字」成对输出）
          var dig = '';
          try {
            var nx = el.nextElementSibling;
            if (nx && nx.tagName === 'SPAN') {
              var tx = String(nx.textContent || '').replace(/\s+/g, '');
              if (/^[0-9]$/.test(tx)) dig = tx;
            }
          } catch (eD) { }
          // 背景色是音级配色；灰色（r≈g≈b）= 休止 0 / 延音 - ，不是新的发声点
          var gray = true;
          try {
            var mbg = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(getComputedStyle(el).backgroundColor || '');
            if (mbg) gray = Math.abs(+mbg[1] - +mbg[2]) < 2 && Math.abs(+mbg[2] - +mbg[3]) < 2;
          } catch (eG) { }
          var row = rows[rid] || (rows[rid] = { id: rid, top: 1e9, cols: {} });
          if (r.top < row.top) row.top = r.top;
          var col = {
            el: el, rowId: rid, sys: sys, seq: seq, dig: dig, gray: gray,
            cx: (r.left - ir.left) + r.width / 2, w: r.width, snd: !gray
          };
          (row.cols[sys] = row.cols[sys] || []).push(col);
        }

        var rowList = [];
        for (key in rows) rowList.push(rows[key]);
        if (!rowList.length) { jpLayoutCache = { blk: blk, w: ir.width, data: null }; return null; }
        rowList.sort(function (a, b) { return a.top - b.top; });
        for (i = 0; i < rowList.length; i++) {
          for (j in rowList[i].cols) {
            rowList[i].cols[j].sort(function (a, b) { return a.seq - b.seq; });
          }
        }

        // 声部 → 行：简谱行自上而下 = 声部按编号从小到大
        var partIds = [], seenP = {};
        var base = Infinity;
        var lr = blkScoreRange(blk);
        for (i = lr[0]; i < lr[1]; i++) {
          var rec = score && score.notes ? score.notes[i] : null;
          if (!rec) continue;
          if (!seenP[rec.part]) { seenP[rec.part] = 1; partIds.push(rec.part); }
          if (rec.measure < base) base = rec.measure;
        }
        partIds.sort(function (a, b) { return a - b; });
        var partRow = {};
        for (i = 0; i < partIds.length; i++) {
          partRow[partIds[i]] = Math.min(i, rowList.length - 1);
        }
        // 本行范围内的音符，按 (声部|小节) 归组并保持时间顺序（装饰音留在原位，取列时避开）
        var partNotes = {};
        for (i = lr[0]; i < lr[1]; i++) {
          var rn = score && score.notes ? score.notes[i] : null;
          if (!rn) continue;
          var pk = rn.part + '|' + rn.measure;
          (partNotes[pk] = partNotes[pk] || []).push(i);
        }
        for (key in partNotes) {
          partNotes[key].sort(function (a, b) {
            var ra = score.notes[a], rb = score.notes[b];
            return (ra.ts - rb.ts) || (a - b);
          });
        }

        var data = { w: ir.width, base: base, rows: rowList, partRow: partRow, partNotes: partNotes };
        jpLayoutCache = { blk: blk, w: ir.width, data: data };
        return data;
      }

      // 某个音符在简谱里的那一格：本声部这一行、本小节的第几格
      function jpAnchorOf(blk, k) {
        var lay = jpLayout(blk);
        if (!lay || !score || !score.notes) return null;
        var rec = score.notes[k];
        if (!rec) return null;
        var ri = lay.partRow[rec.part];
        var row = (ri === undefined) ? null : lay.rows[ri];
        if (!row) return null;
        var cols = row.cols[rec.measure - lay.base];
        if (!cols || !cols.length) return null;
        // 只有非灰色格才是真正的音符（灰色是延音 - / 休止 0 的占位）
        var pool = [], i;
        for (i = 0; i < cols.length; i++) if (!cols[i].gray) pool.push(cols[i]);
        if (!pool.length) pool = cols;

        var list = lay.partNotes[rec.part + '|' + rec.measure] || [];
        var atk = [], pos = -1;
        for (i = 0; i < list.length; i++) {
          var rr = score.notes[list[i]];
          if (!rr || rr.grace) continue;       // 装饰音不占简谱的格子
          atk.push(list[i]);
          if (list[i] === k) pos = atk.length - 1;
        }
        if (pos < 0) {
          // 装饰音：挂到下一个起播音符的格子（没有就挂上一个）
          for (i = 0; i < atk.length; i++) if (atk[i] > k) { pos = i; break; }
          if (pos < 0) pos = atk.length - 1;
        }
        if (pos < 0) pos = 0;
        var ci;
        if (atk.length === pool.length) {
          ci = pos;                             // 音符数与格子数一致：一一对应
        } else if (atk.length > 1 && pool.length > 1) {
          // 谱面把颤音/重复音并成一格，或者多出装饰音：按序号等距摊到这些格子上
          ci = Math.round(pos * (pool.length - 1) / (atk.length - 1));
        } else {
          ci = 0;
        }
        ci = Math.max(0, Math.min(pool.length - 1, ci));
        return pool[ci];
      }

      // 第 k 个音符对应的简谱锚点：先在本小节里找最接近目标比例的一列，
      // 本小节没有锚点时才退回整行（和弦 / 多声部的锚点 x 相同，jpHighlightAt 统一点亮）
      function jpAnchorFor(blk, k) {
        // jp2 行有精确的 si→列 锚点，直接走它，绕开 efData 的声部/比例启发式。
        if (blk && blk.jp2) return jp2AnchorFor(blk, k);
        // 先走「声部内按顺序」这条路：本曲有两条简谱线各少 2 个音，
        // 靠小节号/比例都会偏，按声部顺序反而最准。
        var byOrder = null;
        try { byOrder = jpAnchorByOrder(blk, k); } catch (eOr) { byOrder = null; }
        if (byOrder) return byOrder;
        var exact = null;
        try { exact = jpAnchorOf(blk, k); } catch (eEx) { exact = null; }
        if (exact) return exact;
        var list = jpSounding(blk);
        if (!list.length) return null;
        var inner = jpInner(blk), ir = inner ? inner.getBoundingClientRect() : null;
        if (!ir || !ir.width) return list[0];
        var frac = jpNoteFrac(blk, k);

        var pool = list, i;
        var sp = (score && score.notes) ? measureSpan(blk, k) : null;
        if (sp && sp[1] > sp[0]) {
          var cols = jpMeasureAnchors(blk, sp);
          if (cols.length) {
            pool = [];
            for (i = 0; i < cols.length; i++) pool.push(cols[i].a);
          }
        }

        var best = null, bestD = Infinity;
        for (i = 0; i < pool.length; i++) {
          var d = Math.abs(pool[i].cx / ir.width - frac);
          if (d < bestD) { bestD = d; best = pool[i]; }
        }
        return best || list[0];
      }

      // 同一个 x、同一行上的所有方块 = 这一拍竖排的和弦，应当一起点亮；
      // 另一只手哪怕拍点相同也在别的行里，不参与。
      function jpColumnAt(blk, a) {
        var out = [];
        if (!a) return out;
        out.push(a);
        var lay = null, i, j, cols;
        try { lay = (jpLayoutCache.blk === blk) ? jpLayoutCache.data : jpLayout(blk); } catch (eC) { lay = null; }
        if (!lay || !a.rowId) return out;
        for (i = 0; i < lay.rows.length; i++) {
          if (lay.rows[i].id !== a.rowId) continue;
          cols = lay.rows[i].cols[a.sys];
          if (!cols) continue;
          for (j = 0; j < cols.length; j++) {
            if (Math.abs(cols[j].cx - a.cx) <= 2 && out.indexOf(cols[j]) < 0) out.push(cols[j]);
          }
        }
        return out;
      }

      function jpHighlightAt(blk, k, siLead) {
        // 传进来的 k 是 SVG 音符下标；简谱这边全都按 score.notes 取音。
        // 播放时优先用外面给的原始 score 下标（siLead）：SVG 下标经反查数组会落到
        // 重复映射的另一个音上（本曲 map 有 4 处重号），差一个音就会点错格子。
        var sk = (typeof siLead === 'number' && siLead >= 0) ? siLead : scoreOfSvg(k);
        if (sk < 0) { jpHiReset([]); return; }
        var a = jpAnchorFor(blk, sk);
        if (!a) { jpHiReset([]); return; }
        try {
          window.__jpLast = {
            k: k, sk: sk, cx: Math.round(a.cx), top: Math.round(a.top),
            band: Math.round(a.top),
            dig: a.el && a.el.nextElementSibling ? String(a.el.nextElementSibling.textContent || '').trim() : ''
          };
        } catch (eJL) { }
        var group = [a];
        var list = a._partList || null;
        if (list && list.length) {
          group = [];
          for (var i = 0; i < list.length; i++) {
            if (Math.abs(list[i].cx - a.cx) <= 2) group.push(list[i]);
          }
          if (!group.length) group = [a];
        }
        jpHiReset(group);
      }

      // 熄灭简谱高亮（换曲 / 重播 / 出错时用）
      function clearJpHi() {
        try { jpHiReset([]); } catch (e) { }
      }

      // 让当前这一组（五线谱 + 简谱）留在可视区：只有跑出视野才滚，并且带缓动
      function smoothScrollWrap(target) {
        var wrap = wrapEl();
        if (!wrap) return;
        var max = Math.max(0, wrap.scrollHeight - wrap.clientHeight);
        var top = Math.max(0, Math.min(max, Math.round(target)));
        if (Math.abs(top - wrap.scrollTop) < 2) return;

        var nowT = function () {
          return (window.performance && window.performance.now) ? window.performance.now() : (+new Date());
        };
        var token = ++flowScrollToken;
        var from = wrap.scrollTop;
        var t0 = nowT();
        var dur = 260;
        try { wrap.style.scrollBehavior = 'auto'; } catch (e) { }

        var step = function () {
          if (token !== flowScrollToken) return;
          var now = nowT();
          var p = Math.min(1, (now - t0) / dur);
          var eased = 1 - Math.pow(1 - p, 3);
          wrap.scrollTop = from + (top - from) * eased;
          if (p < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }

      function ensureBlockVisible(blk) {
        var wrap = wrapEl();
        if (!wrap || !blk || !blk.el) return;
        var viewH = wrap.clientHeight;
        if (viewH <= 0) return;
        var pad = 10;
        var top = blk.el.offsetTop;
        var bot = blk.jpEl ? (blk.jpEl.offsetTop + blk.jpEl.offsetHeight)
          : (top + blk.el.offsetHeight);
        var viewTop = wrap.scrollTop;
        // 已经完整看得见就不动，避免每换一行都晃
        if (top >= viewTop + pad && bot <= viewTop + viewH - pad) return;
        var pairH = bot - top;
        var target;
        if (pairH + pad * 2 <= viewH) {
          target = top - (viewH - pairH) / 2;      // 一整组装得下：居中
        } else if (window.KB_SCROLL_SYSTEM) {
          target = top - pad;                      // 装不下且要跟谱面：从五线谱顶部开始
        } else {
          target = bot - viewH + pad;              // 装不下：优先保证简谱行可见
        }
        smoothScrollWrap(target);
      }

      // ---------------- 播放时的谱面滚动（按时间连续驱动） ----------------
      // 以前是「当前这一组跑出视野了 → 260ms 内滚过去」，扫到行尾时会突然一窜，很硬。
      // 现在把「每行该停在哪」算成一条时间轴，提前一点开始缓动：快到下一行时慢慢往上滚，
      // 到下一行的第一个音正好滚到位。第一行不动（保持 scrollTop=0），最后一行之后也不动。
      var scPlanCache = null;

      function scPairBox(b) {
        if (!b || !b.el) return null;
        var wrap = wrapEl();
        if (!wrap) return null;
        var st = wrap.scrollTop || 0;
        var wr = wrap.getBoundingClientRect();
        var er = b.el.getBoundingClientRect();
        var br = (b.jpEl || b.el).getBoundingClientRect();
        return { top: (er.top - wr.top) + st, bot: (br.bottom - wr.top) + st };
      }

      // 某一行（五线谱 + 简谱）停住时希望 scrollTop 是多少
      function scTargetFor(b) {
        var wrap = wrapEl();
        var box = scPairBox(b);
        if (!wrap || !box) return 0;
        var viewH = wrap.clientHeight || 0;
        if (viewH <= 0) return 0;
        var max = Math.max(0, wrap.scrollHeight - viewH);
        var pad = 10;
        var pairH = Math.max(1, box.bot - box.top);
        var target;
        if (pairH + pad * 2 <= viewH) target = box.top - (viewH - pairH) / 2;   // 一整行装得下：居中
        else if (window.KB_SCROLL_SYSTEM) target = box.top - pad;               // 装不下：从五线谱顶开始
        else target = box.bot - viewH + pad;                                    // 装不下：优先露简谱
        return Math.max(0, Math.min(max, Math.round(target)));
      }

      // 时间轴：每一行的「第一个音的时刻」→「该行停住的 scrollTop」
      function scPlan() {
        if (!flowReady || !blocks.length || !GROUPS || !GROUPS.list) return null;
        var wrap = wrapEl();
        if (!wrap) return null;
        var key = blocks.length + '|' + (wrap.clientHeight || 0) + '|' +
          (wrap.scrollHeight || 0) + '|' + Math.round((total || 0) * 10);
        if (scPlanCache && scPlanCache.key === key) return scPlanCache.plan;

        var tb = [], bt = [], i, gi, k, b;
        for (i = 0; i < blocks.length; i++) { tb.push(-1); bt.push([]); }
        for (gi = 0; gi < GROUPS.list.length; gi++) {
          k = svgIndexOfScore(GROUPS.list[gi].lead);
          if (k < 0 || k >= svgFlat.length) continue;
          b = svgFlat[k].blk | 0;
          if (b < 0 || b >= blocks.length) continue;
          if (tb[b] < 0 || GROUPS.t[gi] < tb[b]) tb[b] = GROUPS.t[gi];
          bt[b].push(GROUPS.t[gi]);
        }
        var plan = [];
        for (i = 0; i < blocks.length; i++) {
          if (tb[i] < 0) continue;
          // 第一行不处理：从谱面抬头开始看，不要一开播就往下滚一下
          plan.push({ t: tb[i], y: (plan.length === 0 ? 0 : scTargetFor(blocks[i])), s0: 0 });
        }
        for (i = 1; i < plan.length; i++) {
          if (plan[i].t <= plan[i - 1].t) plan[i].t = plan[i - 1].t + 0.01;
        }
        // 每段滚动的起点：上一行「最后两个音符里的第一个」开始发声的时刻 ——
        // 也就是刚弹到本行倒数第二个音就开始慢慢往下一行滚，弹到最后一个音时正好到位。
        // 最后两个音挨得太近（或这行只有一个音）时，至少给 0.5 秒，别变成瞬移。
        for (i = 1; i < plan.length; i++) {
          var prevIdx = -1, lastTwo = -1, tt;
          // 找上一行：plan[i-1] 对应的块
          for (b = 0; b < blocks.length; b++) {
            if (tb[b] < 0) continue;
            if (Math.abs(tb[b] - plan[i - 1].t) < 1e-6) { prevIdx = b; break; }
          }
          if (prevIdx >= 0 && bt[prevIdx].length) {
            tt = bt[prevIdx].slice().sort(function (a, b2) { return a - b2; });
            lastTwo = tt.length >= 2 ? tt[tt.length - 2] : tt[0];
          }
          var st = (lastTwo >= 0) ? lastTwo : (plan[i].t - 0.9);
          st = Math.min(st, plan[i].t - 0.5);           // 至少 0.5 秒的滚动窗口
          if (st < plan[i - 1].t) st = plan[i - 1].t;   // 不早于上一行的起点
          plan[i].s0 = st;
        }
        scPlanCache = { key: key, plan: plan };
        return plan;
      }

      // 播放到 t 时 scrollTop 该是多少（纯函数：页面预览和离线录制共用，成片才和预览一致）
      function scrollYAt(t) {
        var plan = scPlan();
        if (!plan || !plan.length) return null;
        var i = 0, n = plan.length;
        while (i + 1 < n && plan[i + 1].t <= t) i++;
        var cur = plan[i], nxt = plan[i + 1];
        if (!nxt) return cur.y;                       // 最后一行：滚到这就停
        var T = Math.max(0.25, nxt.t - (nxt.s0 || (nxt.t - 0.9)));
        var st = nxt.t - T;
        if (t <= st) return cur.y;
        var p = (t - st) / T;
        var e = p * p * (3 - 2 * p);                  // smoothstep：起步和收尾都不生硬
        return cur.y + (nxt.y - cur.y) * e;
      }

      function applyScrollAt(t) {
        if (HORIZ) return;              // 横版镜头由 horizFollow 按 scrollLeft 跟随
        var wrap = wrapEl();
        if (!wrap) return;
        var y = scrollYAt(t);
        if (y == null) return;
        var max = Math.max(0, wrap.scrollHeight - wrap.clientHeight);
        y = Math.max(0, Math.min(max, y));
        if (Math.abs(y - (wrap.scrollTop || 0)) < 0.5) return;
        try { wrap.style.scrollBehavior = 'auto'; } catch (e) { }
        wrap.scrollTop = y;
      }

      // 版面/缩放变了就重算（块数、视口高、内容高任一变化都算）
      function resetScrollPlan() { scPlanCache = null; }

      // MIDI 音符下标 → SVG 音符下标
      // 有 MusicXML：走对齐表，对不上的音符就不显示（免得框乱跳）
      // 没有 MusicXML：按全曲进度比例落到 SVG 音符上，至少能跟着走
      function svgIndexForMidi(mi) {
        if (!flowReady || !svgFlat.length) return -1;
        if (scoreMap && scoreMap[mi] >= 0) {
          var k = svgIndexOfScore(scoreMap[mi]);
          if (k >= 0) return k;
        }
        if (score && score.notes && score.notes.length) return -1;
        if (!notes.length) return -1;
        var f = (mi + 0.5) / notes.length;
        return Math.max(0, Math.min(svgFlat.length - 1, Math.floor(f * svgFlat.length)));
      }

      function paintSvgAt(k) {
        if (k >= 0 && svgFlat[k] && svgFlat[k].el) svgFlat[k].el.classList.add('svghl');
      }

      function hideFlowCursor() {
        var a = cursorEl();
        if (a) a.style.display = 'none';
        try { clearJpHi(); } catch (e) { }
        sysNow = -1;
        jpAnchorsCache = { blk: null, w: 0, list: [] };
        try { jpLayoutReset(); } catch (eL0) { }
      }

      // 横版镜头：把播放框尽量放在可视区中间；
      // 第一小节贴左边、最后一小节贴右边（滚不动了自然如此），中间小节始终居中。
      // 换到下一行（下一列）时目标改成「整列居中」，并用更慢的缓动滑过去；
      // 行内跟随时则贴着播放框走，看起来就是从左往右平滑滚动。
      var hCamRaf = 0, hCamTgt = 0, hCamSlow = 0, hCamCol = null;
      function hCamStep() {
        var wrap = wrapEl();
        if (!wrap) { hCamRaf = 0; return; }
        var cur = wrap.scrollLeft || 0;
        var d = hCamTgt - cur;
        var ad = Math.abs(d);
        if (ad < 0.7) {
          wrap.scrollLeft = hCamTgt;
          hCamRaf = 0;
          return;
        }
        // 离得远（换行）时限速，约 720px/秒，慢慢滑过去；离得近时按比例收敛
        var maxStep = hCamSlow ? 6 : 26;
        var step = Math.min(ad, Math.max(1.2, ad * 0.22), maxStep);
        wrap.scrollLeft = cur + (d > 0 ? step : -step);
        hCamRaf = requestAnimationFrame(hCamStep);
      }
      function hCamTo(target, slow) {
        var wrap = wrapEl();
        if (!wrap) return;
        var max = Math.max(0, wrap.scrollWidth - (wrap.clientWidth || 0));
        if (target < 0) target = 0;
        if (target > max) target = max;
        hCamTgt = target;
        // 距离远就按「慢速换行」走，不管调用方怎么说，避免一屏一屏地跳过去
        hCamSlow = (slow || Math.abs(target - (wrap.scrollLeft || 0)) > 150) ? 1 : 0;
        // 录制页（rec-mode）逐帧抓画面，rAF 跟不上：直接到位，画面才不会一直停在开头
        if (document.body && document.body.classList && document.body.classList.contains('rec-mode')) {
          if (hCamRaf) { try { cancelAnimationFrame(hCamRaf); } catch (eC0) { } hCamRaf = 0; }
          wrap.scrollLeft = target;
          return;
        }
        // 手动跳很远（比如从第 1 小节直接跳到第 30 小节）就不要慢慢滑了，直接到位
        if (Math.abs(target - (wrap.scrollLeft || 0)) > (wrap.clientWidth || 0) * 1.6) {
          if (hCamRaf) { try { cancelAnimationFrame(hCamRaf); } catch (eC) { } hCamRaf = 0; }
          wrap.scrollLeft = target;
          return;
        }
        if (!hCamRaf) hCamRaf = requestAnimationFrame(hCamStep);
      }
      function horizFollow(box, isLastOfLine, nextBlk) {
        var wrap = wrapEl();
        if (!wrap || !box || box.style.display === 'none') return;
        var viewW = wrap.clientWidth || 0;
        if (viewW <= 0) return;
        // 一行一屏：镜头只负责把「当前这一列」整列摆到中间，播放框在列内自己从左往右走，
        // 镜头不再跟着播放框移动（首列会被夹到最左、末列夹到最右）。
        var curBlk = curGroup >= 0 ? blocks[curGroup] : null;
        var curCol = curBlk && curBlk.el ? curBlk.el.parentNode : null;
        if (!curCol) return;
        var target = curCol.offsetLeft + curCol.offsetWidth / 2 - viewW / 2;
        var slow = false;
        // 本行最后一小节：提前用慢速把下一列挪到中间，等它开始时正好是居中的
        if (isLastOfLine) {
          var nCol = curCol.nextElementSibling;
          if (nCol && nCol.offsetLeft > 0) {
            target = nCol.offsetLeft + nCol.offsetWidth / 2 - viewW / 2;
            slow = true;
          }
        }
        hCamTo(target, slow);
      }

      function positionSvgCursorAt(k, siLead) {
        var box = cursorEl();
        var jpBox = cursorJpEl();
        if (!flowReady || k < 0 || k >= svgFlat.length) {
          if (box) box.style.display = 'none';
          if (jpBox) jpBox.style.display = 'none';
          clearJpHi();
          return;
        }
        var it = svgFlat[k];
        var blk = blocks[it.blk];
        if (!blk) {
          if (box) box.style.display = 'none';
          if (jpBox) jpBox.style.display = 'none';
          clearJpHi();
          return;
        }

        var prevLine = curGroup;
        curGroup = it.blk;
        curNoteGeo = { x: it.x, y: it.y, blk: it.blk, idx: k };

        if (it.blk !== sysNow) {
          sysNow = it.blk;
          // 播放/录制时滚动交给 scrollYAt 连续驱动（提前缓动），这里只在暂停状态下手动换行时兜底
          if (!playing && !exporting && !HORIZ) {
            try { ensureBlockVisible(blk); } catch (eS) { }
          }
        }

        // 简谱：只点亮当前音符（不再画播放框；和五线谱各自独立，一边失败不影响另一边）
        try {
          jpHighlightAt(blk, k, siLead);
        } catch (eJp) {
          try { clearJpHi(); } catch (e2) { }
        }

        if (!box) return;
        var host = hostEl();
        var svgEl = blk.svg || blk.el.querySelector('svg');
        if (!host || !svgEl) { box.style.display = 'none'; if (jpBox) jpBox.style.display = 'none'; return; }
        var hr = host.getBoundingClientRect();
        var sr = svgEl.getBoundingClientRect();
        if (!sr.width || !sr.height) { box.style.display = 'none'; if (jpBox) jpBox.style.display = 'none'; return; }

        var kk = sr.width / blk.vbW;
        var leftC = (sr.left - hr.left) + (it.x + 16 - (blk.vbLeft || 0)) * kk;   // +16：符头中心
        var topC = (sr.top - hr.top) + (blk.staffTop - blk.vbTop) * kk;
        var botC = (sr.top - hr.top) + (blk.staffBottom - blk.vbTop) * kk;   // 五线谱框底（不再延长到简谱）
        // 简谱独立播放框：高度 = 当前小节在「所有声部」内的内容高度（跨 P1/P2 多声部，取该小节各列内容的纵向范围），
        // 每个小节各自的高度，不是整个 .flowJp 总高度；与五线谱框做颜色区分（用户要求 m01232 / m01431 / m01475）
        var jpTopC = NaN, jpBotC = NaN;
        if (blk.jp2 && blk.jpEl) {
          try {
            var siJp = (siLead != null && siLead >= 0) ? siLead : scoreOfSvg(k);
            var ancJp = (blk.jp2.bySi && siJp >= 0) ? blk.jp2.bySi[siJp] : null;
            var curMnum = null;
            if (ancJp && ancJp.col && ancJp.col.members) {
              for (var mi = 0; mi < ancJp.col.members.length; mi++) {
                if (ancJp.col.members[mi].mnum != null) { curMnum = ancJp.col.members[mi].mnum; break; }
              }
            }
            if (curMnum != null && blk.jp2.anchors) {
              var mTop = Infinity, mBot = -Infinity;
              for (var ai = 0; ai < blk.jp2.anchors.length; ai++) {
                var an = blk.jp2.anchors[ai];
                if (!an.col || !an.col.members || !an.el) continue;
                var inM = false;
                for (var mj = 0; mj < an.col.members.length; mj++) {
                  if (an.col.members[mj].mnum === curMnum) { inM = true; break; }
                }
                if (!inM) continue;
                var ar = an.el.getBoundingClientRect();
                if (ar.top < mTop) mTop = ar.top;
                if (ar.bottom > mBot) mBot = ar.bottom;
              }
              if (isFinite(mTop) && isFinite(mBot)) { jpTopC = mTop - hr.top; jpBotC = mBot - hr.top; }
            }
            if (!isFinite(jpTopC) || !isFinite(jpBotC)) {
              var jrC = blk.jpEl.getBoundingClientRect();
              jpTopC = jrC.top - hr.top;
              jpBotC = jrC.bottom - hr.top;
            }
          } catch (eJpC) { }
        }
        if (!isFinite(leftC) || !isFinite(topC) || botC - topC < 4) {
          box.style.display = 'none';
          if (jpBox) jpBox.style.display = 'none';
          return;
        }

        // 框宽按谱面缩放走：70 个 viewBox 单位 ≈ 两个符头宽
        var bw = Math.max(8, Math.round(70 * kk));
        box.style.display = 'block';
        box.style.left = Math.round(leftC - bw / 2) + 'px';
        box.style.top = Math.round(topC) + 'px';
        box.style.width = bw + 'px';
        box.style.height = Math.round(botC - topC) + 'px';
        if (jpBox) {
          if (isFinite(jpTopC) && isFinite(jpBotC) && jpBotC - jpTopC >= 4) {
            jpBox.style.display = 'block';
            jpBox.style.left = Math.round(leftC - bw / 2) + 'px';
            jpBox.style.top = Math.round(jpTopC) + 'px';
            jpBox.style.width = bw + 'px';
            jpBox.style.height = Math.round(jpBotC - jpTopC) + 'px';
          } else {
            jpBox.style.display = 'none';
          }
        }
        if (HORIZ) {
          var nb = (k + 1 < svgFlat.length) ? svgFlat[k + 1].blk : -1;
          var bk = blocks[it.blk];
          var lastMeas = !!(bk && bk.mTo != null && bk.mTo >= 0 && (function () {
            var sk2 = scoreOfSvg(k);
            var nt = (sk2 >= 0 && score.notes[sk2]) ? score.notes[sk2] : null;
            return nt && nt.measure >= bk.mTo - 1;
          })());
          horizFollow(box, lastMeas, nb);
        }
      }

      // ================= 音符组：小节内同一拍的和弦 / 琶音算一组 =================
      // 播放框、滚动、简谱高亮都按「组」走：一组只挪一次，和弦 / 琶音的音一起亮。
      // 组的先后完全由 MusicXML 的 (小节, 时间) 决定；MIDI 只负责给每组配一个起播时刻，
      // 所以某一组没配准谱面时，到点也会照常切到下一组 —— 光标不会卡在上一组。
      var GROUPS = null;
      var gPtr = -1;        // 当前组（只前进）
      var gLastK = -1;      // 上一次播放框落在哪个 svgFlat 下标（保证不倒退）

      function groupsDirty() { GROUPS = null; gPtr = -1; gLastK = -1; }

      function buildGroups() {
        GROUPS = null; gPtr = -1; gLastK = -1;
        if (!score || !score.notes || !score.notes.length) return;

        // 1) 按 (小节, 起拍) 分组。1/32 拍以内的差别算同一组 —— 谱面上的琶音常被写成
        //    几个音略微错开（MIDI 里也会差几十毫秒），合并成一组后播放框只挪一次，
        //    整组按和弦的方式一起亮（用户要求：琶音不逐个亮）。
        var EPS = 0.13;
        var list = [], cur = null, i, m;
        for (i = 0; i < score.notes.length; i++) {
          var r = score.notes[i];
          if (!r) continue;
          if (cur && cur.measure === r.measure && Math.abs(r.ts - cur.ts) <= EPS) {
            cur.members.push(i);
            if (r.ts < cur.ts) cur.ts = r.ts;
          } else {
            cur = { measure: r.measure, ts: r.ts, members: [i], lead: i };
            list.push(cur);
          }
        }
        if (!list.length) return;

        // 2) lead = 组里第一个非装饰音（播放框对齐到它；装饰音只是画在左边的小音符）
        for (i = 0; i < list.length; i++) {
          var g = list[i];
          g.lead = g.members[0];
          for (m = 0; m < g.members.length; m++) {
            var rr = score.notes[g.members[m]];
            if (rr && !rr.grace) { g.lead = g.members[m]; break; }
          }
        }

        // 3) score 下标 → MIDI 时刻（同一个谱面音符被弹多次时取最早的一次）
        var tOf = new Array(score.notes.length), n;
        for (n = 0; n < tOf.length; n++) tOf[n] = -1;
        if (scoreMap) {
          var lim = Math.min(notes.length, scoreMap.length);
          for (n = 0; n < lim; n++) {
            var si = scoreMap[n];
            if (si >= 0 && si < tOf.length && tOf[si] < 0) tOf[si] = notes[n].time;
          }
        }

        // 4) 每组的起播时刻：取组内各音 MIDI 时刻的**中位数**。
        //    原来取最小值，琶音/和弦里只要有一个音被对齐表配错（配到前一拍），
        //    整组就被拽早一整拍；中位数对一两个错配不敏感，琶音的滚奏又天然只差几十毫秒。
        var t = new Array(list.length), gi, gm, v;
        for (gi = 0; gi < list.length; gi++) {
          var arrT = [];
          for (gm = 0; gm < list[gi].members.length; gm++) {
            v = tOf[list[gi].members[gm]];
            if (v >= 0) arrT.push(v);
          }
          if (!arrT.length) { t[gi] = -1; continue; }
          arrT.sort(function (a, b) { return a - b; });
          var midT = arrT.length >> 1;
          t[gi] = (arrT.length % 2) ? arrT[midT] : (arrT[midT - 1] + arrT[midT]) / 2;
        }
        // 3.5) 插值用的位置 = 绝对拍号 ts（MusicXML 的 onset，整首连续）。
        //      以前用「小节序号 + 小节内比例」，小节最后一个音和下一小节第一个音会撞成同一个值，
        //      跨小节插值就会把中间那组算错；直接用 ts 就没有这个问题。
        var pos = new Array(list.length);
        for (gi = 0; gi < list.length; gi++) {
          pos[gi] = list[gi].ts;
          if (gi && !(pos[gi] > pos[gi - 1])) pos[gi] = pos[gi - 1] + 1e-4;
        }
        // 4.5) 剔除「抢跑」的组时刻：琶音附近的音符在 MIDI 对齐表里会配错音高，
        //      于是这一组拿到的是**前一个**琶音音的发声时刻（比按 ts 该在的位置早 0.3 秒以上），
        //      播放时表现为同一个琶音上播放框连着挪两次。这里拿前后都可信的组做线性插值，
        //      比插值早 0.3 秒以上的就当配错，置 -1 交给下面的插值补回来。
        (function dropEarly() {
          for (var dg = 0; dg < t.length; dg++) {
            if (!(t[dg] >= 0)) continue;
            var dp = -1, dq = -1, dk;
            for (dk = dg - 1; dk >= 0; dk--) if (t[dk] >= 0) { dp = dk; break; }
            for (dk = dg + 1; dk < t.length; dk++) if (t[dk] >= 0) { dq = dk; break; }
            if (dp < 0 || dq < 0 || !(pos[dq] > pos[dp])) continue;
            if (!(pos[dg] > pos[dp])) continue;
            var spanT = t[dq] - t[dp];
            if (spanT < 0.6) continue;          // 太密的相邻组，插值不可靠，不动
            var expT = t[dp] + (pos[dg] - pos[dp]) * spanT / (pos[dq] - pos[dp]);
            if (expT - t[dg] > 0.3) t[dg] = -1;
          }
        })();
        for (gi = 0; gi < list.length; gi++) {
          if (t[gi] >= 0) continue;
          var p = -1, q = -1, k;
          for (k = gi - 1; k >= 0; k--) if (t[k] >= 0) { p = k; break; }
          for (k = gi + 1; k < list.length; k++) if (t[k] >= 0) { q = k; break; }
          if (p >= 0 && q >= 0 && pos[q] > pos[p]) {
            t[gi] = t[p] + (pos[gi] - pos[p]) * (t[q] - t[p]) / (pos[q] - pos[p]);
          } else if (p >= 0) {
            t[gi] = t[p] + 0.25;
          } else if (q >= 0) {
            t[gi] = Math.max(0, t[q] - 0.25);
          } else {
            t[gi] = gi * 0.25;
          }
        }
        for (gi = 1; gi < t.length; gi++) if (t[gi] < t[gi - 1]) t[gi] = t[gi - 1];

        // 5) score 下标 → 组号
        var ofScore = new Array(score.notes.length), m2;
        for (gi = 0; gi < ofScore.length; gi++) ofScore[gi] = -1;
        for (gi = 0; gi < list.length; gi++) {
          for (m2 = 0; m2 < list[gi].members.length; m2++) ofScore[list[gi].members[m2]] = gi;
        }

        // 5) 每组的高亮元素**延迟到首帧再算**：buildGroups() 常在谱面刚建好、
        //    .flowJp 各层还没排版完的时候跑，那时所有方块挤在同一 y，只能分出 1 个带，
        //    于是 hEls 只有 1 个元素 → 每帧只亮一个方块（和弦层永远不亮）。
        for (gi = 0; gi < list.length; gi++) list[gi].hiEls = null;
        GROUPS = { list: list, t: t, ofScore: ofScore, tOf: tOf };
      }

      // 播放到 t 时该在第几组（只前进；gPtr 为 -1 时二分查找定位）
      function groupAt(t) {
        if (!GROUPS || !GROUPS.t.length) return -1;
        var L = GROUPS.t, n = L.length, g, mid;
        if (gPtr < 0) {
          var lo = 0, hi = n - 1, ans = 0;
          while (lo <= hi) {
            mid = (lo + hi) >> 1;
            if (L[mid] <= t + 1e-3) { ans = mid; lo = mid + 1; } else hi = mid - 1;
          }
          return ans;
        }
        g = gPtr;
        while (g + 1 < n && L[g + 1] <= t + 1e-3) g++;
        return g;
      }

      // 这一组在 svgFlat 里的下标（lead 的符头）；绝不比上一组更靠前
      function groupLeadK(g) {
        if (!GROUPS || g < 0 || g >= GROUPS.list.length) return -1;
        var k = svgIndexOfScore(GROUPS.list[g].lead);
        if (k < 0) return -1;
        // 只防止「框往回退」。同一列（同一小节同 x）的琶音/和弦不许被顶到下一个音：
        // 用户要求滚动框停在琶音的第一个音上。
        if (gLastK >= 0 && k <= gLastK && gLastK + 1 < svgFlat.length) {
          var a1 = svgFlat[k], b1 = svgFlat[gLastK];
          var sameCol = a1 && b1 && a1.blk === b1.blk && Math.abs((a1.x || 0) - (b1.x || 0)) < 24;
          if (!sameCol) k = gLastK + 1;
        }
        return k;
      }

      // 画出某一组：整组符头染色 + 播放框 + 简谱高亮（同组只挪一次）
      function paintGroup(g) {
        var box = cursorEl();
        if (!GROUPS || g < 0 || g >= GROUPS.list.length) return;
        var grp = GROUPS.list[g], k = groupLeadK(g), i, kk;
        if (k < 0) {
          // 这一组在谱面上找不到：清掉高亮，别停在上组
          try { clearSvgHi(); } catch (e1) { }
          if (box) box.style.display = 'none';
          return;
        }
        try { clearSvgHi(); } catch (e2) { }
        for (i = 0; i < grp.members.length; i++) {
          kk = svgIndexOfScore(grp.members[i]);
          if (kk >= 0 && kk !== k) { try { paintSvgAt(kk); } catch (e3) { } }
        }
        try { paintSvgAt(k); } catch (e4) { }
        if (gLastK < k) gLastK = k;
        positionSvgCursorAt(k, grp.lead);      // 内部还会做简谱高亮 + 滚动到可见
        // 把「这一组此刻点亮的简谱块」就地快照给录制画布用（见 stgTakeHl）：
        // 录制侧不再每帧去读 jpHiNow，避免读到别组/别行的残留。
        try { stgTakeHl(g); } catch (eH5) { }
      }

      // 按「正在响的音符」点亮简谱：每个音符从 time 亮到 time+dur，重叠时一起亮。
      // 以前是「切组时点亮一次、撑到下一组」，琶音/长音会和实际发声对不上。
      // 现算一组要点亮的简谱方块。
      // 每个方块都带三段编号 SparksNMN-notehl-<A>-<B>-<C>（A=行、B=行内小节、C=格号），
      // 但**不能**用「音符在本小节里的全局序号」去拼后缀：左右手两个声部在 score.notes 里
      // 是交错的，序号会被对方声部顶掉一两位（长音/和弦更明显），格号对不上就整段错位。
      // 这里直接按「声部 → 行」+「本行非灰色格顺序」把音符落到自己的格子上。
      function buildHiEls(g) {
        if (!g) return;
        var elsH = [], gmH, kH, blkH, aH, eH, colH, jH, posH, qH, ntH, rnH;
        // 这一组的起播时刻存在 GROUPS.t 里（list 里没有 t 字段）
        var gtH = 0, ixH = -1;
        try {
          ixH = (GROUPS && GROUPS.list) ? GROUPS.list.indexOf(g) : -1;
          if (ixH >= 0 && GROUPS.t && typeof GROUPS.t[ixH] === 'number') gtH = GROUPS.t[ixH];
        } catch (eGT) { }
        for (gmH = 0; gmH < g.members.length; gmH++) {
          var siH = g.members[gmH];
          // 同 jpHiSounding：块按 score 下标查，避免边界音映射到相邻块。
          blkH = blockOfScore(siH);
          if (blkH < 0 || !blocks[blkH] || !blocks[blkH].jpEl) continue;
          aH = null;
          // 用 jpAnchorFor（优先「声部带内按顺序」），不要用 jpAnchorOf：
          // jpAnchorOf 依赖类名里的行号/小节号，本曲简谱被拆段后会整段错位。
          try { aH = jpAnchorFor(blocks[blkH], siH); } catch (eAH) { aH = null; }
          if (!aH || !aH.el) continue;
          // 琶音/滚奏一律按和弦处理：进组就把这一列一起点亮，不按各音在 MIDI 里错开的
          // 几十毫秒去逐个亮（用户要求：标了 arpeggiate 的、以及没标的滚奏，都按和弦走）。
          ntH = gtH;
          colH = [];
          if (aH._partList) {
            for (jH = 0; jH < aH._partList.length; jH++) {
              if (Math.abs(aH._partList[jH].cx - aH.cx) <= 2) colH.push(aH._partList[jH]);
            }
          }
          if (!colH.length) colH = [aH];
          for (jH = 0; jH < colH.length; jH++) {
            eH = colH[jH].el;
            if (!eH) continue;
            posH = -1;
            for (qH = 0; qH < elsH.length; qH++) { if (elsH[qH].el === eH) { posH = qH; break; } }
            if (posH < 0) {
              elsH.push({ el: eH, cx: colH[jH].cx, w: colH[jH].w, at: ntH });
            } else if (ntH < elsH[posH].at) {
              elsH[posH].at = ntH;     // 同一列有好几个音（和弦/琶音）：按最早那个的时刻亮
            }
          }
        }
        g.hiEls = elsH;
      }
      // 这个谱面音符「真正开始发声」的时刻（秒）。
      // 直接按音高在 MIDI 里找同一拍附近的那一个：对齐表（scoreMap）在琶音上会给好几个音
      // 配上同一个下标，靠它取时间会把整列压平。现在整组一起亮，这个函数暂时没被调用，
      // 留着备用（要按音分别亮时可以直接接回 buildHiEls）。
      function scoreOnsetT(si, gt) {
        var sp = null;
        try { sp = (score && score.notes) ? score.notes[si] : null; } catch (eSp) { }
        if (!sp || typeof sp.halfTone !== 'number' || !notes || !notes.length) return null;
        var best = null, bd = 1e9, i, n, nt, d, ad, df, adf;
        for (i = 0; i < notes.length; i++) {
          n = notes[i];
          if (!n || typeof n.time !== 'number') continue;
          df = Math.abs(n.midi - sp.halfTone);
          if (df > 12) continue;                       // 允许一个八度的移调
          nt = n.time;
          d = nt - gt;
          if (d < -0.12 || d > 1.2) continue;          // 只看这一拍附近，避免同音高的重复音串到别处
          ad = Math.abs(d) + df * 0.5;                 // 音高差优先，其次时间贴近
          if (ad < bd) { bd = ad; best = nt; }
        }
        return best;
      }
      // 按「当前播放到的那一组」点亮该组预算好的方块（旋律 + 和弦 / 琶音一起亮）。
      // 这里必须跟 gPtr（播放框/五线谱光标用的组指针）走，而不是跟「最早开始发声的音符」走：
      // 长音会挂过好及格，按最早发声取组会让简谱高亮一直停在旧的一拍上，和光标同步。
      // 琶音与和弦同样处理：进组整列一起亮，不按 MIDI 里的先后逐个亮。
      function jpHiFollowActive() {
        if (!active || !active.length) { try { jpHiReset([]); } catch (eH0) { } return; }
        if (!GROUPS) { try { buildGroups(); } catch (eH1) { } }
        if (!GROUPS || !GROUPS.list) return;
        var gi = (typeof gPtr === 'number') ? gPtr : -1;
        if (gi < 0 || !GROUPS.list[gi]) return;
        var gg = GROUPS.list[gi];
        if (!gg.hiEls) { try { buildHiEls(gg); } catch (eHB) { } }
        var els = gg.hiEls || [];
        if (!els.length) return;
        // 整组一起亮（和弦、琶音、滚奏都按和弦的方式处理）。
        try { jpHiReset(els); } catch (eH2) { }
      }
      function jpHiSounding() {
        if (!active || !active.length) { try { jpHiReset([]); } catch (e0) { } return; }
        if (!GROUPS) { try { buildGroups(); } catch (eb) { } }
        if (!GROUPS || !GROUPS.list) return;
        var out = [], i, mi, si, blk, a, kk;
        for (i = 0; i < active.length; i++) {
          mi = active[i].__mi;
          if (mi === undefined || mi === null || mi < 0) continue;
          si = scoreMap[mi];
          if (si === undefined || si === null || si < 0) continue;
          // 行 = 这个谱面音符（score 下标）所在的五线谱块。
          // 不能用 svgIndexOfScore：边界音可能被映射到前一块的重复格，导致点错行/不亮。
          var bj = blockOfScore(si);
          if (bj < 0 || !blocks[bj]) continue;
          try { a = jpAnchorFor(blocks[bj], si); } catch (eA) { a = null; }
          if (!a) continue;
          // 只点亮这个音自己那条声部带上的那一格；同列（同一和弦）一起亮。
          // 不再「每层都找最近的一个」——那样左手音会顺手点亮右手那一格，看着就是错的。
          var col = [], band = a._partList, q;
          if (band) {
            for (q = 0; q < band.length; q++) {
              if (Math.abs(band[q].cx - a.cx) <= 2) col.push(band[q]);
            }
          }
          if (!col.length) col = [a];
          for (q = 0; q < col.length; q++) {
            if (out.indexOf(col[q]) < 0) out.push(col[q]);
          }
        }
        // 兜底：有音符在响但一列都没配上（MIDI 与 MusicXML 没对齐的段落），
        // 就保留 paintGroup() 已经点亮的那一组，别把高亮全掐掉。
        if (!out.length && active.length) return;
        try {
          window.__jpSnd = out.map(function (o) {
            return {
              cx: Math.round(o.cx), top: Math.round(o.top),
              dig: o.el && o.el.nextElementSibling ? String(o.el.nextElementSibling.textContent || '').trim() : ''
            };
          });
        } catch (eJS) { }
        try { jpHiReset(out); } catch (e1) { }
      }
      // 每帧调用：时间到了就切组（没有 MIDI 音符的组也会照常前进）
      function syncGroupCursor(t) {
        if (!GROUPS) buildGroups();
        if (!GROUPS || !GROUPS.list.length) return false;
        var g = groupAt(t);
        if (g < 0) return false;
        if (g === gPtr) return true;
        gPtr = g;
        paintGroup(g);
        return true;
      }

      // 从某个 score 下标（起播位置）直接落到它所在的那一组
      function seekGroupToScore(si) {
        if (!GROUPS) buildGroups();
        if (!GROUPS || si < 0 || si >= GROUPS.ofScore.length) return false;
        var g = GROUPS.ofScore[si];
        if (g < 0) return false;
        gPtr = g;
        gLastK = -1;
        paintGroup(g);
        return true;
      }

      // ================= 点击谱面定位（暂停态） =================
      // 暂停时点击五线谱或简谱的音符区域 → 播放滚动框移到该位置、键盘点亮该组音符，
      // 再点「播放」即从该处续播（togglePlay 的 startTime===0 分支天然支持）。
      // 命中优先级：点击点正下方的 .Note 元素 → 所在块内最近符头 → 简谱锚点几何。

      // 一组的「起播时刻」：以 GROUPS.t[g] 为基准，尽量提前到组内最早发声音
      //（不切掉琶音首音）；只允许提前 0.3s 以内，避免被错配音拽早。
      function groupSeekTime(g) {
        var t0 = GROUPS.t[g];
        if (!(t0 >= 0)) return 0;
        var grp = GROUPS.list[g], earliest = t0;
        for (var i = 0; i < grp.members.length; i++) {
          var v = GROUPS.tOf[grp.members[i]];
          if (v >= 0 && v < earliest && t0 - v <= 0.3) earliest = v;
        }
        return Math.max(0, earliest - 0.05);   // 留 50ms 引入，音头不被切
      }

      // 暂停态键盘预览：点亮该组音符对应的键。播放时由 tick 按 active 亮键，
      // 暂停时没有 tick，这里手动亮一次，并登记进 prevOn/pressedStyle 供 clearHighlights 统一收。
      function previewKeysForGroup(g, t) {
        if (!GROUPS || g < 0 || g >= GROUPS.list.length) return;
        var grp = GROUPS.list[g];
        var memberSet = {}, i, si;
        for (i = 0; i < grp.members.length; i++) memberSet[grp.members[i]] = 1;
        var lit = {}, list = [];
        if (scoreMap) {
          var lo = firstNoteIndexAtOrAfter(Math.max(0, t - 0.35));
          for (i = lo; i < notes.length && notes[i].time <= t + 0.8; i++) {
            si = scoreMap[i];
            if (si >= 0 && memberSet[si] && !lit[notes[i].midi]) {
              lit[notes[i].midi] = 1;
              list.push(notes[i]);
            }
          }
        }
        if (!list.length) {   // 兜底：对齐表没给这组配上 MIDI 音时，按谱面音高亮键
          for (i = 0; i < grp.members.length; i++) {
            var r = score && score.notes[grp.members[i]];
            if (r && typeof r.halfTone === 'number' && !lit[r.halfTone]) {
              lit[r.halfTone] = 1;
              list.push({ midi: r.halfTone });
            }
          }
        }
        for (i = 0; i < list.length; i++) {
          var n = list[i], el = keyEls[n.midi];
          if (!el) continue;
          el.style.setProperty('--c', colorOf(n));
          el.classList.add('on');
          el.style.transform = 'translateY(1px)';
          prevOn[n.midi] = 1;
          pressedStyle[n.midi] = 'translateY(1px)';
        }
      }

      // 定位到一组：暂停 → 挪播放位置 → 滚动框/简谱高亮 → 键盘预览。
      function seekToGroup(g, srcLabel) {
        if (!notes.length || !GROUPS || g < 0 || g >= GROUPS.list.length) return false;
        var t = groupSeekTime(g);
        playing = false;
        playBtn.textContent = '播放';
        try { document.body.classList.toggle('cleanplay', false); } catch (e1) { }
        try { if (ac) ac.suspend(); } catch (e2) { }
        stopAllNodes();
        startTime = 0;
        playFromTime = t;
        schedPtr = firstNoteIndexAtOrAfter(t);
        visPtr = schedPtr;
        lastStart = {};
        active = [];
        recentOn = [];
        curMeasureNo = -1;
        try { clearHighlights(); } catch (e3) { }
        barfill.style.width = (total > 0 ? Math.min(100, t / total * 100) : 0) + '%';
        timeEl.textContent = fmt(t) + ' / ' + fmt(total);
        // 滚动框/简谱：整组落位（positionSvgCursorAt 内部会 ensureBlockVisible 滚动到该行）
        var ok = false;
        try { ok = seekGroupToScore(GROUPS.list[g].lead); } catch (e4) { }
        if (!ok) { try { previewAtTime(t); } catch (e5) { } }
        // 键盘：点亮该组音符
        try { previewKeysForGroup(g, t); } catch (e6) { }
        // 同步「从第 N 小节开始」下拉（不触发 change，避免把 playFromTime 覆写成小节起点）
        var meas = GROUPS.list[g].measure;
        if (startMeasSel && meas >= 0) {
          try { startMeasSel.value = String(meas + 1); } catch (e7) { }
        }
        if (statusEl) {
          statusEl.textContent = '已定位到第 ' + (meas + 1) + ' 小节' + (srcLabel ? '（' + srcLabel + '）' : '') +
            ' ' + fmt(t) + '，点「播放」从这里继续';
        }
        return true;
      }

      function seekToScoreIndex(si) {
        if (!GROUPS) { try { buildGroups(); } catch (e) { } }
        if (!GROUPS || si < 0 || si >= GROUPS.ofScore.length) return false;
        var g = GROUPS.ofScore[si];
        if (g < 0) return false;
        return seekToGroup(g);
      }

      // 点击点 → 谱面音符下标。返回 { si, k, src } 或 null。
      function scoreHitFromPoint(cx, cy, target) {
        if (!flowReady || !svgFlat.length) return null;
        var i, blk, sr, kk, vx, vy;
        // 1) 五线谱：直接命中 .Note 元素（符头 path）
        var noteEl = null;
        try { if (target && target.closest) noteEl = target.closest('.Note'); } catch (eN) { }
        if (noteEl) {
          for (i = 0; i < svgFlat.length; i++) {
            if (svgFlat[i].el === noteEl) {
              var si0 = scoreOfSvg(i);
              if (si0 >= 0) return { si: si0, k: i, src: '五线谱' };
              break;
            }
          }
        }
        // 2) 五线谱：点击点所在块 → 换算 viewBox 坐标 → 最近符头 (x+16, y)
        for (i = 0; i < blocks.length; i++) {
          blk = blocks[i];
          var svgEl = blk.svg || (blk.el && blk.el.querySelector('svg'));
          if (!svgEl) continue;
          sr = svgEl.getBoundingClientRect();
          if (!sr.width || !sr.height) continue;
          if (cx < sr.left - 4 || cx > sr.right + 4 || cy < sr.top - 4 || cy > sr.bottom + 4) continue;
          kk = sr.width / blk.vbW;
          vx = (cx - sr.left) / kk + (blk.vbLeft || 0);
          vy = (cy - sr.top) / kk + blk.vbTop;
          var best = -1, bestD = Infinity;
          for (var q = blk.noteFrom || 0; q < (blk.noteTo || 0); q++) {
            var it = svgFlat[q];
            var dx = (it.x + 16) - vx, dy = it.y - vy;
            var d = dx * dx + dy * dy;
            if (d < bestD) { bestD = d; best = q; }
          }
          if (best >= 0) {
            var si1 = scoreOfSvg(best);
            if (si1 >= 0) return { si: si1, k: best, src: '五线谱' };
          }
          return null;
        }
        // 3) 简谱：点击点所在 .flowJp → 锚点块几何（包含优先，否则最近中心）
        for (i = 0; i < blocks.length; i++) {
          blk = blocks[i];
          if (!blk.jpEl || !blk.jp2 || !blk.jp2.anchors || !blk.jp2.anchors.length) continue;
          var jr = blk.jpEl.getBoundingClientRect();
          if (!jr.width || cx < jr.left || cx > jr.right || cy < jr.top || cy > jr.bottom) continue;
          var bestA = null, bestAD = Infinity, inside = null, insideD = Infinity;
          for (var a = 0; a < blk.jp2.anchors.length; a++) {
            var an = blk.jp2.anchors[a];
            if (!an.el || an.si < 0) continue;
            var ar = an.el.getBoundingClientRect();
            if (!ar.width) continue;
            var adx = cx - (ar.left + ar.right) / 2, ady = cy - (ar.top + ar.bottom) / 2;
            var ad = adx * adx + ady * ady;
            if (cx >= ar.left - 4 && cx <= ar.right + 4 && cy >= ar.top - 4 && cy <= ar.bottom + 4) {
              if (ad < insideD) { insideD = ad; inside = an; }
            }
            if (ad < bestAD) { bestAD = ad; bestA = an; }
          }
          var hitA = inside || bestA;
          if (hitA) return { si: hitA.si, k: svgIndexOfScore(hitA.si), src: '简谱' };
          return null;
        }
        return null;
      }

      // 事件接线：委托在 #svgHost 上（host 元素不重建、只换子内容，一次绑定长期有效）。
      (function wireScoreSeek() {
        var host = hostEl();
        if (!host || !host.addEventListener) return;
        host.addEventListener('click', function (ev) {
          try {
            if (window.KB_NO_SCORE_SEEK) return;              // 外部页面可禁用
            if (playing || exporting) return;                 // 仅暂停态允许定位
            if (STG && STG.on) return;                        // 录制中不打扰
            if (document.body.classList.contains('rec-mode')) return;
            if (!notes.length || !flowReady) return;
            var hit = scoreHitFromPoint(ev.clientX, ev.clientY, ev.target);
            if (!hit) return;
            if (seekToScoreIndex(hit.si)) {
              try { ev.preventDefault(); } catch (eP) { }
            }
          } catch (eW) { try { console.warn('[定位] 点击处理失败', eW); } catch (eL) { } }
        });
      })();

      function readSvgFiles(files) {
        if (!files || !files.length) return;
        var host = hostEl();
        if (!host) return;
        var wrap = wrapEl();
        if (wrap) wrap.hidden = false;
        if (statusEl) statusEl.textContent = '正在读取 ' + files.length + ' 个 SVG…';

        var list = Array.prototype.slice.call(files);
        list.sort(function (a, b) { return relPathOf(a).localeCompare(relPathOf(b), undefined, { numeric: true }); });

        pendingPages = [];
        // 先收齐再统一交给 buildFlow，避免批量导入时画出「只加载了一半」的中间态
        var pagesTmp = [];
        var pending = list.length;
        list.forEach(function (f, idx) {
          var fr = new FileReader();
          fr.onload = function () {
            var pg = parseSvgDoc(String(fr.result || ''));
            if (pg) { pg.idx = idx; pg.name = f.name; pagesTmp.push(pg); }
            else { try { console.warn('[SVG] 解析失败:', f.name); } catch (e) { } }
            if (--pending === 0) finish();
          };
          fr.onerror = function () { if (--pending === 0) finish(); };
          fr.readAsText(f);
        });

        function finish() {
          pagesTmp.sort(function (a, b) { return a.idx - b.idx; });
          pendingPages = pagesTmp;
          if (fontsReady) buildFlow();
          else waitFonts(function () { buildFlow(); });
        }
      }

      (function wireSvg() {
        var inp = document.getElementById('svgFile');
        if (inp) {
          inp.addEventListener('change', function (e) {
            var fs = e.target.files;
            if (fs && fs.length) readSvgFiles(fs);
            e.target.value = '';
          });
        }
        var sel = document.getElementById('flowScaleSel');
        if (sel) {
          flowZoom = parseFloat(sel.value) || 0.55;
          sel.addEventListener('change', function () {
            flowZoom = parseFloat(sel.value) || 0.55;
            if (pendingPages.length) buildFlow();
          });
        }
        injectFonts();
      })();

      // 运行时导入另一首歌的简谱数据（.js，内容是 window.efData = [...]）
      (function wireJpFile() {
        var inp = document.getElementById('jpFile');
        if (!inp) return;
        inp.addEventListener('change', function (e) {
          var f = e.target.files && e.target.files[0];
          if (f) readJpFile(f);
          e.target.value = '';
        });
      })();

      // 导入文件夹：webkitdirectory 选中目录里的所有文件，走和拖放同一套识别
      (function wireDirFile() {
        var inp = document.getElementById('dirFile');
        if (!inp) return;
        inp.addEventListener('change', function (e) {
          var fs = inp.files ? Array.prototype.slice.call(inp.files) : [];
          if (fs.length) loadImportedFiles(fs);
          inp.value = '';
        });
      })();

      // 竖屏开关
      (function wirePortrait() {
        var btn = document.getElementById('portraitBtn');
        if (!btn) return;
        var apply = function () {
          btn.classList.toggle('primary', portraitMode);
          btn.textContent = portraitMode ? '竖屏 ✓' : '竖屏';
        };
        apply();
        btn.addEventListener('click', function () {
          portraitMode = !portraitMode;
          apply();
          if (pendingPages.length) buildFlow();
          else try { applyPortraitWidth(lastGroupW); } catch (e) { }
        });
        // 转屏 / 改窗口大小时重排
        window.addEventListener('resize', function () {
          if (pendingPages.length && portraitMode) buildFlow();
        });
      })();

      // ===== 键盘保底初始化 =====
      // buildKeyboard(low, high) 不传参时 low/high 会是 NaN，循环一次都不执行，
      // 结果就是「#keys 里一个键都没有」——整块黑。
      (function ensureKeyboard() {
        var tries = 0;
        function go() {
          var k = document.getElementById('keys');
          if (!k) return;
          if (k.children.length > 0) return;              // 已经建好，不动
          if (k.clientWidth <= 0) {                       // 布局还没就绪
            if (++tries < 20) requestAnimationFrame(go);
            return;
          }
          var lo = (typeof viewLow === 'number' && isFinite(viewLow)) ? viewLow : 21;
          var hi = (typeof viewHigh === 'number' && isFinite(viewHigh)) ? viewHigh : 108;
          try { buildKeyboard(lo, hi); } catch (e) { }
          try {
            console.log('[键盘] 保底构建 ' + lo + '-' + hi +
              '，键数 ' + k.children.length + '，容器宽 ' + k.clientWidth);
          } catch (e2) { }
        }
        go();
        window.addEventListener('resize', function () {
          requestAnimationFrame(function () {
            var k = document.getElementById('keys');
            if (!k || k.clientWidth <= 0) return;
            var lo = (typeof viewLow === 'number' && isFinite(viewLow)) ? viewLow : 21;
            var hi = (typeof viewHigh === 'number' && isFinite(viewHigh)) ? viewHigh : 108;
            try { buildKeyboard(lo, hi); } catch (e) { }
          });
        });
      })();


      // 谱面大小：同时缩放五线谱与简谱（两者共用一个组宽）。
      // 按钮和 window.KeyboardPlayer.setZoom() 走同一条路。
      function changeZoom(d) {
        flowZoom = Math.min(1.4, Math.max(0.25, Math.round((flowZoom + d) * 100) / 100));
        if (pendingPages.length) buildFlow();
        if (statusEl) statusEl.textContent = '谱面大小 ' + Math.round(flowZoom * 100) + '%';
        if (typeof window.refreshStepInputs === 'function') {
          try { window.refreshStepInputs(); } catch (eR) { }
        }
        try { console.log('[谱面] 缩放 ' + Math.round(flowZoom * 100) + '%'); } catch (e) { }
        return flowZoom;
      }

      // 谱面大小按钮：页面里有 #scoreMinus / #scorePlus 就能用
      (function wireZoomButtons() {
        var a = document.getElementById('scoreMinus');
        var b = document.getElementById('scorePlus');
        if (a) a.addEventListener('click', function () { changeZoom(-0.08); });
        if (b) b.addEventListener('click', function () { changeZoom(+0.08); });
      })();

      // 「谱面」「键盘」「琴键高」输入框：**显示当前值**（谱面 = 缩放百分比，键盘 = 上移像素，
      // 琴键高 = 1080 宽版面下的键盘高度 px），改成新数字回车即设成那个值；Esc 还原。
      // 值变了（换歌、缩放、窗口变化）输入框跟着刷新。
      (function wireStepInputs() {
        var zEl = document.getElementById('zoomStep');
        var lEl = document.getElementById('liftStep');
        var kEl = document.getElementById('keyHStep');

        function curZoomPct() { return HORIZ ? Math.round(hBandPct * 100) : Math.round(flowZoom * 100); }
        function curLiftPx() {
          var bd = document.getElementById('board');
          var h = bd ? (bd.getBoundingClientRect().height || 0) : 0;
          return Math.round(HORIZ ? hLiftPx() : liftTarget(h));
        }
        function curKeyH() {
          if (HORIZ) {
            var bd2 = document.getElementById('board');
            return bd2 ? Math.round(bd2.getBoundingClientRect().height) : 0;
          }
          return Math.round(keyHPref());
        }

        window.refreshStepInputs = function () {
          try {
            if (zEl && document.activeElement !== zEl) zEl.value = String(curZoomPct());
            if (lEl && document.activeElement !== lEl) lEl.value = String(curLiftPx());
            if (kEl && document.activeElement !== kEl) kEl.value = String(curKeyH());
          } catch (e) { }
        };

        function bind(el, cur, apply, allowEmpty) {
          if (!el || !el.addEventListener) return;
          var go = function () {
            var raw = String(el.value == null ? '' : el.value).trim();
            var v = parseFloat(raw);
            if (!raw || !isFinite(v)) {
              // 清空 = 恢复默认（只有「琴键高」允许这样，其余两个框清空按取消处理）
              if (allowEmpty) { try { apply(null); } catch (eE) { } }
              el.value = String(cur());
              return;
            }
            if (Math.round(v) !== cur()) {
              try { apply(Math.round(v)); } catch (e) { }
            }
            el.value = String(cur());
          };
          el.addEventListener('keydown', function (ev) {
            if (ev.key === 'Enter') { ev.preventDefault(); go(); el.blur(); }
            else if (ev.key === 'Escape') { el.value = String(cur()); el.blur(); }
          });
          el.addEventListener('change', go);
          el.addEventListener('blur', go);
          el.addEventListener('focus', function () {
            setTimeout(function () { try { el.select(); } catch (e) { } }, 0);
          });
        }

        // 谱面：竖版输缩放百分比（25~140）；横版输「谱面区占舞台高度的百分比」（50~98）
        bind(zEl, curZoomPct, function (pct) {
          if (HORIZ) {
            var v = Math.max(50, Math.min(98, Math.round(pct))) / 100;
            if (Math.abs(v - hBandPct) > 0.004) { hBandPct = v; hFitPass = 0; hRelayout(); }
            return;
          }
          changeZoom(pct / 100 - flowZoom);
          window.refreshStepInputs();
        });
        // 键盘：输入上移像素（0 ~ 舞台高 60%），回车设成该值；横版 0 = 贴底
        bind(lEl, curLiftPx, function (px) {
          if (HORIZ) { setHLift(px); return; }
          setBoardLift(px);
          window.refreshStepInputs();
        });
        // 琴键高：竖版是 1080 宽版面下的键盘高度（px）；横版是当前 16:9 舞台里的键盘高度（px）
        // 最后一个 true = 允许清空，清空就回到页面里写的默认值（window.KB_KEY_H_DEFAULT）
        bind(kEl, curKeyH, function (px) {
          if (HORIZ) { setHKey(px); return; }
          setKeyH(px);
          window.refreshStepInputs();
        }, true);

        window.refreshStepInputs();
      })();


      // 把「曲名/制谱者」镜像到左侧控制栏顶部
      (function mirrorSongInfo() {
        var src = document.getElementById('scoreInfo');
        var header = document.querySelector('header');
        if (!src || !header) return;
        var dst = document.createElement('div');
        dst.id = 'sideInfo';
        dst.className = 'side-info';
        header.appendChild(dst);   // 放到最下方，按钮位置不受影响
        var sync = function () {
          dst.innerHTML = src.innerHTML || '';
          dst.hidden = !src.innerHTML;
        };
        sync();
        try {
          new MutationObserver(sync).observe(src, {
            childList: true, subtree: true, characterData: true
          });
        } catch (e) { }
      })();


      // 把底部图例/提示也镜像到左侧
      (function mirrorLegend() {
        var src = document.getElementById('legend');
        var header = document.querySelector('header');
        if (!src || !header) return;
        var dst = document.createElement('div');
        dst.id = 'sideLegend';
        dst.className = 'side-legend';
        header.appendChild(dst);
        var sync = function () { dst.innerHTML = src.innerHTML || src.textContent || ''; };
        sync();
        try {
          new MutationObserver(sync).observe(src, { childList: true, subtree: true, characterData: true });
        } catch (e) { }
      })();


      // 调试接口（用 CDP 检查简谱小节线检测结果）
      try {
        window.__dbg = {
          blocks: function () { return blocks; },
          pages: function () { return pendingPages; },
          bars: jpBarFracs,
          span: measureSpan,
          score: function () { return score; },
          map: function () { return scoreMap; },
          align: function () { return alignInfo; },
          // 重跑一遍匹配，拿「补洞之前」的原始结果（排查对齐问题用）
          rawAlign: function () {
            if (!alignSList) return null;
            var r = alignList(notes, alignSList);
            return { map: r.map, matched: r.matched, dbg: r.dbg };
          },
          notes: function () { return notes; },
          svgFlat: function () { return svgFlat; },
          jpAnchors: jpNoteAnchors,
          jpSounding: jpSounding,
          jpFrac: jpBoxFrac,
          jpTarget: jpNoteFrac,
          jpAt: positionSvgCursorAt,
          importFiles: loadImportedFiles,
          shootJianpu: shootJianpu,
          shootScore: shootScore,
          jpBitmaps: function () { return jpBitmaps; },
          exportSong: function (opts) { return exportSongFile(opts); },
          collectSong: function () { return collectSongData(); },
          jp2Rich: function () { return jp2Rich; },
          jianpuKeyName: jianpuKeyName,
          jp2Arcs: function (bi) {
            var b = blocks[bi]; if (!b || !b.jp2) return null;
            var F = Math.max(9, Math.min(30, b.jp2.w * 0.026));
            var out = [];
            (b.jp2.rows || []).forEach(function (row) {
              var arcs = jp2CollectArcs(b, bi, row.cols, F, 0.30 * F, 0.075 * F);
              arcs.forEach(function (a) {
                out.push({ part: row.part, kind: a.kind, label: a.label || '', fromDeg: a.from.degree, toDeg: a.to.degree,
                  fromMnum: a.from.mnum, toMnum: a.to.mnum, x0: +a.x0.toFixed(1), x1: +a.x1.toFixed(1),
                  apexDist: +a.apexDist.toFixed(1), sameRow: a.sameRow,
                  fTop: +((a.from.topExt || 0) - (a.from.vOff || 0)).toFixed(1),
                  tTop: +((a.to.topExt || 0) - (a.to.vOff || 0)).toFixed(1) });
              });
            });
            return out;
          },
          // 音符组（播放框 / 简谱高亮按组推进）
          groups: function () { return GROUPS; },
          svgMap: function () { return svgScoreMap; },
          svgAt: function (si) { return svgIndexOfScore(si); },
          scoreOfSvg: function (k) { return scoreOfSvg(k); },
          // 简谱侧排查：当前点亮的方块、以及每行的 score/SVG 区间
          jpNow: function () {
            var out = [];
            for (var qi = 0; qi < jpHiNow.length; qi++) {
              var ai = jpHiNow[qi];
              var cls = String((ai.el && ai.el.className) || '');
              var mm = /notehl-(\d+)-(\d+)-(\d+)/.exec(cls);
              var dg = ai.dig;
              if (!dg && ai.el) {
                try {
                  var nx = ai.el.nextElementSibling;
                  if (nx) dg = String(nx.textContent || '').replace(/\s+/g, '').slice(0, 3);
                } catch (eD) { }
              }
              out.push({
                row: mm ? mm[1] : null, sys: mm ? (+mm[2]) : null, seq: mm ? (+mm[3]) : null,
                dig: dg, cx: Math.round(ai.cx), gray: !!ai.gray
              });
            }
            return out;
          },
          jpRows: function () {
            var out = [];
            for (var bi = 0; bi < blocks.length; bi++) {
              var bq = blocks[bi];
              var rq = blkScoreRange(bq);
              out.push({
                blk: bi, page: bq.page, sys: bq.sys,
                noteFrom: bq.noteFrom, noteTo: bq.noteTo,
                scoreFrom: rq[0], scoreTo: rq[1], jp: !!bq.jpEl
              });
            }
            return out;
          },
          // 简谱锚点自检：某个 score 音符会点亮哪一格（排查对齐用）
          jpPick: function (k) {
            if (!score || !score.notes || !score.notes[k]) return null;
            var blk = null, rng = null;
            for (var i = 0; i < blocks.length; i++) {
              var rr = blkScoreRange(blocks[i]);
              if (k >= rr[0] && k < rr[1]) { blk = blocks[i]; rng = rr; break; }
            }
            if (!blk) return null;
            var a = null;
            try { a = jpAnchorByOrder(blk, k); } catch (eP) { }
            var bands = jpPartAnchors(blk);
            var out = {
              k: k, blk: blocks.indexOf(blk), part: score.notes[k].part,
              measure: score.notes[k].measure, bands: bands.map(function (b) { return b.list.length; }),
              dig: null, cx: null, bandTop: null
            };
            if (a) {
              out.cx = Math.round(a.cx);
              out.bandTop = Math.round(a.top);
              try {
                var nx = a.el.nextElementSibling;
                out.dig = nx ? String(nx.textContent || '').replace(/\s+/g, '') : '';
              } catch (eD) { }
            }
            return out;
          },
          jpDump: function (bi) {
            var lay = jpLayout(blocks[bi]);
            if (!lay) return null;
            var out = { base: lay.base, rows: [] };
            for (var ri = 0; ri < lay.rows.length; ri++) {
              var row = lay.rows[ri], o = { id: row.id, cols: {} };
              for (var kk in row.cols) {
                o.cols[kk] = row.cols[kk].map(function (c) {
                  return c.dig + '@' + Math.round(c.cx) + (c.gray ? '(g)' : '');
                });
              }
              out.rows.push(o);
            }
            return out;
          },
          buildGroups: buildGroups,          groupAt: groupAt,
          groupNow: function () { return gPtr; },
          // 直接点亮某一组（不依赖播放进度），排查 buildHiEls 路径用
          hiGroup: function (gi) {
            if (!GROUPS || !GROUPS.list[gi]) return 0;
            var g = GROUPS.list[gi];
            try { buildHiEls(g); } catch (eB) { }
            try { jpHiReset(g.hiEls || []); } catch (eR) { }
            return (g.hiEls || []).length;
          },
          // 某一组的方块 + 各自的发声时刻（排查「琶音按和弦一起亮」用）
          hiList: function (gi) {
            if (!GROUPS || !GROUPS.list[gi]) return null;
            var g = GROUPS.list[gi];
            try { buildHiEls(g); } catch (eB2) { }
            return (g.hiEls || []).map(function (x) {
              var d = '';
              try { d = (x.el.nextElementSibling || {}).textContent || ''; } catch (eD) { }
              return { dig: d, at: x.at, cx: Math.round(x.cx * 10) / 10 };
            });
          },
          // 当前播放位置（秒）与正在响的谱面音符下标（排查简谱高亮用）
          time: function () { return (ac && startTime) ? Math.max(0, ac.currentTime - startTime) : 0; },
          // 谱面滚动：时间轴计划 + 任意时刻该滚到哪（排查换行滚动用）
          scrollPlan: scPlan,
          scrollAt: scrollYAt,
          scrollNow: function () { var w = wrapEl(); return w ? (w.scrollTop || 0) : 0; },
          activeScores: function () {
            var out = [], i, si;
            for (i = 0; i < active.length; i++) {
              si = scoreMap[active[i].__mi];
              if (si !== undefined && si !== null && si >= 0) out.push(si);
            }
            return out;
          },
          info: buildNoteInfo
        };
      } catch (e) { }

      // 去掉「发声」「音量」：发声常开，音量锁 100%
      (function tidyHeader() {
        var sc = document.getElementById('soundChk');
        if (sc) { sc.checked = true; sc.parentNode.style.display = 'none'; }

        var v = document.getElementById('vol');
        if (v) {
          v.value = 100;
          v.style.display = 'none';
          try { v.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) { }
          try { v.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) { }
        }
      })();


      // 竖版：键盘高度按舞台宽度自动定（键太扁/太高都不好看）
      // 「琴键高」输入框 / window.KB_KEY_H_PX 存的是 **1080 宽版面下的像素**（也就是成片里量的高度），
      // 真正的高度 = 舞台宽 × (值 / 1080)：编辑页（约 540 宽）与录制页（1080 宽）自动等比，
      // 预览和成片里键盘占的画面比例完全一致。
      var KEY_H_REF_W = 1080;
      var KEY_H_FALLBACK = 260;     // 页面没写 window.KB_KEY_H_DEFAULT 时兜底（1080 宽下的 px）
      // 默认键高：在页面里改 window.KB_KEY_H_DEFAULT 就行（keyboard-platform-vertical.html 顶部有注释）
      function keyHDefault() {
        var v = parseFloat(window.KB_KEY_H_DEFAULT);
        if (isFinite(v) && v > 0) return Math.max(60, Math.min(460, Math.round(v)));
        return KEY_H_FALLBACK;
      }
      function keyHStoreKey() { return 'kb-key-h:' + headPageName(); }
      function fileKeyH() {
        var v = parseFloat(window.KB_KEY_H_PX);
        return (isFinite(v) && v > 0) ? Math.max(60, Math.min(460, Math.round(v))) : null;
      }
      // 当前生效的「1080 宽下的键高」：运行时调过 > 页面写死 > localStorage > 默认
      var keyHPx1080 = null;
      function keyHPref() {
        if (keyHPx1080 != null) return keyHPx1080;
        var f = fileKeyH();
        if (f != null) return f;
        try {
          var s = parseFloat(localStorage.getItem(keyHStoreKey()));
          if (isFinite(s) && s > 0) return Math.max(60, Math.min(460, Math.round(s)));
        } catch (e) { }
        return keyHDefault();
      }
      function keyHRatio() { return keyHPref() / KEY_H_REF_W; }
      // 把舞台宽换算成实际键高（px）
      function keyHForStage() {
        var st = document.querySelector('.stage');
        var w = st ? st.clientWidth : 0;
        if (!(w > 0)) w = KEY_H_REF_W;
        return Math.max(56, Math.round(w * keyHRatio()));
      }
      // 「琴键高」输入框走这里：值按 1080 宽版面记，页面上、成片里都一致
      // 传空（输入框清空）＝ 恢复默认：清掉记下的值，用页面里的 window.KB_KEY_H_DEFAULT
      function setKeyH(px) {
        var v = parseFloat(px);
        if (!isFinite(v)) {
          keyHPx1080 = null;
          try { localStorage.removeItem(keyHStoreKey()); } catch (eD) { }
          if (typeof window.applyBoardHeight === 'function') {
            try { window.applyBoardHeight(); } catch (eA) { }
          }
          return keyHPref();
        }
        v = Math.max(60, Math.min(460, Math.round(v)));
        keyHPx1080 = v;
        try { localStorage.setItem(keyHStoreKey(), String(v)); } catch (eS) { }
        if (typeof window.applyBoardHeight === 'function') {
          try { window.applyBoardHeight(); } catch (eA) { }
        }
        return v;
      }
      (function fitBoardHeight() {
        // 没设过「琴键高」、但页面里写了 window.KB_KEY_RATIO（键盘高 ÷ 舞台宽）就用它
        function ratio() {
          var f = fileKeyH();
          var s = null;
          try { s = parseFloat(localStorage.getItem(keyHStoreKey())); } catch (eS) { }
          if (f == null && keyHPx1080 == null && !(isFinite(s) && s > 0)) {
            var r = parseFloat(window.KB_KEY_RATIO);
            if (isFinite(r) && r > 0.05 && r < 0.5) return r;
          }
          return keyHRatio();
        }
        function apply() {
          var st = document.querySelector('.stage');
          var bd = document.getElementById('board');
          if (!st || !bd) return;
          var w = st.clientWidth;
          if (w <= 0) return;
          var h;
          if (HORIZ) {
            // 横版：键高按舞台高的比例算（0.20 = 五分之一），侧栏显示成当前舞台下的 px
            h = hKeyPx();
            if (!(h > 0)) return;
          } else {
            h = Math.round(w * ratio());
          }
          h = Math.max(56, h);
          // 走 CSS 变量而不是 inline height：buildFlow() 里的 applyPortraitWidth()
          // 会把 inline 高度清空，变量不会被清掉
          st.style.setProperty('--kb-key-h', h + 'px');
         bd.style.height = '';
          try { syncBoardLift(); } catch (eL) { }
          if (typeof window.refreshStepInputs === 'function') {
            try { window.refreshStepInputs(); } catch (eR) { }
          }
        }
        window.applyBoardHeight = apply;
        apply();
        window.addEventListener('resize', function () { requestAnimationFrame(apply); });

        // 舞台尺寸可能在布局稳定后才正确，补两次
        setTimeout(apply, 120);
        setTimeout(apply, 600);
      })();

      // 舞台宽变了（窗口缩放 / 进录制页）→ 抬头字号比例跟着重算
      (function wireUiScale() {
        syncUiScale();
        window.addEventListener('resize', function () { requestAnimationFrame(syncUiScale); });
        try {
          if (window.ResizeObserver) {
            var st = document.querySelector('.stage');
            if (st) new ResizeObserver(function () { syncUiScale(); }).observe(st);
          }
        } catch (eR) { }
      })();

    

      // ================= 数据导出 / 载入（给独立播放页复用） =================
      // 导出内容 = 「渲染好的数据」+「播放数据」：
      //   notes      播放用音符（MIDI 解析结果：音高 / 起播秒数 / 时长 / 力度 / 音轨颜色）
      //   score      MusicXML 解析结果（谱面音符 + 小节），用来把 MIDI 和谱面对齐
      //   svgPages   每页五线谱的 SVG 源码
      //   efData     简谱分节数据（原 efData.js 的内容）
      //   settings   影响渲染的开关（88 键 / 音名 / 配色 / 谱面缩放 / 起播小节）
      // keyboard-player.html 载入这份 .js 就能完整复现右侧舞台，
      // 不再需要原始 .mid / .musicxml / .svg / efData.js。

      var DATA_FORMAT = 'kb-vertical-song';
      var DATA_VERSION = 1;
      var dataBtn = document.getElementById('dataBtn');

      // 内联进 <script> 也不出事：转义掉 </script> 与行分隔符
      function jsonForScript(obj) {
        return JSON.stringify(obj)
          .replace(/</g, '\\u003c')
          .replace(/\u2028/g, '\\u2028')
          .replace(/\u2029/g, '\\u2029');
      }

      // 导出数据里的键盘参数：优先用页面里写死的默认值（跟平台预设、侧栏滑块无关）
      function exportLiftPx(bdH) {
        var v = parseFloat(window.KB_EXPORT_LIFT_PX);
        if (isFinite(v) && v >= 0) return Math.round(v);
        return Math.round(liftTarget(bdH || 0));
      }
      function exportKeyH() {
        var v = parseFloat(window.KB_EXPORT_KEY_H);
        if (isFinite(v) && v > 0) return Math.round(v);
        return Math.round(keyHPref());
      }

      function collectSongData() {
        var pages = [], i, j;
        var bdEl = document.getElementById('board');
        var bdH = bdEl ? (bdEl.getBoundingClientRect().height || 0) : 0;

        for (i = 0; i < pendingPages.length; i++) {
          var pg = pendingPages[i];
          var text = pg.text || '';
          if (!text) {
            try { text = new XMLSerializer().serializeToString(pg.svg); } catch (eS) { text = ''; }
          }
          if (!text) continue;
          pages.push({
            name: pg.name || ('page-' + (i + 1) + '.svg'),
            vbW: pg.vbW,
            vbH: pg.vbH,
            text: text
          });
        }

        var ef = [], src = window.efData || [];
        for (j = 0; j < src.length; j++) {
          ef.push({
            label: src[j].label,
            localeLabel: src[j].localeLabel,
            height: src[j].height,
            padding: src[j].padding,
            breakAfter: src[j].breakAfter,
            element: src[j].element
          });
        }

        return {
          format: DATA_FORMAT,
          version: DATA_VERSION,
          createdAt: new Date().toISOString(),
          label: curLabel || '',
          title: (scoreMeta && scoreMeta.title) || (score && score.title) || '',
          total: total,
          legend: curLegend || [],
          notes: notes.map(function (n) {
            return {
              midi: n.midi,
              time: n.time,
              dur: n.dur,
              vel: n.vel,
              trackColor: n.trackColor
            };
          }),
          score: score ? {
            title: score.title || '',
            measures: score.measures || 0,
            parts: score.parts || 0,
            info: score.info || null,
            notes: score.notes.map(function (s) {
              return {
                halfTone: s.halfTone,
                ts: s.ts,
                measure: s.measure,
                part: s.part || 0,
                grace: !!s.grace,
                tie: !!s.tie
              };
            })
          } : null,
          scoreMeta: scoreMeta || null,
          align: alignInfo
            ? { matched: alignInfo.matched, total: alignInfo.total, offset: alignInfo.offset }
            : null,
          svgPages: pages,
          efData: ef,
          // jp2 简谱：导出原始 MusicXML，播放器用同一套 jp2 渲染器重建（efData 已不再使用）。
          musicxml: jp2SourceText || '',
          settings: {
            full88: !!fullChk.checked,
            labels: !!labelChk.checked,
            colorMode: COLOR_MODE,
            flowZoom: flowZoom,
            startMeasure: parseInt((startMeasSel && startMeasSel.value) || '1', 10) || 1,
            // 下面两个是「竖版」的键盘参数（横版不看）：
            //   keyboardLift   = 键盘整体上移多少像素（1080 宽版面；0 = 贴着谱面底部）
            //   keyboardHeight = 琴键高多少像素（1080 宽版面；越小键盘越扁）
            // 取页面里写的 window.KB_EXPORT_LIFT_PX / KB_EXPORT_KEY_H；
            // 页面没写才退回当前页面的实际值。
            keyboardLift: exportLiftPx(bdH),
            keyboardHeight: exportKeyH()
          }
        };
      }

      function exportSongFile(opts) {
        opts = opts || {};
        if (!notes.length) return null;
        var data = collectSongData();
        var jpDesc = data.musicxml
          ? 'MusicXML ' + Math.round(data.musicxml.length / 1024) + 'KB（播放器据此重建简谱）'
          : data.efData.length + ' 节(efData)';
        var js = '/* 键盘播放器数据 —— 由 歌曲生成器.html 的「导出数据 JS」生成。\n' +
          '   用法：存到 keyboard-player.html 旁边即可（播放页默认读 song.data.js），\n' +
          '   或者直接把本文件拖进播放页。\n' +
          '   键盘位置/高度：改 settings.keyboardLift（上移 px）/ settings.keyboardHeight（琴键高 px），\n' +
          '   都按 1080 宽版面算；竖版才生效，横版忽略。默认值在 歌曲生成器.html 的\n' +
          '   window.KB_EXPORT_LIFT_PX / window.KB_EXPORT_KEY_H 里改。\n' +
          '   曲目：' + String(data.title || data.label || '').replace(/\*\//g, '* /') +
          ' · 音符 ' + data.notes.length + ' · 谱面 ' + (data.score ? data.score.notes.length : 0) +
          ' · SVG ' + data.svgPages.length + ' 页 · 简谱 ' + jpDesc + ' */\n' +
          'window.KEYBOARD_DATA = ' + jsonForScript(data) + ';\n';
        return {
          data: data,
          js: js,
          name: opts.name || 'song.data.js'
        };
      }

      function downloadSongFile() {
        var out = exportSongFile();
        if (!out) {
          if (statusEl) statusEl.textContent = '还没有音符可导出：先导入 MIDI（有谱面更好）';
          return null;
        }
        try {
          downloadBlob(new Blob([out.js], { type: 'application/javascript;charset=utf-8' }), out.name);
        } catch (eD) {
          if (statusEl) statusEl.textContent = '导出失败：' + (eD && eD.message ? eD.message : eD);
          return null;
        }
        if (statusEl) {
          statusEl.textContent = '已导出 ' + out.name + '（' + Math.round(out.js.length / 1024) +
            ' KB）：把它放到 keyboard-player.html 旁边即可；换曲子会覆盖同名文件';
        }
        try {
          console.log('[导出数据] ' + out.name + '  ' + Math.round(out.js.length / 1024) + ' KB' +
            '（音符 ' + out.data.notes.length + '，谱面 ' + (out.data.score ? out.data.score.notes.length : 0) +
            '，SVG ' + out.data.svgPages.length + ' 页，简谱 ' + (out.data.musicxml ? 'MusicXML ' + Math.round(out.data.musicxml.length / 1024) + 'KB' : out.data.efData.length + ' 节(efData)') + '）');
        } catch (e) { }
        return out;
      }

      // 把导出数据里的开关写回页面控件
      function applySongSettings(st) {
        if (!st) return;
        try {
          if (typeof st.full88 === 'boolean') fullChk.checked = st.full88;
          if (typeof st.labels === 'boolean') labelChk.checked = st.labels;
          if (st.colorMode) {
            var has = false, i;
            for (i = 0; i < colorModeSel.options.length; i++) {
              if (colorModeSel.options[i].value === st.colorMode) { has = true; break; }
            }
            if (has) {
              colorModeSel.value = st.colorMode;
              COLOR_MODE = st.colorMode;
            }
          }
          var fz = parseFloat(st.flowZoom);
          if (isFinite(fz) && fz > 0) flowZoom = Math.max(0.25, Math.min(1.4, fz));
          // 页面可以强制谱面缩放（16:9 横向舞台用它把「一组谱 + 一行简谱」压进可视区）
          var forced = parseFloat(window.KB_FLOW_ZOOM);
          if (isFinite(forced) && forced > 0) flowZoom = Math.max(0.25, Math.min(1.4, forced));
        } catch (e) { }
        // 数据文件里的键盘参数（竖版）：上移像素 / 琴键高像素，都按 1080 宽版面记
        try {
          if (!HORIZ) {
            var kl = parseFloat(st.keyboardLift);
            if (isFinite(kl) && kl >= 0) setBoardLiftRatio(kl / 1080);
            var kh = parseFloat(st.keyboardHeight);
            if (isFinite(kh) && kh > 0) setKeyH(kh);
          }
        } catch (eK) { }
      }

      // 载入完成后：按数据里的小节号把起播点摆好（顺带把谱面/简谱高亮对到那）
      function applyStartMeasureFromData(st) {
        var sm = parseInt((st && st.startMeasure) || 1, 10) || 1;
        try {
          if (sm > 1 && startMeasSel && !startMeasSel.disabled &&
            sm <= startMeasSel.options.length) {
            startMeasSel.value = String(sm);
            applyStartMeasure();
            return;
          }
          previewAtTime(playFromTime || 0);
        } catch (e) { }
      }

      function resetForLoad() {
        playing = false;
        playBtn.textContent = '播放';
        try { document.body.classList.toggle('cleanplay', false); } catch (e0) { }
        try { if (ac) ac.suspend(); } catch (e1) { }
        stopAllNodes();
        startTime = 0;
        schedPtr = 0;
        visPtr = 0;
        lastStart = {};
        active = [];
        recentOn = [];
        playFromTime = 0;                                   // 换歌时别继承上一首的起播点
        try { if (startMeasSel) startMeasSel.value = '1'; } catch (eSM) { }
        try { clearHighlights(); } catch (e2) { }
        barfill.style.width = '0%';
        curMeasureNo = -1;
        try { clearSvgHi(); hideFlowCursor(); } catch (e3) { }
        flowReady = false;
        svgReady = false;
        blocks = [];
        svgFlat = [];
        scoreBitmaps = [];
        jpBitmaps = [];
        jpHiReset([]);
        try { if (hostEl()) hostEl().innerHTML = ''; } catch (e4) { }
        try { var w0 = wrapEl(); if (w0) w0.hidden = true; } catch (e5) { }
        curGroup = 0;
        sysNow = -1;
      }

      // data = 导出的 window.KEYBOARD_DATA
      function loadSongData(data, opts) {
        opts = opts || {};
        if (!data || !data.notes || !data.notes.length) {
          if (statusEl) statusEl.textContent = '数据无效：里面没有音符（notes 为空）';
          return false;
        }
        var i;

        resetForLoad();

        // 1) 简谱分节
        window.efData = [];
        if (data.efData && data.efData.length) {
          for (i = 0; i < data.efData.length; i++) window.efData.push(data.efData[i]);
        }
        // jp2 简谱：导出文件携带原始 MusicXML 时用同一套渲染器重建（优先于 efData）。
        try { jp2Prepare(data.musicxml || ''); } catch (eJp) { jp2Rich = null; }

        // 2) 谱面（MusicXML 解析结果）
        scoreMeta = data.scoreMeta || null;
        if (data.score && data.score.notes && data.score.notes.length) {
          score = {
            title: data.score.title || '',
            measures: data.score.measures || 0,
            parts: data.score.parts || 0,
            info: data.score.info || null,
            notes: data.score.notes.map(function (s) {
              return {
                halfTone: s.halfTone,
                ts: s.ts,
                measure: s.measure,
                part: s.part || 0,
                grace: !!s.grace,
                tie: !!s.tie
              };
            })
          };
        } else {
          score = null;
        }
        scoreMap = null;
        alignInfo = null;

        // 3) 五线谱页
        pendingPages = [];
        var pages = data.svgPages || [];
        for (i = 0; i < pages.length; i++) {
          var pg = parseSvgDoc(String(pages[i].text || ''));
          if (pg) {
            pg.idx = i;
            pg.name = pages[i].name || ('page-' + (i + 1) + '.svg');
            pendingPages.push(pg);
          } else {
            try { console.warn('[数据] 第 ' + (i + 1) + ' 页 SVG 解析失败，已跳过'); } catch (eW) { }
          }
        }

        // 4) 页面开关（要在建键盘之前写回，键盘按 88 键 / 音名决定画法）
        applySongSettings(data.settings);

        // 5) 音符（setNotes 内部会顺带做 MIDI ↔ 谱面对齐）
        var list = [];
        for (i = 0; i < data.notes.length; i++) {
          var n = data.notes[i];
          list.push({
            midi: n.midi,
            time: n.time,
            dur: n.dur,
            vel: (n.vel === null || n.vel === undefined) ? 0.8 : n.vel,
            trackColor: n.trackColor
          });
        }
        setNotes(list, data.label || data.title || '', data.legend || []);

        // 6) 谱面 + 简谱：等字体、等布局（量得到宽度）再排版
        if (pendingPages.length) {
          var tries = 0, built = false;
          var build = function () {
            if (built) return;
            var host = hostEl(), wrap = wrapEl();
            if (wrap) wrap.hidden = false;
            if ((!host || host.clientWidth < 120) && tries < 40) {
              tries++;
              requestAnimationFrame(build);          // 布局还没稳，下一帧再试
              return;
            }
            built = true;
            try { buildFlow(); }
            catch (eB) { try { console.error('[数据] 谱面渲染失败', eB); } catch (e0) { } }
            try { renderScoreInfo(); } catch (eR) { }
            try { renderScoreHead(); } catch (eH3) { }
            try { refreshLegend(); } catch (eL) { }
            updateStatus();
            applyStartMeasureFromData(data.settings);
          };
          if (fontsReady) requestAnimationFrame(build);
          else waitFonts(function () { requestAnimationFrame(build); });
        } else {
          try { renderScoreInfo(); } catch (eR2) { }
          try { renderScoreHead(); } catch (eH4) { }
          updateStatus();
          applyStartMeasureFromData(data.settings);
        }

        if (dataBtn) dataBtn.disabled = false;
        var infoBtnD = document.getElementById('infoBtn');
        if (infoBtnD) infoBtnD.disabled = false;
        groupsDirty();
        return true;
      }

      // 合并页切换平台后：按「当前页面名 + 平台后缀」重新读一遍存档与默认值，并立刻重排
      function reloadPerPage() {
        try { loadHeadEdits(); } catch (e1) { }
        try { loadHeadTop(); } catch (e2) { }
        try {
          loadCaption();
          applyCaptionStyle();
          captionLastIdx = -2;
          updateCaption(captionNow());
        } catch (e3) { }
        try { loadBoardLift(); syncBoardLift(); } catch (e4) { }
        try {
          var z = parseFloat(window.KB_FLOW_ZOOM);
          if (isFinite(z) && z > 0) {
            var nz = Math.max(0.25, Math.min(1.4, z));
            if (Math.abs(nz - flowZoom) > 0.001) {
              flowZoom = nz;
              if (pendingPages.length) buildFlow();
            }
          }
        } catch (e5) { }
        try { renderScoreHead(); } catch (e6) { }
        try { applyColStyle(); applyHeadSizes(); } catch (e6b) { }
        try { if (typeof window.refreshStepInputs === 'function') window.refreshStepInputs(); } catch (e7) { }
        try { console.log('[平台] 已切到 ' + headPageName() + '，谱面 ' + Math.round(flowZoom * 100) + '%'); } catch (e8) { }
      }

      // ================= 无屏幕共享的「舞台录制」 =================
      // 目的：不碰 CDP 的 Page.startScreencast，也不要 getDisplayMedia 的「分享当前标签页」，
      // 而是把舞台上真实渲染出来的东西（曲名/进度条/谱面/光标/简谱高亮/键盘/字幕）
      // 按 DOM 实测几何逐帧重画到画布，再用 WebCodecs 编成 MP4。
      // 好处：分辨率就是成片分辨率；换台机器只要窗口够大就不用担心抓不到像素。
      var STG = null;                       // 当前录制会话
      var STG_FONT = 'system-ui, "Microsoft YaHei", sans-serif';

      function stgStageEl() { return document.querySelector('.stage'); }

      // 相对基准矩形的 CSS 像素矩形（基准缺省是舞台）
      function stgBox(el, base) {
        if (!el) return null;
        var r = el.getBoundingClientRect();
        if (r.width < 0.5 || r.height < 0.5) return null;
        var b = base || stgStageEl().getBoundingClientRect();
        return { x: r.left - b.left, y: r.top - b.top, w: r.width, h: r.height };
      }

      function stgCss(el) { try { return getComputedStyle(el); } catch (e) { return null; } }

      function stgFontOf(cs, size) {
        if (!cs) return '400 16px ' + STG_FONT;
        return (cs.fontStyle && cs.fontStyle !== 'normal' ? cs.fontStyle + ' ' : '') +
          (cs.fontWeight || '400') + ' ' + (size || 16).toFixed(1) + 'px ' +
          (cs.fontFamily || STG_FONT);
      }

      // 一段文字的快照：盒子、字体、颜色、换行宽度
      function stgTextSnap(el) {
        if (!el) return null;
        var cs = stgCss(el);
        if (!cs || cs.display === 'none' || cs.visibility === 'hidden') return null;
        var txt = String(el.innerText || el.textContent || '').replace(/\u00a0/g, ' ').replace(/^\s+|\s+$/g, '');
        if (!txt) return null;
        var b = stgBox(el);
        if (!b) return null;
        var fs = parseFloat(cs.fontSize) || 16;
        var lh0 = parseFloat(cs.lineHeight) || fs * 1.4;
        return {
          x: b.x, y: b.y, w: b.w, h: b.h, text: txt,
          font: stgFontOf(cs, fs), color: cs.color || '#111827',
          size: fs, ls: parseFloat(cs.letterSpacing) || 0,
          lh: lh0,
          // 页面里本来就不折行的（曲名、键下音名）重画时也别折行：字体度量有细微差别，
          // 按盒子宽度硬折会把它折成两行
          // 盒子的高度只有一行时同样不折行（横版曲名在 flex 里，宽度就是文字宽度）
          nowrap: cs.whiteSpace === 'nowrap' || cs.whiteSpace === 'pre' || cs.display === 'inline' ||
            (b.h > 0 && b.h <= lh0 * 1.35)
        };
      }

      // 简谱位图覆盖的是哪一帧（和 shootJianpu 里量法一致）
      function stgJpFrame(b) {
        if (!b || !b.jpEl) return null;
        var inner = b.jpEl.querySelector('div');
        if (!inner) return null;
        return inner.parentElement || inner;
      }

      // ---------------- 量一遍版面（只在开录时做一次） ----------------
      function stgMeasure(W, H, fps) {
        var stage = stgStageEl();
        if (!stage) return null;
        var sb = stage.getBoundingClientRect();
        if (!sb.width || !sb.height) return null;

        var scene = {
          W: W, H: H, fps: fps, k: W / sb.width, dur: total, scrollTop: 0,
          head: [], bar: null, wrap: null, hostX0: 0, hostY0: 0,
          parts: [], board: null, keys: [], caption: null
        };

        // 1) 谱面抬头（曲名 / 副标题 / 调号 / 谱面信息）
        var headEl = document.getElementById('scoreHead');
        if (headEl) {
          var hs = headEl.querySelectorAll('.sh-name,.sh-sub,.sh-col,.sh-meta');
          for (var i = 0; i < hs.length; i++) {
            var one = stgTextSnap(hs[i]);
            if (one) scene.head.push(one);
          }
        }

        // 2) 进度条
        var barEl = document.getElementById('bar');
        if (barEl) {
          var bb = stgBox(barEl);
          var bcs = stgCss(barEl);
          if (bb) {
            scene.bar = {
              x: bb.x, y: bb.y, w: bb.w, h: bb.h,
              track: (bcs && bcs.backgroundColor) || '#e5e7eb'
            };
          }
        }

        // 3) 谱面窗口 + 每一组（五线谱块 / 简谱块）在内容坐标里的位置
        var wrap = wrapEl();
        var host = document.getElementById('svgHost');
        if (wrap && host) {
          var wb = stgBox(wrap);
          var hb = host.getBoundingClientRect();
          var st0 = wrap.scrollTop || 0;
          scene.wrap = wb;
          scene.hostX0 = hb.left - sb.left;
          scene.hostY0 = hb.top - sb.top + st0;      // 内容 y=0 在舞台里的位置
          scene.scrollTop = st0;
          for (var bi = 0; bi < blocks.length; bi++) {
            var b = blocks[bi];
            var part = { staff: null, jp: null };
            var svg = b.el ? b.el.querySelector('svg') : null;
            if (svg) {
              var sr = svg.getBoundingClientRect();
              if (sr.width > 1) {
                part.staff = {
                  x: sr.left - hb.left, y: sr.top - hb.top,
                  w: sr.width, h: sr.height
                };
              }
            }
            var jf = stgJpFrame(b);
            if (jf) {
              var jr = jf.getBoundingClientRect();
              if (jr.width > 1) {
                part.jp = {
                  x: jr.left - hb.left, y: jr.top - hb.top,
                  w: jr.width, h: jr.height
                };
              }
            }
            scene.parts.push(part);
          }
        }

        // 4) 键盘底板：页面里 `.stage #board` 是深色面板（#12161d + 顶部 1px #232833），
        //    白键是浮在这块深色底上的。少了它，白键在白底上会「消失」、黑键像悬空。
        var boardEl = document.getElementById('board');
        if (boardEl) {
          var bdB = stgBox(boardEl);
          var bdCss = stgCss(boardEl);
          if (bdB) {
            var bdTop2 = bdCss ? (parseFloat(bdCss.borderTopWidth) || 0) : 0;
            scene.board = {
              x: bdB.x, y: bdB.y, w: bdB.w, h: bdB.h,
              bg: (bdCss && bdCss.backgroundColor) || '#12161d',
              bdTop: bdTop2,
              bdColor: (bdCss && bdCss.borderTopColor) || '#232833'
            };
          }
        }

        // 5) 键盘：每个键按实测矩形画（左右位置、黑白、音名都照抄页面）
        //    注意：按下的键会被 transform 下压 1~4px，用 getBoundingClientRect 量会把这段位移
        //    也算进去（重测时正好有键按着 → 整块键盘上下抖 1~4px）。所以这里改成读 offset*（布局盒，
        //    不受 transform 影响），#keys 的盒子仍然用实测矩形。
        var keysRoot = document.getElementById('keys');
        var kr = keysRoot ? stgBox(keysRoot) : null;
        for (var m = viewLow; m <= viewHigh; m++) {
          var keyEl = keyEls[m];
          if (!keyEl) continue;
          var kb = kr
            ? { x: kr.x + keyEl.offsetLeft, y: kr.y + keyEl.offsetTop, w: keyEl.offsetWidth, h: keyEl.offsetHeight }
            : stgBox(keyEl);
          if (!kb || !kb.w || !kb.h) continue;
          var lab = keyEl.querySelector('.lab');
          var lb = null;
          if (lab && kr) {
            var lw = lab.offsetWidth, lh = lab.offsetHeight;
            if (lw) lb = { x: kb.x + lab.offsetLeft, y: kb.y + lab.offsetTop, w: lw, h: lh };
          }
          if (lab && !lb) lb = stgBox(lab);
          var lcs = lab ? stgCss(lab) : null;
          scene.keys.push({
            m: m, black: !isWhite(m),
            x: kb.x, y: kb.y, w: kb.w, h: kb.h,
            lab: (lb && lcs) ? {
              x: lb.x, y: lb.y, w: lb.w, h: lb.h,
              text: String(lab.textContent || '').replace(/\s+/g, ''),
              font: stgFontOf(lcs, parseFloat(lcs.fontSize) || 12),
              color: lcs.color || '#3c3c3c'
            } : null
          });
        }

        // 6) 底部字幕
        var capEl = document.getElementById('kbCaption');
        if (capEl) {
          var ccs = stgCss(capEl);
          var cb = stgBox(capEl);
          if (cb && ccs && ccs.display !== 'none') {
            var cfs = parseFloat(ccs.fontSize) || 22;
            scene.caption = {
              x: cb.x, y: cb.y, w: cb.w, h: cb.h, text: '',
              font: stgFontOf(ccs, cfs), color: ccs.color || '#111827',
              size: cfs, ls: parseFloat(ccs.letterSpacing) || 0,
              lh: parseFloat(ccs.lineHeight) || cfs * 1.5
            };
          }
        }

        return scene;
      }

      // 每帧只需要更新滚动位置和字幕文字
      function stgSceneDyn(scene) {
        var w = wrapEl();
        scene.scrollTop = w ? (w.scrollTop || 0) : 0;
        if (scene.caption) {
          var cap = document.getElementById('kbCaption');
          scene.caption.text = cap
            ? String(cap.innerText || cap.textContent || '').replace(/\u00a0/g, ' ').replace(/\s+$/, '')
            : '';
        }
      }

      // ---------------- 画 ----------------
      function stgRound(c, x, y, w, h, rt, rb) {
        rt = Math.max(0, Math.min(rt, w / 2, h / 2));
        rb = Math.max(0, Math.min(rb, w / 2, h / 2));
        c.beginPath();
        c.moveTo(x + rt, y);
        c.lineTo(x + w - rt, y);
        if (rt) c.quadraticCurveTo(x + w, y, x + w, y + rt); else c.lineTo(x + w, y);
        c.lineTo(x + w, y + h - rb);
        if (rb) c.quadraticCurveTo(x + w, y + h, x + w - rb, y + h); else c.lineTo(x + w, y + h);
        c.lineTo(x + rb, y + h);
        if (rb) c.quadraticCurveTo(x, y + h, x, y + h - rb); else c.lineTo(x, y + h);
        c.lineTo(x, y + rt);
        if (rt) c.quadraticCurveTo(x, y, x + rt, y); else c.lineTo(x, y);
        c.closePath();
      }

      // clip-path 多边形（0~1 相对点）→ 路径，用于简谱「按字」高亮
      function stgPolyPath(c, x, y, w, h, pts) {
        c.beginPath();
        for (var i = 0; i < pts.length; i++) {
          var px = x + pts[i][0] * w, py = y + pts[i][1] * h;
          if (i === 0) c.moveTo(px, py); else c.lineTo(px, py);
        }
        c.closePath();
      }

      // 按盒子宽度折行（中文逐字断，和 CSS 的折行结果基本一致）
      function stgWrapLines(c, text, maxW) {
        var out = [], paras = String(text).split('\n');
        for (var p = 0; p < paras.length; p++) {
          var s = paras[p], line = '';
          for (var i = 0; i < s.length; i++) {
            var ch = s.charAt(i);
            if (line && c.measureText(line + ch).width > maxW) { out.push(line); line = ch; }
            else line += ch;
          }
          out.push(line);
        }
        return out;
      }

      function stgDrawText(c, s, text) {
        if (!s || !text) return;
        var txt = String(text);
        c.save();
        try {
          c.font = s.font;
          c.fillStyle = s.color;
          c.textAlign = 'center';
          c.textBaseline = 'middle';
          if (s.ls) c.letterSpacing = s.ls + 'px';
        } catch (eF) { }
        var lines = s.nowrap ? txt.split('\n') : stgWrapLines(c, txt, Math.max(8, s.w - 2));
        var lh = s.lh || s.size * 1.4;
        var cx = s.x + s.w / 2;
        // 行数 × 行高超出盒子时整体缩小，避免第一行被画到画布上方（导出的标题被裁就是这个）
        var blockH = lines.length * lh;
        if (s.h > 0 && blockH > s.h * 1.02) {
          var kFit = s.h / blockH;
          var cy = s.y + s.h / 2;
          c.translate(cx, cy);
          c.scale(kFit, kFit);
          c.translate(-cx, -cy);
          lh = lh;
        }
        var y0 = s.y + (s.h - lines.length * lh) / 2 + lh / 2;
        for (var i = 0; i < lines.length; i++) {
          if (lines[i]) c.fillText(lines[i], cx, y0 + i * lh);
        }
        c.restore();
      }

      // 简谱高亮：照抄「页面这一帧点亮了哪些块」。
      // 页面 tick 里已经调用过 jpHighlightAt()，jpHiNow 就是当前点亮的那几块；
      // 导出时直接画它们，位置/时机就与页面完全一致（自己再算一遍会差一帧）。
      var stgHlCache = (typeof WeakMap === 'function') ? new WeakMap() : null;

      // 页面给点亮块加了 filter:saturate(1.4) + opacity:.9，
      // canvas 没有滤镜，这里把颜色按同样规则调一遍，看起来才一样。
      function stgLitColor(src) {
        var m = /rgba?\(([^)]+)\)/.exec(String(src || ''));
        var r = 232, g = 160, b = 160;
        if (m) {
          var p = m[1].split(',');
          r = parseFloat(p[0]); g = parseFloat(p[1]); b = parseFloat(p[2]);
          if (!isFinite(r) || !isFinite(g) || !isFinite(b)) { r = 232; g = 160; b = 160; }
        }
        r /= 255; g /= 255; b /= 255;
        var mx = Math.max(r, g, b), mn = Math.min(r, g, b), h = 0, s = 0, l = (mx + mn) / 2;
        if (mx !== mn) {
          var d = mx - mn;
          s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
          if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
          else if (mx === g) h = (b - r) / d + 2;
          else h = (r - g) / d + 4;
          h /= 6;
        }
        s = Math.min(1, s * 1.4);
        var q = l < 0.5 ? l * (1 + s) : l + s - l * s, pp = 2 * l - q;
        function hue(t) {
          if (t < 0) t += 1;
          if (t > 1) t -= 1;
          if (t < 1 / 6) return pp + (q - pp) * 6 * t;
          if (t < 1 / 2) return q;
          if (t < 2 / 3) return pp + (q - pp) * (2 / 3 - t) * 6;
          return pp;
        }
        var rr = Math.round(hue(h + 1 / 3) * 255), gg = Math.round(hue(h) * 255), bb = Math.round(hue(h - 1 / 3) * 255);
        // 成片里的高亮要和页面一样「实」：原来 0.9 叠在白谱面上偏淡
        return 'rgba(' + rr + ',' + gg + ',' + bb + ',1)';
      }

      function stgHlOf(el, ir) {
        var rec = stgHlCache ? stgHlCache.get(el) : null;
        if (rec && rec.key === ir.width + 'x' + ir.height) return rec;
        var r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) return null;
        var col = '#e8a0a0';
        try { col = getComputedStyle(el).backgroundColor || col; } catch (eC) { }
        rec = {
          key: ir.width + 'x' + ir.height,
          x0: (r.left - ir.left) / ir.width,
          x1: (r.right - ir.left) / ir.width,
          y0: (r.top - ir.top) / ir.height,
          y1: (r.bottom - ir.top) / ir.height,
          c: stgLitColor(col),
          p: expPolyOf(el)
        };
        if (stgHlCache) stgHlCache.set(el, rec);
        return rec;
      }

      // 切组时把「此刻点亮的简谱块」抓成快照，供录制画布逐帧复用：
      // 只取当前这一行里的块，坐标归一化到该行框 —— 这样画布永远不会画到别行/别组去。
      function stgTakeHl(g) {
        if (!STG || !STG.on) return;
        var rowEl = null, items = [], i;
        for (i = 0; i < jpHiNow.length; i++) {
          var el0 = jpHiNow[i] && jpHiNow[i].el;
          if (!el0) continue;
          for (var bi = 0; bi < blocks.length; bi++) {
            if (blocks[bi].jpEl && blocks[bi].jpEl.contains(el0)) { rowEl = blocks[bi].jpEl; break; }
          }
          if (rowEl) break;
        }
        if (rowEl) {
          var frame = rowEl.querySelector('div') || rowEl;
          if (frame && frame.parentElement) frame = frame.parentElement;
          var ir = null;
          try { ir = frame.getBoundingClientRect(); } catch (eIR) { ir = null; }
          if (ir && ir.width) {
            for (i = 0; i < jpHiNow.length; i++) {
              var el1 = jpHiNow[i] && jpHiNow[i].el;
              if (!el1 || !rowEl.contains(el1)) continue;
              var rec = null;
              try { rec = stgHlOf(el1, ir); } catch (eR) { rec = null; }
              if (rec) items.push(rec);
            }
          }
        }
        STG.hl = { rowEl: rowEl, items: items };
      }

      // 谱面窗口：把每一组的位图贴回它自己的盒子里，再叠光标框 / 简谱高亮
      function stgDrawScore(c, scene, t, cur, curColor) {
        var wrap = scene.wrap;
        if (!wrap || !scene.parts.length) return;

        var ox = scene.hostX0 - (HORIZ ? (wrap.scrollLeft || 0) : 0);
        if (HORIZ) {
          // 录制时按滚动的 rAF 可能没跑到，直接按「当前这一列居中」算镜头位置，成片才会随播放推进
          var cbH = (typeof curGroup === 'number' && blocks[curGroup]) ? blocks[curGroup] : null;
          var colH = cbH && cbH.el ? cbH.el.parentNode : null;
          if (colH && scene.wrap) {
            var cxH = colH.offsetLeft + colH.offsetWidth / 2;
            // 换行：按「光标在本行里的横向进度」推进镜头。
            // 前 50% 不动（这一行还接近中间），后 50% 匀速把下一列挪到中间，行尾正好到位。
            // 用进度而不用小节号，避免不同行小节数不同时有的行只滑一小段、看起来像直接切。
            var nxH = colH.nextElementSibling;
            if (curNoteGeo && curNoteGeo.blk === curGroup && nxH &&
              nxH.classList && nxH.classList.contains('flowCol') && cbH && cbH.vbW > 0) {
              // 用「本行第几个音 / 本行总音数」当进度：最后一个音时正好 100%，
              // 这样换行那一刻镜头刚好到位，不会在换行时再跳一下。
              var sFromH = (typeof cbH.scoreFrom === 'number') ? cbH.scoreFrom : 0;
              var sToH = (typeof cbH.scoreTo === 'number') ? cbH.scoreTo : 0;
              // 进度 = 本行的时间进度（第一个小节开始 → 下一行第一个小节开始）：
              // 前 50% 镜头不动，后 50% 匀速把下一列推到中间，换行那一刻正好到位。
              var fH = 0;
              if (typeof cbH.mFrom === 'number' && typeof cbH.mTo === 'number') {
                var t0H = measureStartTime(cbH.mFrom + 1);
                var t1H = measureStartTime(cbH.mTo + 2);
                if (t1H > t0H) {
                  fH = (t - t0H) / (t1H - t0H);
                  if (fH < 0) fH = 0; if (fH > 1) fH = 1;
                }
              }
              var pH = (fH - 0.5) / 0.5;
              if (pH < 0) pH = 0; if (pH > 1) pH = 1;
              pH = pH * pH * (3 - 2 * pH);
              cxH = cxH + (nxH.offsetLeft + nxH.offsetWidth / 2 - cxH) * pH;
              try { window.__panDbg = { t: Math.round(t * 100) / 100, f: Math.round(fH * 1000) / 1000, p: Math.round(pH * 1000) / 1000, mF: cbH.mFrom, mT: cbH.mTo, g: curGroup, tg: Math.round(cxH - scene.wrap.w / 2), ww: Math.round(scene.wrap.w), hx: Math.round(scene.hostX0), co: Math.round(colH.offsetLeft), cw: Math.round(colH.offsetWidth), sw: Math.round(colH.parentNode ? colH.parentNode.scrollWidth : 0) }; } catch (ePD) { }
            }
            var tgH = cxH - scene.wrap.w / 2;
            var mxH = Math.max(0, (colH.parentNode ? colH.parentNode.scrollWidth : 0) - scene.wrap.w);
            if (tgH < 0) tgH = 0;
            if (tgH > mxH) tgH = mxH;
            ox = scene.hostX0 - tgH;
          }
        }
        var oy = scene.hostY0 - scene.scrollTop;

        c.save();
        c.beginPath();
        c.rect(wrap.x, wrap.y, wrap.w, wrap.h);
        c.clip();

        var cg = (typeof curGroup === 'number') ? curGroup : 0;

        for (var i = 0; i < scene.parts.length; i++) {
          var p = scene.parts[i];
          if (!p.staff) continue;
          var sy = oy + p.staff.y;
          if (sy > wrap.y + wrap.h || sy + p.staff.h < wrap.y) continue;
          var sbmp = scoreBitmaps[i];
          if (sbmp) {
            c.drawImage(sbmp, 0, 0, sbmp.width, sbmp.height,
              ox + p.staff.x, sy, p.staff.w, p.staff.h);
          } else {
            c.fillStyle = '#fff';
            c.fillRect(ox + p.staff.x, sy, p.staff.w, p.staff.h);
          }
        }

        // 简谱当前高亮：直接镜像「页面这一帧真正可见的方块」。
        // 不再读 jpHiNow / 快照 —— 它们会带进别组、别行的残留，成片里就成了整行彩块。
        // 判定标准与页面一致：computed visibility 可见、opacity > 0.5。
        var hiRow2 = (typeof cg === 'number' && cg >= 0 && blocks[cg]) ? cg : -1;
        var pj2 = hiRow2 >= 0 ? scene.parts[hiRow2] : null;
        var bc2 = hiRow2 >= 0 ? blocks[hiRow2] : null;
        if (pj2 && pj2.jp && bc2 && bc2.jpEl) {
          var jy3 = oy + pj2.jp.y;
          var jir2 = null;
          try {
            var jinner2 = bc2.jpEl.querySelector('div');
            var jframe2 = jinner2 ? jinner2.parentElement : bc2.jpEl;
            jir2 = jframe2 ? jframe2.getBoundingClientRect() : null;
          } catch (eJR2) { jir2 = null; }
          if (jir2 && jir2.width > 0) {
            var cand2 = bc2.jpEl.querySelectorAll('.SparksNMN-notehl');
            for (var li2 = 0; li2 < cand2.length; li2++) {
              var el2 = cand2[li2], cs2 = null;
              try { cs2 = getComputedStyle(el2); } catch (eCS) { cs2 = null; }
              if (!cs2) continue;
              if (cs2.visibility === 'hidden' || cs2.display === 'none') continue;
              // 页面「这一刻点亮了哪一块」的唯一可靠标记是 .jpHit 这个类
              // （jpHiReset 给它点亮的那几个加类、把旧的去掉）。方块自带的背景色是
              // 谱面自带的调色板，任何时候都有，不能拿它判断高亮。
              if (!el2.classList || !el2.classList.contains('jpHit')) continue;
              var rec2 = null;
              try { rec2 = stgHlOf(el2, jir2); } catch (eG2) { rec2 = null; }
              if (!rec2) continue;
              var rx2 = ox + pj2.jp.x + rec2.x0 * pj2.jp.w;
              var rw2 = Math.max(2, (rec2.x1 - rec2.x0) * pj2.jp.w);
              var ry2 = jy3 + rec2.y0 * pj2.jp.h;
              var rh2 = Math.max(2, (rec2.y1 - rec2.y0) * pj2.jp.h);
              c.save();
              c.fillStyle = rec2.c;
              if (rec2.p) stgPolyPath(c, rx2, ry2, rw2, rh2, rec2.p);
              else stgRound(c, rx2, ry2, rw2, rh2, 2, 2);
              c.fill();
              c.restore();
            }
          }
        }

        // 简谱位图统一以 multiply 叠到色块上（没有高亮的块下方是纯白，乘完不变）
        for (var ij = 0; ij < scene.parts.length; ij++) {
          var pjp = scene.parts[ij];
          if (!pjp.jp) continue;
          var jy = oy + pjp.jp.y;
          if (jy > wrap.y + wrap.h || jy + pjp.jp.h < wrap.y) continue;
          var jbmp = jpBitmaps[ij];
          if (!jbmp) continue;
          c.save();
          try { c.globalCompositeOperation = 'multiply'; } catch (eMul) { }
          c.drawImage(jbmp, 0, 0, jbmp.width, jbmp.height,
            ox + pjp.jp.x, jy, pjp.jp.w, pjp.jp.h);
          c.restore();
        }

        // 五线谱当前音符的红框
        var ps = scene.parts[cg];
        var sbmp2 = scoreBitmaps[cg];
        var blk = blocks[cg];
        if (ps && ps.staff && sbmp2 && blk && curNoteGeo && curNoteGeo.blk === cg) {
          var sx = ps.staff.w / sbmp2.width;             // 位图 px → 舞台 px
          var sc = sbmp2.width / (blk.vbW || 1);         // SVG 单位 → 位图 px
          var bx = (curNoteGeo.x + 16 - (blk.vbLeft || 0)) * sc;
          var byTop = (blk.staffTop - blk.vbTop) * sc;
          var byBot = (blk.staffBottom - blk.vbTop) * sc;
          var px = ox + ps.staff.x + bx * sx;
          var py = oy + ps.staff.y + byTop * sx;
          var ph = Math.max(6, (byBot - byTop) * sx);
          var pw = Math.max(8, 70 * sc * sx);
          // 五线谱红框（只覆盖五线谱，不再延长）
          c.beginPath();
          stgRound(c, px - pw / 2, py, pw, ph, 4, 4);
          c.fillStyle = 'rgba(217, 43, 37, .18)';
          c.fill();
          c.lineWidth = Math.max(1.5, pw * 0.14);
          c.strokeStyle = 'rgba(217, 43, 37, .88)';
          c.stroke();
          // 简谱蓝框：与五线谱框切分开、颜色区分；高度 = 当前小节在所有声部内的内容高度（用户要求 m01232 / m01431 / m01475）
          if (blk.jp2 && ps.jp) {
            var jpy = oy + ps.jp.y;
            var jph = Math.max(6, ps.jp.h);
            try {
              var ancRec = blk.jp2.bySi ? blk.jp2.bySi[scoreOfSvg(curNoteGeo.idx)] : null;
              var recMnum = null;
              if (ancRec && ancRec.col && ancRec.col.members) {
                for (var rmi = 0; rmi < ancRec.col.members.length; rmi++) {
                  if (ancRec.col.members[rmi].mnum != null) { recMnum = ancRec.col.members[rmi].mnum; break; }
                }
              }
              if (recMnum != null && blk.jp2.anchors && blk.jpEl) {
                var jrR = blk.jpEl.getBoundingClientRect();
                var jpScY = ps.jp.h / (blk.jpEl.offsetHeight || ps.jp.h);
                var rmTop = Infinity, rmBot = -Infinity;
                for (var rai = 0; rai < blk.jp2.anchors.length; rai++) {
                  var ran = blk.jp2.anchors[rai];
                  if (!ran.col || !ran.col.members || !ran.el) continue;
                  var rIn = false;
                  for (var rmj = 0; rmj < ran.col.members.length; rmj++) {
                    if (ran.col.members[rmj].mnum === recMnum) { rIn = true; break; }
                  }
                  if (!rIn) continue;
                  var rar = ran.el.getBoundingClientRect();
                  if (rar.top < rmTop) rmTop = rar.top;
                  if (rar.bottom > rmBot) rmBot = rar.bottom;
                }
                if (isFinite(rmTop) && isFinite(rmBot)) {
                  jpy = oy + ps.jp.y + (rmTop - jrR.top) * jpScY;
                  jph = Math.max(6, (rmBot - rmTop) * jpScY);
                }
              }
            } catch (eJpRec) { }
            c.beginPath();
            stgRound(c, px - pw / 2, jpy, pw, jph, 4, 4);
            c.fillStyle = 'rgba(47, 129, 247, .18)';
            c.fill();
            c.strokeStyle = 'rgba(47, 129, 247, .88)';
            c.stroke();
          }
        }

        c.restore();
      }

      // 键盘：白键先铺、黑键压在上面，按下色和页面同一套
      function stgDrawKeys(c, scene, t, cur, curColor) {
        var i, kk;
        c.save();
        for (i = 0; i < scene.keys.length; i++) {
          kk = scene.keys[i];
          if (kk.black) continue;
          var on = !!(cur && cur[kk.m]);
          var dip = dipOf(kk.m, t, kk.h, on);
          c.fillStyle = on ? (curColor[kk.m] || '#2f81f7') : '#ffffff';
          stgRound(c, kk.x, kk.y + dip, kk.w, kk.h - dip, 0, 3);
          c.fill();
          if (kk.lab && kk.lab.text) {
            stgDrawText(c, { x: kk.lab.x, y: kk.lab.y, w: kk.lab.w, h: kk.lab.h,
              font: kk.lab.font, color: on ? '#ffffff' : kk.lab.color,
              size: 12, lh: kk.lab.h, nowrap: true }, kk.lab.text);
          }
        }
        // 白键分隔线单独一遍、放在所有白键铺完之后：
        // ① 以前是「铺一个键顺带画一条线」，右边那个键的白色圆角会把上一条线的两端压掉一截，
        //    看着就像那条线短了/淡了；② 1.5px 落在小数坐标上，抗锯齿后时粗时细 —— 成片里
        //    就会出现「某一条线跟别的不一样」。这里把 x 取整、宽度固定 2px，每条都一样。
        for (i = 0; i < scene.keys.length; i++) {
          kk = scene.keys[i];
          if (kk.black) continue;
          var onB = !!(cur && cur[kk.m]);
          var dipB = dipOf(kk.m, t, kk.h, onB);
          var sxB = Math.round(kk.x + kk.w) - 2;
          c.fillStyle = '#6f7987';
          c.fillRect(sxB, kk.y + dipB, 2, kk.h - dipB);
        }
        for (i = 0; i < scene.keys.length; i++) {
          kk = scene.keys[i];
          if (!kk.black) continue;
          var on2 = !!(cur && cur[kk.m]);
          var dip2 = dipOf(kk.m, t, kk.h, on2);
          var y2 = kk.y + dip2, h2 = kk.h - dip2;
          stgRound(c, kk.x, y2, kk.w, h2, 3, 3);
          // 页面：黑键 box-shadow 0 2px 3px rgba(0,0,0,.45)（按下时 0 1px 2px .4）
          c.shadowColor = on2 ? 'rgba(0,0,0,.40)' : 'rgba(0,0,0,.45)';
          c.shadowBlur = on2 ? 2 : 3;
          c.shadowOffsetY = on2 ? 1 : 2;
          if (on2) {
            c.fillStyle = curColor[kk.m] || '#2f81f7';
          } else {
            var g = c.createLinearGradient(0, y2, 0, y2 + h2);
            g.addColorStop(0, '#3b3b3b');
            g.addColorStop(0.14, '#1d1d1d');
            g.addColorStop(0.7, '#101010');
            g.addColorStop(1, '#060606');
            c.fillStyle = g;
          }
          c.fill();
          c.shadowColor = 'transparent';
          c.shadowBlur = 0;
          c.shadowOffsetY = 0;
          if (kk.lab && kk.lab.text) {
            stgDrawText(c, { x: kk.lab.x, y: kk.lab.y, w: kk.lab.w, h: kk.lab.h,
              font: kk.lab.font, color: on2 ? '#ffffff' : kk.lab.color,
              size: 12, lh: kk.lab.h, nowrap: true }, kk.lab.text);
          }
        }
        c.restore();
      }

      function stgRenderFrame(c, scene, t, cur, curColor) {
        var k = scene.k || 1;
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.globalAlpha = 1;
        c.fillStyle = '#ffffff';
        c.fillRect(0, 0, scene.W, scene.H);
        c.save();
        c.scale(k, k);

        var i;
        for (i = 0; i < scene.head.length; i++) stgDrawText(c, scene.head[i], scene.head[i].text);

        if (scene.bar) {
          var bb = scene.bar;
          c.fillStyle = bb.track;
          c.fillRect(bb.x, bb.y, bb.w, bb.h);
          var ratio = scene.dur > 0 ? Math.max(0, Math.min(1, t / scene.dur)) : 0;
          if (ratio > 0.001) {
            var g = c.createLinearGradient(bb.x, 0, bb.x + bb.w, 0);
            g.addColorStop(0, '#2f81f7');
            g.addColorStop(1, '#7ee787');
            c.fillStyle = g;
            c.fillRect(bb.x, bb.y, Math.max(1, bb.w * ratio), bb.h);
          }
        }

        stgDrawScore(c, scene, t, cur || {}, curColor || {});
        // 键盘底板（深色面板）：白键要浮在深色底上，页面就是这样的
        if (scene.board) {
          var bdb = scene.board;
          if (bdb.bdTop > 0) {
            c.fillStyle = bdb.bdColor;
            c.fillRect(bdb.x, bdb.y, bdb.w, bdb.bdTop);
          }
          c.fillStyle = bdb.bg;
          c.fillRect(bdb.x, bdb.y + bdb.bdTop, bdb.w, Math.max(0, bdb.h - bdb.bdTop));
        }
        stgDrawKeys(c, scene, t, cur || {}, curColor || {});
        if (scene.caption && scene.caption.text) stgDrawText(c, scene.caption, scene.caption.text);

        c.restore();
      }

      // ---------------- 录制主流程 ----------------
      // 每帧：先重画舞台，再按「播放时间 / 1fps」刻度把画布帧喂给编码器（CFR，
      // 掉帧只会让画面重复，不会让成片变短，也和实时录下来的音频天然对齐）
      // 重测出来的版面是否可信：录制中途重测时页面可能正处在「换行/重排」的瞬间，
      // 那一下量到的行高会塌、甚至几行量成同一个位置（成片里表现为多行谱面叠在一起）。
      // 不可信就保留旧版面，宁可差 1~2px 也不要画花。

      function stgSceneOk(sc) {
        if (!sc || !sc.parts || !sc.parts.length || !sc.keys || !sc.keys.length) return false;
        if (!(sc.wrap && sc.wrap.h > 200)) return false;
        var prev = -1e9;
        for (var i = 0; i < sc.parts.length; i++) {
          var p = sc.parts[i];
          if (!p || !p.staff || !p.jp) return false;
          if (!(p.staff.h > 20) || !(p.jp.w > 100) || !(p.jp.h > 12)) return false;
          if (!(p.jp.y > prev)) return false;   // 每行位置必须递增，重复说明量歪了
          prev = p.jp.y;
        }
        return true;
      }

      function stgTick(t, cur, curColor) {
        var st = STG;
        if (!st || !st.on) return;

        if (document.hidden || document.visibilityState === 'hidden') {
          // 后台标签页会被浏览器节流（rAF 停掉），画面和声音都会断——直接判失败，
          // 别上传一个「半截」的成片
          st.abort = '录制页被切到后台了（浏览器会暂停动画帧），请把录制页放在最前面重试';
          stgFinish(false, st.abort);
          return;
        }

        if (st.startT === null) st.startT = Math.min(0, t);
        st.lastT = t;

        // 版面在「曲目载入完成 / 字体就绪 / 切平台 / 抬头长高」之后还会再变（谱面抬头从 1 行长到
        // 4 行时，下面的谱面窗口与键盘会整体下移 40px）。用 ResizeObserver 盯着抬头、键盘底板和
        // 舞台，一有尺寸变化就重测一次，保证成片里的键盘位置/高度跟播放页面完全一致。
        if (st.frames === 0 || st.frames === 5) {
          st.geomDirty = false;
          st.lastGeomAt = st.frames;
          try {
            var sc2 = stgMeasure(st.W, st.H, st.fps);
            if (stgSceneOk(sc2)) st.scene = sc2;
          } catch (eRM) { }
        }

        stgSceneDyn(st.scene);
        stgRenderFrame(st.ctx, st.scene, t, cur, curColor);

        var ts = t - st.startT;
        var step = 1 / st.fps;
        var guard = 0;
        while (st.nextT <= ts + 1e-4 && guard++ < 6) {
          try {
            var frame = new VideoFrame(st.canvas, {
              timestamp: Math.round(st.nextT * 1e6),
              duration: Math.round(step * 1e6)
            });
            mp4.venc.encode(frame, { keyFrame: (st.frames % Math.max(1, st.fps * 2) === 0) });
            frame.close();
            st.frames++;
          } catch (e) {
            st.encodeErr = '编码失败：' + (e && e.message ? e.message : e);
            break;
          }
          st.nextT += step;
        }

        if (st.onProgress && (st.frames % 5 === 0)) {
          try { st.onProgress(t, st.scene.dur || total, st.frames); } catch (eP) { }
        }
      }

      function stgFinish(keep, reason) {
        var st = STG;
        if (!st || !st.on) return;
        st.on = false;
        if (st.ro) { try { st.ro.disconnect(); } catch (eRO2) { } st.ro = null; }
        stopPcmCapture();
        if (playing) { try { togglePlay(); } catch (ePl) { } }
        try { jpClearAll(); } catch (eJC3) { }   // 成片收尾时别让最后一组简谱一直亮着
        try { stgJpMask(false); } catch (eJM) { } // 录制结束，把简谱高亮方块还给页面

        var done = function (blob, err) {
          mp4.on = false;
          mp4.muxer = null; mp4.venc = null; mp4.aenc = null;
          exporting = false;
          if (STG === st) STG = null;
          var msg = err ? (err.message || String(err)) : '';
          if (msg) { try { console.warn('[录制] ' + msg); } catch (eW) { } }
          if (st.resolve) {
            if (err) st.reject(err); else st.resolve(blob);
          }
        };

        if (!keep) { done(null, new Error(reason || '录制已取消')); return; }

        var fin = function () {
          try {
            mp4.muxer.finalize();
            var buf = mp4.muxer.target.buffer;
            if (!buf || !buf.byteLength) {
              throw new Error(reason || ('没有录到画面' + (mp4.err ? ('：' + mp4.err) : '')));
            }
            done(new Blob([buf], { type: 'video/mp4' }));
          } catch (e) {
            done(null, new Error(reason || ('封装 MP4 失败：' + (e && e.message ? e.message : e) + (mp4.err ? ('（' + mp4.err + '）') : '') + (mp4.vencErr ? ('[venc ' + mp4.vencErr + ']') : '') + (mp4.encErr ? ('[enc ' + mp4.encErr + ']') : '') + (mp4.meta0 ? ('[meta0 ' + mp4.meta0 + ']') : ''))));
          }
        };

        var f1 = mp4.venc ? mp4.venc.flush().catch(function () { }) : Promise.resolve();
        f1.then(function () { return encodeCapturedAudio(); })
          .then(function () { return mp4.aenc ? mp4.aenc.flush().catch(function () { }) : null; })
          .then(fin)
          .catch(function (e2) { done(null, e2); });
      }

      // 录制期间把页面自带的简谱高亮方块整批藏起来：
      // ① 栅格化（shootJianpu）时它们只要还亮着就会被当成「本来就有颜色」烤进位图，
      //    成片里就会永远留着一堆彩块；② 画布上的高亮由 stgDrawScore 自己画，不需要它们显形。
      // visibility:hidden 不改布局，getBoundingClientRect / offsetTop 仍然可量。
      function stgJpMask(on) {
        var id = 'kb-jp-mask';
        var el = document.getElementById(id);
        if (on) {
          if (el) return;
          el = document.createElement('style');
          el.id = id;
          el.textContent = '#svgHost .SparksNMN-notehl{visibility:hidden !important;opacity:0 !important;filter:none !important}';
          document.head.appendChild(el);
        } else if (el && el.parentNode) {
          el.parentNode.removeChild(el);
        }
      }

      // 开始录制：opt = { W, H, fps, audio, onProgress }，返回 Promise<Blob(MP4)>
      function recordStage(opt) {
        opt = opt || {};
        return new Promise(function (resolve, reject) {
          if (STG && STG.on) { reject(new Error('已经在录制了')); return; }
          if (!notes.length) { reject(new Error('还没有载入曲目')); return; }
          if (!window.VideoEncoder || !window.VideoFrame || !window.Mp4Muxer) {
            reject(new Error('当前浏览器不支持 WebCodecs，请用 Chrome / Edge 94 以上'));
            return;
          }
          var W = ((opt.W | 0) || 1080) & ~1;
          var H = ((opt.H | 0) || 1920) & ~1;
          var fps = Math.max(1, Math.min(60, (opt.fps | 0) || 30));
        // Chrome 的 WebCodecs H.264 编码器最高只吃 30fps（1080p60 一律 init 失败），
        // 所以这里按 30 编码，60fps 由服务端用 ffmpeg 重新计时成片
        // 60fps 走 VP9 编码（H.264 编码器不支持 60fps）

          ensureAudio();
          var go = function () {
        // 注意：录制期间不要遮罩简谱高亮方块 —— 画布是按「页面可见」镜像的，藏了就等于没高亮。
            shootScore(function () {
              var scene;
              try { scene = stgMeasure(W, H, fps); }
              catch (eM) { reject(new Error('量版面失败：' + (eM && eM.message ? eM.message : eM))); return; }
              if (!scene) { reject(new Error('舞台尺寸为 0，无法录制')); return; }
              if (!scene.parts.length) { reject(new Error('谱面还没渲染出来，无法录制')); return; }
              // 舞台必须就是 W×H（录制页用 body.rec-mode 把 .stage 钉成 1080×1920）。
              // 在普通标签页里「就地录制」时舞台只有窗口那么大，位图会被放大成模糊，
              // 版面比例也不对，所以宁可报错让用户改用新页面录制。
              if (Math.abs(scene.k - 1) > 0.02) {
                reject(new Error('录制舞台宽 ' + Math.round(W / scene.k) + 'px，不是 ' + W + '×' + H +
                  ' 的版面；请点「导出视频」让浏览器新开一个录制页来录'));
                return;
              }

              var s = { W: W, H: H, fps: fps };
              if (!mp4InitFor(s, !!opt.audio)) {
                var err = mp4.err || '编码器初始化失败';
                mp4.on = false;
                reject(new Error(err));
                return;
              }

              var cv = document.createElement('canvas');
              cv.width = W;
              cv.height = H;
              var ctx = cv.getContext('2d', { alpha: false });

              var st = {
                on: true, fps: fps, canvas: cv, ctx: ctx, scene: scene,
                nextT: 0, frames: 0, startT: null, lastT: 0,
                geomDirty: false, ro: null,
                onProgress: opt.onProgress || null,
                resolve: resolve, reject: reject, abort: '', encodeErr: ''
              };
              STG = st;
              exporting = true;

              try {
                if (window.ResizeObserver) {
                  st.ro = new ResizeObserver(function () { st.geomDirty = true; });
                  var stgEl = stgStageEl();
                  if (stgEl) st.ro.observe(stgEl);
                  var hdEl = document.getElementById('scoreHead');
                  if (hdEl) st.ro.observe(hdEl);
                  var bdEl = document.getElementById('board');
                  if (bdEl) st.ro.observe(bdEl);
                  var wrEl = wrapEl();
                  if (wrEl) st.ro.observe(wrEl);
                }
              } catch (eRO) { st.ro = null; }

              try { renderScoreHead(); } catch (eH) { }
              try { restart(); } catch (eR) { }

              stgRenderFrame(ctx, scene, 0, {}, {});
              startPcmCapture(0);
              togglePlay();
            });
          };

          if (ac && ac.state === 'suspended') {
            ac.resume().then(go).catch(go);
          } else {
            go();
          }
        });
      }

      // 页面暴露给「导出数据 JS」按钮 / 独立播放页用
      // ============ 离线逐帧渲染 + 编码（方案 C） ============
      // 与「实时播放」解耦：t 由 i/fps 算出，逐帧把 1080×1920 画到 canvas 再编码；
      // 音频用 OfflineAudioContext 一次性合成。好处：
      //   · 帧数精确（N = round(总时长 × fps)），不会掉帧
      //   · 不受标签页后台节流影响，不再有「切到后台就失败」
      //   · 时间戳直接由 i 算出，音画严格对齐
      // 代价：必须把「按播放时间推进的可视状态」自己跑一遍（stgOfflineStep）。

      // 把 tick() 里与时间相关的可视状态推进抄一份（指针单调，结果确定）：
      // 谱面框/简谱高亮 → 新按下的音符 → 活动表 → 键盘按下色/位移 → 进度条/时间 → 字幕
      function stgOfflineStep(t) {
        var i, n, m, el;
        var gok = false;
        try { if (svgReady) gok = syncGroupCursor(t); } catch (eGrp) { }
                try { jpHiFollowActive(); } catch (eHiF) { }
        // 谱面滚动：按播放时间连续驱动，快到下一行时慢慢滚（见 scrollYAt）
        try { applyScrollAt(t); } catch (eScr) { }
        if (!gok) {
          try {
            if (svgReady && visPtr > 0) {
              var kFb = svgIndexForMidi(visPtr - 1);
              if (kFb >= 0 && kFb !== gLastK) {
                clearSvgHi();
                paintSvgAt(kFb);
                positionSvgCursorAt(kFb);
                gLastK = kFb;
              }
            }
          } catch (eFb) { }
        }
        while (visPtr < notes.length && notes[visPtr].time <= t) {
          n = notes[visPtr++];
          n.__mi = visPtr - 1;
          lastStart[n.midi] = n.time;
          active.push(n);
          recentOn.push(n);
          try { hitScore(visPtr - 1, n, t); } catch (eSc) { }
        }
        try { expireScore(t); } catch (eEx) { }
        for (i = active.length - 1; i >= 0; i--) {
          if (t >= active[i].time + active[i].dur) active.splice(i, 1);
        }
        for (i = recentOn.length - 1; i >= 0; i--) {
          if (t - recentOn[i].time > 0.2) recentOn.splice(i, 1);
        }
        var cur = {}, curColor = {};
        for (i = 0; i < active.length; i++) {
          cur[active[i].midi] = 1;
          curColor[active[i].midi] = colorOf(active[i]);
        }
        for (m in cur) {
          if (!prevOn[m]) {
            el = keyEls[m];
            if (el) {
              if (curColor[m]) el.style.setProperty('--c', curColor[m]);
              el.classList.add('on');
            }
          }
        }
        for (m in prevOn) {
          if (!cur[m]) {
            el = keyEls[m];
            if (el) el.classList.remove('on');
          }
        }
        prevOn = cur;
        try {
          var pg = total > 0 ? Math.min(1, Math.max(0, t / total)) : 0;
          if (barfill) barfill.style.width = (pg * 100).toFixed(2) + '%';
          if (timeEl) timeEl.textContent = fmt(Math.min(t, total)) + ' / ' + fmt(total);
        } catch (ePg) { }
        try { if (typeof updateCaption === 'function') updateCaption(t); } catch (eCp) { }
        return { cur: cur, curColor: curColor };
      }

      // 用 OfflineAudioContext 把整首曲子离线合成成 PCM，塞给 mp4.chunks（encodeCapturedAudio 认这个格式）
      function stgOfflineAudio(durSec) {
        return new Promise(function (resolve) {
          var OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
          if (!OAC || !notes.length) { resolve(false); return; }
          var sr = 48000;
          var totalFrames = Math.max(1, Math.ceil((durSec + 0.8) * sr));
          var oac = null;
          try { oac = new OAC(2, totalFrames, sr); } catch (eOac) { resolve(false); return; }
          var oldAc = ac, oldMaster = master, oldWave = pianoWave, oldNodes = nodes;
          var restore = function () {
            ac = oldAc; master = oldMaster; pianoWave = oldWave; nodes = oldNodes;
          };
          var ok = true;
          try {
            ac = oac;
            master = oac.createGain();
            master.connect(oac.destination);
            pianoWave = null;
            try {
              pianoWave = oac.createPeriodicWave(
                new Float32Array([0, 1, 0.45, 0.22, 0.11, 0.05]), new Float32Array(6));
            } catch (eW) { pianoWave = null; }
            nodes = [];
            for (var i = 0; i < notes.length; i++) playNote(notes[i], 0.15 + notes[i].time);
          } catch (eSch) { ok = false; }
          var pr = null;
          try { pr = ok ? oac.startRendering() : null; } catch (eStart) { pr = null; }
          if (!pr) { restore(); resolve(false); return; }
          pr.then(function (buf) {
            restore();
            try {
              var L = buf.getChannelData(0);
              var R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
              mp4.chunks = [new Float32Array(L), new Float32Array(R)];
              mp4.frames = L.length;
              resolve(true);
            } catch (eBuf) { resolve(false); }
          })['catch'](function () { restore(); resolve(false); });
        });
      }

      // 离线录制主流程（替代 recordStage 的实时版本）
      function recordStageOffline(opt) {
        opt = opt || {};
        return new Promise(function (resolve, reject) {
          if (STG && STG.on) { reject(new Error('已经在录制了')); return; }
          if (!notes.length) { reject(new Error('还没有载入曲目')); return; }
          if (!window.VideoEncoder || !window.VideoFrame || !window.Mp4Muxer) {
            reject(new Error('当前浏览器不支持 WebCodecs，请用 Chrome / Edge 94 以上'));
            return;
          }
          var W = ((opt.W | 0) || 1080) & ~1;
          var H = ((opt.H | 0) || 1920) & ~1;
          var fps = Math.max(1, Math.min(60, (opt.fps | 0) || 30));
        // Chrome 的 WebCodecs H.264 编码器最高只吃 30fps（1080p60 一律 init 失败），
        // 所以这里按 30 编码，60fps 由服务端用 ffmpeg 重新计时成片
        // 60fps 走 VP9 编码（H.264 编码器不支持 60fps）
          try { ensureAudio(); } catch (eAu) { }
          shootScore(function () {
            var scene = null;
            try { scene = stgMeasure(W, H, fps); } catch (eM) {
              reject(new Error('量版面失败：' + ((eM && eM.message) || eM))); return;
            }
            if (!scene) { reject(new Error('舞台尺寸为 0，无法录制')); return; }
            if (!scene.parts.length) { reject(new Error('谱面还没渲染出来，无法录制')); return; }
            if (Math.abs(scene.k - 1) > 0.02) {
              reject(new Error('录制舞台宽 ' + Math.round(W / scene.k) + 'px，不是 ' + W + '×' + H +
                ' 的版面；请点「导出视频」让浏览器新开一个录制页来录'));
              return;
            }
            if (!mp4InitFor({ W: W, H: H, fps: fps }, !!opt.audio)) {
              var er0 = mp4.err || '编码器初始化失败';
              mp4.on = false;
              reject(new Error(er0));
              return;
            }
            var cv = document.createElement('canvas');
            cv.width = W; cv.height = H;
            var ctx = cv.getContext('2d', { alpha: false });

            var dur = Math.max(0.1, Number(total) || 0);
            var N = Math.max(1, Math.round(dur * fps));
            var stepUs = 1e6 / fps;

            // 复位播放/高亮/按键状态，保证从 t=0 开始、指针从 0 走
            try { if (playing) togglePlay(); } catch (eTp) { }
            try { restart(); } catch (eRs) { }
            try { clearHighlights(); } catch (eCh) { }
            visPtr = 0; schedPtr = 0; active = []; recentOn = []; prevOn = {};

            var st = {
              on: true, offline: true, fps: fps, W: W, H: H,
              canvas: cv, ctx: ctx, scene: scene, frames: 0, lastT: 0,
              offCancel: false, offFinishNow: false, resolve: resolve, reject: reject
            };
            STG = st;
            exporting = true;

            var prep = opt.audio ? stgOfflineAudio(dur) : Promise.resolve(false);
            prep.then(function (audioOk) {
              var i = 0;
              var finish = function (canceled) {
                if (st.settled) return;
                st.settled = true;
                var st2 = STG;
                if (st2 !== st) return;
                var trace = [];
                var chain = Promise.resolve();
                chain = chain.then(function () {
                  trace.push('venc-flush-start:' + (mp4.venc ? mp4.venc.encodeQueueSize : '-'));
                  return mp4.venc.flush();
                })['catch'](function (e) { trace.push('venc-flush-err:' + ((e && e.message) || e)); });
                if (audioOk && !canceled) {
                  chain = chain.then(function () {
                    trace.push('audio-start:' + mp4.frames);
                    return encodeCapturedAudio();
                  })['catch'](function (e) { trace.push('audio-err:' + ((e && e.message) || e)); });
                }
                var guard = new Promise(function (res) { setTimeout(function () { trace.push('timeout'); res(); }, 120000); });
                Promise.race([chain, guard]).then(function () {
                  var blob = null, err = null;
                  try {
                    if (canceled) { err = new Error('录制已取消'); }
                    else {
                      mp4.muxer.finalize();
                      var buf = mp4.muxer.target.buffer;
                      if (!buf || !buf.byteLength) {
                        err = new Error('没有录到画面' + (mp4.err ? ('：' + mp4.err) : ''));
                      } else {
                        blob = new Blob([buf], { type: 'video/mp4' });
                      }
                    }
                  } catch (eFin) {
                    err = new Error('封装 MP4 失败：' + ((eFin && eFin.message) || eFin) + (mp4.err ? ('（' + mp4.err + '）') : '') + (mp4.vencErr ? ('[venc ' + mp4.vencErr + ']') : '') + (mp4.encErr ? ('[enc ' + mp4.encErr + ']') : '') + (mp4.meta0 ? ('[meta0 ' + mp4.meta0 + ']') : '') + (trace.length ? ('[trace ' + trace.join('|') + ']') : ''));
                  }
                  mp4.on = false;
                  mp4.muxer = null; mp4.venc = null; mp4.aenc = null;
                  exporting = false;
                  if (STG === st2) STG = null;
                  if (err) { st.reject(err); return; }
                  try { blob.__info = { frames: i, dur: dur, fps: fps, audio: !!audioOk, offline: true }; } catch (eBI) { }
                  st.resolve(blob);
                });
              };

              var now = function () { return (window.performance && performance.now) ? performance.now() : Date.now(); };
              // 等编码器消化队列（关键：不等就会把 2885 帧全塞进队列，最后 flush() 永远等不到）
              var waitQueue = function (maxQ) {
                return new Promise(function (res) {
                  var spin = function () {
                    if (st.settled) { res(false); return; }
                    if (STG !== st || !st.on) { res(false); return; }
                    var q = 0;
                    try { q = mp4.venc ? (mp4.venc.encodeQueueSize || 0) : 0; } catch (eQ0) { q = 0; }
                    if (q <= maxQ) { res(true); return; }
                    setTimeout(spin, 6);
                  };
                  spin();
                });
              };

              var slice = function () {
                if (st.settled) return;
                try {
                  if (STG !== st) {
                    st.settled = true;                    st.reject(new Error('录制会话被替换')); return;
                  }
                  if (!st.on) return;
                  if (st.offCancel) { st.on = false; finish(true); return; }
                  var t0 = now();
                  while (i < N) {
                    var t = i / fps;
                    var cc = stgOfflineStep(t);
                    try { stgSceneDyn(scene); } catch (eDyn) { }
                    stgRenderFrame(ctx, scene, t, cc.cur, cc.curColor);
                    try {
                      var frame = new VideoFrame(cv, {
                        timestamp: Math.round(i * stepUs),
                        duration: Math.round(stepUs)
                      });
                      mp4.venc.encode(frame, { keyFrame: (i % Math.max(1, fps * 2) === 0) });
                      frame.close();
                    } catch (eEnc) {
                      if (!mp4.encErr) mp4.encErr = '编码失败：' + ((eEnc && eEnc.message) || eEnc);
                    }
                    st.frames = i + 1;
                    st.lastT = t;
                    i++;
                    if (opt.onProgress && (i % 12 === 0)) {
                      try { opt.onProgress(t, dur, i); } catch (eCb) { }
                    }
                    var qn = 0;
                    try { qn = mp4.venc.encodeQueueSize || 0; } catch (eQ1) { qn = 0; }
                    if (qn > 20) break;
                    if (now() - t0 > 40) break;
                  }
                  if (st.offFinishNow && i < N) { st.on = false; finish(false); return; }
                  if (i >= N) { st.on = false; finish(false); return; }
                  waitQueue(6).then(function (alive) {
                    if (!alive || st.settled) return;
                    setTimeout(slice, 0);
                  });
                } catch (eLoop) {
                  st.settled = true;
                  st.on = false;
                  try { mp4.on = false; mp4.muxer = null; mp4.venc = null; mp4.aenc = null; } catch (eQ9) { }
                  exporting = false;
                  if (STG === st) STG = null;
                  st.reject(new Error('渲染循环异常：' + ((eLoop && eLoop.message) || eLoop)));
                }
              };
              slice();
            });
          });
        });
      }

      window.KeyboardPlayer = {
        format: DATA_FORMAT,
        version: DATA_VERSION,
        hasSong: function () { return notes.length > 0; },
        collect: collectSongData,
        exportData: function (opts) {
          var out = exportSongFile(opts);
          return out ? out.data : null;
        },
        exportDataString: function (opts) {
          var out = exportSongFile(opts);
          return out ? out.js : null;
        },
        download: downloadSongFile,
        loadData: loadSongData,
        // 谱面缩放：getZoom() 拿当前比例（0.25~1.4），setZoom(±0.08) 调一档
        getZoom: function () { return flowZoom; },
        setZoom: changeZoom,
        // 作品信息（显示在标题下面那行，例如「原神 · 璃月」）；留空就隐藏
        setWork: function (v) { setWorkLabel(v); },
        getWork: function () { return headEdits.sub || ''; },
        // 手动改标题 / 副标题 / 谱面信息（和左侧「作品信息」按钮的弹窗同一套存储）
        openHeadEditor: openHeadEditor,
        // 键盘上下位置（本页面单独记）：setBoardLift(px) 直接定，nudgeBoardLift(±px) 微调
        setBoardLift: setBoardLift,
        // 合并页（一个文件多个平台）：换存储命名空间，并重新读该平台的存档与默认值
        setPageNamespace: function (ns) {
          window.KB_PAGE_NS = String(ns == null ? '' : ns).trim();
          reloadPerPage();
        },
        reloadPerPage: reloadPerPage,
        // 曲名（没被「作品信息」改过的自动标题），给导出服务找歌曲文件夹用
        songTitle: autoHeadTitle,
        // 导出视频：stopExport(true) = 立刻结束并保存，stopExport(false) = 放弃
        stopExport: stopExport,
        // 录音：audioTap(true) 拿 MediaStream（期间静音），audioTap(false) 复原
        audioTap: audioTap,
        getBoardLift: function () {
          var bd = document.getElementById('board');
          var h = bd ? (bd.getBoundingClientRect().height || 0) : 0;
          return Math.round(liftTarget(h));
        },
        nudgeBoardLift: nudgeBoardLift,
        // 外部把歌曲文件发过来时用：files = File[]（.mid/.xml/.svg/简谱 .js 混合也行）
        // 录制页走这里：不再覆盖页面已经记住的快照
        loadFiles: function (files) { return loadImportedFiles(files, { snapshot: false }); },
        // 页面记住的导入文件（IndexedDB 快照）：录制页据此加载同一批谱面
        importedFiles: function () { return kbfFiles(); },
        importedInfo: function () { return kbfInfo(); },
        forgetImported: function () { return kbfClear(); },
        // 把一批文件记进浏览器快照（导入文件夹时会自动记；这个给外部/调试手动补一次）
        rememberFiles: function (files) { return kbfSave(files || []); },
        // 舞台录制（不需要屏幕共享）：recordStage({W,H,fps,audio,onProgress}) → Promise<Blob>；
        // 录的是舞台上真实渲染的内容，逐帧重画到指定分辨率的画布，再编成 MP4
        recordStage: recordStage,
        recordStageOffline: recordStageOffline,
        recordStop: function (keep) {
          if (!STG || !STG.on) return;
          // 离线录制：不是「立刻收尾」，只是打个标记，让渲染循环自己收（否则会拆掉正在用的编码器）
          if (STG.offline) { if (keep) STG.offFinishNow = true; else STG.offCancel = true; return; }
          stgFinish(!!keep);
        },
        recordState: function () {
          if (!STG || !STG.on) return null;
          return { t: STG.lastT || 0, dur: total, frames: STG.frames, fps: STG.fps };
        },
        // 音频上下文状态：'running' 表示已经解除「必须点一下才出声」的限制
        audioState: function () { return ac ? String(ac.state || '') : ''; },
        // 点击谱面定位 / 程序化定位（暂停态）：si = MusicXML 音符下标（0 基）；g = 组号。
        // 定位后点「播放」即从该处续播。
        seekToNote: seekToScoreIndex,
        seekToGroup: function (g) { return seekToGroup(g); },
        seekState: function () {
          var midis = [];
          if (gPtr >= 0 && GROUPS && GROUPS.list[gPtr] && score && score.notes) {
            var ms = GROUPS.list[gPtr].members, seen = {};
            for (var i = 0; i < ms.length; i++) {
              var r = score.notes[ms[i]];
              if (r && typeof r.halfTone === 'number' && !seen[r.halfTone]) { seen[r.halfTone] = 1; midis.push(r.halfTone); }
            }
          }
          return {
            playing: playing,
            time: (playing && ac && startTime > 0) ? Math.max(0, ac.currentTime - startTime) : playFromTime,
            from: playFromTime,
            group: gPtr,
            groups: GROUPS ? GROUPS.list.length : 0,
            measure: (gPtr >= 0 && GROUPS && GROUPS.list[gPtr]) ? GROUPS.list[gPtr].measure + 1 : 0,
            total: total,
            groupMidis: midis.sort(function (a, b) { return a - b; })
          };
        },
        // 供外部校验：取某音符的屏幕位置（五线谱符头中心 / 简谱锚点块中心），用于模拟点击
        noteRect: function (si) {
          var k = svgIndexOfScore(si);
          var out = { si: si, k: k, svg: null, jp: null };
          if (k >= 0 && svgFlat[k] && svgFlat[k].el) {
            var r = svgFlat[k].el.getBoundingClientRect();
            out.svg = { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
          }
          var b = blockOfScore(si);
          if (b >= 0 && blocks[b] && blocks[b].jp2 && blocks[b].jp2.bySi) {
            var an = blocks[b].jp2.bySi[si];
            if (an && an.el) {
              var r2 = an.el.getBoundingClientRect();
              out.jp = { x: r2.left + r2.width / 2, y: r2.top + r2.height / 2, w: r2.width, h: r2.height };
            }
          }
          return out;
        },
        // 把「作品信息」的抬头原样导出一份：导出时随请求发给服务端，录制页拿到后再套上去。
        // （编辑页和录制页可能不同源 —— 比如页面是 file:// 打开的、录制页是 http://127.0.0.1:8227/ ——
        //   localStorage 不互通，光靠存档录制页看不到集合/副标题/字号）
        headPayload: function () {
          var e = headEdits.songs[headSongKey()] || {};
          return {
            title: String(e.title || ''),
            sub: String(headEdits.sub || ''),
            col: String(e.col || ''),
            meta: String(e.meta || ''),
            sizeTitle: headSizes.title || 0,
            sizeSub: headSizes.sub || 0
          };
        },
        applyHeadPayload: function (p) {
          p = p || {};
          if (p.title !== undefined || p.meta !== undefined || p.col !== undefined || p.sub !== undefined) {
            KeyboardPlayer.setHead({ title: p.title, meta: p.meta, col: p.col, sub: p.sub });
          }
          setHeadSizes(p.sizeTitle, p.sizeSub);
          saveHeadEdits();
          try { renderScoreHead(); } catch (eHP) { }
        },
        // 版面上的可调项（琴键高 / 键盘上移 / 谱面缩放）：
        // 编辑页（多半 540 宽）和录制页（1080 宽）不是同一块画布，所以只传「跟版面成比例」的值 ——
        // 琴键高按 1080 宽的 px 记（本来就是这个口径），上移传「占舞台宽的比例」，缩传倍数。
        uiPayload: function () {
          var st = document.querySelector('.stage');
          var w = (st && st.clientWidth) || 540;
          var lift = 0;
          try {
            lift = parseFloat(getComputedStyle(st).getPropertyValue('--kb-lift')) || 0;
          } catch (eU1) { }
          return {
            keyH: Math.round(keyHPref()),
            liftRatio: Math.round((lift / w) * 100000) / 100000,
            zoom: Math.round(flowZoom * 1000) / 1000
          };
        },
        applyUiPayload: function (p) {
          if (!p) return;
          var st = document.querySelector('.stage');
          var w = (st && st.clientWidth) || 0;
          if (p.keyH) { try { setKeyH(p.keyH); } catch (eU2) { } }
          if (p.liftRatio != null) {
            try { setBoardLiftRatio(p.liftRatio); } catch (eU3) { }
          }
          if (p.zoom) {
            var d = p.zoom - flowZoom;
            if (Math.abs(d) > 0.005) { try { changeZoom(d); } catch (eU4) { } }
          }
          // 舞台可能还没切成 rec-mode 的 1080 宽，宽了一点点之后再同步一次（按比例算，不会漂）
          setTimeout(function () { try { syncBoardLift(); } catch (eU5) { } }, 150);
        },
        // 底部字幕（文字 + 距底边）也跟着导出走：编辑页可能是 file:// 打开的，录制页读不到它的
        // localStorage，不传就会录成「没有字幕」或者平台默认词
        captionPayload: function () {
          return {
            text: captionLines.join('\n'),
            offset: (captionOffset == null) ? null : captionOffset
          };
        },
        applyCaptionPayload: function (p) {
          if (!p) return;
          // 只铺到内存里，不写 localStorage：录制页不该改掉编辑页存的那一份
          captionLines = normalizeCaptionLines(p.text || '');
          var off = p.offset;
          if (off === '' || off == null) captionOffset = null;
          else if (isFinite(parseFloat(off))) captionOffset = Math.max(0, Math.min(400, parseFloat(off)));
          captionLastIdx = -2;
          applyCaptionStyle();
          updateCaption(captionNow());
        },
        setHead: function (o) {
          o = o || {};
          if (o.sub !== undefined) headEdits.sub = String(o.sub || '').trim();
          var key = headSongKey(), cur = headEdits.songs[key] || {};
          if (o.title !== undefined) { if (String(o.title || '').trim()) cur.title = String(o.title).trim(); else delete cur.title; }
          if (o.meta !== undefined) { if (String(o.meta || '').trim()) cur.meta = String(o.meta).trim(); else delete cur.meta; }
          if (o.col !== undefined) { if (String(o.col || '').trim()) cur.col = String(o.col).trim(); else delete cur.col; }
          if (cur.title || cur.meta || cur.col) headEdits.songs[key] = cur; else delete headEdits.songs[key];
          saveHeadEdits();
          renderScoreHead();
        }
      };

      if (dataBtn) {
        dataBtn.addEventListener('click', function () { downloadSongFile(); });
        dataBtn.disabled = !notes.length;
      }

      // 谱面信息：载入上次填的 + 左侧栏按钮打开编辑弹窗（标题 / 副标题 / 谱面信息）
      loadHeadEdits();
      loadHeadTop();
      loadCaption();
      try { renderScoreHead(); } catch (eW) { }
      (function wireWorkBtn() {
        var btn = document.getElementById('workBtn');
        if (!btn) return;
        btn.addEventListener('click', function () { openHeadEditor(); });
      })();

      // 底部字幕按钮
      (function wireCaptionBtn() {
        var btn = document.getElementById('captionBtn');
        if (!btn || !btn.addEventListener) return;
        btn.addEventListener('click', function () { openCaptionEditor(); });
      })();

      // 标题与顶部的距离：左侧「标题距顶」按钮，填 px
      (function wireHeadTopBtn() {
        var btn = document.getElementById('headTopBtn');
        if (!btn || !btn.addEventListener) return;
        btn.addEventListener('click', function () {
          var v = window.prompt('标题与顶部的距离（px，0 ~ 300；默认 10）', String(headTopPx()));
          if (v === null) return;
          setHeadTop(v);
          try { console.log('[标题] 距顶 ' + headTopPx() + 'px'); } catch (e) { }
        });
      })();

      function openHeadEditor() {
        var m = ensureHeadModal();
        var e = headEdits.songs[headSongKey()] || {};
        var tIn = document.getElementById('headTitleIn');
        var cIn = document.getElementById('headColIn');
        var sIn = document.getElementById('headSubIn');
        var mIn = document.getElementById('headMetaIn');
        if (!tIn || !cIn || !sIn || !mIn) return;
        tIn.value = String(e.title || autoHeadTitle() || '');
        cIn.value = colTextForPlatform(e.col);   // 按当前平台显示「期 / 集」，和抬头一致
        sIn.value = String(headEdits.sub || '');
        mIn.value = String(e.meta || autoHeadMeta() || '');
        var tsIn = document.getElementById('headTitleSizeIn');
        var ssIn = document.getElementById('headSubSizeIn');
        if (tsIn) tsIn.value = headSizes.title ? String(headSizes.title) : '';
        if (ssIn) ssIn.value = headSizes.sub ? String(headSizes.sub) : '';
        m.hidden = false;
        try { tIn.focus(); tIn.select(); } catch (eF) { }
      }

      function closeHeadEditor() {
        var m = document.getElementById('headModal');
        if (m) m.hidden = true;
      }

      function applyHeadEditor() {
        var tIn = document.getElementById('headTitleIn');
        var cIn = document.getElementById('headColIn');
        var sIn = document.getElementById('headSubIn');
        var mIn = document.getElementById('headMetaIn');
        if (!tIn || !cIn || !sIn || !mIn) return;
        var key = headSongKey();
        var title = String(tIn.value || '').trim();
        var col = String(cIn.value || '').trim();
        var meta = String(mIn.value || '').trim();
        var sub = String(sIn.value || '').trim();
        var autoT = String(autoHeadTitle() || '').trim();
        var autoM = String(autoHeadMeta() || '').trim();
        var cur = headEdits.songs[key] || {};
        // 和自动值一样就当没改，免得换曲子还锁着上一首的标题
        if (title && title !== autoT) cur.title = title; else delete cur.title;
        if (col) cur.col = col; else delete cur.col;
        if (meta && meta !== autoM) cur.meta = meta; else delete cur.meta;
        if (cur.title || cur.meta || cur.col) headEdits.songs[key] = cur; else delete headEdits.songs[key];
        headEdits.sub = sub;
        // 字号（留空 = 默认）
        var tsIn = document.getElementById('headTitleSizeIn');
        var ssIn = document.getElementById('headSubSizeIn');
        setHeadSizes(tsIn ? tsIn.value : '', ssIn ? ssIn.value : '');
        saveHeadEdits();
        renderScoreHead();
        closeHeadEditor();
      }

      function clearHeadEdits() {
        var key = headSongKey();
        delete headEdits.songs[key];
        headEdits.sub = '';
        saveHeadEdits();
        renderScoreHead();
        closeHeadEditor();
      }

      function ensureHeadModal() {
        var m = document.getElementById('headModal');
        if (m) return m;
        m = document.createElement('div');
        m.className = 'modal';
        m.id = 'headModal';
        m.hidden = true;
        // 弹窗里提示的「留空 = N」用页面文件里的默认值（没写就用 25 / 13）
        var defTitleSize = headSizeFallback('title') || 25;
        var defSubSize = headSizeFallback('sub') || 13;
        m.innerHTML =
          '<div class="modal-card">' +
          '<h3>谱面信息</h3>' +
          '<label class="head-field"><span>标题</span>' +
          '<input type="text" id="headTitleIn" placeholder="留空 = 自动（MusicXML / 简谱）"></label>' +
          '<label class="head-field"><span>标题字号（px，留空 = ' + defTitleSize + '）</span>' +
          '<input type="number" id="headTitleSizeIn" min="8" max="120" step="1" placeholder="' + defTitleSize + '"></label>' +
          '<label class="head-field"><span>集合</span>' +
          '<input type="text" id="headColIn" placeholder="例如：原神谱 · 4' + colUnit() + '（与副标题同一行，靠左）"></label>' +
          '<label class="head-field"><span>副标题</span>' +
          '<input type="text" id="headSubIn" placeholder="例如：原神 · 璃月"></label>' +
          '<label class="head-field"><span>副标题字号（px，留空 = ' + defSubSize + '）</span>' +
          '<input type="number" id="headSubSizeIn" min="6" max="80" step="1" placeholder="' + defSubSize + '"></label>' +
          '<label class="head-field"><span>谱面信息</span>' +
          '<input type="text" id="headMetaIn" placeholder="例如：1=D | 93 BPM | 6/8"></label>' +
          '<div class="tip">集合和副标题同一行（集合靠左 30px，副标题居中，标题单独一行居中）；副标题、字号按页面记住；标题、集合、谱面信息按曲目记住。清空某一项 = 用自动值 / 默认字号。回车保存，Esc 取消。</div>' +
          '<div class="row">' +
          '<button class="btn" id="headClear">恢复自动</button>' +
          '<button class="btn" id="headCancel">取消</button>' +
          '<button class="btn primary" id="headSave">保存</button>' +
          '</div></div>';
        document.body.appendChild(m);
        var saveBtn = document.getElementById('headSave');
        var cancelBtn = document.getElementById('headCancel');
        var clearBtn = document.getElementById('headClear');
        if (saveBtn) saveBtn.addEventListener('click', applyHeadEditor);
        if (cancelBtn) cancelBtn.addEventListener('click', closeHeadEditor);
        if (clearBtn) clearBtn.addEventListener('click', clearHeadEdits);
        m.addEventListener('click', function (ev) { if (ev.target === m) closeHeadEditor(); });
        m.addEventListener('keydown', function (ev) {
          if (ev.key === 'Escape') { closeHeadEditor(); }
          else if (ev.key === 'Enter') { ev.preventDefault(); applyHeadEditor(); }
        });
        return m;
      }
    })();
