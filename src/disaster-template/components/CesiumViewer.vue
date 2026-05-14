<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import {
  Cartesian3,
  Color,
  JulianDate,
  Math as CesiumMath,
  Viewer,
  createWorldTerrainAsync,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  Cartographic,
  EllipsoidTerrainProvider
} from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';

const cesiumContainer = ref<HTMLElement | null>(null);
let viewer: Viewer | null = null;
let eventHandler: ScreenSpaceEventHandler | null = null;

const mouseLon = ref('0.000000');
const mouseLat = ref('0.000000');
const mouseAlt = ref('0.0000');

const isTerrainEnabled = ref(true);

const toggleTerrain = async () => {
  if (!viewer) return;
  if (isTerrainEnabled.value) {
    viewer.terrainProvider = new EllipsoidTerrainProvider();
    isTerrainEnabled.value = false;
  } else {
    viewer.terrainProvider = await createWorldTerrainAsync();
    isTerrainEnabled.value = true;
  }
};

const emit = defineEmits<{
  (e: 'viewer-ready', viewer: Viewer): void;
  (e: 'fly-complete'): void;
}>();

onMounted(async () => {
  if (!cesiumContainer.value) {
    return;
  }

  let terrainProvider;
  try {
    terrainProvider = await createWorldTerrainAsync();
  } catch (error) {
    console.error('Failed to load Cesium terrain, fallback to ellipsoid.', error);
  }

  viewer = new Viewer(cesiumContainer.value, {
    terrainProvider,
    animation: false,
    baseLayerPicker: false,
    fullscreenButton: false,
    geocoder: false,
    homeButton: false,
    infoBox: false,
    sceneModePicker: false,
    selectionIndicator: false,
    timeline: false,
    navigationHelpButton: false,
    vrButton: false,
    skyBox: false
  });

  viewer.scene.backgroundColor = Color.fromCssColorString('#0a0d14');
  viewer.clock.currentTime = JulianDate.fromDate(new Date('2023-06-21T04:00:00Z'));

  if (viewer.scene.skyAtmosphere) {
    viewer.scene.skyAtmosphere.hueShift = -0.5;
    viewer.scene.skyAtmosphere.saturationShift = -0.3;
    viewer.scene.skyAtmosphere.brightnessShift = -0.4;
  }

  viewer.scene.globe.enableLighting = true;
  viewer.camera.setView({
    destination: Cartesian3.fromDegrees(104.06, 30.67, 22000000)
  });

  // Track mouse coordinates & camera distance
  eventHandler = new ScreenSpaceEventHandler(viewer.scene.canvas);
  eventHandler.setInputAction((movement: any) => {
    if (!viewer) return;

    // enable depth test against terrain so pickPosition works with terrain
    viewer.scene.globe.depthTestAgainstTerrain = isTerrainEnabled.value;

    let cartesian = null;
    if (viewer.scene.pickPositionSupported && isTerrainEnabled.value) {
      cartesian = viewer.scene.pickPosition(movement.endPosition);
    }
    
    if (!cartesian) {
      const ray = viewer.camera.getPickRay(movement.endPosition);
      if (ray) {
        cartesian = viewer.scene.globe.pick(ray, viewer.scene);
      }
    }

    if (!cartesian) {
       cartesian = viewer.camera.pickEllipsoid(movement.endPosition, viewer.scene.globe.ellipsoid);
    }

    if (cartesian) {
      const cartographic = Cartographic.fromCartesian(cartesian);
      mouseLon.value = CesiumMath.toDegrees(cartographic.longitude).toFixed(6);
      mouseLat.value = CesiumMath.toDegrees(cartographic.latitude).toFixed(6);
      mouseAlt.value = cartographic.height > 0 ? cartographic.height.toFixed(4) : '0.0000';
    }
  }, ScreenSpaceEventType.MOUSE_MOVE);

  emit('viewer-ready', viewer);
});

onUnmounted(() => {
  if (eventHandler) {
    eventHandler.destroy();
    eventHandler = null;
  }
});

const executeFlyTo = () => {
  if (!viewer) {
    return;
  }

  viewer.camera.flyTo({
    destination: Cartesian3.fromDegrees(104.06, 30.67, 12000),
    orientation: {
      heading: CesiumMath.toRadians(0.0),
      pitch: CesiumMath.toRadians(-35.0),
      roll: 0.0
    },
    duration: 6.5,
    complete: () => emit('fly-complete'),
    cancel: () => emit('fly-complete')
  });
};

defineExpose({
  executeFlyTo
});
</script>

<template>
  <div class="viewer-wrapper">
    <div ref="cesiumContainer" class="cesium-container"></div>
    <!-- 底部状态栏 -->
    <div class="bottom-status-bar">
      <!-- 左侧：地形控制 -->
      <div class="left-section">
        <label class="terrain-switch" @click.stop>
          <input type="checkbox" :checked="isTerrainEnabled" @change="toggleTerrain">
          <span class="slider"></span>
          <span class="switch-text">地形层</span>
        </label>
      </div>

      <!-- 右侧：经纬度、海拔、相机距离信息 -->
      <div class="right-section">
        <div class="coord-item">
          <span class="coord-label">海拔:</span>
          <span class="coord-value">{{ mouseAlt }} 米</span>
        </div>
        <div class="coord-item">
          <span class="coord-label">经度:</span>
          <span class="coord-value">{{ mouseLon }}</span>
        </div>
        <div class="coord-item">
          <span class="coord-label">纬度:</span>
          <span class="coord-value">{{ mouseLat }}</span>
        </div>
        <!-- 已移除与相机距离显示，按需求保留其他坐标信息 -->
      </div>
    </div>
  </div>
</template>

<style scoped>
.viewer-wrapper {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.cesium-container {
  width: 100%;
  height: 100%;
}

:deep(.cesium-viewer-bottom),
:deep(.cesium-widget-credits) {
  display: none !important;
}

/* 底部状态栏样式 */
.bottom-status-bar {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 36px;
  background: transparent; /* 取消蓝色背景 */
  backdrop-filter: none;
  border-top: none;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 20px;
  z-index: 100;
  pointer-events: none;
}

.left-section,
.right-section {
  display: flex;
  align-items: center;
  pointer-events: auto;
}

/* 坐标文本区 */
.right-section {
  gap: 20px;
  margin-right: 300px; /* 留出专属空间，防止与右下角水印文字重叠 */
}

.coord-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  color: #fff;
  font-size: 13px;
  letter-spacing: 0.5px;
}

.coord-label {
  color: #8be1ff;
  font-weight: 500;
}

.coord-value {
  text-shadow: 0 0 5px rgba(255, 255, 255, 0.4);
}

/* 开关样式 */
.terrain-switch {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.terrain-switch input {
  display: none;
}

.slider {
  position: relative;
  width: 38px;
  height: 20px;
  background-color: rgba(255, 255, 255, 0.2);
  border-radius: 20px;
  transition: 0.3s;
  box-shadow: inset 0 0 5px rgba(0, 0, 0, 0.5);
}

.slider:before {
  position: absolute;
  content: "";
  height: 14px;
  width: 14px;
  left: 3px;
  bottom: 3px;
  background-color: white;
  transition: 0.3s;
  border-radius: 50%;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
}

.terrain-switch input:checked + .slider {
  background-color: var(--sys-theme-color, #00e5ff);
  box-shadow: 0 0 8px rgba(0, 229, 255, 0.4);
}

.terrain-switch input:checked + .slider:before {
  transform: translateX(18px);
}

.switch-text {
  color: #8be1ff;
  font-size: 13px;
  font-weight: 500;
  user-select: none;
}
</style>
