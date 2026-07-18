<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import * as Cesium from 'cesium';
import DrawTriangleMesh from '../js/DrawTriangleMesh';
import AccuracyEvaluationPanel from './AccuracyEvaluationPanel.vue';
import {
  clearFloodDepthMonitorPoint,
  currentFloodFrame,
  currentFloodPointDepthM,
  currentShowcaseCaseId,
  floodPointDepthSeries,
  lastLoadedFloodJson,
  recordFloodPointDepth,
  sampleFloodDepthAtGridPoint,
  selectedFloodDepthPoint,
  setFloodDepthMonitorPoint
} from '../store/floodState';

const props = defineProps<{
  viewer?: Cesium.Viewer | null;
}>();

const CHART_WIDTH = 280;
const CHART_HEIGHT = 150;
const PLOT_LEFT = 48;
const PLOT_RIGHT = 270;
const PLOT_TOP = 14;
const PLOT_BOTTOM = 118;
type CaseLayerConfig = {
  caseId: string;
  buildingUrl: string;
  roadUrl: string;
  buildingLabel: string;
  roadLabel: string;
  buildingDataSourceName: string;
  roadDataSourceName: string;
  filterByCamera: boolean;
};
const CASE_LAYER_CONFIGS: Record<string, CaseLayerConfig> = {
  xiaojiaqiao: {
    caseId: 'xiaojiaqiao',
    buildingUrl: '/data/buildings/clipxiaojiaqiao/clipxiaojiaqiaojson.geojson',
    roadUrl: '/data/road/clipxiaojiaqiao/clipxiaojiaqiaoroad.geojson',
    buildingLabel: '肖家桥三维建筑',
    roadLabel: '肖家桥道路',
    buildingDataSourceName: 'xiaojiaqiao_3d_buildings',
    roadDataSourceName: 'xiaojiaqiao_roads',
    filterByCamera: true
  },
  yongchuan: {
    caseId: 'yongchuan',
    buildingUrl: '/data/buildings/yongchuan/yongchuan_buildings.geojson.json',
    roadUrl: '/data/road/yongchuan/yongchuan_road.geojson.json',
    buildingLabel: '永川三维建筑',
    roadLabel: '永川道路',
    buildingDataSourceName: 'yongchuan_3d_buildings',
    roadDataSourceName: 'yongchuan_roads',
    filterByCamera: false
  }
};
const BUILDING_BASE_HEIGHT_M = 0;
const BUILDING_MIN_HEIGHT_M = 8;
const BUILDING_MAX_HEIGHT_M = 38;
const BUILDING_DEFAULT_COLOR = Cesium.Color.fromCssColorString('#c8d2d8');
const BUILDING_FLOODED_COLOR = Cesium.Color.fromCssColorString('#e23b32');
const BUILDING_SAFE_COLOR = Cesium.Color.fromCssColorString('#4bc36a');
const ROAD_DEFAULT_COLOR = Cesium.Color.fromCssColorString('#a9bed0');
const ROAD_OUTLINE_COLOR = Cesium.Color.fromCssColorString('#102333');
const ROAD_FLOODED_COLOR = Cesium.Color.fromCssColorString('#ff4f5f');
const ROAD_SAFE_COLOR = Cesium.Color.fromCssColorString('#39dd8a');
const ROAD_WIDTH_PX = 2.2;
const ROAD_MIN_WIDTH_PX = 1.1;
const ROAD_NEAR_CAMERA_HEIGHT_M = 8000;
const ROAD_FAR_CAMERA_HEIGHT_M = 80000;
const makeSvgDataUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
const DEPTH_MARKER_IMAGE = makeSvgDataUrl(`
<svg xmlns="http://www.w3.org/2000/svg" width="640" height="720" viewBox="0 0 160 180">
  <path
    d="M80 8 C43 8 18 36 18 72 C18 112 70 154 80 174 C90 154 142 112 142 72 C142 36 117 8 80 8 Z"
    fill="#ffc338"
    stroke="#07111b"
    stroke-width="7"
    stroke-linejoin="round"
  />
  <path
    d="M80 18 C49 18 29 41 29 72 C29 102 68 136 80 156 C92 136 131 102 131 72 C131 41 111 18 80 18 Z"
    fill="#ffd85a"
    stroke="#fff8d2"
    stroke-width="3"
    stroke-linejoin="round"
  />

  <circle cx="80" cy="66" r="28" fill="#1f1a10" stroke="#fffdf0" stroke-width="5"/>
  <circle cx="80" cy="66" r="14" fill="#ffffff"/>
  <circle cx="80" cy="66" r="7" fill="#07111b"/>
  <path d="M68 48 C74 42 86 42 92 48" fill="none" stroke="#fffdf0" stroke-width="4" stroke-linecap="round"/>
</svg>
`);

type ChartPoint = {
  frame: number;
  value: number;
  x: number;
  y: number;
};

type BuildingStats = {
  total: number;
  flooded: number;
  safe: number;
};

type RoadStats = {
  total: number;
  flooded: number;
  safe: number;
};

type BuildingFootprintGeometry = {
  type?: 'Polygon' | 'MultiPolygon';
  coordinates?: number[][][] | number[][][][];
  rings?: number[][][];
};

type BuildingFootprintFeature = {
  type?: 'Feature';
  geometry?: BuildingFootprintGeometry | null;
  properties?: Record<string, unknown>;
  attributes?: Record<string, unknown>;
};

type BuildingFootprintCollection = {
  type?: 'FeatureCollection';
  features: BuildingFootprintFeature[];
};

type BuildingFeatureEntityRecord = {
  feature: BuildingFootprintFeature;
  entities: Cesium.Entity[];
};

type RoadGeometry = {
  type?: 'LineString' | 'MultiLineString';
  coordinates?: number[][] | number[][][];
  paths?: number[][][];
};

type RoadFeature = {
  type?: 'Feature';
  geometry?: RoadGeometry | null;
  properties?: Record<string, unknown>;
  attributes?: Record<string, unknown>;
};

type RoadCollection = {
  type?: 'FeatureCollection';
  features: RoadFeature[];
};

type RoadFeatureEntityRecord = {
  feature: RoadFeature;
  entities: Cesium.Entity[];
};

type BuildingViewBounds = {
  west: number;
  east: number;
  south: number;
  north: number;
};

const isPickingDepthPoint = ref(false);
const depthPickMessage = ref('');
const buildingLayerLoading = ref(false);
const buildingLayerShown = ref(false);
const buildingLayerMessage = ref('');
const buildingStats = ref<BuildingStats>({ total: 0, flooded: 0, safe: 0 });
const buildingDataSource = ref<Cesium.CustomDataSource | null>(null);
let buildingFeatureEntityRecords: BuildingFeatureEntityRecord[] = [];
const roadLayerLoading = ref(false);
const roadLayerShown = ref(false);
const roadLayerMessage = ref('');
const roadStats = ref<RoadStats>({ total: 0, flooded: 0, safe: 0 });
const roadDataSource = ref<Cesium.CustomDataSource | null>(null);
const uploadedBuildingLayerName = ref('');
const uploadedRoadLayerName = ref('');
const buildingUploadInputRef = ref<HTMLInputElement | null>(null);
const roadUploadInputRef = ref<HTMLInputElement | null>(null);
let roadFeatureEntityRecords: RoadFeatureEntityRecord[] = [];
let pickHandler: Cesium.ScreenSpaceEventHandler | null = null;
let depthMarker: Cesium.Entity | null = null;
let markerViewer: Cesium.Viewer | null = null;
let buildingLayerViewer: Cesium.Viewer | null = null;
let previousDepthTestAgainstTerrain: boolean | null = null;
let isPanelDisposed = false;

const activeLayerConfig = computed<CaseLayerConfig | null>(() => (
  CASE_LAYER_CONFIGS[currentShowcaseCaseId.value ?? ''] ?? null
));
const activeBuildingLayerLabel = computed(() => uploadedBuildingLayerName.value || activeLayerConfig.value?.buildingLabel || '未选择案例');
const activeRoadLayerLabel = computed(() => uploadedRoadLayerName.value || activeLayerConfig.value?.roadLabel || '未选择案例');

const sortedDepthSeries = computed(() => (
  floodPointDepthSeries.value
    .filter((point) => Number.isFinite(point.frame) && Number.isFinite(point.depthM))
    .sort((a, b) => a.frame - b.frame)
));

const latestDepthPoint = computed(() => {
  const series = sortedDepthSeries.value;
  return series.length ? series[series.length - 1] : null;
});

const hasDepthPoint = computed(() => selectedFloodDepthPoint.value !== null);
const hasDepthData = computed(() => sortedDepthSeries.value.length > 0);
type AnalysisGroupId = 'depth' | 'assets' | 'accuracy';

