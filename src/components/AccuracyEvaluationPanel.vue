<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import * as Cesium from 'cesium';
import type { Viewer } from 'cesium';
import { floodAreaSeries } from '../store/floodState';

const props = withDefaults(defineProps<{
  viewer?: Viewer | null;
}>(), {
  viewer: null
});

const EARTH_RADIUS_METERS = 6378137;
const SIMULATION_AREA_FRAME = 284;
const DISPLAY_FINAL_FRAME = 285;
const OBSERVED_BOUNDARY_OFFSET_METERS = 12;
const OVERLAP_BOUNDARY_OFFSET_METERS = 14;
const observedFileName = ref('');
const observedGeoJson = ref<any>(null);
const overlapGeoJson = ref<any>(null);
const observedAreaM2 = ref(0);
const overlapAreaM2 = ref(0);
const loading = ref(false);
const errorMessage = ref('');
const boundariesVisible = ref(false);
const boundaryDataSources: Cesium.GeoJsonDataSource[] = [];
const boundaryOutlineEntities: Cesium.Entity[] = [];

const simulatedAreaM2 = computed(() => (
  floodAreaSeries.value.find((point) => point.frame === SIMULATION_AREA_FRAME)?.areaM2 ?? 0
));
const precisionPercent = computed(() => percentage(overlapAreaM2.value, simulatedAreaM2.value));

const accuracyLevel = computed(() => {
  if (!observedGeoJson.value) return '待评价';
  if (!simulatedAreaM2.value) return '等待洪水数据';
  if (precisionPercent.value >= 90) return '高一致';
  if (precisionPercent.value >= 75) return '可接受';
  if (precisionPercent.value >= 60) return '需校核';
  return '偏差较大';
});

const statusText = computed(() => {
  if (loading.value) return '正在读取灾后边界与七盘沟重叠数据';
  if (errorMessage.value) return errorMessage.value;
  if (!observedGeoJson.value) return '请加载七盘沟灾后边界 GeoJSON';
  if (!simulatedAreaM2.value) return '请先在仿真模拟中渲染第 284 帧 Mesh 数据';
  return `已使用模拟最后一帧：第 ${DISPLAY_FINAL_FRAME} 帧，模拟面积取第 ${SIMULATION_AREA_FRAME} 帧 Mesh 面积`;
});

onUnmounted(clearBoundaryVisualization);

async function loadPostDisasterData() {
  loading.value = true;
  errorMessage.value = '';
  clearBoundaryVisualization();
  let loadedSuccessfully = false;
  try {
    const [observedResponse, overlapResponse] = await Promise.all([
      fetch('/precision/qipangou-zhaihou.geojson'),
      fetch('/precision/qipangou-chongdie.geojson')
    ]);
    if (!observedResponse.ok) throw new Error('七盘沟灾后边界 GeoJSON 读取失败');
    if (!overlapResponse.ok) throw new Error('七盘沟重叠范围 GeoJSON 读取失败');

    const [parsedObserved, parsedOverlap] = await Promise.all([
      observedResponse.json(),
      overlapResponse.json()
    ]);
    const parsedObservedAreaM2 = calculateGeoJsonAreaM2(parsedObserved);
    if (!Number.isFinite(parsedObservedAreaM2) || parsedObservedAreaM2 <= 0) {
      throw new Error('七盘沟灾后边界中没有有效的 Polygon 或 MultiPolygon');
    }

    observedGeoJson.value = parsedObserved;
    overlapGeoJson.value = parsedOverlap;
    observedFileName.value = 'qipangou-zhaihou.geojson';
    observedAreaM2.value = parsedObservedAreaM2;
    overlapAreaM2.value = calculateGeoJsonAreaM2(parsedOverlap);
    loadedSuccessfully = true;
  } catch (error) {
    observedGeoJson.value = null;
    overlapGeoJson.value = null;
    observedFileName.value = '';
    observedAreaM2.value = 0;
    overlapAreaM2.value = 0;
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
  }

  if (loadedSuccessfully && props.viewer) {
    await toggleBoundaryVisualization();
  }
}

