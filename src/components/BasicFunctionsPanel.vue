<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { RoamUiState } from '../types/roam';
import type { ShapefileImportReport, ShapefileImportSource } from '../types/shapefile';
import { ShapefileImportError } from '../utils/shapefileRoute';

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
const roamFolderInput = ref<HTMLInputElement | null>(null);
const shapefileImportReport = ref<ShapefileImportReport | null>(null);
const shapefileImportBusy = ref(false);
const shapefileDropActive = ref(false);
const basicIconDockRef = ref<HTMLElement | null>(null);
const basicFlyoutRef = ref<HTMLElement | null>(null);
const flyoutDetached = ref(false);
const flyoutDragging = ref(false);
const flyoutPosition = ref({ x: 0, y: 0 });
let flyoutDragOffset = { x: 0, y: 0 };
let flyoutPointerId: number | null = null;
const roamPhase = computed(() => props.roamState?.phase ?? 'idle');
const roamPaused = computed(() => roamPhase.value === 'paused');
const roamBusy = computed(() => ['building', 'transitioning'].includes(roamPhase.value));
const roamRunning = computed(() => roamPhase.value === 'running');
const roamRouteReady = computed(() => props.roamState?.routeReady ?? false);
const roamCanStart = computed(() => (
  roamRouteReady.value &&
  ['ready', 'stopped', 'completed'].includes(roamPhase.value) &&
  !shapefileImportBusy.value
));
const roamCanPause = computed(() => ['running', 'paused'].includes(roamPhase.value));
const roamCanStop = computed(() => ['running', 'paused', 'transitioning'].includes(roamPhase.value));
const roamCanEditRoute = computed(() => (
  !shapefileImportBusy.value &&
  !['building', 'transitioning', 'running', 'paused'].includes(roamPhase.value)
));
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
const shapefileCrsLabel = computed(() => {
  const crs = shapefileImportReport.value?.sourceCrs;
  if (!crs) return '未识别';
  return crs.authority ? `${crs.authority} · ${crs.name}` : crs.name;
});
const shapefileLengthText = computed(() => {
  const length = shapefileImportReport.value?.geometry?.selectedLengthMeters ?? 0;
  return length >= 1000 ? `${(length / 1000).toFixed(2)} km` : `${length.toFixed(0)} m`;
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

const flyoutStyle = computed(() => {
  if (!flyoutDetached.value) return {};
  return {
    left: `${flyoutPosition.value.x}px`,
    top: `${flyoutPosition.value.y}px`,
    right: 'auto',
    bottom: 'auto',
    zIndex: '10080'
  };
});

const clampFlyoutPosition = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const getFlyoutContainerRect = () => basicIconDockRef.value?.getBoundingClientRect() ?? { left: 0, top: 0 };

const moveFlyoutTo = (clientX: number, clientY: number) => {
  const el = basicFlyoutRef.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const containerRect = getFlyoutContainerRect();
  const margin = 8;
  const maxX = Math.max(margin, window.innerWidth - rect.width - margin);
  const maxY = Math.max(margin, window.innerHeight - rect.height - margin);
  const nextViewportX = clampFlyoutPosition(clientX - flyoutDragOffset.x, margin, maxX);
  const nextViewportY = clampFlyoutPosition(clientY - flyoutDragOffset.y, margin, maxY);
  flyoutPosition.value = {
    x: nextViewportX - containerRect.left,
    y: nextViewportY - containerRect.top
  };
};

const handleFlyoutPointerMove = (event: PointerEvent) => {
  if (!flyoutDragging.value || flyoutPointerId !== event.pointerId) return;
  event.preventDefault();
  moveFlyoutTo(event.clientX, event.clientY);
};

const handleFlyoutPointerUp = (event?: PointerEvent) => {
  if (event && flyoutPointerId !== event.pointerId) return;
  flyoutDragging.value = false;
  flyoutPointerId = null;
  window.removeEventListener('pointermove', handleFlyoutPointerMove);
  window.removeEventListener('pointerup', handleFlyoutPointerUp);
  window.removeEventListener('pointercancel', handleFlyoutPointerUp);
};

const handleFlyoutPointerDown = (event: PointerEvent) => {
  if (event.button !== 0) return;
  const el = basicFlyoutRef.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const containerRect = getFlyoutContainerRect();
  flyoutDetached.value = true;
  flyoutDragging.value = true;
  flyoutPointerId = event.pointerId;
  flyoutDragOffset = {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  };
  flyoutPosition.value = { x: rect.left - containerRect.left, y: rect.top - containerRect.top };
  (event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId);
  event.preventDefault();
  window.addEventListener('pointermove', handleFlyoutPointerMove, { passive: false });
  window.addEventListener('pointerup', handleFlyoutPointerUp);
  window.addEventListener('pointercancel', handleFlyoutPointerUp);
};

const handleFlyoutMouseMove = (event: MouseEvent) => {
  if (!flyoutDragging.value || flyoutPointerId !== -1) return;
  event.preventDefault();
  moveFlyoutTo(event.clientX, event.clientY);
};

const handleFlyoutMouseUp = () => {
  if (flyoutPointerId !== -1) return;
  flyoutDragging.value = false;
  flyoutPointerId = null;
  window.removeEventListener('mousemove', handleFlyoutMouseMove);
  window.removeEventListener('mouseup', handleFlyoutMouseUp);
};

const handleFlyoutMouseDown = (event: MouseEvent) => {
  if (flyoutDragging.value) return;
  if (event.button !== 0) return;
  const el = basicFlyoutRef.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const containerRect = getFlyoutContainerRect();
  flyoutDetached.value = true;
  flyoutDragging.value = true;
  flyoutPointerId = -1;
  flyoutDragOffset = {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  };
  flyoutPosition.value = { x: rect.left - containerRect.left, y: rect.top - containerRect.top };
  event.preventDefault();
  window.addEventListener('mousemove', handleFlyoutMouseMove, { passive: false });
  window.addEventListener('mouseup', handleFlyoutMouseUp);
};

const resetFlyoutPosition = () => {
  flyoutDetached.value = false;
  flyoutDragging.value = false;
  flyoutPointerId = null;
  window.removeEventListener('pointermove', handleFlyoutPointerMove);
  window.removeEventListener('pointerup', handleFlyoutPointerUp);
  window.removeEventListener('pointercancel', handleFlyoutPointerUp);
  window.removeEventListener('mousemove', handleFlyoutMouseMove);
  window.removeEventListener('mouseup', handleFlyoutMouseUp);
};

watch(activeBasicFlyout, () => {
  resetFlyoutPosition();
});

onBeforeUnmount(() => {
  resetFlyoutPosition();
});

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

const handleImportRoamFolder = () => {
  roamFolderInput.value?.click();
};

const runShapefileImport = async (files: File[], source: ShapefileImportSource) => {
  if (files.length === 0 || shapefileImportBusy.value) return;
  shapefileImportBusy.value = true;
  shapefileImportReport.value = null;
  basicStatus.value = '正在校验数据集完整性、坐标参考系与线状几何...';
  try {
    const report = await props.cesiumViewerRef?.loadRoamShapefileDataset?.(files, source);
    if (!report || typeof report === 'string') {
      basicStatus.value = report || '地图工具尚未准备好。';
      return;
    }
    shapefileImportReport.value = report as ShapefileImportReport;
    basicStatus.value = report.message;
  } catch (error) {
    if (error instanceof ShapefileImportError) {
      shapefileImportReport.value = error.report;
    }
    basicStatus.value = error instanceof Error ? error.message : 'Shapefile 航线导入失败。';
  } finally {
    shapefileImportBusy.value = false;
    shapefileDropActive.value = false;
  }
};

const handleRoamFileChange = async (event: Event, source: ShapefileImportSource) => {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  await runShapefileImport(files, source);
  input.value = '';
};

const handleShapefileDrop = async (event: DragEvent) => {
  const files = Array.from(event.dataTransfer?.files ?? []);
  await runShapefileImport(files, 'drop');
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
  shapefileImportReport.value = null;
  basicStatus.value = '已清除漫游路径。';
};
</script>

<template>
  <div ref="basicIconDockRef" class="basic-icon-dock" @pointerdown.stop @mousedown.stop @click.stop>
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
      ref="basicFlyoutRef"
      class="basic-tool-flyout"
      :class="[`flyout-${activeBasicFlyout}`, { 'is-detached': flyoutDetached, dragging: flyoutDragging }]"
      :style="flyoutStyle"
      @pointerdown.stop
      @mousedown.stop
      @click.stop
    >
      <template v-if="activeBasicFlyout === 'fly'">
        <div class="flyout-title drag-handle" title="按住拖动面板，双击恢复默认位置" @pointerdown="handleFlyoutPointerDown" @mousedown="handleFlyoutMouseDown" @dblclick="resetFlyoutPosition">定位飞行</div>
        <div class="tool-input-grid">
          <label><span>经度</span><input v-model="flyLon" class="basic-input" type="number" step="0.000001" /></label>
          <label><span>纬度</span><input v-model="flyLat" class="basic-input" type="number" step="0.000001" /></label>
          <label><span>高度(m)</span><input v-model="flyHeight" class="basic-input" type="number" min="1" step="100" /></label>
        </div>
        <button class="sys-btn workflow-btn" @click="handleFlyToPosition">飞行至坐标</button>
      </template>

      <template v-if="activeBasicFlyout === 'measure'">
        <div class="flyout-title drag-handle" title="按住拖动面板，双击恢复默认位置" @pointerdown="handleFlyoutPointerDown" @mousedown="handleFlyoutMouseDown" @dblclick="resetFlyoutPosition">量测标绘</div>
        <button class="sys-btn workflow-btn" @click="handleStartMeasure('distance')">距离</button>
        <button class="sys-btn workflow-btn" @click="handleStartMeasure('height')">高度</button>
        <button class="sys-btn workflow-btn" @click="handleStartMeasure('area')">面积</button>
        <button class="sys-btn workflow-btn" @click="handleClearMeasurements">清标绘</button>
      </template>

      <template v-if="activeBasicFlyout === 'roam'">
        <div class="flyout-title drag-handle" title="按住拖动面板，双击恢复默认位置" @pointerdown="handleFlyoutPointerDown" @mousedown="handleFlyoutMouseDown" @dblclick="resetFlyoutPosition">智能路径漫游</div>
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
        <div
          class="roam-source-panel"
          :class="{ 'drop-active': shapefileDropActive }"
          @dragenter.prevent="shapefileDropActive = true"
          @dragover.prevent="shapefileDropActive = true"
          @dragleave.prevent="shapefileDropActive = false"
          @drop.prevent="handleShapefileDrop"
        >
          <div class="roam-source-head">
            <span>航线来源</span>
            <small>场景基准 WGS84</small>
          </div>
          <div class="roam-source-actions">
            <button class="source-btn" :disabled="!roamCanEditRoute" title="在三维场景中设置路径节点" @click="handlePickRoamPath">
              <svg viewBox="0 0 24 24" aria-hidden><path d="M5 18C8 15 8 8 12 8C16 8 15 15 19 18M5 18L5 14M19 18L19 14M12 8V4" /></svg>
              <span>地图拾取</span>
            </button>
            <button class="source-btn" :disabled="!roamCanEditRoute" title="同时选择同名的 .shp、.shx、.dbf、.prj 文件" @click="handleImportRoamRoute">
              <svg viewBox="0 0 24 24" aria-hidden><path d="M12 4V15M8 11L12 15L16 11M5 18H19" /></svg>
              <span>选择文件组</span>
            </button>
            <button class="source-btn" :disabled="!roamCanEditRoute" title="选择包含完整 Shapefile 数据集的文件夹" @click="handleImportRoamFolder">
              <svg viewBox="0 0 24 24" aria-hidden><path d="M3 7H10L12 9H21V19H3V7Z" /></svg>
              <span>选择文件夹</span>
            </button>
          </div>
          <div class="shapefile-requirement">
            <span>必需</span>
            <code>.shp</code><code>.shx</code><code>.dbf</code><code>.prj</code>
            <span>可选</span><code>.cpg</code>
          </div>
          <div v-if="shapefileImportBusy" class="shapefile-loading">
            <i aria-hidden="true"></i>
            <span>正在进行空间参考与数据一致性检查</span>
          </div>
        </div>
        <div
          v-if="shapefileImportReport"
          class="shapefile-report"
          :class="`report-${shapefileImportReport.status}`"
        >
          <div class="shapefile-report-head">
            <div>
              <span class="report-status-icon" aria-hidden>
                <svg v-if="shapefileImportReport.status === 'ready'" viewBox="0 0 20 20"><path d="M4 10L8 14L16 6" /></svg>
                <svg v-else viewBox="0 0 20 20"><path d="M10 4V11M10 15V15.1" /></svg>
              </span>
              <span class="report-dataset" :title="shapefileImportReport.datasetName">{{ shapefileImportReport.datasetName }}</span>
            </div>
            <strong>{{ shapefileImportReport.status === 'ready' ? '校验通过' : '需要处理' }}</strong>
          </div>
          <div class="component-checks">
            <span
              v-for="check in shapefileImportReport.componentChecks"
              :key="check.extension"
              class="component-check"
              :class="`check-${check.status}`"
              :title="check.detail"
            >
              <i aria-hidden="true"></i>
              .{{ check.extension }}
              <small>{{ check.label }}</small>
            </span>
          </div>
          <div v-if="shapefileImportReport.sourceCrs" class="crs-flow">
            <div>
              <span>源坐标系</span>
              <strong :title="shapefileCrsLabel">{{ shapefileCrsLabel }}</strong>
            </div>
            <svg viewBox="0 0 34 14" aria-hidden><path d="M1 7H31M26 2L31 7L26 12" /></svg>
            <div>
              <span>场景坐标系</span>
              <strong>EPSG:4326</strong>
            </div>
          </div>
          <div v-if="shapefileImportReport.geometry" class="shapefile-metrics">
            <span><small>航线长度</small><strong>{{ shapefileLengthText }}</strong></span>
            <span><small>有效节点</small><strong>{{ shapefileImportReport.geometry.selectedPointCount }}</strong></span>
            <span><small>几何类型</small><strong>{{ shapefileImportReport.geometry.shapeType }}</strong></span>
          </div>
          <div v-if="shapefileImportReport.warnings.length" class="shapefile-warnings">
            <p
              v-for="warning in shapefileImportReport.warnings.slice(0, 2)"
              :key="warning"
              :title="warning"
            >
              {{ warning }}
            </p>
          </div>
        </div>
        <div class="roam-action-grid">
          <button class="sys-btn workflow-btn primary" :disabled="!roamCanStart" @click="handleStartRoam">{{ roamBusy ? '准备中' : '开始漫游' }}</button>
          <button class="sys-btn workflow-btn" :disabled="!roamCanPause" @click="handleToggleRoamPause">{{ roamPaused ? '继续' : '暂停' }}</button>
          <button class="sys-btn workflow-btn danger-soft" :disabled="!roamCanStop" @click="handleStopRoam">停止</button>
          <button class="sys-btn workflow-btn" :disabled="roamBusy || roamRunning || shapefileImportBusy" @click="handleClearRoam">清除路径</button>
        </div>
        <input
          ref="roamFileInput"
          class="file-input-hidden"
          type="file"
          accept=".shp,.shx,.dbf,.prj,.cpg"
          multiple
          @change="handleRoamFileChange($event, 'files')"
        />
        <input
          ref="roamFolderInput"
          class="file-input-hidden"
          type="file"
          accept=".shp,.shx,.dbf,.prj,.cpg"
          webkitdirectory
          multiple
          @change="handleRoamFileChange($event, 'folder')"
        />
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

.basic-tool-flyout.is-detached {
  bottom: auto;
  transform: none;
}

.basic-tool-flyout.is-detached::after {
  display: none;
}

.basic-tool-flyout.dragging {
  user-select: none;
  box-shadow: inset 0 0 18px rgba(0, 229, 255, 0.18), 0 12px 30px rgba(0, 0, 0, 0.42);
}

.flyout-fly {
  --flyout-offset: 38px;
}

.flyout-measure {
  --flyout-offset: 76px;
}

.flyout-roam {
  --flyout-offset: 114px;
  width: min(390px, calc(100vw - 24px));
  max-height: calc(100vh - 82px);
  overflow-x: hidden;
  overflow-y: auto;
  scrollbar-color: rgba(100, 213, 228, 0.42) rgba(0, 0, 0, 0.12);
  scrollbar-width: thin;
}

.flyout-roam::-webkit-scrollbar {
  width: 5px;
}

.flyout-roam::-webkit-scrollbar-track {
  background: rgba(0, 0, 0, 0.12);
}

.flyout-roam::-webkit-scrollbar-thumb {
  border-radius: 3px;
  background: rgba(100, 213, 228, 0.42);
}

.flyout-roam::after {
  display: none;
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

.flyout-title.drag-handle {
  cursor: grab;
  touch-action: none;
  user-select: none;
  padding-right: 34px;
  transition: border-color 0.16s ease, background 0.16s ease, box-shadow 0.16s ease;
}

.flyout-title.drag-handle::after {
  content: '\62d6\62fd';
  position: absolute;
  right: 8px;
  top: 50%;
  padding: 1px 4px;
  border: 1px solid rgba(0, 229, 255, 0.2);
  border-radius: 3px;
  color: rgba(190, 245, 250, 0.7);
  background: rgba(0, 229, 255, 0.055);
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.02em;
  transform: translateY(-50%);
}

.flyout-title.drag-handle:hover {
  border-color: rgba(0, 229, 255, 0.42);
  background: linear-gradient(90deg, rgba(0, 229, 255, 0.13), rgba(0, 229, 255, 0.02) 100%);
  box-shadow: inset 0 0 12px rgba(0, 229, 255, 0.06);
}

.basic-tool-flyout.dragging .flyout-title.drag-handle {
  cursor: grabbing;
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

.roam-source-panel {
  position: relative;
  display: grid;
  gap: 8px;
  padding: 9px;
  border: 1px solid rgba(92, 210, 230, 0.16);
  border-radius: 6px;
  background:
    linear-gradient(135deg, rgba(0, 229, 255, 0.045), transparent 56%),
    rgba(0, 9, 17, 0.24);
  transition: border-color 0.18s ease, background 0.18s ease, box-shadow 0.18s ease;
}

.roam-source-panel.drop-active {
  border-color: rgba(100, 232, 221, 0.68);
  background:
    linear-gradient(135deg, rgba(47, 211, 181, 0.13), transparent 62%),
    rgba(0, 19, 25, 0.54);
  box-shadow: inset 0 0 18px rgba(64, 224, 205, 0.08);
}

.roam-source-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.roam-source-head > span {
  color: #e6fbff;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.roam-source-head small {
  color: #6f9aa5;
  font-family: "Cascadia Mono", "Courier New", monospace;
  font-size: 9px;
}

.roam-source-actions {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}

.source-btn {
  display: flex;
  min-width: 0;
  min-height: 38px;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 0 5px;
  border: 1px solid rgba(0, 229, 255, 0.17);
  border-radius: 5px;
  color: #a9ccd5;
  background: rgba(0, 34, 47, 0.28);
  cursor: pointer;
  font-size: 10px;
  font-weight: 650;
  transition: border-color 0.16s ease, background 0.16s ease, color 0.16s ease, transform 0.16s ease;
}

.source-btn svg {
  flex: 0 0 auto;
  width: 15px;
  height: 15px;
}

.source-btn path {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.7;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.source-btn:hover:not(:disabled) {
  border-color: rgba(92, 224, 214, 0.56);
  color: #f0ffff;
  background: rgba(0, 119, 137, 0.32);
  transform: translateY(-1px);
}

.source-btn:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}

.shapefile-requirement {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 4px;
  color: #638d98;
  font-size: 9px;
  white-space: nowrap;
}

.shapefile-requirement span:not(:first-child) {
  margin-left: auto;
}

.shapefile-requirement code {
  padding: 2px 3px;
  border-radius: 3px;
  color: #a9d9df;
  background: rgba(80, 190, 204, 0.08);
  font-family: "Cascadia Mono", "Courier New", monospace;
  font-size: 9px;
}

.shapefile-loading {
  display: flex;
  align-items: center;
  gap: 7px;
  padding-top: 1px;
  color: #9edce3;
  font-size: 10px;
}

.shapefile-loading i {
  width: 11px;
  height: 11px;
  border: 1px solid rgba(107, 229, 238, 0.22);
  border-top-color: #72e4ec;
  border-radius: 50%;
  animation: shapefile-spin 0.8s linear infinite;
}

.shapefile-report {
  display: grid;
  gap: 8px;
  padding: 9px;
  border: 1px solid rgba(103, 227, 190, 0.24);
  border-radius: 6px;
  background:
    linear-gradient(120deg, rgba(44, 196, 153, 0.075), transparent 52%),
    rgba(0, 12, 18, 0.3);
}

.shapefile-report.report-error {
  border-color: rgba(255, 143, 101, 0.3);
  background:
    linear-gradient(120deg, rgba(190, 78, 49, 0.1), transparent 52%),
    rgba(17, 8, 9, 0.34);
}

.shapefile-report-head,
.shapefile-report-head > div {
  display: flex;
  min-width: 0;
  align-items: center;
}

.shapefile-report-head {
  justify-content: space-between;
  gap: 10px;
}

.shapefile-report-head > div {
  gap: 7px;
}

.report-status-icon {
  display: inline-flex;
  flex: 0 0 18px;
  width: 18px;
  height: 18px;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(103, 227, 190, 0.42);
  border-radius: 50%;
  color: #86f2c9;
  background: rgba(57, 194, 151, 0.11);
}

.report-error .report-status-icon {
  border-color: rgba(255, 143, 101, 0.45);
  color: #ffae8e;
  background: rgba(190, 78, 49, 0.12);
}

.report-status-icon svg {
  width: 12px;
  height: 12px;
}

.report-status-icon path {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.9;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.report-dataset {
  overflow: hidden;
  color: #eafff8;
  font-size: 11px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.shapefile-report-head > strong {
  flex: 0 0 auto;
  color: #72dfb7;
  font-size: 9px;
  font-weight: 700;
}

.report-error .shapefile-report-head > strong {
  color: #f2a082;
}

.component-checks {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 4px;
}

.component-check {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 3px;
  color: #a4c2c9;
  font-family: "Cascadia Mono", "Courier New", monospace;
  font-size: 9px;
}

.component-check i {
  flex: 0 0 5px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #65deb2;
  box-shadow: 0 0 5px rgba(101, 222, 178, 0.48);
}

.component-check small {
  overflow: hidden;
  color: #587e88;
  font-family: inherit;
  font-size: 8px;
  text-overflow: ellipsis;
}

.component-check.check-warning i {
  background: #d7b86d;
  box-shadow: 0 0 5px rgba(215, 184, 109, 0.42);
}

.component-check.check-error {
  color: #ffad8c;
}

.component-check.check-error i {
  background: #ff8f65;
  box-shadow: 0 0 5px rgba(255, 143, 101, 0.48);
}

.crs-flow {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 34px minmax(0, 0.78fr);
  align-items: center;
  gap: 6px;
  padding: 7px 8px;
  border-top: 1px solid rgba(94, 202, 216, 0.11);
  border-bottom: 1px solid rgba(94, 202, 216, 0.11);
  background: rgba(0, 0, 0, 0.1);
}

.crs-flow > div {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.crs-flow span {
  color: #5f8993;
  font-size: 8px;
}

.crs-flow strong {
  overflow: hidden;
  color: #cbeef1;
  font-family: "Cascadia Mono", "Courier New", monospace;
  font-size: 9px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.crs-flow svg {
  width: 34px;
  height: 14px;
  color: #5fcfca;
}

.crs-flow path {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.shapefile-metrics {
  display: grid;
  grid-template-columns: 1fr 0.8fr 1fr;
  gap: 6px;
}

.shapefile-metrics > span {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.shapefile-metrics small {
  color: #5c8791;
  font-size: 8px;
}

.shapefile-metrics strong {
  overflow: hidden;
  color: #d8f4f4;
  font-family: "Cascadia Mono", "Courier New", monospace;
  font-size: 9px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.shapefile-warnings {
  display: grid;
  gap: 3px;
}

.shapefile-warnings p {
  position: relative;
  margin: 0;
  padding-left: 9px;
  overflow: hidden;
  color: #c8b47c;
  font-size: 9px;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.shapefile-warnings p::before {
  position: absolute;
  left: 1px;
  top: 0.48em;
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: #d7b86d;
  content: '';
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

@keyframes shapefile-spin {
  to {
    transform: rotate(360deg);
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