const analysisGroups = ref<Array<{ id: AnalysisGroupId; title: string; expanded: boolean; visible: boolean }>>([
  { id: 'depth', title: '点位水深分析', expanded: false, visible: true },
  { id: 'assets', title: '承灾体淹没分析', expanded: false, visible: true },
  { id: 'accuracy', title: '精度评价', expanded: false, visible: true }
]);
const panelReady = ref(false);
let panelReadyFrame = 0;

const isAnalysisGroupExpanded = (id: AnalysisGroupId) => (
  analysisGroups.value.find((group) => group.id === id)?.expanded ?? false
);

const toggleAnalysisGroup = (id: AnalysisGroupId) => {
  const group = analysisGroups.value.find((item) => item.id === id);
  if (group) {
    group.expanded = !group.expanded;
  }
};

const isAnalysisGroupVisible = (id: AnalysisGroupId) => (
  analysisGroups.value.find((group) => group.id === id)?.visible ?? false
);

const closeAnalysisGroup = (id: AnalysisGroupId) => {
  const group = analysisGroups.value.find((item) => item.id === id);
  if (group) {
    group.visible = false;
  }
};
const latestDepthM = computed(() => latestDepthPoint.value?.depthM ?? currentFloodPointDepthM.value);

const smoothDepthSeries = computed(() => {
  const series = sortedDepthSeries.value;
  if (series.length < 4) {
    return series;
  }

  const radius = 2;
  return series.map((point, index) => {
    const window = series.slice(
      Math.max(0, index - radius),
      Math.min(series.length, index + radius + 1)
    );
    const averageDepth = window.reduce((sum, item) => sum + item.depthM, 0) / window.length;
    return {
      frame: point.frame,
      depthM: averageDepth
    };
  });
});

const maxSmoothedDepthM = computed(() => Math.max(0, ...smoothDepthSeries.value.map((point) => point.depthM)));

const formatDepth = (depthM: number) => {
  if (!Number.isFinite(depthM)) {
    return '--';
  }

  return `${Math.max(0, depthM).toFixed(depthM >= 10 ? 1 : 2)} m`;
};

const buildChartPoints = (series: Array<{ frame: number; value: number }>, maxValue: number): ChartPoint[] => {
  if (!series.length) {
    return [];
  }

  const firstFrame = series[0].frame;
  const lastFrame = series[series.length - 1].frame;
  const frameSpan = Math.max(1, lastFrame - firstFrame);
  const safeMax = Math.max(1, maxValue);
  const plotWidth = PLOT_RIGHT - PLOT_LEFT;
  const plotHeight = PLOT_BOTTOM - PLOT_TOP;

  const points = series.map((point) => ({
    frame: point.frame,
    value: point.value,
    x: PLOT_LEFT + ((point.frame - firstFrame) / frameSpan) * plotWidth,
    y: PLOT_BOTTOM - (Math.max(0, point.value) / safeMax) * plotHeight
  }));

  if (points.length === 1) {
    const only = points[0];
    return [
      { ...only, x: PLOT_LEFT },
      { ...only, x: PLOT_RIGHT }
    ];
  }

  return points;
};

const buildLine = (points: ChartPoint[]) => (
  points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ')
);

const buildFill = (points: ChartPoint[], line: string) => {
  if (!points.length) {
    return '';
  }

  const first = points[0];
  const last = points[points.length - 1];
  return `${first.x.toFixed(1)},${PLOT_BOTTOM} ${line} ${last.x.toFixed(1)},${PLOT_BOTTOM}`;
};

const sampleDots = (points: ChartPoint[]) => {
  const sampleStep = Math.max(1, Math.ceil(points.length / 32));
  return points.filter((_, index) => index % sampleStep === 0 || index === points.length - 1);
};

const buildXTicks = (series: Array<{ frame: number }>) => {
  if (!series.length) {
    return [];
  }

  const firstFrame = series[0].frame;
  const lastFrame = series[series.length - 1].frame;
  if (firstFrame === lastFrame) {
    return [{ frame: firstFrame, x: (PLOT_LEFT + PLOT_RIGHT) / 2 }];
  }

  const frameSpan = Math.max(1, lastFrame - firstFrame);
  return Array.from(new Set([
    firstFrame,
    Math.round(firstFrame + frameSpan / 2),
    lastFrame
  ])).map((frame) => ({
    frame,
    x: PLOT_LEFT + ((frame - firstFrame) / frameSpan) * (PLOT_RIGHT - PLOT_LEFT)
  }));
};

const buildYTicks = (maxValue: number, formatter: (value: number) => string) => {
  const safeMax = Math.max(1, maxValue);
  const midY = PLOT_TOP + (PLOT_BOTTOM - PLOT_TOP) / 2;
  return [
    { y: PLOT_TOP, label: formatter(safeMax) },
    { y: midY, label: formatter(safeMax / 2) },
    { y: PLOT_BOTTOM, label: formatter(0) }
  ];
};

const depthChartPoints = computed(() => buildChartPoints(
  smoothDepthSeries.value.map((point) => ({ frame: point.frame, value: point.depthM })),
  maxSmoothedDepthM.value
));
const depthLinePoints = computed(() => buildLine(depthChartPoints.value));
const depthFillPoints = computed(() => buildFill(depthChartPoints.value, depthLinePoints.value));
const depthDotPoints = computed(() => sampleDots(depthChartPoints.value));
const depthYTicks = computed(() => buildYTicks(maxSmoothedDepthM.value, formatDepth));
const depthXTicks = computed(() => buildXTicks(sortedDepthSeries.value));

const depthSampleStatus = computed(() => {
  const point = selectedFloodDepthPoint.value;
  if (!point) {
    return '未选点';
  }

  if (point.sampleMode === 'triangle') {
    return '三角网插值';
  }

  if (point.sampleMode === 'nearest') {
    return '近邻采样';
  }

  return '未淹没或超出范围';
});

const depthSeriesSummaryLabel = computed(() => (
  latestDepthPoint.value ? `至 ${latestDepthPoint.value.frame} 帧` : depthSampleStatus.value
));

const buildingLayerStatus = computed(() => {
  if (buildingLayerLoading.value) {
    return '加载中';
  }

  if (buildingLayerShown.value) {
    return '已显示';
  }

  return buildingDataSource.value ? '已隐藏' : '未加载';
});

const buildingToggleLabel = computed(() => {
  if (buildingLayerLoading.value) {
    return '加载中';
  }

  if (!buildingDataSource.value) {
    return activeLayerConfig.value ? `加载${activeLayerConfig.value.buildingLabel}` : '上传建筑物';
  }

  return buildingLayerShown.value ? `隐藏${activeBuildingLayerLabel.value}` : `显示${activeBuildingLayerLabel.value}`;
});

const roadLayerStatus = computed(() => {
  if (roadLayerLoading.value) {
    return '加载中';
  }

  if (roadLayerShown.value) {
    return '已显示';
  }

  return roadDataSource.value ? '已隐藏' : '未加载';
});

const roadToggleLabel = computed(() => {
  if (roadLayerLoading.value) {
    return '加载中';
  }

  if (!roadDataSource.value) {
    return activeLayerConfig.value ? `加载${activeLayerConfig.value.roadLabel}` : '上传道路';
  }

  return roadLayerShown.value ? `隐藏${activeRoadLayerLabel.value}` : `显示${activeRoadLayerLabel.value}`;
});

const depthPointLabel = computed(() => {
  const point = selectedFloodDepthPoint.value;
  if (!point) {
    return '--';
  }

  return `${point.lon.toFixed(5)}, ${point.lat.toFixed(5)}`;
});

const stopDepthPick = () => {
  if (pickHandler && !pickHandler.isDestroyed()) {
    pickHandler.destroy();
  }
  pickHandler = null;
  isPickingDepthPoint.value = false;
};

const removeDepthMarker = () => {
  if (depthMarker && markerViewer) {
    markerViewer.entities.remove(depthMarker);
  }
  depthMarker = null;
  markerViewer = null;
};

const updateDepthMarker = () => {
  removeDepthMarker();
  const viewer = props.viewer;
  const point = selectedFloodDepthPoint.value;
  if (!viewer || !point) {
    return;
  }

  markerViewer = viewer;
  depthMarker = viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(point.lon, point.lat, point.height),
    billboard: {
      image: DEPTH_MARKER_IMAGE,
      width: 54,
      height: 61,
      horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    }
  });
};

