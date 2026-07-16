<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { RoamUiState } from '../types/roam';

const props = defineProps<{
  cesiumViewerRef?: any;
  roamState?: RoamUiState;
}>();

const activeBasicFlyout = ref<'fly' | 'measure' | 'roam' | null>(null);
const flyLon = ref('102.08');
const flyLat = ref('29.59');
const flyHeight = ref('20000');
const roamSpeed = ref('80');
const roamHeight = ref('120');
const basicStatus = ref('选择一个基础工具后，可直接在三维视图中交互。');
const roamViewMode = ref<'third' | 'first'>('third');
const roamFileInput = ref<HTMLInputElement | null>(null);
const roamPhase = computed(() => props.roamState?.phase ?? 'idle');
const roamPaused = computed(() => roamPhase.value === 'paused');
const roamBusy = computed(() => ['building', 'transitioning'].includes(roamPhase.value));
const roamRunning = computed(() => roamPhase.value === 'running');
const roamRouteReady = computed(() => props.roamState?.routeReady ?? false);
const roamCanStart = computed(() => roamRouteReady.value && !roamBusy.value && !roamRunning.value);
const roamCanPause = computed(() => ['running', 'paused'].includes(roamPhase.value));
const roamCanStop = computed(() => ['running', 'paused', 'transitioning'].includes(roamPhase.value));
const roamCanEditRoute = computed(() => !['building', 'transitioning', 'running', 'paused'].includes(roamPhase.value));
const roamProgressPercent = computed(() => Math.round((props.roamState?.progress ?? 0) * 100));
const roamDistanceText = computed(() => {
  const distance = props.roamState?.distance ?? 0;
  const total = props.roamState?.totalDistance ?? 0;
  const format = (value: number) => value >= 1000 ? `${(value / 1000).toFixed(2)} km` : `${value.toFixed(0)} m`;
  return `${format(distance)} / ${format(total)}`;
});
const roamPhaseText = computed(() => {
  const labels: Record<RoamUiState['phase'], string> = {
    idle: '待规划',
    drawing: '路径拾取',
    building: '轨迹构建',
    ready: '航线就绪',
    transitioning: '视角过渡',
    running: '漫游进行',
    paused: '已暂停',
    stopped: '已停止',
    completed: '已完成',
    error: '异常'
  };
  return labels[roamPhase.value];
});

type MeasureMode = 'distance' | 'height' | 'area';

watch(
  () => props.roamState,
  (state) => {
    if (!state) return;
    roamViewMode.value = state.mode;
    if (state.message) basicStatus.value = state.message;
  },
  { immediate: true }
);

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

const handlePickRoamPath = () => {
  const message = props.cesiumViewerRef?.startPickRoamPath?.();
  basicStatus.value = message || '路径拾取已开启。';
};

const handleSetRoamMode = async (mode: 'third' | 'first') => {
  roamViewMode.value = mode;
  const message = await props.cesiumViewerRef?.setRoamViewMode?.(mode);
  basicStatus.value = message || (mode === 'third' ? '已切换为第三人称跟随视角。' : '已切换为第一人称沉浸视角。');
};

const handleImportRoamRoute = () => {
  roamFileInput.value?.click();
};

const handleRoamFileChange = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    const message = await props.cesiumViewerRef?.loadRoamShpRoute?.(file);
    basicStatus.value = message || '已导入航线，可开始漫游。';
  } catch (error) {
    basicStatus.value = error instanceof Error ? error.message : '航线导入失败，请检查 shp 文件坐标。';
  } finally {
    input.value = '';
  }
};

const handleStartRoam = async () => {
  const speed = Number(roamSpeed.value);
  const height = Number(roamHeight.value);
  if (!Number.isFinite(speed) || speed <= 0 || !Number.isFinite(height)) {
    basicStatus.value = '请输入有效的漫游速度和高度。';
    return;
  }
  const message = await props.cesiumViewerRef?.startRoam?.(speed, height, roamViewMode.value);
  basicStatus.value = message || '漫游已开始。';
};

const handleToggleRoamPause = () => {
  const message = props.cesiumViewerRef?.toggleRoamPause?.();
  basicStatus.value = message || '漫游状态已更新。';
};

