<script setup lang="ts">
import { computed, ref } from 'vue';
import { EllipsoidTerrainProvider, createWorldTerrainAsync } from 'cesium';

import CesiumViewer from './components/CesiumViewer.vue';
import BasicFunctionsPanel from './components/BasicFunctionsPanel.vue';
import DataProcessingPanel from './components/DataProcessingPanel.vue';
import FloodAnalysisPanel from './components/FloodAnalysisPanel.vue';
import FloodAreaFloatingPanel from './components/FloodAreaFloatingPanel.vue';
import FloodLoader from './components/FloodLoader.vue';
import MonitoringPanel from './components/MonitoringPanel.vue';
import ProjectIntroPanel from './components/ProjectIntroPanel.vue';
import RainstormEffect from './components/RainstormEffect.vue';
import RiverRunoffEffect from './components/RiverRunoffEffect.vue';
import type { RoamUiState } from './types/roam';
import { createInitialRoamState } from './types/roam';
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
const roamState = ref<RoamUiState>(createInitialRoamState());
const cursorCoordinates = ref({
  lon: '0.000000',
  lat: '0.000000',
  height: '0.00'
});
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

const panelContents: Record<string, string> = {
  intro: '',
  simulation: '仿真参数与运行控制',
  analysis: '灾情统计与分析视图',
  demo: '案例演示与回放',
  monitor: '实时数据监测与告警'
};

let hideTimeout: number | undefined;

const isStandalonePanelId = (id: string) => id === 'demo';
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
  panelTitle.value = payload.id === 'intro' ? '项目简介' : payload.title;
  panelSubtitle.value = panelContents[payload.id] ?? '';
  
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

const onCoordinatesChange = (coordinates: { lon: string; lat: string; height: string }) => {
  cursorCoordinates.value = coordinates;
};