const pickCartesian = (position: Cesium.Cartesian2 | undefined) => {
  const viewer = props.viewer;
  if (!viewer || !position) {
    return null;
  }

  try {
    if (viewer.scene.pickPositionSupported) {
      const picked = viewer.scene.pickPosition(position);
      if (Cesium.defined(picked)) {
        return picked;
      }
    }
  } catch {
    // Fall back to globe picking.
  }

  const ray = viewer.camera.getPickRay(position);
  return ray ? viewer.scene.globe.pick(ray, viewer.scene) ?? null : null;
};

const isCachedMeshFloodData = (data: any) => (
  Array.isArray(data?.positions)
  && Array.isArray(data?.values)
  && Array.isArray(data?.triangles)
);

const handleDepthPointPicked = (movement: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
  const cartesian = pickCartesian(movement.position);
  if (!cartesian) {
    depthPickMessage.value = '未拾取到有效位置';
    stopDepthPick();
    return;
  }

  const floodJson = lastLoadedFloodJson.value;
  if (!floodJson) {
    depthPickMessage.value = '请先加载或播放洪水数据';
    stopDepthPick();
    return;
  }

  const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
  const lon = Cesium.Math.toDegrees(cartographic.longitude);
  const lat = Cesium.Math.toDegrees(cartographic.latitude);
  const gridPoint = isCachedMeshFloodData(floodJson)
    ? { x: lon, y: lat }
    : DrawTriangleMesh.worldToFloodGrid(cartesian);

  if (!gridPoint) {
    depthPickMessage.value = '请先加载或播放洪水数据';
    stopDepthPick();
    return;
  }

  const sample = setFloodDepthMonitorPoint({
    lon,
    lat,
    height: cartographic.height,
    gridX: gridPoint.x,
    gridY: gridPoint.y
  }, floodJson);

  if (currentFloodFrame.value > 0) {
    recordFloodPointDepth(currentFloodFrame.value, floodJson);
  }

  depthPickMessage.value = sample.mode === 'outside'
    ? '点位已记录，当前帧未淹没或不在网格范围内'
    : `点位已记录，当前水深 ${formatDepth(sample.depthM)}`;
  stopDepthPick();
  updateDepthMarker();
};

const startDepthPick = () => {
  const viewer = props.viewer;
  if (!viewer) {
    depthPickMessage.value = '地图尚未准备好';
    return;
  }

  const floodJson = lastLoadedFloodJson.value;
  if (!floodJson || (!isCachedMeshFloodData(floodJson) && !DrawTriangleMesh.getCurrentModelMatrix())) {
    depthPickMessage.value = '请先加载或播放一帧洪水数据';
    return;
  }

  stopDepthPick();
  isPickingDepthPoint.value = true;
  depthPickMessage.value = '请在地图上点击一个监测点';
  pickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  pickHandler.setInputAction(handleDepthPointPicked, Cesium.ScreenSpaceEventType.LEFT_CLICK);
};

const clearDepthPoint = () => {
  stopDepthPick();
  clearFloodDepthMonitorPoint();
  removeDepthMarker();
  depthPickMessage.value = '点位已清除';
};

const refreshBuildingColors = () => {
  if (!buildingDataSource.value || !buildingLayerShown.value) {
    return;
  }

  void analyzeBuildingFlooding();
};

const refreshRoadColors = () => {
  if (!roadDataSource.value || !roadLayerShown.value) {
    return;
  }

  void analyzeRoadFlooding();
};

const sleep = (durationMs = 0) => new Promise<void>((resolve) => {
  window.setTimeout(resolve, durationMs);
});

const showBuildingLoadMessage = async (message: string) => {
  buildingLayerMessage.value = message;
  await nextTick();
  await sleep(16);
};

const showRoadLoadMessage = async (message: string) => {
  roadLayerMessage.value = message;
  await nextTick();
  await sleep(16);
};

const getPolygonRings = (geometry?: BuildingFootprintGeometry | null) => {
  if (!geometry) {
    return [];
  }

  if (Array.isArray(geometry.rings)) {
    return [geometry.rings];
  }

  if (geometry.type === 'Polygon' && Array.isArray(geometry.coordinates)) {
    return [geometry.coordinates as number[][][]];
  }

  if (geometry.type === 'MultiPolygon' && Array.isArray(geometry.coordinates)) {
    return geometry.coordinates as number[][][][];
  }

  return [];
};

const getRoadLineStrings = (geometry?: RoadGeometry | null) => {
  if (!geometry) {
    return [];
  }

  if (Array.isArray(geometry.paths)) {
    return geometry.paths;
  }

  if (geometry.type === 'LineString' && Array.isArray(geometry.coordinates)) {
    return [geometry.coordinates as number[][]];
  }

  if (geometry.type === 'MultiLineString' && Array.isArray(geometry.coordinates)) {
    return geometry.coordinates as number[][][];
  }

  return [];
};

const getRingCentroid = (ring: number[][]) => {
  let longitudeSum = 0;
  let latitudeSum = 0;
  let count = 0;

  ring.forEach((coordinate) => {
    const longitude = Number(coordinate[0]);
    const latitude = Number(coordinate[1]);
    if (Number.isFinite(longitude) && Number.isFinite(latitude)) {
      longitudeSum += longitude;
      latitudeSum += latitude;
      count += 1;
    }
  });

  return count > 0
    ? { longitude: longitudeSum / count, latitude: latitudeSum / count }
    : null;
};

const getFeatureProperties = (feature: BuildingFootprintFeature | RoadFeature) => (
  feature.properties ?? feature.attributes ?? {}
);

const getBuildingExtrudedHeight = (feature: BuildingFootprintFeature) => {
  const properties = getFeatureProperties(feature);
  const rawArea = Number(properties.Area ?? properties.Shape_Area ?? 0);
  const areaHeight = Number.isFinite(rawArea) && rawArea > 0
    ? Math.sqrt(rawArea) * 1.35
    : BUILDING_MIN_HEIGHT_M;

  return Math.min(BUILDING_MAX_HEIGHT_M, Math.max(BUILDING_MIN_HEIGHT_M, areaHeight));
};

const getPolygonHierarchy = (polygon: number[][][]) => {
  const rings = polygon
    .map((ring) => ring
      .map((coordinate) => {
        const longitude = Number(coordinate[0]);
        const latitude = Number(coordinate[1]);
        return Number.isFinite(longitude) && Number.isFinite(latitude)
          ? Cesium.Cartesian3.fromDegrees(longitude, latitude, BUILDING_BASE_HEIGHT_M)
          : null;
      })
      .filter((position): position is Cesium.Cartesian3 => position !== null))
    .filter((ring) => ring.length >= 3);

  if (!rings.length) {
    return null;
  }

  return new Cesium.PolygonHierarchy(
    rings[0],
    rings.slice(1).map((ring) => new Cesium.PolygonHierarchy(ring))
  );
};

const getCurrentCameraBounds = (viewer: Cesium.Viewer): BuildingViewBounds | null => {
  const rectangle = viewer.camera.computeViewRectangle(viewer.scene.globe.ellipsoid);
  if (!rectangle) {
    return null;
  }

  return {
    west: Cesium.Math.toDegrees(rectangle.west),
    east: Cesium.Math.toDegrees(rectangle.east),
    south: Cesium.Math.toDegrees(rectangle.south),
    north: Cesium.Math.toDegrees(rectangle.north)
  };
};

const getFeatureBounds = (feature: BuildingFootprintFeature): BuildingViewBounds | null => {
  let west = Number.POSITIVE_INFINITY;
  let east = Number.NEGATIVE_INFINITY;
  let south = Number.POSITIVE_INFINITY;
  let north = Number.NEGATIVE_INFINITY;

  getPolygonRings(feature.geometry).forEach((polygon) => {
    polygon.forEach((ring) => {
      ring.forEach((coordinate) => {
        const longitude = Number(coordinate[0]);
        const latitude = Number(coordinate[1]);
        if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
          return;
        }
        west = Math.min(west, longitude);
        east = Math.max(east, longitude);
        south = Math.min(south, latitude);
        north = Math.max(north, latitude);
      });
    });
  });

  if (![west, east, south, north].every(Number.isFinite)) {
    return null;
  }

  return { west, east, south, north };
};

const getRoadFeatureBounds = (feature: RoadFeature): BuildingViewBounds | null => {
  let west = Number.POSITIVE_INFINITY;
  let east = Number.NEGATIVE_INFINITY;
  let south = Number.POSITIVE_INFINITY;
  let north = Number.NEGATIVE_INFINITY;

  getRoadLineStrings(feature.geometry).forEach((line) => {
    line.forEach((coordinate) => {
      const longitude = Number(coordinate[0]);
      const latitude = Number(coordinate[1]);
      if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
        return;
      }
      west = Math.min(west, longitude);
      east = Math.max(east, longitude);
      south = Math.min(south, latitude);
      north = Math.max(north, latitude);
    });
  });

  if (![west, east, south, north].every(Number.isFinite)) {
    return null;
  }

  return { west, east, south, north };
};

