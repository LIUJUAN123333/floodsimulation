<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import * as Cesium from 'cesium';
import {
  Viewer,
  Cartesian3,
  EllipsoidTerrainProvider,
  Ion,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  Cartographic,
  Math as CesiumMath
} from 'cesium';
import type { RoamPhase, RoamUiState, RoamViewMode } from '../types/roam';
import type { ShapefileImportSource } from '../types/shapefile';
import { createInitialRoamState } from '../types/roam';
import { importShapefileRoute } from '../utils/shapefileRoute';
import {
  buildRoamFlightTrack,
  buildSmoothHorizontalRoute,
  getRoamTrackProgressPositions,
  sampleRoamGround,
  sampleRoamTrack,
  type RoamGroundSample,
  type RoamTrackPoint,
  type RoamTrackSample
} from '../utils/roamPath';

// 配置你申请到的 Cesium Ion Token
Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiIyZmNiZjM4NS03MDZmLTQzNTUtOWIwYS1iNzAxYzU0NjFkNzQiLCJpZCI6MzQzMDgzLCJpYXQiOjE3NTgzNzA4NDl9.AqR4eRVi5bNqIptxtsP6wq4LhgBUawcdVkxW_L9iuJk';

const cesiumContainer = ref<HTMLElement | null>(null);
let viewer: Viewer | null = null;
let handler: ScreenSpaceEventHandler | null = null;
let measureHandler: Cesium.ScreenSpaceEventHandler | null = null;
let roamPickHandler: Cesium.ScreenSpaceEventHandler | null = null;

type RoamCameraView = {
  destination: Cesium.Cartesian3;
  orientation: {
    direction: Cesium.Cartesian3;
    up: Cesium.Cartesian3;
  };
};

let roamAnimationFrame: number | null = null;
let roamPath: Cesium.Cartesian3[] = [];
let roamPreviewPosition: Cesium.Cartesian3 | null = null;
let roamGroundSamples: RoamGroundSample[] = [];
let roamTrackSamples: RoamTrackSample[] = [];
let roamTotalDistance = 0;
let roamCurrentDistance = 0;
let roamLastFrameAt = 0;
let roamLastStateEmitAt = 0;
let roamCurrentSpeed = 80;
let roamCurrentHeight = 120;
let roamCurrentMode: RoamViewMode = 'third';
let roamPhase: RoamPhase = 'idle';
let roamSourceText = '手动规划路线';
let roamBuildVersion = 0;
let roamOperationVersion = 0;
let roamGroundTerrainProvider: Cesium.TerrainProvider | null = null;
let roamCameraInputBeforeLock: boolean | null = null;
let roamKeydownHandler: ((event: KeyboardEvent) => void) | null = null;
let roamPreviousCursor = '';
let roamMovingEntity: Cesium.Entity | null = null;
const roamPointEntities: Cesium.Entity[] = [];
const measurementEntities: Cesium.Entity[] = [];
const roamEntities: Cesium.Entity[] = [];
let roamUiState: RoamUiState = createInitialRoamState();
const emit = defineEmits(['viewer-ready', 'fly-complete', 'terrain-error', 'coordinates-change', 'roam-state-change']);

const mousePosition = ref({ lon: '0.000000', lat: '0.000000', height: '0.00' });
const YONGCHUAN_IMAGERY_RECTANGLE = Cesium.Rectangle.fromDegrees(
  105.91845550696213,
  29.425627967833694,
  105.9518409625705,
  29.452205640319157
);
const YONGCHUAN_LABEL_POSITION = {
  lon: 105.943823,
  lat: 29.445076,
  height: 0
};
const makeSvgDataUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
const YONGCHUAN_PIN_IMAGE = makeSvgDataUrl(`
<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
  <text x="48" y="70" text-anchor="middle" font-size="68" font-family="Segoe UI Emoji, Apple Color Emoji, Noto Color Emoji, sans-serif">📌</text>
</svg>
`);

const configureCameraControls = (viewerInstance: Viewer) => {
  const controller = viewerInstance.scene.screenSpaceCameraController;
  controller.inertiaZoom = 0.35;
  controller.minimumZoomDistance = 40;
  controller.maximumZoomDistance = 28000000;
  controller.maximumMovementRatio = 0.035;
};

const addDefaultYongchuanImageryLayer = (viewerInstance: Viewer) => {
  const imageryProvider = new Cesium.UrlTemplateImageryProvider({
    url: '/data/imagery/yongchuan-3-l19/{z}/{x}/{y}.png',
    tilingScheme: new Cesium.WebMercatorTilingScheme(),
    rectangle: YONGCHUAN_IMAGERY_RECTANGLE,
    minimumLevel: 0,
    maximumLevel: 19,
    credit: 'Yongchuan imagery'
  });

  const layer = viewerInstance.imageryLayers.addImageryProvider(imageryProvider);
  layer.show = true;
  layer.alpha = 0.88;
  layer.brightness = 0.95;
  layer.contrast = 0.9;
  layer.saturation = 0.72;
  layer.gamma = 1.06;
};

