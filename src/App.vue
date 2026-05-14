<script setup lang="ts">
import { ref } from 'vue';
import { EllipsoidTerrainProvider, createWorldTerrainAsync } from 'cesium';

import CesiumViewer from './components/CesiumViewer.vue';
import DataProcessingPanel from './components/DataProcessingPanel.vue';
import FloodAreaCalculator from './components/FloodAreaCalculator.vue';

import LoadingScreen from './disaster-template/components/LoadingScreen.vue';
import TopBar from './disaster-template/components/TopBar.vue';
import LogoOverlay from './disaster-template/components/LogoOverlay.vue';
// 加回模板右侧的科技感面板
import TemplatePanel from './disaster-template/components/TemplatePanel.vue';

const cesiumViewerRef = ref<any>(null); // 新增 Ref
const viewer = ref<any>(null);
const terrainEnabled = ref(true);
const terrainSwitching = ref(false);

const isMapReady = ref(false);
const showUI = ref(false);
const showV0226CPanels = ref(false); // 新增：控制原V0226C面板的显示
const systemTitle = '洪水动态模拟与三维可视化系统';

// ----------------- TopBar 面板控制 -----------------
const panelVisible = ref(false);
const panelTitle = ref('');
const panelSubtitle = ref('');
const activePanelId = ref<string>('');

const panelContents: Record<string, string> = {
  intro: '系统介绍与项目背景',
  simulation: '仿真参数与运行控制',
  analysis: '灾情统计与分析视图',
  demo: '案例演示与回放',
  monitor: '实时数据监测与告警',
  basic: '基础能力与通用工具',
  help: '使用说明与常见问题'
};

let hideTimeout: number | undefined;

const openPanel = (payload: { id: string; title: string }) => {
  clearTimeout(hideTimeout);
  
  // 如果再次点击当前的模块，就收起它
  if (activePanelId.value === payload.id && panelVisible.value) {
    panelVisible.value = false;
    // 延迟销毁，防止由于 DOM 突然变化引起的“闪现默认占位框”现象
    hideTimeout = window.setTimeout(() => {
      showV0226CPanels.value = false;
      activePanelId.value = '';
    }, 400); // 对应 leave 动画的 0.4s
    return;
  }

  activePanelId.value = payload.id;
  panelTitle.value = payload.title;
  panelSubtitle.value = panelContents[payload.id] ?? '';
  
  if (payload.id === 'simulation') {
    showV0226CPanels.value = true;
    panelVisible.value = true;
  } else {
    // 切换到其它面板时也稍微延迟销毁复杂的组件
    hideTimeout = window.setTimeout(() => {
      showV0226CPanels.value = false;
    }, 100);
    panelVisible.value = true;
  }
};
// ----------------------------------------------------

const onViewerReady = (readyViewer: any) => {
  viewer.value = readyViewer;
  isMapReady.value = true;
};

const toggleTerrain = async () => {
  if (!viewer.value || terrainSwitching.value) return;
  terrainSwitching.value = true;
  try {
    if (terrainEnabled.value) {
      viewer.value.terrainProvider = new EllipsoidTerrainProvider();
      terrainEnabled.value = false;
      return;
    }
    const worldTerrain = await createWorldTerrainAsync();
    viewer.value.terrainProvider = worldTerrain;
    terrainEnabled.value = true;
  } catch (error) {
    console.error('切换地形失败:', error);
  } finally {
    terrainSwitching.value = false;
  }
};

const isSimulating = ref(false);
const onStartSimulation = () => { isSimulating.value = true; };
const onMenuSelect = (_id: string) => {};

// ----------------- FlyTo与UI进场控制 -----------------
const onLoadingComplete = () => { 
  if (cesiumViewerRef.value) {
    cesiumViewerRef.value.executeFlyTo(); 
  } else {
    showUI.value = true;
  }
};
const onFlyComplete = () => { showUI.value = true; };
</script>

