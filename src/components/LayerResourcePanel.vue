<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import * as Cesium from 'cesium';
import {
  activeTerrainSummary,
  deleteLayerResource,
  imageryResources,
  layerResourcesError,
  layerResourcesLoading,
  refreshLayerResources,
  setImageryAlpha,
  setImageryVisible,
  selectedTerrainResourceId,
  setSelectedTerrainResource,
  terrainResources,
  uploadLayerResourceZip,
  type ImageryResource,
  type LayerBounds,
  type TerrainResource
} from '../store/layerResourceStore';

const props = defineProps<{
  viewer?: Cesium.Viewer | null;
  visible: boolean;
  anchorLeft?: number;
  arrowLeft?: number;
}>();

type ResourceTab = 'terrain' | 'imagery';

const activeTab = ref<ResourceTab>('terrain');
const terrainFileInputRef = ref<HTMLInputElement | null>(null);
const imageryFileInputRef = ref<HTMLInputElement | null>(null);
const layerPanelRef = ref<HTMLElement | null>(null);
const uploadBusy = ref(false);
const panelStatus = ref('图层资源就绪');
const imageryLayerMap = new Map<string, Cesium.ImageryLayer>();
const panelDetached = ref(false);
const panelDragging = ref(false);
const panelPosition = ref({ x: 0, y: 0 });
let panelDragOffset = { x: 0, y: 0 };
let panelPointerId: number | null = null;

const terrainCountText = computed(() => `${terrainResources.value.length} 个地形`);
const imageryCountText = computed(() => `${imageryResources.value.length} 个影像`);
const terrainSourceText = computed(() => activeTerrainSummary.value);
const layerPanelAnchorStyle = computed(() => ({
  left: `${Number.isFinite(props.anchorLeft) ? props.anchorLeft : 0}px`,
  '--layer-panel-arrow-left': `${Number.isFinite(props.arrowLeft) ? props.arrowLeft : 15}px`
}));
const panelStyle = computed(() => {
  if (!panelDetached.value) return layerPanelAnchorStyle.value;
  return {
    left: `${panelPosition.value.x}px`,
    top: `${panelPosition.value.y}px`,
    right: 'auto',
    bottom: 'auto',
    zIndex: '10080'
  };
});

const clampPanelPosition = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const getPanelContainerRect = () => (
  layerPanelRef.value?.parentElement?.getBoundingClientRect() ?? { left: 0, top: 0 }
);

const movePanelTo = (clientX: number, clientY: number) => {
  const el = layerPanelRef.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const containerRect = getPanelContainerRect();
  const margin = 8;
  const maxX = Math.max(margin, window.innerWidth - rect.width - margin);
  const maxY = Math.max(margin, window.innerHeight - rect.height - margin);
  const nextViewportX = clampPanelPosition(clientX - panelDragOffset.x, margin, maxX);
  const nextViewportY = clampPanelPosition(clientY - panelDragOffset.y, margin, maxY);
  panelPosition.value = {
    x: nextViewportX - containerRect.left,
    y: nextViewportY - containerRect.top
  };
};

const handlePanelPointerMove = (event: PointerEvent) => {
  if (!panelDragging.value || panelPointerId !== event.pointerId) return;
  event.preventDefault();
  movePanelTo(event.clientX, event.clientY);
};

const handlePanelPointerUp = (event?: PointerEvent) => {
  if (event && panelPointerId !== event.pointerId) return;
  panelDragging.value = false;
  panelPointerId = null;
  window.removeEventListener('pointermove', handlePanelPointerMove);
  window.removeEventListener('pointerup', handlePanelPointerUp);
  window.removeEventListener('pointercancel', handlePanelPointerUp);
};

const handlePanelPointerDown = (event: PointerEvent) => {
  if (event.button !== 0) return;
  const el = layerPanelRef.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const containerRect = getPanelContainerRect();
  panelDetached.value = true;
  panelDragging.value = true;
  panelPointerId = event.pointerId;
  panelDragOffset = {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  };
  panelPosition.value = { x: rect.left - containerRect.left, y: rect.top - containerRect.top };
  (event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId);
  event.preventDefault();
  window.addEventListener('pointermove', handlePanelPointerMove, { passive: false });
  window.addEventListener('pointerup', handlePanelPointerUp);
  window.addEventListener('pointercancel', handlePanelPointerUp);
};

