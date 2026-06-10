<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import * as Cesium from 'cesium';
import DrawTriangleMesh from '../js/DrawTriangleMesh';
import {
  clearFloodDepthMonitorPoint,
  currentFloodAreaM2,
  currentFloodFrame,
  currentFloodPointDepthM,
  floodAreaSeries,
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
const BUILDING_FOOTPRINT_GEOJSON_URL = '/data/buildings/clipxiaojiaqiao/clipxiaojiaqiaojson.geojson';
const BUILDING_LAYER_LABEL = '肖家桥三维建筑';
const BUILDING_BASE_HEIGHT_M = 0;
const BUILDING_MIN_HEIGHT_M = 8;
const BUILDING_MAX_HEIGHT_M = 38;
const BUILDING_DEFAULT_COLOR = Cesium.Color.fromCssColorString('#c8d2d8');
const BUILDING_FLOODED_COLOR = Cesium.Color.fromCssColorString('#e23b32');
const BUILDING_SAFE_COLOR = Cesium.Color.fromCssColorString('#4bc36a');
const makeSvgDataUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
const DEPTH_MARKER_PIN_IMAGE = makeSvgDataUrl(`
<svg xmlns="http://www.w3.org/2000/svg" width="160" height="200" viewBox="0 0 160 200">
  <defs>
    <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">
      <feDropShadow dx="0" dy="8" stdDeviation="6" flood-color="#010a14" flood-opacity="0.85"/>
    </filter>
    <linearGradient id="pinGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#ffe58a"/>
      <stop offset="100%" stop-color="#f6a700"/>
    </linearGradient>
    <radialGradient id="pulseGrad" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#ffd36c" stop-opacity="0.6"/>
      <stop offset="100%" stop-color="#ffd36c" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <!-- Pulse Base -->
  <ellipse cx="80" cy="180" rx="60" ry="16" fill="url(#pulseGrad)"/>
  <ellipse cx="80" cy="180" rx="18" ry="5" fill="#ffffff" opacity="0.9"/>
  <!-- Stick Base -->
  <path d="M80 110 L80 180" stroke="#f6a700" stroke-width="8" stroke-linecap="round"/>
  <path d="M80 110 L80 180" stroke="#fff8d8" stroke-width="3" stroke-linecap="round" opacity="0.85"/>

  <g filter="url(#shadow)">
    <!-- Bulb Head (Teardrop) -->
    <path d="M 80 15 C 40 15 15 45 15 80 C 15 115 75 160 78 163 C 79 164 81 164 82 163 C 85 160 145 115 145 80 C 145 45 120 15 80 15 Z" fill="url(#pinGrad)" stroke="#fff8d8" stroke-width="4" stroke-linejoin="round"/>
    
    <!-- Inner Dark Circle -->
    <circle cx="80" cy="70" r="34" fill="#3a2600" stroke="#fff8d8" stroke-width="3"/>
    
    <!-- Water Icon inside -->
    <path d="M 80 44 C 68 56 60 66 60 76 C 60 87 69 96 80 96 C 91 96 100 87 100 76 C 100 66 92 56 80 44 Z" fill="#ffffff"/>
    
    <!-- Decorative Highlight -->
    <path d="M 32 75 A 50 50 0 0 1 80 25" fill="none" stroke="#ffffff" stroke-width="5" stroke-linecap="round" opacity="0.6"/>
  </g>
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

type BuildingFootprintGeometry = {
  type: 'Polygon' | 'MultiPolygon';
  coordinates: number[][][] | number[][][][];
};

type BuildingFootprintFeature = {
  type: 'Feature';
  geometry?: BuildingFootprintGeometry | null;
  properties?: Record<string, unknown>;
};

type BuildingFootprintCollection = {
  type: 'FeatureCollection';
  features: BuildingFootprintFeature[];
};

type BuildingFeatureEntityRecord = {
  feature: BuildingFootprintFeature;
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
let pickHandler: Cesium.ScreenSpaceEventHandler | null = null;
let depthMarker: Cesium.Entity | null = null;
let markerViewer: Cesium.Viewer | null = null;
let buildingLayerViewer: Cesium.Viewer | null = null;
let previousDepthTestAgainstTerrain: boolean | null = null;
let isPanelDisposed = false;

const sortedAreaSeries = computed(() => (
  floodAreaSeries.value
    .filter((point) => Number.isFinite(point.frame) && Number.isFinite(point.areaM2))
    .sort((a, b) => a.frame - b.frame)
));

const sortedDepthSeries = computed(() => (
  floodPointDepthSeries.value
    .filter((point) => Number.isFinite(point.frame) && Number.isFinite(point.depthM))
    .sort((a, b) => a.frame - b.frame)
));

const firstAreaPoint = computed(() => sortedAreaSeries.value[0] ?? null);
const latestAreaPoint = computed(() => {
  const series = sortedAreaSeries.value;
  return series.length ? series[series.length - 1] : null;
});
const latestDepthPoint = computed(() => {
  const series = sortedDepthSeries.value;
  return series.length ? series[series.length - 1] : null;
});

const hasAreaData = computed(() => sortedAreaSeries.value.length > 0);
const hasDepthPoint = computed(() => selectedFloodDepthPoint.value !== null);
const hasDepthData = computed(() => sortedDepthSeries.value.length > 0);
const latestAreaM2 = computed(() => latestAreaPoint.value?.areaM2 ?? currentFloodAreaM2.value);
const maxAreaM2 = computed(() => Math.max(0, ...sortedAreaSeries.value.map((point) => point.areaM2)));
const minAreaM2 = computed(() => sortedAreaSeries.value.length
  ? Math.min(...sortedAreaSeries.value.map((point) => point.areaM2))
  : 0
);
const areaChangeM2 = computed(() => (
  firstAreaPoint.value && latestAreaPoint.value
    ? latestAreaPoint.value.areaM2 - firstAreaPoint.value.areaM2
    : 0
));
const maxDepthM = computed(() => Math.max(0, ...sortedDepthSeries.value.map((point) => point.depthM)));
const latestDepthM = computed(() => latestDepthPoint.value?.depthM ?? currentFloodPointDepthM.value);

const formatArea = (areaM2: number) => {
  const safeArea = Math.max(0, Math.abs(areaM2));

  if (safeArea >= 1_000_000) {
    const km2 = safeArea / 1_000_000;
    return `${km2 >= 10 ? km2.toFixed(1) : km2.toFixed(2)} km2`;
  }

  if (safeArea >= 10_000) {
    const hm2 = safeArea / 10_000;
    return `${hm2 >= 10 ? hm2.toFixed(1) : hm2.toFixed(2)} hm2`;
  }

  return `${safeArea >= 100 ? safeArea.toFixed(0) : safeArea.toFixed(1)} m2`;
};

const formatSignedArea = (areaM2: number) => {
  if (Math.abs(areaM2) < 0.001) {
    return '0 m2';
  }

  return `${areaM2 > 0 ? '+' : '-'}${formatArea(areaM2)}`;
};

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

const areaChartPoints = computed(() => buildChartPoints(
  sortedAreaSeries.value.map((point) => ({ frame: point.frame, value: point.areaM2 })),
  maxAreaM2.value
));
const areaLinePoints = computed(() => buildLine(areaChartPoints.value));
const areaFillPoints = computed(() => buildFill(areaChartPoints.value, areaLinePoints.value));
const areaDotPoints = computed(() => sampleDots(areaChartPoints.value));
const areaYTicks = computed(() => buildYTicks(maxAreaM2.value, formatArea));
const areaXTicks = computed(() => buildXTicks(sortedAreaSeries.value));

const depthChartPoints = computed(() => buildChartPoints(
  sortedDepthSeries.value.map((point) => ({ frame: point.frame, value: point.depthM })),
  maxDepthM.value
));
const depthLinePoints = computed(() => buildLine(depthChartPoints.value));
const depthFillPoints = computed(() => buildFill(depthChartPoints.value, depthLinePoints.value));
const depthDotPoints = computed(() => sampleDots(depthChartPoints.value));
const depthYTicks = computed(() => buildYTicks(maxDepthM.value, formatDepth));
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
    return '加载建筑';
  }

  return buildingLayerShown.value ? '隐藏建筑' : '显示建筑';
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
      image: DEPTH_MARKER_PIN_IMAGE,
      width: 40,
      height: 50,
      horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      pixelOffset: new Cesium.Cartesian2(0, 2),
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    },
    label: {
      text: '水深监测',
      font: 'bold 14px Microsoft YaHei, sans-serif',
      fillColor: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.fromCssColorString('#00101d'),
      outlineWidth: 4,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      showBackground: true,
      backgroundColor: Cesium.Color.fromCssColorString('#031827').withAlpha(0.9),
      backgroundPadding: new Cesium.Cartesian2(10, 5),
      horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      pixelOffset: new Cesium.Cartesian2(0, -60),
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

const handleDepthPointPicked = (movement: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
  const cartesian = pickCartesian(movement.position);
  if (!cartesian) {
    depthPickMessage.value = '未拾取到有效位置';
    stopDepthPick();
    return;
  }

  const gridPoint = DrawTriangleMesh.worldToFloodGrid(cartesian);
  if (!gridPoint) {
    depthPickMessage.value = '请先加载或播放洪水数据';
    stopDepthPick();
    return;
  }

  const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
  const sample = setFloodDepthMonitorPoint({
    lon: Cesium.Math.toDegrees(cartographic.longitude),
    lat: Cesium.Math.toDegrees(cartographic.latitude),
    height: cartographic.height,
    gridX: gridPoint.x,
    gridY: gridPoint.y
  }, lastLoadedFloodJson.value);

  if (currentFloodFrame.value > 0 && lastLoadedFloodJson.value) {
    recordFloodPointDepth(currentFloodFrame.value, lastLoadedFloodJson.value);
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

  if (!lastLoadedFloodJson.value || !DrawTriangleMesh.getCurrentModelMatrix()) {
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

const sleep = (durationMs = 0) => new Promise<void>((resolve) => {
  window.setTimeout(resolve, durationMs);
});

const showBuildingLoadMessage = async (message: string) => {
  buildingLayerMessage.value = message;
  await nextTick();
  await sleep(16);
};

const getPolygonRings = (geometry?: BuildingFootprintGeometry | null) => {
  if (!geometry) {
    return [];
  }

  if (geometry.type === 'Polygon') {
    return [geometry.coordinates as number[][][]];
  }

  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates as number[][][][];
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

const getBuildingExtrudedHeight = (feature: BuildingFootprintFeature) => {
  const properties = feature.properties ?? {};
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

    const worldPosition = Cesium.Cartesian3.fromDegrees(centroid.longitude, centroid.latitude);
    const gridPoint = DrawTriangleMesh.worldToFloodGrid(worldPosition);
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

const analyzeBuildingFlooding = async () => {
  const viewer = props.viewer;
  const dataSource = buildingDataSource.value;
  const floodJson = lastLoadedFloodJson.value;

  if (!viewer || !dataSource || !buildingLayerShown.value) {
    buildingLayerMessage.value = '请先加载并显示三维建筑';
    return;
  }

  if (!floodJson || !DrawTriangleMesh.getCurrentModelMatrix()) {
    buildingLayerMessage.value = '请先播放洪水案例，播放完成后再进行淹没分析';
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

  buildingLayerLoading.value = true;
  await showBuildingLoadMessage(`开始加载${BUILDING_LAYER_LABEL}...`);

  try {
    const cameraBounds = getCurrentCameraBounds(viewer);
    if (!cameraBounds) {
      throw new Error('无法获取当前相机视野范围，请先把镜头对准地表后再加载建筑');
    }

    await showBuildingLoadMessage('正在读取肖家桥建筑轮廓...');
    const response = await fetch(BUILDING_FOOTPRINT_GEOJSON_URL, { cache: 'no-cache' });
    if (!response.ok) {
      throw new Error(`建筑轮廓读取失败：${response.status}`);
    }
    const geojson = await response.json() as BuildingFootprintCollection;
    const dataSource = new Cesium.CustomDataSource('xiaojiaqiao_3d_buildings');
    let polygonCount = 0;
    const featureEntityRecords: BuildingFeatureEntityRecord[] = [];

    geojson.features.forEach((feature) => {
      if (!isFeatureInCameraBounds(feature, cameraBounds)) {
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

    await showBuildingLoadMessage('正在添加肖家桥三维建筑图层...');
    previousDepthTestAgainstTerrain = viewer.scene.globe.depthTestAgainstTerrain;
    viewer.scene.globe.depthTestAgainstTerrain = false;
    await viewer.dataSources.add(dataSource);
    buildingDataSource.value = dataSource;
    buildingFeatureEntityRecords = featureEntityRecords;
    buildingLayerViewer = viewer;
    buildingLayerShown.value = true;
    buildingStats.value = { total: 0, flooded: 0, safe: 0 };
    buildingLayerMessage.value = `${BUILDING_LAYER_LABEL}已加载：当前视野内 ${featureEntityRecords.length} 栋、${polygonCount} 个立体轮廓`;
    viewer.scene.requestRender();
  } catch (error) {
    const message = error instanceof Error ? error.message : '建筑图层加载失败';
    buildingLayerMessage.value = message;
  } finally {
    buildingLayerLoading.value = false;
  }
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
  buildingLayerViewer = null;
  buildingLayerShown.value = false;
  buildingLayerLoading.value = false;
  buildingStats.value = { total: 0, flooded: 0, safe: 0 };
};

watch(selectedFloodDepthPoint, updateDepthMarker, { immediate: true });
watch(() => props.viewer, updateDepthMarker);
onBeforeUnmount(() => {
  isPanelDisposed = true;
  stopDepthPick();
  removeDepthMarker();
  destroyOsmBuildings();
});
</script>

<template>
  <section class="flood-analysis-panel">
    <div class="metric-grid">
      <div class="metric-item current">
        <span>当前范围</span>
        <strong>{{ hasAreaData ? formatArea(latestAreaM2) : '--' }}</strong>
      </div>
      <div class="metric-item peak">
        <span>峰值范围</span>
        <strong>{{ hasAreaData ? formatArea(maxAreaM2) : '--' }}</strong>
      </div>
      <div class="metric-item">
        <span>最小范围</span>
        <strong>{{ hasAreaData ? formatArea(minAreaM2) : '--' }}</strong>
      </div>
      <div class="metric-item trend" :class="{ down: areaChangeM2 < 0 }">
        <span>较首帧</span>
        <strong>{{ hasAreaData ? formatSignedArea(areaChangeM2) : '--' }}</strong>
      </div>
    </div>

    <div class="analysis-block">
      <div class="block-heading">
        <span>淹没范围变化曲线</span>
        <b>{{ hasAreaData ? `${sortedAreaSeries.length} 帧` : '暂无数据' }}</b>
      </div>

      <div v-if="hasAreaData" class="chart-wrap">
        <svg class="analysis-chart" :viewBox="`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`" role="img" aria-label="淹没范围变化曲线">
          <defs>
            <linearGradient id="flood-area-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stop-color="#44e6ff" stop-opacity="0.28" />
              <stop offset="100%" stop-color="#48d18f" stop-opacity="0.04" />
            </linearGradient>
          </defs>
          <g class="grid-lines">
            <line v-for="tick in areaYTicks" :key="tick.label" :x1="PLOT_LEFT" :x2="PLOT_RIGHT" :y1="tick.y" :y2="tick.y" />
          </g>
          <g class="axis-labels y-axis">
            <text v-for="tick in areaYTicks" :key="`area-y-${tick.label}`" x="4" :y="tick.y + 4">{{ tick.label }}</text>
          </g>
          <polygon :points="areaFillPoints" class="area-fill" />
          <polyline :points="areaLinePoints" class="area-line" fill="none" />
          <circle v-for="point in areaDotPoints" :key="`area-${point.frame}-${point.x}`" :cx="point.x" :cy="point.y" r="2.4" class="area-dot" />
          <g class="axis-labels x-axis">
            <text v-for="tick in areaXTicks" :key="`area-x-${tick.frame}`" :x="tick.x" y="140">{{ tick.frame }}帧</text>
          </g>
        </svg>
      </div>

      <div v-else class="empty-state">
        <strong>暂无淹没范围数据</strong>
        <span>等待洪水帧数据加载</span>
      </div>
    </div>

    <div class="analysis-block depth-block">
      <div class="block-heading">
        <span>监测点水深变化曲线</span>
        <b>{{ hasDepthData ? `${sortedDepthSeries.length} 帧` : depthSampleStatus }}</b>
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

    <div class="analysis-block building-block">
      <div class="block-heading">
        <span>建筑物淹没分析</span>
        <b>{{ buildingLayerStatus }}</b>
      </div>

      <div class="point-toolbar building-toolbar">
        <button type="button" class="point-btn primary" :disabled="buildingLayerLoading" @click="toggleOsmBuildings">
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

    <div class="latest-strip">
      <span>当前帧</span>
      <strong>{{ currentFloodFrame || '--' }}</strong>
      <span>面积</span>
      <strong>{{ hasAreaData ? formatArea(latestAreaM2) : '--' }}</strong>
    </div>
  </section>
</template>

<style scoped>
.flood-analysis-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
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
  padding: 10px;
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
</style>