const addYongchuanLocationLabel = (viewerInstance: Viewer) => {
  viewerInstance.entities.add({
    name: '重庆市永川区茶山竹海街道',
    position: Cesium.Cartesian3.fromDegrees(
      YONGCHUAN_LABEL_POSITION.lon,
      YONGCHUAN_LABEL_POSITION.lat,
      YONGCHUAN_LABEL_POSITION.height
    ),
    billboard: {
      image: YONGCHUAN_PIN_IMAGE,
      width: 34,
      height: 34,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    },
    label: {
      text: '重庆市永川区茶山竹海街道',
      font: '600 20px "Microsoft YaHei", sans-serif',
      fillColor: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.fromCssColorString('#07111b'),
      outlineWidth: 4,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      pixelOffset: new Cesium.Cartesian2(0, -38),
      horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    }
  });
};

onMounted(async () => {
  if (cesiumContainer.value) {
    let terrainProvider;
    try {
      terrainProvider = new EllipsoidTerrainProvider();
    } catch (error) {
      console.warn('地形服务加载失败，回退至基础椭球体无地形模式。如果需要真实地形起伏，请配置 Cesium Ion Token。');
      terrainProvider = new EllipsoidTerrainProvider();
    }

    viewer = new Viewer(cesiumContainer.value, {
      terrainProvider,
      animation: false,
      timeline: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      showRenderLoopErrors: false,
      infoBox: false,
      selectionIndicator: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      fullscreenButton: false,
      creditContainer: document.createElement('div'),
      contextOptions: {
        webgl: {
          preserveDrawingBuffer: true
        }
      }
    });

    configureCameraControls(viewer);
    addDefaultYongchuanImageryLayer(viewer);
    addYongchuanLocationLabel(viewer);

    // Initial far view (dark space) replacing setView to 10000000
    viewer.camera.setView({
      destination: Cartesian3.fromDegrees(104.06, 30.67, 25000000),
    });

    viewer.scene.globe.depthTestAgainstTerrain = true;
    viewer.scene.renderError.addEventListener((_scene, error) => {
      if (!viewer) return;
      console.warn('地形渲染异常，已回退到椭球地形。', error);
      viewer.terrainProvider = new EllipsoidTerrainProvider();
      viewer.useDefaultRenderLoop = true;
      emit('terrain-error', error);
    });

    handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((movement: any) => {
      if (!viewer) return;
      const ray = viewer.camera.getPickRay(movement.endPosition);
      if (ray) {
        const cartesian = viewer.scene.globe.pick(ray, viewer.scene);
        if (cartesian) {
          const cartographic = Cartographic.fromCartesian(cartesian);
          mousePosition.value.lon = CesiumMath.toDegrees(cartographic.longitude).toFixed(6);
          mousePosition.value.lat = CesiumMath.toDegrees(cartographic.latitude).toFixed(6);
          const height = viewer.scene.globe.getHeight(cartographic) || cartographic.height;
          mousePosition.value.height = height.toFixed(2);
          emit('coordinates-change', { ...mousePosition.value });
        }
      }
    }, ScreenSpaceEventType.MOUSE_MOVE);

    emit('viewer-ready', viewer);
    emit('roam-state-change', { ...roamUiState });
  }
});

onUnmounted(() => {
  if (handler) {
    handler.destroy();
    handler = null;
  }
  clearMeasurements();
  clearRoam();
});

const executeFlyTo = () => {
  if (!viewer) return;
  viewer.camera.flyTo({
    destination: Cartesian3.fromDegrees(104.06, 30.67, 10000000), // Fly to original V0226C default view over China
    duration: 5.0,
    complete: () => emit('fly-complete'),
    cancel: () => emit('fly-complete')
  });
};

const requestRender = () => {
  viewer?.scene.requestRender();
};

const addMeasurementEntity = (entity: Cesium.Entity.ConstructorOptions) => {
  if (!viewer) return null;
  const created = viewer.entities.add(entity);
  measurementEntities.push(created);
  return created;
};

const addRoamEntity = (entity: Cesium.Entity.ConstructorOptions) => {
  if (!viewer) return null;
  const created = viewer.entities.add(entity);
  roamEntities.push(created);
  return created;
};

const destroyMeasureHandler = () => {
  if (measureHandler) {
    measureHandler.destroy();
    measureHandler = null;
  }
};

const destroyRoamPickHandler = () => {
  if (roamPickHandler) {
    roamPickHandler.destroy();
    roamPickHandler = null;
  }
  if (roamKeydownHandler) {
    window.removeEventListener('keydown', roamKeydownHandler);
    roamKeydownHandler = null;
  }
  if (viewer) {
    viewer.scene.canvas.style.cursor = roamPreviousCursor;
  }
};

const pickCartesian = (position: Cesium.Cartesian2 | undefined) => {
  if (!viewer || !position) return null;

  try {
    if (viewer.scene.pickPositionSupported) {
      const picked = viewer.scene.pickPosition(position);
      if (Cesium.defined(picked)) return picked;
    }
  } catch {
    // Fall back to globe picking.
  }

  const ray = viewer.camera.getPickRay(position);
  return ray ? viewer.scene.globe.pick(ray, viewer.scene) ?? null : null;
};

const pickTerrainCartesian = (position: Cesium.Cartesian2 | undefined) => {
  if (!viewer || !position) return null;
  const ray = viewer.camera.getPickRay(position);
  const terrainPosition = ray ? viewer.scene.globe.pick(ray, viewer.scene) : undefined;
  if (Cesium.defined(terrainPosition)) return terrainPosition;

  try {
    if (viewer.scene.pickPositionSupported) {
      const picked = viewer.scene.pickPosition(position);
      if (Cesium.defined(picked)) return picked;
    }
  } catch {
    // No valid terrain/model depth at this screen position.
  }
  return null;
};

