<script setup lang="ts">
import imgXiaojiaqiao from '../案例图片/肖家桥.png';
import imgYongchuan from '../案例图片/永川.png';
import imgJinshajiang from '../案例图片/金沙江.png';

const workflowInputs = [
  { title: '高程数据', text: 'DEM.tif / dem.asc', icon: 'terrain' },
  { title: '粗糙度数据', text: '下垫面 / cao.asc', icon: 'roughness' },
  { title: '溃口资料', text: 'InputRiver.dat / 位置行列号', icon: 'breach' }
];

const workflowEngine = [
  { title: '高程格式转换', text: 'TIF 转 ASC 高程文件' },
  { title: '粗糙度计算', text: '根据下垫面生成 cao.asc' },
  { title: '溃口参数整理', text: '绘制溃口并获取行列号' },
  { title: '模拟文件组织', text: 'dem、cao、溃口文件输入计算' }
];

const workflowOutputs = [
  { title: '洪水模拟结果', text: '计算结果读取、时序组织、过程回放' },
  { title: '三维动态表达', text: '洪水水体加载、地形叠加、视角漫游' },
  { title: '灾情数据分析', text: '淹没范围、面积统计、水深分级' }
];

const feedbackSteps = ['数据处理', '文件输入', '模拟计算', '结果分析'];

const capabilities = [
  {
    title: '多源数据预处理',
    subtitle: '围绕高程、粗糙度与溃口文件完成格式转换、参数整理和模拟输入准备。',
    visual: 'data',
    image: imgXiaojiaqiao,
    tags: ['高程转换', '粗糙度计算', '溃口定位'],
    metric: '数据底座'
  },
  {
    title: '洪水动态仿真',
    subtitle: '基于计算参数生成连续水深与流速时序，支撑过程播放和情景复算。',
    visual: 'simulation',
    image: imgYongchuan,
    tags: ['时序推演', '水深分级', '过程回放'],
    metric: 'T + 06:30'
  },
  {
    title: '三维场景表达',
    subtitle: '融合地形、影像、洪水结果与监测标注，在真实场景中观察水体漫溢与地形关系。',
    visual: 'scene',
    image: imgJinshajiang,
    tags: ['地形融合', '图层叠加', '剖面观察'],
    metric: '三维场景'
  },
  {
    title: '灾情分析与评估',
    subtitle: '围绕淹没边界、影响对象与统计指标提取结果，辅助形成可复核的分析结论。',
    visual: 'analysis',
    image: imgXiaojiaqiao,
    tags: ['面积统计', '风险识别', '决策输出'],
    metric: '风险评估'
  }
];
</script>