const handlePanelMouseMove = (event: MouseEvent) => {
  if (!panelDragging.value || panelPointerId !== -1) return;
  event.preventDefault();
  movePanelTo(event.clientX, event.clientY);
};

const handlePanelMouseUp = () => {
  if (panelPointerId !== -1) return;
  panelDragging.value = false;
  panelPointerId = null;
  window.removeEventListener('mousemove', handlePanelMouseMove);
  window.removeEventListener('mouseup', handlePanelMouseUp);
};

const handlePanelMouseDown = (event: MouseEvent) => {
  if (panelDragging.value || event.button !== 0) return;
  const el = layerPanelRef.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const containerRect = getPanelContainerRect();
  panelDetached.value = true;
  panelDragging.value = true;
  panelPointerId = -1;
  panelDragOffset = {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  };
  panelPosition.value = { x: rect.left - containerRect.left, y: rect.top - containerRect.top };
  event.preventDefault();
  window.addEventListener('mousemove', handlePanelMouseMove, { passive: false });
  window.addEventListener('mouseup', handlePanelMouseUp);
};

const resetPanelPosition = () => {
  panelDetached.value = false;
  panelDragging.value = false;
  panelPointerId = null;
  window.removeEventListener('pointermove', handlePanelPointerMove);
  window.removeEventListener('pointerup', handlePanelPointerUp);
  window.removeEventListener('pointercancel', handlePanelPointerUp);
  window.removeEventListener('mousemove', handlePanelMouseMove);
  window.removeEventListener('mouseup', handlePanelMouseUp);
};

const formatBounds = (bounds?: LayerBounds) => {
  if (!bounds) return '无范围';
  return `${bounds.west.toFixed(4)}, ${bounds.south.toFixed(4)} - ${bounds.east.toFixed(4)}, ${bounds.north.toFixed(4)}`;
};

const formatZoom = (resource: TerrainResource | ImageryResource) => {
  const minzoom = Number.isFinite(resource.minzoom) ? resource.minzoom : 0;
  const maxzoom = Number.isFinite(resource.maxzoom) ? resource.maxzoom : 0;
  return `${minzoom}-${maxzoom}`;
};

const sourceLabel = (source: TerrainResource['source']) => source === 'uploaded' ? '上传' : '内置';

const isZipFile = (file: File | undefined) => !!file && file.name.toLowerCase().endsWith('.zip');

const runUpload = async (kind: 'terrain' | 'imagery', event: Event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file || !isZipFile(file)) {
    panelStatus.value = '请选择 ZIP 切片包';
    return;
  }

  uploadBusy.value = true;
  panelStatus.value = kind === 'terrain' ? '正在上传地形切片...' : '正在上传影像切片...';
  try {
    await uploadLayerResourceZip(kind, file, file?.name.replace(/\.zip$/i, ''));
    panelStatus.value = kind === 'terrain' ? '地形切片已登记' : '影像切片已登记';
  } catch (error) {
    panelStatus.value = error instanceof Error ? error.message : '图层上传失败';
  } finally {
    uploadBusy.value = false;
  }
};

const flyToBounds = (bounds?: LayerBounds) => {
  if (!props.viewer || !bounds) {
    panelStatus.value = '地图尚未准备好';
    return;
  }
  props.viewer.camera.flyTo({
    destination: Cesium.Rectangle.fromDegrees(bounds.west, bounds.south, bounds.east, bounds.north)
  });
  panelStatus.value = '已定位到切片范围';
};

const makeImageryProvider = (resource: ImageryResource) => {
  const extension = (resource.extension || 'png').replace(/^\./, '');
  const baseUrl = resource.url.replace(/\/+$/, '');
  const rectangle = Cesium.Rectangle.fromDegrees(
    resource.bounds.west,
    resource.bounds.south,
    resource.bounds.east,
    resource.bounds.north
  );

  return new Cesium.UrlTemplateImageryProvider({
    url: `${baseUrl}/{z}/{x}/{y}.${extension}`,
    tilingScheme: new Cesium.WebMercatorTilingScheme(),
    rectangle,
    minimumLevel: resource.minzoom ?? 0,
    maximumLevel: resource.maxzoom ?? 18,
    credit: resource.name
  });
};

