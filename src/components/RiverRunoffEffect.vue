<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue';
import * as Cesium from 'cesium';
import riverData from '../data/xiaojiaqiao-river-network.json.json';

type ArcGisPoint = [number, number] | [number, number, number];

type ArcGisRiverFeature = {
  attributes?: {
    OBJECTID?: number;
    grid_code?: number;
    from_node?: number;
    to_node?: number;
    Shape_Length?: number;
  };
  geometry?: {
    paths?: ArcGisPoint[][];
  };
};

type ArcGisRiverData = {
  features?: ArcGisRiverFeature[];
};

type RiverSegment = {
  id: number;
  gridCode: number;
  length: number;
  distanceToBreach: number;
  centerLon: number;
  centerLat: number;
  startRatio: number;
  peakRatio: number;
  positions: Cesium.Cartesian3[];
  flowPositions: Cesium.Cartesian3[];
  activePositions: Cesium.Cartesian3[];
  center: Cesium.Cartesian3;
  baseEntity?: Cesium.Entity;
  pulseEntity?: Cesium.Entity;
  flowEntity?: Cesium.Entity;
};

const props = defineProps<{
  viewer: Cesium.Viewer;
  active: boolean;
}>();

const emit = defineEmits<{
  runoffComplete: [];
}>();

const RUNOFF_DURATION_MS = 9000;
const FLOOD_TRIGGER_RATIO = 0.86;
const CAMERA_FLY_DURATION_MS = 1700;
const PREVIEW_FLASH_DURATION_MS = 6000;
const PREVIEW_FLASH_COUNT = 2;
const FLOW_HEIGHT_M = 0;
const FLOW_LINE_HEIGHT_M = 30;
const BREACH_LON = 104.288824;
const BREACH_LAT = 31.648759;
const MAX_RUNOFF_SEGMENTS = 1200;
const RUNOFF_MASK_POLYGON: Array<[number, number]> = [
  [104.249689, 31.637028],
  [104.254909, 31.666306],
  [104.297663, 31.665572],
  [104.293696, 31.641994]
];
const EXCLUDE_SOUTHEAST_OF_LON = 104.287837;
const EXCLUDE_SOUTHEAST_OF_LAT = 31.648681;
const breachPosition = Cesium.Cartesian3.fromDegrees(BREACH_LON, BREACH_LAT, FLOW_HEIGHT_M);
const breachFlowPosition = Cesium.Cartesian3.fromDegrees(BREACH_LON, BREACH_LAT, FLOW_LINE_HEIGHT_M);
const dataSourceName = 'xiaojiaqiao_river_runoff';
const parsedRiverData = riverData as unknown as ArcGisRiverData;

let riverDataSource: Cesium.CustomDataSource | null = null;
let runoffStartMs = 0;
let completedForCycle = false;
let runoffAnimationFrameId: number | null = null;
let outletEntity: Cesium.Entity | null = null;
let breachChannelEntity: Cesium.Entity | null = null;
let originalDepthTestAgainstTerrain: boolean | null = null;

const getSegmentCenter = (positions: Cesium.Cartesian3[]) => {
  const center = new Cesium.Cartesian3();
  positions.forEach((position) => Cesium.Cartesian3.add(center, position, center));
  return Cesium.Cartesian3.divideByScalar(center, Math.max(1, positions.length), center);
};

const raisePositions = (positions: Cesium.Cartesian3[], height: number) => (
  positions.map((position) => {
    const cartographic = Cesium.Cartographic.fromCartesian(position);
    return Cesium.Cartesian3.fromRadians(cartographic.longitude, cartographic.latitude, height);
  })
);

const getPathCenterLonLat = (path: ArcGisPoint[]) => {
  const sum = path.reduce((acc, [lon, lat]) => ({
    lon: acc.lon + lon,
    lat: acc.lat + lat
  }), { lon: 0, lat: 0 });

  return {
    lon: sum.lon / Math.max(1, path.length),
    lat: sum.lat / Math.max(1, path.length)
  };
};

const isPointInPolygon = (lon: number, lat: number, polygon: Array<[number, number]>) => {
  let inside = false;

  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const [xi, yi] = polygon[index];
    const [xj, yj] = polygon[previous];
    const intersects = ((yi > lat) !== (yj > lat)) &&
      lon < ((xj - xi) * (lat - yi)) / ((yj - yi) || Number.EPSILON) + xi;

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
};