<template>
  <section class="intro-panel">
    <header class="intro-hero">
      <img :src="imgXiaojiaqiao" alt="洪水动态模拟与三维可视化系统场景" />
      <div class="hero-shade" aria-hidden="true"></div>
      <div class="hero-wireframe" aria-hidden="true">
        <span class="wire-line wire-a"></span>
        <span class="wire-line wire-b"></span>
        <span class="wire-node node-a"></span>
        <span class="wire-node node-b"></span>
        <span class="wire-node node-c"></span>
      </div>
      <div class="hero-content">
        <h2>洪水动态模拟与三维可视化系统</h2>
        <p>
          系统围绕“数据接入—模型计算—三维表达—灾情分析”的工作闭环，
          将洪水过程结果转化为可浏览、可比对、可复核的三维空间场景。
        </p>
        <div class="hero-facts" aria-label="系统核心链路">
          <span>多源资料组织</span>
          <span>洪水时序演算</span>
          <span>三维灾情分析</span>
        </div>
      </div>
      <div class="scene-badge" aria-label="系统工作闭环">
        <strong>3D</strong>
        <span>动态推演</span>
      </div>
    </header>

    <section class="content-section workflow-section">
      <div class="section-heading">
        <div>
          <h3>总体流程架构</h3>
        </div>
      </div>

      <div class="workflow-map" aria-label="洪水三维可视化系统用户使用流程总体架构图">
        <div class="map-grid" aria-hidden="true"></div>
        <svg class="flow-ribbons" viewBox="0 0 920 430" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="flowBlue" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stop-color="#61d7e2" stop-opacity="0.18" />
              <stop offset="50%" stop-color="#73f2bf" stop-opacity="0.68" />
              <stop offset="100%" stop-color="#f2c86f" stop-opacity="0.2" />
            </linearGradient>
            <linearGradient id="flowAmber" x1="1" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#f2c86f" stop-opacity="0.58" />
              <stop offset="100%" stop-color="#61d7e2" stop-opacity="0.14" />
            </linearGradient>
          </defs>
          <path class="ribbon wide-ribbon" d="M90 118C188 70 257 126 335 176C405 222 494 226 592 170C673 124 759 119 840 148" />
          <path class="ribbon thin-ribbon" d="M88 248C190 296 268 271 349 222C430 173 519 170 608 215C700 262 759 278 846 238" />
          <path class="ribbon return-ribbon" d="M778 332C623 403 360 406 192 330" />
          <path class="ribbon dash-ribbon" d="M300 95C396 36 542 38 646 99" />
        </svg>

        <section class="workflow-cluster input-cluster">
          <header class="cluster-title">
            <span>资料输入</span>
            <strong>多源数据接入</strong>
          </header>
          <div class="input-node-list">
            <article v-for="item in workflowInputs" :key="item.title" class="input-node">
              <div class="node-symbol" :class="`symbol-${item.icon}`" aria-hidden="true">
                <svg v-if="item.icon === 'terrain'" viewBox="0 0 28 28">
                  <path d="M3 22 9 10l5 6 4-7 7 13H3Z" />
                  <path d="M9 10 12 5l4 8" />
                </svg>
                <svg v-else-if="item.icon === 'roughness'" viewBox="0 0 28 28">
                  <path d="M4 10 14 5l10 5-10 5-10-5Z" />
                  <path d="M4 15 14 20l10-5" />
                  <path d="M4 19 14 24l10-5" />
                </svg>
                <svg v-else viewBox="0 0 28 28">
                  <path d="M6 22 9 8l5 4 5-5 3 15" />
                  <path d="M9 8h10" />
                  <path d="M12 15h4" />
                  <circle cx="14" cy="12" r="2" />
                </svg>
              </div>
              <div>
                <strong>{{ item.title }}</strong>
                <span>{{ item.text }}</span>
              </div>
            </article>
          </div>
        </section>

        <section class="model-core" aria-label="模型计算核心">
          <div class="core-orbit orbit-outer" aria-hidden="true"></div>
          <div class="core-orbit orbit-inner" aria-hidden="true"></div>
          <div class="core-ring">
            <span class="core-pulse" aria-hidden="true"></span>
            <small>MODEL CORE</small>
            <strong>洪水模拟<br />计算核心</strong>
          </div>
          <div class="engine-steps">
            <article v-for="(item, index) in workflowEngine" :key="item.title" class="engine-step">
              <span>{{ String(index + 1).padStart(2, '0') }}</span>
              <strong>{{ item.title }}</strong>
              <small>{{ item.text }}</small>
            </article>
          </div>
        </section>

        <section class="workflow-cluster output-cluster">
          <header class="cluster-title">
            <span>成果应用</span>
            <strong>三维表达与分析</strong>
          </header>
          <div class="output-node-list">
            <article v-for="(item, index) in workflowOutputs" :key="item.title" class="output-node">
              <span class="output-index">{{ String(index + 1).padStart(2, '0') }}</span>
              <div>
                <strong>{{ item.title }}</strong>
                <small>{{ item.text }}</small>
              </div>
            </article>
          </div>
        </section>

        <div class="feedback-band">
          <span class="feedback-label">USER LOOP</span>
          <div class="feedback-steps">
            <span v-for="step in feedbackSteps" :key="step">{{ step }}</span>
          </div>
          <p>用户先完成高程格式转换、粗糙度计算和溃口位置整理，再输入模拟所需文件生成洪水结果，最后在三维场景中查看过程并开展淹没范围与面积统计分析。</p>
        </div>
      </div>
    </section>

    <section class="content-section capability-section">
      <div class="section-heading">
        <div>
          <h3>功能图文模块</h3>
        </div>
      </div>

      <div class="capability-grid">
        <article
          v-for="capability in capabilities"
          :key="capability.title"
          class="capability-card"
          :class="`capability-${capability.visual}`"
        >
          <div class="capability-visual" :class="`visual-${capability.visual}`">
            <img :src="capability.image" :alt="capability.title" />
            <div class="visual-gradient" aria-hidden="true"></div>

            <template v-if="capability.visual === 'data'">
              <div class="dataset-stack">
                <span>DEM.tif</span>
                <span>dem.asc</span>
                <span>cao.asc</span>
                <span>InputRiver.dat</span>
              </div>
              <div class="data-coordinate">
                <strong>ASC / DAT</strong>
                <span>模拟输入准备</span>
              </div>
            </template>

            <template v-else-if="capability.visual === 'simulation'">
              <div class="flood-depth-legend">
                <span>0.2m</span>
                <i></i>
                <span>3.0m</span>
              </div>
              <div class="simulation-panel">
                <span class="panel-title">水深时序曲线</span>
                <svg viewBox="0 0 180 58" preserveAspectRatio="none" aria-hidden="true">
                  <path class="chart-grid" d="M0 12H180M0 30H180M0 48H180" />
                  <path class="chart-area" d="M0 52 24 48 50 42 74 30 98 18 122 24 148 14 180 9V58H0Z" />
                  <path class="chart-line" d="M0 52 24 48 50 42 74 30 98 18 122 24 148 14 180 9" />
                  <circle cx="98" cy="18" r="3" />
                  <circle cx="148" cy="14" r="3" />
                </svg>
                <div class="timeline">
                  <span></span>
                </div>
              </div>
            </template>

            <template v-else-if="capability.visual === 'scene'">
              <div class="scene-callout terrain-callout">
                <span>地形起伏</span>
                <strong>山谷汇流面</strong>
              </div>
              <div class="scene-callout water-callout">
                <span>洪水水体</span>
                <strong>沿河漫溢带</strong>
              </div>
              <svg class="scene-annotations" viewBox="0 0 260 190" preserveAspectRatio="none" aria-hidden="true">
                <defs>
                  <marker id="sceneArrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                    <path d="M0 0 10 5 0 10Z" />
                  </marker>
                </defs>
                <path class="terrain-leader" d="M184 66C155 75 130 83 103 101" />
                <path class="water-leader" d="M78 145C96 130 111 121 132 111" />
                <path class="water-highlight" d="M12 59C38 65 56 82 72 101C89 121 111 132 142 123C165 116 177 93 197 78" />
                <circle class="terrain-target" cx="103" cy="101" r="4" />
                <circle class="water-target" cx="132" cy="111" r="4" />
              </svg>
              <svg class="scene-contour" viewBox="0 0 240 140" preserveAspectRatio="none" aria-hidden="true">
                <path d="M10 104C42 71 68 103 98 75C128 47 158 73 185 43C203 23 222 22 238 31" />
                <path d="M4 120C46 90 76 119 110 92C147 63 171 88 205 58C221 44 231 43 242 47" />
                <path d="M22 82C54 61 77 83 103 58C129 33 158 55 184 29C199 14 213 12 232 17" />
              </svg>
            </template>

            <template v-else>
              <div class="analysis-map-overlay" aria-hidden="true">
                <svg viewBox="0 0 260 180" preserveAspectRatio="none">
                  <path class="flood-extent" d="M17 92C44 70 62 86 87 75C113 64 127 35 156 42C185 48 197 80 231 72C222 98 199 119 170 124C139 129 119 112 94 123C66 136 39 126 17 92Z" />
                  <path class="extent-border" d="M17 92C44 70 62 86 87 75C113 64 127 35 156 42C185 48 197 80 231 72C222 98 199 119 170 124C139 129 119 112 94 123C66 136 39 126 17 92Z" />
                  <path class="road-trace" d="M6 128C42 113 73 118 103 101C133 83 154 93 184 78C211 64 239 53 256 35" />
                  <path class="monitor-trace" d="M42 52C67 68 83 92 107 95C132 98 149 71 174 76C198 81 212 96 244 86" />
                </svg>
                <span class="risk-dot risk-dot-a"><i>居民点</i></span>
                <span class="risk-dot risk-dot-b"><i>道路</i></span>
                <span class="risk-dot risk-dot-c"><i>桥梁</i></span>
              </div>
              <div class="risk-object-list">
                <strong>影响对象</strong>
                <span><i class="risk-high"></i>低洼居民点</span>
                <span><i class="risk-mid"></i>沿河道路</span>
                <span><i class="risk-low"></i>监测断面</span>
              </div>
              <div class="analysis-board">
                <div>
                  <span>淹没面积</span>
                  <strong>28.6<small>km²</small></strong>
                </div>
                <div>
                  <span>高风险单元</span>
                  <strong>12<small>处</small></strong>
                </div>
              </div>
              <svg class="risk-radar" viewBox="0 0 120 86" aria-hidden="true">
                <path class="radar-grid" d="M60 6 112 32 98 78H22L8 32 60 6ZM60 22 93 38 84 66H36L27 38 60 22ZM60 6v72M8 32l90 46M112 32 22 78" />
                <path class="radar-area" d="M60 16 92 37 77 63 39 69 23 36Z" />
              </svg>
            </template>

            <div class="visual-label">
              <span>{{ capability.metric }}</span>
            </div>
          </div>

          <div class="capability-copy">
            <h4>{{ capability.title }}</h4>
            <p>{{ capability.subtitle }}</p>
            <div class="capability-tags">
              <span v-for="tag in capability.tags" :key="tag">{{ tag }}</span>
            </div>
          </div>
        </article>
      </div>
    </section>
  </section>
