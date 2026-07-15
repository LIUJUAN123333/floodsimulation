<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import * as Cesium from 'cesium';
import type { Viewer } from 'cesium';
import DrawTriangleMesh from '../js/DrawTriangleMesh';
import {
  currentFloodFrame,
  currentShowcaseCaseId,
  floodAreaSeries,
  floodCellSize,
  lastLoadedFloodJson
} from '../store/floodState';

const props = withDefaults(defineProps<{
  viewer?: Viewer | null;
}>(), {
  viewer: null
});

type Point2D = { x: number; y: number };
type LonLat = { lon: number; lat: number };

const EARTH_RADIUS_METERS = 6378137;
const BOUNDARY_OFFSET_METERS = 12;

const fileInputRef = ref<HTMLInputElement | null>(null);
const observedFileName = ref('');
const observedGeoJson = ref<any>(null);
const overlapGeoJson = ref<any>(null);
const observedAreaM2 = ref(0);
const overlapAreaM2 = ref(0);
const evaluatedFrame = ref(0);
const evaluatedSourceLabel = ref('');
const evaluatedSimulatedAreaM2 = ref(0);
const loading = ref(false);
const errorMessage = ref('');
const boundariesVisible = ref(false);
const boundaryDataSources: Cesium.GeoJsonDataSource[] = [];
const boundaryOutlineEntities: Cesium.Entity[] = [];

const lastAreaPoint = computed(() => {
  const series = floodAreaSeries.value
    .filter((point) => Number.isFinite(point.frame) && Number.isFinite(point.areaM2))
    .sort((a, b) => a.frame - b.frame);
  return series.at(-1) ?? null;
});

const comparisonFrame = computed(() => lastAreaPoint.value?.frame ?? currentFloodFrame.value);
const simulatedAreaM2 = computed(() => lastAreaPoint.value?.areaM2 ?? 0);
const hasFloodData = computed(() => Boolean(lastLoadedFloodJson.value) && simulatedAreaM2.value > 0);
const floodSourceLabel = computed(() => (
  currentShowcaseCaseId.value ? '案例演示' : hasFloodData.value ? '仿真模拟 / 当前洪水' : '--'
));
const comparisonFrameLabel = computed(() => (
  evaluatedFrame.value > 0
    ? `评价帧：第 ${evaluatedFrame.value} 帧`
    : comparisonFrame.value > 0
      ? `当前结果最后记录帧：第 ${comparisonFrame.value} 帧`
      : '--'
));
const displayFloodSourceLabel = computed(() => evaluatedSourceLabel.value || floodSourceLabel.value);
const displaySimulatedAreaM2 = computed(() => evaluatedSimulatedAreaM2.value || simulatedAreaM2.value);
const precisionPercent = computed(() => percentage(overlapAreaM2.value, displaySimulatedAreaM2.value));
const canEvaluate = computed(() => Boolean(observedGeoJson.value) && evaluatedSimulatedAreaM2.value > 0);

const accuracyLevel = computed(() => {
  if (loading.value) return '读取中';
  if (errorMessage.value) return '异常';
  if (!observedGeoJson.value) return '待上传';
  if (!canEvaluate.value) return '待洪水';
  if (precisionPercent.value >= 90) return '高一致';
  if (precisionPercent.value >= 75) return '可接受';
  if (precisionPercent.value >= 60) return '需校核';
  return '偏差较大';
});

const statusText = computed(() => {
  if (loading.value) return '正在读取灾后真实范围 GeoJSON...';
  if (errorMessage.value) return errorMessage.value;
  if (!observedGeoJson.value) return '请上传灾后真实淹没范围 GeoJSON 文件';
  if (!canEvaluate.value) return '请先播放案例或加载 Mesh 洪水数据后，再重新上传灾后真实范围';
  return `已使用${displayFloodSourceLabel.value}的最后记录帧进行评价`;
});

onUnmounted(clearBoundaryVisualization);

function openFilePicker() {
  fileInputRef.value?.click();
}

