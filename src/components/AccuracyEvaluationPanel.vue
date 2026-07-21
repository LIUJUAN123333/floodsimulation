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
type TriangleIndices = [number, number, number];
type TriangleLonLat = [LonLat, LonLat, LonLat];
type RingBounds = { west: number; east: number; south: number; north: number };
type ParsedObservedPolygon = { outer: LonLat[]; holes: LonLat[][]; bounds: RingBounds };

const EARTH_RADIUS_METERS = 6378137;
const ACCURACY_BOUNDARY_SOURCE_NAME = 'accuracy-boundary-visualization';
const OVERLAP_SAMPLE_DIVISIONS = 5;
const OVERLAP_VISUALIZATION_MIN_FRACTION = 0.04;

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
let boundaryVisualizationToken = 0;

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

  const token = ++boundaryVisualizationToken;
  try {
    const observed = await Cesium.GeoJsonDataSource.load(observedGeoJson.value, {
      clampToGround: true,
      stroke: Cesium.Color.TRANSPARENT,
      strokeWidth: 0,
      fill: Cesium.Color.fromCssColorString('#ff2d2d').withAlpha(0.3)
    });
    observed.name = `${ACCURACY_BOUNDARY_SOURCE_NAME}:observed`;
    if (token !== boundaryVisualizationToken || !props.viewer || !observedGeoJson.value) {
      return;
    }
    props.viewer.dataSources.add(observed);
    boundaryDataSources.push(observed);
    if (token !== boundaryVisualizationToken || !props.viewer || !observedGeoJson.value) {
      clearBoundaryVisualization();
      return;
    }
    boundariesVisible.value = true;
    await props.viewer.flyTo(
      observed.entities.values,
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

function clearBoundaryVisualization() {
  boundaryVisualizationToken += 1;
  if (props.viewer) {
    boundaryDataSources.splice(0).forEach((dataSource) => {
      props.viewer?.dataSources.remove(dataSource, true);
    });

    const dataSources = props.viewer.dataSources;
    for (let index = dataSources.length - 1; index >= 0; index -= 1) {
      const dataSource = dataSources.get(index);
      if (dataSource?.name?.startsWith(ACCURACY_BOUNDARY_SOURCE_NAME)) {
        dataSources.remove(dataSource, true);
      }
    }
  } else {
    boundaryDataSources.length = 0;
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
  const observedPolygons = parseObservedPolygons(observed);
  if (!vertices.length || !triangles.length) {
    return { areaM2: 0, geoJson: null };
  }
  if (!observedPolygons.length) {
    return { areaM2: 0, geoJson: null };
  }

  const referenceLat = getReferenceLatitude([...vertices, ...extractOuterRings(observed).flat().map(([lon, lat]) => ({ lon, lat }))]);
  const project = (point: LonLat): Point2D => ({
    x: Cesium.Math.toRadians(point.lon) * EARTH_RADIUS_METERS * Math.cos(Cesium.Math.toRadians(referenceLat)),
    y: Cesium.Math.toRadians(point.lat) * EARTH_RADIUS_METERS
  });

  let overlapArea = 0;
  const overlapTriangles: TriangleIndices[] = [];
  for (let index = 0; index + 2 < triangles.length; index += 3) {
    const aIndex = triangles[index];
    const bIndex = triangles[index + 1];
    const cIndex = triangles[index + 2];
    const a = vertices[aIndex];
    const b = vertices[bIndex];
    const c = vertices[cIndex];
    if (!a || !b || !c) continue;

    const triangle: TriangleLonLat = [a, b, c];
    const coverageFraction = getTriangleObservedCoverageFraction(triangle, observedPolygons);
    if (coverageFraction <= 0) continue;

    overlapArea += triangleAreaM2(project(a), project(b), project(c)) * coverageFraction;
    if (coverageFraction >= OVERLAP_VISUALIZATION_MIN_FRACTION) {
      overlapTriangles.push([aIndex, bIndex, cIndex]);
    }
  }

  return {
    areaM2: Math.min(overlapArea, simulatedAreaM2.value, observedAreaM2.value),
    geoJson: buildSmoothedBoundaryGeoJson(vertices, overlapTriangles)
  };
}

function getTriangleObservedCoverageFraction(triangle: TriangleLonLat, observedPolygons: ParsedObservedPolygon[]) {
  let insideSamples = 0;
  let totalSamples = 0;

  for (let row = 0; row < OVERLAP_SAMPLE_DIVISIONS; row += 1) {
    for (let column = 0; column < OVERLAP_SAMPLE_DIVISIONS - row; column += 1) {
      const firstPoint = interpolateTrianglePoint(triangle, (row + 1 / 3) / OVERLAP_SAMPLE_DIVISIONS, (column + 1 / 3) / OVERLAP_SAMPLE_DIVISIONS);
      totalSamples += 1;
      if (isPointInParsedObservedPolygons(firstPoint, observedPolygons)) {
        insideSamples += 1;
      }

      if (row + column < OVERLAP_SAMPLE_DIVISIONS - 1) {
        const secondPoint = interpolateTrianglePoint(triangle, (row + 2 / 3) / OVERLAP_SAMPLE_DIVISIONS, (column + 2 / 3) / OVERLAP_SAMPLE_DIVISIONS);
        totalSamples += 1;
        if (isPointInParsedObservedPolygons(secondPoint, observedPolygons)) {
          insideSamples += 1;
        }
      }
    }
  }

  return totalSamples > 0 ? insideSamples / totalSamples : 0;
}

function interpolateTrianglePoint([a, b, c]: TriangleLonLat, aWeight: number, bWeight: number): LonLat {
  const cWeight = 1 - aWeight - bWeight;
  return {
    lon: (a.lon * aWeight) + (b.lon * bWeight) + (c.lon * cWeight),
    lat: (a.lat * aWeight) + (b.lat * bWeight) + (c.lat * cWeight)
  };
}

function buildSmoothedBoundaryGeoJson(vertices: LonLat[], triangles: TriangleIndices[]) {
  if (!triangles.length) return null;

  const edgeCounts = new Map<string, { count: number; from: number; to: number }>();
  const addEdge = (from: number, to: number) => {
    const key = from < to ? `${from}:${to}` : `${to}:${from}`;
    const existing = edgeCounts.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      edgeCounts.set(key, { count: 1, from, to });
    }
  };

  triangles.forEach(([a, b, c]) => {
    addEdge(a, b);
    addEdge(b, c);
    addEdge(c, a);
  });

  const boundaryEdges = Array.from(edgeCounts.values()).filter((edge) => edge.count === 1);
  const adjacency = new Map<number, number[]>();
  boundaryEdges.forEach(({ from, to }) => {
    adjacency.set(from, [...(adjacency.get(from) ?? []), to]);
    adjacency.set(to, [...(adjacency.get(to) ?? []), from]);
  });

  const usedEdges = new Set<string>();
  const edgeKey = (from: number, to: number) => (from < to ? `${from}:${to}` : `${to}:${from}`);
  const rings: Array<Array<[number, number]>> = [];

  for (const { from, to } of boundaryEdges) {
    const firstKey = edgeKey(from, to);
    if (usedEdges.has(firstKey)) continue;

    const ringIndices = [from, to];
    usedEdges.add(firstKey);
    let previous = from;
    let current = to;

    for (let guard = 0; guard < boundaryEdges.length + 5; guard += 1) {
      const neighbors = adjacency.get(current) ?? [];
      const next = neighbors.find((neighbor) => neighbor !== previous && !usedEdges.has(edgeKey(current, neighbor)));
      if (next === undefined) break;

      usedEdges.add(edgeKey(current, next));
      if (next === ringIndices[0]) {
        ringIndices.push(next);
        break;
      }

      ringIndices.push(next);
      previous = current;
      current = next;
    }

    if (ringIndices.length >= 4 && ringIndices[0] === ringIndices[ringIndices.length - 1]) {
      const ring = ringIndices
        .map((vertexIndex) => vertices[vertexIndex])
        .filter(Boolean)
        .map((point) => [point.lon, point.lat] as [number, number]);
      const smoothed = smoothClosedRing(ring, 2);
      if (smoothed.length >= 4) rings.push(smoothed);
    }
  }

  if (!rings.length) return null;

  return {
    type: 'FeatureCollection',
    features: rings.map((ring) => ({
      type: 'Feature',
      properties: { kind: 'overlap-boundary' },
      geometry: {
        type: 'Polygon',
        coordinates: [ring]
      }
    }))
  };
}

function smoothClosedRing(ring: Array<[number, number]>, iterations: number) {
  let points = ring.slice(0, -1);
  if (points.length < 3) return ring;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const nextPoints: Array<[number, number]> = [];
    for (let index = 0; index < points.length; index += 1) {
      const current = points[index];
      const next = points[(index + 1) % points.length];
      nextPoints.push([
        current[0] * 0.75 + next[0] * 0.25,
        current[1] * 0.75 + next[1] * 0.25
      ]);
      nextPoints.push([
        current[0] * 0.25 + next[0] * 0.75,
        current[1] * 0.25 + next[1] * 0.75
      ]);
    }
    points = nextPoints;
  }

  return [...points, points[0]];
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

function parseObservedPolygons(geoJson: any): ParsedObservedPolygon[] {
  const polygons: ParsedObservedPolygon[] = [];
  const addPolygon = (coordinates: any) => {
    if (!Array.isArray(coordinates) || !coordinates.length) return;

    const outer = parseRing(coordinates[0]);
    if (outer.length < 3) return;

    const holes = coordinates
      .slice(1)
      .map((ring: any) => parseRing(ring))
      .filter((ring: LonLat[]) => ring.length >= 3);
    polygons.push({
      outer,
      holes,
      bounds: getRingBounds(outer)
    });
  };

  const visitGeometry = (geometry: any) => {
    if (!geometry) return;
    if (geometry.type === 'Polygon') {
      addPolygon(geometry.coordinates);
      return;
    }
    if (geometry.type === 'MultiPolygon') {
      geometry.coordinates?.forEach(addPolygon);
      return;
    }
    if (geometry.type === 'GeometryCollection') {
      geometry.geometries?.forEach(visitGeometry);
    }
  };

  if (geoJson?.type === 'FeatureCollection') geoJson.features?.forEach((feature: any) => visitGeometry(feature.geometry));
  else if (geoJson?.type === 'Feature') visitGeometry(geoJson.geometry);
  else visitGeometry(geoJson);
  return polygons;
}

function getRingBounds(ring: LonLat[]): RingBounds {
  return ring.reduce((bounds, point) => ({
    west: Math.min(bounds.west, point.lon),
    east: Math.max(bounds.east, point.lon),
    south: Math.min(bounds.south, point.lat),
    north: Math.max(bounds.north, point.lat)
  }), {
    west: Number.POSITIVE_INFINITY,
    east: Number.NEGATIVE_INFINITY,
    south: Number.POSITIVE_INFINITY,
    north: Number.NEGATIVE_INFINITY
  });
}

function isPointInParsedObservedPolygons(point: LonLat, polygons: ParsedObservedPolygon[]) {
  return polygons.some((polygon) => {
    if (
      point.lon < polygon.bounds.west ||
      point.lon > polygon.bounds.east ||
      point.lat < polygon.bounds.south ||
      point.lat > polygon.bounds.north
    ) {
      return false;
    }

    return isPointInRing(point, polygon.outer) &&
      !polygon.holes.some((hole) => isPointInRing(point, hole));
  });
}

function parseRing(coordinates: any[]) {
  return (Array.isArray(coordinates) ? coordinates : [])
    .map((coordinate) => ({ lon: Number(coordinate?.[0]), lat: Number(coordinate?.[1]) }))
    .filter((point) => Number.isFinite(point.lon) && Number.isFinite(point.lat));
}

function isPointInRing(point: LonLat, ring: LonLat[]) {
  if (ring.length < 3) return false;

  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    if (isPointOnRingSegment(point, ring[j], ring[i])) {
      return true;
    }

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

function isPointOnRingSegment(point: LonLat, start: LonLat, end: LonLat) {
  const dx = end.lon - start.lon;
  const dy = end.lat - start.lat;
  const cross = ((point.lon - start.lon) * dy) - ((point.lat - start.lat) * dx);
  const epsilon = 1e-10;
  if (Math.abs(cross) > epsilon) return false;

  const dot = ((point.lon - start.lon) * dx) + ((point.lat - start.lat) * dy);
  if (dot < -epsilon) return false;

  const segmentLengthSquared = (dx * dx) + (dy * dy);
  return dot <= segmentLengthSquared + epsilon;
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