</template>

<style scoped>
.intro-panel {
  display: flex;
  flex-direction: column;
  gap: 24px;
  color: #eefbff;
}

.intro-hero {
  position: relative;
  min-height: 256px;
  overflow: hidden;
  border: 1px solid rgba(99, 231, 238, 0.26);
  border-radius: 12px;
  background: #07131b;
  box-shadow: 0 18px 42px rgba(0, 0, 0, 0.32);
  isolation: isolate;
}

.intro-hero > img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center 48%;
  filter: saturate(1.05) contrast(1.05);
}

.hero-shade {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(circle at 78% 18%, rgba(94, 221, 231, 0.28), transparent 32%),
    linear-gradient(90deg, rgba(2, 12, 19, 0.96) 0%, rgba(3, 15, 23, 0.86) 44%, rgba(3, 14, 22, 0.38) 74%, rgba(3, 14, 22, 0.52) 100%),
    linear-gradient(0deg, rgba(3, 14, 22, 0.68), transparent 58%);
}

.hero-wireframe {
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
}

.hero-wireframe::before {
  position: absolute;
  inset: 16px;
  border: 1px solid rgba(119, 222, 231, 0.1);
  border-radius: 9px;
  background:
    linear-gradient(rgba(100, 202, 214, 0.08) 1px, transparent 1px),
    linear-gradient(90deg, rgba(100, 202, 214, 0.08) 1px, transparent 1px);
  background-size: 42px 42px;
  mask-image: linear-gradient(90deg, transparent 0%, #000 42%, #000 100%);
  content: '';
}

.wire-line {
  position: absolute;
  right: 34px;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(111, 235, 242, 0.56), transparent);
  transform-origin: right center;
}

.wire-a {
  top: 78px;
  width: 260px;
  transform: rotate(-10deg);
}

.wire-b {
  right: 92px;
  bottom: 76px;
  width: 210px;
  transform: rotate(16deg);
}

.wire-node {
  position: absolute;
  width: 7px;
  height: 7px;
  border: 1px solid rgba(111, 235, 242, 0.9);
  border-radius: 50%;
  background: rgba(5, 24, 34, 0.8);
  box-shadow: 0 0 18px rgba(99, 231, 238, 0.48);
}

.node-a { top: 66px; right: 192px; }
.node-b { top: 120px; right: 88px; }
.node-c { right: 270px; bottom: 88px; }

.hero-content {
  position: relative;
  z-index: 2;
  display: flex;
  min-height: 256px;
  max-width: 660px;
  flex-direction: column;
  justify-content: center;
  padding: 34px 38px;
}

.hero-content h2 {
  max-width: 560px;
  margin: 0;
  color: #ffffff;
  font-size: 23px;
  font-weight: 800;
  letter-spacing: 0.05em;
  line-height: 1.34;
  text-shadow: 0 3px 18px rgba(0, 0, 0, 0.78);
}

.hero-content > p {
  max-width: 610px;
  margin: 14px 0 22px;
  color: #c6dce3;
  font-size: 14px;
  line-height: 1.8;
}

.hero-facts {
  display: flex;
  flex-wrap: wrap;
  gap: 9px 11px;
}

.hero-facts span {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border: 1px solid rgba(116, 203, 214, 0.18);
  border-radius: 999px;
  color: #b7ced6;
  font-size: 11px;
  font-weight: 600;
  background: rgba(3, 20, 29, 0.48);
  backdrop-filter: blur(8px);
}

.hero-facts span::before {
  width: 6px;
  height: 6px;
  flex: 0 0 6px;
  border-radius: 50%;
  background: #72e7bd;
  box-shadow: 0 0 10px rgba(114, 231, 189, 0.58);
  content: '';
}

.scene-badge {
  position: absolute;
  right: 32px;
  bottom: 26px;
  z-index: 2;
  display: flex;
  width: 92px;
  height: 92px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(103, 231, 238, 0.58);
  border-radius: 50%;
  background:
    radial-gradient(circle, rgba(91, 226, 235, 0.18), transparent 62%),
    rgba(3, 18, 26, 0.78);
  box-shadow:
    0 0 0 6px rgba(3, 18, 26, 0.25),
    0 0 32px rgba(74, 213, 224, 0.24),
    inset 0 0 24px rgba(94, 219, 229, 0.08);
  backdrop-filter: blur(10px);
  cursor: default;
  transition: transform 0.24s ease, border-color 0.24s ease, box-shadow 0.24s ease, background 0.24s ease;
}

