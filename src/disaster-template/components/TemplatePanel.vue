<script setup lang="ts">
defineProps<{
  title: string;
  subtitle: string;
  side: 'left' | 'right';
}>();
</script>

<template>
  <aside class="panel-container" :class="side">
    <div class="panel-header">
      <h3 class="panel-title">{{ title }}</h3>
      <div class="header-decoration"></div>
    </div>

    <div class="panel-content">
      <p v-if="subtitle" class="panel-subtitle">{{ subtitle }}</p>

      <slot>
        <div class="placeholder-card">
          <span class="placeholder-tag">TEMPLATE</span>
          <h4>预留模块区域</h4>
          <p>后续可在这里替换为具体子系统的工具栏、计算面板、图层控制或结果展示组件。</p>
        </div>

        <div class="placeholder-grid">
          <div class="grid-item">
            <span class="grid-label">模块 A</span>
            <span class="grid-value">待接入</span>
          </div>
          <div class="grid-item">
            <span class="grid-label">模块 B</span>
            <span class="grid-value">待接入</span>
          </div>
          <div class="grid-item">
            <span class="grid-label">模块 C</span>
            <span class="grid-value">待接入</span>
          </div>
          <div class="grid-item">
            <span class="grid-label">模块 D</span>
            <span class="grid-value">待接入</span>
          </div>
        </div>
      </slot>
    </div>
  </aside>
</template>

<style scoped>
.panel-container {
  position: absolute;
  top: 90px;
  width: 320px;
  max-height: calc(100vh - 102px - var(--system-bottom-safe-space, 90px));
  background: var(--sys-glass-bg);
  /* backdrop-filter: blur(10px); 去除高斯模糊以解决渲染卡顿 */
  border: 1px solid var(--sys-border-color);
  box-shadow: inset 0 0 20px var(--sys-border-color-light), 0 8px 32px rgba(0, 0, 0, 0.5);
  border-radius: 8px;
  color: #fff;
  display: flex;
  flex-direction: column;
  z-index: 900;
}

.panel-container.left {
  left: 20px;
}

.panel-container.right {
  right: 20px;
}

.panel-header {
  position: relative;
  padding: 12px 15px;
  background: linear-gradient(90deg, var(--sys-bg-glow) 0%, transparent 100%);
  border-bottom: 1px solid var(--sys-border-color);
  overflow: hidden;
}

.panel-title {
  margin: 0;
  color: var(--sys-theme-color);
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 1px;
  text-shadow: var(--sys-text-glow);
}

.header-decoration {
  display: none;
}

.panel-content {
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  overflow-y: auto;
}

.panel-subtitle {
  margin: 0;
  color: #a0c4e0;
  font-size: 13px;
  line-height: 1.7;
}

.placeholder-card {
  padding: 14px;
  border: 1px solid var(--sys-border-color-light);
  border-radius: 8px;
  background: linear-gradient(180deg, rgba(0, 229, 255, 0.08), rgba(255, 255, 255, 0.02));
}

.placeholder-card h4 {
  margin: 10px 0 8px;
  font-size: 15px;
  color: #fff;
}

.placeholder-card p {
  margin: 0;
  font-size: 13px;
  line-height: 1.7;
  color: #b8d5ea;
}

.placeholder-tag {
  display: inline-flex;
  align-items: center;
  height: 24px;
  padding: 0 10px;
  border-radius: 999px;
  background: rgba(0, 229, 255, 0.14);
  border: 1px solid var(--sys-border-color);
  color: var(--sys-theme-color);
  font-size: 11px;
  letter-spacing: 1px;
}

.placeholder-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.grid-item {
  padding: 12px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--sys-border-color-light);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.grid-label {
  color: #89a8bf;
  font-size: 12px;
}

.grid-value {
  color: #fff;
  font-size: 14px;
  font-weight: 600;
}

::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

::-webkit-scrollbar-track {
  background: rgba(0, 0, 0, 0.2);
}

::-webkit-scrollbar-thumb {
  background: var(--sys-border-color);
  border-radius: 3px;
}

::-webkit-scrollbar-thumb:hover {
  background: var(--sys-theme-color);
}

@media (max-width: 1180px) {
  .panel-container {
    width: 220px;
  }
}

@media (max-width: 980px) {
  .panel-container {
    top: auto;
    bottom: var(--system-bottom-safe-space, 90px);
    max-height: 42vh;
  }

  .panel-container.left {
    left: 12px;
  }

  .panel-container.right {
    right: 12px;
  }
}

@media (max-width: 760px) {
  .panel-container {
    width: calc(50vw - 18px);
  }

  .placeholder-grid {
    grid-template-columns: 1fr;
  }
}
</style>
