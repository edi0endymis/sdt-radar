/**
 * tests/sdt.test.js —— SDT 核心计算的单元测试
 *
 * 运行方式(无第三方依赖):  node tests/sdt.test.js
 * 校验 z 分数精度、四格统计、d'/c/β 公式、极端比例校正、
 * 以及"缺失类别"与蒙特卡洛刺激采样的合理性。
 */
'use strict';
var assert = require('assert');
var path = require('path');
var SDT = require(path.join(__dirname, '..', 'js', 'sdt.js'));

var passed = 0;
function ok(name, fn) {
  fn();
  passed++;
  console.log('  ✓ ' + name);
}

function approx(actual, expected, tol, msg) {
  assert(
    Math.abs(actual - expected) <= tol,
    (msg || '') + ' expected ' + expected + ' got ' + actual
  );
}

console.log('zScore / normCdf');
ok('z(0.5) ≈ 0', function () {
  approx(SDT.zScore(0.5), 0, 1e-6);
});
ok('z(0.8413) ≈ 1', function () {
  approx(SDT.zScore(0.8413), 1, 1e-3);
});
ok('z(0.9772) ≈ 2', function () {
  approx(SDT.zScore(0.9772), 2, 1e-3);
});
ok('z(0.0228) ≈ -2', function () {
  approx(SDT.zScore(0.0228), -2, 1e-3);
});
ok('normCdf(1.96) ≈ 0.975', function () {
  approx(SDT.normCdf(1.96), 0.975, 1e-4);
});
ok('zScore 与 normCdf 互逆', function () {
  [0.01, 0.1, 0.3, 0.5, 0.7, 0.9, 0.99].forEach(function (p) {
    approx(SDT.normCdf(SDT.zScore(p)), p, 1e-6, 'p=' + p);
  });
});
ok('zScore 拒绝 p<=0 或 p>=1', function () {
  assert.throws(function () { SDT.zScore(0); });
  assert.throws(function () { SDT.zScore(1); });
  assert.throws(function () { SDT.zScore(-0.2); });
});

console.log('countOutcomes');
ok('四格计数正确', function () {
  var c = SDT.countOutcomes([
    { signal: true, respondSignal: true },   // H
    { signal: true, respondSignal: false },  // M
    { signal: false, respondSignal: true },  // FA
    { signal: false, respondSignal: false }, // CR
    { signal: true, respondSignal: false, timeout: true }, // M + timeout
  ]);
  assert.strictEqual(c.H, 1);
  assert.strictEqual(c.M, 2);
  assert.strictEqual(c.FA, 1);
  assert.strictEqual(c.CR, 1);
  assert.strictEqual(c.timeouts, 1);
  assert.strictEqual(c.n, 5);
});

console.log('computeStats —— 典型数据');
ok('教材示例核对:H=9,M=1,FA=2,CR=8', function () {
  var trials = [];
  var i;
  for (i = 0; i < 9; i++) trials.push({ signal: true, respondSignal: true });
  for (i = 0; i < 1; i++) trials.push({ signal: true, respondSignal: false });
  for (i = 0; i < 2; i++) trials.push({ signal: false, respondSignal: true });
  for (i = 0; i < 8; i++) trials.push({ signal: false, respondSignal: false });
  var s = SDT.computeStats(trials);
  assert.strictEqual(s.computable, true);
  assert.strictEqual(s.corrected, false);
  approx(s.pHit, 0.9, 1e-9);
  approx(s.pFA, 0.2, 1e-9);
  approx(s.dPrime, SDT.zScore(0.9) - SDT.zScore(0.2), 1e-9);
  approx(s.criterion, -(SDT.zScore(0.9) + SDT.zScore(0.2)) / 2, 1e-9);
  approx(s.accuracy, 17 / 20, 1e-9);
  // lnβ = c·d'
  approx(s.lnBeta, s.criterion * s.dPrime, 1e-9);
  approx(s.beta, Math.exp(s.lnBeta), 1e-9);
});

console.log('computeStats —— 极端比例校正');
ok('全对(FA=0, M=0)触发 log-linear 校正且指标有限', function () {
  var trials = [];
  var i;
  for (i = 0; i < 10; i++) trials.push({ signal: true, respondSignal: true });
  for (i = 0; i < 10; i++) trials.push({ signal: false, respondSignal: false });
  var s = SDT.computeStats(trials);
  assert.strictEqual(s.corrected, true);
  assert.ok(isFinite(s.dPrime) && isFinite(s.criterion));
  approx(s.pHit, 10.5 / 11, 1e-9);
  approx(s.pFA, 0.5 / 11, 1e-9);
});
ok('全部答"有信号"(M=0,CR=0)同样校正', function () {
  var trials = [];
  var i;
  for (i = 0; i < 10; i++) trials.push({ signal: true, respondSignal: true });
  for (i = 0; i < 10; i++) trials.push({ signal: false, respondSignal: true });
  var s = SDT.computeStats(trials);
  assert.strictEqual(s.corrected, true);
  approx(s.pHit, 10.5 / 11, 1e-9);
  approx(s.pFA, 10.5 / 11, 1e-9);
});

console.log('computeStats —— 类别缺失');
ok('本局无信号试次 → computable=false 且仍有准确率', function () {
  var trials = [];
  for (var i = 0; i < 10; i++) trials.push({ signal: false, respondSignal: false });
  var s = SDT.computeStats(trials);
  assert.strictEqual(s.computable, false);
  approx(s.accuracy, 1, 1e-9);
  assert.ok(s.warnings.length >= 1);
});

console.log('蒙特卡洛:刺激采样与理论一致性');
ok('gaussianSample 均值/方差大致正确', function () {
  var n = 20000;
  var sum = 0;
  var sq = 0;
  var seed = 42;
  var rng = function () {
    // 可复现 LCG
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (var i = 0; i < n; i++) {
    var x = SDT.gaussianSample(1.5, 1, rng);
    sum += x;
    sq += x * x;
  }
  var mean = sum / n;
  var sd = Math.sqrt(sq / n - mean * mean);
  approx(mean, 1.5, 0.03, 'mean');
  approx(sd, 1, 0.03, 'sd');
});

console.log('rocPoint');
ok("ROC:z(H)=d'+z(FA)", function () {
  var pt = SDT.rocPoint(1.5, 0.2);
  approx(pt.zH, 1.5 + SDT.zScore(0.2), 1e-9);
  approx(pt.pH, SDT.normCdf(1.5 + SDT.zScore(0.2)), 1e-9);
});

console.log('\n全部通过: ' + passed + ' 项测试');
