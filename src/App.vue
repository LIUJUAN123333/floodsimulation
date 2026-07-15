<script setup lang="ts">
import { computed, ref } from 'vue';
import { EllipsoidTerrainProvider, createWorldTerrainAsync } from 'cesium';

import CesiumViewer from './components/CesiumViewer.vue';
import BasicFunctionsPanel from './components/BasicFunctionsPanel.vue';
import DataProcessingPanel from './components/DataProcessingPanel.vue';
import FloodAnalysisPanel from './components/FloodAnalysisPanel.vue';
import FloodAreaFloatingPanel from './components/FloodAreaFloatingPanel.vue';
import FloodLoader from './components/FloodLoader.vue';
import HelpPanel from './components/HelpPanel.vue';
import MonitoringPanel from './components/MonitoringPanel.vue';
import ProjectIntroPanel from './components/ProjectIntroPanel.vue';
import RainstormEffect from './components/RainstormEffect.vue';
import RiverRunoffEffect from './components/RiverRunoffEffect.vue';
import {
  lastLoadedFloodJson,
  floodCellSize,
  currentFloodPrimitive,
  floodPlaybackToken,
  currentShowcaseCaseId,
  clearFloodDepthMonitorPoint,
  resetFloodAreaSeries
} from './store/floodState';

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
const terrainEnabled = ref(false);
const terrainSwitching = ref(false);
const rainstormEnabled = ref(false);
const runoffRainstormActive = ref(false);
const riverRunoffEnabled = ref(false);
const riverRunoffTriggersFlood = ref(false);
const riverRunoffEffectKey = ref(0);
const floodRenderEffectEnabled = computed(() => riverRunoffEnabled.value && riverRunoffTriggersFlood.value);
const effectiveRainstormEnabled = computed(() => rainstormEnabled.value || runoffRainstormActive.value);

const isMapReady = ref(false);
const showUI = ref(false);
const showV0226CPanels = ref(false); // 新增：控制原V0226C面板的显示
const simulationPanelMounted = ref(false);
const systemTitle = '洪水动态模拟与三维可视化系统';

// ----------------- TopBar 面板控制 -----------------
const panelVisible = ref(false);
const panelTitle = ref('');
const panelSubtitle = ref('');
const activePanelId = ref<string>('');

let hideTimeout: number | undefined;

const isStandalonePanelId = (id: string) => id === 'basic' || id === 'demo';
const isStandalonePanelActive = computed(() => isStandalonePanelId(activePanelId.value));
const simulationPanelActive = computed(() => (
  showUI.value &&
  panelVisible.value &&
  showV0226CPanels.value &&
  activePanelId.value === 'simulation'
));
const showSubsystemDock = computed(() => (
  showUI.value &&
  panelVisible.value &&
  activePanelId.value === 'intro'
));
const sidePanelTransitionName = computed(() => (activePanelId.value === 'intro' ? 'fade-right' : 'fade-left'));

