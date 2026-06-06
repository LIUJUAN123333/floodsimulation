<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import * as Cesium from 'cesium';
import {
  Viewer,
  Cartesian3,
  createWorldTerrainAsync,
  EllipsoidTerrainProvider,
  Ion,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  Cartographic,
  Math as CesiumMath
} from 'cesium';

// 配置你申请到的 Cesium Ion Token
Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiIyZmNiZjM4NS03MDZmLTQzNTUtOWIwYS1iNzAxYzU0NjFkNzQiLCJpZCI6MzQzMDgzLCJpYXQiOjE3NTgzNzA4NDl9.AqR4eRVi5bNqIptxtsP6wq4LhgBUawcdVkxW_L9iuJk';

const cesiumContainer = ref<HTMLElement | null>(null);
let viewer: Viewer | null = null;
let handler: ScreenSpaceEventHandler | null = null;
let measureHandler: Cesium.ScreenSpaceEventHandler | null = null;
let roamPickHandler: Cesium.ScreenSpaceEventHandler | null = null;
let roamTimer: ReturnType<typeof setTimeout> | null = null;
let roamPath: Cesium.Cartesian3[] = [];
let roamSegmentIndex = 0;
let roamCurrentSpeed = 80;
let roamCurrentHeight = 120;
let isRoamPaused = false;
const measurementEntities: Cesium.Entity[] = [];
const roamEntities: Cesium.Entity[] = [];
const emit = defineEmits(['viewer-ready', 'fly-complete']);

const mousePosition = ref({ lon: '0.000000', lat: '0.000000', height: '0.00' });
const showCoordinates = ref(false);

onMounted(async () => {
  if (cesiumContainer.value) {
    let terrainProvider;
    try {
      terrainProvider = await createWorldTerrainAsync();
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
      infoBox: false,
      selectionIndicator: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      creditContainer: document.createElement('div'),
      contextOptions: {
        webgl: {
          preserveDrawingBuffer: true
        }
      }
    });

    // Initial far view (dark space) replacing setView to 10000000
    viewer.camera.setView({
      destination: Cartesian3.fromDegrees(104.06, 30.67, 25000000),
    });

    viewer.scene.globe.depthTestAgainstTerrain = true;

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
          showCoordinates.value = true;
        } else {
          showCoordinates.value = false;
        }
      }
    }, ScreenSpaceEventType.MOUSE_MOVE);

    emit('viewer-ready', viewer);
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