const boundsIntersect = (a: BuildingViewBounds, b: BuildingViewBounds) => (
  a.west <= b.east &&
  a.east >= b.west &&
  a.south <= b.north &&
  a.north >= b.south
);

const isFeatureInCameraBounds = (feature: BuildingFootprintFeature, cameraBounds: BuildingViewBounds) => {
  const featureBounds = getFeatureBounds(feature);
  return featureBounds ? boundsIntersect(featureBounds, cameraBounds) : false;
};

const isRoadFeatureInCameraBounds = (feature: RoadFeature, cameraBounds: BuildingViewBounds) => {
  const featureBounds = getRoadFeatureBounds(feature);
  return featureBounds ? boundsIntersect(featureBounds, cameraBounds) : false;
};

const getFloodSamplePoint = (longitude: number, latitude: number, floodJson: any) => {
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    return null;
  }

  if (isCachedMeshFloodData(floodJson)) {
    return { x: longitude, y: latitude };
  }

  const worldPosition = Cesium.Cartesian3.fromDegrees(longitude, latitude);
  return DrawTriangleMesh.worldToFloodGrid(worldPosition);
};

const hasUsableFloodFrame = (floodJson: any) => (
  Boolean(floodJson) &&
  (isCachedMeshFloodData(floodJson) || Boolean(DrawTriangleMesh.getCurrentModelMatrix()))
);

const analyzeBuildingFootprintFlooding = (feature: BuildingFootprintFeature, floodJson: any) => {
  const polygons = getPolygonRings(feature.geometry);
  let maxDepthM = 0;
  let sampled = false;

  polygons.forEach((polygon) => {
    const outerRing = polygon[0];
    if (!outerRing?.length) {
      return;
    }

    const centroid = getRingCentroid(outerRing);
    if (!centroid) {
      return;
    }

    const gridPoint = getFloodSamplePoint(centroid.longitude, centroid.latitude, floodJson);
    if (!gridPoint) {
      return;
    }

    const sample = sampleFloodDepthAtGridPoint(floodJson, gridPoint.x, gridPoint.y);
    sampled = true;
    maxDepthM = Math.max(maxDepthM, sample.depthM);
  });

  return {
    flooded: sampled && maxDepthM > 0,
    sampled,
    depthM: maxDepthM
  };
};

const setBuildingEntityColor = (entity: Cesium.Entity, color: Cesium.Color) => {
  if (!entity.polygon) {
    return;
  }

  entity.polygon.material = new Cesium.ColorMaterialProperty(color);
};

const setRoadEntityColor = (entity: Cesium.Entity, color: Cesium.Color) => {
  if (!entity.polyline) {
    return;
  }

  entity.polyline.material = new Cesium.PolylineOutlineMaterialProperty({
    color,
    outlineColor: ROAD_OUTLINE_COLOR,
    outlineWidth: 1
  });
};

const getRoadClass = (feature: RoadFeature) => String(getFeatureProperties(feature).fclass ?? '').toLowerCase();

const getRoadVisualStyle = (feature: RoadFeature) => {
  const roadClass = getRoadClass(feature);

  if (roadClass.includes('primary') || roadClass.includes('trunk')) {
    return {
      color: ROAD_DEFAULT_COLOR,
      width: ROAD_WIDTH_PX + 1.2
    };
  }

  if (roadClass.includes('secondary') || roadClass.includes('tertiary')) {
    return {
      color: ROAD_DEFAULT_COLOR,
      width: ROAD_WIDTH_PX + 0.6
    };
  }

  return {
    color: ROAD_DEFAULT_COLOR,
    width: ROAD_WIDTH_PX
  };
};

const getCameraAdjustedRoadWidth = (baseWidth: number) => {
  const cameraHeight = props.viewer?.camera.positionCartographic.height ?? Number.NaN;
  if (!Number.isFinite(cameraHeight)) {
    return baseWidth;
  }

  if (cameraHeight >= ROAD_FAR_CAMERA_HEIGHT_M) {
    return ROAD_MIN_WIDTH_PX;
  }

  if (cameraHeight <= ROAD_NEAR_CAMERA_HEIGHT_M) {
    return baseWidth;
  }

  const progress = (ROAD_FAR_CAMERA_HEIGHT_M - cameraHeight) / (ROAD_FAR_CAMERA_HEIGHT_M - ROAD_NEAR_CAMERA_HEIGHT_M);
  return ROAD_MIN_WIDTH_PX + (baseWidth - ROAD_MIN_WIDTH_PX) * progress;
};

const addBuildingLayerEntity = (
  dataSource: Cesium.CustomDataSource,
  feature: BuildingFootprintFeature,
  polygon: number[][][]
): Cesium.Entity | null => {
  const hierarchy = getPolygonHierarchy(polygon);
  if (!hierarchy) {
    return null;
  }

  const extrudedHeight = getBuildingExtrudedHeight(feature);
  return dataSource.entities.add({
    polygon: {
      hierarchy,
      height: BUILDING_BASE_HEIGHT_M,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      extrudedHeight,
      extrudedHeightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
      closeTop: true,
      closeBottom: true,
      material: BUILDING_DEFAULT_COLOR,
      outline: false
    }
  });
};

const addRoadLayerEntity = (
  dataSource: Cesium.CustomDataSource,
  feature: RoadFeature,
  line: number[][]
): Cesium.Entity | null => {
  const positions = line
    .map((coordinate) => {
      const longitude = Number(coordinate[0]);
      const latitude = Number(coordinate[1]);
      return Number.isFinite(longitude) && Number.isFinite(latitude)
        ? Cesium.Cartesian3.fromDegrees(longitude, latitude, 1.2)
        : null;
    })
    .filter((position): position is Cesium.Cartesian3 => position !== null);

  if (positions.length < 2) {
    return null;
  }

  const style = getRoadVisualStyle(feature);
  return dataSource.entities.add({
    polyline: {
      positions,
      width: new Cesium.CallbackProperty(() => getCameraAdjustedRoadWidth(style.width), false),
      material: new Cesium.PolylineOutlineMaterialProperty({
        color: style.color,
        outlineColor: ROAD_OUTLINE_COLOR,
        outlineWidth: 0.6
      }),
      clampToGround: true
    }
  });
};

const analyzeBuildingFlooding = async () => {
  const viewer = props.viewer;
  const dataSource = buildingDataSource.value;
  const floodJson = lastLoadedFloodJson.value;

  if (!viewer || !dataSource || !buildingLayerShown.value) {
    buildingLayerMessage.value = '请先加载并显示三维建筑';
    return;
  }

  if (!hasUsableFloodFrame(floodJson)) {
    buildingLayerMessage.value = '请先播放案例或加载渲染洪水数据，再进行淹没分析';
    return;
  }

  buildingLayerLoading.value = true;
  await showBuildingLoadMessage('正在按当前洪水帧更新建筑淹没颜色...');

  try {
    let total = 0;
    let flooded = 0;
    buildingFeatureEntityRecords.forEach((record) => {
      const analysis = analyzeBuildingFootprintFlooding(record.feature, floodJson);
      if (!analysis?.sampled) {
        return;
      }

      total += 1;
      if (analysis.flooded) {
        flooded += 1;
      }

      const color = analysis.flooded ? BUILDING_FLOODED_COLOR : BUILDING_SAFE_COLOR;
      record.entities.forEach((entity) => setBuildingEntityColor(entity, color));
    });

    buildingStats.value = {
      total,
      flooded,
      safe: Math.max(0, total - flooded)
    };
    buildingLayerMessage.value = `淹没分析完成：采用当前已加载洪水帧 ${currentFloodFrame.value || '--'}，淹没 ${flooded}/${total} 栋`;
    viewer.scene.requestRender();
  } catch (error) {
    const message = error instanceof Error ? error.message : '建筑淹没分析失败';
    buildingLayerMessage.value = message;
  } finally {
    buildingLayerLoading.value = false;
  }
};

const analyzeRoadFeatureFlooding = (feature: RoadFeature, floodJson: any) => {
  let maxDepthM = 0;
  let sampled = false;

  getRoadLineStrings(feature.geometry).forEach((line) => {
    line.forEach((coordinate) => {
      const longitude = Number(coordinate[0]);
      const latitude = Number(coordinate[1]);
      if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
        return;
      }

      const gridPoint = getFloodSamplePoint(longitude, latitude, floodJson);
      if (!gridPoint) {
        return;
      }

      const sample = sampleFloodDepthAtGridPoint(floodJson, gridPoint.x, gridPoint.y);
      sampled = true;
      maxDepthM = Math.max(maxDepthM, sample.depthM);
    });
  });

  return {
    flooded: sampled && maxDepthM > 0,
    sampled,
    depthM: maxDepthM
  };
};

