import { ref, shallowRef } from 'vue';
import type * as Cesium from 'cesium';

export type FloodAreaPoint = {
  frame: number;
  areaM2: number;
};

export type FloodDepthSampleMode = 'triangle' | 'nearest' | 'outside';

export type FloodPointDepthPoint = {
  frame: number;
  depthM: number;
};

export type FloodDepthMonitorPoint = {
  lon: number;
  lat: number;
  height: number;
  gridX: number;
  gridY: number;
  sampleMode: FloodDepthSampleMode;
  sampleVertices?: [number, number, number];
  sampleWeights?: [number, number, number];
  nearestIndex?: number;
  meshVertexCount?: number;
  meshFaceCount?: number;
};

type FloodDepthSampleResult = {
  depthM: number;
  mode: FloodDepthSampleMode;
  sampleVertices?: [number, number, number];
  sampleWeights?: [number, number, number];
  nearestIndex?: number;
  meshVertexCount?: number;
  meshFaceCount?: number;
};

export const lastLoadedFloodJson = shallowRef<any>(null);
export const floodCellSize = ref<number>(0);
export const currentFloodPrimitive = shallowRef<Cesium.Primitive | null>(null);
export const floodPlaybackToken = ref<number>(0);
export const currentFloodFrame = ref<number>(0);
export const currentFloodAreaM2 = ref<number>(0);
export const floodAreaSeries = ref<FloodAreaPoint[]>([]);
export const selectedFloodDepthPoint = ref<FloodDepthMonitorPoint | null>(null);
export const currentFloodPointDepthM = ref<number>(0);
export const floodPointDepthSeries = ref<FloodPointDepthPoint[]>([]);

export const calculateFloodAreaM2 = (jsonData: any, cellSize: number) => {
  if (!jsonData?.Vector || !jsonData?.Face || cellSize <= 0) {
    return 0;
  }

  const vertices = jsonData.Vector;
  const faces = jsonData.Face;
  let area = 0;

  for (let i = 0; i < faces.length; i += 3) {
    const idx0 = faces[i] * 3;
    const idx1 = faces[i + 1] * 3;
    const idx2 = faces[i + 2] * 3;

    const x0 = Number(vertices[idx0]);
    const y0 = Number(vertices[idx0 + 1]);
    const x1 = Number(vertices[idx1]);
    const y1 = Number(vertices[idx1 + 1]);
    const x2 = Number(vertices[idx2]);
    const y2 = Number(vertices[idx2 + 1]);

    if (![x0, y0, x1, y1, x2, y2].every(Number.isFinite)) {
      continue;
    }

    area += 0.5 * Math.abs((x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0));
  }

  return area * cellSize * cellSize;
};

export const recordFloodAreaPoint = (frame: number, jsonData: any, cellSize: number) => {
  const safeFrame = Math.max(1, Math.round(frame));
  currentFloodFrame.value = safeFrame;
  const areaM2 = calculateFloodAreaM2(jsonData, cellSize);
  currentFloodAreaM2.value = areaM2;

  const point: FloodAreaPoint = { frame: safeFrame, areaM2 };
  const existingIndex = floodAreaSeries.value.findIndex((item) => item.frame === safeFrame);

  if (existingIndex >= 0) {
    const nextSeries = [...floodAreaSeries.value];
    nextSeries[existingIndex] = point;
    floodAreaSeries.value = nextSeries.sort((a, b) => a.frame - b.frame);
    return areaM2;
  }

  floodAreaSeries.value = [...floodAreaSeries.value, point].sort((a, b) => a.frame - b.frame);
  return areaM2;
};

export const resetFloodAreaSeries = () => {
  currentFloodFrame.value = 0;
  currentFloodAreaM2.value = 0;
  floodAreaSeries.value = [];
};

const getDepthArray = (jsonData: any): number[] | null => {
  const depth = jsonData?.Depth?.[0];
  return Array.isArray(depth) ? depth : null;
};

const getVectorArray = (jsonData: any): number[] | null => {
  const vector = jsonData?.Vector;
  return Array.isArray(vector) ? vector : null;
};

const getFaceArray = (jsonData: any): number[] | null => {
  const face = jsonData?.Face;
  return Array.isArray(face) ? face : null;
};

