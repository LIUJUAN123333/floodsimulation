<script setup lang="ts">
import { ref } from 'vue';

const props = defineProps<{
  cesiumViewerRef?: any;
}>();

const activeBasicFlyout = ref<'fly' | 'measure' | 'roam' | null>(null);
const flyLon = ref('102.08');
const flyLat = ref('29.59');
const flyHeight = ref('20000');
const roamSpeed = ref('80');
const roamHeight = ref('120');
const basicStatus = ref('选择一个基础工具后，可直接在三维视图中交互。');
const roamPaused = ref(false);

type MeasureMode = 'distance' | 'height' | 'area';

const toggleBasicFlyout = (panel: 'fly' | 'measure' | 'roam') => {
  activeBasicFlyout.value = activeBasicFlyout.value === panel ? null : panel;
};

const runViewerTool = async (action: string, successText: string) => {
  const tool = props.cesiumViewerRef?.[action];
  if (!tool) {
    basicStatus.value = '地图工具尚未准备好。';
    return;
  }
  activeBasicFlyout.value = null;
  await tool();
  basicStatus.value = successText;
};

const handleFlyHome = () => runViewerTool('flyToHome', '已返回初始视角。');
const handleFullScreen = () => runViewerTool('fullScreen', '已切换全屏显示。');
const handleCaptureScreen = () => runViewerTool('captureScreen', '已导出当前视图截图。');

const handleFlyToPosition = () => {
  const lon = Number(flyLon.value);
  const lat = Number(flyLat.value);
  const height = Number(flyHeight.value);
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || !Number.isFinite(height) || lon < -180 || lon > 180 || lat < -90 || lat > 90) {
    basicStatus.value = '请输入有效的经度、纬度和高度。';
    return;
  }
  props.cesiumViewerRef?.flyToPosition?.(lon, lat, height);
  basicStatus.value = `正在飞行至 ${lon.toFixed(4)}, ${lat.toFixed(4)}。`;
};

const handleStartMeasure = (mode: MeasureMode) => {
  props.cesiumViewerRef?.startMeasure?.(mode);
  const labels: Record<MeasureMode, string> = {
    distance: '距离量测',
    height: '高度量测',
    area: '面积量测'
  };
  basicStatus.value = `${labels[mode]}已开启：左键取点，右键结束。`;
};

const handleClearMeasurements = () => {
  props.cesiumViewerRef?.clearMeasurements?.();
  basicStatus.value = '已清除量测标绘。';
};

const handleClearView = async () => {
  activeBasicFlyout.value = null;
  await props.cesiumViewerRef?.clearView?.();
  basicStatus.value = '已清除基础工具生成的标绘和叠加图层。';
};

const handlePickRoamPath = () => {
  props.cesiumViewerRef?.startPickRoamPath?.();
  roamPaused.value = false;
  basicStatus.value = '正在拾取漫游路径：左键添加路径点，右键结束。';
};

const handleStartRoam = () => {
  const speed = Number(roamSpeed.value);
  const height = Number(roamHeight.value);
  if (!Number.isFinite(speed) || speed <= 0 || !Number.isFinite(height)) {
    basicStatus.value = '请输入有效的漫游速度和高度。';
    return;
  }
  props.cesiumViewerRef?.startRoam?.(speed, height);
  roamPaused.value = false;
  basicStatus.value = '漫游已开始。';
};

const handleToggleRoamPause = () => {
  props.cesiumViewerRef?.toggleRoamPause?.();
  roamPaused.value = !roamPaused.value;
  basicStatus.value = roamPaused.value ? '漫游已暂停。' : '漫游继续。';
};

const handleClearRoam = () => {
  props.cesiumViewerRef?.clearRoam?.();
  roamPaused.value = false;
  basicStatus.value = '已清除漫游路径。';
};
</script>