.scene-badge:hover {
  border-color: rgba(114, 231, 189, 0.72);
  background:
    radial-gradient(circle, rgba(114, 231, 189, 0.24), transparent 63%),
    rgba(3, 18, 26, 0.84);
  box-shadow:
    0 0 0 8px rgba(3, 18, 26, 0.22),
    0 0 40px rgba(114, 231, 189, 0.26),
    inset 0 0 28px rgba(114, 231, 189, 0.1);
  transform: translateY(-4px) scale(1.03);
}

.scene-badge:hover strong {
  color: #ffffff;
  text-shadow: 0 0 14px rgba(114, 231, 189, 0.38);
}

.scene-badge:hover span {
  color: #b8f5dd;
}

.scene-badge::before,
.scene-badge::after {
  position: absolute;
  border: 1px solid rgba(99, 231, 238, 0.18);
  border-radius: 50%;
  content: '';
}

.scene-badge::before { inset: 10px; }
.scene-badge::after { inset: -9px; border-style: dashed; }

.scene-badge strong {
  color: #ffffff;
  font-family: "Cascadia Mono", "Courier New", monospace;
  font-size: 29px;
  line-height: 1;
}

.scene-badge span {
  margin-top: 6px;
  color: #93e3ea;
  font-size: 10px;
}

.content-section {
  padding: 0 2px;
}

.section-heading {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 18px;
  margin-bottom: 14px;
  padding-bottom: 10px;
  border-bottom: 1px solid rgba(123, 172, 183, 0.16);
}

.section-heading > div {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.section-number {
  color: #55d8e2;
  font-family: "Cascadia Mono", "Courier New", monospace;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.08em;
}

.section-heading h3 {
  margin: 0;
  color: #f3fbff;
  font-size: 17px;
  font-weight: 800;
  letter-spacing: 0;
}

.section-heading > p {
  margin: 0;
  color: #78929b;
  font-size: 11px;
  text-align: right;
}

.workflow-map {
  --workflow-edge-gap: 24px;
  position: relative;
  min-height: 430px;
  overflow: hidden;
  border: 1px solid rgba(110, 165, 177, 0.22);
  border-radius: 12px;
  background:
    radial-gradient(circle at 50% 44%, rgba(83, 214, 225, 0.13), transparent 36%),
    linear-gradient(135deg, rgba(5, 20, 30, 0.96), rgba(3, 13, 20, 0.86));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.035),
    0 14px 30px rgba(0, 0, 0, 0.24);
}

.map-grid {
  position: absolute;
  inset: 0;
  background:
    linear-gradient(rgba(94, 171, 184, 0.065) 1px, transparent 1px),
    linear-gradient(90deg, rgba(94, 171, 184, 0.065) 1px, transparent 1px),
    radial-gradient(circle at 50% 48%, rgba(100, 231, 238, 0.12), transparent 34%);
  background-size: 28px 28px, 28px 28px, 100% 100%;
  mask-image: linear-gradient(180deg, rgba(0, 0, 0, 0.96), rgba(0, 0, 0, 0.56));
}