const shouldShowRunoffPoint = (lon: number, lat: number) => (
  isPointInPolygon(lon, lat, RUNOFF_MASK_POLYGON) &&
  !(lon > EXCLUDE_SOUTHEAST_OF_LON && lat < EXCLUDE_SOUTHEAST_OF_LAT)
);

const getInsidePathChunks = (path: ArcGisPoint[]) => {
  const chunks: ArcGisPoint[][] = [];
  let currentChunk: ArcGisPoint[] = [];

  path.forEach((point) => {
    const [lon, lat] = point;
    if (shouldShowRunoffPoint(lon, lat)) {
      currentChunk.push(point);
      return;
    }

    if (currentChunk.length >= 2) {
      chunks.push(currentChunk);
    }
    currentChunk = [];
  });

  if (currentChunk.length >= 2) {
    chunks.push(currentChunk);
  }

  return chunks;
};

const buildRiverSegments = (): RiverSegment[] => {
  const features = Array.isArray(parsedRiverData.features) ? parsedRiverData.features : [];
  const rawSegments = features.flatMap((feature, index) => {
    const attributes = feature.attributes ?? {};
    const path = feature.geometry?.paths?.[0] ?? [];
    if (path.length < 2) {
      return [];
    }

    return getInsidePathChunks(path).map((chunk, chunkIndex) => {
      const positions = chunk.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat, FLOW_HEIGHT_M));
      const firstDistance = Cesium.Cartesian3.distance(positions[0], breachPosition);
      const lastDistance = Cesium.Cartesian3.distance(positions[positions.length - 1], breachPosition);
      const flowPositions = firstDistance >= lastDistance ? positions : [...positions].reverse();
      const distanceToBreach = Cesium.Cartesian3.distance(getSegmentCenter(flowPositions), breachPosition);
      const raisedFlowPositions = raisePositions(flowPositions, FLOW_LINE_HEIGHT_M);
      const centerLonLat = getPathCenterLonLat(chunk);

      return {
        id: Number(attributes.OBJECTID ?? index + 1) * 10 + chunkIndex,
        gridCode: Number(attributes.grid_code ?? 1),
        length: Number(attributes.Shape_Length ?? 0),
        distanceToBreach,
        centerLon: centerLonLat.lon,
        centerLat: centerLonLat.lat,
        startRatio: 0,
        peakRatio: 0,
        positions: flowPositions,
        flowPositions: raisedFlowPositions,
        activePositions: [flowPositions[0], flowPositions[0]],
        center: getSegmentCenter(flowPositions)
      };
    });
  });

  const maskedSegments = rawSegments
    .sort((a, b) => b.distanceToBreach - a.distanceToBreach)
    .slice(0, MAX_RUNOFF_SEGMENTS);
  const visibleSegments = maskedSegments.length ? maskedSegments : rawSegments.slice(0, MAX_RUNOFF_SEGMENTS);
  const minDistance = Math.min(...visibleSegments.map((segment) => segment.distanceToBreach));
  const maxDistance = Math.max(...visibleSegments.map((segment) => segment.distanceToBreach));
  const distanceSpan = Math.max(1, maxDistance - minDistance);

  return visibleSegments.map((segment) => {
    const streamBias = Math.min(0.08, Math.max(0, segment.gridCode - 1) * 0.012);
    const farRatio = (segment.distanceToBreach - minDistance) / distanceSpan;
    const startRatio = Math.min(0.82, 0.02 + (1 - farRatio) * 0.76 + streamBias);
    return {
      ...segment,
      startRatio,
      peakRatio: Math.min(0.98, startRatio + 0.22 + Math.min(0.1, segment.length * 0.2))
    };
  });
};

const getPathLength = (positions: Cesium.Cartesian3[]) => {
  let totalLength = 0;

  for (let index = 1; index < positions.length; index += 1) {
    totalLength += Cesium.Cartesian3.distance(positions[index - 1], positions[index]);
  }

  return totalLength;
};

const getPositionAlongPath = (positions: Cesium.Cartesian3[], ratio: number) => {
  if (positions.length === 1) {
    return positions[0];
  }

  const safeRatio = Math.min(Math.max(ratio, 0), 1);
  const targetDistance = getPathLength(positions) * safeRatio;
  let walkedDistance = 0;

  for (let index = 1; index < positions.length; index += 1) {
    const start = positions[index - 1];
    const end = positions[index];
    const segmentLength = Cesium.Cartesian3.distance(start, end);

    if (walkedDistance + segmentLength >= targetDistance) {
      const localRatio = segmentLength > 0 ? (targetDistance - walkedDistance) / segmentLength : 0;
      return Cesium.Cartesian3.lerp(start, end, Math.min(Math.max(localRatio, 0), 1), new Cesium.Cartesian3());
    }

    walkedDistance += segmentLength;
  }

  return positions[positions.length - 1];
};

