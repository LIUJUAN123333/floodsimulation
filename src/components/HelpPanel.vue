<script setup lang="ts">
const quickSteps = [
  { title: '准备数据', text: '准备 DEM、糙率、河道、水深 TXT 或洪水 JSON 等数据文件，确保路径和格式可被系统识别。' },
  { title: '生成结果', text: '进入“仿真模拟”，完成格式转换、糙率计算、水深结果输出和 JSON 生成。' },
  { title: '加载洪水', text: '选择洪水 JSON 后，系统会在三维场景中渲染淹没范围，并自动联动面积统计。' },
  { title: '分析灾情', text: '结合“数据监测”和“灾情分析”，查看水位、雨量、流量、淹没面积和风险提示。' },
  { title: '辅助展示', text: '打开“基础功能”右侧图标栏，使用定位、量测、漫游、全屏和截图完成演示输出。' }
];

const tips = [
  { key: '左键', value: '添加量测点、漫游路径点或选择场景位置' },
  { key: '右键', value: '结束距离/面积量测，或结束漫游路径拾取' },
  { key: '滚轮', value: '缩放三维场景视角，快速靠近或远离研究区' },
  { key: '拖拽', value: '旋转、平移和调整观察方向' },
  { key: '地形层', value: '左下角开关真实地形与椭球地形' },
  { key: '基础功能', value: '右侧图标栏提供定位、量测、漫游、全屏、截图和清除' }
];

const faqs = [
  {
    question: '为什么点击“基础功能”后不是右侧大面板？',
    answer: '基础功能已经改为右侧图标工具栏。用户点击“基础功能”后，会在地图右侧看到一列图标；点击定位、量测或漫游图标，会弹出对应的小工具面板。'
  },
  {
    question: '加载数据后没有看到洪水怎么办？',
    answer: '请先确认洪水 JSON 格式正确，并检查数据范围是否在当前视角内。用户也可以先播放“案例演示”，确认三维场景和洪水渲染链路正常。'
  },
  {
    question: '淹没面积为什么没有显示？',
    answer: '淹没面积依赖已加载的洪水网格和像元尺寸。只有洪水 JSON 成功加载并识别到网格信息后，面积统计才会自动出现。'
  },
  {
    question: '地形层切换失败怎么办？',
    answer: '真实地形依赖 Cesium World Terrain、网络连接和 Ion Token。若加载失败，用户可以关闭左下角“地形层”，切换到椭球地形继续演示。'
  },
  {
    question: '截图或全屏无反应怎么办？',
    answer: '请等待三维场景加载完成后再操作。截图功能依赖浏览器允许 canvas 导出，若浏览器拦截下载，请检查浏览器下载权限。'
  },
  {
    question: '漫游功能怎么使用？',
    answer: '进入“基础功能”，点击漫游图标，可以在地图中拾取路径，也可以导入同名的 .shp、.shx、.dbf、.prj 文件或包含完整 Shapefile 数据集的文件夹；系统校验坐标系并生成轨迹后，再设置速度和相对 DEM 高度，点击“开始漫游”。'
  }
];
</script>

<template>
  <section class="help-panel">
    <div class="guide-card lead-card">
      <span class="guide-tag">用户建议</span>
      <h4>先验证场景，再加载数据</h4>
      <p>
        初次使用时，建议用户先进入“案例演示”播放内置场景，确认三维地图、洪水渲染、地形层和面积统计正常；
        随后再进入“仿真模拟”加载自己的数据，最后配合“数据监测”“灾情分析”和“基础功能”完成研判与展示。
      </p>
    </div>

    <div class="columns-wrapper">
      <div class="left-col columns-content">
        <div class="guide-card">
          <div class="section-title">常用流程</div>
          <div class="step-list">
            <div v-for="(step, index) in quickSteps" :key="step.title" class="step-row">
              <span>{{ index + 1 }}</span>
              <div>
                <strong>{{ step.title }}</strong>
                <p>{{ step.text }}</p>
              </div>
            </div>
          </div>
        </div>

        <div class="guide-card">
          <div class="section-title">地图操作</div>
          <div class="tip-grid">
            <div v-for="tip in tips" :key="tip.key" class="tip-item">
              <strong>{{ tip.key }}</strong>
              <span>{{ tip.value }}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="right-col columns-content">
        <div class="guide-card h-full">
          <div class="section-title">常见问题</div>
          <div class="faq-list">
            <details v-for="faq in faqs" :key="faq.question" open>
              <summary>{{ faq.question }}</summary>
              <p>{{ faq.answer }}</p>
            </details>
          </div>
        </div>
      </div>
    </div>

    <div class="support-strip">
      <strong>提示</strong>
      <span>左侧“洪水”系统图标用于回到初始状态；基础功能中的“清除”只清除量测和漫游标绘，不会清除已加载的洪水模拟结果。</span>
    </div>
  </section>
</template>

<style scoped>
.help-panel {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 4px;
}

.columns-wrapper {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  align-items: stretch;
}

