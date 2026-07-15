<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import {
  currentFloodPrimitive,
  currentFloodAreaM2,
  currentFloodFrame,
  floodAreaSeries
} from '../store/floodState';

const CHART_WIDTH = 360;
const CHART_HEIGHT = 154;
const PLOT_LEFT = 54;
const PLOT_RIGHT = 344;
const PLOT_TOP = 16;
const PLOT_BOTTOM = 126;

const panelRef = ref<HTMLElement | null>(null);
const panelDismissed = ref(false);
const panelPosition = reactive({ left: 28, top: 118 });
const panelSize = reactive({ width: 420, height: 288 });
const dragState = reactive({
  active: false,
  offsetX: 0,
  offsetY: 0
});
const resizeState = reactive({
  active: false,
  startX: 0,
  startY: 0,
  startWidth: 0,
  startHeight: 0
});

const sortedAreaSeries = computed(() => (
  floodAreaSeries.value
    .filter((point) => Number.isFinite(point.frame) && Number.isFinite(point.areaM2))
    .sort((a, b) => a.frame - b.frame)
));

const hasAreaData = computed(() => sortedAreaSeries.value.length > 0);
const shouldShowPanel = computed(() => (
  hasAreaData.value &&
  Boolean(currentFloodPrimitive.value) &&
  !panelDismissed.value
));
const latestAreaM2 = computed(() => currentFloodAreaM2.value);
const maxAreaM2 = computed(() => Math.max(0, ...sortedAreaSeries.value.map((point) => point.areaM2)));
const minAreaM2 = computed(() => sortedAreaSeries.value.length
  ? Math.min(...sortedAreaSeries.value.map((point) => point.areaM2))
  : 0);
const firstAreaM2 = computed(() => sortedAreaSeries.value[0]?.areaM2 ?? 0);
const areaChangeM2 = computed(() => latestAreaM2.value - firstAreaM2.value);
const areaSeriesSummaryLabel = computed(() => (
  hasAreaData.value ? `当前第 ${currentFloodFrame.value || sortedAreaSeries.value.at(-1)?.frame || '--'} 帧` : '暂无数据'
));

const formatArea = (areaM2: number) => {
  const safeArea = Math.max(0, Math.abs(areaM2));
  return `${Number((safeArea / 1_000_000).toFixed(3))} km²`;
};

const formatAreaParts = (areaM2: number) => {
  const safeArea = Math.max(0, Math.abs(areaM2));
  return {
    value: String(Number((safeArea / 1_000_000).toFixed(3))),
    unit: 'km²'
  };
};

const currentAreaParts = computed(() => formatAreaParts(latestAreaM2.value));
const maxAreaParts = computed(() => formatAreaParts(maxAreaM2.value));
const minAreaParts = computed(() => formatAreaParts(minAreaM2.value));
const changeAreaParts = computed(() => {
  const parts = formatAreaParts(areaChangeM2.value);
  return {
    ...parts,
    value: Math.abs(areaChangeM2.value) < 0.001
      ? '0'
      : `${areaChangeM2.value > 0 ? '+' : '-'}${parts.value}`
  };
});

const buildChartPoints = () => {
  const series = sortedAreaSeries.value;
  if (!series.length) return [];

  const minFrame = series[0].frame;
  const maxFrame = series[series.length - 1].frame;
  const frameRange = Math.max(1, maxFrame - minFrame);
  const maxValue = Math.max(1, maxAreaM2.value);

  return series.map((point) => ({
    frame: point.frame,
    value: point.areaM2,
    x: PLOT_LEFT + ((point.frame - minFrame) / frameRange) * (PLOT_RIGHT - PLOT_LEFT),
    y: PLOT_BOTTOM - (Math.max(0, point.areaM2) / maxValue) * (PLOT_BOTTOM - PLOT_TOP)
  }));
};