const formatDistance = (meters: number) => {
  return meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${meters.toFixed(2)} m`;
};

const formatArea = (squareMeters: number) => {
  return squareMeters >= 1000000 ? `${(squareMeters / 1000000).toFixed(3)} km²` : `${squareMeters.toFixed(2)} m²`;
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
  const element = viewer?.container;
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

const clearRoamTimer = () => {
  if (roamTimer) {
    clearTimeout(roamTimer);
    roamTimer = null;
  }
};

const clearRoam = () => {
  destroyRoamPickHandler();
  clearRoamTimer();
  viewer?.camera.cancelFlight();
  roamPath = [];
  roamSegmentIndex = 0;
  isRoamPaused = false;
  roamEntities.splice(0).forEach((entity) => viewer?.entities.remove(entity));
  requestRender();
};

const startPickRoamPath = () => {
  if (!viewer) return;
  clearRoam();

  roamPickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  addRoamEntity({
    polyline: {
      positions: new Cesium.CallbackProperty(() => roamPath, false),
      width: 3,
      material: Cesium.Color.LIME.withAlpha(0.82),
      clampToGround: true
    }
  });

  roamPickHandler.setInputAction((event: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
    const position = pickCartesian(event.position);
    if (!position) return;
    roamPath.push(position);
    addRoamEntity({
      position,
      point: {
        pixelSize: 8,
        color: Cesium.Color.LIME,
        outlineColor: Cesium.Color.WHITE.withAlpha(0.85),
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      }
    });
    requestRender();
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  roamPickHandler.setInputAction(() => {
    destroyRoamPickHandler();
  }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);
};

const getRoamCameraDestination = (position: Cesium.Cartesian3) => {
  const cartographic = Cesium.Cartographic.fromCartesian(position);
  return Cesium.Cartesian3.fromRadians(cartographic.longitude, cartographic.latitude, cartographic.height + roamCurrentHeight);
};

const flyRoamSegment = () => {
  if (!viewer || isRoamPaused || roamPath.length < 2 || roamSegmentIndex >= roamPath.length) return;
  const current = roamPath[Math.max(0, roamSegmentIndex - 1)];
  const target = roamPath[roamSegmentIndex];
  const distance = Cesium.Cartesian3.distance(current, target);
  const duration = Math.max(0.8, Math.min(12, distance / Math.max(1, roamCurrentSpeed)));

  viewer.camera.flyTo({
    destination: getRoamCameraDestination(target),
    duration,
    complete: () => {
      roamSegmentIndex += 1;
      roamTimer = setTimeout(flyRoamSegment, 120);
    },
    cancel: () => {
      clearRoamTimer();
    }
  });
};

const startRoam = (speed: number, height: number) => {
  if (!viewer || roamPath.length < 2) return;
  clearRoamTimer();
  viewer.camera.cancelFlight();
  roamCurrentSpeed = speed;
  roamCurrentHeight = height;
  isRoamPaused = false;
  roamSegmentIndex = 1;
  viewer.camera.setView({
    destination: getRoamCameraDestination(roamPath[0])
  });
  flyRoamSegment();
};

const toggleRoamPause = () => {
  if (!viewer || roamPath.length < 2) return;
  isRoamPaused = !isRoamPaused;
  if (isRoamPaused) {
    clearRoamTimer();
    viewer.camera.cancelFlight();
    return;
  }
  flyRoamSegment();
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
  toggleRoamPause,
  clearRoam
});
</script>

<template>
  <div class="viewer-wrapper">
    <div ref="cesiumContainer" class="cesium-container"></div>
    
    <div class="coordinates-panel" aria-hidden="false">
      <div class="coords-row">
        <span class="coord-label">海拔:</span>
        <span class="coord-value">{{ mousePosition.height }} 米</span>
        <span class="coord-gap"></span>
        <span class="coord-label">经度:</span>
        <span class="coord-value">{{ mousePosition.lon }}</span>
        <span class="coord-gap"></span>
        <span class="coord-label">纬度:</span>
        <span class="coord-value">{{ mousePosition.lat }}</span>
      </div>
    </div>
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

.coordinates-panel {
  position: absolute;
  bottom: 10px;
  right: 220px; /* 向左移动以避免遮挡 Logo；如需微调可改为 200px/240px 等 */
  background: transparent;
  border-radius: 4px;
  padding: 6px 10px;
  display: flex;
  align-items: center;
  z-index: 9998; /* 低于 logo 的 9999，确保不被遮挡 */
  pointer-events: none;
  font-family: "Microsoft YaHei", sans-serif;
}

.coords-row {
  display: flex;
  align-items: center;
  gap: 10px;
  background: transparent;
  border: none;
  box-shadow: none;
  padding: 6px 10px;
}

.coord-label {
  color: rgba(255, 255, 255, 0.95);
  font-size: 13px;
  font-weight: 500;
}

.coord-value {
  color: #00e5ff;
  font-size: 13px;
  font-weight: 700;
  font-family: "Courier New", Courier, monospace;
}

.coord-gap {
  width: 8px;
}

@media (max-width: 1200px) {
  .coordinates-panel {
    right: 140px; /* 窄屏时减小预留，避免超出可视范围 */
  }
}

@media (max-width: 760px) {
  .coordinates-panel {
    right: 90px; /* 手机或小屏幕进一步调整 */
  }
}

.coord-item {
  display: flex;
  align-items: center;
  gap: 6px;
}

.coord-label {
  color: #89a8bf;
  font-size: 12px;
}

.coord-value {
  color: #00e5ff;
  font-size: 13px;
  font-weight: 600;
  font-family: "Courier New", Courier, monospace;
}

.fade-coords-enter-active,
.fade-coords-leave-active {
  transition: opacity 0.3s ease;
}
.fade-coords-enter-from,
.fade-coords-leave-to {
  opacity: 0;
}
</style>