const onRoamStateChange = (state: RoamUiState) => {
  roamState.value = state;
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
    
    <CesiumViewer
      ref="cesiumViewerRef"
      @viewer-ready="onViewerReady"
      @fly-complete="onFlyComplete"
      @terrain-error="handleTerrainError"
      @coordinates-change="onCoordinatesChange"
      @roam-state-change="onRoamStateChange"
    />
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
      <footer v-show="showUI" class="bottom-overlay" aria-label="地图快捷工具栏">
        <div class="bottom-tools-zone">
          <label
            class="terrain-switch"
            :class="{ active: terrainEnabled, disabled: !viewer || terrainSwitching }"
            title="地形层"
            @click.stop
          >
            <span class="terrain-meta">
              <span class="terrain-status-dot" aria-hidden="true"></span>
              <span class="switch-text">{{ terrainSwitching ? '切换中' : '地形' }}</span>
            </span>
            <input
              type="checkbox"
              :checked="terrainEnabled"
              :disabled="!viewer || terrainSwitching"
              @change="toggleTerrain"
            />
            <span class="slider"></span>
          </label>
          <span class="bottom-divider" aria-hidden="true"></span>
          <BasicFunctionsPanel :cesium-viewer-ref="cesiumViewerRef" :roam-state="roamState" />
        </div>

        <div class="bottom-coordinate-zone" aria-label="当前鼠标坐标" aria-live="polite">
          <div class="coordinate-item coordinate-elevation">
            <span class="coordinate-label">海拔</span>
            <span class="coordinate-reading">
              <span class="coordinate-value">{{ cursorCoordinates.height }}</span>
              <span class="coordinate-unit">m</span>
            </span>
          </div>
          <span class="coordinate-divider" aria-hidden="true"></span>
          <div class="coordinate-item">
            <span class="coordinate-label">经度</span>
            <span class="coordinate-reading">
              <span class="coordinate-value">{{ cursorCoordinates.lon }}</span>
            </span>
          </div>
          <span class="coordinate-divider" aria-hidden="true"></span>
          <div class="coordinate-item">
            <span class="coordinate-label">纬度</span>
            <span class="coordinate-reading">
              <span class="coordinate-value">{{ cursorCoordinates.lat }}</span>
            </span>
          </div>
        </div>

        <div class="bottom-brand-zone">
          <LogoOverlay embedded />
        </div>
      </footer>
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
        v-if="showUI && panelVisible && !isStandalonePanelActive && activePanelId !== 'simulation' && activePanelId !== 'analysis' && activePanelId !== 'monitor'"
        :class="{
          'module-panel-right': activePanelId === 'intro',
          'module-panel-left': activePanelId !== 'intro',
          'info-panel-shell': activePanelId === 'intro'
        }"
        :side="activePanelId === 'intro' ? 'right' : 'left'"
        :title="panelTitle"
        :subtitle="panelSubtitle"
      >
        <ProjectIntroPanel v-if="activePanelId === 'intro'" />
      </TemplatePanel>
    </transition>

    <transition name="instant-panel">
      <FloodAnalysisPanel
        v-if="showUI && panelVisible && activePanelId === 'analysis'"
        :viewer="viewer"
      />
    </transition>

    <transition name="instant-panel">
      <MonitoringPanel
        v-if="showUI && panelVisible && activePanelId === 'monitor'"
        :viewer="viewer"
      />
    </transition>

    <!-- 独立的案例演示大面板 -->
    <transition name="fade-left">
      <div v-if="showUI && panelVisible && activePanelId === 'demo'" class="gallery-overlay module-panel-left">
        <DisasterGallery @showcase="onShowcase" />
      </div>
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
  --system-bottom-bar-height: 44px;
  --system-bottom-bar-gap: 0px;
  --system-bottom-safe-space: calc(var(--system-bottom-bar-height) + 10px);
}
* { box-sizing: border-box; }
html, body, #app { width: 100%; height: 100%; margin: 0; }
body { overflow: hidden; font-family: "Microsoft YaHei", "Segoe UI", sans-serif; background: #000; }
.main-container { width: 100vw; height: 100vh; overflow: hidden; position: relative; background: radial-gradient(circle at 50% 20%, rgba(0, 229, 255, 0.08), transparent 30%), linear-gradient(180deg, #04070f 0%, #000 100%); }

.bottom-overlay {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: var(--system-bottom-bar-height);
  display: grid;
  grid-template-columns: minmax(350px, 1fr) minmax(360px, 0.9fr) minmax(250px, 1fr);
  align-items: center;
  gap: 18px;
  padding: 0 18px;
  border: 0;
  border-top: 1px solid rgba(0, 229, 255, 0.36);
  border-radius: 0;
  color: #fff;
  background:
    linear-gradient(90deg, rgba(0, 229, 255, 0.09), transparent 32%, rgba(0, 229, 255, 0.05)),
    rgba(6, 20, 32, 0.86);
  box-shadow:
    0 -10px 28px rgba(0, 0, 0, 0.34),
    inset 0 1px 0 rgba(255, 255, 255, 0.035);
  backdrop-filter: blur(12px) saturate(1.08);
  z-index: 10040;
  pointer-events: none;
  overflow: visible;
  isolation: isolate;
}

.bottom-overlay::before {
  content: '';
  position: absolute;
  top: -1px;
  left: 0;
  right: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(0, 229, 255, 0.64) 18%, rgba(0, 229, 255, 0.22) 70%, transparent);
  pointer-events: none;
}

.bottom-overlay::after {
  content: '';
  position: absolute;
  left: 50%;
  bottom: 0;
  width: 42%;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(0, 229, 255, 0.38), transparent);
  transform: translateX(-50%);
  pointer-events: none;
}

.bottom-tools-zone {
  position: relative;
  display: flex;
  min-width: 0;
  height: 100%;
  align-items: center;
  justify-self: start;
  gap: 9px;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  pointer-events: auto;
}

.bottom-tools-zone::before {
  display: none;
}

.bottom-divider {
  flex: 0 0 1px;
  width: 1px;
  height: 24px;
  background: linear-gradient(to bottom, transparent, rgba(0, 229, 255, 0.24), transparent);
}

.terrain-switch {
  position: relative;
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 9px;
  height: 100%;
  padding: 0 2px;
  border: 0;
  border-radius: 0;
  background: transparent;
  cursor: pointer;
  transition: opacity 0.18s ease, color 0.18s ease;
}

.terrain-switch:hover,
.terrain-switch.active {
  background: transparent;
  box-shadow: none;
}

.terrain-switch:hover .switch-text,
.terrain-switch.active .switch-text {
  color: #dffbff;
  text-shadow: var(--sys-text-glow);
}

.terrain-switch.disabled {
  cursor: not-allowed;
  opacity: 0.62;
}

.terrain-meta {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.terrain-status-dot {
  width: 6px;
  height: 6px;
  flex: 0 0 6px;
  border-radius: 50%;
  background: #738899;
  box-shadow: 0 0 0 3px rgba(115, 136, 153, 0.08);
  transition: background-color 0.18s ease, box-shadow 0.18s ease;
}

.terrain-switch.active .terrain-status-dot {
  background: var(--sys-theme-color);
  box-shadow: 0 0 8px rgba(0, 229, 255, 0.56);
}

.terrain-switch input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

.slider {
  position: relative;
  width: 34px;
  height: 18px;
  flex: 0 0 34px;
  border: 1px solid rgba(160, 196, 224, 0.22);
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.08);
  transition: background-color 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
  box-shadow: inset 0 1px 4px rgba(0, 0, 0, 0.32);
}

.slider::before {
  position: absolute;
  content: "";
  height: 12px;
  width: 12px;
  left: 2px;
  top: 2px;
  border-radius: 50%;
  background: #d8e7ef;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.34);
  transition: transform 0.18s ease, background-color 0.18s ease;
}

.terrain-switch input:checked + .slider {
  border-color: rgba(0, 229, 255, 0.68);
  background: rgba(0, 179, 204, 0.72);
  box-shadow: 0 0 10px rgba(0, 229, 255, 0.22), inset 0 1px 4px rgba(0, 0, 0, 0.22);
}

.terrain-switch input:checked + .slider::before {
  transform: translateX(16px);
  background: #ffffff;
}

.terrain-switch input:focus-visible + .slider {
  outline: 2px solid #7de9f7;
  outline-offset: 2px;
}

.switch-text {
  color: #b8d5ea;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.03em;
  white-space: nowrap;
  user-select: none;
}

.bottom-coordinate-zone {
  position: relative;
  display: grid;
  grid-template-columns: minmax(76px, 0.72fr) 1px minmax(112px, 1fr) 1px minmax(112px, 1fr);
  align-items: center;
  justify-self: center;
  height: 100%;
  width: min(100%, 430px);
  min-width: 350px;
  gap: 10px;
  padding: 0 10px;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  white-space: nowrap;
  pointer-events: none;
}

.bottom-coordinate-zone::before {
  display: none;
}

.coordinate-item {
  display: flex;
  min-width: 0;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
}

.coordinate-label {
  color: #89a8bf;
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.08em;
}

.coordinate-reading {
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: 4px;
}

.coordinate-value {
  min-width: 0;
  color: #dffbff;
  font-family: "Cascadia Mono", "SFMono-Regular", "Courier New", monospace;
  font-size: 12px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0;
  text-align: left;
  text-shadow: var(--sys-text-glow);
}

.coordinate-elevation .coordinate-label {
  color: rgba(111, 226, 190, 0.82);
}

.coordinate-elevation .coordinate-value {
  color: #9feac9;
  text-shadow: 0 0 8px rgba(93, 227, 179, 0.32);
}

.coordinate-unit {
  color: #89a8bf;
  font-size: 9px;
  font-weight: 600;
}

.coordinate-divider {
  width: 1px;
  height: 23px;
  background: linear-gradient(to bottom, transparent, rgba(0, 229, 255, 0.18), transparent);
}

.bottom-brand-zone {
  position: relative;
  display: flex;
  min-width: 0;
  height: 100%;
  align-items: center;
  justify-content: flex-end;
  justify-self: end;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  pointer-events: none;
}

.bottom-brand-zone::before {
  display: none;
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
  width: 960px !important;
  max-width: calc(100vw - 40px) !important;
  max-height: calc(100vh - 92px - var(--system-bottom-safe-space, 74px)) !important;
  background: rgba(4, 15, 24, 0.94) !important;
  overflow: hidden;
}

.info-panel-shell .panel-content {
  min-height: 0;
  padding: 14px;
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

.side-float-left-enter-active { transition: all 1s cubic-bezier(0.4, 0, 0.2, 1) 0.3s !important; }
.side-float-left-leave-active { transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1) !important; }
.side-float-left-enter-from, .side-float-left-leave-to { opacity: 0; transform: translateX(-50px); }

.side-float-right-enter-active { transition: all 1s cubic-bezier(0.4, 0, 0.2, 1) 0.6s !important; }
.side-float-right-leave-active { transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1) !important; }
.side-float-right-enter-from, .side-float-right-leave-to { opacity: 0; transform: translateX(50px); }