const getPartialPositions = (positions: Cesium.Cartesian3[], ratio: number) => {
  if (positions.length <= 1) {
    return positions;
  }

  const safeRatio = Math.min(Math.max(ratio, 0.001), 1);
  const targetPosition = getPositionAlongPath(positions, safeRatio);
  const partialPositions: Cesium.Cartesian3[] = [positions[0]];
  const targetDistance = getPathLength(positions) * safeRatio;
  let walkedDistance = 0;

  for (let index = 1; index < positions.length; index += 1) {
    const segmentLength = Cesium.Cartesian3.distance(positions[index - 1], positions[index]);
    if (walkedDistance + segmentLength < targetDistance) {
      partialPositions.push(positions[index]);
      walkedDistance += segmentLength;
      continue;
    }

    partialPositions.push(targetPosition);
    break;
  }

  return partialPositions.length >= 2 ? partialPositions : [positions[0], targetPosition];
};

const addBreachPulse = (segments: RiverSegment[]) => {
  if (!riverDataSource) {
    return;
  }

  outletEntity = riverDataSource.entities.add({
    position: breachPosition,
    ellipse: {
      semiMajorAxis: 1,
      semiMinorAxis: 1,
      height: FLOW_HEIGHT_M,
      material: Cesium.Color.fromCssColorString('#36d9ff').withAlpha(0.34),
      outline: false
    }
  });

  const nearestSegment = segments.reduce<RiverSegment | null>((best, segment) => {
    if (!best) {
      return segment;
    }
    return segment.distanceToBreach < best.distanceToBreach ? segment : best;
  }, null);

  const nearestRiverPosition = nearestSegment?.positions[nearestSegment.positions.length - 1] ?? breachPosition;
  const nearestFlowPosition = raisePositions([nearestRiverPosition], FLOW_LINE_HEIGHT_M)[0];
  breachChannelEntity = riverDataSource.entities.add({
    polyline: {
      positions: [nearestFlowPosition, breachFlowPosition],
      width: 7,
      clampToGround: false,
      material: Cesium.Color.fromCssColorString('#e9ffff').withAlpha(0.98),
      show: false
    },
    point: {
      pixelSize: 12,
      color: Cesium.Color.fromCssColorString('#f1ffff').withAlpha(0.96),
      outlineColor: Cesium.Color.fromCssColorString('#1cdcff').withAlpha(0.92),
      outlineWidth: 4
    }
  });
};