const analyzeRoadFlooding = async () => {
  const viewer = props.viewer;
  const dataSource = roadDataSource.value;
  const floodJson = lastLoadedFloodJson.value;

  if (!viewer || !dataSource || !roadLayerShown.value) {
    roadLayerMessage.value = '请先加载并显示道路';
    return;
  }

  if (!hasUsableFloodFrame(floodJson)) {
    roadLayerMessage.value = '请先播放案例或加载渲染洪水数据，再进行道路淹没分析';
    return;
  }

  roadLayerLoading.value = true;
  await showRoadLoadMessage('正在按当前洪水帧更新道路淹没颜色...');

  try {
    let total = 0;
    let flooded = 0;
    roadFeatureEntityRecords.forEach((record) => {
      const analysis = analyzeRoadFeatureFlooding(record.feature, floodJson);
      if (!analysis.sampled) {
        return;
      }

      total += 1;
      if (analysis.flooded) {
        flooded += 1;
      }

      const color = analysis.flooded ? ROAD_FLOODED_COLOR : ROAD_SAFE_COLOR;
      record.entities.forEach((entity) => setRoadEntityColor(entity, color));
    });

    roadStats.value = {
      total,
      flooded,
      safe: Math.max(0, total - flooded)
    };
    roadLayerMessage.value = `道路淹没分析完成：采用当前已加载洪水帧 ${currentFloodFrame.value || '--'}，淹没 ${flooded}/${total} 条`;
    viewer.scene.requestRender();
  } catch (error) {
    const message = error instanceof Error ? error.message : '道路淹没分析失败';
    roadLayerMessage.value = message;
  } finally {
    roadLayerLoading.value = false;
  }
};

const readGeoJsonFile = async <T,>(file: File): Promise<T> => {
  const text = await file.text();
  return JSON.parse(text) as T;
};

const isGeoJsonFile = (file: File) => file.name.toLowerCase().endsWith('.geojson');

const handleBuildingGeoJsonUpload = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) {
    return;
  }

  if (!isGeoJsonFile(file)) {
    buildingLayerMessage.value = '请上传 .geojson 格式的建筑物文件';
    return;
  }

  const viewer = props.viewer;
  if (!viewer || buildingLayerLoading.value) {
    buildingLayerMessage.value = viewer ? '建筑图层正在加载中' : '地图尚未准备好';
    return;
  }

  buildingLayerLoading.value = true;
  await showBuildingLoadMessage(`正在读取${file.name}...`);

  try {
    destroyOsmBuildings();
    const geojson = await readGeoJsonFile<BuildingFootprintCollection>(file);
    const dataSource = new Cesium.CustomDataSource(`uploaded_buildings_${Date.now()}`);
    let polygonCount = 0;
    const featureEntityRecords: BuildingFeatureEntityRecord[] = [];

    geojson.features?.forEach((feature) => {
      const entities: Cesium.Entity[] = [];
      getPolygonRings(feature.geometry).forEach((polygon) => {
        const entity = addBuildingLayerEntity(dataSource, feature, polygon);
        if (entity) {
          entities.push(entity);
          polygonCount += 1;
        }
      });
      if (entities.length) {
        featureEntityRecords.push({ feature, entities });
      }
    });

    if (!featureEntityRecords.length) {
      throw new Error('未识别到有效建筑物 Polygon/MultiPolygon');
    }

    previousDepthTestAgainstTerrain = viewer.scene.globe.depthTestAgainstTerrain;
    viewer.scene.globe.depthTestAgainstTerrain = false;
    await viewer.dataSources.add(dataSource);
    buildingDataSource.value = dataSource;
    buildingFeatureEntityRecords = featureEntityRecords;
    buildingLayerViewer = viewer;
    buildingLayerShown.value = true;
    uploadedBuildingLayerName.value = file.name;
    buildingStats.value = { total: 0, flooded: 0, safe: 0 };
    buildingLayerMessage.value = `已上传建筑物：${featureEntityRecords.length} 个要素，${polygonCount} 个面`;
    viewer.scene.requestRender();
  } catch (error) {
    const message = error instanceof Error ? error.message : '建筑物 GeoJSON 上传失败';
    buildingLayerMessage.value = message;
  } finally {
    buildingLayerLoading.value = false;
  }
};

const handleRoadGeoJsonUpload = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) {
    return;
  }

  if (!isGeoJsonFile(file)) {
    roadLayerMessage.value = '请上传 .geojson 格式的道路文件';
    return;
  }

  const viewer = props.viewer;
  if (!viewer || roadLayerLoading.value) {
    roadLayerMessage.value = viewer ? '道路图层正在加载中' : '地图尚未准备好';
    return;
  }

  roadLayerLoading.value = true;
  await showRoadLoadMessage(`正在读取${file.name}...`);

  try {
    destroyRoadLayer();
    const geojson = await readGeoJsonFile<RoadCollection>(file);
    const dataSource = new Cesium.CustomDataSource(`uploaded_roads_${Date.now()}`);
    let lineCount = 0;
    const featureEntityRecords: RoadFeatureEntityRecord[] = [];

    geojson.features?.forEach((feature) => {
      const entities: Cesium.Entity[] = [];
      getRoadLineStrings(feature.geometry).forEach((line) => {
        const entity = addRoadLayerEntity(dataSource, feature, line);
        if (entity) {
          entities.push(entity);
          lineCount += 1;
        }
      });
      if (entities.length) {
        featureEntityRecords.push({ feature, entities });
      }
    });

    if (!featureEntityRecords.length) {
      throw new Error('未识别到有效道路 LineString/MultiLineString');
    }

    await viewer.dataSources.add(dataSource);
    roadDataSource.value = dataSource;
    roadFeatureEntityRecords = featureEntityRecords;
    roadLayerShown.value = true;
    uploadedRoadLayerName.value = file.name;
    roadStats.value = { total: 0, flooded: 0, safe: 0 };
    roadLayerMessage.value = `已上传道路：${featureEntityRecords.length} 个要素，${lineCount} 条线段`;
    viewer.scene.requestRender();
  } catch (error) {
    const message = error instanceof Error ? error.message : '道路 GeoJSON 上传失败';
    roadLayerMessage.value = message;
  } finally {
    roadLayerLoading.value = false;
  }
};

const handleBuildingLayerAction = () => {
  if (activeLayerConfig.value || buildingDataSource.value) {
    void toggleOsmBuildings();
    return;
  }

  buildingUploadInputRef.value?.click();
};

const handleRoadLayerAction = () => {
  if (activeLayerConfig.value || roadDataSource.value) {
    void toggleRoadLayer();
    return;
  }

  roadUploadInputRef.value?.click();
};

const toggleOsmBuildings = async () => {
  const viewer = props.viewer;
  if (!viewer || buildingLayerLoading.value) {
    if (!viewer) {
      buildingLayerMessage.value = '地图尚未准备好';
    }
    return;
  }

  if (buildingDataSource.value) {
    const nextShown = !buildingLayerShown.value;
    buildingDataSource.value.show = nextShown;
    buildingLayerShown.value = nextShown;
    buildingLayerMessage.value = nextShown ? '建筑图层已显示' : '建筑图层已隐藏';

    if (nextShown) {
      viewer.scene.requestRender();
    } else {
      viewer.scene.requestRender();
    }
    return;
  }

  const layerConfig = activeLayerConfig.value;
  if (!layerConfig) {
    buildingLayerMessage.value = '请先在案例演示中选择并播放案例';
    return;
  }

  buildingLayerLoading.value = true;
  await showBuildingLoadMessage(`开始加载${layerConfig.buildingLabel}...`);

  try {
    const useCameraFilter = layerConfig.filterByCamera;
    const cameraBounds = useCameraFilter ? getCurrentCameraBounds(viewer) : null;
    if (useCameraFilter && !cameraBounds) {
      throw new Error('无法获取当前相机视野范围，请先把镜头对准地表后再加载建筑');
    }

    await showBuildingLoadMessage(`正在读取${layerConfig.buildingLabel}轮廓...`);
    const response = await fetch(layerConfig.buildingUrl, { cache: 'no-cache' });
    if (!response.ok) {
      throw new Error(`建筑轮廓读取失败：${response.status}`);
    }
    const geojson = await response.json() as BuildingFootprintCollection;
    const dataSource = new Cesium.CustomDataSource(layerConfig.buildingDataSourceName);
    let polygonCount = 0;
    const featureEntityRecords: BuildingFeatureEntityRecord[] = [];

    geojson.features.forEach((feature) => {
      if (cameraBounds && !isFeatureInCameraBounds(feature, cameraBounds)) {
        return;
      }

      const entities: Cesium.Entity[] = [];
      getPolygonRings(feature.geometry).forEach((polygon) => {
        const entity = addBuildingLayerEntity(dataSource, feature, polygon);
        if (entity) {
          entities.push(entity);
          polygonCount += 1;
        }
      });
      if (entities.length) {
        featureEntityRecords.push({ feature, entities });
      }
    });

    if (isPanelDisposed || props.viewer !== viewer) {
      dataSource.entities.removeAll();
      return;
    }

    await showBuildingLoadMessage(`正在添加${layerConfig.buildingLabel}图层...`);
    previousDepthTestAgainstTerrain = viewer.scene.globe.depthTestAgainstTerrain;
    viewer.scene.globe.depthTestAgainstTerrain = false;
    await viewer.dataSources.add(dataSource);
    buildingDataSource.value = dataSource;
    buildingFeatureEntityRecords = featureEntityRecords;
    buildingLayerViewer = viewer;
    buildingLayerShown.value = true;
    uploadedBuildingLayerName.value = '';
    buildingStats.value = { total: 0, flooded: 0, safe: 0 };
    buildingLayerMessage.value = `${layerConfig.buildingLabel}已加载：当前视野内 ${featureEntityRecords.length} 栋、${polygonCount} 个立体轮廓`;
    viewer.scene.requestRender();
  } catch (error) {
    const message = error instanceof Error ? error.message : '建筑图层加载失败';
    buildingLayerMessage.value = message;
  } finally {
    buildingLayerLoading.value = false;
  }
};