const handleStopRoam = () => {
  const message = props.cesiumViewerRef?.stopRoam?.();
  basicStatus.value = message || '漫游已停止，已释放相机控制。';
};

const handleClearRoam = () => {
  props.cesiumViewerRef?.clearRoam?.();
  basicStatus.value = '已清除漫游路径。';
};
</script>

<template>
  <div class="basic-icon-dock">
    <button type="button" data-label="HOME" class="basic-icon-btn" title="HOME" aria-label="HOME" @click="handleFlyHome">
      <svg viewBox="0 0 24 24" aria-hidden><path d="M4 11L12 4L20 11V20H15V14H9V20H4V11Z" /></svg>
    </button>
    <button type="button" data-label="定位" class="basic-icon-btn" :class="{ active: activeBasicFlyout === 'fly' }" title="定位飞行" aria-label="定位飞行" @click="toggleBasicFlyout('fly')">
      <svg viewBox="0 0 24 24" aria-hidden><path d="M12 3L15 10L22 12L15 14L12 21L9 14L2 12L9 10L12 3Z" /></svg>
    </button>
    <button type="button" data-label="量测" class="basic-icon-btn" :class="{ active: activeBasicFlyout === 'measure' }" title="量测标绘" aria-label="量测标绘" @click="toggleBasicFlyout('measure')">
      <svg viewBox="0 0 24 24" aria-hidden><path d="M4 17L17 4L20 7L7 20H4V17ZM14 7L17 10M11 10L13 12M8 13L10 15" /></svg>
    </button>
    <button type="button" data-label="漫游" class="basic-icon-btn" :class="{ active: activeBasicFlyout === 'roam' }" title="漫游" aria-label="漫游" @click="toggleBasicFlyout('roam')">
      <svg viewBox="0 0 24 24" aria-hidden><path d="M5 18C9 18 7 6 12 6C17 6 15 18 19 18M5 18L3 16M5 18L3 20M19 18L21 16M19 18L21 20" /></svg>
    </button>
    <button type="button" data-label="全屏" class="basic-icon-btn" title="全屏" aria-label="全屏" @click="handleFullScreen">
      <svg viewBox="0 0 24 24" aria-hidden><path d="M4 9V4H9M15 4H20V9M20 15V20H15M9 20H4V15" /></svg>
    </button>
    <button type="button" data-label="截图" class="basic-icon-btn" title="截图" aria-label="截图" @click="handleCaptureScreen">
      <svg viewBox="0 0 24 24" aria-hidden><path d="M4 8H8L10 5H14L16 8H20V19H4V8ZM12 17A4 4 0 1 0 12 9A4 4 0 0 0 12 17Z" /></svg>
    </button>
    <div
      v-if="activeBasicFlyout"
      class="basic-tool-flyout"
      :class="`flyout-${activeBasicFlyout}`"
    >
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
        <div class="flyout-title">智能路径漫游</div>
        <div class="roam-mode-switch" aria-label="漫游视角模式">
          <button
            type="button"
            class="mode-chip"
            :class="{ active: roamViewMode === 'third' }"
            :disabled="roamBusy"
            @click="handleSetRoamMode('third')"
          >
            第三人称
          </button>
          <button
            type="button"
            class="mode-chip"
            :class="{ active: roamViewMode === 'first' }"
            :disabled="roamBusy"
            @click="handleSetRoamMode('first')"
          >
            第一人称
          </button>
        </div>
        <div class="tool-input-grid">
          <label><span>速度(m/s)</span><input v-model="roamSpeed" class="basic-input" type="number" min="1" step="10" :disabled="roamBusy || roamRunning" /></label>
          <label title="相机飞行轨迹相对于当前 DEM 地表的垂直高度"><span>相对DEM高度(m)</span><input v-model="roamHeight" class="basic-input" type="number" min="1" step="10" :disabled="roamBusy || roamRunning" /></label>
        </div>
        <div class="roam-telemetry" :class="`phase-${roamPhase}`">
          <div class="roam-telemetry-head">
            <span class="roam-phase"><i aria-hidden="true"></i>{{ roamPhaseText }}</span>
            <span class="roam-distance">{{ roamDistanceText }}</span>
          </div>
          <div class="roam-progress-track" role="progressbar" :aria-valuenow="roamProgressPercent" aria-valuemin="0" aria-valuemax="100">
            <span :style="{ width: `${roamProgressPercent}%` }"></span>
          </div>
          <div class="roam-telemetry-foot">
            <span>{{ roamViewMode === 'first' ? '第一人称' : '第三人称' }}</span>
            <span>{{ roamProgressPercent }}%</span>
          </div>
        </div>
        <div class="roam-action-grid">
          <button class="sys-btn workflow-btn" :disabled="!roamCanEditRoute" title="在三维场景中设置路径节点" @click="handlePickRoamPath">拾取路径</button>
          <button class="sys-btn workflow-btn" :disabled="!roamCanEditRoute" title="导入 WGS84 线状 shp 航线" @click="handleImportRoamRoute">导入航线</button>
          <button class="sys-btn workflow-btn primary" :disabled="!roamCanStart" @click="handleStartRoam">{{ roamBusy ? '准备中' : '开始漫游' }}</button>
          <button class="sys-btn workflow-btn" :disabled="!roamCanPause" @click="handleToggleRoamPause">{{ roamPaused ? '继续' : '暂停' }}</button>
          <button class="sys-btn workflow-btn danger-soft" :disabled="!roamCanStop" @click="handleStopRoam">停止</button>
        </div>
        <button class="sys-btn workflow-btn" :disabled="roamBusy || roamRunning" @click="handleClearRoam">清除路径</button>
        <input ref="roamFileInput" class="file-input-hidden" type="file" accept=".shp" @change="handleRoamFileChange" />
      </template>

      <div class="basic-flyout-status">{{ basicStatus }}</div>
    </div>
  </div>
