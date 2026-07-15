<script setup lang="ts">
import { computed, ref } from 'vue';
import FpsWidget from './FpsWidget.vue';
import type { Viewer } from 'cesium';

withDefaults(defineProps<{
  viewer?: Viewer | null;
}>(), {
  viewer: null
});

type StationStatus = 'normal' | 'watch' | 'warning';

type MonitorStation = {
  name: string;
  river: string;
  waterLevel: number;
  warningLevel: number;
  flow: number;
  trend: number;
  rain1h: number;
  status: StationStatus;
};

const stations: MonitorStation[] = [
  { name: '金沙江上游站', river: '金沙江', waterLevel: 824.36, warningLevel: 825.0, flow: 1420, trend: 0.18, rain1h: 12.4, status: 'watch' },
  { name: '肖家桥水位站', river: '支沟汇入口', waterLevel: 431.82, warningLevel: 432.5, flow: 368, trend: 0.09, rain1h: 8.6, status: 'normal' },
  { name: '峡口断面站', river: '下游控制断面', waterLevel: 417.25, warningLevel: 417.0, flow: 612, trend: 0.22, rain1h: 15.1, status: 'warning' },
  { name: '城区泵站口', river: '内涝排涝渠', waterLevel: 98.64, warningLevel: 99.2, flow: 84, trend: -0.04, rain1h: 5.3, status: 'normal' }
];

const levelSeries = [421.6, 421.9, 422.1, 422.5, 423.0, 423.4, 423.9, 424.2, 424.8, 425.1, 425.4, 425.6];
const rainSeries = [0, 2.5, 5.8, 7.2, 9.4, 12.0, 16.5, 14.8, 10.6, 8.2, 4.8, 1.8];
const timeLabels = ['00', '02', '04', '06', '08', '10', '12'];

const onlineCount = stations.length;
const warningCount = stations.filter((station) => station.status === 'warning').length;
const watchCount = stations.filter((station) => station.status === 'watch').length;
const avgRain = computed(() => stations.reduce((sum, station) => sum + station.rain1h, 0) / stations.length);
const maxFlow = computed(() => Math.max(...stations.map((station) => station.flow)));