.flow-ribbons {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.ribbon {
  fill: none;
  stroke-linecap: round;
}

.wide-ribbon {
  stroke: url(#flowBlue);
  stroke-width: 24;
}

.thin-ribbon {
  stroke: rgba(91, 223, 233, 0.26);
  stroke-width: 5;
}

.return-ribbon {
  stroke: url(#flowAmber);
  stroke-width: 7;
}

.dash-ribbon {
  stroke: rgba(117, 236, 193, 0.26);
  stroke-width: 2;
  stroke-dasharray: 8 10;
}

.workflow-cluster {
  position: absolute;
  z-index: 2;
  width: 238px;
  border: 1px solid rgba(133, 197, 207, 0.18);
  border-radius: 12px;
  background: rgba(5, 21, 31, 0.72);
  box-shadow: 0 14px 32px rgba(0, 0, 0, 0.22);
  backdrop-filter: blur(12px);
}

.input-cluster {
  top: var(--workflow-edge-gap);
  left: 26px;
}

.output-cluster {
  top: var(--workflow-edge-gap);
  right: 26px;
}

.cluster-title {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 13px 14px 11px;
  border-bottom: 1px solid rgba(126, 176, 188, 0.13);
}

.cluster-title span {
  color: #68dbe5;
  font-size: 10px;
  font-weight: 700;
}

.cluster-title strong {
  color: #effbff;
  font-size: 14px;
  font-weight: 800;
}

.input-node-list,
.output-node-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 13px;
}

.input-node {
  display: grid;
  grid-template-columns: 34px 1fr;
  gap: 10px;
  align-items: center;
  min-height: 58px;
  padding: 9px;
  border: 1px solid rgba(100, 196, 208, 0.12);
  border-radius: 10px;
  background:
    linear-gradient(90deg, rgba(85, 206, 218, 0.11), transparent),
    rgba(255, 255, 255, 0.026);
  cursor: default;
  transition: transform 0.22s ease, border-color 0.22s ease, background 0.22s ease, box-shadow 0.22s ease;
}

.node-symbol {
  display: flex;
  width: 34px;
  height: 34px;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  color: #79dce4;
  background: rgba(78, 190, 202, 0.12);
  box-shadow: inset 0 0 14px rgba(95, 224, 232, 0.08);
  transition: transform 0.22s ease, color 0.22s ease, background-color 0.22s ease, box-shadow 0.22s ease;
}

.node-symbol svg {
  width: 24px;
  height: 24px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.6;
}

.input-node:hover {
  border-color: rgba(99, 231, 238, 0.36);
  background:
    linear-gradient(90deg, rgba(85, 206, 218, 0.19), transparent),
    rgba(255, 255, 255, 0.045);
  box-shadow: 0 12px 24px rgba(0, 0, 0, 0.22), inset 0 0 18px rgba(99, 231, 238, 0.055);
  transform: translateY(-3px);
}

.input-node:hover .node-symbol {
  color: #d9fbff;
  background: rgba(78, 190, 202, 0.2);
  box-shadow: inset 0 0 16px rgba(95, 224, 232, 0.14), 0 0 16px rgba(99, 231, 238, 0.16);
  transform: translateX(2px) scale(1.04);
}

.symbol-roughness {
  color: #7ee6bd;
  background: rgba(93, 227, 179, 0.11);
}

.symbol-breach {
  color: #efca79;
  background: rgba(241, 198, 107, 0.1);
}

.input-node strong,
.output-node strong,
.engine-step strong {
  display: block;
  color: #e3f4f7;
  font-size: 12px;
  font-weight: 800;
}

.input-node span,
.output-node small,
.engine-step small {
  display: block;
  margin-top: 4px;
  color: #86a2ab;
  font-size: 9px;
  line-height: 1.45;
}

.model-core {
  position: absolute;
  top: var(--workflow-edge-gap);
  left: 50%;
  z-index: 3;
  width: 340px;
  height: 286px;
  transform: translateX(-50%);
}

.core-orbit {
  position: absolute;
  left: 50%;
  top: 48%;
  border: 1px solid rgba(105, 220, 226, 0.18);
  border-radius: 50%;
  transform: translate(-50%, -50%);
}

.orbit-outer {
  width: 230px;
  height: 230px;
}

.orbit-outer::before,
.orbit-inner::before {
  position: absolute;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #72e7bd;
  box-shadow: 0 0 16px rgba(114, 231, 189, 0.65);
  content: '';
}

.orbit-outer::before {
  top: 28px;
  right: 30px;
}

.orbit-inner {
  width: 164px;
  height: 164px;
  border-style: dashed;
}

.orbit-inner::before {
  left: 18px;
  bottom: 22px;
  background: #61d7e2;
}

.core-ring {
  position: absolute;
  left: 50%;
  top: 48%;
  display: flex;
  width: 122px;
  height: 122px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(111, 235, 242, 0.58);
  border-radius: 50%;
  background:
    radial-gradient(circle, rgba(104, 226, 236, 0.21), rgba(7, 26, 36, 0.92) 66%),
    rgba(4, 18, 27, 0.95);
  box-shadow:
    0 0 0 12px rgba(95, 215, 225, 0.045),
    0 0 42px rgba(99, 231, 238, 0.2),
    inset 0 0 30px rgba(96, 231, 238, 0.12);
  transform: translate(-50%, -50%);
  text-align: center;
}

.core-pulse {
  position: absolute;
  inset: 13px;
  border: 1px solid rgba(114, 231, 189, 0.22);
  border-radius: 50%;
}

.core-ring small {
  position: relative;
  color: #72e7bd;
  font-family: "Cascadia Mono", "Courier New", monospace;
  font-size: 8px;
  letter-spacing: 0.12em;
}

.core-ring strong {
  position: relative;
  margin-top: 7px;
  color: #ffffff;
  font-size: 15px;
  font-weight: 900;
  line-height: 1.35;
}

.engine-steps {
  position: absolute;
  inset: 0;
}

.engine-step {
  position: absolute;
  box-sizing: border-box;
  display: flex;
  height: 82px;
  flex-direction: column;
  width: 138px;
  padding: 10px 11px;
  overflow: hidden;
  border: 1px solid rgba(111, 235, 242, 0.16);
  border-radius: 11px;
  background: rgba(5, 22, 32, 0.86);
  box-shadow: 0 12px 22px rgba(0, 0, 0, 0.18);
  cursor: default;
  transition: transform 0.22s ease, border-color 0.22s ease, background-color 0.22s ease, box-shadow 0.22s ease;
}

.engine-step:nth-child(1) {
  top: 0;
  left: 16px;
}

.engine-step:nth-child(2) {
  top: 0;
  right: 16px;
}

.engine-step:nth-child(3) {
  bottom: 0;
  left: 16px;
}

.engine-step:nth-child(4) {
  right: 16px;
  bottom: 0;
}

.engine-step span {
  display: inline-block;
  margin-bottom: 6px;
  color: #72e7bd;
  font-family: "Cascadia Mono", "Courier New", monospace;
  font-size: 9px;
  font-weight: 800;
}

.output-node {
  position: relative;
  display: grid;
  grid-template-columns: 28px 1fr;
  gap: 10px;
  align-items: center;
  min-height: 62px;
  padding: 10px;
  border-radius: 10px;
  background:
    linear-gradient(90deg, rgba(241, 198, 107, 0.12), transparent),
    rgba(255, 255, 255, 0.026);
  cursor: default;
  transition: transform 0.22s ease, background 0.22s ease, box-shadow 0.22s ease;
}

.output-node::before {
  position: absolute;
  inset: 0;
  border: 1px solid rgba(241, 198, 107, 0.14);
  border-radius: inherit;
  content: '';
  pointer-events: none;
  transition: border-color 0.22s ease, box-shadow 0.22s ease;
}

.engine-step:hover {
  border-color: rgba(114, 231, 189, 0.42);
  background: rgba(6, 30, 39, 0.94);
  box-shadow: 0 14px 26px rgba(0, 0, 0, 0.24), inset 0 0 18px rgba(114, 231, 189, 0.06);
  transform: translateY(-4px);
}

.engine-step:hover span {
  color: #a6f6d7;
  text-shadow: 0 0 10px rgba(114, 231, 189, 0.34);
}

.output-node > * {
  position: relative;
  z-index: 1;
}

.output-node:hover {
  background:
    linear-gradient(90deg, rgba(241, 198, 107, 0.19), transparent),
    rgba(255, 255, 255, 0.044);
  box-shadow: 0 12px 24px rgba(0, 0, 0, 0.22), inset 0 0 16px rgba(241, 198, 107, 0.045);
  transform: translateY(-3px);
}

.output-node:hover::before {
  border-color: rgba(241, 198, 107, 0.36);
  box-shadow: inset 0 0 14px rgba(241, 198, 107, 0.06);
}

.output-index {
  display: flex;
  width: 28px;
  height: 28px;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(241, 198, 107, 0.32);
  border-radius: 50%;
  color: #f0c66c;
  font-family: "Cascadia Mono", "Courier New", monospace;
  font-size: 9px;
  font-weight: 800;
}

.feedback-band {
  position: absolute;
  right: 26px;
  bottom: var(--workflow-edge-gap);
  left: 26px;
  z-index: 2;
  display: grid;
  grid-template-columns: 82px minmax(250px, 0.9fr) minmax(0, 1.1fr);
  align-items: center;
  gap: 16px;
  padding: 13px 15px;
  border: 1px solid rgba(117, 236, 193, 0.18);
  border-radius: 12px;
  background: rgba(4, 18, 26, 0.82);
  box-shadow: 0 12px 24px rgba(0, 0, 0, 0.2);
  backdrop-filter: blur(12px);
}

.feedback-label {
  color: #72e7bd;
  font-family: "Cascadia Mono", "Courier New", monospace;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.09em;
}

.feedback-steps {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 7px;
}

.feedback-steps span {
  position: relative;
  padding: 7px 4px;
  border: 1px solid rgba(108, 205, 213, 0.18);
  border-radius: 999px;
  color: #d8eff3;
  font-size: 10px;
  font-weight: 700;
  text-align: center;
  background: rgba(77, 161, 173, 0.1);
  cursor: default;
  transition: transform 0.2s ease, border-color 0.2s ease, background-color 0.2s ease, color 0.2s ease, box-shadow 0.2s ease;
}

.feedback-steps span:not(:last-child)::after {
  position: absolute;
  top: 50%;
  right: -8px;
  width: 8px;
  height: 1px;
  background: rgba(114, 231, 189, 0.45);
  content: '';
}

.feedback-steps span:hover {
  border-color: rgba(114, 231, 189, 0.42);
  color: #f0fffb;
  background: rgba(114, 231, 189, 0.16);
  box-shadow: 0 0 16px rgba(114, 231, 189, 0.12);
  transform: translateY(-2px);
}

@media (prefers-reduced-motion: reduce) {
  .scene-badge,
  .input-node,
  .node-symbol,
  .engine-step,
  .output-node,
  .output-node::before,
  .feedback-steps span {
    transition: none;
  }

  .scene-badge:hover,
  .input-node:hover,
  .input-node:hover .node-symbol,
  .engine-step:hover,
  .output-node:hover,
  .feedback-steps span:hover {
    transform: none;
  }
}

.feedback-band p {
  margin: 0;
  color: #85a2ab;
  font-size: 10px;
  line-height: 1.62;
}

.capability-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.capability-card {
  position: relative;
  display: grid;
  grid-template-columns: minmax(220px, 0.96fr) minmax(0, 1.04fr);
  min-width: 0;
  overflow: hidden;
  border: 1px solid rgba(120, 167, 178, 0.18);
  border-radius: 12px;
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.035), rgba(255, 255, 255, 0.012)),
    rgba(7, 22, 32, 0.78);
  box-shadow: 0 14px 28px rgba(0, 0, 0, 0.2);
  transition: border-color 0.22s ease, transform 0.22s ease, box-shadow 0.22s ease;
}