const getBarycentricDepth = (
  jsonData: any,
  gridX: number,
  gridY: number
): FloodDepthSampleResult | null => {
  const vertices = getVectorArray(jsonData);
  const faces = getFaceArray(jsonData);
  const depths = getDepthArray(jsonData);

  if (!vertices || !faces || !depths) {
    return null;
  }

  const epsilon = 1e-7;
  for (let i = 0; i < faces.length; i += 3) {
    const vertexIndex0 = faces[i];
    const vertexIndex1 = faces[i + 1];
    const vertexIndex2 = faces[i + 2];
    const idx0 = vertexIndex0 * 3;
    const idx1 = vertexIndex1 * 3;
    const idx2 = vertexIndex2 * 3;

    const x0 = Number(vertices[idx0]);
    const y0 = Number(vertices[idx0 + 1]);
    const x1 = Number(vertices[idx1]);
    const y1 = Number(vertices[idx1 + 1]);
    const x2 = Number(vertices[idx2]);
    const y2 = Number(vertices[idx2 + 1]);

    if (![x0, y0, x1, y1, x2, y2].every(Number.isFinite)) {
      continue;
    }

    const denominator = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
    if (Math.abs(denominator) < epsilon) {
      continue;
    }

    const weight0 = ((y1 - y2) * (gridX - x2) + (x2 - x1) * (gridY - y2)) / denominator;
    const weight1 = ((y2 - y0) * (gridX - x2) + (x0 - x2) * (gridY - y2)) / denominator;
    const weight2 = 1 - weight0 - weight1;

    if (weight0 >= -epsilon && weight1 >= -epsilon && weight2 >= -epsilon) {
      const depth0 = Number(depths[vertexIndex0]) || 0;
      const depth1 = Number(depths[vertexIndex1]) || 0;
      const depth2 = Number(depths[vertexIndex2]) || 0;
      return {
        depthM: Math.max(0, depth0 * weight0 + depth1 * weight1 + depth2 * weight2),
        mode: 'triangle',
        sampleVertices: [vertexIndex0, vertexIndex1, vertexIndex2],
        sampleWeights: [weight0, weight1, weight2],
        meshVertexCount: depths.length,
        meshFaceCount: faces.length
      };
    }
  }

  return null;
};