const openPanel = (payload: { id: string; title: string }) => {
  clearTimeout(hideTimeout);
  
  // 如果再次点击当前的模块，就收起它
  if (activePanelId.value === payload.id && panelVisible.value) {
    panelVisible.value = false;
    showV0226CPanels.value = false;
    // 延迟清空当前模块，让离场动画能自然结束
    hideTimeout = window.setTimeout(() => {
      activePanelId.value = '';
    }, 400); // 对应 leave 动画的 0.4s
    return;
  }

  activePanelId.value = payload.id;
  panelTitle.value = payload.title;
  panelSubtitle.value = '';
  
  if (payload.id === 'simulation') {
    simulationPanelMounted.value = true;
    showV0226CPanels.value = true;
    panelVisible.value = true;
  } else if (isStandalonePanelId(payload.id)) {
    showV0226CPanels.value = false;
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
  void toggleTerrain();
};

const SAFE_TERRAIN_MAX_LEVEL = 13;

const guardTerrainAvailability = (terrainProvider: any) => {
  const availability = terrainProvider?.availability;
  const computeMaximumLevelAtPosition = availability?.computeMaximumLevelAtPosition;
  if (typeof computeMaximumLevelAtPosition === 'function') {
    const originalComputeMaximumLevel = computeMaximumLevelAtPosition.bind(availability);
    let hasWarnedAboutAvailability = false;
    availability.computeMaximumLevelAtPosition = (position: any) => {
      try {
        return originalComputeMaximumLevel(position);
      } catch (error) {
        if (!hasWarnedAboutAvailability) {
          console.warn('地形可用层级数据异常，已使用安全层级继续加载。', error);
          hasWarnedAboutAvailability = true;
        }
        return SAFE_TERRAIN_MAX_LEVEL;
      }
    };
  }

  const getTileDataAvailable = terrainProvider?.getTileDataAvailable;
  if (typeof getTileDataAvailable !== 'function') {
    return terrainProvider;
  }

  const originalGetTileDataAvailable = getTileDataAvailable.bind(terrainProvider);
  let hasWarned = false;
  terrainProvider.getTileDataAvailable = (x: number, y: number, level: number) => {
    if (level > SAFE_TERRAIN_MAX_LEVEL) {
      return false;
    }
    try {
      return originalGetTileDataAvailable(x, y, level);
    } catch (error) {
      if (!hasWarned) {
        console.warn('地形瓦片可用性数据异常，已按不可用处理。', error);
        hasWarned = true;
      }
      return false;
    }
  };

  return terrainProvider;
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
    const worldTerrain = guardTerrainAvailability(await createWorldTerrainAsync());
    viewer.value.terrainProvider = worldTerrain;
    viewer.value.useDefaultRenderLoop = true;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    terrainEnabled.value = true;
  } catch (error) {
    console.error('切换地形失败:', error);
    if (viewer.value) {
      viewer.value.terrainProvider = new EllipsoidTerrainProvider();
      viewer.value.useDefaultRenderLoop = true;
    }
    terrainEnabled.value = false;
  } finally {
    terrainSwitching.value = false;
  }
};

const handleTerrainError = (error: unknown) => {
  console.error('地形渲染异常，已回退到椭球地形:', error);
  if (viewer.value) {
    viewer.value.terrainProvider = new EllipsoidTerrainProvider();
    viewer.value.useDefaultRenderLoop = true;
  }
  terrainEnabled.value = false;
};

const onMenuSelect = (_id: string) => {};

const toggleRainstorm = () => {
  rainstormEnabled.value = !rainstormEnabled.value;
};

const toggleRiverRunoff = () => {
  if (riverRunoffEnabled.value && !riverRunoffTriggersFlood.value) {
    riverRunoffEnabled.value = false;
    return;
  }
  riverRunoffTriggersFlood.value = false;
  riverRunoffEnabled.value = true;
  riverRunoffEffectKey.value += 1;
};

const toggleFloodRenderEffect = () => {
  if (riverRunoffEnabled.value && riverRunoffTriggersFlood.value) {
    riverRunoffEnabled.value = false;
    riverRunoffTriggersFlood.value = false;
    return;
  }
  riverRunoffTriggersFlood.value = true;
  riverRunoffEnabled.value = true;
  riverRunoffEffectKey.value += 1;
};

const onRiverRunoffComplete = () => {
  if (!riverRunoffEnabled.value || !riverRunoffTriggersFlood.value || !floodLoaderRef.value) {
    return;
  }
  panelVisible.value = false;
  currentShowcaseCaseId.value = 'xiaojiaqiao';
  floodLoaderRef.value.playShowcase('xiaojiaqiao');
};

const onRiverRunoffRainstormChange = (active: boolean) => {
  runoffRainstormActive.value = active;
};

type GalleryShowcaseCaseId = 'yongchuan' | 'jinshajiang' | 'xiaojiaqiao';

const onShowcase = (caseId: GalleryShowcaseCaseId) => {
  if (!floodLoaderRef.value) {
    console.warn('FloodLoader 尚未准备好');
    return;
  }

  panelVisible.value = false;
  currentShowcaseCaseId.value = caseId;
  floodLoaderRef.value.playShowcase(caseId);
};