.capability-card:hover {
  border-color: rgba(84, 216, 226, 0.46);
  box-shadow: 0 18px 34px rgba(0, 0, 0, 0.28), 0 0 28px rgba(84, 216, 226, 0.08);
  transform: translateY(-3px);
}

.capability-card::before {
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(103, 231, 238, 0.44), transparent);
  content: '';
}

.capability-visual {
  position: relative;
  min-height: 206px;
  overflow: hidden;
  border-right: 1px solid rgba(118, 163, 173, 0.14);
  background: #07131b;
}

.capability-visual > img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  transform: scale(1.03);
}

.visual-gradient {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(circle at 72% 18%, rgba(91, 227, 236, 0.2), transparent 33%),
    linear-gradient(0deg, rgba(3, 13, 20, 0.86), rgba(3, 13, 20, 0.15) 58%);
}

.visual-label {
  position: absolute;
  top: 12px;
  left: 12px;
  z-index: 3;
}

.visual-label span {
  display: inline-flex;
  align-items: center;
  height: 25px;
  padding: 0 9px;
  border: 1px solid rgba(100, 231, 238, 0.3);
  border-radius: 999px;
  color: #dbfbff;
  font-family: "Cascadia Mono", "Courier New", monospace;
  font-size: 9px;
  font-weight: 800;
  background: rgba(3, 17, 26, 0.72);
  backdrop-filter: blur(8px);
}

.dataset-stack {
  position: absolute;
  top: 66px;
  right: 12px;
  z-index: 3;
  display: grid;
  width: 154px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}

.dataset-stack span {
  box-sizing: border-box;
  width: 100%;
  height: 24px;
  overflow: hidden;
  padding: 0 7px;
  border: 1px solid rgba(115, 242, 191, 0.2);
  border-radius: 7px;
  color: #dff8fb;
  font-family: "Cascadia Mono", "Courier New", monospace;
  font-size: 8px;
  font-weight: 700;
  line-height: 22px;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
  background: rgba(4, 20, 28, 0.72);
  box-shadow: 0 8px 16px rgba(0, 0, 0, 0.14);
}

.dataset-stack span:nth-child(2) {
  transform: none;
}

.dataset-stack span:nth-child(3) {
  transform: none;
}

.data-coordinate {
  position: absolute;
  left: 14px;
  bottom: 14px;
  z-index: 2;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 9px 11px;
  border-left: 2px solid #72e7bd;
  background: rgba(3, 17, 25, 0.72);
  backdrop-filter: blur(8px);
}

.data-coordinate strong {
  color: #72e7bd;
  font-family: "Cascadia Mono", "Courier New", monospace;
  font-size: 10px;
}

.data-coordinate span {
  color: #a9c4cc;
  font-size: 9px;
}