const toggleRoadLayer = async () => {
  const viewer = props.viewer;
  if (!viewer || roadLayerLoading.value) {
    if (!viewer) {
      roadLayerMessage.value = '地图尚未准备好';
    }
    return;
  }

  if (roadDataSource.value) {
    const nextShown = !roadLayerShown.value;
    roadDataSource.value.show = nextShown;
    roadLayerShown.value = nextShown;
    roadLayerMessage.value = nextShown ? '道路图层已显示' : '道路图层已隐藏';
    viewer.scene.requestRender();
    return;
  }

  const layerConfig = activeLayerConfig.value;
  if (!layerConfig) {
    roadLayerMessage.value = '请先在案例演示中选择并播放案例';
    return;
  }

  roadLayerLoading.value = true;
  await showRoadLoadMessage(`开始加载${layerConfig.roadLabel}...`);

  try {
    const useCameraFilter = layerConfig.filterByCamera;
    const cameraBounds = useCameraFilter ? getCurrentCameraBounds(viewer) : null;
    if (useCameraFilter && !cameraBounds) {
      throw new Error('无法获取当前相机视野范围，请先把镜头对准地表后再加载道路');
    }

    await showRoadLoadMessage(`正在读取${layerConfig.roadLabel}数据...`);
    const response = await fetch(layerConfig.roadUrl, { cache: 'no-cache' });
    if (!response.ok) {
      throw new Error(`道路数据读取失败：${response.status}`);
    }

    const geojson = await response.json() as RoadCollection;
    const dataSource = new Cesium.CustomDataSource(layerConfig.roadDataSourceName);
    let lineCount = 0;
    const featureEntityRecords: RoadFeatureEntityRecord[] = [];

    geojson.features.forEach((feature) => {
      if (cameraBounds && !isRoadFeatureInCameraBounds(feature, cameraBounds)) {
        return;
      }

      const entities: Cesium.Entity[] = [];
      getRoadLineStrings(feature.geometry).forEach((line) => {
        const entity = addRoadLayerEntity(dataSource, feature, line);
        if (entity) {
          entities.push(entity);
          lineCount += 1;
        }
      });

      if (entities.length) {
        featureEntityRecords.push({ feature, entities });
      }
    });

    if (isPanelDisposed || props.viewer !== viewer) {
      dataSource.entities.removeAll();
      return;
    }

    await showRoadLoadMessage(`正在添加${layerConfig.roadLabel}图层...`);
    await viewer.dataSources.add(dataSource);
    roadDataSource.value = dataSource;
    roadFeatureEntityRecords = featureEntityRecords;
    roadLayerShown.value = true;
    uploadedRoadLayerName.value = '';
    roadStats.value = { total: 0, flooded: 0, safe: 0 };
    roadLayerMessage.value = `${layerConfig.roadLabel}已加载：当前视野内 ${featureEntityRecords.length} 条道路、${lineCount} 条线段`;
    viewer.scene.requestRender();
  } catch (error) {
    const message = error instanceof Error ? error.message : '道路图层加载失败';
    roadLayerMessage.value = message;
  } finally {
    roadLayerLoading.value = false;
  }
};

const destroyRoadLayer = () => {
  const dataSource = roadDataSource.value;
  const viewer = props.viewer;
  if (dataSource && viewer) {
    viewer.dataSources.remove(dataSource, true);
    viewer.scene.requestRender();
  }

  roadDataSource.value = null;
  roadFeatureEntityRecords = [];
  uploadedRoadLayerName.value = '';
  roadLayerShown.value = false;
  roadLayerLoading.value = false;
  roadStats.value = { total: 0, flooded: 0, safe: 0 };
};

const destroyOsmBuildings = () => {
  const dataSource = buildingDataSource.value;
  const viewer = buildingLayerViewer ?? props.viewer;
  if (dataSource && viewer) {
    viewer.dataSources.remove(dataSource, true);
    viewer.scene.requestRender();
  }

  if (previousDepthTestAgainstTerrain !== null && viewer) {
    viewer.scene.globe.depthTestAgainstTerrain = previousDepthTestAgainstTerrain;
  }
  previousDepthTestAgainstTerrain = null;
  buildingDataSource.value = null;
  buildingFeatureEntityRecords = [];
  uploadedBuildingLayerName.value = '';
  buildingLayerViewer = null;
  buildingLayerShown.value = false;
  buildingLayerLoading.value = false;
  buildingStats.value = { total: 0, flooded: 0, safe: 0 };
};

watch(selectedFloodDepthPoint, updateDepthMarker, { immediate: true });
watch(() => props.viewer, updateDepthMarker);
watch(
  () => activeLayerConfig.value?.caseId ?? '',
  (_caseId, previousCaseId) => {
    if (!previousCaseId) {
      return;
    }

    destroyOsmBuildings();
    destroyRoadLayer();
    buildingLayerMessage.value = '';
    roadLayerMessage.value = '';
  }
);
onMounted(() => {
  panelReadyFrame = window.requestAnimationFrame(() => {
    panelReady.value = true;
  });
});

onBeforeUnmount(() => {
  isPanelDisposed = true;
  if (panelReadyFrame) {
    window.cancelAnimationFrame(panelReadyFrame);
  }
  stopDepthPick();
  removeDepthMarker();
  destroyOsmBuildings();
  destroyRoadLayer();
});
</script>

