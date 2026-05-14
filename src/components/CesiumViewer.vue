<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { Viewer, Cartesian3, createWorldTerrainAsync, EllipsoidTerrainProvider, Ion, ScreenSpaceEventHandler, ScreenSpaceEventType, Cartographic, Math as CesiumMath } from 'cesium';

// 配置你申请到的 Cesium Ion Token
Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJmMmQ4ZGIxOS0yOGIwLTQ4NDEtYTQ0MC1mYzUzNjEzYWVhOWEiLCJpZCI6MjQ1NzQxLCJpYXQiOjE3NzcwMTU4NDZ9.Ujdg5KDx6BmJdE70VPX-dhya_4r_xejd8LDibUuwwPY';

const cesiumContainer = ref<HTMLElement | null>(null);
let viewer: Viewer | null = null;
let handler: ScreenSpaceEventHandler | null = null;
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
      sceneModePicker: false,
      navigationHelpButton: false,
      creditContainer: document.createElement('div')
    });

    // Initial far view (dark space) replacing setView to 10000000
    viewer.camera.setView({
      destination: Cartesian3.fromDegrees(104.06, 30.67, 25000000),
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

defineExpose({
  executeFlyTo
});
</script>

<template>
  <div class="viewer-wrapper">
    <div ref="cesiumContainer" class="cesium-container"></div>
    
    <transition name="fade-coords">
      <div v-show="showCoordinates" class="coordinates-panel">
        <div class="coord-item">
          <span class="coord-label">经度</span>
          <span class="coord-value">{{ mousePosition.lon }}°</span>
        </div>
        <div class="coord-item">
          <span class="coord-label">纬度</span>
          <span class="coord-value">{{ mousePosition.lat }}°</span>
        </div>
        <div class="coord-item">
          <span class="coord-label">海拔</span>
          <span class="coord-value">{{ mousePosition.height }} m</span>
        </div>
      </div>
    </transition>
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
  bottom: 60px; /* 位置避免遮挡 bottom: 10px; right: 10px 的 logo */
  right: 15px;
  background: var(--sys-glass-bg, rgba(13, 27, 49, 0.7));
  border: 1px solid var(--sys-border-color, #00e5ff);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5), inset 0 0 10px rgba(0, 229, 255, 0.1);
  backdrop-filter: blur(8px);
  border-radius: 6px;
  padding: 8px 15px;
  display: flex;
  gap: 15px;
  z-index: 1000;
  pointer-events: none;
  font-family: "Microsoft YaHei", sans-serif;
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
