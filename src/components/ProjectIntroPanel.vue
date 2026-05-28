<script setup lang="ts">
const highlights = [
  { label: '三维推演', value: 'Cesium 场景', note: '地形、影像、洪水网格与监测信息统一展示' },
  { label: '洪水渲染', value: '时序回放', note: '加载洪水 JSON 后查看淹没范围和水深演进' },
  { label: '灾情研判', value: '面积统计', note: '结合淹没面积、水深分级和风险提示辅助分析' },
  { label: 'GIS 工具', value: '轻量工具栏', note: '定位、量测、漫游、截图、全屏和清除一体化操作' }
];

const workflow = [
  '准备 DEM、河道、糙率、水深 TXT 或洪水 JSON 等基础数据',
  '进入“仿真模拟”，完成格式转换、糙率计算和水深 JSON 生成',
  '加载洪水 JSON 到三维场景，查看淹没范围、水深变化和面积统计',
  '结合“数据监测”和“灾情分析”，研判水位、雨量、流量与风险状态',
  '使用“基础功能”完成定位飞行、量测、漫游、截图和成果展示'
];

const modules = [
  { name: '仿真模拟', desc: '面向数据处理、计算参数配置、水深结果生成和洪水渲染的核心工作区。' },
  { name: '灾情分析', desc: '用于展示淹没面积、水深分级、风险等级和应急处置建议，辅助用户快速研判灾情。' },
  { name: '案例演示', desc: '内置金沙江、肖家桥等典型洪水场景，便于用户直接播放和对比演示效果。' },
  { name: '数据监测', desc: '展示水位站、雨量、流量、趋势和告警信息，支撑洪水过程监测。' },
  { name: '基础功能', desc: '右侧图标工具栏，提供 Home、定位飞行、量测、漫游、全屏、截图和清除。' },
  { name: '地形层', desc: '左下角开关用于真实地形与椭球地形切换，便于用户按网络和展示需求选择。' }
];
</script>

<template>
  <section class="intro-panel">
    <div class="hero-block">
      <div class="hero-text">
        <span class="eyebrow">Flood Simulation Platform</span>
        <h4>洪水动态模拟与三维可视化系统</h4>
        <p>
          本系统面向用户的洪水模拟成果展示、三维推演和辅助研判需求，
          将数据处理、洪水时序渲染、监测告警、灾情分析与 GIS 基础工具整合到同一个三维场景中，
          帮助用户更直观地理解淹没过程、影响范围和风险变化。
        </p>
      </div>
      <div class="hero-meter">
        <strong>3D</strong>
        <span>空间推演</span>
      </div>
    </div>

    <div class="highlight-grid">
      <div v-for="item in highlights" :key="item.label" class="highlight-card">
        <span>{{ item.label }}</span>
        <strong>{{ item.value }}</strong>
        <small>{{ item.note }}</small>
      </div>
    </div>

    <div class="columns-wrapper">
      <div class="section-card flex-col">
        <div class="section-title">用户工作流程</div>
        <div class="flow-list">
          <div v-for="(item, index) in workflow" :key="item" class="flow-item">
            <span>{{ String(index + 1).padStart(2, '0') }}</span>
            <p>{{ item }}</p>
          </div>
        </div>
      </div>

      <div class="section-card flex-col">
        <div class="section-title">功能模块</div>
        <div class="module-list">
          <div v-for="module in modules" :key="module.name" class="module-row">
            <strong>{{ module.name }}</strong>
            <p>{{ module.desc }}</p>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.intro-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 4px;
}

.hero-block,
.section-card {
  border: 1px solid rgba(0, 229, 255, 0.2);
  border-radius: 12px;
  background: rgba(10, 25, 40, 0.7);
  backdrop-filter: blur(12px);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4), inset 0 1px 2px rgba(255, 255, 255, 0.1);
  overflow: hidden;
  position: relative;
}

.hero-block {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 20px;
  padding: 24px;
  background: linear-gradient(135deg, rgba(0, 229, 255, 0.1) 0%, rgba(8, 20, 32, 0.9) 100%);
}

.hero-block::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(0, 229, 255, 0.8), transparent);
}

.hero-text {
  flex: 1;
}

.eyebrow {
  display: inline-block;
  color: #00e5ff;
  font-size: 12px;
  letter-spacing: 2px;
  text-transform: uppercase;
  margin-bottom: 10px;
  font-weight: 700;
  background: rgba(0, 229, 255, 0.15);
  padding: 4px 10px;
  border-radius: 4px;
  border: 1px solid rgba(0, 229, 255, 0.3);
}