const removeImageryLayer = (resourceId: string) => {
  const layer = imageryLayerMap.get(resourceId);
  if (layer && props.viewer) {
    props.viewer.imageryLayers.remove(layer, false);
  }
  imageryLayerMap.delete(resourceId);
};

const ensureImageryLayer = (resource: ImageryResource) => {
  if (!props.viewer) return;
  let layer = imageryLayerMap.get(resource.id);
  if (!layer) {
    layer = props.viewer.imageryLayers.addImageryProvider(makeImageryProvider(resource));
    imageryLayerMap.set(resource.id, layer);
  }
  layer.show = !!resource.visible;
  layer.alpha = resource.alpha ?? 0.88;
};

const toggleImagery = (resource: ImageryResource) => {
  const nextVisible = !resource.visible;
  setImageryVisible(resource.id, nextVisible);
  panelStatus.value = nextVisible ? `已显示 ${resource.name}` : `已隐藏 ${resource.name}`;
};

const updateImageryAlpha = (resource: ImageryResource, event: Event) => {
  const target = event.target as HTMLInputElement;
  setImageryAlpha(resource.id, Number(target.value));
};

const toggleTerrainSelection = (resource: TerrainResource) => {
  const nextId = selectedTerrainResourceId.value === resource.id ? null : resource.id;
  setSelectedTerrainResource(nextId);
  panelStatus.value = nextId ? `已选择 ${resource.name}` : '已取消地形选择，使用 Cesium 全球地形';
};

const handleDelete = async (resource: TerrainResource | ImageryResource) => {
  if (resource.source !== 'uploaded') return;
  try {
    if (resource.kind === 'imagery') {
      removeImageryLayer(resource.id);
    } else if (selectedTerrainResourceId.value === resource.id) {
      setSelectedTerrainResource(null);
    }
    await deleteLayerResource(resource);
    panelStatus.value = `已删除 ${resource.name}`;
  } catch (error) {
    panelStatus.value = error instanceof Error ? error.message : '删除失败';
  }
};

watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      void refreshLayerResources();
    } else {
      resetPanelPosition();
    }
  },
  { immediate: true }
);

watch(
  imageryResources,
  (resources) => {
    const ids = new Set(resources.map((resource) => resource.id));
    Array.from(imageryLayerMap.keys()).forEach((id) => {
      if (!ids.has(id)) {
        removeImageryLayer(id);
      }
    });
    resources.forEach((resource) => {
      if (resource.visible) {
        ensureImageryLayer(resource);
      } else {
        removeImageryLayer(resource.id);
      }
    });
  },
  { deep: true }
);

onBeforeUnmount(() => {
  resetPanelPosition();
  Array.from(imageryLayerMap.keys()).forEach(removeImageryLayer);
});
</script>

