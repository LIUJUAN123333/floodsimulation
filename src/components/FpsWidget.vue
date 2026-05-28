<script lang="ts">
import { ref } from 'vue';

// 模块级单例变量，跨组件共享状态
const fps = ref(0);
const showFps = ref(true);
const isFpsFixed = ref(false);
const fixedPosX = ref(90);
const fixedPosY = ref(110);
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
      fps.value = Math.round((frames * 1000) / (now - last));
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
defineProps<{ mode: 'fixed' | 'inline' }>();

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
  fixedPosX.value = Math.max(0, Math.min(window.innerWidth - 260, initialPosX + dx));
  fixedPosY.value = Math.max(0, Math.min(window.innerHeight - 50, initialPosY + dy));
};

const onMouseUp = () => {
  isDragging = false;
  document.removeEventListener('mousemove', onMouseMove);
  document.removeEventListener('mouseup', onMouseUp);
};
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
      <div class="fps-main">
        <span class="fps-icon"></span>
        <span class="fps-label">实时渲染帧率</span>
      </div>
      <div class="fps-value">
        <!-- 增加拖拽拖动手柄的小图标 -->
        <span class="drag-handle" title="按住拖拽">⠿</span>
        <strong>{{ fps }}</strong> <em>FPS</em>
      </div>
    </div>
  </template>

  <template v-if="mode === 'inline'">
    <div v-if="!isFpsFixed && showFps" class="fps-card" :class="{ 'low-fps': fps < 30 }">
      <div class="fps-main">
        <span class="fps-icon"></span>
        <span class="fps-label">实时渲染帧率</span>
      </div>
      <div class="fps-value">
        <strong>{{ fps }}</strong> <em>FPS</em>
      </div>
      <div class="fps-actions">
        <span class="action-btn" @click="isFpsFixed = true" title="固定为全屏悬浮面板">📍</span>
        <span class="action-btn" @click="showFps = false" title="关闭帧率面板">✖</span>
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
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  border: 1px solid rgba(0, 229, 255, 0.4);
  border-radius: 8px;
  background: linear-gradient(135deg, rgba(0, 242, 255, 0.15) 0%, rgba(10, 45, 90, 0.45) 100%);
  box-shadow: inset 0 0 20px rgba(0, 229, 255, 0.15), 0 4px 12px rgba(0, 0, 0, 0.15);
  backdrop-filter: blur(8px);
  /* 不要对所有外层属性使用 all transition，遇到 top left 会造成拖拽严重滞后 */
  transition: opacity 0.3s, background 0.3s, box-shadow 0.3s;
}

.fps-card.is-fixed {
  position: fixed;
  width: 260px;
  z-index: 10000;
  background: linear-gradient(135deg, rgba(0, 229, 255, 0.25) 0%, rgba(8, 32, 64, 0.8) 100%);
  backdrop-filter: blur(16px);
  border: 1px solid rgba(0, 229, 255, 0.6);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.45), inset 0 0 24px rgba(0, 229, 255, 0.25);
  cursor: grab;
}

.fps-card.is-fixed:active {
  cursor: grabbing;
}

.drag-handle {
  opacity: 0;
  color: rgba(0, 229, 255, 0.6);
  font-size: 16px;
  margin-right: 12px;
  transition: opacity 0.2s;
}

.fps-card.is-fixed:hover .drag-handle {
  opacity: 1;
}

.fps-value {
  display: flex;
  align-items: center;
}

.fps-actions {
  display: flex;
  gap: 12px;
  margin-left: auto;
  padding-left: 12px;
}

.action-btn {
  cursor: pointer;
  font-size: 13px;
  opacity: 0.5;
  transition: all 0.2s;
  user-select: none;
  filter: grayscale(0.5);
}

.action-btn:hover {
  opacity: 1;
  transform: scale(1.15);
  filter: grayscale(0);
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
}

.fps-label {
  color: #8fb8d8;
  font-size: 13px;
  font-weight: 700;
}

.fps-value strong {
  color: #48f2a6;
  font-size: 24px;
  font-weight: 700;
  text-shadow: 0 0 10px rgba(72, 242, 166, 0.45);
}

.fps-value em {
  color: #7fdfff;
  font-size: 12px;
  font-style: normal;
  margin-left: 2px;
}

.fps-card.low-fps .fps-icon {
  background: #ffcc66;
  box-shadow: 0 0 8px rgba(255, 204, 102, 0.8);
}
.fps-card.low-fps .fps-value strong {
  color: #ffcc66;
  text-shadow: 0 0 10px rgba(255, 204, 102, 0.45);
}
</style>
