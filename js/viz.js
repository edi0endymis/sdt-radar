/**
 * viz.js —— SDT 概念可视化:双正态分布图 + ROC 曲线(纯 Canvas,无依赖)
 * 浏览器环境挂载到 window.SDTViz。
 */
(function (root) {
  'use strict';

  var COL = {
    noise: '#5fd4ff',
    signal: '#4ef08a',
    criterion: '#ffb454',
    measured: '#ff5f56',
    faFill: 'rgba(255,180,84,0.25)',
    missFill: 'rgba(255,95,86,0.25)',
    grid: '#1e3242',
    axis: '#7d97a8',
    txt: '#d8e6ee',
  };

  function prep(canvas) {
    // 画布位图尺寸由 width/height 属性固定,CSS 负责缩放;此处按位图坐标绘制
    var w = canvas.width;
    var h = canvas.height;
    var ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx: ctx, w: w, h: h };
  }

  /**
   * 绘制双分布图。
   * opts: { dPrime, criterionX, measuredX (可空), showMeasured }
   * 返回假想准则下的理论 P(FA) 与 P(H)。
   */
  function drawDistributions(canvas, opts) {
    var SDT = root.SDT;
    var d = opts.dPrime;
    var cx = opts.criterionX;
    var g = prep(canvas);
    var ctx = g.ctx;
    var W = g.w;
    var H = g.h;
    var pad = { l: 46, r: 16, t: 26, b: 34 };
    var x0 = Math.min(-3.5, cx - 1.5, -d / 2 - 2.5);
    var x1 = Math.max(d + 3.5, cx + 1.5, d / 2 + 2.5);
    var yMax = Math.max(SDT.normPdf(0), SDT.normPdf(0)) * 1.12;
    function X(x) { return pad.l + ((x - x0) / (x1 - x0)) * (W - pad.l - pad.r); }
    function Y(y) { return H - pad.b - (y / yMax) * (H - pad.t - pad.b); }

    // 网格 + 坐标轴
    ctx.strokeStyle = COL.grid;
    ctx.fillStyle = COL.axis;
    ctx.font = '10px sans-serif';
    ctx.lineWidth = 1;
    for (var gx = Math.ceil(x0); gx <= Math.floor(x1); gx++) {
      ctx.beginPath(); ctx.moveTo(X(gx), pad.t); ctx.lineTo(X(gx), H - pad.b); ctx.stroke();
      ctx.fillText(String(gx), X(gx) - 4, H - pad.b + 14);
    }
    ctx.strokeStyle = COL.axis;
    ctx.beginPath(); ctx.moveTo(pad.l, H - pad.b); ctx.lineTo(W - pad.r, H - pad.b); ctx.stroke();
    ctx.fillText('证据强度 x', W - pad.r - 52, H - pad.b + 28);

    var steps = 300;
    var i, x, y;

    // FA 阴影:准则右侧、噪声曲线下
    ctx.fillStyle = COL.faFill;
    ctx.beginPath();
    ctx.moveTo(X(Math.max(cx, x0)), Y(0));
    for (i = 0; i <= steps; i++) {
      x = x0 + ((x1 - x0) * i) / steps;
      if (x < cx) continue;
      ctx.lineTo(X(x), Y(SDT.normPdf(x)));
    }
    ctx.lineTo(X(x1), Y(0));
    ctx.closePath();
    ctx.fill();

    // 漏报阴影:准则左侧、信号曲线下
    ctx.fillStyle = COL.missFill;
    ctx.beginPath();
    ctx.moveTo(X(x0), Y(0));
    for (i = 0; i <= steps; i++) {
      x = x0 + ((x1 - x0) * i) / steps;
      if (x > cx) break;
      ctx.lineTo(X(x), Y(SDT.normPdf(x - d)));
    }
    ctx.lineTo(X(Math.min(cx, x1)), Y(0));
    ctx.closePath();
    ctx.fill();

    // 噪声曲线
    ctx.strokeStyle = COL.noise;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (i = 0; i <= steps; i++) {
      x = x0 + ((x1 - x0) * i) / steps;
      y = Y(SDT.normPdf(x));
      if (i === 0) ctx.moveTo(X(x), y); else ctx.lineTo(X(x), y);
    }
    ctx.stroke();

    // 信号曲线
    ctx.strokeStyle = COL.signal;
    ctx.beginPath();
    for (i = 0; i <= steps; i++) {
      x = x0 + ((x1 - x0) * i) / steps;
      y = Y(SDT.normPdf(x - d));
      if (i === 0) ctx.moveTo(X(x), y); else ctx.lineTo(X(x), y);
    }
    ctx.stroke();

    // 分布均值刻度与图例
    ctx.fillStyle = COL.noise;
    ctx.fillText('噪声 N(0,1)', X(0) - 30, pad.t + 4);
    ctx.fillStyle = COL.signal;
    ctx.fillText("信号 N(d′,1)", X(d) - 30, pad.t + 4);

    // 假想准则线(实线)
    ctx.strokeStyle = COL.criterion;
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(X(cx), pad.t); ctx.lineTo(X(cx), H - pad.b); ctx.stroke();
    ctx.fillStyle = COL.criterion;
    ctx.fillText('假想准则', X(cx) + 4, pad.t + 14);

    // 实测准则线(虚线)
    if (opts.showMeasured && typeof opts.measuredX === 'number' && isFinite(opts.measuredX)) {
      ctx.strokeStyle = COL.measured;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(X(opts.measuredX), pad.t);
      ctx.lineTo(X(opts.measuredX), H - pad.b);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = COL.measured;
      ctx.fillText('本局实测', X(opts.measuredX) + 4, pad.t + 28);
    }

    // 假想准则下理论比例
    return {
      pFA: 1 - SDT.normCdf(cx),
      pH: 1 - SDT.normCdf(cx - d),
    };
  }

  /**
   * 绘制 ROC 曲线(P(FA)–P(H) 空间)。
   * opts: { dPrime, point: {pFA,pH}|null }
   */
  function drawROC(canvas, opts) {
    var SDT = root.SDT;
    var g = prep(canvas);
    var ctx = g.ctx;
    var W = g.w;
    var H = g.h;
    var pad = { l: 44, r: 14, t: 22, b: 36 };
    function X(p) { return pad.l + p * (W - pad.l - pad.r); }
    function Y(p) { return H - pad.b - p * (H - pad.t - pad.b); }

    // 网格与轴
    ctx.strokeStyle = COL.grid;
    ctx.fillStyle = COL.axis;
    ctx.font = '10px sans-serif';
    ctx.lineWidth = 1;
    var ticks = [0, 0.2, 0.4, 0.6, 0.8, 1];
    ticks.forEach(function (t) {
      ctx.beginPath(); ctx.moveTo(X(t), pad.t); ctx.lineTo(X(t), H - pad.b); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(pad.l, Y(t)); ctx.lineTo(W - pad.r, Y(t)); ctx.stroke();
      ctx.fillText(t.toFixed(1), X(t) - 8, H - pad.b + 14);
      ctx.fillText(t.toFixed(1), 12, Y(t) + 3);
    });
    ctx.fillText('P(FA) 虚报率', W / 2 - 30, H - 6);
    ctx.save();
    ctx.translate(10, H / 2 + 30);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('P(H) 击中率', 0, 0);
    ctx.restore();

    // 机会线
    ctx.strokeStyle = COL.axis;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(X(0), Y(0)); ctx.lineTo(X(1), Y(1)); ctx.stroke();
    ctx.setLineDash([]);

    // 理论 ROC:z(H)=d′+z(FA),在 z(FA) 空间均匀采样得到平滑曲线
    ctx.strokeStyle = COL.signal;
    ctx.lineWidth = 2;
    ctx.beginPath();
    var ZR = 5;
    var n = 240;
    for (var i = 0; i <= n; i++) {
      var zfa = -ZR + (2 * ZR * i) / n;
      var pfa = SDT.normCdf(zfa);
      var ph = SDT.normCdf(opts.dPrime + zfa);
      if (i === 0) ctx.moveTo(X(pfa), Y(ph)); else ctx.lineTo(X(pfa), Y(ph));
    }
    ctx.stroke();
    ctx.fillStyle = COL.signal;
    ctx.fillText("ROC (d′=" + opts.dPrime.toFixed(2) + ')', X(0.55), Y(0.35));

    // 实测工作点
    if (opts.point && isFinite(opts.point.pFA) && isFinite(opts.point.pH)) {
      ctx.fillStyle = COL.measured;
      ctx.beginPath();
      ctx.arc(X(opts.point.pFA), Y(opts.point.pH), 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = COL.measured;
      ctx.fillText(
        '本局 (' + opts.point.pFA.toFixed(2) + ', ' + opts.point.pH.toFixed(2) + ')',
        Math.min(X(opts.point.pFA) + 10, W - 130),
        Y(opts.point.pH) - 8
      );
    }
  }

  root.SDTViz = { drawDistributions: drawDistributions, drawROC: drawROC };
})(typeof self !== 'undefined' ? self : this);