<template>
  <transition name="layer-panel">
    <section
      v-if="visible"
      ref="layerPanelRef"
      class="layer-resource-panel"
      :class="{ 'is-detached': panelDetached, dragging: panelDragging }"
      :style="panelStyle"
      @pointerdown.stop
      @mousedown.stop
      @click.stop
    >
      <header
        class="layer-panel-head drag-handle"
        title="按住拖动面板，双击恢复默认位置"
        @pointerdown="handlePanelPointerDown"
        @mousedown="handlePanelMouseDown"
        @dblclick="resetPanelPosition"
      >
        <div>
          <strong>图层资源</strong>
          <span>{{ terrainSourceText }}</span>
        </div>
        <span class="drag-badge">拖拽</span>
      </header>

      <div class="layer-tabs" role="tablist" aria-label="图层资源分类">
        <button type="button" :class="{ active: activeTab === 'terrain' }" @click="activeTab = 'terrain'">地形切片</button>
        <button type="button" :class="{ active: activeTab === 'imagery' }" @click="activeTab = 'imagery'">影像切片</button>
      </div>

      <div v-if="activeTab === 'terrain'" class="layer-panel-body">
        <div class="resource-toolbar">
          <button type="button" class="primary-btn" :disabled="uploadBusy" @click="terrainFileInputRef?.click()">上传地形 ZIP</button>
          <span>{{ terrainCountText }}</span>
          <input ref="terrainFileInputRef" class="hidden-input" type="file" accept=".zip" @change="runUpload('terrain', $event)" />
        </div>

        <div class="resource-list">
          <article v-for="resource in terrainResources" :key="resource.id" class="resource-row" :class="{ active: resource.id === selectedTerrainResourceId }">
            <div class="resource-main">
              <div class="resource-title">
                <strong>{{ resource.name }}</strong>
                <span>{{ sourceLabel(resource.source) }}</span>
              </div>
              <p>{{ formatBounds(resource.bounds) }}</p>
              <small>层级 {{ formatZoom(resource) }} · {{ resource.format || 'terrain' }}</small>
            </div>
            <div class="resource-actions">
              <label class="mini-toggle" title="使用此地形切片">
                <input type="checkbox" :checked="resource.id === selectedTerrainResourceId" @change="toggleTerrainSelection(resource)" />
                <span>使用</span>
              </label>
              <button type="button" @click="flyToBounds(resource.bounds)">定位</button>
              <button v-if="resource.source === 'uploaded'" type="button" class="danger" @click="handleDelete(resource)">删除</button>
            </div>
          </article>
        </div>
      </div>

      <div v-if="activeTab === 'imagery'" class="layer-panel-body">
        <div class="resource-toolbar">
          <button type="button" class="primary-btn" :disabled="uploadBusy" @click="imageryFileInputRef?.click()">上传影像 ZIP</button>
          <span>{{ imageryCountText }}</span>
          <input ref="imageryFileInputRef" class="hidden-input" type="file" accept=".zip" @change="runUpload('imagery', $event)" />
        </div>

        <div class="resource-list">
          <article v-for="resource in imageryResources" :key="resource.id" class="resource-row" :class="{ active: resource.visible }">
            <div class="resource-main">
              <div class="resource-title">
                <strong>{{ resource.name }}</strong>
                <span>{{ sourceLabel(resource.source) }}</span>
              </div>
              <p>{{ formatBounds(resource.bounds) }}</p>
              <small>层级 {{ formatZoom(resource) }} · {{ resource.format || 'imagery' }}</small>
            </div>
            <div class="resource-actions imagery-actions">
              <button type="button" @click="toggleImagery(resource)">{{ resource.visible ? '隐藏' : '显示' }}</button>
              <label class="alpha-control" title="影像透明度">
                <span>{{ Math.round((resource.alpha ?? 0.88) * 100) }}%</span>
                <input type="range" min="0" max="1" step="0.05" :value="resource.alpha ?? 0.88" @input="updateImageryAlpha(resource, $event)" />
              </label>
              <button type="button" @click="flyToBounds(resource.bounds)">定位</button>
              <button v-if="resource.source === 'uploaded'" type="button" class="danger" @click="handleDelete(resource)">删除</button>
            </div>
          </article>
        </div>
      </div>

      <footer class="layer-panel-foot" :class="{ error: !!layerResourcesError }">
        <span v-if="layerResourcesLoading">正在同步资源...</span>
        <span v-else>{{ layerResourcesError || panelStatus }}</span>
      </footer>
    </section>
  </transition>
</template>

<style scoped>
.layer-resource-panel {
  position: absolute;
  left: 0;
  bottom: calc(100% + 10px);
  width: min(460px, calc(100vw - 24px));
  max-height: min(620px, calc(100vh - 96px));
  display: flex;
  flex-direction: column;
  border: 1px solid rgba(0, 229, 255, 0.34);
  border-radius: 6px;
  background:
    linear-gradient(180deg, rgba(8, 31, 48, 0.94), rgba(5, 18, 31, 0.96)),
    rgba(5, 18, 31, 0.95);
  color: #dffbff;
  box-shadow: 0 18px 42px rgba(0, 0, 0, 0.42), inset 0 1px 0 rgba(255, 255, 255, 0.05);
  backdrop-filter: blur(14px);
  pointer-events: auto;
  overflow: hidden;
}

.layer-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 12px 12px 10px;
  border-bottom: 1px solid rgba(0, 229, 255, 0.16);
}

.layer-panel-head div {
  min-width: 0;
  display: grid;
  gap: 3px;
}

.layer-panel-head strong {
  font-size: 15px;
}

.layer-panel-head span,
.resource-toolbar span,
.resource-main small,
.resource-main p,
.layer-panel-foot {
  color: rgba(210, 239, 248, 0.72);
  font-size: 12px;
}

