# 雷达侦测 · 信号检测论(SDT)交互实验网站

工程心理学作业一:一个纯前端的信号检测论交互实验网页。玩家扮演雷达站操作员,
在限时呈现的雷达回波中判断「有目标 / 无目标」,结束后自动计算并可视化全套 SDT 指标。

## 场景与参数定义

| 要素 | 设定 |
|---|---|
| 信号 Signal | 敌机回波光点,强度 ~ N(d′, 1) |
| 噪声 Noise | 雷达杂波光点(每帧 26 个),强度 ~ N(0, 1) |
| 先验概率 P(S) | 可调,默认 0.50(信号试次数按 P(S)·N 固定并洗牌) |
| 难度 d′ | 简单 2.5 / 中等 1.5 / 困难 0.8 / 自定义 0.2–4.0 |
| 每局试次 N | 默认 30,可调(≥20) |
| 刺激限时 | 默认 1000ms,可调 300–2500ms |
| 作答时限 | 默认 2500ms,可调;超时按报告「无目标」计入 |

四种结果含义(防空场景):
- **命中 Hit**:有敌机→报告有,成功预警引导拦截
- **漏报 Miss**:有敌机→报告无,敌机突防,最严重失误
- **虚报 FA**:无敌机→报告有,浪费拦截弹药与战备
- **正确拒斥 CR**:无敌机→报告无,维持正常战备

## 运行方式

**本地运行(零依赖)**:直接双击 `index.html`,或任意静态服务器:

```bash
# 任选其一
python3 -m http.server 8000
npx serve .
```

然后浏览器打开 `http://localhost:8000`。

**Render 部署**:仓库根目录含 `render.yaml`(Blueprint)。在 Render 后台
New → Blueprint → 选本仓库即可;或 New → Static Site → 填公开仓库 URL,
Publish Directory 填 `.`,Build Command 留空。

## SDT 指标计算

纯函数实现于 `js/sdt.js`:

- P(H) = H/(H+M),P(FA) = FA/(FA+CR)
- d′ = z(P(H)) − z(P(FA))
- c = −½[z(P(H)) + z(P(FA))]
- ln β = c·d′,β = e^{lnβ}
- 准确率 = (H+CR)/N

z 分数为 Acklam 有理逼近 + Halley 精化;极端比例(四格任一为 0)按
log-linear(Hautus, 1995)规则四格各 +0.5 校正并在页面标注。

## 加分项实现

- 交互式概念可视化:双正态分布图,c / d′ 滑块联动,阴影标出虚报/漏报区域;
  实测准则与工作点以虚线/红点叠加
- ROC 曲线(假想 d′ 的理论曲线 + 本局实测工作点)
- localStorage 多局对比表(本机持久化,可清空)
- 雷达荧光屏主题、扫描动画、试次日志、键盘作答(F/J)、可选音效

## 目录结构

```
├── index.html        # 单页结构:参数设置 / 游戏 / 结果 三屏
├── css/style.css     # 雷达荧光屏主题样式
├── js/sdt.js         # SDT 数学核心(z 分数、统计、校正),纯函数
├── js/viz.js         # Canvas 可视化:双分布图、ROC
├── js/game.js        # 游戏状态机、雷达渲染、结果展示、历史记录
├── tests/sdt.test.js # Node 单元测试(node tests/sdt.test.js)
└── render.yaml       # Render 静态站 Blueprint
```

## 测试

```bash
node tests/sdt.test.js   # 校验 z 分数、四格统计、d'/c/β、极端比例校正
```