const createRunoffScene = async () => {
  clearRunoffScene();

  if (originalDepthTestAgainstTerrain === null) {
    originalDepthTestAgainstTerrain = props.viewer.scene.globe.depthTestAgainstTerrain;
  }
  props.viewer.scene.globe.depthTestAgainstTerrain = false;

  riverDataSource = new Cesium.CustomDataSource(dataSourceName);
  await props.viewer.dataSources.add(riverDataSource);

  const segments = buildRiverSegments();

  let isPreviewDone = false;
  let currentGlobalFlash = 0;

  const styleCache = new Map();
  const whiteColor = Cesium.Color.WHITE;

  const getSegmentStyle = (gridCode: number) => {
    const streamLevel = Math.max(1, gridCode);
    if (!styleCache.has(streamLevel)) {
      const isMainStream = streamLevel >= 3;
      const baseWidth = isMainStream ? 7 + streamLevel * 1.5 : 3 + streamLevel * 1.0;
      const baseGlow = isMainStream ? 0.25 : 0.1;
      const baseColorStr = isMainStream ? '#00bbff' : '#0a59a8';
      const baseAlpha = isMainStream ? 0.8 : 0.4;
      const baseColor = Cesium.Color.fromCssColorString(baseColorStr).withAlpha(baseAlpha);

      const material = new Cesium.PolylineGlowMaterialProperty({
        glowPower: new Cesium.CallbackProperty(() => baseGlow + currentGlobalFlash * 0.7, false),
        taperPower: 1,
        color: new Cesium.CallbackProperty(() => {
          const flashWeight = currentGlobalFlash * 0.7; // Blend towards white during flash
          return Cesium.Color.lerp(baseColor, whiteColor, flashWeight, new Cesium.Color());
        }, false)
      });
      styleCache.set(streamLevel, { width: baseWidth, material });
    }
    return styleCache.get(streamLevel)!;
  };

  segments.forEach((segment) => {
    const streamLevel = Math.max(1, segment.gridCode);
    const isMainStream = streamLevel >= 3;
    const style = getSegmentStyle(segment.gridCode);

    segment.baseEntity = riverDataSource?.entities.add({
      polyline: {
        positions: segment.positions,
        width: style.width,
        clampToGround: true,
        material: style.material,
        show: true
      }
    });

    // Flowing line
    const flowWidth = isMainStream ? 11 + streamLevel * 2 : 4 + streamLevel * 1.2;
    segment.pulseEntity = riverDataSource?.entities.add({
      polyline: {
        positions: [segment.flowPositions[0], segment.flowPositions[0]],
        width: flowWidth + 12,
        clampToGround: false,
        material: Cesium.Color.fromCssColorString('#00d9ff').withAlpha(0),
        show: false
      }
    });

    segment.flowEntity = riverDataSource?.entities.add({
      polyline: {
        positions: [segment.flowPositions[0], segment.flowPositions[0]],
        width: flowWidth,
        clampToGround: false,
        material: new Cesium.PolylineGlowMaterialProperty({
          glowPower: isMainStream ? 0.45 : 0.2,
          taperPower: 0.5,
          color: Cesium.Color.fromCssColorString(isMainStream ? '#ffffff' : '#69ffff')
        }),
        show: false
      }
    });

  });

  addBreachPulse(segments);
  runoffStartMs = performance.now() + CAMERA_FLY_DURATION_MS;
  completedForCycle = false;

  props.viewer.scene.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(104.302, 31.625, 14500),
    orientation: {
      heading: Cesium.Math.toRadians(0),
      pitch: Cesium.Math.toRadians(-66),
      roll: 0
    },
    duration: 1.6
  });

  const updateRunoffFrame = () => {
    const elapsed = Math.max(0, performance.now() - runoffStartMs);
    const previewProgress = Math.min(1, elapsed / PREVIEW_FLASH_DURATION_MS);
    const isPreviewStage = previewProgress < 1;
    const runoffElapsed = Math.max(0, elapsed - PREVIEW_FLASH_DURATION_MS);
    const progress = Math.min(1, runoffElapsed / RUNOFF_DURATION_MS);

    if (isPreviewStage) {
      currentGlobalFlash = 0.5 + 0.5 * Math.sin(previewProgress * PREVIEW_FLASH_COUNT * Math.PI * 2);
    } else if (!isPreviewDone) {
      isPreviewDone = true;
      currentGlobalFlash = 0;
      // 闪烁结束后，仅进行一次区分级材质赋值，切断回调从而冻结样式
      segments.forEach((segment) => {
        if (segment.baseEntity?.polyline) {
          const streamLevel = Math.max(1, segment.gridCode);
          const isMainStream = streamLevel >= 3;
          const baseWidth = isMainStream ? 7 + streamLevel * 1.5 : 3 + streamLevel * 1.0;

          segment.baseEntity.polyline.width = new Cesium.ConstantProperty(baseWidth);
          segment.baseEntity.polyline.material = new Cesium.PolylineGlowMaterialProperty({
            glowPower: isMainStream ? 0.25 : 0.1,
            taperPower: 1,
            color: Cesium.Color.fromCssColorString(isMainStream ? '#00bbff' : '#0a59a8')
              .withAlpha(isMainStream ? 0.8 : 0.4)
          });
        }
      });
    }

    segments.forEach((segment) => {
      const localProgress = (progress - segment.startRatio) / Math.max(0.001, segment.peakRatio - segment.startRatio);
      const shouldShow = !isPreviewStage && localProgress > 0 && progress < 0.985;
      const pulsePolyline = segment.pulseEntity?.polyline;
      const flowPolyline = segment.flowEntity?.polyline;
      const streamLevel = Math.max(1, segment.gridCode);
      const flash = 0.5 + 0.5 * Math.sin(elapsed * 0.026 + segment.id * 0.41);
      const partialPositions = getPartialPositions(segment.flowPositions, localProgress);

      if (pulsePolyline) {
        pulsePolyline.show = new Cesium.ConstantProperty(shouldShow);
        pulsePolyline.positions = new Cesium.ConstantProperty(partialPositions);
        pulsePolyline.width = new Cesium.ConstantProperty(
          shouldShow ? 18 + streamLevel * 2.2 + flash * 12 : 1
        );
        pulsePolyline.material = new Cesium.ColorMaterialProperty(
          Cesium.Color.fromCssColorString('#00d9ff').withAlpha(shouldShow ? 0.12 + flash * 0.34 : 0)
        );
      }

      if (flowPolyline) {
        flowPolyline.show = new Cesium.ConstantProperty(shouldShow);
        flowPolyline.positions = new Cesium.ConstantProperty(partialPositions);
        flowPolyline.width = new Cesium.ConstantProperty(
          shouldShow ? 9 + streamLevel * 2.2 + flash * 8 : 1
        );
        flowPolyline.material = new Cesium.PolylineGlowMaterialProperty({
          glowPower: 0.38 + flash * 0.62,
          taperPower: 0.28,
          color: Cesium.Color.fromCssColorString(localProgress > 0.82 ? '#ffffff' : '#34eaff')
            .withAlpha(shouldShow ? 0.78 + flash * 0.22 : 0)
        });
      }

    });

    if (breachChannelEntity?.polyline) {
      const breachFlash = 0.5 + 0.5 * Math.sin(elapsed * 0.018);
      breachChannelEntity.polyline.show = new Cesium.ConstantProperty(!isPreviewStage && progress > 0.72);
      breachChannelEntity.polyline.width = new Cesium.ConstantProperty(!isPreviewStage && progress > 0.72 ? 14 + breachFlash * 14 : 1);
      breachChannelEntity.polyline.material = new Cesium.PolylineGlowMaterialProperty({
        glowPower: 0.48 + breachFlash * 0.58,
        taperPower: 0.22,
        color: Cesium.Color.fromCssColorString('#ffffff').withAlpha(0.82 + breachFlash * 0.18)
      });
    }

    if (breachChannelEntity?.point) {
      const breachFlash = 0.5 + 0.5 * Math.sin(elapsed * 0.022);
      breachChannelEntity.point.show = new Cesium.ConstantProperty(!isPreviewStage);
      breachChannelEntity.point.pixelSize = new Cesium.ConstantProperty(14 + breachFlash * 18);
      breachChannelEntity.point.color = new Cesium.ConstantProperty(
        Cesium.Color.fromCssColorString('#ffffff').withAlpha(0.78 + breachFlash * 0.22)
      );
      breachChannelEntity.point.outlineColor = new Cesium.ConstantProperty(
        Cesium.Color.fromCssColorString('#1de8ff').withAlpha(0.72 + breachFlash * 0.28)
      );
    }

    if (outletEntity?.ellipse) {
      const bloom = Math.max(0, (progress - 0.68) / 0.32);
      const blink = 0.5 + 0.5 * Math.sin(elapsed * 0.02);
      const radius = 420 + bloom * 3400 + blink * 980;
      outletEntity.ellipse.show = new Cesium.ConstantProperty(!isPreviewStage);
      outletEntity.ellipse.semiMajorAxis = new Cesium.ConstantProperty(radius);
      outletEntity.ellipse.semiMinorAxis = new Cesium.ConstantProperty(radius * 0.72);
      outletEntity.ellipse.material = new Cesium.ColorMaterialProperty(
        Cesium.Color.fromCssColorString('#39d9ff').withAlpha(Math.max(0.12, 0.3 + blink * 0.34 - bloom * 0.1))
      );
    }

    if (!isPreviewStage && !completedForCycle && progress >= FLOOD_TRIGGER_RATIO) {
      completedForCycle = true;
      emit('runoffComplete');
    }

    props.viewer.scene.requestRender();

    if ((isPreviewStage || progress < 1) && props.active) {
      runoffAnimationFrameId = window.requestAnimationFrame(updateRunoffFrame);
    } else {
      runoffAnimationFrameId = null;
    }
  };

  runoffAnimationFrameId = window.requestAnimationFrame(updateRunoffFrame);
};

const clearRunoffScene = () => {
  if (runoffAnimationFrameId !== null) {
    window.cancelAnimationFrame(runoffAnimationFrameId);
    runoffAnimationFrameId = null;
  }

  if (riverDataSource) {
    props.viewer.dataSources.remove(riverDataSource, true);
    riverDataSource = null;
  }

  if (originalDepthTestAgainstTerrain !== null) {
    props.viewer.scene.globe.depthTestAgainstTerrain = originalDepthTestAgainstTerrain;
    originalDepthTestAgainstTerrain = null;
  }

  outletEntity = null;
  breachChannelEntity = null;
  completedForCycle = false;
  props.viewer.scene.requestRender();
};

watch(
  () => props.active,
  (active) => {
    if (active) {
      void createRunoffScene();
    } else {
      clearRunoffScene();
    }
  },
  { immediate: true }
);

onBeforeUnmount(clearRunoffScene);
</script>

<template></template>