const chartPoints = computed(buildChartPoints);
const areaLinePoints = computed(() => chartPoints.value.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' '));
const areaFillPoints = computed(() => {
  if (chartPoints.value.length < 2 || !areaLinePoints.value) return '';
  return `${PLOT_LEFT},${PLOT_BOTTOM} ${areaLinePoints.value} ${PLOT_RIGHT},${PLOT_BOTTOM}`;
});
const areaDotPoints = computed(() => {
  const points = chartPoints.value;
  if (points.length <= 8) return points;
  const step = Math.ceil(points.length / 8);
  return points.filter((_, index) => index % step === 0 || index === points.length - 1);
});
const areaYTicks = computed(() => {
  const maxValue = Math.max(1, maxAreaM2.value);
  return [1, 0.5, 0].map((ratio) => ({
    label: formatArea(maxValue * ratio),
    y: PLOT_BOTTOM - ratio * (PLOT_BOTTOM - PLOT_TOP)
  }));
});
const areaXTicks = computed(() => {
  const series = sortedAreaSeries.value;
  if (!series.length) return [];
  const first = series[0];
  const last = series[series.length - 1];
  if (first.frame === last.frame) {
    return [{ frame: first.frame, x: (PLOT_LEFT + PLOT_RIGHT) / 2 }];
  }
  return [
    { frame: first.frame, x: PLOT_LEFT },
    { frame: last.frame, x: PLOT_RIGHT }
  ];
});

const panelStyle = computed(() => ({
  left: `${panelPosition.left}px`,
  top: `${panelPosition.top}px`,
  width: `${panelSize.width}px`,
  height: `${panelSize.height}px`
}));

const clampPanelPosition = (left: number, top: number) => {
  const margin = 12;
  return {
    left: Math.min(Math.max(left, margin), Math.max(margin, window.innerWidth - panelSize.width - margin)),
    top: Math.min(Math.max(top, margin), Math.max(margin, window.innerHeight - panelSize.height - margin))
  };
};

const clampPanelSize = (width: number, height: number) => {
  const margin = 12;
  return {
    width: Math.min(Math.max(width, 360), Math.max(360, window.innerWidth - panelPosition.left - margin)),
    height: Math.min(Math.max(height, 238), Math.max(238, window.innerHeight - panelPosition.top - margin))
  };
};

const stopDrag = () => {
  if (!dragState.active) return;
  dragState.active = false;
  window.removeEventListener('pointermove', handleDragMove);
  window.removeEventListener('pointerup', stopDrag);
  window.removeEventListener('pointercancel', stopDrag);
};

const handleDragMove = (event: PointerEvent) => {
  if (!dragState.active) return;
  const nextPosition = clampPanelPosition(
    event.clientX - dragState.offsetX,
    event.clientY - dragState.offsetY
  );
  panelPosition.left = nextPosition.left;
  panelPosition.top = nextPosition.top;
};

const startDrag = (event: PointerEvent) => {
  const target = event.target as HTMLElement | null;
  if (target?.closest('button,input,select')) return;

  const panel = panelRef.value;
  if (!panel) return;

  event.preventDefault();
  const rect = panel.getBoundingClientRect();
  dragState.active = true;
  dragState.offsetX = event.clientX - rect.left;
  dragState.offsetY = event.clientY - rect.top;
  panelPosition.left = rect.left;
  panelPosition.top = rect.top;
  window.addEventListener('pointermove', handleDragMove);
  window.addEventListener('pointerup', stopDrag);
  window.addEventListener('pointercancel', stopDrag);
};

const stopResize = () => {
  if (!resizeState.active) return;
  resizeState.active = false;
  window.removeEventListener('pointermove', handleResizeMove);
  window.removeEventListener('pointerup', stopResize);
  window.removeEventListener('pointercancel', stopResize);
};

const handleResizeMove = (event: PointerEvent) => {
  if (!resizeState.active) return;

  const nextSize = clampPanelSize(
    resizeState.startWidth + event.clientX - resizeState.startX,
    resizeState.startHeight + event.clientY - resizeState.startY
  );
  panelSize.width = nextSize.width;
  panelSize.height = nextSize.height;
};

const startResize = (event: PointerEvent) => {
  event.preventDefault();
  event.stopPropagation();
  const rect = panelRef.value?.getBoundingClientRect();
  resizeState.active = true;
  resizeState.startX = event.clientX;
  resizeState.startY = event.clientY;
  resizeState.startWidth = rect?.width ?? panelSize.width;
  resizeState.startHeight = rect?.height ?? panelSize.height;
  window.addEventListener('pointermove', handleResizeMove);
  window.addEventListener('pointerup', stopResize);
  window.addEventListener('pointercancel', stopResize);
};

const closePanel = () => {
  panelDismissed.value = true;
};

watch(currentFloodPrimitive, (primitive, previousPrimitive) => {
  if (primitive && !previousPrimitive) {
    panelDismissed.value = false;
  }
});

onBeforeUnmount(() => {
  stopDrag();
  stopResize();
});
</script>