async function handleObservedFileChange(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;

  loading.value = true;
  errorMessage.value = '';
  clearBoundaryVisualization();
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const area = calculateGeoJsonAreaM2(parsed);
    if (!Number.isFinite(area) || area <= 0) {
      throw new Error('上传文件中没有有效的 Polygon 或 MultiPolygon 范围');
    }

    observedGeoJson.value = parsed;
    observedFileName.value = file.name;
    observedAreaM2.value = area;
    updateAccuracyResult();
  } catch (error) {
    observedGeoJson.value = null;
    overlapGeoJson.value = null;
    observedFileName.value = '';
    observedAreaM2.value = 0;
    overlapAreaM2.value = 0;
    evaluatedFrame.value = 0;
    evaluatedSourceLabel.value = '';
    evaluatedSimulatedAreaM2.value = 0;
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
    if (event.target instanceof HTMLInputElement) {
      event.target.value = '';
    }
  }
}

function updateAccuracyResult() {
  if (!observedGeoJson.value || !lastLoadedFloodJson.value || !simulatedAreaM2.value) {
    overlapAreaM2.value = 0;
    overlapGeoJson.value = null;
    evaluatedFrame.value = 0;
    evaluatedSourceLabel.value = '';
    evaluatedSimulatedAreaM2.value = 0;
    return;
  }

  const result = calculateSimulatedOverlap(lastLoadedFloodJson.value, observedGeoJson.value);
  overlapAreaM2.value = result.areaM2;
  overlapGeoJson.value = result.geoJson;
  evaluatedFrame.value = comparisonFrame.value;
  evaluatedSourceLabel.value = floodSourceLabel.value;
  evaluatedSimulatedAreaM2.value = simulatedAreaM2.value;
}

async function toggleBoundaryVisualization() {
  if (!props.viewer || !observedGeoJson.value || loading.value || errorMessage.value) return;
  if (boundariesVisible.value) {
    clearBoundaryVisualization();
    return;
  }

  try {
    const observed = await Cesium.GeoJsonDataSource.load(observedGeoJson.value, {
      clampToGround: true,
      stroke: Cesium.Color.TRANSPARENT,
      strokeWidth: 0,
      fill: Cesium.Color.fromCssColorString('#ff2d2d').withAlpha(0.3)
    });
    const overlap = overlapGeoJson.value
      ? await Cesium.GeoJsonDataSource.load(overlapGeoJson.value, {
        clampToGround: true,
        stroke: Cesium.Color.TRANSPARENT,
        strokeWidth: 0,
        fill: Cesium.Color.fromCssColorString('#ffe600').withAlpha(0.48)
      })
      : null;
    props.viewer.dataSources.add(observed);
    boundaryDataSources.push(observed);
    if (overlap) {
      props.viewer.dataSources.add(overlap);
      boundaryDataSources.push(overlap);
    }
    await Promise.all([
      addRaisedBoundaryOutlines(
        observedGeoJson.value,
        Cesium.Color.fromCssColorString('#ff2d2d'),
        7,
        BOUNDARY_OFFSET_METERS
      ),
      overlapGeoJson.value
        ? addRaisedBoundaryOutlines(
          overlapGeoJson.value,
          Cesium.Color.fromCssColorString('#ffe600'),
          5,
          BOUNDARY_OFFSET_METERS + 2
        )
        : Promise.resolve()
    ]);
    boundariesVisible.value = true;
    await props.viewer.flyTo(
      overlap ? [...observed.entities.values, ...overlap.entities.values] : observed.entities.values,
      { duration: 1.2 }
    );
  } catch (error) {
    clearBoundaryVisualization();
    errorMessage.value = error instanceof Error ? error.message : String(error);
  }
}

function clearAccuracyData() {
  clearBoundaryVisualization();
  observedGeoJson.value = null;
  overlapGeoJson.value = null;
  observedFileName.value = '';
  observedAreaM2.value = 0;
  overlapAreaM2.value = 0;
  evaluatedFrame.value = 0;
  evaluatedSourceLabel.value = '';
  evaluatedSimulatedAreaM2.value = 0;
  errorMessage.value = '';
}

