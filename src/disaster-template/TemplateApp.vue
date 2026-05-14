<script setup lang="ts">
import { defineAsyncComponent, ref } from 'vue';

const CesiumViewer = defineAsyncComponent(() => import('./components/CesiumViewer.vue'));
const LoadingScreen = defineAsyncComponent(() => import('./components/LoadingScreen.vue'));
const LogoOverlay = defineAsyncComponent(() => import('./components/LogoOverlay.vue'));
const TopBar = defineAsyncComponent(() => import('./components/TopBar.vue'));
const TemplatePanel = defineAsyncComponent(() => import('./components/TemplatePanel.vue'));

const cesiumViewerRef = ref<any>(null);
const isMapReady = ref(false);
const showUI = ref(false);

// 右侧面板控制（由 TopBar 发射事件打开）
const panelVisible = ref(false);
const panelTitle = ref('');
const panelSubtitle = ref('');

const panelContents: Record<string, string> = {
  intro: '系统介绍与项目背景',
  simulation: '仿真参数与运行控制',
  analysis: '灾情统计与分析视图',
  demo: '案例演示与回放',
  monitor: '实时数据监测与告警'
};

const openPanel = (payload: { id: string; title: string }) => {
  panelTitle.value = payload.title;
  panelSubtitle.value = panelContents[payload.id] ?? '';
  panelVisible.value = true;
};

const systemTitle = '洪水动态模拟与三维可视化系统';
const activeSubsystem = 'flood';

const onViewerReady = (_readyViewer: any) => {
  isMapReady.value = true;
};

const onLoadingComplete = () => {
  if (cesiumViewerRef.value) {
    cesiumViewerRef.value.executeFlyTo();
  }
};

const onFlyComplete = () => {
  showUI.value = true;
};
</script>

<template>
  <div class="main-container">
    <LoadingScreen :is-ready="isMapReady" :system-title="systemTitle" @loading-complete="onLoadingComplete" />

    <transition name="fade-top">
      <TopBar v-show="showUI" :system-title="systemTitle" :active-subsystem="activeSubsystem" @open-panel="openPanel" />
    </transition>

    <CesiumViewer ref="cesiumViewerRef" @viewer-ready="onViewerReady" @fly-complete="onFlyComplete" />

    <!-- 合并左右功能区到右侧：由顶部菜单打开具体面板 -->
    <transition name="fade-right">
      <TemplatePanel
        v-show="showUI && panelVisible"
        side="right"
        :title="panelTitle"
        :subtitle="panelSubtitle"
      />
    </transition>

    <transition name="fade-bottom">
      <LogoOverlay v-show="showUI" />
    </transition>
  </div>
</template>

<style>
:root {
  --sys-theme-color: #00e5ff;
  --sys-theme-color-hover: #00b3cc;
  --sys-bg-glow: rgba(0, 229, 255, 0.15);
  --sys-bg-glow-active: rgba(0, 229, 255, 0.3);
  --sys-border-color: rgba(0, 229, 255, 0.4);
  --sys-border-color-light: rgba(0, 229, 255, 0.1);
  --sys-text-glow: 0 0 8px rgba(0, 229, 255, 0.5);
  --sys-glass-bg: rgba(13, 27, 49, 0.7);
}

* {
  box-sizing: border-box;
}

html,
body,
#app {
  width: 100%;
  height: 100%;
  margin: 0;
}

body {
  overflow: hidden;
  font-family: "Microsoft YaHei", "Segoe UI", sans-serif;
  background: #000;
}

.main-container {
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  position: relative;
  background:
    radial-gradient(circle at 50% 20%, rgba(0, 229, 255, 0.08), transparent 30%),
    linear-gradient(180deg, #04070f 0%, #000 100%);
}

.fade-top-enter-active,
.fade-top-leave-active {
  transition: all 1s cubic-bezier(0.4, 0, 0.2, 1);
}

.fade-top-enter-from,
.fade-top-leave-to {
  opacity: 0;
  transform: translate(-50%, -50px) !important;
}

.fade-left-enter-active,
.fade-left-leave-active {
  transition: all 1s cubic-bezier(0.4, 0, 0.2, 1) 0.3s;
}

.fade-left-enter-from,
.fade-left-leave-to {
  opacity: 0;
  transform: translateX(-50px);
}

.fade-right-enter-active,
.fade-right-leave-active {
  transition: all 1s cubic-bezier(0.4, 0, 0.2, 1) 0.6s;
}

.fade-right-enter-from,
.fade-right-leave-to {
  opacity: 0;
  transform: translateX(50px);
}

.fade-bottom-enter-active,
.fade-bottom-leave-active {
  transition: all 1s cubic-bezier(0.4, 0, 0.2, 1) 0.9s;
}

.fade-bottom-enter-from,
.fade-bottom-leave-to {
  opacity: 0;
  transform: translateY(50px);
}
</style>