.icon-btn {
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid rgba(125, 233, 247, 0.18);
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.04);
  color: #bfeef7;
  cursor: pointer;
}

.icon-btn svg {
  width: 16px;
  height: 16px;
}

.icon-btn path {
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
}

.layer-tabs {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1px;
  padding: 8px 10px 0;
}

.layer-tabs button,
.resource-actions button,
.primary-btn {
  min-height: 28px;
  border: 1px solid rgba(125, 233, 247, 0.18);
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.045);
  color: #cfeef6;
  font-size: 12px;
  cursor: pointer;
  transition: background-color 0.16s ease, border-color 0.16s ease, color 0.16s ease;
}

.layer-tabs button.active,
.primary-btn {
  border-color: rgba(0, 229, 255, 0.48);
  background: rgba(0, 179, 204, 0.18);
  color: #f4feff;
}

.layer-tabs button:hover,
.resource-actions button:hover,
.primary-btn:hover:not(:disabled) {
  border-color: rgba(0, 229, 255, 0.42);
  background: rgba(0, 229, 255, 0.12);
}

.layer-panel-body {
  min-height: 0;
  padding: 10px;
  overflow: auto;
}

.resource-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}

.primary-btn:disabled {
  opacity: 0.56;
  cursor: progress;
}

.hidden-input {
  display: none;
}

.resource-list {
  display: grid;
  gap: 8px;
}

.resource-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
  padding: 9px;
  border: 1px solid rgba(125, 233, 247, 0.12);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.035);
}

.resource-row.active {
  border-color: rgba(0, 229, 255, 0.42);
  background: rgba(0, 179, 204, 0.1);
}

.resource-main {
  min-width: 0;
  display: grid;
  gap: 4px;
}

.resource-title {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
}

.resource-title strong {
  min-width: 0;
  overflow: hidden;
  color: #f1fdff;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.resource-title span {
  flex: 0 0 auto;
  padding: 1px 5px;
  border: 1px solid rgba(0, 229, 255, 0.22);
  border-radius: 4px;
  color: #9eeaf5;
  font-size: 10px;
}

.resource-main p {
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.resource-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-content: start;
  gap: 6px;
  max-width: 154px;
}

.resource-actions button {
  padding: 0 8px;
}

.resource-actions .danger {
  border-color: rgba(255, 107, 107, 0.32);
  color: #ffc7c7;
}

.mini-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 28px;
  padding: 0 7px;
  border: 1px solid rgba(125, 233, 247, 0.18);
  border-radius: 5px;
  color: #cfeef6;
  font-size: 12px;
}

.mini-toggle input {
  width: 13px;
  height: 13px;
  accent-color: #00e5ff;
}

.imagery-actions {
  max-width: 178px;
}

.alpha-control {
  display: grid;
  grid-template-columns: 34px 1fr;
  align-items: center;
  gap: 5px;
  width: 100%;
  color: #cfeef6;
  font-size: 11px;
}

.alpha-control input {
  width: 100%;
  accent-color: #00e5ff;
}

.layer-panel-foot {
  min-height: 32px;
  padding: 8px 12px;
  border-top: 1px solid rgba(0, 229, 255, 0.12);
}

.layer-panel-foot.error {
  color: #ffc7c7;
}

.layer-panel-enter-active,
.layer-panel-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.layer-panel-enter-from,
.layer-panel-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

@media (max-width: 720px) {
  .layer-resource-panel {
    width: calc(100vw - 20px);
  }

  .resource-row {
    grid-template-columns: 1fr;
  }

  .resource-actions {
    max-width: none;
    justify-content: flex-start;
  }
}

/* Match the compact bottom-toolbar flyout language used by BasicFunctionsPanel. */
.layer-resource-panel {
  bottom: calc(100% + 14px);
  width: min(390px, calc(100vw - 24px));
  max-height: calc(100vh - 82px);
  gap: 8px;
  padding: 11px;
  border: 1px solid var(--sys-border-color);
  border-radius: 6px;
  background: var(--sys-glass-bg);
  box-shadow: inset 0 0 16px var(--sys-border-color-light), 0 8px 24px rgba(0, 0, 0, 0.34);
  backdrop-filter: blur(10px);
  overflow: visible;
}