.instant-panel-enter-active,
.instant-panel-leave-active {
  transition: none !important;
}

.fade-bottom-enter-active { transition: all 1s cubic-bezier(0.4, 0, 0.2, 1) 0.9s; }
.fade-bottom-leave-active { transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1); }
.fade-bottom-enter-from, .fade-bottom-leave-to { opacity: 0; transform: translateY(50px); }

@media (max-width: 1180px) {
  .bottom-overlay {
    grid-template-columns: minmax(330px, 1fr) minmax(320px, 0.86fr) minmax(200px, 0.8fr);
    gap: 12px;
    padding: 0 14px;
  }

  .bottom-tools-zone {
    gap: 6px;
  }

  .bottom-coordinate-zone {
    min-width: 320px;
    padding: 0 8px;
    gap: 8px;
  }

  .bottom-brand-zone {
    padding-left: 0;
  }
}

@media (max-width: 900px) {
  :root {
    --system-bottom-bar-height: 78px;
    --system-bottom-bar-gap: 0px;
  }

  .bottom-overlay {
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-rows: 38px 38px;
    grid-template-areas:
      "tools brand"
      "coordinates coordinates";
    gap: 0 10px;
    padding: 0 10px;
  }

  .bottom-tools-zone {
    grid-area: tools;
    height: 38px;
    min-width: 0;
  }

  .bottom-coordinate-zone {
    grid-area: coordinates;
    width: 100%;
    min-width: 0;
    height: 38px;
    padding: 0;
  }

  .bottom-brand-zone {
    grid-area: brand;
    height: 38px;
  }
}

@media (max-width: 560px) {
  .info-panel-shell {
    right: 8px !important;
    width: calc(100vw - 64px) !important;
    max-width: none !important;
  }

  :root {
    --system-bottom-bar-height: 80px;
    --system-bottom-bar-gap: 0px;
  }

  .bottom-overlay {
    right: 0;
    left: 0;
    gap: 0 6px;
    padding-right: 8px;
    padding-left: 8px;
  }

  .bottom-tools-zone {
    gap: 4px;
  }

  .bottom-divider {
    height: 22px;
  }

  .terrain-switch {
    gap: 6px;
  }

  .switch-text {
    display: none;
  }

  .bottom-coordinate-zone {
    grid-template-columns: minmax(68px, 0.75fr) 1px minmax(90px, 1fr) 1px minmax(90px, 1fr);
    gap: 6px;
  }

  .coordinate-value {
    font-size: 10px;
  }

  .coordinate-label,
  .coordinate-unit {
    font-size: 8px;
  }
}

</style>