<template>
  <div class="main-container">
    <LoadingScreen :is-ready="isMapReady" :system-title="systemTitle" @loading-complete="onLoadingComplete" />
    
    <transition name="fade-top">
      <TopBar v-show="showUI" :system-title="systemTitle" active-subsystem="flood" @open-panel="openPanel" />
    </transition>
    
    <CesiumViewer ref="cesiumViewerRef" @viewer-ready="onViewerReady" @fly-complete="onFlyComplete" />
    
    <transition name="fade-bottom">
      <button v-show="showUI" class="terrain-toggle-btn" :disabled="!viewer || terrainSwitching" @click="toggleTerrain">
        {{ terrainSwitching ? '切换中...' : (terrainEnabled ? '关闭地形' : '打开地形') }}
      </button>
    </transition>

    <!-- 只保留洪水结果小窗口 -->
    <transition name="fade-left">
      <div v-show="showUI && showV0226CPanels" class="v0226c-panels">
        <FloodAreaCalculator />
      </div>
    </transition>

    <!-- 2. 灾害模板右侧的高级展示面板 (与TopBar联动) -->
    <transition name="fade-right">
      <TemplatePanel
        v-show="showUI && panelVisible"
        side="right"
        :title="panelTitle"
        :subtitle="panelSubtitle"
      >
        <template v-if="showV0226CPanels">
          <DataProcessingPanel :viewer="viewer" :is-simulating="isSimulating" @start-simulation="onStartSimulation" @menu-select="onMenuSelect" />
        </template>
      </TemplatePanel>
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
* { box-sizing: border-box; }
html, body, #app { width: 100%; height: 100%; margin: 0; }
body { overflow: hidden; font-family: "Microsoft YaHei", "Segoe UI", sans-serif; background: #000; }
.main-container { width: 100vw; height: 100vh; overflow: hidden; position: relative; background: radial-gradient(circle at 50% 20%, rgba(0, 229, 255, 0.08), transparent 30%), linear-gradient(180deg, #04070f 0%, #000 100%); }

.terrain-toggle-btn {
  position: absolute;
  bottom: 20px;
  left: 20px;
  z-index: 1001;
  padding: 8px 12px;
  border: 1px solid var(--sys-border-color);
  border-radius: 6px;
  background-color: var(--sys-glass-bg);
  color: #fff;
  cursor: pointer;
  box-shadow: inset 0 0 10px var(--sys-border-color-light);
  transition: all 0.3s ease;
}
.terrain-toggle-btn:hover { background-color: rgba(0, 229, 255, 0.2); }
.terrain-toggle-btn:disabled { opacity: 0.7; cursor: not-allowed; }

.v0226c-panels { position: absolute; inset: 0; pointer-events: none; z-index: 100; }
.v0226c-panels > * { pointer-events: auto; }

.fade-top-enter-active { transition: all 1s cubic-bezier(0.4, 0, 0.2, 1); }
.fade-top-leave-active { transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1); }
.fade-top-enter-from, .fade-top-leave-to { opacity: 0; transform: translateY(-50px); }

.fade-left-enter-active { transition: all 1s cubic-bezier(0.4, 0, 0.2, 1) 0.3s; }
.fade-left-leave-active { transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1); }
.fade-left-enter-from, .fade-left-leave-to { opacity: 0; transform: translateX(-50px); }

.fade-right-enter-active { transition: all 1s cubic-bezier(0.4, 0, 0.2, 1) 0.6s; }
.fade-right-leave-active { transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1); }
.fade-right-enter-from, .fade-right-leave-to { opacity: 0; transform: translateX(50px); }

.fade-bottom-enter-active { transition: all 1s cubic-bezier(0.4, 0, 0.2, 1) 0.9s; }
.fade-bottom-leave-active { transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1); }
.fade-bottom-enter-from, .fade-bottom-leave-to { opacity: 0; transform: translateY(50px); }
</style>
