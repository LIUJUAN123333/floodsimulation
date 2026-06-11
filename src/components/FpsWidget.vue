<script lang="ts">
import { ref } from 'vue';

// 模块级单例变量，跨组件共享状态
const fps = ref(0);
const fpsHistory = ref<number[]>(Array(30).fill(60));
const fpsSamples = ref<number[]>([]);
const showFps = ref(true);
const isFpsFixed = ref(false);
const fixedPosX = ref(90);
const fixedPosY = ref(110);
const fixedPanelWidth = 420;
const fixedPanelHeight = 252;
let isLooping = false;
let frames = 0;
let last = performance.now();

const startFpsCount = () => {
  if (isLooping) return;
  isLooping = true;
  last = performance.now();
  frames = 0;
  const loop = () => {
    if (!isLooping) return;
    const now = performance.now();
    frames++;
    if (now - last >= 1000) {
      const currentFps = Math.round((frames * 1000) / (now - last));
      fps.value = currentFps;
      
      // 更新历史帧率曲线数据防抖
      fpsHistory.value.push(currentFps);
      if (fpsHistory.value.length > 30) {
        fpsHistory.value.shift();
      }

      fpsSamples.value.push(currentFps);
      
      frames = 0;
      last = now;
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
};
// 首次导入组件模块时立刻启动循环
startFpsCount();
</script>

<script setup lang="ts">
import { computed } from 'vue';
defineProps<{ mode: 'fixed' | 'inline' }>();

const hasFpsSamples = computed(() => fpsSamples.value.length > 0);

const averageFps = computed(() => {
  const samples = hasFpsSamples.value ? fpsSamples.value : [fps.value || 0];
  const total = samples.reduce((sum, value) => sum + value, 0);
  return Math.round(total / samples.length);
});

const averageFpsDisplay = computed(() => (hasFpsSamples.value ? String(averageFps.value) : '--'));
const fpsDelta = computed(() => fps.value - averageFps.value);

const fpsStatusText = computed(() => {
  if (!hasFpsSamples.value) return '正在采样';
  if (fps.value > 0 && fps.value < 30) return '渲染压力偏高';
  if (averageFps.value >= 55 && Math.abs(fpsDelta.value) <= 6) return '运行稳定';
  return fpsDelta.value >= 0 ? '实时表现良好' : '短时波动';
});

// ---------- 拖拽逻辑 ----------
let isDragging = false;
let startX = 0;
let startY = 0;
let initialPosX = 0;
let initialPosY = 0;

const onMouseDown = (e: MouseEvent) => {
  // 确保没有点到右侧的按钮区
  if ((e.target as HTMLElement).closest('.action-btn')) return;
  isDragging = true;
  startX = e.clientX;
  startY = e.clientY;
  initialPosX = fixedPosX.value;
  initialPosY = fixedPosY.value;

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
};

const onMouseMove = (e: MouseEvent) => {
  if (!isDragging) return;
  const dx = e.clientX - startX;
  const dy = e.clientY - startY;
  // 更新位置 (可限制边界防拖出屏幕)
  fixedPosX.value = Math.max(0, Math.min(window.innerWidth - fixedPanelWidth, initialPosX + dx));
  fixedPosY.value = Math.max(0, Math.min(window.innerHeight - fixedPanelHeight, initialPosY + dy));
};

const onMouseUp = () => {
  isDragging = false;
  document.removeEventListener('mousemove', onMouseMove);
  document.removeEventListener('mouseup', onMouseUp);
};

// ---------- 折线图计算逻辑 ----------
const fpsChartPoints = computed(() => {
  const width = 390;
  const height = 120;
  const h = fpsHistory.value;
  if (h.length <= 1) return "";
  
  const maxFps = Math.max(60, Math.ceil(Math.max(...h, fps.value) * 1.12));
  const minFps = 0;
  
  const step = width / (h.length - 1);
  return h.map((val, index) => {
    const x = index * step;
    let y = height * (1 - (Math.max(minFps, Math.min(val, maxFps)) / maxFps));
    // 稍微限制极值不要贴边
    y = Math.min(Math.max(1, y), height - 1);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
});

const fpsChartFill = computed(() => {
  const pts = fpsChartPoints.value;
  return pts ? `0,120 ${pts} 390,120` : '';
});
</script>

<template>
  <template v-if="mode === 'fixed'">
    <div 
      v-if="isFpsFixed && showFps" 
      class="fps-card is-fixed" 
      :class="{ 'low-fps': fps < 30 }"
      :style="{ top: fixedPosY + 'px', left: fixedPosX + 'px' }"
      @mousedown="onMouseDown"
    >
      <div class="fps-header-row">
        <div class="fps-title-group">
          <span class="drag-handle" title="按住拖拽">⠿</span>
          <span class="fps-label">实时渲染帧率</span>
        </div>
        <span class="fps-status-badge">{{ fpsStatusText }}</span>
      </div>
      <div class="fps-metrics-row">
        <div class="fps-metric-card current">
          <span>实时帧率</span>
          <div class="fps-value"><strong>{{ fps }}</strong><em>FPS</em></div>
        </div>
        <div class="fps-metric-card average">
          <span>平均帧率</span>
          <div class="fps-value"><strong>{{ averageFpsDisplay }}</strong><em>FPS</em></div>
          <small>本次运行</small>
        </div>
      </div>
      <div class="fps-chart-wrapper">
        <svg class="fps-curve" viewBox="0 0 390 120" preserveAspectRatio="none" aria-label="实时渲染帧率曲线">
          <line x1="0" y1="0.5" x2="390" y2="0.5" class="fps-grid-line top" />
          <line x1="0" y1="60" x2="390" y2="60" class="fps-grid-line" />
          <line x1="0" y1="119.5" x2="390" y2="119.5" class="fps-grid-line" />
          <polygon :points="fpsChartFill" class="fps-curve-fill" />
          <polyline :points="fpsChartPoints" class="fps-curve-line" />
        </svg>
      </div>
    </div>
  </template>

  <template v-if="mode === 'inline'">
    <div v-if="!isFpsFixed && showFps" class="fps-card" :class="{ 'low-fps': fps < 30 }">
      <div class="fps-header-row">
        <div class="fps-title-group">
          <span class="fps-label">实时渲染帧率</span>
        </div>
        <span class="fps-status-badge">{{ fpsStatusText }}</span>
        <div class="fps-actions">
          <span class="action-btn" @click="isFpsFixed = true" title="固定为全屏悬浮面板">📍</span>
          <span class="action-btn" @click="showFps = false" title="关闭帧率面板">✖</span>
        </div>
      </div>
      <div class="fps-metrics-row">
        <div class="fps-metric-card current">
          <span>实时帧率</span>
          <div class="fps-value"><strong>{{ fps }}</strong><em>FPS</em></div>
        </div>
        <div class="fps-metric-card average">
          <span>平均帧率</span>
          <div class="fps-value"><strong>{{ averageFpsDisplay }}</strong><em>FPS</em></div>
          <small>本次运行</small>
        </div>
      </div>
      <div class="fps-chart-wrapper">
        <svg class="fps-curve" viewBox="0 0 390 120" preserveAspectRatio="none" aria-label="实时渲染帧率曲线">
          <line x1="0" y1="0.5" x2="390" y2="0.5" class="fps-grid-line top" />
          <line x1="0" y1="60" x2="390" y2="60" class="fps-grid-line" />
          <line x1="0" y1="119.5" x2="390" y2="119.5" class="fps-grid-line" />
          <polygon :points="fpsChartFill" class="fps-curve-fill" />
          <polyline :points="fpsChartPoints" class="fps-curve-line" />
        </svg>
      </div>
    </div>

    <!-- 当帧率面板被固定时，数据监测面板内部仍保留一个状态提示与控制器 -->
    <div v-else-if="isFpsFixed && showFps" class="fps-toggle active">
      <div class="fps-main">
        <span class="fps-icon mini"></span> 
        <span>帧率已独立固定</span>
      </div>
      <div class="fps-actions">
        <span class="action-btn" @click="isFpsFixed = false" title="将帧率面板收回到这里">📌 收回</span>
      </div>
    </div>

    <div v-else class="fps-toggle" @click="showFps = true">
      <span class="fps-icon mini"></span> 开启帧率监控
    </div>
  </template>
</template>

<style scoped>
.fps-card {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  padding: 16px 18px 20px;
  overflow: hidden;
  border: 1px solid rgba(0, 229, 255, 0.32);
  border-radius: 5px;
  background:
    linear-gradient(180deg, rgba(3, 18, 28, 0.88) 0%, rgba(4, 29, 40, 0.76) 100%),
    radial-gradient(ellipse at 50% 64%, rgba(0, 229, 255, 0.18) 0%, rgba(0, 229, 255, 0.04) 48%, transparent 72%);
  box-shadow:
    inset 0 0 26px rgba(0, 229, 255, 0.14),
    0 10px 24px rgba(0, 0, 0, 0.24);
  backdrop-filter: blur(8px);
  /* 不要对所有外层属性使用 all transition，遇到 top left 会造成拖拽严重滞后 */
  transition: opacity 0.3s, background 0.3s, box-shadow 0.3s;
}

.fps-card::before {
  position: absolute;
  inset: 0;
  pointer-events: none;
  content: "";
  background:
    linear-gradient(90deg, transparent 0%, rgba(0, 229, 255, 0.08) 48%, transparent 100%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.06) 0%, transparent 38%);
}

.fps-header-row {
  position: relative;
  z-index: 1;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 10px;
  width: 100%;
}

.fps-title-group {
  display: flex;
  align-items: center;
  flex: 1 1 auto;
  max-width: 100%;
  min-width: 0;
  gap: 8px;
}

.fps-status-badge {
  flex: 0 0 auto;
  max-width: 126px;
  padding: 5px 8px;
  border: 1px solid rgba(72, 242, 166, 0.32);
  border-radius: 4px;
  color: #b8ffe2;
  background: rgba(72, 242, 166, 0.08);
  font-size: 11px;
  line-height: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.fps-metrics-row {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-top: 12px;
}

.fps-metric-card {
  position: relative;
  min-width: 0;
  min-height: 64px;
  padding: 10px 12px;
  overflow: hidden;
  border: 1px solid rgba(0, 229, 255, 0.18);
  border-radius: 5px;
  background:
    linear-gradient(180deg, rgba(0, 229, 255, 0.1), rgba(0, 229, 255, 0.03)),
    rgba(2, 16, 29, 0.58);
}

.fps-metric-card::after {
  position: absolute;
  right: -18px;
  bottom: -28px;
  width: 72px;
  height: 72px;
  content: "";
  border-radius: 50%;
  background: rgba(0, 229, 255, 0.08);
  filter: blur(1px);
}

.fps-metric-card > span,
.fps-metric-card small {
  position: relative;
  z-index: 1;
  display: block;
  color: #8fb8d8;
  font-size: 11px;
  line-height: 1;
}

.fps-metric-card small {
  margin-top: 6px;
  color: #6f9ab1;
}

.fps-metric-card.average {
  border-color: rgba(125, 223, 255, 0.24);
  background:
    linear-gradient(180deg, rgba(125, 223, 255, 0.11), rgba(0, 229, 255, 0.035)),
    rgba(2, 16, 29, 0.58);
}

.fps-chart-wrapper {
  position: relative;
  z-index: 1;
  width: 100%;
  max-height: 120px;
  min-height: 88px;
  margin-top: 11px;
  aspect-ratio: 390 / 120;
}

.fps-curve {
  width: 100%;
  height: 100%;
  display: block;
  overflow: visible;
}

.fps-grid-line {
  stroke: rgba(135, 229, 242, 0.16);
  stroke-width: 1;
}

.fps-grid-line.top {
  stroke: rgba(0, 229, 255, 0.26);
}

.fps-curve-fill {
  fill: rgba(0, 229, 255, 0.18);
  transition: fill 0.3s;
}

.fps-curve-line {
  fill: none;
  stroke: #11eaff;
  stroke-width: 5.5;
  stroke-linecap: square;
  stroke-linejoin: miter;
  filter: drop-shadow(0 0 5px rgba(17, 234, 255, 0.62));
  transition: stroke 0.3s;
}

.fps-card.low-fps .fps-curve-fill {
  fill: rgba(255, 204, 102, 0.18);
}

.fps-card.low-fps .fps-curve-line {
  stroke: #ffcc66;
  filter: drop-shadow(0 0 4px rgba(255, 204, 102, 0.6));
}

.fps-card.is-fixed {
  position: fixed;
  width: 420px;
  max-width: calc(100vw - 24px);
  z-index: 10000;
  background:
    linear-gradient(180deg, rgba(3, 17, 27, 0.9) 0%, rgba(4, 29, 40, 0.78) 100%),
    radial-gradient(ellipse at 50% 64%, rgba(0, 229, 255, 0.2) 0%, rgba(0, 229, 255, 0.05) 48%, transparent 72%);
  backdrop-filter: blur(16px);
  border-color: rgba(0, 229, 255, 0.42);
  box-shadow:
    0 14px 34px rgba(0, 0, 0, 0.42),
    inset 0 0 28px rgba(0, 229, 255, 0.16);
  cursor: grab;
}

.fps-card.is-fixed:active {
  cursor: grabbing;
}

.fps-card.is-fixed .fps-chart-wrapper {
  height: 120px;
  min-height: 120px;
}

.drag-handle {
  opacity: 0;
  color: rgba(0, 229, 255, 0.72);
  font-size: 16px;
  margin-right: 0;
  transition: opacity 0.2s;
}

.fps-card.is-fixed:hover .drag-handle {
  opacity: 1;
}

.fps-value {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  flex: 0 0 auto;
  gap: 6px;
  color: #f4fdff;
}

.fps-metric-card .fps-value {
  margin-top: 8px;
}

.fps-actions {
  display: flex;
  flex: 0 0 auto;
  gap: 7px;
  margin-left: 2px;
}

.fps-card .fps-actions {
  position: static;
  z-index: 1;
  margin-left: 0;
  opacity: 1;
  pointer-events: auto;
  transform: none;
  padding: 2px;
  border: 1px solid rgba(0, 229, 255, 0.14);
  border-radius: 5px;
  background: rgba(2, 18, 32, 0.46);
  transition: border-color 0.2s, background 0.2s;
}

.fps-card .fps-actions:hover {
  border-color: rgba(0, 229, 255, 0.32);
  background: rgba(2, 24, 40, 0.68);
}

.action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: 1px solid rgba(0, 229, 255, 0.22);
  border-radius: 4px;
  background: rgba(0, 229, 255, 0.06);
  color: #c8f7ff;
  cursor: pointer;
  font-size: 12px;
  opacity: 0.72;
  transition: opacity 0.2s, border-color 0.2s, background 0.2s, transform 0.2s;
  user-select: none;
}

.action-btn:hover {
  opacity: 1;
  border-color: rgba(0, 229, 255, 0.54);
  background: rgba(0, 229, 255, 0.14);
  transform: translateY(-1px);
}

.fps-toggle {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
  padding: 8px;
  font-size: 12px;
  color: #8fb8d8;
  background: rgba(0, 229, 255, 0.05);
  border: 1px dashed rgba(0, 229, 255, 0.25);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.fps-toggle.active {
  justify-content: space-between;
  border-style: solid;
  border-color: rgba(0, 229, 255, 0.15);
  background: rgba(4, 18, 34, 0.4);
  cursor: default;
}

.fps-toggle:not(.active):hover {
  background: rgba(0, 229, 255, 0.1);
  color: #7fdfff;
  border-color: rgba(0, 229, 255, 0.4);
}

.fps-icon {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #48f2a6;
  box-shadow: 0 0 8px rgba(72, 242, 166, 0.8);
  animation: pulse 2s infinite;
}

.fps-icon.mini {
  width: 6px;
  height: 6px;
}

@keyframes pulse {
  0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(72, 242, 166, 0.7); }
  70% { transform: scale(1); box-shadow: 0 0 0 6px rgba(72, 242, 166, 0); }
  100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(72, 242, 166, 0); }
}

.fps-main {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.fps-label {
  flex: 1 1 auto;
  min-width: 0;
  color: #09eaff;
  font-size: 18px;
  font-weight: 800;
  line-height: 1.1;
  text-shadow: 0 0 9px rgba(0, 229, 255, 0.48);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.fps-value strong {
  color: #f4fdff;
  font-size: 26px;
  font-weight: 800;
  line-height: 1;
  text-shadow: 0 0 9px rgba(0, 229, 255, 0.72);
}

.fps-value em {
  color: #f4fdff;
  font-size: 14px;
  font-weight: 800;
  font-style: normal;
  line-height: 1;
  text-shadow: 0 0 9px rgba(0, 229, 255, 0.72);
}

.fps-card.low-fps .fps-icon {
  background: #ffcc66;
  box-shadow: 0 0 8px rgba(255, 204, 102, 0.8);
}
.fps-card.low-fps .fps-value strong {
  color: #ffcc66;
  text-shadow: 0 0 10px rgba(255, 204, 102, 0.45);
}

.fps-card.low-fps .fps-status-badge {
  color: #ffe3a8;
  border-color: rgba(255, 204, 102, 0.42);
  background: rgba(255, 204, 102, 0.1);
}

.fps-card.low-fps .fps-metric-card.current {
  border-color: rgba(255, 204, 102, 0.32);
  background:
    linear-gradient(180deg, rgba(255, 204, 102, 0.12), rgba(255, 204, 102, 0.035)),
    rgba(2, 16, 29, 0.58);
}

.fps-card.low-fps .fps-label,
.fps-card.low-fps .fps-value em {
  color: #ffcc66;
  text-shadow: 0 0 10px rgba(255, 204, 102, 0.45);
}

@media (max-width: 520px) {
  .fps-card {
    padding: 14px 14px 16px;
  }

  .fps-header-row {
    gap: 8px;
  }

  .fps-metrics-row {
    grid-template-columns: 1fr;
    gap: 8px;
  }

  .fps-label {
    font-size: 15px;
  }

  .fps-value strong {
    font-size: 22px;
  }

  .fps-value em {
    font-size: 13px;
  }

  .fps-chart-wrapper {
    min-height: 74px;
  }
}
</style>
