/**
 * sdt.js —— 信号检测论(Signal Detection Theory)核心计算模块
 *
 * 纯函数实现,不依赖 DOM:
 *   - 浏览器环境挂载到 window.SDT
 *   - Node 环境通过 module.exports 导出(供单元测试 tests/sdt.test.js 使用)
 *
 * 约定:噪声分布 N(0,1),信号分布 N(d',1),等方差模型。
 * 证据变量 x 大于准则 x_c 时作答"有信号"。
 */
(function (root, factory) {
  'use strict';
  var SDT = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = SDT;
  } else {
    root.SDT = SDT;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- 正态分布 ---------- */

  /** 标准正态概率密度 φ(x) */
  function normPdf(x) {
    return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
  }

  /** 误差函数 erf(x),Abramowitz & Stegun 7.1.26 近似,|ε| ≤ 1.5e-7 */
  function erf(x) {
    var sign = x < 0 ? -1 : 1;
    var ax = Math.abs(x);
    var t = 1 / (1 + 0.3275911 * ax);
    var y =
      1 -
      ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t -
        0.284496736) * t +
        0.254829592) *
        t *
        Math.exp(-ax * ax);
    return sign * y;
  }

  /** 标准正态累积分布 Φ(x) */
  function normCdf(x) {
    return 0.5 * (1 + erf(x / Math.SQRT2));
  }

  /**
   * 逆正态累积分布 Φ⁻¹(p)(即 z 分数)。
   * Acklam 有理逼近 + 一步 Halley 精化。
   */
  function zScore(p) {
    if (!(p > 0 && p < 1)) {
      throw new RangeError('zScore: p 必须属于开区间 (0,1),得到 ' + p);
    }
    var a = [
      -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
      1.38357751867269e2, -3.066479806614716e1, 2.506628277459239,
    ];
    var b = [
      -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
      6.680131188771972e1, -1.328068155288572e1,
    ];
    var c = [
      -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
      -2.549732539343734, 4.374664141464968, 2.938163982698783,
    ];
    var d = [
      7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
      3.754408661907416,
    ];
    var plow = 0.02425;
    var phigh = 1 - plow;
    var x, q, r;
    if (p < plow) {
      q = Math.sqrt(-2 * Math.log(p));
      x =
        (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
        ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    } else if (p <= phigh) {
      q = p - 0.5;
      r = q * q;
      x =
        (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) *
        q /
        (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
    } else {
      q = Math.sqrt(-2 * Math.log(1 - p));
      x =
        -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
        ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    // Halley 一步精化
    var e = normCdf(x) - p;
    var u = e * Math.sqrt(2 * Math.PI) * Math.exp((x * x) / 2);
    x = x - u / (1 + (x * u) / 2);
    return x;
  }

  /** Box-Muller 采样 N(mean, sd),用于生成刺激强度 */
  function gaussianSample(mean, sd, rand) {
    var rng = rand || Math.random;
    var u = 0;
    var v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /* ---------- 试次统计 ---------- */

  /**
   * 统计四种结果次数。
   * trials: [{ signal: bool, respondSignal: bool, timeout: bool }]
   * 返回 { H, M, FA, CR, timeouts, n }
   */
  function countOutcomes(trials) {
    var H = 0;
    var M = 0;
    var FA = 0;
    var CR = 0;
    var timeouts = 0;
    for (var i = 0; i < trials.length; i++) {
      var t = trials[i];
      if (t.timeout) timeouts++;
      if (t.signal) {
        if (t.respondSignal) H++;
        else M++;
      } else {
        if (t.respondSignal) FA++;
        else CR++;
      }
    }
    return { H: H, M: M, FA: FA, CR: CR, timeouts: timeouts, n: trials.length };
  }

  /**
   * 由试次序列计算完整 SDT 指标。
   *
   * 极端比例处理:任一四格计数为 0 会导致 P(H) 或 P(FA) 取 0/1,
   * 此时 z 分数发散。采用教材推荐的 log-linear(Hautus, 1995)校正:
   * 四个格子各加 0.5 再计算比例,并标记 corrected=true。
   *
   * 若某类试次完全缺失(如本局 0 个信号试次),相应指标不可估计,
   * 以 computable=false 返回,由界面提示。
   */
  function computeStats(trials) {
    var raw = countOutcomes(trials);
    var out = {
      counts: raw,
      corrected: false,
      computable: true,
      warnings: [],
    };

    if (raw.n === 0) {
      out.computable = false;
      out.warnings.push('没有有效试次。');
      return out;
    }
    if (raw.H + raw.M === 0) {
      out.computable = false;
      out.warnings.push("本局没有信号试次,命中率与 d' 不可估计。");
    }
    if (raw.FA + raw.CR === 0) {
      out.computable = false;
      out.warnings.push("本局没有噪声试次,虚报率与 d' 不可估计。");
    }

    // 任一格子为 0 → log-linear 校正(仅在该类试次存在的前提下)
    var needCorrection =
      out.computable &&
      (raw.H === 0 || raw.M === 0 || raw.FA === 0 || raw.CR === 0);
    var H = raw.H;
    var M = raw.M;
    var FA = raw.FA;
    var CR = raw.CR;
    if (needCorrection) {
      H += 0.5;
      M += 0.5;
      FA += 0.5;
      CR += 0.5;
      out.corrected = true;
    }

    // 准确率与超时占比始终用原始计数
    out.accuracy = (raw.H + raw.CR) / raw.n;
    out.timeoutRate = raw.timeouts / raw.n;
    out.signalTrials = raw.H + raw.M;
    out.noiseTrials = raw.FA + raw.CR;

    if (!out.computable) return out;

    var pH = H / (H + M);
    var pFA = FA / (FA + CR);
    var zH = zScore(pH);
    var zFA = zScore(pFA);

    out.pHit = pH;
    out.pMiss = 1 - pH;
    out.pFA = pFA;
    out.pCR = 1 - pFA;
    out.zHit = zH;
    out.zFA = zFA;
    out.dPrime = zH - zFA;                    // 感受性指标 d'
    out.criterion = -(zH + zFA) / 2;          // 判断标准 c(相对两分布中点)
    out.criterionX = -zFA;                    // 准则在证据轴上的位置 x_c
    out.lnBeta = out.criterion * out.dPrime;  // ln β = c · d'
    out.beta = Math.exp(out.lnBeta);
    return out;
  }

  /** 理论 ROC 上一点:z(H) = d' + z(FA) */
  function rocPoint(dPrime, pFA) {
    var zFA = zScore(pFA);
    var pH = normCdf(dPrime + zFA);
    return { pFA: pFA, pH: pH, zFA: zFA, zH: dPrime + zFA };
  }

  return {
    normPdf: normPdf,
    normCdf: normCdf,
    erf: erf,
    zScore: zScore,
    gaussianSample: gaussianSample,
    countOutcomes: countOutcomes,
    computeStats: computeStats,
    rocPoint: rocPoint,
  };
});