.layer-resource-panel::before {
  content: '';
  position: absolute;
  top: 0;
  left: 14px;
  right: 14px;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(0, 229, 255, 0.52), transparent);
}

.layer-resource-panel::after {
  content: '';
  position: absolute;
  left: var(--layer-panel-arrow-left, 15px);
  bottom: -5px;
  width: 10px;
  height: 10px;
  border-right: 1px solid rgba(0, 229, 255, 0.34);
  border-bottom: 1px solid rgba(0, 229, 255, 0.34);
  background: rgba(13, 27, 49, 0.92);
  transform: rotate(45deg);
}

.layer-panel-head {
  position: relative;
  padding: 7px 36px 7px 25px;
  border: 1px solid var(--sys-border-color-light);
  border-radius: 6px;
  background: linear-gradient(90deg, rgba(0, 229, 255, 0.08), transparent 100%);
  min-height: 38px;
  cursor: grab;
  user-select: none;
}

.layer-panel-head::before {
  content: '';
  position: absolute;
  left: 9px;
  top: 50%;
  width: 7px;
  height: 7px;
  border: 1px solid rgba(0, 229, 255, 0.72);
  border-radius: 50%;
  transform: translateY(-50%);
  box-shadow: 0 0 8px rgba(0, 229, 255, 0.4);
}

.layer-panel-head strong {
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.03em;
}

.layer-panel-head span {
  max-width: 260px;
  overflow: hidden;
  color: #9fb4bf;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.drag-badge {
  position: absolute;
  top: 7px;
  right: 8px;
  padding: 2px 5px;
  border: 1px solid rgba(0, 229, 255, 0.28);
  border-radius: 4px;
  background: rgba(0, 229, 255, 0.08);
  color: #9eeaf5;
  font-size: 10px;
  line-height: 1.2;
}

.layer-resource-panel.dragging {
  user-select: none;
  box-shadow: inset 0 0 18px rgba(0, 229, 255, 0.18), 0 12px 30px rgba(0, 0, 0, 0.42);
}

.layer-resource-panel.dragging .layer-panel-head {
  cursor: grabbing;
}

.layer-resource-panel.is-detached {
  bottom: auto;
  transform: none;
}

.layer-resource-panel.is-detached::after {
  display: none;
}

.layer-tabs {
  gap: 6px;
  padding: 0;
}

.layer-tabs button,
.resource-actions button,
.primary-btn {
  min-height: 26px;
  border-color: var(--sys-border-color-light);
  background: rgba(5, 21, 34, 0.54);
  font-size: 11px;
}

.layer-panel-body {
  min-height: 0;
  max-height: min(390px, calc(100vh - 230px));
  padding: 0;
  overflow-x: hidden;
  overflow-y: auto;
  scrollbar-color: rgba(100, 213, 228, 0.42) rgba(0, 0, 0, 0.12);
  scrollbar-width: thin;
}

.layer-panel-body::-webkit-scrollbar {
  width: 5px;
}

.layer-panel-body::-webkit-scrollbar-track {
  background: rgba(0, 0, 0, 0.12);
}

.layer-panel-body::-webkit-scrollbar-thumb {
  border-radius: 3px;
  background: rgba(100, 213, 228, 0.42);
}

.resource-toolbar {
  margin-bottom: 8px;
  padding: 0 1px;
}

.resource-toolbar span,
.resource-main small,
.resource-main p,
.layer-panel-foot {
  font-size: 11px;
}

.resource-list {
  gap: 7px;
}

.resource-row {
  grid-template-columns: 1fr;
  gap: 7px;
  padding: 8px;
  border-color: var(--sys-border-color-light);
  background: rgba(255, 255, 255, 0.025);
}

.resource-title strong {
  font-size: 12px;
}

.resource-actions,
.imagery-actions {
  max-width: none;
  justify-content: flex-start;
  gap: 5px;
}

.resource-actions button {
  min-height: 24px;
  padding: 0 7px;
}

.mini-toggle {
  height: 24px;
  padding: 0 6px;
  border-color: var(--sys-border-color-light);
  font-size: 11px;
}

.layer-panel-foot {
  min-height: 24px;
  padding: 6px 8px 0;
  border-top: 1px solid rgba(0, 229, 255, 0.1);
  color: #9fb4bf;
}

.layer-panel-foot.error {
  color: #ffb8b8;
}
</style>