.flood-depth-legend {
  position: absolute;
  top: 14px;
  right: 14px;
  z-index: 2;
  display: grid;
  grid-template-columns: auto 58px auto;
  align-items: center;
  gap: 6px;
  padding: 7px 8px;
  border: 1px solid rgba(103, 231, 238, 0.2);
  border-radius: 8px;
  color: #cfe9ef;
  font-family: "Cascadia Mono", "Courier New", monospace;
  font-size: 8px;
  background: rgba(3, 17, 26, 0.72);
  backdrop-filter: blur(8px);
}

.flood-depth-legend i {
  display: block;
  height: 7px;
  border-radius: 99px;
  background: linear-gradient(90deg, #7ee6bd, #55d8e2, #327dd9);
}

.simulation-panel {
  position: absolute;
  right: 14px;
  bottom: 14px;
  left: 14px;
  z-index: 2;
  padding: 10px 11px 11px;
  border: 1px solid rgba(89, 218, 229, 0.22);
  border-radius: 11px;
  background: rgba(3, 17, 26, 0.78);
  box-shadow: 0 12px 24px rgba(0, 0, 0, 0.22);
  backdrop-filter: blur(10px);
}

.panel-title {
  display: block;
  margin-bottom: 5px;
  color: #c9eff4;
  font-size: 10px;
  font-weight: 700;
}

.simulation-panel svg {
  display: block;
  width: 100%;
  height: 58px;
}

.chart-grid {
  fill: none;
  stroke: rgba(152, 190, 199, 0.13);
  stroke-width: 1;
}

.chart-area {
  fill: rgba(85, 216, 226, 0.15);
}

.chart-line {
  fill: none;
  stroke: #64e7ee;
  stroke-width: 2.3;
}

.simulation-panel circle {
  fill: #f0c66c;
  stroke: #06141d;
  stroke-width: 2;
}

.timeline {
  height: 4px;
  margin-top: 6px;
  overflow: hidden;
  border-radius: 99px;
  background: rgba(148, 181, 190, 0.17);
}

.timeline span {
  display: block;
  width: 68%;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #72e7bd, #55d8e2);
}

.visual-scene .visual-gradient {
  background:
    radial-gradient(circle at 49% 55%, rgba(91, 227, 236, 0.19), transparent 30%),
    linear-gradient(0deg, rgba(3, 13, 20, 0.66), rgba(3, 13, 20, 0.08) 68%);
}

.scene-callout {
  position: absolute;
  z-index: 4;
  display: flex;
  min-width: 104px;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px 8px 12px;
  border: 1px solid rgba(103, 231, 238, 0.24);
  border-radius: 10px;
  background: rgba(3, 17, 26, 0.78);
  box-shadow: 0 10px 22px rgba(0, 0, 0, 0.2);
  backdrop-filter: blur(9px);
}

.scene-callout::before {
  position: absolute;
  top: 11px;
  left: -4px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #72e7bd;
  box-shadow: 0 0 12px rgba(114, 231, 189, 0.7);
  content: '';
}

.scene-callout span {
  color: #77dfe7;
  font-size: 8px;
  font-weight: 700;
}

.scene-callout strong {
  color: #f0fbff;
  font-size: 11px;
  font-weight: 800;
}

.terrain-callout {
  top: 50px;
  right: 16px;
}

.water-callout {
  left: 52px;
  bottom: 24px;
  border-color: rgba(114, 231, 189, 0.28);
}

.scene-annotations {
  position: absolute;
  inset: 0;
  z-index: 3;
  width: 100%;
  height: 100%;
  overflow: visible;
}

.scene-annotations path {
  fill: none;
}

.scene-annotations marker path {
  fill: #72e7bd;
}

.terrain-leader,
.water-leader {
  stroke: rgba(134, 241, 211, 0.88);
  stroke-width: 1.7;
  stroke-dasharray: 4 4;
  marker-end: url(#sceneArrow);
}

.water-leader {
  stroke: rgba(100, 231, 238, 0.92);
}

.water-highlight {
  stroke: rgba(86, 216, 226, 0.34);
  stroke-width: 10;
  stroke-linecap: round;
  filter: drop-shadow(0 0 10px rgba(86, 216, 226, 0.25));
}

.terrain-target,
.water-target {
  fill: #06151f;
  stroke-width: 2;
}

.terrain-target {
  stroke: #72e7bd;
}

.water-target {
  stroke: #64e7ee;
}

.scene-contour {
  position: absolute;
  inset: 28px 12px 22px 12px;
  z-index: 1;
  width: calc(100% - 24px);
  height: calc(100% - 50px);
  fill: none;
  stroke: rgba(210, 238, 241, 0.32);
  stroke-width: 1.3;
  stroke-dasharray: 6 7;
}

.visual-analysis .visual-gradient {
  background:
    radial-gradient(circle at 42% 46%, rgba(240, 198, 108, 0.14), transparent 30%),
    linear-gradient(0deg, rgba(3, 13, 20, 0.82), rgba(3, 13, 20, 0.13) 62%);
}

.analysis-map-overlay {
  position: absolute;
  inset: 39px 12px 54px 12px;
  z-index: 2;
  border: 1px solid rgba(103, 231, 238, 0.18);
  border-radius: 12px;
  background:
    linear-gradient(rgba(108, 205, 213, 0.08) 1px, transparent 1px),
    linear-gradient(90deg, rgba(108, 205, 213, 0.08) 1px, transparent 1px),
    rgba(3, 17, 26, 0.3);
  background-size: 18px 18px;
  box-shadow: inset 0 0 20px rgba(103, 231, 238, 0.06);
  backdrop-filter: blur(2px);
}

.analysis-map-overlay svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.flood-extent {
  fill: rgba(83, 216, 226, 0.32);
}

.extent-border {
  fill: none;
  stroke: #73f2bf;
  stroke-width: 2.2;
  stroke-dasharray: 7 5;
  filter: drop-shadow(0 0 8px rgba(115, 242, 191, 0.3));
}

.road-trace {
  fill: none;
  stroke: rgba(240, 198, 108, 0.82);
  stroke-width: 2.2;
}

.monitor-trace {
  fill: none;
  stroke: rgba(103, 231, 238, 0.55);
  stroke-width: 1.6;
}

.risk-dot {
  position: absolute;
  width: 10px;
  height: 10px;
  border: 2px solid #f0c66c;
  border-radius: 50%;
  background: rgba(4, 18, 26, 0.9);
  box-shadow: 0 0 0 5px rgba(240, 198, 108, 0.14), 0 0 12px rgba(240, 198, 108, 0.34);
}

.risk-dot i {
  position: absolute;
  left: 12px;
  top: -8px;
  min-width: 42px;
  padding: 3px 6px;
  border: 1px solid rgba(240, 198, 108, 0.2);
  border-radius: 999px;
  color: #fff1c7;
  font-size: 8px;
  font-style: normal;
  font-weight: 700;
  background: rgba(4, 18, 26, 0.76);
  white-space: nowrap;
}

.risk-dot-a { left: 55%; top: 23%; }
.risk-dot-b { left: 35%; top: 64%; }
.risk-dot-c { left: 74%; top: 47%; }

.risk-object-list {
  position: absolute;
  top: 48px;
  right: 14px;
  z-index: 3;
  display: flex;
  width: 112px;
  flex-direction: column;
  gap: 5px;
  padding: 9px;
  border: 1px solid rgba(103, 231, 238, 0.18);
  border-radius: 10px;
  background: rgba(3, 17, 26, 0.78);
  backdrop-filter: blur(8px);
}

.risk-object-list strong {
  color: #e7fbff;
  font-size: 10px;
  font-weight: 800;
}

.risk-object-list span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: #9db5bd;
  font-size: 8px;
}

.risk-object-list i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
}