<template>
  <section class="flood-analysis-panel">
    <transition name="side-float-left" appear>
    <div v-if="panelReady && isAnalysisGroupVisible('depth')" class="analysis-group analysis-depth" :class="{ expanded: isAnalysisGroupExpanded('depth') }">
      <div class="analysis-group-header" role="button" tabindex="0" @click="toggleAnalysisGroup('depth')">
        <span class="analysis-group-arrow" :class="{ expanded: isAnalysisGroupExpanded('depth') }">▶</span>
        <span>点位水深分析</span>
        <span class="analysis-group-spacer"></span>
        <button type="button" class="analysis-close-btn" aria-label="关闭点位水深分析面板" title="关闭" @click.stop="closeAnalysisGroup('depth')">×</button>
      </div>
      <div v-show="isAnalysisGroupExpanded('depth')" class="analysis-group-content">
    <div class="analysis-block depth-block">
      <div class="block-heading">
        <span>监测点水深变化曲线</span>
        <b>{{ depthSeriesSummaryLabel }}</b>
      </div>

      <div class="point-toolbar">
        <button type="button" class="point-btn primary" :class="{ active: isPickingDepthPoint }" @click="startDepthPick">
          {{ isPickingDepthPoint ? '选点中' : '选取点位' }}
        </button>
        <button type="button" class="point-btn" :disabled="!hasDepthPoint" @click="clearDepthPoint">清除点位</button>
      </div>

      <div class="point-summary">
        <span>点位</span>
        <strong>{{ depthPointLabel }}</strong>
        <span>当前水深</span>
        <strong>{{ hasDepthPoint ? formatDepth(latestDepthM) : '--' }}</strong>
      </div>

      <p v-if="depthPickMessage" class="point-message">{{ depthPickMessage }}</p>

      <div v-if="hasDepthData" class="chart-wrap">
        <svg class="analysis-chart" :viewBox="`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`" role="img" aria-label="监测点水深变化曲线">
          <defs>
            <linearGradient id="flood-depth-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stop-color="#ffd36c" stop-opacity="0.26" />
              <stop offset="100%" stop-color="#44e6ff" stop-opacity="0.04" />
            </linearGradient>
          </defs>
          <g class="grid-lines">
            <line v-for="tick in depthYTicks" :key="tick.label" :x1="PLOT_LEFT" :x2="PLOT_RIGHT" :y1="tick.y" :y2="tick.y" />
          </g>
          <g class="axis-labels y-axis">
            <text v-for="tick in depthYTicks" :key="`depth-y-${tick.label}`" x="4" :y="tick.y + 4">{{ tick.label }}</text>
          </g>
          <polygon :points="depthFillPoints" class="depth-fill" />
          <polyline :points="depthLinePoints" class="depth-line" fill="none" />
          <circle v-for="point in depthDotPoints" :key="`depth-${point.frame}-${point.x}`" :cx="point.x" :cy="point.y" r="2.4" class="depth-dot" />
          <g class="axis-labels x-axis">
            <text v-for="tick in depthXTicks" :key="`depth-x-${tick.frame}`" :x="tick.x" y="140">{{ tick.frame }}帧</text>
          </g>
        </svg>
      </div>

      <div v-else class="empty-state compact">
        <strong>{{ hasDepthPoint ? '等待后续洪水帧记录' : '请选择监测点' }}</strong>
        <span>{{ hasDepthPoint ? '重新播放案例可生成完整曲线' : '点击选取点位后在地图上落点' }}</span>
      </div>
    </div>

      </div>
    </div>
    </transition>

    <transition name="side-float-left" appear>
    <div v-if="panelReady && isAnalysisGroupVisible('assets')" class="analysis-group analysis-assets" :class="{ expanded: isAnalysisGroupExpanded('assets') }">
      <div class="analysis-group-header" role="button" tabindex="0" @click="toggleAnalysisGroup('assets')">
        <span class="analysis-group-arrow" :class="{ expanded: isAnalysisGroupExpanded('assets') }">▶</span>
        <span>承灾体淹没分析</span>
        <span class="analysis-group-spacer"></span>
        <button type="button" class="analysis-close-btn" aria-label="关闭承灾体淹没分析面板" title="关闭" @click.stop="closeAnalysisGroup('assets')">×</button>
      </div>
      <div v-show="isAnalysisGroupExpanded('assets')" class="analysis-group-content">
    <div class="analysis-block building-block">
      <div class="block-heading">
        <span>建筑物淹没分析</span>
        <b>{{ buildingLayerStatus }}</b>
      </div>
      <p class="point-message layer-source">当前图层：{{ activeBuildingLayerLabel }}</p>

      <div class="point-toolbar building-toolbar">
        <input ref="buildingUploadInputRef" class="asset-file-input-hidden" type="file" accept=".geojson" :disabled="buildingLayerLoading" @change="handleBuildingGeoJsonUpload" />
        <button type="button" class="point-btn primary" :disabled="buildingLayerLoading" @click="handleBuildingLayerAction">
          {{ buildingToggleLabel }}
        </button>
        <button type="button" class="point-btn" :disabled="!buildingLayerShown || buildingLayerLoading" @click="refreshBuildingColors()">
          淹没分析
        </button>
      </div>

      <div class="building-legend">
        <span class="building-chip flooded"><i></i>淹没</span>
        <span class="building-chip safe"><i></i>未淹没</span>
        <strong>{{ buildingStats.total ? `${buildingStats.flooded}/${buildingStats.total}` : '--' }}</strong>
      </div>

      <p v-if="buildingLayerMessage" class="point-message">{{ buildingLayerMessage }}</p>
    </div>

    <div class="analysis-block road-block">
      <div class="block-heading">
        <span>道路淹没分析</span>
        <b>{{ roadLayerStatus }}</b>
      </div>
      <p class="point-message layer-source">当前图层：{{ activeRoadLayerLabel }}</p>

      <div class="point-toolbar building-toolbar">
        <input ref="roadUploadInputRef" class="asset-file-input-hidden" type="file" accept=".geojson" :disabled="roadLayerLoading" @change="handleRoadGeoJsonUpload" />
        <button type="button" class="point-btn primary" :disabled="roadLayerLoading" @click="handleRoadLayerAction">
          {{ roadToggleLabel }}
        </button>
        <button type="button" class="point-btn" :disabled="!roadLayerShown || roadLayerLoading" @click="refreshRoadColors()">
          淹没分析
        </button>
      </div>

      <div class="building-legend">
        <span class="building-chip flooded"><i></i>淹没</span>
        <span class="building-chip safe"><i></i>未淹没</span>
        <strong>{{ roadStats.total ? `${roadStats.flooded}/${roadStats.total}` : '--' }}</strong>
      </div>

      <p v-if="roadLayerMessage" class="point-message">{{ roadLayerMessage }}</p>
    </div>

      </div>
    </div>
    </transition>

    <transition name="side-float-left" appear>
    <div v-if="panelReady && isAnalysisGroupVisible('accuracy')" class="analysis-group analysis-accuracy" :class="{ expanded: isAnalysisGroupExpanded('accuracy') }">
      <div class="analysis-group-header" role="button" tabindex="0" @click="toggleAnalysisGroup('accuracy')">
        <span class="analysis-group-arrow" :class="{ expanded: isAnalysisGroupExpanded('accuracy') }">▶</span>
        <span>精度评价</span>
        <span class="analysis-group-spacer"></span>
        <button type="button" class="analysis-close-btn" aria-label="关闭精度评价面板" title="关闭" @click.stop="closeAnalysisGroup('accuracy')">×</button>
      </div>
      <div v-show="isAnalysisGroupExpanded('accuracy')" class="analysis-group-content">
    <AccuracyEvaluationPanel :viewer="viewer" />
      </div>
    </div>
    </transition>
  </section>
</template>

<style scoped>
.flood-analysis-panel {
  position: absolute;
  inset: 0;
  z-index: 910;
  display: grid;
  grid-template-columns: minmax(320px, 360px) minmax(360px, 1fr);
  grid-template-rows: auto auto auto minmax(0, 1fr);
  align-items: start;
  gap: 14px 32px;
  padding: 90px 20px calc(var(--system-bottom-safe-space, 54px) + 24px);
  pointer-events: none;
}

.analysis-group {
  position: relative;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  width: 100%;
  max-height: calc(100vh - 150px);
  border: 1px solid var(--sys-border-color, rgba(0, 229, 255, 0.4));
  border-radius: 8px;
  background: var(--sys-glass-bg, rgba(13, 27, 49, 0.7));
  box-shadow:
    inset 0 0 20px var(--sys-border-color-light, rgba(0, 229, 255, 0.1)),
    0 8px 32px rgba(0, 0, 0, 0.5);
  pointer-events: auto;
  transition: border-color 0.24s ease, background 0.24s ease, box-shadow 0.24s ease;
}

.analysis-depth {
  grid-column: 1;
  grid-row: 1;
  max-height: 38vh;
}

.analysis-assets {
  grid-column: 1;
  grid-row: 2;
  max-height: none;
}

.analysis-accuracy {
  grid-column: 1;
  grid-row: 3;
  max-height: calc(100vh - var(--system-bottom-safe-space, 54px) - 122px);
}

.side-float-left-enter-active,
.side-float-left-leave-active,
.side-float-right-enter-active,
.side-float-right-leave-active {
  will-change: opacity, transform;
}

.side-float-left-enter-active {
  transition: opacity 1s cubic-bezier(0.4, 0, 0.2, 1) 0.3s, transform 1s cubic-bezier(0.4, 0, 0.2, 1) 0.3s !important;
}

.side-float-left-leave-active {
  transition: opacity 0.4s cubic-bezier(0.4, 0, 0.2, 1), transform 0.4s cubic-bezier(0.4, 0, 0.2, 1) !important;
}

.side-float-left-enter-from,
.side-float-left-leave-to {
  opacity: 0;
  transform: translateX(-50px);
}

.side-float-right-enter-active {
  transition: opacity 1s cubic-bezier(0.4, 0, 0.2, 1) 0.6s, transform 1s cubic-bezier(0.4, 0, 0.2, 1) 0.6s !important;
}

.side-float-right-leave-active {
  transition: opacity 0.4s cubic-bezier(0.4, 0, 0.2, 1), transform 0.4s cubic-bezier(0.4, 0, 0.2, 1) !important;
}