<template>
  <div class="basic-icon-dock">
    <button class="basic-icon-btn" title="HOME" aria-label="HOME" @click="handleFlyHome">
      <svg viewBox="0 0 24 24" aria-hidden><path d="M4 11L12 4L20 11V20H15V14H9V20H4V11Z" /></svg>
    </button>
    <button class="basic-icon-btn" :class="{ active: activeBasicFlyout === 'fly' }" title="定位飞行" aria-label="定位飞行" @click="toggleBasicFlyout('fly')">
      <svg viewBox="0 0 24 24" aria-hidden><path d="M12 3L15 10L22 12L15 14L12 21L9 14L2 12L9 10L12 3Z" /></svg>
    </button>
    <button class="basic-icon-btn" :class="{ active: activeBasicFlyout === 'measure' }" title="量测标绘" aria-label="量测标绘" @click="toggleBasicFlyout('measure')">
      <svg viewBox="0 0 24 24" aria-hidden><path d="M4 17L17 4L20 7L7 20H4V17ZM14 7L17 10M11 10L13 12M8 13L10 15" /></svg>
    </button>
    <button class="basic-icon-btn" :class="{ active: activeBasicFlyout === 'roam' }" title="漫游" aria-label="漫游" @click="toggleBasicFlyout('roam')">
      <svg viewBox="0 0 24 24" aria-hidden><path d="M5 18C9 18 7 6 12 6C17 6 15 18 19 18M5 18L3 16M5 18L3 20M19 18L21 16M19 18L21 20" /></svg>
    </button>
    <button class="basic-icon-btn" title="全屏" aria-label="全屏" @click="handleFullScreen">
      <svg viewBox="0 0 24 24" aria-hidden><path d="M4 9V4H9M15 4H20V9M20 15V20H15M9 20H4V15" /></svg>
    </button>
    <button class="basic-icon-btn" title="截图" aria-label="截图" @click="handleCaptureScreen">
      <svg viewBox="0 0 24 24" aria-hidden><path d="M4 8H8L10 5H14L16 8H20V19H4V8ZM12 17A4 4 0 1 0 12 9A4 4 0 0 0 12 17Z" /></svg>
    </button>
    <button class="basic-icon-btn danger" title="清除" aria-label="清除" @click="handleClearView">
      <svg viewBox="0 0 24 24" aria-hidden><path d="M5 7H19M9 7V5H15V7M8 10V20H16V10" /></svg>
    </button>

    <div v-if="activeBasicFlyout" class="basic-tool-flyout">
      <template v-if="activeBasicFlyout === 'fly'">
        <div class="flyout-title">定位飞行</div>
        <div class="tool-input-grid">
          <label><span>经度</span><input v-model="flyLon" class="basic-input" type="number" step="0.000001" /></label>
          <label><span>纬度</span><input v-model="flyLat" class="basic-input" type="number" step="0.000001" /></label>
          <label><span>高度(m)</span><input v-model="flyHeight" class="basic-input" type="number" min="1" step="100" /></label>
        </div>
        <button class="sys-btn workflow-btn" @click="handleFlyToPosition">飞行至坐标</button>
      </template>

      <template v-if="activeBasicFlyout === 'measure'">
        <div class="flyout-title">量测标绘</div>
        <button class="sys-btn workflow-btn" @click="handleStartMeasure('distance')">距离</button>
        <button class="sys-btn workflow-btn" @click="handleStartMeasure('height')">高度</button>
        <button class="sys-btn workflow-btn" @click="handleStartMeasure('area')">面积</button>
        <button class="sys-btn workflow-btn" @click="handleClearMeasurements">清标绘</button>
      </template>

      <template v-if="activeBasicFlyout === 'roam'">
        <div class="flyout-title">漫游</div>
        <div class="tool-input-grid">
          <label><span>速度(m/s)</span><input v-model="roamSpeed" class="basic-input" type="number" min="1" step="10" /></label>
          <label><span>高度(m)</span><input v-model="roamHeight" class="basic-input" type="number" step="10" /></label>
        </div>
        <button class="sys-btn workflow-btn" @click="handlePickRoamPath">拾取路径</button>
        <button class="sys-btn workflow-btn" @click="handleStartRoam">开始漫游</button>
        <button class="sys-btn workflow-btn" @click="handleToggleRoamPause">{{ roamPaused ? '继续' : '暂停' }}</button>
        <button class="sys-btn workflow-btn" @click="handleClearRoam">清漫游</button>
      </template>

      <div class="basic-flyout-status">{{ basicStatus }}</div>
    </div>
  </div>
</template>

<style scoped>
.basic-icon-dock {
  position: absolute;
  top: 112px;
  right: 24px;
  z-index: 10020;
  display: flex;
  flex-direction: column;
  gap: 9px;
  pointer-events: auto;
}