<template>
  <Teleport to="body">
    <section
      v-if="shouldShowPanel"
      ref="panelRef"
      class="flood-area-floating-panel"
      :class="{ dragging: dragState.active, resizing: resizeState.active }"
      :style="panelStyle"
    >
      <div class="floating-panel-header" title="拖动移动窗口" @pointerdown="startDrag">
        <span>淹没范围分析</span>
        <button type="button" class="floating-close-btn" title="关闭" aria-label="关闭淹没范围分析" @pointerdown.stop @click="closePanel">×</button>
      </div>

      <div class="floating-metric-grid">
        <div class="floating-metric current">
          <span>当前范围</span>
          <strong><b>{{ currentAreaParts.value }}</b><small>{{ currentAreaParts.unit }}</small></strong>
        </div>
        <div class="floating-metric peak">
          <span>峰值范围</span>
          <strong><b>{{ maxAreaParts.value }}</b><small>{{ maxAreaParts.unit }}</small></strong>
        </div>
        <div class="floating-metric">
          <span>最小范围</span>
          <strong><b>{{ minAreaParts.value }}</b><small>{{ minAreaParts.unit }}</small></strong>
        </div>
        <div class="floating-metric trend" :class="{ down: areaChangeM2 < 0 }">
          <span>较首帧</span>
          <strong><b>{{ changeAreaParts.value }}</b><small>{{ changeAreaParts.unit }}</small></strong>
        </div>
      </div>

      <div class="floating-chart-block">
        <div class="floating-chart-heading">
          <span>淹没范围变化曲线</span>
          <b>{{ areaSeriesSummaryLabel }}</b>
        </div>

        <svg class="floating-analysis-chart" :viewBox="`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`" role="img" aria-label="淹没范围变化曲线">
          <defs>
            <linearGradient id="floating-flood-area-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stop-color="#44e6ff" stop-opacity="0.28" />
              <stop offset="100%" stop-color="#48d18f" stop-opacity="0.04" />
            </linearGradient>
          </defs>
          <g class="floating-grid-lines">
            <line v-for="tick in areaYTicks" :key="tick.label" :x1="PLOT_LEFT" :x2="PLOT_RIGHT" :y1="tick.y" :y2="tick.y" />
          </g>
          <g class="floating-axis-labels y-axis">
            <text v-for="tick in areaYTicks" :key="`floating-area-y-${tick.label}`" x="4" :y="tick.y + 4">{{ tick.label }}</text>
          </g>
          <polygon :points="areaFillPoints" class="floating-area-fill" />
          <polyline :points="areaLinePoints" class="floating-area-line" fill="none" />
          <circle v-for="point in areaDotPoints" :key="`floating-area-${point.frame}-${point.x}`" :cx="point.x" :cy="point.y" r="2.4" class="floating-area-dot" />
          <g class="floating-axis-labels x-axis">
            <text v-for="tick in areaXTicks" :key="`floating-area-x-${tick.frame}`" :x="tick.x" y="148">{{ tick.frame }}帧</text>
          </g>
        </svg>
      </div>
      <span class="floating-resize-handle" title="拖动调整窗口大小" @pointerdown="startResize"></span>
    </section>
  </Teleport>
</template>

<style scoped>
.flood-area-floating-panel {
  position: fixed;
  z-index: 10045;
  display: flex;
  flex-direction: column;
  min-width: 360px;
  min-height: 238px;
  max-width: calc(100vw - 24px);
  padding: 0 0 10px;
  color: #e0f2fe;
  background: rgba(5, 20, 32, 0.7);
  border: 1px solid rgba(0, 229, 255, 0.28);
  border-radius: 8px;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.42), inset 0 0 20px rgba(0, 229, 255, 0.05);
  backdrop-filter: blur(12px);
  user-select: none;
  overflow: hidden;
}

.flood-area-floating-panel.dragging {
  cursor: grabbing;
}

.flood-area-floating-panel.resizing {
  cursor: nwse-resize;
}

.floating-panel-header {
  position: relative;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  width: 100%;
  min-height: 44px;
  padding: 0 48px 0 16px;
  border-bottom: 1px solid rgba(0, 229, 255, 0.2);
  border-radius: 8px 8px 0 0;
  color: #ffffff;
  background:
    linear-gradient(90deg, rgba(0, 229, 255, 0.16), rgba(0, 229, 255, 0.04) 62%, transparent),
    rgba(0, 229, 255, 0.06);
  font-size: 18px;
  font-weight: 800;
  text-align: left;
  cursor: grab;
}