const formatDistance = (meters: number) => {
  return meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${meters.toFixed(2)} m`;
};

const formatArea = (squareMeters: number) => {
  return `${Number((squareMeters / 1_000_000).toFixed(3))} km²`;
};

const getSurfaceDistance = (positions: Cesium.Cartesian3[]) => {
  let total = 0;
  for (let index = 1; index < positions.length; index += 1) {
    const start = Cesium.Cartographic.fromCartesian(positions[index - 1]);
    const end = Cesium.Cartographic.fromCartesian(positions[index]);
    total += new Cesium.EllipsoidGeodesic(start, end).surfaceDistance;
  }
  return total;
};

const getArea = (positions: Cesium.Cartesian3[]) => {
  if (positions.length < 3) return 0;
  const cartographics = positions.map((position) => Cesium.Cartographic.fromCartesian(position));
  const avgLat = cartographics.reduce((sum, item) => sum + item.latitude, 0) / cartographics.length;
  const radius = Cesium.Ellipsoid.WGS84.maximumRadius;
  const points = cartographics.map((item) => ({
    x: item.longitude * radius * Math.cos(avgLat),
    y: item.latitude * radius
  }));

  let area = 0;
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length];
    area += point.x * next.y - next.x * point.y;
  });
  return Math.abs(area) / 2;
};

const addMeasurePoint = (position: Cesium.Cartesian3, text?: string) => {
  addMeasurementEntity({
    position,
    point: {
      pixelSize: 9,
      color: Cesium.Color.fromCssColorString('#5cf2ff'),
      outlineColor: Cesium.Color.WHITE.withAlpha(0.8),
      outlineWidth: 2,
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    },
    label: text
      ? {
          text,
          font: '12px Microsoft YaHei',
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -22),
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        }
      : undefined
  });
};

const fullScreen = () => {
  const element = (cesiumContainer.value?.closest('.main-container') as HTMLElement | null) ?? viewer?.container;
  if (!element) return;
  if (document.fullscreenElement) {
    document.exitFullscreen?.();
    return;
  }
  element.requestFullscreen?.();
};

const captureScreen = () => {
  if (!viewer) return;
  viewer.render();
  const link = document.createElement('a');
  link.download = `flood-view-${Date.now()}.png`;
  link.href = viewer.scene.canvas.toDataURL('image/png');
  link.click();
};

const flyToHome = () => {
  if (!viewer) return;
  viewer.camera.flyTo({
    destination: Cartesian3.fromDegrees(104.06, 30.67, 10000000),
    duration: 2.8
  });
};

const flyToPosition = (lon: number, lat: number, height: number) => {
  if (!viewer) return;
  viewer.camera.flyTo({
    destination: Cartesian3.fromDegrees(lon, lat, height),
    duration: 2.2
  });
};

const clearMeasurements = () => {
  destroyMeasureHandler();
  measurementEntities.splice(0).forEach((entity) => viewer?.entities.remove(entity));
  requestRender();
};

const startMeasure = (mode: 'distance' | 'height' | 'area') => {
  if (!viewer) return;
  destroyMeasureHandler();

  const positions: Cesium.Cartesian3[] = [];
  let movingPosition: Cesium.Cartesian3 | null = null;

  measureHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

  if (mode === 'distance' || mode === 'height') {
    addMeasurementEntity({
      polyline: {
        positions: new Cesium.CallbackProperty(() => (movingPosition ? [...positions, movingPosition] : positions), false),
        width: 3,
        material: mode === 'height' ? Cesium.Color.ORANGE.withAlpha(0.9) : Cesium.Color.CYAN.withAlpha(0.85),
        clampToGround: mode === 'distance'
      }
    });
  }

  if (mode === 'area') {
    addMeasurementEntity({
      polygon: {
        hierarchy: new Cesium.CallbackProperty(() => {
          const current = movingPosition ? [...positions, movingPosition] : positions;
          return current.length >= 3 ? new Cesium.PolygonHierarchy(current) : undefined;
        }, false),
        material: Cesium.Color.fromCssColorString('#00e5ff').withAlpha(0.22),
        outline: true,
        outlineColor: Cesium.Color.CYAN
      },
      polyline: {
        positions: new Cesium.CallbackProperty(() => {
          const current = movingPosition ? [...positions, movingPosition] : positions;
          return current.length > 1 ? [...current, current[0]] : current;
        }, false),
        width: 2,
        material: Cesium.Color.CYAN.withAlpha(0.85),
        clampToGround: true
      }
    });
  }

  measureHandler.setInputAction((event: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
    const position = pickCartesian(event.position);
    if (!position) return;
    positions.push(position);
    addMeasurePoint(position);

    if (mode === 'height' && positions.length >= 2) {
      const start = Cesium.Cartographic.fromCartesian(positions[0]);
      const end = Cesium.Cartographic.fromCartesian(positions[1]);
      const height = Math.abs(end.height - start.height);
      addMeasurePoint(positions[1], `高度 ${height.toFixed(2)} m`);
      destroyMeasureHandler();
    }
    requestRender();
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  measureHandler.setInputAction((event: Cesium.ScreenSpaceEventHandler.MotionEvent) => {
    movingPosition = pickCartesian(event.endPosition);
    requestRender();
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

  measureHandler.setInputAction(() => {
    if (mode === 'distance' && positions.length >= 2) {
      addMeasurePoint(positions[positions.length - 1], `距离 ${formatDistance(getSurfaceDistance(positions))}`);
    }
    if (mode === 'area' && positions.length >= 3) {
      addMeasurePoint(positions[positions.length - 1], `面积 ${formatArea(getArea(positions))}`);
    }
    destroyMeasureHandler();
    requestRender();
  }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);
};

const cancelRoamAnimation = () => {
  if (roamAnimationFrame !== null) {
    cancelAnimationFrame(roamAnimationFrame);
    roamAnimationFrame = null;
  }
};

const updateRoamUiState = (message = roamUiState.message, force = false) => {
  const now = performance.now();
  const progress = roamTotalDistance > 0
    ? CesiumMath.clamp(roamCurrentDistance / roamTotalDistance, 0, 1)
    : 0;
  roamUiState = {
    phase: roamPhase,
    mode: roamCurrentMode,
    progress,
    distance: roamCurrentDistance,
    totalDistance: roamTotalDistance,
    speed: roamCurrentSpeed,
    relativeHeight: roamCurrentHeight,
    pointCount: roamPath.length,
    routeReady: roamTrackSamples.length >= 2,
    message
  };
  if (force || now - roamLastStateEmitAt >= 100) {
    roamLastStateEmitAt = now;
    emit('roam-state-change', { ...roamUiState });
  }
};

const setRoamPhase = (phase: RoamPhase, message: string, force = true) => {
  roamPhase = phase;
  updateRoamUiState(message, force);
};

const setRoamCameraLocked = (locked: boolean) => {
  if (!viewer) return;
  const controller = viewer.scene.screenSpaceCameraController;
  if (locked) {
    if (roamCameraInputBeforeLock === null) {
      roamCameraInputBeforeLock = controller.enableInputs;
    }
    controller.enableInputs = false;
    return;
  }
  controller.enableInputs = roamCameraInputBeforeLock ?? true;
  roamCameraInputBeforeLock = null;
};

const removeRoamEntities = () => {
  roamEntities.splice(0).forEach((entity) => viewer?.entities.remove(entity));
  roamPointEntities.length = 0;
  roamMovingEntity = null;
};

const removeLastRoamPoint = () => {
  if (!viewer || roamPath.length === 0) return;
  roamPath.pop();
  const point = roamPointEntities.pop();
  if (point) {
    viewer.entities.remove(point);
    const entityIndex = roamEntities.indexOf(point);
    if (entityIndex >= 0) roamEntities.splice(entityIndex, 1);
  }
  updateRoamUiState(
    roamPath.length > 0 ? `已保留 ${roamPath.length} 个路径点。` : '路径点已清空，可重新拾取。',
    true
  );
  requestRender();
};

const addRoamControlPoint = (position: Cesium.Cartesian3, index: number) => {
  const entity = addRoamEntity({
    position,
    point: {
      pixelSize: index === 0 ? 13 : 10,
      color: index === 0 ? Cesium.Color.fromCssColorString('#73f2bf') : Cesium.Color.fromCssColorString('#62e7ff'),
      outlineColor: Cesium.Color.fromCssColorString('#071421').withAlpha(0.96),
      outlineWidth: 3,
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    },
    label: {
      text: index === 0 ? '起点' : String(index + 1).padStart(2, '0'),
      font: 'bold 11px Microsoft YaHei',
      fillColor: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.BLACK.withAlpha(0.72),
      outlineWidth: 3,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      pixelOffset: new Cesium.Cartesian2(0, -22),
      showBackground: true,
      backgroundColor: Cesium.Color.fromCssColorString('#061928').withAlpha(0.72),
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    }
  });
  if (entity) roamPointEntities.push(entity);
};

const addRoamTrackMarker = (position: Cesium.Cartesian3, text: string, endpoint = false) => {
  addRoamEntity({
    position,
    point: {
      pixelSize: endpoint ? 12 : 8,
      color: endpoint
        ? Cesium.Color.fromCssColorString('#7bf2bd')
        : Cesium.Color.fromCssColorString('#7deaf6').withAlpha(0.88),
      outlineColor: Cesium.Color.fromCssColorString('#071421'),
      outlineWidth: 3,
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    },
    label: {
      text,
      font: endpoint ? 'bold 11px Microsoft YaHei' : '10px Microsoft YaHei',
      fillColor: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.BLACK.withAlpha(0.78),
      outlineWidth: 3,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      pixelOffset: new Cesium.Cartesian2(0, endpoint ? -24 : -19),
      showBackground: endpoint,
      backgroundColor: Cesium.Color.fromCssColorString('#061928').withAlpha(0.74),
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    }
  });
};

const drawRoamTrack = () => {
  if (!viewer || roamTrackSamples.length < 2) return;
  removeRoamEntities();
  const trackPositions = roamTrackSamples.map((sample) => sample.flightPosition);
  addRoamEntity({
    polyline: {
      positions: trackPositions,
      width: 6,
      material: new Cesium.PolylineGlowMaterialProperty({
        glowPower: 0.2,
        taperPower: 0.74,
        color: Cesium.Color.fromCssColorString('#58e8ff').withAlpha(0.94)
      }),
      depthFailMaterial: new Cesium.ColorMaterialProperty(
        Cesium.Color.fromCssColorString('#41bed8').withAlpha(0.64)
      ),
      arcType: Cesium.ArcType.NONE,
      clampToGround: false
    }
  });

  addRoamEntity({
    polyline: {
      positions: new Cesium.CallbackProperty(
        () => getRoamTrackProgressPositions(roamTrackSamples, roamCurrentDistance),
        false
      ),
      width: 7,
      material: new Cesium.PolylineGlowMaterialProperty({
        glowPower: 0.24,
        taperPower: 0.62,
        color: Cesium.Color.fromCssColorString('#72f2bd').withAlpha(0.94)
      }),
      depthFailMaterial: new Cesium.ColorMaterialProperty(
        Cesium.Color.fromCssColorString('#57c99b').withAlpha(0.72)
      ),
      arcType: Cesium.ArcType.NONE,
      clampToGround: false
    }
  });

  const markerCount = Math.min(7, Math.max(2, roamPath.length));
  for (let index = 0; index < markerCount; index += 1) {
    const distance = markerCount === 1 ? 0 : roamTotalDistance * index / (markerCount - 1);
    const sample = sampleRoamTrack(roamTrackSamples, distance);
    if (!sample) continue;
    const isStart = index === 0;
    const isEnd = index === markerCount - 1;
    addRoamTrackMarker(
      sample.flightPosition,
      isStart ? '起点' : isEnd ? '终点' : String(index + 1).padStart(2, '0'),
      isStart || isEnd
    );
  }

  roamMovingEntity = addRoamEntity({
    position: roamTrackSamples[0].flightPosition,
    point: {
      pixelSize: 13,
      color: Cesium.Color.fromCssColorString('#ffffff'),
      outlineColor: Cesium.Color.fromCssColorString('#00e5ff'),
      outlineWidth: 4,
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    },
    label: {
      text: '漫游相机',
      font: 'bold 12px Microsoft YaHei',
      fillColor: Cesium.Color.fromCssColorString('#e8ffff'),
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 3,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      pixelOffset: new Cesium.Cartesian2(0, -28),
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    }
  });
  requestRender();
};

const clearRoam = () => {
  roamBuildVersion += 1;
  roamOperationVersion += 1;
  destroyRoamPickHandler();
  cancelRoamAnimation();
  viewer?.camera.cancelFlight();
  setRoamCameraLocked(false);
  roamPath = [];
  roamPreviewPosition = null;
  roamGroundSamples = [];
  roamTrackSamples = [];
  roamTotalDistance = 0;
  roamCurrentDistance = 0;
  roamLastFrameAt = 0;
  roamGroundTerrainProvider = null;
  roamMovingEntity = null;
  removeRoamEntities();
  setRoamPhase('idle', '可手动规划路径，或导入包含坐标系信息的完整 Shapefile 航线。');
  requestRender();
};

const waitForTileIdle = (timeout = 1800) => new Promise<void>((resolve) => {
  if (!viewer) {
    resolve();
    return;
  }

  const activeViewer = viewer;
  let finished = false;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  const cleanup = () => {
    if (finished) return;
    finished = true;
    if (idleTimer) clearTimeout(idleTimer);
    if (timeoutTimer) clearTimeout(timeoutTimer);
    activeViewer.scene.globe.tileLoadProgressEvent.removeEventListener(listener);
    resolve();
  };
  const listener = (queuedTileCount: number) => {
    if (queuedTileCount === 0) {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(cleanup, 220);
    }
  };

  activeViewer.scene.globe.tileLoadProgressEvent.addEventListener(listener);
  timeoutTimer = setTimeout(cleanup, timeout);
});

const prepareRoamScene = async () => {
  if (!viewer) return;
  viewer.scene.globe.preloadAncestors = true;
  viewer.scene.globe.preloadSiblings = true;
  viewer.scene.globe.tileCacheSize = Math.max(viewer.scene.globe.tileCacheSize, 520);
  viewer.scene.requestRender();
  await waitForTileIdle(1200);
};

const buildRoamTrack = async (relativeHeight: number, sourceText = roamSourceText) => {
  if (!viewer || roamPath.length < 2) {
    setRoamPhase('error', '请至少设置两个有效路径点。');
    return false;
  }

  const activeViewer = viewer;
  const buildVersion = ++roamBuildVersion;
  roamCurrentHeight = Math.max(1, relativeHeight);
  roamSourceText = sourceText;
  setRoamPhase('building', '正在平滑路径并采样 DEM 高程...');

  try {
    const smoothRoute = buildSmoothHorizontalRoute(roamPath);
    if (smoothRoute.length < 2) {
      throw new Error('路径长度过短，请重新设置路径点。');
    }

    if (
      roamGroundSamples.length < 2 ||
      roamGroundTerrainProvider !== activeViewer.terrainProvider
    ) {
      roamGroundSamples = await sampleRoamGround(
        activeViewer.terrainProvider,
        smoothRoute,
        (position) => activeViewer.scene.globe.getHeight(position)
      );
      roamGroundTerrainProvider = activeViewer.terrainProvider;
    }

    if (buildVersion !== roamBuildVersion || viewer !== activeViewer) return false;
    roamTrackSamples = buildRoamFlightTrack(roamGroundSamples, roamCurrentHeight);
    roamTotalDistance = roamTrackSamples.at(-1)?.distance ?? 0;
    roamCurrentDistance = 0;
    if (roamTrackSamples.length < 2 || roamTotalDistance <= 0) {
      throw new Error('未能生成有效三维飞行轨迹。');
    }

    drawRoamTrack();
    setRoamPhase(
      'ready',
      `${roamSourceText}已就绪，全程 ${formatDistance(roamTotalDistance)}，相对 DEM 高度 ${roamCurrentHeight.toFixed(0)} m。`
    );
    return true;
  } catch (error) {
    if (buildVersion !== roamBuildVersion) return false;
    roamGroundSamples = [];
    roamTrackSamples = [];
    roamTotalDistance = 0;
    removeRoamEntities();
    setRoamPhase('error', error instanceof Error ? error.message : '漫游轨迹构建失败。');
    return false;
  }
};

const finishRoamDrawing = async () => {
  if (roamPath.length < 2) {
    updateRoamUiState('至少需要两个路径点；继续左键添加，或按 Esc 取消。', true);
    return false;
  }
  destroyRoamPickHandler();
  roamPreviewPosition = null;
  return buildRoamTrack(roamCurrentHeight, '手动规划路线');
};

const startPickRoamPath = () => {
  if (!viewer) return '地图工具尚未准备好。';
  clearRoam();
  const activeViewer = viewer;
  roamPreviousCursor = activeViewer.scene.canvas.style.cursor;
  activeViewer.scene.canvas.style.cursor = 'crosshair';
  setRoamPhase('drawing', '左键添加路径点，右键或 Enter 完成，Backspace 撤销，Esc 取消。');

  roamPickHandler = new Cesium.ScreenSpaceEventHandler(activeViewer.scene.canvas);
  addRoamEntity({
    polyline: {
      positions: new Cesium.CallbackProperty(
        () => roamPreviewPosition ? [...roamPath, roamPreviewPosition] : roamPath,
        false
      ),
      width: 5,
      material: new Cesium.PolylineGlowMaterialProperty({
        glowPower: 0.2,
        taperPower: 0.72,
        color: Cesium.Color.fromCssColorString('#55e7ff').withAlpha(0.92)
      }),
      depthFailMaterial: new Cesium.ColorMaterialProperty(
        Cesium.Color.fromCssColorString('#348da0').withAlpha(0.62)
      ),
      clampToGround: true
    }
  });

  roamPickHandler.setInputAction((event: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
    const position = pickTerrainCartesian(event.position);
    if (!position) return;
    const previous = roamPath.at(-1);
    if (previous && Cesium.Cartesian3.distance(previous, position) < 1) return;
    roamPath.push(position);
    addRoamControlPoint(position, roamPath.length - 1);
    updateRoamUiState(`已设置 ${roamPath.length} 个路径点。`, true);
    requestRender();
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  roamPickHandler.setInputAction((event: Cesium.ScreenSpaceEventHandler.MotionEvent) => {
    roamPreviewPosition = pickTerrainCartesian(event.endPosition);
    requestRender();
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

  roamPickHandler.setInputAction(() => {
    void finishRoamDrawing();
  }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);

  roamKeydownHandler = (event: KeyboardEvent) => {
    if (event.key === 'Backspace') {
      event.preventDefault();
      removeLastRoamPoint();
    } else if (event.key === 'Escape') {
      clearRoam();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      void finishRoamDrawing();
    }
  };
  window.addEventListener('keydown', roamKeydownHandler);

  return roamUiState.message;
};

const getTrackDirection = (distance: number, lookDistance: number) => {
  const behind = sampleRoamTrack(roamTrackSamples, Math.max(0, distance - lookDistance * 0.45));
  const ahead = sampleRoamTrack(roamTrackSamples, Math.min(roamTotalDistance, distance + lookDistance));
  if (!behind || !ahead) return null;
  const direction = Cesium.Cartesian3.subtract(
    ahead.flightPosition,
    behind.flightPosition,
    new Cesium.Cartesian3()
  );
  if (Cesium.Cartesian3.magnitudeSquared(direction) < 0.0001) return null;
  return Cesium.Cartesian3.normalize(direction, direction);
};

const getStableCameraUp = (direction: Cesium.Cartesian3, position: Cesium.Cartesian3) => {
  const surfaceNormal = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(position, new Cesium.Cartesian3());
  const right = Cesium.Cartesian3.cross(direction, surfaceNormal, new Cesium.Cartesian3());
  if (Cesium.Cartesian3.magnitudeSquared(right) < 0.0001) {
    return surfaceNormal;
  }
  Cesium.Cartesian3.normalize(right, right);
  const up = Cesium.Cartesian3.cross(right, direction, new Cesium.Cartesian3());
  return Cesium.Cartesian3.normalize(up, up);
};

const getRoamCameraView = (sample: RoamTrackPoint, mode = roamCurrentMode): RoamCameraView | null => {
  const lookDistance = CesiumMath.clamp(roamCurrentSpeed * 1.6, 55, 480);
  const trackDirection = getTrackDirection(sample.distance, lookDistance);
  if (!trackDirection) return null;

  if (mode === 'first') {
    const destination = Cesium.Cartesian3.clone(sample.flightPosition);
    return {
      destination,
      orientation: {
        direction: trackDirection,
        up: getStableCameraUp(trackDirection, destination)
      }
    };
  }

  const surfaceNormal = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(
    sample.flightPosition,
    new Cesium.Cartesian3()
  );
  const backDistance = CesiumMath.clamp(
    roamCurrentHeight * 2.2 + roamCurrentSpeed * 1.35,
    180,
    950
  );
  const rise = CesiumMath.clamp(
    roamCurrentHeight * 0.9 + roamCurrentSpeed * 0.3,
    90,
    460
  );
  const destination = Cesium.Cartesian3.clone(sample.flightPosition);
  Cesium.Cartesian3.add(
    destination,
    Cesium.Cartesian3.multiplyByScalar(trackDirection, -backDistance, new Cesium.Cartesian3()),
    destination
  );
  Cesium.Cartesian3.add(
    destination,
    Cesium.Cartesian3.multiplyByScalar(surfaceNormal, rise, new Cesium.Cartesian3()),
    destination
  );
  const target = sampleRoamTrack(
    roamTrackSamples,
    Math.min(roamTotalDistance, sample.distance + Math.max(45, roamCurrentSpeed * 0.7))
  )?.flightPosition ?? sample.flightPosition;
  const direction = Cesium.Cartesian3.subtract(target, destination, new Cesium.Cartesian3());
  Cesium.Cartesian3.normalize(direction, direction);

  return {
    destination,
    orientation: {
      direction,
      up: getStableCameraUp(direction, sample.flightPosition)
    }
  };
};

const applyRoamCamera = (distance: number, mode = roamCurrentMode) => {
  if (!viewer) return false;
  const sample = sampleRoamTrack(roamTrackSamples, distance);
  if (!sample) return false;
  const view = getRoamCameraView(sample, mode);
  if (!view) return false;
  viewer.camera.setView(view);
  if (roamMovingEntity) {
    roamMovingEntity.show = mode === 'third';
    roamMovingEntity.position = new Cesium.ConstantPositionProperty(sample.flightPosition);
  }
  return true;
};

const animateRoam = (timestamp: number) => {
  if (!viewer || roamPhase !== 'running' || roamTrackSamples.length < 2) return;
  setRoamCameraLocked(true);
  if (roamLastFrameAt <= 0) roamLastFrameAt = timestamp;
  const deltaSeconds = CesiumMath.clamp((timestamp - roamLastFrameAt) / 1000, 0, 0.12);
  roamLastFrameAt = timestamp;
  roamCurrentDistance = Math.min(
    roamTotalDistance,
    roamCurrentDistance + roamCurrentSpeed * deltaSeconds
  );
  applyRoamCamera(roamCurrentDistance);
  updateRoamUiState('漫游进行中...', false);
  requestRender();

  if (roamCurrentDistance >= roamTotalDistance) {
    cancelRoamAnimation();
    if (roamMovingEntity) roamMovingEntity.show = true;
    setRoamCameraLocked(false);
    setRoamPhase('completed', '漫游已完成，相机控制已恢复。');
    return;
  }

  roamAnimationFrame = requestAnimationFrame(animateRoam);
};

const flyCameraToRoamView = (view: RoamCameraView, duration: number) => new Promise<void>((resolve) => {
  if (!viewer) {
    resolve();
    return;
  }
  viewer.camera.flyTo({
    ...view,
    duration,
    easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
    complete: resolve,
    cancel: resolve
  });
});

const setRoamViewMode = async (mode: RoamViewMode) => {
  if (mode === roamCurrentMode) {
    return mode === 'first' ? '当前已是第一人称视角。' : '当前已是第三人称视角。';
  }
  roamCurrentMode = mode;
  const previousPhase = roamPhase;
  const shouldTransition = ['running', 'paused'].includes(previousPhase);
  updateRoamUiState(
    mode === 'first' ? '已切换为第一人称沉浸视角。' : '已切换为第三人称跟随视角。',
    true
  );
  if (!viewer || !shouldTransition) {
    return roamUiState.message;
  }

  const sample = sampleRoamTrack(roamTrackSamples, roamCurrentDistance);
  const view = sample ? getRoamCameraView(sample, mode) : null;
  if (!view) return roamUiState.message;

  const operationVersion = ++roamOperationVersion;
  cancelRoamAnimation();
  viewer.camera.cancelFlight();
  setRoamPhase('transitioning', '正在平滑切换漫游视角...');
  await flyCameraToRoamView(view, 0.65);
  if (operationVersion !== roamOperationVersion || !viewer) return roamUiState.message;

  if (previousPhase === 'running') {
    roamLastFrameAt = performance.now();
    setRoamPhase('running', '漫游进行中...');
    roamAnimationFrame = requestAnimationFrame(animateRoam);
  } else {
    setRoamPhase('paused', '漫游已暂停。');
  }
  return mode === 'first' ? '已切换为第一人称沉浸视角。' : '已切换为第三人称跟随视角。';
};

const startRoam = async (speed: number, height: number, mode: RoamViewMode = roamCurrentMode) => {
  if (!viewer) return '地图工具尚未准备好。';
  const activeViewer = viewer;
  if (roamPath.length < 2) return '请先拾取或导入至少两个漫游路径点。';
  if (!Number.isFinite(speed) || speed <= 0 || !Number.isFinite(height) || height < 1) {
    return '请输入有效的漫游速度和相对 DEM 高度。';
  }

  roamOperationVersion += 1;
  cancelRoamAnimation();
  activeViewer.camera.cancelFlight();
  setRoamCameraLocked(false);
  roamCurrentSpeed = speed;
  roamCurrentHeight = height;
  roamCurrentMode = mode;
  roamCurrentDistance = 0;
  roamLastFrameAt = 0;

  const needsRebuild =
    roamTrackSamples.length < 2 ||
    roamGroundTerrainProvider !== activeViewer.terrainProvider ||
    Math.abs((roamTrackSamples[0]?.flightPosition
      ? Cesium.Cartographic.fromCartesian(roamTrackSamples[0].flightPosition).height -
        roamGroundSamples[0].cartographic.height
      : 0) - roamCurrentHeight) > 0.1;
  if (needsRebuild && !await buildRoamTrack(roamCurrentHeight, roamSourceText)) {
    return roamUiState.message;
  }

  const operationVersion = ++roamOperationVersion;
  await prepareRoamScene();
  if (operationVersion !== roamOperationVersion || viewer !== activeViewer) return roamUiState.message;

  const sample = sampleRoamTrack(roamTrackSamples, 0);
  const startView = sample ? getRoamCameraView(sample, roamCurrentMode) : null;
  if (!startView) return '无法计算漫游起始视角。';

  setRoamCameraLocked(true);
  setRoamPhase('transitioning', '正在过渡到航线起点并预加载周边地形...');
  await flyCameraToRoamView(startView, 1.6);
  if (operationVersion !== roamOperationVersion || viewer !== activeViewer) return roamUiState.message;
  if (roamMovingEntity && sample) {
    roamMovingEntity.show = roamCurrentMode === 'third';
    roamMovingEntity.position = new Cesium.ConstantPositionProperty(sample.flightPosition);
  }
  await waitForTileIdle(850);
  if (operationVersion !== roamOperationVersion || viewer !== activeViewer) return roamUiState.message;

  roamLastFrameAt = performance.now();
  setRoamPhase('running', '漫游进行中...');
  roamAnimationFrame = requestAnimationFrame(animateRoam);
  return mode === 'first' ? '第一人称漫游已开始，正在沿规划路线推进。' : '第三人称跟随漫游已开始，正在沿规划路线推进。';
};

const toggleRoamPause = () => {
  if (!viewer || roamTrackSamples.length < 2) return '请先开始漫游。';
  if (roamPhase === 'running') {
    cancelRoamAnimation();
    setRoamPhase('paused', '漫游已暂停。');
    return '漫游已暂停。';
  }
  if (roamPhase === 'paused') {
    setRoamCameraLocked(true);
    roamLastFrameAt = performance.now();
    setRoamPhase('running', '漫游进行中...');
    roamAnimationFrame = requestAnimationFrame(animateRoam);
    return '漫游继续。';
  }
  return '当前没有可暂停或继续的漫游任务。';
};

const stopRoam = () => {
  if (!viewer) return '地图工具尚未准备好。';
  roamOperationVersion += 1;
  cancelRoamAnimation();
  viewer.camera.cancelFlight();
  roamLastFrameAt = 0;
  if (roamMovingEntity) roamMovingEntity.show = true;
  setRoamCameraLocked(false);
  setRoamPhase(
    roamTrackSamples.length >= 2 ? 'stopped' : 'idle',
    '漫游已停止，相机缩放与转动控制已恢复。'
  );
  return '漫游已停止，已释放相机控制。';
};

const loadRoamShapefileDataset = async (
  files: File[],
  source: ShapefileImportSource = 'files'
) => {
  if (!viewer) return '地图工具尚未准备好。';
  if (files.length === 0) throw new Error('未选择任何 Shapefile 数据集文件。');

  setRoamPhase('building', '正在检查 Shapefile 完整性、坐标系与线状几何...');
  try {
    const result = await importShapefileRoute(files, source);
    const positions = result.coordinates.map(([longitude, latitude]) => (
      Cesium.Cartesian3.fromDegrees(longitude, latitude, 0)
    ));

    clearRoam();
    roamPath = positions;
    const sourceText = `导入航线 · ${result.report.datasetName}`;
    const built = await buildRoamTrack(roamCurrentHeight, sourceText);
    if (!built || !viewer) {
      throw new Error(roamUiState.message);
    }

    const sphere = Cesium.BoundingSphere.fromPoints(
      roamTrackSamples.map((sample) => sample.flightPosition)
    );
    viewer.camera.flyToBoundingSphere(sphere, {
      duration: 1.35,
      offset: new Cesium.HeadingPitchRange(
        0,
        CesiumMath.toRadians(-45),
        Math.max(sphere.radius * 3.8, 1800)
      )
    });

    result.report.message = `${result.report.message} 已生成 ${positions.length} 个控制点的三维漫游轨迹。`;
    return result.report;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Shapefile 航线导入失败。';
    setRoamPhase('error', message);
    throw error;
  }
};

const clearView = () => {
  clearMeasurements();
  clearRoam();
};

defineExpose({
  executeFlyTo,
  fullScreen,
  captureScreen,
  flyToHome,
  flyToPosition,
  clearView,
  startMeasure,
  clearMeasurements,
  startPickRoamPath,
  startRoam,
  setRoamViewMode,
  loadRoamShapefileDataset,
  toggleRoamPause,
  stopRoam,
  clearRoam
});
</script>

<template>
  <div class="viewer-wrapper">
    <div ref="cesiumContainer" class="cesium-container"></div>
  </div>
</template>

<style scoped>
.viewer-wrapper {
  width: 100%;
  height: 100%;
  position: relative;
}

.cesium-container {
  width: 100%;
  height: 100%;
}
</style>
