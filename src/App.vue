<script setup lang="ts">
import { ref } from 'vue';
import { EllipsoidTerrainProvider, createWorldTerrainAsync } from 'cesium';

import CesiumViewer from './components/CesiumViewer.vue';
import BasicFunctionsPanel from './components/BasicFunctionsPanel.vue';
import DataProcessingPanel from './components/DataProcessingPanel.vue';
import FloodAreaCalculator from './components/FloodAreaCalculator.vue';
import FloodLoader from './components/FloodLoader.vue';
import HelpPanel from './components/HelpPanel.vue';
import MonitoringPanel from './components/MonitoringPanel.vue';
import ProjectIntroPanel from './components/ProjectIntroPanel.vue';
import { lastLoadedFloodJson, floodCellSize, currentFloodPrimitive, floodPlaybackToken } from './store/floodState';

import LoadingScreen from './disaster-template/components/LoadingScreen.vue';
import TopBar from './disaster-template/components/TopBar.vue';
import LogoOverlay from './disaster-template/components/LogoOverlay.vue';
import FpsWidget from './components/FpsWidget.vue';
// 加回模板右侧的科技感面板
import TemplatePanel from './disaster-template/components/TemplatePanel.vue';
import DisasterGallery from './components/DisasterGallery.vue';

const cesiumViewerRef = ref<any>(null); // 新增 Ref
const floodLoaderRef = ref<InstanceType<typeof FloodLoader> | null>(null);
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

const toggleTerrain = async (_event?: Event) => {
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

const onMenuSelect = (_id: string) => {};

type ShowcaseCaseId = 'jinshajiang' | 'xiaojiaqiao';

const onShowcase = (caseId: ShowcaseCaseId) => {
  if (!floodLoaderRef.value) {
    console.warn('FloodLoader 尚未准备好');
    return;
  }

  panelVisible.value = false;
  floodLoaderRef.value.playShowcase(caseId);
};

const resetFloodScene = () => {
  clearTimeout(hideTimeout);
  floodPlaybackToken.value += 1;
  floodLoaderRef.value?.resetFloodData();

  if (viewer.value) {
    if (currentFloodPrimitive.value) {
      viewer.value.scene.primitives.remove(currentFloodPrimitive.value);
      currentFloodPrimitive.value = null;
    }
    viewer.value.entities.removeAll();
  }

  lastLoadedFloodJson.value = null;
  floodCellSize.value = 0;
  panelVisible.value = false;
  showV0226CPanels.value = false;
  activePanelId.value = '';
  panelTitle.value = '';
  panelSubtitle.value = '';
  showUI.value = true;

  if (cesiumViewerRef.value) {
    cesiumViewerRef.value.executeFlyTo();
  }
};

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
    <FpsWidget mode="fixed" />

    <LoadingScreen :is-ready="isMapReady" :system-title="systemTitle" @loading-complete="onLoadingComplete" />
    
    <transition name="fade-top">
      <TopBar v-show="showUI" :system-title="systemTitle" active-subsystem="flood" @open-panel="openPanel" @reset-ui="resetFloodScene" />
    </transition>
    
    <CesiumViewer ref="cesiumViewerRef" @viewer-ready="onViewerReady" @fly-complete="onFlyComplete" />
    <FloodLoader v-if="viewer" ref="floodLoaderRef" class="showcase-flood-loader" :viewer="viewer" />
    
    <transition name="fade-bottom">
      <div v-show="showUI" class="bottom-overlay">
        <div class="left-section">
          <label
            class="terrain-switch"
            :class="{ disabled: !viewer || terrainSwitching }"
            title="地形层"
            @click.stop
          >
            <input
              type="checkbox"
              :checked="terrainEnabled"
              :disabled="!viewer || terrainSwitching"
              @change="toggleTerrain"
            />
            <span class="slider"></span>
            <span class="switch-text">{{ terrainSwitching ? '切换中' : '地形层' }}</span>
          </label>
        </div>
      </div>
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
        v-show="showUI && panelVisible && activePanelId !== 'demo' && activePanelId !== 'basic'"
        :class="{
          'monitor-panel-shell': activePanelId === 'monitor',
          'info-panel-shell': activePanelId === 'intro' || activePanelId === 'help'
        }"
        side="right"
        :title="panelTitle"
        :subtitle="panelSubtitle"
      >
        <template v-if="showV0226CPanels">
          <DataProcessingPanel :viewer="viewer" @menu-select="onMenuSelect" />
        </template>
        <ProjectIntroPanel v-else-if="activePanelId === 'intro'" />
        <MonitoringPanel v-else-if="activePanelId === 'monitor'" />
        <HelpPanel v-else-if="activePanelId === 'help'" />
      </TemplatePanel>
    </transition>

    <!-- 基础功能：按迁移文档改为右侧图标工具栏 -->
    <transition name="fade-right">
      <BasicFunctionsPanel
        v-if="showUI && activePanelId === 'basic'"
        :cesium-viewer-ref="cesiumViewerRef"
      />
    </transition>

    <!-- 独立的案例演示大面板 -->
    <transition name="fade-right">
      <div v-if="showUI && panelVisible && activePanelId === 'demo'" class="gallery-overlay">
        <DisasterGallery @showcase="onShowcase" />
      </div>
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

.bottom-overlay {
  position: absolute;
  bottom: 0;
  left: 0;
  width: 100%;
  height: 40px;
  background: transparent;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 20px;
  z-index: 1001;
  pointer-events: none;
}

.left-section {
  display: flex;
  align-items: center;
  pointer-events: auto;
}

.terrain-switch {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.terrain-switch.disabled {
  cursor: not-allowed;
  opacity: 0.65;
}

.terrain-switch input {
  display: none;
}

.slider {
  position: relative;
  width: 38px;
  height: 20px;
  background-color: rgba(255, 255, 255, 0.2);
  border-radius: 20px;
  transition: 0.3s;
  box-shadow: inset 0 0 5px rgba(0, 0, 0, 0.5);
}

.slider::before {
  position: absolute;
  content: "";
  height: 14px;
  width: 14px;
  left: 3px;
  bottom: 3px;
  background-color: #fff;
  transition: 0.3s;
  border-radius: 50%;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
}

.terrain-switch input:checked + .slider {
  background-color: var(--sys-theme-color, #00e5ff);
  box-shadow: 0 0 8px rgba(0, 229, 255, 0.4);
}

.terrain-switch input:checked + .slider::before {
  transform: translateX(18px);
}

.switch-text {
  color: #8be1ff;
  font-size: 13px;
  font-weight: 500;
  user-select: none;
}

.v0226c-panels { position: absolute; inset: 0; pointer-events: none; z-index: 100; }
.v0226c-panels > * { pointer-events: auto; }

.gallery-overlay {
  position: absolute;
  top: 90px;
  right: 20px;
  width: 900px;
  max-width: calc(100vw - 40px);
  z-index: 1000;
  pointer-events: auto;
}

.showcase-flood-loader {
  position: absolute;
  left: -9999px;
  top: -9999px;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
  overflow: hidden;
}

.monitor-panel-shell {
  bottom: 140px;
  max-height: none;
  overflow: hidden;
}

.monitor-panel-shell .panel-content {
  min-height: 0;
  overflow-y: auto;
}

.info-panel-shell {
  width: 900px !important;
  max-width: calc(100vw - 40px) !important;
  max-height: calc(100vh - 150px) !important;
  overflow: hidden;
}

.info-panel-shell .panel-content {
  min-height: 0;
  overflow-y: auto;
}

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
