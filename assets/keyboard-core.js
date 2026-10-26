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
      var expModal = ui('expModal');
      var expRes = ui('expRes');
      var expFps = ui('expFps');
      var expAudio = ui('expAudio');
      var expScore = ui('expScore');
      var expTitle = ui('expTitle');
      var expTip = ui('expTip');
      var expStart = ui('expStart');
      var expCancel = ui('expCancel');

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
      }

      // ---------- 主循环 ----------
      function tick() {
        if (!playing) return;
        var t = ac.currentTime - startTime;
        var i, n, m, el;

        // 1) 提前 0.6 秒把音符排进音频图（留给主线程足够的余量）
        while (schedPtr < notes.length && notes[schedPtr].time <= t + 0.6) {
          n = notes[schedPtr++];
          if (soundChk.checked) playNote(n, startTime + n.time);
        }

        // 1.5) 新按下的音符：记录时刻，并塞进“正在响”的活动表
        //      （用下标推进 + 活动表，避免每帧扫描整首曲子的所有音符）
        while (visPtr < notes.length && notes[visPtr].time <= t) {
          n = notes[visPtr++];
          lastStart[n.midi] = n.time;
          active.push(n);
          recentOn.push(n);
          try { hitScore(visPtr - 1, n, t); } catch (eScore) { }   // 谱面出错也不影响播放

          // SVG / 简谱：给当前音符染色，播放框按音符走（简谱与五线谱各自跟随）
          try {
            if (svgReady) {
              var kNow = svgIndexForMidi(visPtr - 1);
              if (kNow >= 0) {
                clearSvgHi();
                paintSvgAt(kNow);
                positionSvgCursorAt(kNow);
              }
            }
          } catch (eSvg) { }
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
          if (exporting && expTip) {
            expTip.textContent = '录制中 ' + fmt(t) + ' / ' + fmt(total) + '，请不要切走本页';
          }
        }

        // 4.5) 导出中：每帧都要画（这个不能节流）
        if (exporting && expCtx) drawExportFrame(t, cur, curColor);

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
        var k = svgIndexOfScore(scoreMap[idx]);
        if (k < 0) return;
        try { clearSvgHi(); paintSvgAt(k); positionSvgCursorAt(k); } catch (e) { }
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
      var expCanvas = null, expCtx = null;
      var exporting = false, rec = null, recParts = [], recStream = null, recDest = null;
      var recKeep = false;

      function stamp() {
        var d = new Date();
        var p = function (n) { return (n < 10 ? '0' : '') + n; };
        return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' +
          p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
      }

      function downloadBlob(blob, name) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 5000);
      }

      function pickMime() {
        // WebM 在各家浏览器上最稳；Safari 这类不支持 WebM 录制的再退到 MP4
        var list = [
          'video/webm;codecs=vp9,opus',
          'video/webm;codecs=vp8,opus',
          'video/webm',
          'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
          'video/mp4'
        ];
        for (var i = 0; i < list.length; i++) {
          if (window.MediaRecorder && MediaRecorder.isTypeSupported(list[i])) return list[i];
        }
        return '';
      }

      function cleanupExport() {
        try { if (recDest && master) master.disconnect(recDest); } catch (e) { }
        recDest = null;
        if (recStream) {
          recStream.getTracks().forEach(function (tr) { try { tr.stop(); } catch (e) { } });
          recStream = null;
        }
        rec = null;
        expCanvas = null;
        expCtx = null;
        exporting = false;
        expBtn.disabled = !notes.length;
        expModal.hidden = true;
        expStart.disabled = false;
        expStart.textContent = '开始导出';
      }

      function stopExport(keep) {
        recKeep = !!keep;
        if (!exporting) return;
        exporting = false;
        if (rec && rec.state !== 'inactive') rec.stop();
        else cleanupExport();
      }

      // ---------------- 导出：曲谱快照 ----------------
      var scoreBitmap = null;     // { canvas, w, h } 一次性栅格化的谱面
      var exportHeadY = null;     // 当前播放位置在谱面里的纵向中心（SVG 像素）
      var exportBox = null;       // 光标框在 SVG 坐标里的位置与大小
      var curMeasureNo = -1;      // 当前正在播放的小节（0 基）

      // 把页面里的 @font-face 规则捞出来，内联到 SVG 里。
      // 不这样做的话，<img> 渲染 SVG 时拿不到音乐字体，音符会变成方块或空白。
      function collectFontFaceCss() {
        var out = [];
        try {
          for (var i = 0; i < document.styleSheets.length; i++) {
            var rules = null;
            try { rules = document.styleSheets[i].cssRules; } catch (e) { continue; }
            if (!rules) continue;
            for (var j = 0; j < rules.length; j++) {
              var r = rules[j];
              var txt = r && r.cssText ? r.cssText : '';
              if (txt.indexOf('@font-face') === 0) out.push(txt);
            }
          }
        } catch (e2) { }
        return out.join('\n');
      }

      // 按「小节纵向位置」把谱面分成若干行，算出每行的上下边界（SVG 像素）。
      // 导出时按整行取景，才不会把一条谱表切成两半。
      function scoreSystemBands() {
        return [];
      }

      // 导出用：每组五线谱 + 简谱各一张位图
      var scoreBitmaps = [];
      var jpBitmaps = [];
      var jpCols = [];

      function shootScore(done) {
        scoreBitmaps = [];
        scoreBitmap = null;
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
          try { buildStack(); } catch (eS) { }
          scoreBitmap = scoreBitmaps.length ? { count: scoreBitmaps.length } : null;
          try {
            console.log('[导出] 五线谱位图 ' + scoreBitmaps.length + '/' + blocks.length +
              (failed ? ('，失败 ' + failed) : ''));
          } catch (e) { }
          if (done) done();
        }
      }

      // 简谱是 HTML+CSS（时值线用 box-shadow、形状用 clip-path），
      // canvas 画不了，这里按真实渲染几何重绘一遍。
      function shootJianpu() {
        jpBitmaps = [];
        // 截图前先收掉播放高亮，否则当前音符会被烤进位图
        try { jpHiReset([]); } catch (eHi) { }
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

          // 记下每个音符高亮块的归一化位置和颜色：导出时按「列」逐个点亮，
          // 跟页面上的音符高亮一致（而不是铺一条灰色滚框）。
          var colsX = [], si2, a2, ar2, colC, rec2, hit2, hj;
          var sndAnchors = jpSounding(b);
          for (si2 = 0; si2 < sndAnchors.length; si2++) {
            a2 = sndAnchors[si2];
            ar2 = a2.el.getBoundingClientRect();
            if (ar2.width < 1 || ar2.height < 1) continue;
            colC = '#e8a0a0';
            try { colC = getComputedStyle(a2.el).backgroundColor || colC; } catch (eC) { }
            rec2 = {
              x0: (ar2.left - ir.left) / ir.width,
              x1: (ar2.right - ir.left) / ir.width,
              y0: (ar2.top - ir.top) / ir.height,
              y1: (ar2.bottom - ir.top) / ir.height,
              c: colC
            };
            hit2 = null;
            for (hj = 0; hj < colsX.length; hj++) {
              if (Math.abs(colsX[hj].cx - a2.cx) <= Math.max(2, a2.w * 0.45)) { hit2 = colsX[hj]; break; }
            }
            if (!hit2) { hit2 = { cx: a2.cx, w: a2.w, rects: [] }; colsX.push(hit2); }
            hit2.rects.push(rec2);
          }
          jpCols[i] = colsX;

          var all = inner.querySelectorAll('*');

          for (var k = 0; k < all.length; k++) {
            var el = all[k];
            var cs;
            try { cs = getComputedStyle(el); } catch (e) { continue; }
            if (cs.visibility === 'hidden' || cs.display === 'none') continue;

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
      }

      // 把谱面画到导出画布上：
      //   · 按宽度铺满
      //   · 纵向按「整行」取景，并做缓动，换行时不跳
      //   · 光标框是 DOM 元素、不在 SVG 位图里，这里单独补画
      var exportScrollY = null;

      function layoutSys(W, areaY, areaH) {
        var pad = Math.round(areaH * 0.05);
        var boxW = W - pad * 2, boxH = areaH - pad * 2;
        if (boxW <= 0 || boxH <= 0) return null;

        var maxAbove = 0, maxBelow = 0, refW = 0;
        for (var i = 0; i < scoreBitmaps.length; i++) {
          var bmp = scoreBitmaps[i], blk = blocks[i];
          if (!bmp || !bmp.width || !blk) continue;
          if (bmp.width > refW) refW = bmp.width;
          var sc = bmp.width / blk.vbW;
          var above = (blk.staffTop - blk.vbTop) * sc;
          var below = ((blk.vbTop + blk.sysH) - blk.staffBottom) * sc;
          if (above > maxAbove) maxAbove = above;
          if (below > maxBelow) maxBelow = below;
        }
        if (!refW) return null;

        var k = Math.min(boxW / refW, boxH / Math.max(1, maxAbove + maxBelow));
        return {
          pad: pad, boxW: boxW, boxH: boxH, k: k,
          anchorY: areaY + pad + maxAbove * k, refW: refW
        };
      }


      // 把所有组自上而下拼成一张长图，导出时按组取窗口 → 连续滚动
      var stackBmp = null;
      var stackOffsets = [];

      function buildStack() {
        stackBmp = null;
        stackOffsets = [];
        if (!scoreBitmaps.length) return;

        var refW = 0, i;
        for (i = 0; i < scoreBitmaps.length; i++) {
          if (scoreBitmaps[i] && scoreBitmaps[i].width > refW) refW = scoreBitmaps[i].width;
        }
        if (!refW) return;

        var GAP = Math.round(refW * 0.02);
        var GROUP_GAP = Math.round(refW * 0.05);

        var totalH = 0, parts = [];
        for (i = 0; i < blocks.length; i++) {
          var sp = scoreBitmaps[i], jp = jpBitmaps[i];
          var sysH = sp ? Math.round(sp.height * refW / sp.width) : 0;
          var jpH = (jp && jp.width) ? Math.round(jp.height * refW / jp.width) : 0;
          if (!sysH && !jpH) { parts.push(null); continue; }
          parts.push({ sysH: sysH, jpH: jpH, h: sysH + (jpH ? GAP + jpH : 0) });
          totalH += parts[i].h + GROUP_GAP;
        }
        if (!totalH) return;

        var cv = document.createElement('canvas');
        cv.width = refW;
        cv.height = totalH;
        var cx = cv.getContext('2d');
        cx.fillStyle = '#ffffff';
        cx.fillRect(0, 0, cv.width, cv.height);

        var y = 0;
        for (i = 0; i < parts.length; i++) {
          var pt = parts[i];
          if (!pt) { stackOffsets.push(null); continue; }
          if (scoreBitmaps[i]) cx.drawImage(scoreBitmaps[i], 0, y, refW, pt.sysH);
          if (jpBitmaps[i]) cx.drawImage(jpBitmaps[i], 0, y + pt.sysH + GAP, refW, pt.jpH);
          stackOffsets.push({ top: y, h: pt.h, sysH: pt.sysH, jpTop: y + pt.sysH + GAP, jpH: pt.jpH });
          y += pt.h + GROUP_GAP;
        }

        stackBmp = { canvas: cv, w: refW, h: totalH };
        try { console.log('[导出] 长图 ' + refW + 'x' + totalH + '，' + parts.length + ' 组'); } catch (e) { }
      }

      function drawScoreIntoExport(c, W, areaY, areaH) {
        if (!areaH || areaH < 8) return false;

        c.fillStyle = '#ffffff';
        c.fillRect(0, areaY, W, areaH);
        if (!stackBmp) return false;

        var off = stackOffsets[curGroup] || stackOffsets[0];
        if (!off) return false;

        var padX = Math.round(W * 0.03);
        var boxW = W - padX * 2;
        if (boxW <= 0) return false;

        // 按页面上的「谱面」比例导出（flowZoom 是谱面占容器宽的比例）
        var zoom = (typeof flowZoom === 'number' && flowZoom > 0) ? flowZoom : 0.55;
        var targetW = Math.min(boxW, Math.round(W * zoom));
        if (targetW < 80) targetW = Math.min(boxW, 80);

        var k = targetW / stackBmp.w;
        var viewH = areaH / k;
        if (viewH > stackBmp.h) viewH = stackBmp.h;

        var wantTop = off.top - viewH * 0.12;
        var top = Math.max(0, Math.min(stackBmp.h - viewH, wantTop));
        var dx = (W - stackBmp.w * k) / 2;
        c.drawImage(stackBmp.canvas, 0, top, stackBmp.w, viewH, dx, areaY, stackBmp.w * k, viewH * k);

        var sysBmp = scoreBitmaps[curGroup];
        var blk = blocks[curGroup];
        if (sysBmp && blk && curNoteGeo && curNoteGeo.blk === curGroup) {
          var sc = sysBmp.width / blk.vbW;
          var bx = (curNoteGeo.x + 16 - (blk.vbLeft || 0)) * sc;   // +16：符头中心
          var byTop = (blk.staffTop - blk.vbTop) * sc;
          var byBot = (blk.staffBottom - blk.vbTop) * sc;

          var px = dx + bx * k;
          var py = areaY + (off.top + byTop - top) * k;
          var ph = Math.max(6, (byBot - byTop) * k);
          var pw = Math.max(8, 70 * sc * k);

          if (off.jpH > 0) {
            var jy = areaY + (off.jpTop - top) * k;
            var jh2 = off.jpH * k;
            var stackW = stackBmp.w * k;
            var cols2 = jpCols[curGroup] || null;
            var anch2 = jpAnchorFor(blk, curNoteGeo.idx);
            if (cols2 && anch2 && jy + jh2 > areaY && jy < areaY + areaH) {
              c.save();
              c.beginPath();
              c.rect(0, areaY, W, areaH);
              c.clip();
              var tol2 = Math.max(2, anch2.w * 0.45), ci2, ri2;
              for (ci2 = 0; ci2 < cols2.length; ci2++) {
                var col2 = cols2[ci2];
                if (Math.abs(col2.cx - anch2.cx) > tol2) continue;
                for (ri2 = 0; ri2 < col2.rects.length; ri2++) {
                  var rc2 = col2.rects[ri2];
                  var rx2 = dx + rc2.x0 * stackW;
                  var rw2 = Math.max(2, (rc2.x1 - rc2.x0) * stackW);
                  var ry2 = jy + rc2.y0 * jh2;
                  var rh2 = Math.max(2, (rc2.y1 - rc2.y0) * jh2);
                  if (ry2 + rh2 < areaY || ry2 > areaY + areaH) continue;
                  c.globalAlpha = 0.55;
                  c.fillStyle = rc2.c;
                  c.beginPath();
                  roundRect(c, rx2, ry2, rw2, rh2, 3);
                  c.fill();
                }
              }
              c.globalAlpha = 1;
              c.restore();
            }
          }

          if (py + ph > areaY && py < areaY + areaH) {
            c.save();
            c.beginPath();
            c.rect(0, areaY, W, areaH);
            c.clip();
            c.beginPath();
            roundRect(c, px - pw / 2, py, pw, ph, 4);
            c.fillStyle = 'rgba(217, 43, 37, .18)';
            c.fill();
            c.lineWidth = Math.max(1.5, pw * 0.14);
            c.strokeStyle = 'rgba(217, 43, 37, .88)';
            c.stroke();
            c.restore();
          }
        }

        if (window.__snapWant && !window.__snapData) {
          try { window.__snapData = c.canvas.toDataURL('image/png'); } catch (eSnap) { }
        }

        return true;
      }

      function startExport(opt) {
        if (opt.score && blocks.length) {
          expTip.textContent = '正在生成曲谱快照…';
          expStart.disabled = true;
          shootScore(function () {
            expStart.disabled = false;
            if (!scoreBitmap) {
              expTip.textContent = '曲谱快照失败，将只导出键盘…';
              setTimeout(function () { startExportReal(opt); }, 900);
              return;
            }
            startExportReal(opt);
          });
          return;
        }
        scoreBitmap = null;
        exportScrollY = null;
        startExportReal(opt);
      }

      function startExportReal(opt) {
        exportScrollY = null;
        if (!window.MediaRecorder) {
          expTip.textContent = '当前浏览器不支持录制，请用 Chrome / Edge';
          return;
        }
        if (!ensureAudio()) {
          expTip.textContent = '当前浏览器不支持 Web Audio';
          return;
        }

        expCanvas = document.createElement('canvas');
        expCanvas.width = opt.w;
        expCanvas.height = opt.h;
        expCtx = expCanvas.getContext('2d');

        if (opt.audio) {
          try {
            recDest = ac.createMediaStreamDestination();
            master.connect(recDest);
          } catch (e) { recDest = null; }
        }

        recStream = expCanvas.captureStream(opt.fps);
        if (recDest) {
          recDest.stream.getAudioTracks().forEach(function (tr) {
            try { recStream.addTrack(tr); } catch (e) { }
          });
        }

        var mime = pickMime();
        try {
          rec = new MediaRecorder(recStream, {
            mimeType: mime || undefined,
            videoBitsPerSecond: Math.round(opt.w * opt.h * opt.fps * 0.12)
          });
        } catch (e) {
          expTip.textContent = '录制初始化失败：' + (e && e.message ? e.message : e);
          cleanupExport();
          return;
        }

        recParts = [];
        rec.ondataavailable = function (e) { if (e.data && e.data.size) recParts.push(e.data); };
        rec.onstop = function () {
          var type = (mime || 'video/webm').split(';')[0];
          var blob = new Blob(recParts, { type: type });
          recParts = [];
          if (recKeep && blob.size) {
            downloadBlob(blob, 'piano-keys-' + stamp() + (type.indexOf('mp4') >= 0 ? '.mp4' : '.webm'));
          }
          cleanupExport();
        };

        restart();                    // 回到 0 秒
        exporting = true;
        recKeep = true;
        expBtn.disabled = true;
        expStart.disabled = true;
        expTip.textContent = '准备中…';

        drawExportFrame(0, {}, {});
        try { rec.start(500); } catch (e) { }
        togglePlay();
      }

      // 回弹位移：几何全部相对键高，和屏幕上的 1px+3px 同比例
      function dipOf(m, t, kbH, held) {
        var d = held ? kbH * 0.006 : 0;
        var st = lastStart[m];
        if (st === undefined) return d;
        var e = t - st;
        if (e < 0 || e > 0.14) return d;
        return d + kbH * 0.014 * (1 - e / 0.14);
      }

      function roundRect(c, x, y, w, h, r) {
        r = Math.min(r, w / 2, h / 2);
        c.beginPath();
        c.moveTo(x + r, y);
        c.lineTo(x + w - r, y);
        c.quadraticCurveTo(x + w, y, x + w, y + r);
        c.lineTo(x + w, y + h - r);
        c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        c.lineTo(x + r, y + h);
        c.quadraticCurveTo(x, y + h, x, y + h - r);
        c.lineTo(x, y + r);
        c.quadraticCurveTo(x, y, x + r, y);
        c.closePath();
      }

      // 把键盘原样画到画布：键区、黑白键比例、音名开关全部沿用页面当前状态，
      // 连“白键高宽比”都是从屏幕上实测出来的，保证看到什么就导出什么
      function drawExportFrame(t, cur, curColor) {
        var cv = expCanvas, c = expCtx;
        if (!cv || !c) return;

        var W = cv.width, H = cv.height;
        var padX = Math.round(W * 0.015);
        var fontFam = 'system-ui, "Microsoft YaHei", sans-serif';

        c.fillStyle = '#0f1115';
        c.fillRect(0, 0, W, H);

        var nWhite = 0, m;
        for (m = viewLow; m <= viewHigh; m++) if (isWhite(m)) nWhite++;
        if (!nWhite) return;

        var kbW = W - padX * 2;
        var wpx = kbW / nWhite;

        // ★ 从页面键盘实测“白键高 ÷ 白键宽”，视频里用同一个比例
        var pageKeyW = keysRoot.clientWidth / nWhite;
        var ratio = pageKeyW > 0 ? (keysRoot.clientHeight / pageKeyW) : 8.5;
        ratio = Math.max(5, Math.min(11, ratio));

        var kbH = Math.round(wpx * ratio);
        // 有曲谱时把键盘压到 34% 以内，上面整块留给谱面
        var portrait = H > W;   // 9:16 竖屏
        var maxH = Math.round(H * (scoreBitmap ? (portrait ? 0.26 : 0.34) : 0.72));
        if (kbH > maxH) kbH = maxH;

        var bottomPad = Math.round(H * 0.03);
        var kbY = H - kbH - bottomPad;

        // 曲谱画在键盘上方
        if (scoreBitmap) drawScoreIntoExport(c, W, 0, kbY);

        var bw = wpx * KW;
        var bh = kbH * KH;
        var fw = Math.max(9, wpx * 0.36);        // 和页面同一个字号公式
        var fb = Math.max(7, wpx * 0.30);
        var labPad = Math.max(4, wpx * 0.30);
        var showLabels = labelChk.checked;

        // 白键
        var wi = 0;
        for (m = viewLow; m <= viewHigh; m++) {
          if (!isWhite(m)) continue;
          var x = padX + wi * wpx;
          var on = !!cur[m];
          var dip = dipOf(m, t, kbH, on);
          c.fillStyle = on ? (curColor[m] || '#2f81f7') : '#ffffff';
          c.fillRect(x, kbY + dip, wpx, kbH - dip);
          c.fillStyle = 'rgba(0,0,0,.10)';
          c.fillRect(x + wpx - 1, kbY + dip, 1, kbH - dip);
          if (showLabels) {
            c.textAlign = 'center';
            c.textBaseline = 'alphabetic';
            c.font = '500 ' + fw.toFixed(1) + 'px ' + fontFam;
            c.fillStyle = on ? '#ffffff' : '#3c3c3c';
            c.fillText(noteName(m), x + wpx / 2, kbY + kbH - labPad);
          }
          wi++;
        }

        // 黑键
        var wc = 0;
        for (m = viewLow; m <= viewHigh; m++) {
          if (isWhite(m)) { wc++; continue; }
          var cx = padX + wc * wpx;
          var on2 = !!cur[m];
          var dip2 = dipOf(m, t, kbH, on2);
          var y2 = kbY + dip2;
          var h2 = bh - dip2;
          roundRect(c, cx - bw / 2, y2, bw, h2, Math.max(2, bw * 0.18));
          if (on2) {
            c.fillStyle = curColor[m] || '#2f81f7';
          } else {
            var g = c.createLinearGradient(0, y2, 0, y2 + h2);
            g.addColorStop(0, '#3b3b3b');
            g.addColorStop(0.14, '#1d1d1d');
            g.addColorStop(0.7, '#101010');
            g.addColorStop(1, '#060606');
            c.fillStyle = g;
          }
          c.fill();
          // 黑键不写音名（与页面一致）
        }

        // 左上角曲名/时间已移除
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
        return { notes: notes, measures: measures, parts: parts.length };
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

      // 回填成 MusicXML 标准标签，OSMD 就会正常排版
      function injectMeta(xml, meta) {
        if (!meta) return xml;
        var m = xml;

        if (meta.title && !/<work-title\b/.test(m) && !/<movement-title\b/.test(m)) {
          var w = '<work><work-title>' + xmlEsc(meta.title) + '</work-title></work>';
          m = m.replace(/(<score-partwise\b[^>]*>)/, function (a) { return a + w; });
        }
        if (meta.composer && !/<creator\b/.test(m)) {
          var cr = '<creator type="composer">' + xmlEsc(meta.composer) + '</creator>';
          if (/<identification\b[^>]*\/>/.test(m)) {
            m = m.replace(/<identification\b([^>]*)\/>/,
              '<identification$1>' + cr + '</identification>');
          } else if (/<identification\b[^>]*>/.test(m)) {
            m = m.replace(/(<identification\b[^>]*>)/, function (a) { return a + cr; });
          }
        }
        return m;
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

      // OSMD 的全局名在不同版本/打包方式下不一样，两种都试
      function osmdClass() {
        return null;   // 已移除 OSMD
      }

      function ensureOSMD() {
        return null;   // 已移除 OSMD，谱面由 SVG 提供
      }

      // 把 OSMD 的图形音符摊平成一维数组（顺序 = 谱面顺序）
      function collectScoreNotes() {
        var out = [];
        return out;   // 已移除 OSMD
      }

      function collectAndStore() {
        /* 已移除 OSMD：score 由 parseMusicXML 直接构建 */
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

      // 统计当前每一行有几个小节：小节按纵向位置分组即可
      function systemRowCounts() {
        return [];
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

      function ensureCursorBox() {
        return null;
      }

      function hideCursorBox() {
        /* 已移除 OSMD 光标框，改用 #svgCursor */
      }

      // OSMD 单位 → 像素。
      //
      // 关键：AbsolutePosition 用的是 OSMD 单位，而 <svg> 的 viewBox 用的是
      // 「OSMD 单位 × 10」。少了这个 10 倍，框会被算到左上角一小块区域里，
      // 看起来就像「框不动」。这里的倍数优先从页面尺寸实测，测不到才用默认 10。
      function osmdUnitScale() {
        return 1;
      }

      function osmdToPx() {
        return null;
      }

      // 把滚动框放到这个音符上。
      // 高度取「同一小节里所有音符的纵向范围」——双谱表时自然就覆盖了高音+低音两条。
      function positionCursorBox() {
        /* 已移除 OSMD 光标框 */
      }

      // 滚动只认框自己的像素位置，不做任何单位换算
      var scoreScrollLock = 0;
      function scrollToBox() {
        /* 已移除 OSMD 滚动 */
      }

      // 每到一个进度点打一行诊断，出问题时把这几行发我就能定位
      function diagAt(mi) {
        if (!notes.length) return;
        var f = mi / notes.length;
        var marks = [0.25, 0.5, 0.75];
        for (var i = 0; i < marks.length; i++) {
          var k = marks[i];
          if (f >= k && !diagSeen[k]) {
            diagSeen[k] = 1;
            try {
              var si = scoreMap ? scoreMap[mi] : -1;
              var rec = (si >= 0 && score) ? score.notes[si] : null;
              var el = document.getElementById('cursorBox');
              console.log('[进度] ' + Math.round(k * 100) + '%  音符#' + mi + '/' + notes.length +
                '  谱面#' + si +
                (rec ? ('  小节' + rec.measure + ' ts=' + rec.ts.toFixed(2)) : '  未匹配') +
                '  图形=' + (rec && rec.gn ? 'Y' : 'N') +
                '  框=' + (el && el.style.display === 'block' ? '显示' : '隐藏'));
            } catch (e) { }
          }
        }
      }

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
      function scrollScoreTo() {
        /* 已移除 OSMD */
      }

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
          title: (scoreMeta && scoreMeta.title) || name || '',
          measures: res.measures,
          parts: res.parts
        };

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
        updateStatus();
        try { refreshMeasureOptions(); } catch (e6) { }
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

      function readAnyFile(f) {
        if (isXMLName(f.name)) readXMLFile(f);
        else readFile(f);
      }

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
      function loadImportedFiles(files) {
        if (!files || !files.length) return 0;
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
        barfill.style.width = '0%';
        curMeasureNo = -1; try { clearSvgHi(); hideFlowCursor(); } catch (e) { } timeEl.textContent = '0:00 / ' + fmt(total);
        updateStatus();

        curLegend = legend || [];
        refreshLegend();

        // 有了 MIDI，就能把谱面和音符对起来了
        if (score) { alignScoreToMidi(); updateStatus(); }
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

      // 导出视频
      expBtn.addEventListener('click', function () {
        if (!notes.length || exporting) return;
        expTip.textContent = '勾选「包含曲谱」会把五线谱一起录进画面（键盘自动压到下方）。键区范围、音名开关跟随页面当前设置。实时录制，时长≈曲长，录制中请保持本页在前台。';
        expStart.textContent = '开始导出';
        expStart.disabled = false;
        expModal.hidden = false;
      });

      expStart.addEventListener('click', function () {
        if (exporting) return;
        var wh = expRes.value.split('x');
        startExport({
          w: parseInt(wh[0], 10),
          h: parseInt(wh[1], 10),
          fps: parseInt(expFps.value, 10),
          audio: expAudio.checked,
          score: expScore.checked
        });
      });

      expCancel.addEventListener('click', function () {
        if (exporting) {
          stopExport(false);
          if (playing) {
            playing = false;
            playBtn.textContent = '播放';
            try { document.body.classList.toggle('cleanplay', !!playing); } catch (eCP) { }
            if (ac) ac.suspend();
          }
        } else {
          expModal.hidden = true;
        }
      });

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

      // ================= 对照流：SVG 五线谱 + 简谱 =================
      var MEAS_PER_LINE = 4;
      var flowZoom = 0.85;              // 谱面缩放（默认不铺满）
      var blocks = [];                  // 每个五线谱块
      var svgFlat = [];                 // 全局音符顺序
      var flowReady = false;
      var sysNow = -1;
      var svgReady = false, svgPages = [], svgSystems = [];
      var pendingPages = [];            // [{svg, vbW, vbH, x0, x1, inkW, systems, decors}]

      function wrapEl() { return document.getElementById('svgWrap'); }
      function hostEl() { return document.getElementById('svgHost'); }
      function cursorEl() { return document.getElementById('svgCursor'); }

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
      var FAMS = ['CommonLight', 'CommonSerif', 'CommonBlack', 'Roman', 'RomanItalic',
        'SparksNMN-EOPNumber', 'SparksNMN-mscore-20', 'SparksNMN-Bravura'];
      var fontsReady = false, fontsInjected = false;

      function fmtFor(u) {
        if (/\.woff2$/i.test(u)) return ' format("woff2")';
        if (/\.woff$/i.test(u)) return ' format("woff")';
        if (/\.ttf$/i.test(u)) return ' format("truetype")';
        if (/\.otf$/i.test(u)) return ' format("opentype")';
        return '';
      }

      function injectFonts() {
        if (fontsInjected) return;
        fontsInjected = true;
        var list = window.fontLoadData || [], root = window.fontCdnRoot || '';
        if (!list.length) return;
        // 本地字体根目录：由 jianpu-fonts.js 按自己的地址算好（多层目录的 md 页面也能取到）
        var local = window.fontLocalRoot || 'assets/fonts/';
        var css = [];
        for (var i = 0; i < list.length; i++) {
          var f = list[i];
          var src = 'url("' + local + f.url + '")' + fmtFor(f.url);
          if (root) src += ', url("' + root + '/' + f.url + '")' + fmtFor(f.url);
          css.push('@font-face{font-family:"' + f.name + '";src:' + src +
            ';font-weight:' + (f.weight || 'normal') + ';font-display:swap;}');
        }
        var st = document.createElement('style');
        st.id = 'jpFontCss';
        st.textContent = css.join('\n');
        document.head.appendChild(st);
      }

      function waitFonts(cb) {
        injectFonts();
        var done = false;
        var fin = function () { if (!done) { done = true; fontsReady = true; cb(); } };
        var jobs = [];
        try {
          if (document.fonts && document.fonts.load) {
            for (var i = 0; i < FAMS.length; i++) jobs.push(document.fonts.load('16px "' + FAMS[i] + '"'));
          }
        } catch (e) { }
        if (!jobs.length) { fin(); return; }
        Promise.all(jobs).then(fin).catch(fin);
        setTimeout(fin, 8000);
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
          box.style.cssText = 'position:relative;overflow:hidden;margin:0 auto;' +
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

      function buildFlow(forceW) {
        var host = hostEl();
        if (!host) return;
        if (!pendingPages.length) return;

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

        var jpAll = buildJpSections(groupW);
        var jpLines = [];
        for (var ji = 0; ji < jpAll.length; ji++) {
          if (/^musicLine--/.test(String(jpAll[ji].sec.label || ''))) jpLines.push(jpAll[ji]);
        }

        host.innerHTML = '';
        blocks = [];
        svgFlat = [];

        var pairCount = 0;
        for (var pi = 0; pi < pendingPages.length; pi++) {
          var pg = pendingPages[pi];
          for (var si = 0; si < pg.systems.length; si++) {
            var sys = pg.systems[si];
            var cropLeft = pg.x0;
            var cropW = pg.inkW;

            // 整页音符，用来决定上下要留多少
            var pageNotes = [], pnEls = pg.svg.querySelectorAll('.Note'), pn;
            for (pn = 0; pn < pnEls.length; pn++) {
              var ppos = matrixXY(pnEls[pn]);
              if (ppos) pageNotes.push(ppos);
            }
            var winTop = sys.top + 230, winBot = sys.bottom - 230;
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

            var cropTop = (pi === 0 && si === 0) ? 0 : Math.round(realTop - 20);
            var cropBot = Math.round(realBot + 20);
            var sysH = Math.max(80, cropBot - cropTop);

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
            host.appendChild(blkSys);

            var blkJp = null;
            if (pairCount < jpLines.length) {
              blkJp = document.createElement('div');
              blkJp.className = 'flowJp';
              blkJp.appendChild(jpLines[pairCount].el);
              host.appendChild(blkJp);
            }

            var blkIndex = blocks.length;
            blocks.push({
              el: blkSys, jpEl: blkJp, svg: clone,
              vbTop: cropTop, vbLeft: cropLeft, vbW: cropW, sysH: sysH,
              staffTop: sys.top + 130, staffBottom: sys.bottom - 130,
              page: pi, sys: si, noteCount: notes.length
            });

            for (var q = 0; q < notes.length; q++) {
              svgFlat.push({ blk: blkIndex, el: notes[q].el, x: notes[q].x, y: notes[q].y });
            }
            pairCount++;
          }
        }

        flowReady = svgFlat.length > 0;
        svgReady = flowReady;
        svgPages = pendingPages.slice();
        svgSystems = blocks.slice();

        // 每组在全局音符序列里的区间，简谱列框按这个比例定位
        var accN = 0;
        for (var biN = 0; biN < blocks.length; biN++) {
          blocks[biN]._bars = null;
          blocks[biN].noteFrom = accN;
          accN += blocks[biN].noteCount;
          blocks[biN].noteTo = accN;
        }

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
      }

      var curGroup = 0, curNoteGeo = null;

      function svgIndexOfScore(si) {
        if (!flowReady) return -1;
        var n = score ? score.notes.length : 0;
        if (!n) return -1;
        if (svgFlat.length === n) return si;
        return Math.min(svgFlat.length - 1, Math.floor(si * svgFlat.length / n));
      }

      function clearSvgHi() {
        for (var i = 0; i < svgFlat.length; i++) {
          if (svgFlat[i].el.classList.contains('svghl')) svgFlat[i].el.classList.remove('svghl');
        }
      }

      function paintSvg(list) {
        for (var i = 0; i < list.length; i++) {
          var k = svgIndexOfScore(list[i]);
          if (k >= 0 && svgFlat[k]) svgFlat[k].el.classList.add('svghl');
        }
      }

      function ensureCursor() {
        var b = cursorEl(), host = hostEl();
        if (!b) { b = document.createElement('div'); b.id = 'svgCursor'; }
        if (host && b.parentNode !== host) host.appendChild(b);
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

      // 当前小节在本组简谱行里的横向起止比例（按小节均分）
      function measureSpan(blk, idx) {
        try {
          if (score && score.notes && blk && idx >= blk.noteFrom && idx < blk.noteTo) {
            var a = score.notes[blk.noteFrom];
            var b = score.notes[blk.noteTo - 1];
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
          if (score && score.notes && blk && idx >= blk.noteFrom && idx < blk.noteTo) {
            var a = score.notes[blk.noteFrom];
            var b = score.notes[blk.noteTo - 1];
            var cur = score.notes[idx];
            if (a && b && cur && b.ts > a.ts) {
              var f = (cur.ts - a.ts) / (b.ts - a.ts);
              return Math.max(0, Math.min(1, f));
            }
          }
        } catch (e) { }
        if (blk && blk.noteTo > blk.noteFrom) {
          return Math.max(0, Math.min(1, (idx - blk.noteFrom) / (blk.noteTo - blk.noteFrom)));
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
        return blk.jpEl.querySelector('div') || blk.jpEl;
      }

      // 简谱行的「外框」。里面的 DomPaint 根 div 全靠绝对定位排内容，自身高度是 0，
      // 直接拿它量高度会得到 0 —— 框就永远看不见。真正有高度的是外面这一层。
      function jpFrame(blk) {
        var inner = jpInner(blk);
        if (!inner) return null;
        return inner.parentElement || inner;
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
            w: r.width,
            vis: vis,
            snd: snd,
            op0: els[i].style.opacity,
            flt0: els[i].style.filter
          });
        }
        list.sort(function (a, b) { return a.cx - b.cx; });
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
        var cnt = (blk.noteTo || 0) - (blk.noteFrom || 0);
        if (!(cnt > 0)) cnt = blk.noteCount || 1;
        var half = 0.42 / Math.max(1, cnt);
        return [Math.max(0, fr - half), Math.min(1, fr + half)];
      }

      // 点亮 / 熄灭当前音符（demo 的播放高亮用的就是这些 notehl 方块）
      function jpHiReset(keep) {
        var i;
        for (i = 0; i < jpHiNow.length; i++) {
          var old = jpHiNow[i];
          if (keep && keep.indexOf(old) >= 0) continue;
          try {
            old.el.style.visibility = old.vis;
            old.el.style.opacity = old.op0;
            old.el.style.filter = old.flt0;
            old.el.classList.remove('jpHit');
          } catch (e) { }
        }
        jpHiNow = keep ? keep.slice() : [];
        for (i = 0; i < jpHiNow.length; i++) {
          try {
            var elH = jpHiNow[i].el;
            elH.style.visibility = 'visible';
            // 高亮更醒目：原本只有 0.5 的半透明，压到 0.9 再稍微提饱和度
            elH.style.opacity = '0.9';
            elH.style.filter = 'saturate(1.4)';
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
        for (i = blk.noteFrom; i < blk.noteTo; i++) {
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
        var n = (blk && blk.noteTo || 0) - (blk && blk.noteFrom || 0);
        var fallback = n > 0 ? Math.max(0, Math.min(1, (k - blk.noteFrom + 0.5) / n)) : 0.5;
        if (!score || !score.notes || !blk) return fallback;
        if (k < blk.noteFrom || k >= blk.noteTo) return fallback;
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
        if (cols2.length && svgFlat && svgFlat.length === score.notes.length && list.length > 1) {
          var p = list.indexOf(k);
          if (p >= 0) {
            var a0 = svgFlat[list[0]], a1 = svgFlat[list[list.length - 1]], ac = svgFlat[k];
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

      // 第 k 个音符对应的简谱锚点：先在本小节里找最接近目标比例的一列，
      // 本小节没有锚点时才退回整行（和弦 / 多声部的锚点 x 相同，jpHighlightAt 统一点亮）
      function jpAnchorFor(blk, k) {
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

      function jpHighlightAt(blk, k) {
        var a = jpAnchorFor(blk, k);
        if (!a) { jpHiReset([]); return; }
        var gap = jpGap(blk);
        // 只点亮 x 落在当前这一列里的发声音符，别把下一列 / 休止块也点亮
        var tol = Math.max(3, (gap > 0 ? gap : a.w) * 0.45);
        var list = jpSounding(blk);
        var keep = [];
        for (var i = 0; i < list.length; i++) {
          if (Math.abs(list[i].cx - a.cx) <= tol && keep.indexOf(list[i]) < 0) keep.push(list[i]);
        }
        jpHiReset(keep);
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
      }

      function positionSvgCursorAt(k) {
        var box = cursorEl();
        if (!flowReady || k < 0 || k >= svgFlat.length) {
          if (box) box.style.display = 'none';
          clearJpHi();
          return;
        }
        var it = svgFlat[k];
        var blk = blocks[it.blk];
        if (!blk) {
          if (box) box.style.display = 'none';
          clearJpHi();
          return;
        }

        curGroup = it.blk;
        curNoteGeo = { x: it.x, y: it.y, blk: it.blk, idx: k };

        if (it.blk !== sysNow) {
          sysNow = it.blk;
          try { ensureBlockVisible(blk); } catch (eS) { }
        }

        // 简谱：只点亮当前音符（不再画播放框；和五线谱各自独立，一边失败不影响另一边）
        try {
          jpHighlightAt(blk, k);
        } catch (eJp) {
          try { clearJpHi(); } catch (e2) { }
        }

        if (!box) return;
        var host = hostEl();
        var svgEl = blk.svg || blk.el.querySelector('svg');
        if (!host || !svgEl) { box.style.display = 'none'; return; }
        var hr = host.getBoundingClientRect();
        var sr = svgEl.getBoundingClientRect();
        if (!sr.width || !sr.height) { box.style.display = 'none'; return; }

        var kk = sr.width / blk.vbW;
        var leftC = (sr.left - hr.left) + (it.x + 16 - (blk.vbLeft || 0)) * kk;   // +16：符头中心
        var topC = (sr.top - hr.top) + (blk.staffTop - blk.vbTop) * kk;
        var botC = (sr.top - hr.top) + (blk.staffBottom - blk.vbTop) * kk;
        if (!isFinite(leftC) || !isFinite(topC) || botC - topC < 4) {
          box.style.display = 'none';
          return;
        }

        box.style.display = 'block';
        // 框宽按谱面缩放走：70 个 viewBox 单位 ≈ 两个符头宽
        var bw = Math.max(8, Math.round(70 * kk));
        box.style.left = Math.round(leftC - bw / 2) + 'px';
        box.style.top = Math.round(topC) + 'px';
        box.style.width = bw + 'px';
        box.style.height = Math.round(botC - topC) + 'px';
      }

      // 兼容旧调用：传 MusicXML 音符下标
      function positionSvgCursor(scoreIdx) {
        var k = svgIndexOfScore(scoreIdx);
        if (k < 0) {
          var b = cursorEl();
          if (b) b.style.display = 'none';
          clearJpHi();
          return;
        }
        positionSvgCursorAt(k);
      }

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
          importFiles: loadImportedFiles
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
      (function fitBoardHeight() {
        // 键盘高 ÷ 舞台宽。嵌入到 16:9 的页面里键盘要矮一点，可以用
        // window.KB_KEY_RATIO 覆盖（默认 0.17 是 3:4 竖屏的比例）
        function ratio() {
          var r = parseFloat(window.KB_KEY_RATIO);
          return (isFinite(r) && r > 0.05 && r < 0.5) ? r : 0.17;
        }
        function apply() {
          var st = document.querySelector('.stage');
          var bd = document.getElementById('board');
          if (!st || !bd) return;
          var w = st.clientWidth;
          if (w <= 0) return;
          var h = Math.round(w * ratio());
          h = Math.max(56, Math.min(170, h));
          bd.style.height = h + 'px';
        }
        apply();
        window.addEventListener('resize', function () { requestAnimationFrame(apply); });
        // 舞台尺寸可能在布局稳定后才正确，补两次
        setTimeout(apply, 120);
        setTimeout(apply, 600);
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

      function collectSongData() {
        var pages = [], i, j;

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
          title: (scoreMeta && scoreMeta.title) || '',
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
          settings: {
            full88: !!fullChk.checked,
            labels: !!labelChk.checked,
            colorMode: COLOR_MODE,
            flowZoom: flowZoom,
            startMeasure: parseInt((startMeasSel && startMeasSel.value) || '1', 10) || 1
          }
        };
      }

      function exportSongFile(opts) {
        opts = opts || {};
        if (!notes.length) return null;
        var data = collectSongData();
        var js = '/* 键盘播放器数据 —— 由 keyboard-svg-vertical.html 的「导出数据 JS」生成。\n' +
          '   用法：存到 keyboard-player.html 旁边即可（播放页默认读 song.data.js），\n' +
          '   或者直接把本文件拖进播放页。\n' +
          '   曲目：' + String(data.title || data.label || '').replace(/\*\//g, '* /') +
          ' · 音符 ' + data.notes.length + ' · 谱面 ' + (data.score ? data.score.notes.length : 0) +
          ' · SVG ' + data.svgPages.length + ' 页 · 简谱 ' + data.efData.length + ' 节 */\n' +
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
            '，SVG ' + out.data.svgPages.length + ' 页，简谱 ' + out.data.efData.length + ' 节）');
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
        jpCols = [];
        stackBmp = null;
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

        // 2) 谱面（MusicXML 解析结果）
        scoreMeta = data.scoreMeta || null;
        if (data.score && data.score.notes && data.score.notes.length) {
          score = {
            title: data.score.title || '',
            measures: data.score.measures || 0,
            parts: data.score.parts || 0,
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
            try { refreshLegend(); } catch (eL) { }
            updateStatus();
            applyStartMeasureFromData(data.settings);
          };
          if (fontsReady) requestAnimationFrame(build);
          else waitFonts(function () { requestAnimationFrame(build); });
        } else {
          try { renderScoreInfo(); } catch (eR2) { }
          updateStatus();
          applyStartMeasureFromData(data.settings);
        }

        if (dataBtn) dataBtn.disabled = false;
        return true;
      }

      // 页面暴露给「导出数据 JS」按钮 / 独立播放页用
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
        setZoom: changeZoom
      };

      if (dataBtn) {
        dataBtn.addEventListener('click', function () { downloadSongFile(); });
        dataBtn.disabled = !notes.length;
      }
    })();