</template>

<style scoped>
.basic-icon-dock {
  position: relative;
  z-index: 2;
  display: flex;
  min-width: 0;
  flex-direction: row;
  align-items: center;
  gap: 5px;
  pointer-events: auto;
}

.basic-icon-btn {
  position: relative;
  flex: 0 0 32px;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 5px;
  background: transparent;
  color: #9fb4bf;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: none;
  transition: border-color 0.18s ease, background-color 0.18s ease, color 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease;
}

.basic-icon-btn::before {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  content: attr(data-label);
  min-width: max-content;
  padding: 3px 7px;
  border: 1px solid rgba(0, 229, 255, 0.24);
  border-radius: 4px;
  background: rgba(6, 18, 32, 0.94);
  color: #dffbff;
  font-size: 10px;
  font-weight: 600;
  line-height: 1;
  letter-spacing: 0.04em;
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.22);
  opacity: 0;
  transform: translate(-50%, 4px);
  transition: opacity 0.16s ease, transform 0.16s ease;
  pointer-events: none;
}

.basic-icon-btn::after {
  position: absolute;
  left: 9px;
  right: 9px;
  bottom: 2px;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(0, 229, 255, 0.84), transparent);
  opacity: 0;
  transition: opacity 0.16s ease;
  content: '';
}

.basic-icon-btn svg {
  position: relative;
  z-index: 1;
  width: 18px;
  height: 18px;
  filter: drop-shadow(0 0 5px rgba(95, 223, 237, 0.06));
}

.basic-icon-btn path {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.85;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.basic-icon-btn:hover,
.basic-icon-btn.active {
  border-color: rgba(0, 229, 255, 0.26);
  background: rgba(0, 229, 255, 0.055);
  color: #e8feff;
  box-shadow: inset 0 0 10px rgba(0, 229, 255, 0.055);
  transform: translateY(-1px);
}

.basic-icon-btn:hover::before,
.basic-icon-btn:focus-visible::before {
  opacity: 1;
  transform: translate(-50%, 0);
}

.basic-icon-btn:hover::after,
.basic-icon-btn.active::after {
  opacity: 1;
}

.basic-icon-btn.active {
  color: #ffffff;
  border-color: rgba(0, 229, 255, 0.42);
}

.basic-icon-btn:focus-visible {
  outline: 2px solid #7de9f7;
  outline-offset: 2px;
}

.basic-tool-flyout {
  position: absolute;
  top: auto;
  bottom: calc(100% + 14px);
  left: var(--flyout-offset, 0);
  right: auto;
  width: min(240px, calc(100vw - 24px));
  overflow: visible;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 11px;
  border: 1px solid var(--sys-border-color);
  border-radius: 6px;
  background: var(--sys-glass-bg);
  box-shadow: inset 0 0 16px var(--sys-border-color-light), 0 8px 24px rgba(0, 0, 0, 0.34);
  backdrop-filter: blur(10px);
}

.basic-tool-flyout::before {
  content: '';
  position: absolute;
  top: 0;
  left: 14px;
  right: 14px;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(0, 229, 255, 0.52), transparent);
}