async function addRaisedBoundaryOutlines(
  geoJson: any,
  color: Cesium.Color,
  width: number,
  offsetMeters: number
) {
  if (!props.viewer) return;

  for (const ring of extractOuterRings(geoJson)) {
    const cartographics = ring.map(([lon, lat]) => Cesium.Cartographic.fromDegrees(lon, lat));
    try {
      await Cesium.sampleTerrain(props.viewer.terrainProvider, 12, cartographics);
    } catch (error) {
      console.warn('Boundary terrain sampling failed', error);
    }

    const positions = cartographics.map((position) => {
      const loadedHeight = props.viewer?.scene.globe.getHeight(position);
      const terrainHeight = Number.isFinite(position.height)
        ? position.height
        : Number.isFinite(loadedHeight)
          ? Number(loadedHeight)
          : 0;
      return Cesium.Cartesian3.fromRadians(
        position.longitude,
        position.latitude,
        terrainHeight + offsetMeters
      );
    });

    boundaryOutlineEntities.push(props.viewer.entities.add({
      polyline: {
        positions,
        width,
        clampToGround: false,
        material: new Cesium.PolylineGlowMaterialProperty({
          glowPower: 0.32,
          taperPower: 0.7,
          color
        })
      }
    }));
  }
}

function clearBoundaryVisualization() {
  if (props.viewer) {
    boundaryDataSources.splice(0).forEach((dataSource) => {
      if (props.viewer?.dataSources.contains(dataSource)) {
        props.viewer.dataSources.remove(dataSource, true);
      }
    });
    boundaryOutlineEntities.splice(0).forEach((entity) => {
      if (props.viewer?.entities.contains(entity)) props.viewer.entities.remove(entity);
    });
  } else {
    boundaryDataSources.length = 0;
    boundaryOutlineEntities.length = 0;
  }
  boundariesVisible.value = false;
}

function getSimulationVertices(floodData: any): LonLat[] {
  if (Array.isArray(floodData?.positions)) {
    const vertices: LonLat[] = [];
    for (let index = 0; index + 1 < floodData.positions.length; index += 2) {
      const lon = Number(floodData.positions[index]);
      const lat = Number(floodData.positions[index + 1]);
      if (Number.isFinite(lon) && Number.isFinite(lat)) vertices.push({ lon, lat });
    }
    return vertices;
  }

  if (!Array.isArray(floodData?.Vector)) return [];
  const modelMatrix = DrawTriangleMesh.getCurrentModelMatrix();
  const cellSize = floodCellSize.value || 1;
  if (!modelMatrix) return [];

  const vertices: LonLat[] = [];
  for (let index = 0; index + 2 < floodData.Vector.length; index += 3) {
    const local = new Cesium.Cartesian3(
      Number(floodData.Vector[index]) * cellSize,
      Number(floodData.Vector[index + 1]) * cellSize,
      Number(floodData.Vector[index + 2]) || 0
    );
    if (![local.x, local.y, local.z].every(Number.isFinite)) continue;

    const world = Cesium.Matrix4.multiplyByPoint(modelMatrix, local, new Cesium.Cartesian3());
    const cartographic = Cesium.Cartographic.fromCartesian(world);
    vertices.push({
      lon: Cesium.Math.toDegrees(cartographic.longitude),
      lat: Cesium.Math.toDegrees(cartographic.latitude)
    });
  }
  return vertices;
}

function getSimulationTriangles(floodData: any): number[] {
  const source = Array.isArray(floodData?.triangles) ? floodData.triangles : floodData?.Face;
  return Array.isArray(source)
    ? source.map((item: unknown) => Number(item)).filter(Number.isFinite)
    : [];
}

function calculateSimulatedOverlap(floodData: any, observed: any) {
  const vertices = getSimulationVertices(floodData);
  const triangles = getSimulationTriangles(floodData);
  if (!vertices.length || !triangles.length) {
    return { areaM2: 0, geoJson: null };
  }

  const referenceLat = getReferenceLatitude([...vertices, ...extractOuterRings(observed).flat().map(([lon, lat]) => ({ lon, lat }))]);
  const project = (point: LonLat): Point2D => ({
    x: Cesium.Math.toRadians(point.lon) * EARTH_RADIUS_METERS * Math.cos(Cesium.Math.toRadians(referenceLat)),
    y: Cesium.Math.toRadians(point.lat) * EARTH_RADIUS_METERS
  });

  let overlapArea = 0;
  const features: any[] = [];
  for (let index = 0; index + 2 < triangles.length; index += 3) {
    const a = vertices[triangles[index]];
    const b = vertices[triangles[index + 1]];
    const c = vertices[triangles[index + 2]];
    if (!a || !b || !c) continue;

    const centroid = {
      lon: (a.lon + b.lon + c.lon) / 3,
      lat: (a.lat + b.lat + c.lat) / 3
    };
    if (!isPointInGeoJson(centroid, observed)) continue;

    overlapArea += triangleAreaM2(project(a), project(b), project(c));
    features.push({
      type: 'Feature',
      properties: { kind: 'overlap' },
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [a.lon, a.lat],
          [b.lon, b.lat],
          [c.lon, c.lat],
          [a.lon, a.lat]
        ]]
      }
    });
  }

  return {
    areaM2: Math.min(overlapArea, simulatedAreaM2.value, observedAreaM2.value),
    geoJson: features.length
      ? {
        type: 'FeatureCollection',
        features
      }
      : null
  };
}