.hero-block h4 {
  margin: 0 0 10px;
  color: #ffffff;
  font-size: 22px;
  font-weight: 600;
  letter-spacing: 1px;
  text-shadow: 0 2px 10px rgba(0, 0, 0, 0.5);
}

.hero-block p {
  margin: 0;
  color: #b9d4e7;
  font-size: 14px;
  line-height: 1.7;
  max-width: 90%;
}

.hero-meter {
  flex-shrink: 0;
  width: 80px;
  height: 80px;
  border-radius: 50%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border: 2px solid rgba(0, 229, 255, 0.4);
  background: radial-gradient(circle, rgba(0, 229, 255, 0.2), rgba(0, 0, 0, 0.5));
  box-shadow: 0 0 20px rgba(0, 229, 255, 0.3), inset 0 0 15px rgba(0, 229, 255, 0.2);
  position: relative;
}

.hero-meter::after {
  content: '';
  position: absolute;
  top: -4px;
  left: -4px;
  right: -4px;
  bottom: -4px;
  border-radius: 50%;
  border: 1px dashed rgba(0, 229, 255, 0.5);
  animation: rotate 10s linear infinite;
}

@keyframes rotate {
  100% {
    transform: rotate(360deg);
  }
}

.hero-meter strong {
  color: #ffffff;
  font-size: 26px;
  font-weight: 800;
  text-shadow: 0 0 12px #00e5ff;
  line-height: 1;
}

.hero-meter span {
  margin-top: 6px;
  color: #a0f0ff;
  font-size: 11px;
  font-weight: 500;
}

.highlight-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
}

.highlight-card {
  padding: 16px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.05) 0%, rgba(255, 255, 255, 0.01) 100%);
  border: 1px solid rgba(0, 229, 255, 0.1);
  border-radius: 10px;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  display: flex;
  flex-direction: column;
  justify-content: center;
  position: relative;
  overflow: hidden;
}

.highlight-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 2px;
  background: #00e5ff;
  opacity: 0;
  transition: opacity 0.3s;
}

.highlight-card:hover {
  background: rgba(0, 229, 255, 0.08);
  border-color: rgba(0, 229, 255, 0.4);
  transform: translateY(-4px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3), 0 0 15px rgba(0, 229, 255, 0.2);
}

.highlight-card:hover::before {
  opacity: 1;
}

.highlight-card span {
  color: #8fb8d8;
  font-size: 13px;
  margin-bottom: 6px;
  font-weight: 500;
}

.highlight-card strong {
  color: #ffffff;
  font-size: 20px;
  font-weight: 700;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
}

.highlight-card small {
  margin-top: 8px;
  color: #7a9cb5;
  font-size: 12px;
  line-height: 1.5;
}

.columns-wrapper {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  align-items: stretch;
}

.section-card {
  padding: 20px;
  height: 100%;
}

.flex-col {
  display: flex;
  flex-direction: column;
}

.section-title {
  margin-bottom: 18px;
  color: #ffffff;
  font-size: 16px;
  font-weight: 700;
  display: flex;
  align-items: center;
  gap: 10px;
}

.section-title::before {
  content: '';
  display: block;
  width: 4px;
  height: 16px;
  background: #00e5ff;
  border-radius: 2px;
  box-shadow: 0 0 10px #00e5ff;
}

.flow-list,
.module-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.flow-item {
  display: flex;
  gap: 14px;
  align-items: center;
  padding: 12px 16px;
  background: rgba(0, 0, 0, 0.25);
  border-radius: 8px;
  border-left: 3px solid transparent;
  transition: all 0.3s;
}

.flow-item:hover {
  border-left-color: #00e5ff;
  background: rgba(0, 229, 255, 0.05);
  transform: translateX(4px);
}

.flow-item span {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #00e5ff;
  font-size: 14px;
  font-weight: 800;
  background: rgba(0, 229, 255, 0.1);
  box-shadow: inset 0 0 8px rgba(0, 229, 255, 0.2);
}

.flow-item p,
.module-row p {
  margin: 0;
  color: #b9d4e7;
  font-size: 14px;
  line-height: 1.6;
}

.module-row {
  padding: 14px 16px;
  border-radius: 8px;
  background: linear-gradient(90deg, rgba(255, 255, 255, 0.03) 0%, rgba(255, 255, 255, 0.01) 100%);
  border: 1px solid rgba(255, 255, 255, 0.05);
  transition: all 0.3s;
}

.module-row:hover {
  background: rgba(0, 229, 255, 0.05);
  border-color: rgba(0, 229, 255, 0.2);
  transform: translateX(4px);
}

.module-row strong {
  display: block;
  margin-bottom: 6px;
  color: #e7f6ff;
  font-size: 15px;
  font-weight: 600;
}
</style>