.basic-icon-btn {
  width: 42px;
  height: 42px;
  padding: 0;
  border: 1px solid rgba(0, 167, 197, 0.44);
  border-radius: 4px;
  background: linear-gradient(180deg, rgba(0, 104, 124, 0.62), rgba(0, 45, 68, 0.64));
  color: #dffbff;
  cursor: pointer;
  box-shadow: inset 0 0 14px rgba(0, 229, 255, 0.16), 0 8px 18px rgba(0, 0, 0, 0.26);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.basic-icon-btn svg {
  width: 22px;
  height: 22px;
}

.basic-icon-btn path {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.9;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.basic-icon-btn:hover,
.basic-icon-btn.active {
  border-color: rgba(0, 229, 255, 0.88);
  background: linear-gradient(180deg, rgba(0, 151, 185, 0.78), rgba(0, 74, 98, 0.82));
  color: #ffffff;
  box-shadow: inset 0 0 18px rgba(0, 229, 255, 0.24), 0 0 16px rgba(0, 229, 255, 0.28);
}

.basic-icon-btn.danger:hover {
  border-color: rgba(255, 82, 82, 0.9);
  background: linear-gradient(180deg, rgba(147, 35, 45, 0.78), rgba(77, 16, 28, 0.86));
  box-shadow: inset 0 0 16px rgba(255, 82, 82, 0.22), 0 0 14px rgba(255, 82, 82, 0.22);
}

.basic-tool-flyout {
  position: absolute;
  top: 0;
  right: 54px;
  width: 230px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border: 1px solid rgba(0, 196, 230, 0.34);
  border-radius: 4px;
  background:
    radial-gradient(circle at 0% 18%, rgba(0, 214, 255, 0.16), transparent 42%),
    linear-gradient(180deg, rgba(4, 20, 38, 0.94), rgba(3, 13, 28, 0.9));
  box-shadow: inset 0 0 20px rgba(0, 229, 255, 0.1), 0 12px 30px rgba(0, 0, 0, 0.45);
}

.flyout-title {
  position: relative;
  padding: 9px 12px 9px 32px;
  border: 1px solid rgba(0, 167, 197, 0.42);
  border-radius: 4px;
  background: linear-gradient(90deg, rgba(0, 131, 153, 0.6), rgba(0, 82, 105, 0.5));
  color: #ffffff;
  font-size: 13px;
  font-weight: 700;
}

.flyout-title::before {
  content: '';
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-45%);
  border-top: 6px solid #11c9ff;
  border-left: 5px solid transparent;
  border-right: 5px solid transparent;
}

.tool-input-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.tool-input-grid label {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 5px;
  color: rgba(217, 251, 255, 0.78);
  font-size: 11px;
}

.tool-input-grid label:nth-child(3) {
  grid-column: 1 / -1;
}

.basic-input {
  width: 100%;
  height: 32px;
  padding: 0 8px;
  border: 1px solid rgba(0, 196, 230, 0.28);
  border-radius: 4px;
  color: #ffffff;
  background: rgba(1, 12, 25, 0.72);
  outline: none;
}

.basic-input:focus {
  border-color: rgba(0, 229, 255, 0.72);
  box-shadow: 0 0 10px rgba(0, 229, 255, 0.18);
}

.sys-btn {
  min-height: 32px;
  border: 1px solid rgba(0, 167, 197, 0.42);
  border-radius: 4px;
  color: #dffbff;
  background: linear-gradient(180deg, rgba(0, 104, 124, 0.55), rgba(0, 45, 68, 0.58));
  cursor: pointer;
}

.sys-btn:hover {
  border-color: rgba(0, 229, 255, 0.86);
  color: #ffffff;
  background: linear-gradient(180deg, rgba(0, 151, 185, 0.78), rgba(0, 74, 98, 0.82));
}

.workflow-btn {
  width: 100%;
}

.basic-flyout-status {
  margin-top: 2px;
  padding: 7px 9px;
  border-left: 2px solid var(--sys-theme-color);
  color: #bcefff;
  background: rgba(0, 229, 255, 0.08);
  font-size: 11px;
  line-height: 1.45;
}
</style>