.columns-content {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.h-full {
  height: 100%;
}

.guide-card,
.support-strip {
  border: 1px solid rgba(0, 229, 255, 0.2);
  border-radius: 12px;
  background: rgba(10, 25, 40, 0.7);
  backdrop-filter: blur(12px);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4), inset 0 1px 2px rgba(255, 255, 255, 0.1);
}

.guide-card {
  padding: 20px;
}

.lead-card {
  background: linear-gradient(135deg, rgba(0, 229, 255, 0.15) 0%, rgba(8, 20, 32, 0.9) 100%);
  border: 1px solid rgba(0, 229, 255, 0.4);
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.lead-card::after {
  content: '';
  position: absolute;
  top: -50px;
  right: -50px;
  width: 200px;
  height: 200px;
  background: radial-gradient(circle, rgba(0, 229, 255, 0.15), transparent 70%);
  filter: blur(30px);
  pointer-events: none;
}

.guide-tag {
  display: inline-flex;
  align-items: center;
  height: 26px;
  padding: 0 12px;
  border-radius: 4px;
  color: #00e5ff;
  font-size: 13px;
  font-weight: 700;
  background: rgba(0, 229, 255, 0.15);
  box-shadow: 0 0 10px rgba(0, 229, 255, 0.2);
  border: 1px solid rgba(0, 229, 255, 0.3);
  letter-spacing: 1px;
  align-self: flex-start;
}

.lead-card h4 {
  margin: 14px 0 10px;
  color: #ffffff;
  font-size: 20px;
  font-weight: 700;
  letter-spacing: 1px;
  text-shadow: 0 2px 10px rgba(0, 0, 0, 0.5);
}

.lead-card p,
.step-row p,
details p,
.support-strip span {
  margin: 0;
  color: #b9d4e7;
  font-size: 14px;
  line-height: 1.7;
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

.step-list,
.faq-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.step-row {
  display: flex;
  gap: 14px;
  padding: 14px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.25);
  border-left: 3px solid transparent;
  transition: all 0.3s;
}

.step-row:hover {
  background: rgba(0, 229, 255, 0.05);
  border-left-color: #00e5ff;
  transform: translateX(4px);
}

.step-row > span {
  flex-shrink: 0;
  width: 34px;
  height: 34px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #00e5ff;
  background: rgba(0, 229, 255, 0.1);
  font-size: 16px;
  font-weight: 800;
  box-shadow: inset 0 0 10px rgba(0, 229, 255, 0.2);
}

.step-row strong {
  display: block;
  margin-bottom: 6px;
  color: #ffffff;
  font-size: 15px;
  font-weight: 600;
  margin-top: 2px;
}

.tip-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 12px;
}

.tip-item {
  padding: 14px;
  border-radius: 8px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.05) 0%, rgba(255, 255, 255, 0.01) 100%);
  border: 1px solid rgba(0, 229, 255, 0.1);
  text-align: center;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.tip-item:hover {
  background: rgba(0, 229, 255, 0.08);
  border-color: rgba(0, 229, 255, 0.3);
  transform: translateY(-4px);
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.2);
}

.tip-item strong {
  display: block;
  color: #00e5ff;
  font-size: 16px;
  font-weight: 700;
  text-shadow: 0 0 8px rgba(0, 229, 255, 0.3);
}

.tip-item span {
  display: block;
  margin-top: 6px;
  color: #9fc9e0;
  font-size: 13px;
  line-height: 1.5;
}

details {
  border-radius: 8px;
  background: linear-gradient(90deg, rgba(255, 255, 255, 0.03) 0%, rgba(255, 255, 255, 0.01) 100%);
  border: 1px solid rgba(255, 255, 255, 0.05);
  overflow: hidden;
  transition: all 0.3s;
}

details[open] {
  background: rgba(0, 0, 0, 0.4);
  border-color: rgba(0, 229, 255, 0.3);
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.3);
}

summary {
  color: #e7f6ff;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  padding: 14px 16px;
  background: transparent;
  outline: none;
  list-style: none;
  display: flex;
  justify-content: space-between;
  align-items: center;
  transition: background 0.2s;
}

summary:hover {
  background: rgba(255, 255, 255, 0.03);
}

summary::-webkit-details-marker {
  display: none;
}

summary::after {
  content: '+';
  color: #00e5ff;
  font-size: 20px;
  font-weight: 300;
  transition: transform 0.3s ease;
}

details[open] summary::after {
  transform: rotate(45deg);
  color: #ff4757;
}

details[open] summary {
  background: rgba(0, 229, 255, 0.08);
  border-bottom: 1px solid rgba(0, 229, 255, 0.15);
}

details p {
  padding: 16px;
  margin: 0;
  background: rgba(0, 0, 0, 0.2);
}

.support-strip {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px 20px;
  background: linear-gradient(90deg, rgba(255, 190, 83, 0.15), rgba(255, 190, 83, 0.02));
  border: 1px solid rgba(255, 190, 83, 0.3);
}

.support-strip strong {
  padding: 6px 10px;
  border-radius: 6px;
  color: #ffd874;
  background: rgba(255, 190, 83, 0.2);
  font-size: 13px;
  font-weight: 800;
  white-space: nowrap;
  letter-spacing: 1px;
}
</style>