const resetFloodScene = () => {
  clearTimeout(hideTimeout);
  floodPlaybackToken.value += 1;
  currentShowcaseCaseId.value = null;
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
  resetFloodAreaSeries();
  clearFloodDepthMonitorPoint();
  panelVisible.value = false;
  showV0226CPanels.value = false;
  activePanelId.value = '';
  panelTitle.value = '';
  panelSubtitle.value = '';
  rainstormEnabled.value = false;
  runoffRainstormActive.value = false;
  riverRunoffEnabled.value = false;
  riverRunoffTriggersFlood.value = false;
  riverRunoffEffectKey.value += 1;
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
      <TopBar
        v-show="showUI"
        :system-title="systemTitle"
        active-subsystem="flood"
        :show-subsystem-dock="showSubsystemDock"
        @open-panel="openPanel"
        @reset-ui="resetFloodScene"
      />
    </transition>
    
    <CesiumViewer ref="cesiumViewerRef" @viewer-ready="onViewerReady" @fly-complete="onFlyComplete" @terrain-error="handleTerrainError" />
    <FloodLoader v-if="viewer" ref="floodLoaderRef" class="showcase-flood-loader" :viewer="viewer" />
    <FloodAreaFloatingPanel v-if="showUI" />
    <RainstormEffect v-if="viewer" :viewer="viewer" :active="effectiveRainstormEnabled" />
    <RiverRunoffEffect
      v-if="viewer"
      :key="riverRunoffEffectKey"
      :viewer="viewer"
      :active="riverRunoffEnabled"
      @runoff-complete="onRiverRunoffComplete"
      @rainstorm-change="onRiverRunoffRainstormChange"
    />

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

    <!-- 2. 灾害模板侧边高级展示面板 (与TopBar联动) -->
    <transition name="fade-left">
      <TemplatePanel
        v-if="simulationPanelMounted"
        v-show="simulationPanelActive"
        class="module-panel-left"
        side="left"
        :title="panelTitle"
        :subtitle="panelSubtitle"
      >
        <DataProcessingPanel
          :viewer="viewer"
          :terrain-enabled="terrainEnabled"
          :panel-active="simulationPanelActive"
          :rainstorm-enabled="effectiveRainstormEnabled"
          :river-runoff-enabled="riverRunoffEnabled"
          :flood-render-enabled="floodRenderEffectEnabled"
          @menu-select="onMenuSelect"
          @toggle-rainstorm="toggleRainstorm"
          @toggle-river-runoff="toggleRiverRunoff"
          @toggle-flood-render="toggleFloodRenderEffect"
        />
      </TemplatePanel>
    </transition>

    <transition :name="sidePanelTransitionName">
      <TemplatePanel
        v-if="showUI && panelVisible && !isStandalonePanelActive && activePanelId !== 'simulation'"
        :class="{
          'module-panel-right': activePanelId === 'intro',
          'module-panel-left': activePanelId !== 'intro',
          'monitor-panel-shell': activePanelId === 'monitor',
          'info-panel-shell': activePanelId === 'intro' || activePanelId === 'help'
        }"
        :side="activePanelId === 'intro' ? 'right' : 'left'"
        :title="panelTitle"
        :subtitle="panelSubtitle"
      >
        <FloodAnalysisPanel v-if="activePanelId === 'analysis'" :viewer="viewer" />
        <ProjectIntroPanel v-else-if="activePanelId === 'intro'" />
        <MonitoringPanel v-else-if="activePanelId === 'monitor'" :viewer="viewer" />
        <HelpPanel v-else-if="activePanelId === 'help'" />
      </TemplatePanel>
    </transition>

    <!-- 基础功能：左侧图标工具栏 -->
    <transition name="basic-tools">
      <BasicFunctionsPanel
        v-if="showUI && panelVisible && activePanelId === 'basic'"
        :cesium-viewer-ref="cesiumViewerRef"
      />
    </transition>

    <!-- 独立的案例演示大面板 -->
    <transition name="fade-left">
      <div v-if="showUI && panelVisible && activePanelId === 'demo'" class="gallery-overlay module-panel-left">
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

.module-panel-left {
  left: 20px !important;
  right: auto !important;
}

.module-panel-right {
  left: auto !important;
  right: 20px !important;
}

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

.instant-panel-enter-active,
.instant-panel-leave-active {
  transition: none !important;
}

.basic-tools-enter-active,
.basic-tools-leave-active {
  transition: all 0.18s ease;
}
.basic-tools-enter-from,
.basic-tools-leave-to {
  opacity: 0;
  transform: translateX(-18px);
}

.fade-bottom-enter-active { transition: all 1s cubic-bezier(0.4, 0, 0.2, 1) 0.9s; }
.fade-bottom-leave-active { transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1); }
.fade-bottom-enter-from, .fade-bottom-leave-to { opacity: 0; transform: translateY(50px); }

</style>