.floating-panel-header::before {
  content: "";
  width: 4px;
  height: 22px;
  margin-right: 10px;
  border-radius: 999px;
  background: #26e6ff;
  box-shadow: 0 0 12px rgba(38, 230, 255, 0.7);
}

.floating-close-btn {
  position: absolute;
  top: 10px;
  right: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  margin: 0;
  padding: 0;
  color: #bae6fd;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 50%;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
}

.floating-close-btn:hover {
  color: #ffffff;
  background: rgba(239, 68, 68, 0.22);
  border-color: rgba(239, 68, 68, 0.45);
}

.floating-metric-grid {
  flex: 0 0 auto;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0;
  padding: 8px 12px 6px;
  border-bottom: 1px solid rgba(0, 229, 255, 0.12);
}

.floating-metric {
  min-height: 42px;
  padding: 3px 10px;
  border: 0;
  border-right: 1px solid rgba(130, 210, 232, 0.14);
  border-radius: 0;
  background: transparent;
}

.floating-metric:last-child {
  border-right: 0;
}

.floating-metric span {
  display: block;
  margin-bottom: 5px;
  color: #a8c5d7;
  font-size: 11px;
}

.floating-metric strong {
  display: flex;
  align-items: baseline;
  gap: 4px;
  min-height: 22px;
  color: #f8fbff;
  line-height: 1;
  white-space: nowrap;
}

.floating-metric strong b {
  font-size: 19px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

.floating-metric strong small {
  color: currentColor;
  font-size: 12px;
  font-weight: 700;
  opacity: 0.92;
}

.floating-metric.current strong {
  color: #64f2ff;
}

.floating-metric.peak strong {
  color: #ffd86a;
}

.floating-metric.trend strong {
  color: #61eaa3;
}

.floating-metric.trend.down strong {
  color: #ff8fa3;
}

.floating-chart-block {
  flex: 1 1 auto;
  display: flex;
  min-height: 112px;
  flex-direction: column;
  margin: 8px 12px 0;
  padding: 8px 9px 4px;
  border: 1px solid rgba(0, 229, 255, 0.18);
  border-radius: 8px;
  background: rgba(2, 15, 26, 0.38);
}

.floating-chart-heading {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 0;
}

.floating-chart-heading span {
  color: #ffffff;
  font-size: 15px;
  font-weight: 800;
}

.floating-chart-heading b {
  color: #a9d8eb;
  font-size: 12px;
  font-weight: 500;
}

.floating-analysis-chart {
  flex: 1 1 auto;
  display: block;
  width: 100%;
  min-height: 0;
  height: 100%;
}

.floating-grid-lines line {
  stroke: rgba(150, 202, 220, 0.2);
  stroke-width: 1;
}

.floating-axis-labels text {
  fill: #9ed4e5;
  font-size: 11px;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
}

.floating-axis-labels.x-axis text {
  text-anchor: middle;
}

.floating-area-fill {
  fill: url(#floating-flood-area-fill);
}

.floating-area-line {
  stroke: #55efff;
  stroke-width: 3;
  filter: drop-shadow(0 0 5px rgba(85, 239, 255, 0.6));
}

.floating-area-dot {
  fill: #d7fff0;
  stroke: #32e6ff;
  stroke-width: 2;
}

.floating-resize-handle {
  position: absolute;
  right: 4px;
  bottom: 4px;
  width: 18px;
  height: 18px;
  cursor: nwse-resize;
  opacity: 0.75;
}

.floating-resize-handle::before,
.floating-resize-handle::after {
  content: "";
  position: absolute;
  right: 3px;
  bottom: 3px;
  border-right: 1px solid rgba(145, 231, 255, 0.85);
  border-bottom: 1px solid rgba(145, 231, 255, 0.85);
}

.floating-resize-handle::before {
  width: 12px;
  height: 12px;
}

.floating-resize-handle::after {
  width: 7px;
  height: 7px;
}

.floating-resize-handle:hover {
  opacity: 1;
}

@media (max-width: 640px) {
  .flood-area-floating-panel {
    min-width: 300px;
  }

  .floating-panel-header {
    min-height: 44px;
    font-size: 17px;
  }

  .floating-metric-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0;
    padding: 10px;
  }

  .floating-metric {
    min-height: 52px;
    padding: 8px 10px;
    border-right: 0;
    border-bottom: 1px solid rgba(130, 210, 232, 0.12);
  }

  .floating-metric strong {
    font-size: 17px;
  }

  .floating-analysis-chart {
    height: 190px;
  }
}
</style>