.side-float-right-enter-from,
.side-float-right-leave-to {
  opacity: 0;
  transform: translateX(50px);
}

.analysis-group::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  border-radius: inherit;
  background: linear-gradient(120deg, rgba(255, 255, 255, 0.05), transparent 42%);
  opacity: 0.28;
}

.analysis-group.expanded {
  border-color: var(--sys-border-color, rgba(0, 229, 255, 0.4));
  background: var(--sys-glass-bg, rgba(13, 27, 49, 0.7));
  box-shadow:
    inset 0 0 20px var(--sys-border-color-light, rgba(0, 229, 255, 0.1)),
    0 8px 32px rgba(0, 0, 0, 0.5);
}

.analysis-group-header {
  position: relative;
  z-index: 1;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 58px;
  padding: 14px 16px;
  border: 0;
  border-bottom: 1px solid var(--sys-border-color, rgba(0, 229, 255, 0.4));
  color: #ffffff;
  background: linear-gradient(90deg, var(--sys-bg-glow, rgba(0, 229, 255, 0.15)) 0%, transparent 100%);
  cursor: pointer;
  font-size: 16px;
  font-weight: 800;
  text-align: left;
  letter-spacing: 0;
  transition: background 0.24s ease, color 0.24s ease;
}

.analysis-group-header:hover {
  background: linear-gradient(90deg, var(--sys-bg-glow-active, rgba(0, 229, 255, 0.3)) 0%, transparent 100%);
}

.analysis-group-header::before {
  content: '';
  width: 4px;
  height: 24px;
  border-radius: 999px;
  background: var(--sys-theme-color, #00e5ff);
  box-shadow: var(--sys-text-glow, 0 0 8px rgba(0, 229, 255, 0.5));
  opacity: 1;
  transform: scaleY(1);
  transition: opacity 0.24s ease, transform 0.24s ease;
}

.analysis-group.expanded .analysis-group-header::before {
  opacity: 1;
  transform: scaleY(1);
}

.analysis-group-arrow {
  flex: 0 0 auto;
  color: #31d8ff;
  font-size: 12px;
  line-height: 1;
  transition: transform 0.2s ease, color 0.2s ease;
}

.analysis-group-arrow.expanded {
  transform: rotate(90deg);
  color: #62f1ff;
}

.analysis-group-spacer {
  flex: 1 1 auto;
}

.analysis-close-btn {
  flex: 0 0 auto;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 50%;
  color: #bfeeff;
  background: rgba(255, 255, 255, 0.08);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
}

.analysis-close-btn:hover {
  color: #ffffff;
  border-color: rgba(255, 92, 92, 0.52);
  background: rgba(255, 82, 82, 0.24);
}

.analysis-group-content {
  position: relative;
  z-index: 1;
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  min-height: 0;
  background: transparent;
  overflow-y: auto;
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.metric-item,
.analysis-block,
.latest-strip {
  border: 1px solid rgba(0, 229, 255, 0.16);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.045);
  box-shadow: inset 0 0 16px rgba(0, 229, 255, 0.05);
}

.metric-item {
  min-height: 68px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 6px;
}

.metric-item span {
  color: #8fb8d8;
  font-size: 12px;
}

.metric-item strong {
  color: #f6fbff;
  font-size: 18px;
  line-height: 1.1;
  font-weight: 700;
  overflow-wrap: anywhere;
}

.metric-item.current strong {
  color: #58efff;
  text-shadow: 0 0 10px rgba(88, 239, 255, 0.42);
}

.metric-item.peak strong {
  color: #ffd36c;
  text-shadow: 0 0 10px rgba(255, 211, 108, 0.32);
}

.metric-item.trend strong {
  color: #64e8a2;
}

.metric-item.trend.down strong {
  color: #ff9b7b;
}

.analysis-block {
  padding: 12px;
  background: rgba(0, 229, 255, 0.055);
}

.block-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  color: #e7f6ff;
  font-size: 13px;
  font-weight: 700;
}

.block-heading b {
  color: #7fb6d5;
  font-size: 11px;
  font-weight: 500;
}

.chart-wrap {
  width: 100%;
  min-height: 150px;
}

.analysis-chart {
  width: 100%;
  height: 150px;
  display: block;
  overflow: visible;
}

.grid-lines line {
  stroke: rgba(127, 182, 213, 0.17);
  stroke-width: 1;
}

.axis-labels text {
  fill: #77a5bf;
  font-size: 10px;
}

.x-axis text {
  text-anchor: middle;
}

.area-fill {
  fill: url(#flood-area-fill);
}

.depth-fill {
  fill: url(#flood-depth-fill);
}

.area-line,
.depth-line {
  fill: none;
  stroke-width: 2.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.area-line {
  stroke: #44e6ff;
  filter: drop-shadow(0 0 6px rgba(68, 230, 255, 0.46));
}

.depth-line {
  stroke: #ffd36c;
  filter: drop-shadow(0 0 6px rgba(255, 211, 108, 0.42));
}

.area-dot {
  fill: #eaffff;
  stroke: #48d18f;
  stroke-width: 1.1;
}

.depth-dot {
  fill: #fff7d6;
  stroke: #ffbd4a;
  stroke-width: 1.1;
}

.empty-state {
  min-height: 150px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: #93bad0;
  text-align: center;
  border: 1px dashed rgba(127, 182, 213, 0.28);
  border-radius: 6px;
  background: rgba(3, 15, 28, 0.36);
}

.empty-state.compact {
  min-height: 94px;
}

.empty-state strong {
  color: #d7f4ff;
  font-size: 14px;
}

.empty-state span {
  font-size: 12px;
}

.point-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.point-btn {
  min-width: 78px;
  height: 28px;
  padding: 0 10px;
  margin: 0;
  border-radius: 4px;
  border: 1px solid rgba(127, 182, 213, 0.22);
  color: #dcefff;
  background: rgba(255, 255, 255, 0.055);
  box-shadow: none;
  font-size: 12px;
  cursor: pointer;
}

.point-btn.primary {
  color: #04141f;
  background: #58efff;
  border-color: rgba(88, 239, 255, 0.7);
  font-weight: 700;
}

.point-btn.active {
  background: #ffd36c;
  border-color: rgba(255, 211, 108, 0.78);
}

.point-btn:disabled {
  color: rgba(255, 255, 255, 0.34);
  background: rgba(255, 255, 255, 0.035);
  cursor: not-allowed;
}

.asset-file-input-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

.point-summary {
  display: grid;
  grid-template-columns: auto 1fr auto 0.85fr;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  padding: 7px 8px;
  margin-bottom: 8px;
  border-radius: 6px;
  background: rgba(4, 18, 34, 0.5);
  color: #8fb8d8;
  font-size: 12px;
}

.point-summary strong {
  min-width: 0;
  color: #f7fcff;
  font-size: 12px;
  text-align: right;
  overflow-wrap: anywhere;
}

.building-legend {
  min-height: 38px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  padding: 7px 8px;
  margin-bottom: 8px;
  border-radius: 6px;
  background: rgba(4, 18, 34, 0.5);
}

.building-chip {
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #dcefff;
  font-size: 12px;
  white-space: nowrap;
}

.building-chip i {
  width: 11px;
  height: 11px;
  border-radius: 50%;
  box-shadow: 0 0 10px currentColor;
}

.building-chip.flooded i {
  color: #ff4f5f;
  background: #ff4f5f;
}

.building-chip.safe i {
  color: #3be57f;
  background: #3be57f;
}

.building-legend strong {
  color: #f7fcff;
  font-size: 12px;
  font-weight: 700;
  text-align: right;
}

.point-message {
  margin: 0 0 8px;
  color: #9eddf1;
  font-size: 12px;
  line-height: 1.5;
}

.latest-strip {
  min-height: 44px;
  padding: 9px 10px;
  display: grid;
  grid-template-columns: auto 1fr auto 1.6fr;
  align-items: center;
  gap: 8px;
  color: #8fb8d8;
  font-size: 12px;
}

.latest-strip strong {
  color: #f7fcff;
  font-size: 13px;
  text-align: right;
  overflow-wrap: anywhere;
}

@media (max-width: 1280px) {
  .flood-analysis-panel {
    grid-template-columns: minmax(300px, 340px) minmax(260px, 1fr);
    gap: 14px 22px;
    padding-inline: 20px;
  }
}

@media (max-width: 980px) {
  .flood-analysis-panel {
    inset: 92px 12px var(--system-bottom-safe-space, 54px);
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 0;
    overflow-y: auto;
    pointer-events: auto;
  }

  .analysis-group,
  .analysis-depth,
  .analysis-assets,
  .analysis-accuracy {
    position: relative;
    inset: auto;
    width: 100%;
    max-height: none;
  }
}
</style>