.flyout-fly {
  --flyout-offset: 38px;
}

.flyout-measure {
  --flyout-offset: 76px;
}

.flyout-roam {
  --flyout-offset: 114px;
  width: min(318px, calc(100vw - 24px));
}

.basic-tool-flyout::after {
  content: '';
  position: absolute;
  left: 15px;
  bottom: -5px;
  width: 10px;
  height: 10px;
  border-right: 1px solid rgba(0, 229, 255, 0.34);
  border-bottom: 1px solid rgba(0, 229, 255, 0.34);
  background: rgba(13, 27, 49, 0.92);
  transform: rotate(45deg);
}

.flyout-title {
  position: relative;
  padding: 7px 9px 7px 25px;
  border: 1px solid var(--sys-border-color-light);
  border-radius: 6px;
  background: linear-gradient(90deg, rgba(0, 229, 255, 0.08), transparent 100%);
  color: #ffffff;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.flyout-title::before {
  content: '';
  position: absolute;
  left: 11px;
  top: 50%;
  width: 8px;
  height: 8px;
  border: 1px solid rgba(115, 238, 248, 0.82);
  border-radius: 50%;
  background: rgba(115, 238, 248, 0.15);
  transform: translateY(-50%);
}

.tool-input-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px;
}

.tool-input-grid label {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 5px;
  color: #a8bfd0;
  font-size: 11px;
  font-weight: 500;
}

.tool-input-grid label:nth-child(3) {
  grid-column: 1 / -1;
}

.basic-input {
  width: 100%;
  height: 30px;
  padding: 0 8px;
  border: 1px solid rgba(0, 229, 255, 0.18);
  border-radius: 5px;
  color: #ffffff;
  background: rgba(0, 0, 0, 0.18);
  outline: none;
  font-family: "Cascadia Mono", "Courier New", monospace;
  font-size: 12px;
  box-shadow: inset 0 0 8px rgba(0, 229, 255, 0.04);
  transition: border-color 0.16s ease, box-shadow 0.16s ease, background 0.16s ease;
}

.basic-input:focus {
  border-color: rgba(0, 229, 255, 0.58);
  background: rgba(0, 229, 255, 0.06);
  box-shadow: 0 0 10px rgba(0, 229, 255, 0.12), inset 0 0 8px rgba(0, 229, 255, 0.05);
}

.sys-btn {
  min-height: 30px;
  border: 1px solid rgba(0, 229, 255, 0.22);
  border-radius: 5px;
  color: #dffbff;
  background: linear-gradient(180deg, rgba(0, 104, 124, 0.34), rgba(0, 45, 68, 0.44));
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
  box-shadow: inset 0 0 8px rgba(0, 229, 255, 0.03);
  transition: border-color 0.16s ease, background 0.16s ease, color 0.16s ease, transform 0.16s ease, box-shadow 0.16s ease;
}

.sys-btn:hover {
  border-color: rgba(0, 229, 255, 0.58);
  color: #ffffff;
  background: linear-gradient(180deg, rgba(0, 151, 185, 0.56), rgba(0, 74, 98, 0.7));
  box-shadow: inset 0 0 10px rgba(0, 229, 255, 0.08);
  transform: translateY(-1px);
}

.workflow-btn {
  width: 100%;
}

.roam-mode-switch {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px;
  padding: 4px;
  border: 1px solid rgba(0, 229, 255, 0.12);
  border-radius: 7px;
  background:
    linear-gradient(90deg, rgba(0, 229, 255, 0.045), transparent),
    rgba(0, 0, 0, 0.13);
}

.mode-chip {
  min-height: 28px;
  border: 1px solid transparent;
  border-radius: 5px;
  color: #94b7c3;
  background: transparent;
  cursor: pointer;
  font-size: 11px;
  font-weight: 700;
  transition: border-color 0.16s ease, background 0.16s ease, color 0.16s ease, box-shadow 0.16s ease;
}