.risk-high { background: #ef7b5a; box-shadow: 0 0 8px rgba(239, 123, 90, 0.5); }
.risk-mid { background: #f0c66c; box-shadow: 0 0 8px rgba(240, 198, 108, 0.45); }
.risk-low { background: #72e7bd; box-shadow: 0 0 8px rgba(114, 231, 189, 0.45); }

.analysis-board {
  position: absolute;
  right: 14px;
  bottom: 14px;
  z-index: 3;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  width: 184px;
}

.analysis-board > div {
  padding: 9px;
  border: 1px solid rgba(103, 231, 238, 0.18);
  border-radius: 9px;
  background: rgba(3, 17, 26, 0.78);
  backdrop-filter: blur(8px);
}

.analysis-board span {
  display: block;
  color: #9db5bd;
  font-size: 8px;
}

.analysis-board strong {
  display: flex;
  align-items: baseline;
  gap: 4px;
  margin-top: 4px;
  color: #ffffff;
  font-family: "Cascadia Mono", "Courier New", monospace;
  font-size: 17px;
}

.analysis-board small {
  color: #69dbe4;
  font-size: 8px;
}

.risk-radar {
  position: absolute;
  right: 24px;
  top: 50px;
  z-index: 2;
  width: 112px;
  height: 86px;
}

.radar-grid {
  fill: none;
  stroke: rgba(214, 242, 245, 0.24);
  stroke-width: 1;
}

.radar-area {
  fill: rgba(240, 198, 108, 0.22);
  stroke: #f0c66c;
  stroke-width: 2;
}

.capability-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  justify-content: center;
  padding: 20px 20px 18px;
}

.capability-copy h4 {
  margin: 0 0 8px;
  color: #edf9fc;
  font-size: 17px;
  font-weight: 800;
}

.capability-copy > p {
  margin: 0;
  color: #91aab3;
  font-size: 12px;
  line-height: 1.75;
}

.capability-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin-top: 16px;
}

.capability-tags span {
  padding: 5px 8px;
  border: 1px solid rgba(117, 205, 212, 0.14);
  border-radius: 999px;
  color: #78d2d9;
  font-size: 10px;
  font-weight: 700;
  background: rgba(63, 137, 149, 0.1);
}

@media (max-width: 900px) {
  .workflow-map {
    min-height: auto;
    padding: 18px;
  }

  .flow-ribbons,
  .map-grid {
    display: none;
  }

  .workflow-cluster,
  .model-core,
  .feedback-band {
    position: relative;
    top: auto;
    right: auto;
    bottom: auto;
    left: auto;
    width: 100%;
    transform: none;
  }

  .workflow-map {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .model-core {
    height: auto;
    padding: 18px 0;
  }

  .core-orbit,
  .core-ring {
    display: none;
  }

  .engine-steps {
    position: relative;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }

  .engine-step {
    position: relative;
    top: auto !important;
    right: auto !important;
    bottom: auto !important;
    left: auto !important;
    width: auto;
  }

  .feedback-band {
    grid-template-columns: 1fr;
  }

  .feedback-band p {
    font-size: 11px;
  }

  .capability-grid {
    grid-template-columns: 1fr;
  }

}

@media (max-width: 640px) {
  .intro-hero,
  .hero-content {
    min-height: 270px;
  }

  .hero-content {
    max-width: 100%;
    justify-content: flex-end;
    padding: 24px 18px;
  }

  .hero-content h2 {
    max-width: 330px;
    font-size: 20px;
  }

  .hero-content > p {
    font-size: 12px;
    line-height: 1.68;
  }

  .scene-badge {
    top: 16px;
    right: 16px;
    bottom: auto;
    width: 66px;
    height: 66px;
  }

  .scene-badge strong {
    font-size: 22px;
  }

  .scene-badge span {
    font-size: 8px;
  }

  .section-heading {
    align-items: flex-start;
    flex-direction: column;
    gap: 5px;
  }

  .section-heading > p {
    text-align: left;
  }

  .engine-steps {
    grid-template-columns: 1fr;
  }

  .feedback-steps {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .feedback-steps span::after {
    display: none;
  }

  .capability-card {
    grid-template-columns: 1fr;
  }

  .capability-visual {
    min-height: 198px;
    border-right: 0;
    border-bottom: 1px solid rgba(118, 163, 173, 0.14);
  }

}
</style>