async function toggleBoundaryVisualization() {
  if (!props.viewer || !observedGeoJson.value || !overlapGeoJson.value || loading.value || errorMessage.value) return;
  if (boundariesVisible.value) {
    clearBoundaryVisualization();
    return;
  }

  try {
    const observed = await Cesium.GeoJsonDataSource.load(observedGeoJson.value, {
      clampToGround: true,
      stroke: Cesium.Color.TRANSPARENT,
      strokeWidth: 0,
      fill: Cesium.Color.fromCssColorString('#ff2d7a').withAlpha(0.28)
    });
    const overlap = await Cesium.GeoJsonDataSource.load(overlapGeoJson.value, {
      clampToGround: true,
      stroke: Cesium.Color.TRANSPARENT,
      strokeWidth: 0,
      fill: Cesium.Color.fromCssColorString('#ffe600').withAlpha(0.44)
    });
    props.viewer.dataSources.add(observed);
    props.viewer.dataSources.add(overlap);
    boundaryDataSources.push(observed, overlap);
    await Promise.all([
      addRaisedBoundaryOutlines(
        observedGeoJson.value,
        Cesium.Color.fromCssColorString('#ff2d7a'),
        8,
        OBSERVED_BOUNDARY_OFFSET_METERS + 1
      ),
      addRaisedBoundaryOutlines(
        overlapGeoJson.value,
        Cesium.Color.fromCssColorString('#ffe600'),
        6,
        OVERLAP_BOUNDARY_OFFSET_METERS + 1
      )
    ]);
    boundariesVisible.value = true;
    await props.viewer.flyTo(
      [...observed.entities.values, ...overlap.entities.values],
      { duration: 1.2 }
    );
  } catch (error) {
    clearBoundaryVisualization();
    errorMessage.value = error instanceof Error ? error.message : String(error);
  }
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

function extractOuterRings(geoJson: any): Array<Array<[number, number]>> {
  const rings: Array<Array<[number, number]>> = [];
  const addRing = (coordinates: any) => {
    const ring = (Array.isArray(coordinates) ? coordinates : [])
      .map((coordinate) => [Number(coordinate?.[0]), Number(coordinate?.[1])] as [number, number])
      .filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat));
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
  const points = (Array.isArray(coordinates) ? coordinates : [])
    .map((coordinate) => ({ lon: Number(coordinate?.[0]), lat: Number(coordinate?.[1]) }))
    .filter((point) => Number.isFinite(point.lon) && Number.isFinite(point.lat));
  if (points.length < 3) return 0;

  const referenceLat = points.reduce((sum, point) => sum + point.lat, 0) / points.length;
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

function percentage(numerator: number, denominator: number) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 0;
  return Math.min(100, Math.max(0, numerator / denominator * 100));
}

function formatArea(areaM2: number) {
  if (!Number.isFinite(areaM2) || areaM2 <= 0) return '--';
  return `${(areaM2 / 1_000_000).toFixed(3)} km²`;
}
</script>

<template>
  <section class="accuracy-section">
    <div class="accuracy-heading">
      <div>
        <span class="section-tag">ACCURACY</span>
        <h3>七盘沟精度对比</h3>
      </div>
      <span class="status-pill">{{ accuracyLevel }}</span>
    </div>

    <button class="load-boundary-btn" type="button" :disabled="loading" @click="loadPostDisasterData">
      {{ loading ? '正在加载边界...' : '加载灾后边界数据' }}
    </button>

    <p class="accuracy-status" :class="{ error: errorMessage }">{{ statusText }}</p>

    <div class="formula-box">匹配精度 = S重叠 / S模拟 × 100%</div>

    <div class="accuracy-grid">
      <div><span>模拟区域</span><strong>七盘沟</strong></div>
      <div><span>模拟最后一帧</span><strong>第 {{ DISPLAY_FINAL_FRAME }} 帧</strong></div>
      <div><span>灾后真实面积</span><strong>{{ formatArea(observedAreaM2) }}</strong></div>
      <div><span>Mesh 模拟面积</span><strong>{{ formatArea(simulatedAreaM2) }}</strong></div>
      <div><span>重叠区域面积</span><strong>{{ formatArea(overlapAreaM2) }}</strong></div>
      <div><span>匹配精度</span><strong class="highlight">{{ observedGeoJson && simulatedAreaM2 ? precisionPercent.toFixed(1) + '%' : '--' }}</strong></div>
    </div>

    <div class="accuracy-meter" aria-label="七盘沟匹配精度">
      <div :style="{ width: `${precisionPercent}%` }"></div>
    </div>

    <div class="accuracy-footer">
      <button type="button" :disabled="!viewer || !observedGeoJson || loading || !!errorMessage" @click="toggleBoundaryVisualization">
        {{ boundariesVisible ? '隐藏范围' : '显示范围' }}
      </button>
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

.load-boundary-btn {
  width: 100%;
  min-height: 32px;
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
  border: 1px solid #ff2d7a;
  background: rgba(255, 45, 122, 0.3);
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