function calculateGeoJsonAreaM2(geoJson: any) {
  const features = geoJson?.type === 'FeatureCollection'
    ? geoJson.features
    : geoJson?.type === 'Feature'
      ? [geoJson]
      : [{ geometry: geoJson }];

  return (Array.isArray(features) ? features : []).reduce((total: number, feature: any) => (
    total + calculateGeometryAreaM2(feature?.geometry)
  ), 0);
}

function calculateGeometryAreaM2(geometry: any): number {
  if (!geometry) return 0;
  if (geometry.type === 'Polygon') return calculatePolygonAreaM2(geometry.coordinates);
  if (geometry.type === 'MultiPolygon') {
    return (geometry.coordinates || []).reduce((total: number, polygon: any) => (
      total + calculatePolygonAreaM2(polygon)
    ), 0);
  }
  if (geometry.type === 'GeometryCollection') {
    return (geometry.geometries || []).reduce((total: number, item: any) => (
      total + calculateGeometryAreaM2(item)
    ), 0);
  }
  return 0;
}

function calculatePolygonAreaM2(rings: any[]) {
  if (!Array.isArray(rings) || !rings.length) return 0;
  const outerArea = calculateRingAreaM2(rings[0]);
  const holeArea = rings.slice(1).reduce((total, ring) => total + calculateRingAreaM2(ring), 0);
  return Math.max(0, outerArea - holeArea);
}

function calculateRingAreaM2(coordinates: any[]) {
  const points = parseRing(coordinates);
  if (points.length < 3) return 0;

  const referenceLat = getReferenceLatitude(points);
  const xScale = EARTH_RADIUS_METERS * Math.cos(Cesium.Math.toRadians(referenceLat));
  let signedArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const currentX = Cesium.Math.toRadians(current.lon) * xScale;
    const currentY = Cesium.Math.toRadians(current.lat) * EARTH_RADIUS_METERS;
    const nextX = Cesium.Math.toRadians(next.lon) * xScale;
    const nextY = Cesium.Math.toRadians(next.lat) * EARTH_RADIUS_METERS;
    signedArea += currentX * nextY - nextX * currentY;
  }
  return Math.abs(signedArea) / 2;
}

function extractOuterRings(geoJson: any): Array<Array<[number, number]>> {
  const rings: Array<Array<[number, number]>> = [];
  const addRing = (coordinates: any) => {
    const ring = parseRing(coordinates).map((point) => [point.lon, point.lat] as [number, number]);
    if (ring.length >= 3) rings.push(ring);
  };
  const visitGeometry = (geometry: any) => {
    if (geometry?.type === 'Polygon') addRing(geometry.coordinates?.[0]);
    if (geometry?.type === 'MultiPolygon') {
      geometry.coordinates?.forEach((polygon: any) => addRing(polygon?.[0]));
    }
    if (geometry?.type === 'GeometryCollection') {
      geometry.geometries?.forEach(visitGeometry);
    }
  };

  if (geoJson?.type === 'FeatureCollection') geoJson.features?.forEach((feature: any) => visitGeometry(feature.geometry));
  else if (geoJson?.type === 'Feature') visitGeometry(geoJson.geometry);
  else visitGeometry(geoJson);
  return rings;
}

function parseRing(coordinates: any[]) {
  return (Array.isArray(coordinates) ? coordinates : [])
    .map((coordinate) => ({ lon: Number(coordinate?.[0]), lat: Number(coordinate?.[1]) }))
    .filter((point) => Number.isFinite(point.lon) && Number.isFinite(point.lat));
}

