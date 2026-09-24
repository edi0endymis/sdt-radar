/**
 * game.js —— 雷达侦测游戏:状态机、Canvas 雷达渲染、结果展示、历史记录
 * 依赖:js/sdt.js (window.SDT)、js/viz.js (window.SDTViz)
 * 纯前端,file:// 双击 index.html 即可运行(不使用 ES module / fetch)。
 */
(function () {
  'use strict';

  var SDT = window.SDT;
  var Viz = window.SDTViz;

  /* ==================== DOM 引用 ==================== */
  var $ = function (id) { return document.getElementById(id); };
  var el = {
    screenSetup: $('screen-setup'),
    screenGame: $('screen-game'),
    screenResults: $('screen-results'),
    inTrials: $('in-trials'),
    inPrior: $('in-prior'),
    outPrior: $('out-prior'),
    inDprimeCustom: $('in-dprime-custom'),
    outDprimeCustom: $('out-dprime-custom'),
    inStim: $('in-stim'),
    outStim: $('out-stim'),
    inResp: $('in-resp'),
    outResp: $('out-resp'),
    inFeedback: $('in-feedback'),
    inSound: $('in-sound'),
    btnStart: $('btn-start'),
    hudTrial: $('hud-trial'),
    hudPhase: $('hud-phase'),
    hudClock: $('hud-clock'),
    progressBar: $('progress-bar'),
    radar: $('radar'),
    feedbackFlash: $('feedback-flash'),
    btnYes: $('btn-yes'),
    btnNo: $('btn-no'),
    respBar: $('resp-bar'),
    lcH: $('lc-h'), lcM: $('lc-m'), lcFA: $('lc-fa'), lcCR: $('lc-cr'),
    miniParams: $('mini-params'),
    btnAbort: $('btn-abort'),
    rWarn: $('result-warning'),
    rPhit: $('r-phit'), rPfa: $('r-pfa'), rDprime: $('r-dprime'),
    rCrit: $('r-crit'), rBeta: $('r-beta'), rAcc: $('r-acc'),
    cH: $('c-h'), cM: $('c-m'), cFA: $('c-fa'), cCR: $('c-cr'),
    rMeta: $('r-meta'),
    rInterpret: $('r-interpret'),
    vizDist: $('viz-dist'),
    vizC: $('viz-c'), vizCOut: $('viz-c-out'),
    vizD: $('viz-d'), vizDOut: $('viz-d-out'),
    vizMeasured: $('viz-measured'),
    vizReadout: $('viz-readout'),
    vizRoc: $('viz-roc'),
    trialLog: $('trial-log'),
    historyTable: $('history-table'),
    btnClearHistory: $('btn-clear-history'),
    btnAgain: $('btn-again'),
    btnSetup: $('btn-setup'),
    footParams: $('foot-params'),
  };

  /* ==================== 全局状态 ==================== */
  var S = {
    params: null,        // { n, prior, dPrime, stimMs, respMs, feedback, sound }
    deck: [],            // 试次序列 [{signal: bool}]
    idx: 0,              // 当前试次下标
    results: [],         // [{signal, respondSignal, timeout, rt}]
    phase: 'idle',       // idle|isi|stim|respond|feedback|done
    phaseEnd: 0,
    respondStart: 0,
    dots: [],            // 当前刺激光点 [{x,y,intensity}]
    sweepAngle: 0,
    raf: 0,
    stats: null,
  };

  var NOISE_DOTS = 26;          // 每帧杂波点数量
  var ISI_MS = 500;             // 试次间隔(准备期)
  var FEEDBACK_MS = 700;
  var HISTORY_KEY = 'sdt-radar-history';

  /* ==================== 音效(可选) ==================== */
  var audioCtx = null;
  function beep(freq, dur, type) {
    if (!S.params || !S.params.sound) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      var o = audioCtx.createOscillator();
      var g = audioCtx.createGain();
      o.type = type || 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.08, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(); o.stop(audioCtx.currentTime + dur);
    } catch (e) { /* 无音频环境时静默 */ }
  }
  var SFX = {
    H: function () { beep(880, 0.12); },
    M: function () { beep(160, 0.3, 'sawtooth'); },
    FA: function () { beep(440, 0.1, 'square'); setTimeout(function () { beep(440, 0.1, 'square'); }, 140); },
    CR: function () { beep(520, 0.07); },
  };

  /* ==================== 屏幕切换 ==================== */
  function showScreen(name) {
    [el.screenSetup, el.screenGame, el.screenResults].forEach(function (s) {
      s.classList.remove('active');
    });
    name.classList.add('active');
    window.scrollTo(0, 0);
  }

  /* ==================== 参数读取 ==================== */
  function readParams() {
    var n = Math.round(Number(el.inTrials.value));
    if (!isFinite(n)) n = 30;
    n = Math.min(200, Math.max(20, n));   // 硬性要求:每局 ≥ 20 试次
    el.inTrials.value = n;

    var radio = document.querySelector('input[name="dprime"]:checked');
    var dPrime = radio && radio.value === 'custom'
      ? Number(el.inDprimeCustom.value)
      : Number(radio ? radio.value : 1.5);

    return {
      n: n,
      prior: Number(el.inPrior.value),
      dPrime: dPrime,
      stimMs: Number(el.inStim.value),
      respMs: Number(el.inResp.value),
      feedback: el.inFeedback.checked,
      sound: el.inSound.checked,
    };
  }

  /* ==================== 试次序列生成 ==================== */
  /**
   * 固定边际次数设计:信号试次数 = round(P(S)·N),并夹在 [2, N-2],
   * 保证每类试次至少出现两次,SDT 指标才可估计。随后洗牌。
   */
  function buildDeck(n, prior) {
    var nSignal = Math.round(prior * n);
    nSignal = Math.max(2, Math.min(n - 2, nSignal));
    var deck = [];
    var i;
    for (i = 0; i < nSignal; i++) deck.push({ signal: true });
    for (i = nSignal; i < n; i++) deck.push({ signal: false });
    for (i = deck.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = deck[i]; deck[i] = deck[j]; deck[j] = t;
    }
    return deck;
  }

  /** 生成本试次刺激光点:噪声点 ~ N(0,1) 强度;信号试次追加一个 ~ N(d′,1) 的目标 */
  function makeStimulus(signal) {
    var dots = [];
    var i;
    var R = 0.42; // 光点分布半径(占画布比例)
    for (i = 0; i < NOISE_DOTS; i++) {
      var a = Math.random() * Math.PI * 2;
      var r = R * Math.sqrt(Math.random());
      dots.push({
        x: 0.5 + r * Math.cos(a),
        y: 0.5 + r * Math.sin(a),
        intensity: SDT.gaussianSample(0, 1),
        noise: true,
      });
    }
    if (signal) {
      var a2 = Math.random() * Math.PI * 2;
      var r2 = R * Math.sqrt(Math.random());
      dots.push({
        x: 0.5 + r2 * Math.cos(a2),
        y: 0.5 + r2 * Math.sin(a2),
        intensity: SDT.gaussianSample(S.params.dPrime, 1),
        noise: false,
      });
    }
    return dots;
  }

  /* ==================== 雷达绘制 ==================== */
  var ctx = el.radar.getContext('2d');
  var RW = el.radar.width;   // 560
  var RC = RW / 2;

  function drawRadarBase(withSweep) {
    ctx.clearRect(0, 0, RW, RW);
    // 底
    var grad = ctx.createRadialGradient(RC, RC, 0, RC, RC, RC);
    grad.addColorStop(0, '#07160c');
    grad.addColorStop(1, '#030a06');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, RW, RW);

    // 距离环
    ctx.strokeStyle = 'rgba(78,240,138,0.18)';
    ctx.lineWidth = 1;
    [0.25, 0.5, 0.75, 1].forEach(function (k) {
      ctx.beginPath();
      ctx.arc(RC, RC, RC * 0.96 * k, 0, Math.PI * 2);
      ctx.stroke();
    });
    // 十字线 + 外圈
    ctx.beginPath();
    ctx.moveTo(RC, RC * 0.04); ctx.lineTo(RC, RC * 1.96);
    ctx.moveTo(RC * 0.04, RC); ctx.lineTo(RC * 1.96, RC);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(78,240,138,0.45)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(RC, RC, RC * 0.96, 0, Math.PI * 2);
    ctx.stroke();

    if (withSweep) {
      // 旋转扫描臂 + 余辉拖尾
      var seg = 48;
      for (var i = 0; i < seg; i++) {
        var ang = S.sweepAngle - (i / seg) * 0.9;
        ctx.beginPath();
        ctx.moveTo(RC, RC);
        ctx.arc(RC, RC, RC * 0.96, ang, ang + 0.02);
        ctx.closePath();
        ctx.fillStyle = 'rgba(78,240,138,' + (0.10 * (1 - i / seg)) + ')';
        ctx.fill();
      }
      ctx.strokeStyle = 'rgba(78,240,138,0.7)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(RC, RC);
      ctx.lineTo(RC + Math.cos(S.sweepAngle) * RC * 0.96,
                 RC + Math.sin(S.sweepAngle) * RC * 0.96);
      ctx.stroke();
    }
  }

  /** 强度 → 视觉映射:亮度/半径随 intensity 单调上升(信号检测的知觉依据) */
  function drawDot(x, y, intensity, flicker) {
    var px = x * RW;
    var py = y * RW;
    var r = Math.max(1.6, 2.2 + intensity * 1.35);
    var alpha = Math.max(0.12, Math.min(1, 0.30 + intensity * 0.20));
    alpha = Math.max(0.10, alpha + (flicker || 0));
    var glow = ctx.createRadialGradient(px, py, 0, px, py, r * 2.4);
    glow.addColorStop(0, 'rgba(140,255,190,' + alpha + ')');
    glow.addColorStop(0.45, 'rgba(78,240,138,' + alpha * 0.55 + ')');
    glow.addColorStop(1, 'rgba(78,240,138,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(px, py, r * 2.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(200,255,220,' + Math.min(1, alpha + 0.2) + ')';
    ctx.beginPath();
    ctx.arc(px, py, r * 0.55, 0, Math.PI * 2);
    ctx.fill();
  }

  /* ==================== 游戏状态机 ==================== */
  function startRound() {
    S.params = readParams();
    S.deck = buildDeck(S.params.n, S.params.prior);
    S.idx = 0;
    S.results = [];
    S.stats = null;
    updateLiveCounts();
    el.miniParams.innerHTML =
      'N=' + S.params.n +
      ' · P(S)=' + S.params.prior.toFixed(2) +
      " · 设定 d′=" + S.params.dPrime.toFixed(1) +
      '<br>刺激 ' + S.params.stimMs + 'ms · 作答 ' + S.params.respMs + 'ms';
    showScreen(el.screenGame);
    nextTrial();
    if (!S.raf) S.raf = requestAnimationFrame(tick);
  }

  function nextTrial() {
    if (S.idx >= S.deck.length) { endRound(); return; }
    S.phase = 'isi';
    S.phaseEnd = performance.now() + ISI_MS;
    S.dots = [];
    el.hudTrial.textContent = '试次 ' + (S.idx + 1) + ' / ' + S.deck.length;
    el.hudPhase.textContent = '扫描中…';
    el.hudPhase.className = 'phase';
    el.progressBar.style.width = (S.idx / S.deck.length) * 100 + '%';
    el.respBar.style.width = '100%';
    el.feedbackFlash.className = 'feedback-flash';
  }

  function enterStim() {
    S.phase = 'stim';
    S.phaseEnd = performance.now() + S.params.stimMs;
    S.dots = makeStimulus(S.deck[S.idx].signal);
    el.hudPhase.textContent = '回波出现!';
    el.hudClock.textContent = '';
  }

  function enterRespond() {
    S.phase = 'respond';
    S.respondStart = performance.now();
    S.phaseEnd = S.respondStart + S.params.respMs;
    el.hudPhase.textContent = '请判断 F/J';
    el.hudPhase.className = 'phase respond';
  }

  function answer(respondSignal, timeout) {
    if (S.phase !== 'respond') return;   // 防抖:仅在作答窗内接受
    var rt = performance.now() - S.respondStart;
    var trial = S.deck[S.idx];
    var rec = {
      signal: trial.signal,
      respondSignal: respondSignal,
      timeout: !!timeout,
      rt: Math.round(rt),
      n: S.idx + 1,
    };
    S.results.push(rec);
    S.idx++;
    updateLiveCounts();

    var kind;
    if (rec.signal && rec.respondSignal) kind = 'H';
    else if (rec.signal) kind = 'M';
    else if (rec.respondSignal) kind = 'FA';
    else kind = 'CR';

    if (S.params.feedback) {
      showFeedback(kind, rec.timeout);
      S.phase = 'feedback';
      S.phaseEnd = performance.now() + FEEDBACK_MS;
    } else {
      nextTrial();
    }
  }

  function showFeedback(kind, timeout) {
    var map = {
      H: ['命中 HIT', 'f-hit'],
      M: ['漏报 MISS', 'f-miss'],
      FA: ['虚报 FALSE ALARM', 'f-fa'],
      CR: ['正确拒斥 CR', 'f-cr'],
    };
    var m = map[kind];
    el.feedbackFlash.textContent = timeout ? m[0] + '(超时)' : m[0];
    el.feedbackFlash.className = 'feedback-flash show ' + m[1];
    SFX[kind]();
  }

  function updateLiveCounts() {
    var c = SDT.countOutcomes(S.results);
    el.lcH.textContent = c.H;
    el.lcM.textContent = c.M;
    el.lcFA.textContent = c.FA;
    el.lcCR.textContent = c.CR;
  }

  /** 主循环:渲染 + 相位推进 */
  function tick(now) {
    S.raf = requestAnimationFrame(tick);
    now = now || performance.now();
    S.sweepAngle += 0.03;

    if (S.phase === 'idle' || S.phase === 'done' || S.phase === 'paused') {
      drawRadarBase(true);
      return;
    }

    if (S.phase === 'isi') {
      drawRadarBase(true);
      if (now >= S.phaseEnd) enterStim();
      return;
    }

    if (S.phase === 'feedback') {
      drawRadarBase(true);
      if (now >= S.phaseEnd) nextTrial();
      return;
    }

    if (S.phase === 'stim') {
      drawRadarBase(false);
      // 刺激呈现:杂波 + (可选)目标,加轻微荧光闪烁
      for (var i = 0; i < S.dots.length; i++) {
        var d = S.dots[i];
        drawDot(d.x, d.y, d.intensity, (Math.random() - 0.5) * 0.06);
      }
      if (now >= S.phaseEnd) enterRespond();
      return;
    }

    if (S.phase === 'respond') {
      drawRadarBase(true);
      var remain = Math.max(0, S.phaseEnd - now);
      el.respBar.style.width = (remain / S.params.respMs) * 100 + '%';
      el.hudClock.textContent = (remain / 1000).toFixed(1) + 's';
      if (remain <= 0) answer(false, true);   // 超时按「无目标」计
      return;
    }
  }

  /* ==================== 结果展示 ==================== */
  function endRound() {
    S.phase = 'done';
    el.progressBar.style.width = '100%';
    var stats = SDT.computeStats(S.results);
    S.stats = stats;
    renderResults(stats);
    saveHistory(stats);
    renderHistory();
    showScreen(el.screenResults);
  }

  function fmt(x, digits) {
    return (typeof x === 'number' && isFinite(x)) ? x.toFixed(digits == null ? 2 : digits) : '—';
  }

  function renderResults(stats) {
    var c = stats.counts;
    el.cH.textContent = c.H;
    el.cM.textContent = c.M;
    el.cFA.textContent = c.FA;
    el.cCR.textContent = c.CR;

    el.rPhit.textContent = fmt(stats.pHit);
    el.rPfa.textContent = fmt(stats.pFA);
    el.rDprime.textContent = fmt(stats.dPrime);
    el.rCrit.textContent = fmt(stats.criterion);
    el.rBeta.textContent = fmt(stats.beta);
    el.rAcc.textContent = fmt(stats.accuracy * 100, 1) + '%';

    // 警告:校正说明 / 缺失类别 / 超时
    var warns = stats.warnings.slice();
    if (stats.corrected) {
      warns.push('存在 0 计数的格子,已按 log-linear 规则给四格各 +0.5 校正极端比例。');
    }
    if (c.timeouts > 0) {
      warns.push(c.timeouts + ' 个试次超时未答,按报告「无目标」计入。');
    }
    if (warns.length) {
      el.rWarn.innerHTML = warns.join('<br>');
      el.rWarn.hidden = false;
    } else {
      el.rWarn.hidden = true;
    }

    el.rMeta.innerHTML =
      '信号试次 ' + stats.signalTrials + ' · 噪声试次 ' + stats.noiseTrials +
      ' · 共 ' + c.n + ' 试次' +
      (stats.computable
        ? '<br>z(H)=' + fmt(stats.zHit, 3) + ' · z(FA)=' + fmt(stats.zFA, 3) +
          ' · 准则位置 x<sub>c</sub>=' + fmt(stats.criterionX, 3)
        : '');

    // 文字解读
    if (stats.computable) {
      var bias = stats.criterion > 0.2 ? '偏保守(倾向报告「无目标」,虚报少但易漏报)'
               : stats.criterion < -0.2 ? '偏冒进(倾向报告「有目标」,命中高但虚报多)'
               : '相对中立';
      el.rInterpret.innerHTML =
        '解读:实测感受性 d′=' + fmt(stats.dPrime) +
        '(本局设定难度 d′=' + S.params.dPrime.toFixed(1) + '),数值越大说明你越能区分敌机与杂波;' +
        '判断标准 c=' + fmt(stats.criterion) + ',' + bias + '。' +
        'β=' + fmt(stats.beta) + '(β&gt;1 偏保守,β&lt;1 偏冒进)。';
    } else {
      el.rInterpret.textContent = '本局数据不足以计算 SDT 指标,请调整参数(提高试次数或 P(S))后再试。';
    }

    // 可视化:同步滑块到实测值附近
    el.vizD.value = stats.computable ? Math.min(4, Math.max(0, stats.dPrime)) : S.params.dPrime;
    el.vizDOut.textContent = Number(el.vizD.value).toFixed(2);
    el.vizC.value = stats.computable ? Math.min(3, Math.max(-3, stats.criterion)) : 0;
    el.vizCOut.textContent = Number(el.vizC.value).toFixed(2);
    drawViz();

    // 试次日志
    var html = '<tr><th>#</th><th>真实状态</th><th>你的报告</th><th>结果</th><th>RT(ms)</th></tr>';
    var name = { H: '命中', M: '漏报', FA: '虚报', CR: '正确拒斥' };
    S.results.forEach(function (r) {
      var kind = r.signal ? (r.respondSignal ? 'H' : 'M') : (r.respondSignal ? 'FA' : 'CR');
      html += '<tr><td>' + r.n + '</td><td>' + (r.signal ? '有信号' : '无信号') + '</td><td>' +
        (r.respondSignal ? '有目标' : '无目标') + (r.timeout ? ' (超时)' : '') + '</td><td>' +
        name[kind] + '</td><td>' + (r.timeout ? '—' : r.rt) + '</td></tr>';
    });
    el.trialLog.innerHTML = html;
  }

  /** 重画两幅图并更新读数 */
  function drawViz() {
    var dHypo = Number(el.vizD.value);
    var cHypo = Number(el.vizC.value);
    el.vizDOut.textContent = dHypo.toFixed(2);
    el.vizCOut.textContent = cHypo.toFixed(2);
    var xc = cHypo + dHypo / 2;
    var measuredX = S.stats && S.stats.computable ? S.stats.criterionX : null;
    var theory = Viz.drawDistributions(el.vizDist, {
      dPrime: dHypo,
      criterionX: xc,
      measuredX: measuredX,
      showMeasured: el.vizMeasured.checked,
    });
    el.vizReadout.innerHTML =
      '假想:准则 x<sub>c</sub>=' + xc.toFixed(2) +
      '(c=' + cHypo.toFixed(2) + ", d′=" + dHypo.toFixed(2) + ') → 理论 P(H)=' +
      theory.pH.toFixed(3) + ',P(FA)=' + theory.pFA.toFixed(3) +
      (S.stats && S.stats.computable
        ? ' | 本局实测:P(H)=' + fmt(S.stats.pHit, 3) + ',P(FA)=' + fmt(S.stats.pFA, 3) +
          ",d′=" + fmt(S.stats.dPrime) + ',c=' + fmt(S.stats.criterion)
        : '');
    Viz.drawROC(el.vizRoc, {
      dPrime: dHypo,
      point: el.vizMeasured.checked && S.stats && S.stats.computable
        ? { pFA: S.stats.pFA, pH: S.stats.pHit }
        : null,
    });
  }

  /* ==================== 历史记录(localStorage) ==================== */
  function loadHistory() {
    try {
      var raw = localStorage.getItem(HISTORY_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }

  function saveHistory(stats) {
    try {
      var arr = loadHistory();
      arr.unshift({
        t: Date.now(),
        n: S.params.n,
        prior: S.params.prior,
        dSet: S.params.dPrime,
        acc: stats.accuracy,
        dPrime: stats.computable ? stats.dPrime : null,
        c: stats.computable ? stats.criterion : null,
        pH: stats.computable ? stats.pHit : null,
        pFA: stats.computable ? stats.pFA : null,
      });
      if (arr.length > 20) arr.length = 20;
      localStorage.setItem(HISTORY_KEY, JSON.stringify(arr));
    } catch (e) { /* file:// 或隐私模式下不可写时忽略 */ }
  }

  function renderHistory() {
    var arr = loadHistory();
    if (!arr.length) {
      el.historyTable.innerHTML = '<tr><td class="hint">暂无历史记录</td></tr>';
      return;
    }
    var html = '<tr><th>时间</th><th>N</th><th>P(S)</th><th>设定d′</th><th>实测d′</th><th>c</th><th>P(H)</th><th>P(FA)</th><th>准确率</th></tr>';
    arr.forEach(function (r) {
      var d = new Date(r.t);
      var ts = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
      html += '<tr><td>' + ts + '</td><td>' + r.n + '</td><td>' + r.prior.toFixed(2) +
        '</td><td>' + r.dSet.toFixed(1) + '</td><td>' + fmt(r.dPrime) + '</td><td>' +
        fmt(r.c) + '</td><td>' + fmt(r.pH) + '</td><td>' + fmt(r.pFA) + '</td><td>' +
        fmt(r.acc * 100, 0) + '%</td></tr>';
    });
    el.historyTable.innerHTML = html;
  }

  /* ==================== 事件绑定 ==================== */
  function bind() {
    // 参数输出回显
    el.inPrior.addEventListener('input', function () { el.outPrior.textContent = Number(el.inPrior.value).toFixed(2); });
    el.inStim.addEventListener('input', function () { el.outStim.textContent = el.inStim.value + ' ms'; });
    el.inResp.addEventListener('input', function () { el.outResp.textContent = el.inResp.value + ' ms'; });
    el.inDprimeCustom.addEventListener('input', function () { el.outDprimeCustom.textContent = Number(el.inDprimeCustom.value).toFixed(1); });
    document.querySelectorAll('input[name="dprime"]').forEach(function (r) {
      r.addEventListener('change', function () {
        el.inDprimeCustom.disabled = r.value !== 'custom' || !r.checked;
      });
    });

    el.btnStart.addEventListener('click', startRound);
    el.btnYes.addEventListener('click', function () { answer(true, false); });
    el.btnNo.addEventListener('click', function () { answer(false, false); });
    el.btnAbort.addEventListener('click', function () {
      if (confirm('确定中止本局?当前试次数据将不保存。')) {
        S.phase = 'done';
        showScreen(el.screenSetup);
      }
    });
    el.btnAgain.addEventListener('click', startRound);
    el.btnSetup.addEventListener('click', function () { showScreen(el.screenSetup); });
    el.btnClearHistory.addEventListener('click', function () {
      try { localStorage.removeItem(HISTORY_KEY); } catch (e) {}
      renderHistory();
    });
    [el.vizC, el.vizD, el.vizMeasured].forEach(function (c) {
      c.addEventListener('input', drawViz);
    });

    // 键盘作答:F=有目标,J=无目标,Esc=中止
    document.addEventListener('keydown', function (e) {
      if (!el.screenGame.classList.contains('active')) return;
      if (e.key === 'f' || e.key === 'F') { e.preventDefault(); answer(true, false); }
      else if (e.key === 'j' || e.key === 'J') { e.preventDefault(); answer(false, false); }
      else if (e.key === 'Escape') {
        S.phase = 'done';
        showScreen(el.screenSetup);
      }
    });

    // 切后台自动暂停:rAF 在隐藏标签页不触发,回来后相位计时原样恢复,
    // 避免连续跳过刺激/作答窗导致整局被动超时
    var pauseSnap = null;
    document.addEventListener('visibilitychange', function () {
      var timed = { isi: 1, stim: 1, respond: 1, feedback: 1 };
      if (document.hidden) {
        if (timed[S.phase]) {
          pauseSnap = {
            phase: S.phase,
            remaining: S.phaseEnd - performance.now(),
            label: el.hudPhase.textContent,
            cls: el.hudPhase.className,
          };
          S.phase = 'paused';
          el.hudPhase.textContent = '已暂停';
          el.hudPhase.className = 'phase';
        }
      } else if (S.phase === 'paused' && pauseSnap) {
        S.phase = pauseSnap.phase;
        S.phaseEnd = performance.now() + Math.max(0, pauseSnap.remaining);
        el.hudPhase.textContent = pauseSnap.label;
        el.hudPhase.className = pauseSnap.cls;
        pauseSnap = null;
      }
    });
  }

  bind();
  S.raf = requestAnimationFrame(tick);   // 待机时也跑扫描动画
  renderHistory();
})();