.mode-chip:hover,
.mode-chip.active {
  border-color: rgba(0, 229, 255, 0.42);
  color: #f4feff;
  background: linear-gradient(180deg, rgba(0, 229, 255, 0.16), rgba(0, 97, 123, 0.22));
  box-shadow: inset 0 0 10px rgba(0, 229, 255, 0.08), 0 0 12px rgba(0, 229, 255, 0.06);
}

.mode-chip:disabled,
.sys-btn:disabled,
.basic-input:disabled {
  cursor: not-allowed;
  opacity: 0.42;
  transform: none;
  box-shadow: none;
}

.roam-telemetry {
  display: grid;
  gap: 6px;
  padding: 8px 9px;
  border: 1px solid rgba(92, 210, 230, 0.16);
  border-radius: 6px;
  background: rgba(0, 9, 17, 0.26);
}

.roam-telemetry-head,
.roam-telemetry-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.roam-phase {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #d8f8fb;
  font-size: 11px;
  font-weight: 700;
}

.roam-phase i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #7ddce8;
  box-shadow: 0 0 8px rgba(125, 220, 232, 0.72);
}

.phase-running .roam-phase i,
.phase-transitioning .roam-phase i,
.phase-building .roam-phase i {
  animation: roam-status-pulse 1.15s ease-in-out infinite;
}

.phase-ready .roam-phase i,
.phase-completed .roam-phase i {
  background: #73efb8;
  box-shadow: 0 0 8px rgba(115, 239, 184, 0.72);
}

.phase-error .roam-phase i {
  background: #ff9a72;
  box-shadow: 0 0 8px rgba(255, 125, 92, 0.72);
}

.roam-distance {
  color: #87aeb9;
  font-family: "Cascadia Mono", "Courier New", monospace;
  font-size: 10px;
}

.roam-progress-track {
  height: 3px;
  overflow: hidden;
  border-radius: 2px;
  background: rgba(103, 177, 194, 0.14);
}

.roam-progress-track span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #42c6d8, #78efb8);
  box-shadow: 0 0 8px rgba(92, 224, 207, 0.48);
  transition: width 0.12s linear;
}

.roam-telemetry-foot {
  color: #7398a4;
  font-size: 10px;
}

.roam-action-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px;
}

.sys-btn.primary {
  border-color: rgba(108, 242, 190, 0.42);
  color: #edfff8;
  background: linear-gradient(180deg, rgba(59, 203, 161, 0.45), rgba(10, 89, 86, 0.58));
}

.sys-btn.danger-soft {
  border-color: rgba(255, 152, 102, 0.38);
  color: #fff0e8;
  background: linear-gradient(180deg, rgba(188, 88, 56, 0.36), rgba(91, 37, 30, 0.46));
}

.file-input-hidden {
  display: none;
}

@keyframes roam-status-pulse {
  0%,
  100% {
    opacity: 0.45;
    transform: scale(0.86);
  }
  50% {
    opacity: 1;
    transform: scale(1.12);
  }
}

.basic-flyout-status {
  margin-top: 1px;
  padding: 7px 9px;
  border-left: 2px solid var(--sys-theme-color);
  border-radius: 4px;
  color: #bcefff;
  background: rgba(0, 229, 255, 0.06);
  font-size: 11px;
  line-height: 1.45;
}

@media (max-width: 1180px) {
  .basic-icon-dock {
    gap: 3px;
  }

  .basic-icon-btn {
    flex-basis: 30px;
    width: 30px;
    height: 30px;
  }

  .basic-tool-flyout {
    bottom: calc(100% + 12px);
  }

  .flyout-fly {
    --flyout-offset: 36px;
  }

  .flyout-measure {
    --flyout-offset: 72px;
  }

  .flyout-roam {
    --flyout-offset: 108px;
  }
}

@media (max-width: 760px) {
  .basic-icon-dock {
    gap: 2px;
  }

  .basic-icon-btn {
    flex-basis: 30px;
    width: 30px;
    height: 30px;
    border-radius: 5px;
  }

  .basic-icon-btn svg {
    width: 17px;
    height: 17px;
  }

  .basic-icon-btn::before {
    display: none;
  }
}

</style>