function isPointInGeoJson(point: LonLat, geoJson: any): boolean {
  const visitGeometry = (geometry: any): boolean => {
    if (!geometry) return false;
    if (geometry.type === 'Polygon') return isPointInPolygon(point, geometry.coordinates);
    if (geometry.type === 'MultiPolygon') {
      return (geometry.coordinates || []).some((polygon: any) => isPointInPolygon(point, polygon));
    }
    if (geometry.type === 'GeometryCollection') {
      return (geometry.geometries || []).some(visitGeometry);
    }
    return false;
  };

  if (geoJson?.type === 'FeatureCollection') {
    return (geoJson.features || []).some((feature: any) => visitGeometry(feature.geometry));
  }
  if (geoJson?.type === 'Feature') return visitGeometry(geoJson.geometry);
  return visitGeometry(geoJson);
}

function isPointInPolygon(point: LonLat, rings: any[]) {
  if (!Array.isArray(rings) || !rings.length) return false;
  const outer = isPointInRing(point, parseRing(rings[0]));
  const inHole = rings.slice(1).some((ring) => isPointInRing(point, parseRing(ring)));
  return outer && !inHole;
}

function isPointInRing(point: LonLat, ring: LonLat[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const xi = ring[i].lon;
    const yi = ring[i].lat;
    const xj = ring[j].lon;
    const yj = ring[j].lat;
    const intersect = ((yi > point.lat) !== (yj > point.lat))
      && (point.lon < ((xj - xi) * (point.lat - yi)) / ((yj - yi) || 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function getReferenceLatitude(points: LonLat[]) {
  if (!points.length) return 0;
  return points.reduce((sum, point) => sum + point.lat, 0) / points.length;
}

function triangleAreaM2(a: Point2D, b: Point2D, c: Point2D) {
  return Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
}

function percentage(numerator: number, denominator: number) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 0;
  return Math.min(100, Math.max(0, numerator / denominator * 100));
}

function formatArea(areaM2: number) {
  if (!Number.isFinite(areaM2) || areaM2 <= 0) return '--';
  return `${Number((areaM2 / 1_000_000).toFixed(3))} km²`;
}
</script>

<template>
  <section class="accuracy-section">
    <div class="accuracy-heading">
      <div>
        <span class="section-tag">ACCURACY</span>
        <h3>精度评价</h3>
      </div>
      <span class="status-pill">{{ accuracyLevel }}</span>
    </div>

    <input
      ref="fileInputRef"
      class="hidden-file-input"
      type="file"
      hidden
      tabindex="-1"
      accept=".geojson,.json,application/geo+json,application/json"
      @change="handleObservedFileChange"
    />

    <button class="load-boundary-btn" type="button" :disabled="loading" @click="openFilePicker">
      {{ loading ? '正在读取...' : '上传灾后真实范围 GeoJSON' }}
    </button>

    <p class="accuracy-status" :class="{ error: errorMessage }">{{ statusText }}</p>

    <div class="formula-box">匹配精度 = 重叠面积 / 模拟淹没面积 × 100%</div>

    <div class="accuracy-grid">
      <div><span>洪水来源</span><strong>{{ displayFloodSourceLabel }}</strong></div>
      <div><span>对比帧</span><strong>{{ comparisonFrameLabel }}</strong></div>
      <div><span>灾后真实面积</span><strong>{{ formatArea(observedAreaM2) }}</strong></div>
      <div><span>模拟淹没面积</span><strong>{{ formatArea(displaySimulatedAreaM2) }}</strong></div>
      <div><span>重叠区域面积</span><strong>{{ canEvaluate ? formatArea(overlapAreaM2) : '--' }}</strong></div>
      <div><span>匹配精度</span><strong class="highlight">{{ canEvaluate ? precisionPercent.toFixed(1) + '%' : '--' }}</strong></div>
    </div>

    <div class="accuracy-meter" aria-label="匹配精度">
      <div :style="{ width: `${canEvaluate ? precisionPercent : 0}%` }"></div>
    </div>

    <div class="accuracy-footer">
      <button type="button" :disabled="!viewer || !observedGeoJson || loading || !!errorMessage" @click="toggleBoundaryVisualization">
        {{ boundariesVisible ? '隐藏范围' : '显示范围' }}
      </button>
      <button type="button" :disabled="!observedGeoJson && !errorMessage" @click="clearAccuracyData">清除结果</button>
    </div>

    <div class="boundary-legend">
      <span><i class="observed"></i>灾后真实范围</span>
      <span><i class="overlap"></i>模拟重叠范围</span>
    </div>
    <p v-if="observedFileName" class="sample-source">{{ observedFileName }}</p>
  </section>
</template>

<style scoped>
.accuracy-section {
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding: 11px;
  border: 1px solid rgba(0, 229, 255, 0.2);
  border-radius: 8px;
  background: rgba(2, 15, 29, 0.55);
  box-shadow: inset 0 0 16px rgba(0, 229, 255, 0.05);
}

.accuracy-heading,
.accuracy-footer,
.boundary-legend {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.section-tag {
  color: #78dff7;
  font-size: 9px;
}

h3 {
  margin: 3px 0 0;
  color: #f1fbff;
  font-size: 14px;
  letter-spacing: 0;
}

.status-pill {
  padding: 4px 7px;
  border: 1px solid rgba(255, 209, 102, 0.32);
  border-radius: 4px;
  color: #ffd166;
  background: rgba(255, 209, 102, 0.08);
  font-size: 10px;
  white-space: nowrap;
}

.hidden-file-input {
  display: none !important;
}

.load-boundary-btn {
  width: 100%;
  min-height: 34px;
  border: 1px solid rgba(0, 229, 255, 0.28);
  border-radius: 4px;
  color: #a6f2ff;
  background: rgba(0, 229, 255, 0.1);
  cursor: pointer;
}

.load-boundary-btn:hover:not(:disabled) {
  background: rgba(0, 229, 255, 0.17);
}

.load-boundary-btn:disabled {
  opacity: 0.55;
  cursor: wait;
}

.accuracy-status,
.formula-box {
  margin: 0;
  padding: 7px 8px;
  color: #bcefff;
  background: rgba(0, 229, 255, 0.07);
  font-size: 11px;
  line-height: 1.45;
}

.accuracy-status {
  border-left: 2px solid #00e5ff;
}

.accuracy-status.error {
  border-left-color: #ff7b57;
  color: #ffd7d0;
}

.formula-box {
  border: 1px solid rgba(0, 229, 255, 0.13);
  border-radius: 5px;
  color: #dffbff;
  background: rgba(0, 0, 0, 0.15);
}

.accuracy-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}

.accuracy-grid > div {
  min-width: 0;
  min-height: 49px;
  padding: 7px 8px;
  border: 1px solid rgba(127, 182, 213, 0.14);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.035);
}

.accuracy-grid span,
.accuracy-grid strong {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.accuracy-grid span {
  color: #82a8bf;
  font-size: 10px;
}

.accuracy-grid strong {
  margin-top: 5px;
  color: #f4fbff;
  font-size: 13px;
}

.accuracy-grid .highlight {
  color: #20ebd0;
}

.accuracy-meter {
  height: 6px;
  overflow: hidden;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.08);
}

.accuracy-meter div {
  height: 100%;
  background: linear-gradient(90deg, #ff7b57, #ffd166, #20ebd0);
  transition: width 0.25s ease;
}

.accuracy-footer,
.boundary-legend {
  color: #9ec5da;
  font-size: 10px;
}

.accuracy-footer {
  justify-content: flex-end;
}

.accuracy-footer button {
  min-height: 28px;
  padding: 0 9px;
  border: 1px solid rgba(0, 229, 255, 0.24);
  border-radius: 4px;
  color: #9eefff;
  background: rgba(0, 229, 255, 0.08);
  cursor: pointer;
}

.accuracy-footer button:disabled {
  opacity: 0.45;
  cursor: default;
}

.boundary-legend {
  justify-content: flex-start;
  gap: 14px;
}

.boundary-legend span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.boundary-legend i {
  width: 18px;
  height: 7px;
  border-radius: 2px;
}

.boundary-legend .observed {
  border: 1px solid #ff2d2d;
  background: rgba(255, 45, 45, 0.34);
}

.boundary-legend .overlap {
  border: 1px solid #ffe600;
  background: rgba(255, 230, 0, 0.34);
}

.sample-source {
  overflow: hidden;
  margin: 0;
  color: #789eb5;
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