const chartPoints = computed(() => {
  const width = 252;
  const height = 88;
  const paddingX = 6;
  const paddingY = 8;
  const min = Math.min(...levelSeries) - 0.3;
  const max = Math.max(...levelSeries) + 0.3;
  const xStep = (width - paddingX * 2) / (levelSeries.length - 1);

  return levelSeries
    .map((value, index) => {
      const x = paddingX + index * xStep;
      const y = paddingY + (height - paddingY * 2) * (1 - (value - min) / (max - min));
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
});

const chartFillPoints = computed(() => `6,88 ${chartPoints.value} 246,88`);

const maxRain = computed(() => Math.max(...rainSeries));

const statusText: Record<StationStatus, string> = {
  normal: '正常',
  watch: '关注',
  warning: '超警'
};

type MonitorGroupId = 'status' | 'trends' | 'stationAlarm';

const monitorGroups = ref<Array<{ id: MonitorGroupId; title: string; expanded: boolean }>>([
  { id: 'status', title: '运行状态', expanded: false },
  { id: 'trends', title: '监测趋势', expanded: false },
  { id: 'stationAlarm', title: '站点告警', expanded: false }
]);

const isMonitorGroupExpanded = (id: MonitorGroupId) => (
  monitorGroups.value.find((group) => group.id === id)?.expanded ?? false
);

const toggleMonitorGroup = (id: MonitorGroupId) => {
  const group = monitorGroups.value.find((item) => item.id === id);
  if (group) {
    group.expanded = !group.expanded;
  }
};
</script>

<template>
  <section class="monitor-panel">
    <div class="monitor-group">
      <button type="button" class="monitor-group-header" @click="toggleMonitorGroup('status')">
        <span class="monitor-group-arrow" :class="{ expanded: isMonitorGroupExpanded('status') }">▶</span>
        <span>运行状态</span>
      </button>
      <div v-show="isMonitorGroupExpanded('status')" class="monitor-group-content">
        <FpsWidget mode="inline" />
    <div class="summary-grid">
      <div class="summary-card">
        <span class="summary-label">在线站点</span>
        <strong>{{ onlineCount }}</strong>
        <em>座</em>
      </div>
      <div class="summary-card danger">
        <span class="summary-label">超警站点</span>
        <strong>{{ warningCount }}</strong>
        <em>座</em>
      </div>
      <div class="summary-card">
        <span class="summary-label">平均雨强</span>
        <strong>{{ avgRain.toFixed(1) }}</strong>
        <em>mm/h</em>
      </div>
      <div class="summary-card">
        <span class="summary-label">最大流量</span>
        <strong>{{ maxFlow }}</strong>
        <em>m³/s</em>
      </div>
    </div>
      </div>
    </div>

    <div class="monitor-group">
      <button type="button" class="monitor-group-header" @click="toggleMonitorGroup('trends')">
        <span class="monitor-group-arrow" :class="{ expanded: isMonitorGroupExpanded('trends') }">▶</span>
        <span>监测趋势</span>
      </button>
      <div v-show="isMonitorGroupExpanded('trends')" class="monitor-group-content">
    <div class="chart-card">
      <div class="card-heading">
        <span>控制断面水位过程线</span>
        <b>近 24h</b>
      </div>
      <svg class="level-chart" viewBox="0 0 252 96" role="img" aria-label="近24小时水位趋势图">
        <line x1="6" y1="18" x2="246" y2="18" class="grid-line" />
        <line x1="6" y1="48" x2="246" y2="48" class="grid-line" />
        <line x1="6" y1="78" x2="246" y2="78" class="grid-line" />
        <polygon :points="chartFillPoints" class="level-fill" />
        <polyline :points="chartPoints" class="level-line" />
        <line x1="6" y1="31" x2="246" y2="31" class="warning-line" />
        <circle
          v-for="point in chartPoints.split(' ')"
          :key="point"
          :cx="Number(point.split(',')[0])"
          :cy="Number(point.split(',')[1])"
          r="2.5"
          class="level-dot"
        />
      </svg>
      <div class="chart-scale">
        <span v-for="label in timeLabels" :key="label">{{ label }}时</span>
      </div>
    </div>

    <div class="chart-card">
      <div class="card-heading">
        <span>小时雨量监测</span>
        <b>自动雨量站</b>
      </div>
      <div class="rain-chart">
        <div
          v-for="(rain, index) in rainSeries"
          :key="index"
          class="rain-bar"
          :style="{ height: `${Math.max(10, (rain / maxRain) * 82)}%` }"
        >
          <span>{{ rain }}</span>
        </div>
      </div>
    </div>
      </div>
    </div>

    <div class="monitor-group">
      <button type="button" class="monitor-group-header" @click="toggleMonitorGroup('stationAlarm')">
        <span class="monitor-group-arrow" :class="{ expanded: isMonitorGroupExpanded('stationAlarm') }">▶</span>
        <span>站点告警</span>
      </button>
      <div v-show="isMonitorGroupExpanded('stationAlarm')" class="monitor-group-content">
    <div class="station-card">
      <div class="card-heading">
        <span>水位监测站</span>
        <b>{{ watchCount + warningCount }} 条关注</b>
      </div>
      <div class="station-list">
        <div v-for="station in stations" :key="station.name" class="station-row" :class="station.status">
          <div class="station-main">
            <span class="status-dot"></span>
            <div>
              <strong>{{ station.name }}</strong>
              <small>{{ station.river }}</small>
            </div>
          </div>
          <div class="station-values">
            <span>{{ station.waterLevel.toFixed(2) }} m</span>
            <small>警戒 {{ station.warningLevel.toFixed(2) }}</small>
          </div>
          <div class="station-trend" :class="{ down: station.trend < 0 }">
            {{ station.trend > 0 ? '+' : '' }}{{ station.trend.toFixed(2) }} m/h
          </div>
          <span class="status-badge">{{ statusText[station.status] }}</span>
        </div>
      </div>
    </div>

    <div class="alarm-strip">
      <span class="alarm-label">最新告警</span>
      <p>峡口断面站水位已超过警戒线 0.25 m，建议联动下游淹没范围推演与重点区域巡查。</p>
    </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.monitor-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.monitor-group {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.monitor-group-header {
  display: flex;
  align-items: center;
  width: 100%;
  padding: 10px;
  border: 1px solid var(--sys-border-color-light, rgba(0, 229, 255, 0.1));
  border-radius: 4px;
  color: #ffffff;
  background-color: var(--sys-bg-glow, rgba(0, 229, 255, 0.15));
  cursor: pointer;
  font-size: 16px;
  font-weight: bold;
  text-align: left;
  transition: all 0.3s ease;
}

.monitor-group-header:hover {
  background-color: var(--sys-bg-glow-active, rgba(0, 229, 255, 0.3));
}

.monitor-group-arrow {
  margin-right: 8px;
  color: #00aeff;
  font-size: 10px;
  transition: transform 0.2s;
}

.monitor-group-arrow.expanded {
  transform: rotate(90deg);
}

.monitor-group-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.summary-card,
.chart-card,
.station-card,
.alarm-strip {
  border: 1px solid rgba(0, 229, 255, 0.16);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.045);
  box-shadow: inset 0 0 16px rgba(0, 229, 255, 0.05);
}

.summary-card {
  min-height: 72px;
  padding: 10px;
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: end;
  gap: 4px;
}

.summary-label {
  grid-column: 1 / -1;
  color: #8fb8d8;
  font-size: 12px;
}

.summary-card strong {
  color: #f7fbff;
  font-size: 24px;
  line-height: 1;
  font-weight: 700;
  text-shadow: 0 0 10px rgba(0, 229, 255, 0.45);
}

.summary-card em {
  color: #7fdfff;
  font-size: 12px;
  font-style: normal;
}

.summary-card.danger strong {
  color: #ffcc66;
  text-shadow: 0 0 12px rgba(255, 181, 71, 0.45);
}

.chart-card,
.station-card {
  padding: 10px;
}

.card-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  color: #e7f6ff;
  font-size: 13px;
  font-weight: 700;
}

.card-heading b {
  color: #7fb6d5;
  font-size: 11px;
  font-weight: 500;
}

.level-chart {
  width: 100%;
  height: 96px;
  display: block;
  overflow: visible;
}

.grid-line {
  stroke: rgba(127, 182, 213, 0.16);
  stroke-width: 1;
}

.warning-line {
  stroke: rgba(255, 198, 87, 0.78);
  stroke-width: 1.2;
  stroke-dasharray: 5 5;
}

.level-fill {
  fill: rgba(0, 229, 255, 0.14);
}

.level-line {
  fill: none;
  stroke: #31e6ff;
  stroke-width: 2.4;
  stroke-linecap: round;
  stroke-linejoin: round;
  filter: drop-shadow(0 0 5px rgba(49, 230, 255, 0.55));
}

.level-dot {
  fill: #d9fbff;
  stroke: rgba(0, 229, 255, 0.5);
  stroke-width: 1;
}

.chart-scale {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  color: #7096ad;
  font-size: 10px;
}

.chart-scale span {
  text-align: center;
}

.rain-chart {
  height: 90px;
  display: grid;
  grid-template-columns: repeat(12, 1fr);
  align-items: end;
  gap: 5px;
  padding-top: 4px;
}

.rain-bar {
  position: relative;
  min-height: 10px;
  border-radius: 4px 4px 2px 2px;
  background: linear-gradient(180deg, #76f6ff 0%, #287dff 100%);
  box-shadow: 0 0 9px rgba(64, 207, 255, 0.28);
}

.rain-bar span {
  position: absolute;
  left: 50%;
  bottom: calc(100% + 3px);
  transform: translateX(-50%);
  color: #9fc9e0;
  font-size: 9px;
  white-space: nowrap;
}

.station-list {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.station-row {
  display: grid;
  grid-template-columns: 1.35fr 0.95fr auto auto;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border-radius: 6px;
  background: rgba(4, 18, 34, 0.54);
  border: 1px solid rgba(127, 182, 213, 0.12);
}

.station-row.warning {
  border-color: rgba(255, 190, 83, 0.5);
  background: rgba(80, 44, 12, 0.22);
}

.station-main {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: 7px;
}

.station-main strong,
.station-values span {
  display: block;
  color: #f8fdff;
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
}

.station-main small,
.station-values small {
  display: block;
  color: #7fa4bb;
  font-size: 10px;
  margin-top: 3px;
  white-space: nowrap;
}

.status-dot {
  width: 8px;
  height: 8px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: #48f2a6;
  box-shadow: 0 0 8px rgba(72, 242, 166, 0.8);
}

.station-row.watch .status-dot {
  background: #ffd46d;
  box-shadow: 0 0 8px rgba(255, 212, 109, 0.8);
}

.station-row.warning .status-dot {
  background: #ff7b57;
  box-shadow: 0 0 8px rgba(255, 123, 87, 0.8);
}

.station-trend {
  color: #80f5ff;
  font-size: 11px;
  white-space: nowrap;
}

.station-trend.down {
  color: #74e29c;
}

.status-badge {
  min-width: 34px;
  padding: 3px 5px;
  border-radius: 4px;
  color: #b9ecff;
  background: rgba(0, 229, 255, 0.09);
  border: 1px solid rgba(0, 229, 255, 0.2);
  text-align: center;
  font-size: 10px;
}

.station-row.warning .status-badge {
  color: #ffdba8;
  background: rgba(255, 190, 83, 0.12);
  border-color: rgba(255, 190, 83, 0.42);
}

.alarm-strip {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 8px;
  padding: 9px 10px;
  align-items: start;
}

.alarm-label {
  padding: 3px 6px;
  border-radius: 4px;
  color: #fff1c8;
  background: rgba(255, 190, 83, 0.18);
  border: 1px solid rgba(255, 190, 83, 0.38);
  font-size: 11px;
}

.alarm-strip p {
  margin: 0;
  color: #cfe6f5;
  font-size: 12px;
  line-height: 1.55;
}

@media (max-width: 1180px) {
  .station-row {
    grid-template-columns: 1fr;
    align-items: start;
  }

  .status-badge {
    width: fit-content;
  }
}
</style>