const getNearestDepth = (
  jsonData: any,
  gridX: number,
  gridY: number
): FloodDepthSampleResult | null => {
  const vertices = getVectorArray(jsonData);
  const depths = getDepthArray(jsonData);

  if (!vertices || !depths) {
    return null;
  }

  let nearestIndex = -1;
  let nearestDistanceSq = Number.POSITIVE_INFINITY;
  for (let i = 0; i < depths.length; i += 1) {
    const idx = i * 3;
    const x = Number(vertices[idx]);
    const y = Number(vertices[idx + 1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      continue;
    }

    const dx = x - gridX;
    const dy = y - gridY;
    const distanceSq = dx * dx + dy * dy;
    if (distanceSq < nearestDistanceSq) {
      nearestDistanceSq = distanceSq;
      nearestIndex = i;
    }
  }

  if (nearestIndex < 0 || nearestDistanceSq > 2.25) {
    return null;
  }

  return {
    depthM: Math.max(0, Number(depths[nearestIndex]) || 0),
    mode: 'nearest',
    nearestIndex,
    meshVertexCount: depths.length,
    meshFaceCount: getFaceArray(jsonData)?.length
  };
};

export const sampleFloodDepthAtGridPoint = (
  jsonData: any,
  gridX: number,
  gridY: number
): FloodDepthSampleResult => {
  if (!Number.isFinite(gridX) || !Number.isFinite(gridY)) {
    return { depthM: 0, mode: 'outside' };
  }

  const interpolatedDepth = getBarycentricDepth(jsonData, gridX, gridY);
  if (interpolatedDepth) {
    return interpolatedDepth;
  }

  const nearestDepth = getNearestDepth(jsonData, gridX, gridY);
  if (nearestDepth) {
    return nearestDepth;
  }

  return { depthM: 0, mode: 'outside' };
};

const sampleFloodDepthFromMonitorPoint = (
  jsonData: any,
  point: FloodDepthMonitorPoint
): FloodDepthSampleResult => {
  const depths = getDepthArray(jsonData);
  const faces = getFaceArray(jsonData);
  if (!depths || !faces) {
    return { depthM: 0, mode: 'outside' };
  }

  const canUseCachedSampler = (
    point.meshVertexCount === depths.length &&
    point.meshFaceCount === faces.length
  );

  if (
    canUseCachedSampler &&
    point.sampleMode === 'triangle' &&
    point.sampleVertices &&
    point.sampleWeights
  ) {
    const [index0, index1, index2] = point.sampleVertices;
    const [weight0, weight1, weight2] = point.sampleWeights;
    const depth0 = Number(depths[index0]) || 0;
    const depth1 = Number(depths[index1]) || 0;
    const depth2 = Number(depths[index2]) || 0;
    return {
      depthM: Math.max(0, depth0 * weight0 + depth1 * weight1 + depth2 * weight2),
      mode: 'triangle',
      sampleVertices: point.sampleVertices,
      sampleWeights: point.sampleWeights,
      meshVertexCount: depths.length,
      meshFaceCount: faces.length
    };
  }

  if (
    canUseCachedSampler &&
    point.sampleMode === 'nearest' &&
    typeof point.nearestIndex === 'number' &&
    point.nearestIndex >= 0 &&
    point.nearestIndex < depths.length
  ) {
    return {
      depthM: Math.max(0, Number(depths[point.nearestIndex]) || 0),
      mode: 'nearest',
      nearestIndex: point.nearestIndex,
      meshVertexCount: depths.length,
      meshFaceCount: faces.length
    };
  }

  return sampleFloodDepthAtGridPoint(jsonData, point.gridX, point.gridY);
};

export const setFloodDepthMonitorPoint = (
  point: Omit<FloodDepthMonitorPoint, 'sampleMode'>,
  jsonData?: any
) => {
  const sample = jsonData
    ? sampleFloodDepthAtGridPoint(jsonData, point.gridX, point.gridY)
    : { depthM: 0, mode: 'outside' as FloodDepthSampleMode };

  selectedFloodDepthPoint.value = {
    ...point,
    sampleMode: sample.mode,
    sampleVertices: sample.sampleVertices,
    sampleWeights: sample.sampleWeights,
    nearestIndex: sample.nearestIndex,
    meshVertexCount: sample.meshVertexCount,
    meshFaceCount: sample.meshFaceCount
  };
  currentFloodPointDepthM.value = sample.depthM;
  floodPointDepthSeries.value = [];
  return sample;
};

const sameTriple = (
  a: [number, number, number] | undefined,
  b: [number, number, number] | undefined
) => {
  if (!a || !b) {
    return a === b;
  }

  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
};

export const recordFloodPointDepth = (frame: number, jsonData: any) => {
  const monitorPoint = selectedFloodDepthPoint.value;
  if (!monitorPoint) {
    return null;
  }

  const safeFrame = Math.max(1, Math.round(frame));
  const sample = sampleFloodDepthFromMonitorPoint(jsonData, monitorPoint);
  currentFloodPointDepthM.value = sample.depthM;
  const samplerChanged = (
    monitorPoint.sampleMode !== sample.mode ||
    monitorPoint.nearestIndex !== sample.nearestIndex ||
    monitorPoint.meshVertexCount !== sample.meshVertexCount ||
    monitorPoint.meshFaceCount !== sample.meshFaceCount ||
    !sameTriple(monitorPoint.sampleVertices, sample.sampleVertices) ||
    !sameTriple(monitorPoint.sampleWeights, sample.sampleWeights)
  );

  if (samplerChanged) {
    selectedFloodDepthPoint.value = {
      ...monitorPoint,
      sampleMode: sample.mode,
      sampleVertices: sample.sampleVertices,
      sampleWeights: sample.sampleWeights,
      nearestIndex: sample.nearestIndex,
      meshVertexCount: sample.meshVertexCount,
      meshFaceCount: sample.meshFaceCount
    };
  }

  const point: FloodPointDepthPoint = { frame: safeFrame, depthM: sample.depthM };
  const existingIndex = floodPointDepthSeries.value.findIndex((item) => item.frame === safeFrame);
  if (existingIndex >= 0) {
    const nextSeries = [...floodPointDepthSeries.value];
    nextSeries[existingIndex] = point;
    floodPointDepthSeries.value = nextSeries.sort((a, b) => a.frame - b.frame);
    return sample;
  }

  floodPointDepthSeries.value = [...floodPointDepthSeries.value, point].sort((a, b) => a.frame - b.frame);
  return sample;
};

export const resetFloodPointDepthSeries = () => {
  currentFloodPointDepthM.value = 0;
  floodPointDepthSeries.value = [];
};

export const clearFloodDepthMonitorPoint = () => {
  selectedFloodDepthPoint.value = null;
  resetFloodPointDepthSeries();
};
