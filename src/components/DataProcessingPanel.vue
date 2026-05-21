<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue';
import * as Cesium from 'cesium';
import FloodLoader from './FloodLoader.vue';
import StyledFileInput from './StyledFileInput.vue';

const props = defineProps<{
  isSimulating?: boolean;
  viewer?: Cesium.Viewer | null;
}>();

const emit = defineEmits<{
  (e: 'start-simulation'): void;
  (e: 'menu-select', id: string): void;
}>();

type MenuChild = { id: string; name: string };
type MenuGroup = { name: string; expanded: boolean; children: MenuChild[] };

const activeItem = ref<string | null>(null);
const convertFile = ref<File | null>(null);
const convertLoading = ref(false);
const convertMessage = ref('');
const convertError = ref('');
const roughnessFile = ref<File | null>(null);
const roughnessTifFile = ref<File | null>(null);
const roughnessShowBounds = ref(false);
const roughnessLoading = ref(false);
const roughnessMessage = ref('');
const roughnessError = ref('');
const asciiFile = ref<File | null>(null);
const asciiTifFile = ref<File | null>(null);
const lineTxtFile = ref<File | null>(null);
const rowcolLoading = ref(false);
const rowcolMessage = ref('');
const rowcolError = ref('');

const files = ref<{ dem: File | null; cao: File | null; river: File | null }>({
  dem: null,
  cao: null,
  river: null
});
const message = ref('');
const outputPath = ref('');

const handleFileChange = (event: Event, type: 'dem' | 'cao' | 'river') => {
  const target = event.target as HTMLInputElement;
  files.value[type] = target.files?.[0] ?? null;
};

const uploadAllFiles = async () => {
  if (!files.value.dem || !files.value.cao || !files.value.river) {
    message.value = '❌ 请上传全部文件';
    return;
  }

  const formData = new FormData();
  formData.append('dem', files.value.dem);
  formData.append('cao', files.value.cao);
  formData.append('river', files.value.river);
  if (outputPath.value) {
    formData.append('outputPath', outputPath.value);
  }

  message.value = '🚀 模拟中...（30~60秒）';

  try {
    const response = await fetch('/api/upload-all', {
      method: 'POST',
      body: formData
    });

    const text = await response.text();
    if (!response.ok) throw new Error(text);
    
    message.value = text;

    await downloadZip();

  } catch (error) {
    const errorText = error instanceof Error ? error.message : String(error);
    message.value = `❌ 请求出错: ${errorText}`;
  }
};

const downloadZip = async () => {
  message.value = '📦 正在打包并下载计算结果...';

  try {
    const res = await fetch('/api/download');
    
    if (!res.ok) {
      throw new Error(`下载失败 (状态码: ${res.status})`);
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = 'result.zip';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    URL.revokeObjectURL(url);
    
    message.value = '✅ 模拟结束且下载完成！';
  } catch (error) {
    const errorText = error instanceof Error ? error.message : String(error);
    message.value = `❌ 下载结果失败: ${errorText}`;
  }
};

const boundsEntities = ref<Cesium.Entity[]>([]);
let drawingScriptReady = false;

declare global {
  interface Window {
    Cesium: typeof Cesium;
    cesiumViewer?: Cesium.Viewer;
    drawingModule?: {
      init?: () => void;
      loadFromTxt?: (text: string) => void;
      initializeDrawingEventListeners?: () => void;
      exportLineTerrainDataTXT?: () => void;
      checkAllTilesExist?: () => void;
      calculateAllIntermediatePoints?: () => void;
    };
    exportLineTerrainDataTXT?: () => void;
    checkAllTilesExist?: () => void;
    calculateAllIntermediatePoints?: () => void;
    __handleAsciiFileChange?: (event: Event) => void;
    __handleAsciiTifFileChange?: (event: Event) => void;
    __handleLineTxtFileChange?: (event: Event) => void;
    __handleRowcolSubmit?: () => Promise<void>;
  }
}

const menuItems = ref<MenuGroup[]>([
  {
    name: '数据处理',
    expanded: true,
    children: [
      { id: 'tif2asc', name: '格式转换' },
      { id: 'roughness', name: '粗糙度计算' },
      { id: 'rowcol', name: '获取 ASC 行列号' },
      { id: 'draw', name: '地形工具' }
    ]
  },
  {
    name: '模拟',
    expanded: true,
    children: [
      { id: 'params', name: '输出水深与json' },
      { id: 'run', name: '水深转json' }
    ]
  },
  {
    name: '渲染洪水',
    expanded: true,
    children: [
      { id: 'render-flood', name: '渲染洪水数据' }
    ]
  }
]);

const toggleGroup = (index: number) => {
  menuItems.value[index].expanded = !menuItems.value[index].expanded;
};

const selectItem = (id: string) => {
  activeItem.value = id;
  emit('menu-select', id);

  if (id === 'draw') {
    nextTick(async () => {
      await ensureDrawingModuleReady();
      window.drawingModule?.initializeDrawingEventListeners?.();
    });
  }
};

const isToolPanelActive = (id: string | null) => {
  return id === 'tif2asc' || id === 'roughness' || id === 'rowcol' || id === 'draw';
};

const getActiveItemName = () => {
  for (const group of menuItems.value) {
    const found = group.children.find((child) => child.id === activeItem.value);
    if (found) {
      return found.name;
    }
  }
  return '';
};

const handleStartClick = () => {
  emit('start-simulation');
};

const fetchAndDisplayTiffBounds = async (file: File) => {
  try {
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch('http://localhost:5000/get_tiff_bounds', {
      method: 'POST',
      body: formData
    });
    const result = await response.json();
    if (result.success && result.bounds) {
      displayBoundsOnMap(result.bounds);
    }
  } catch (error) {
    console.error('Failed to get TIFF bounds', error);
  }
};

const triggerDownload = (url: string, filename?: string) => {
  // If we just want to download a file with Content-Disposition: attachment, we can just navigate to the URL
  // This bypasses popup blockers perfectly for attachment files
  const link = document.createElement('a');
  link.style.display = 'none';
  link.href = url;
  if (filename) {
    link.download = filename;
  }
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    document.body.removeChild(link);
  }, 100);
};

const handleConvertFileChange = async (event: Event) => {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0] ?? null;
  convertFile.value = file;
  
  if (file && (file.name.toLowerCase().endsWith('.tif') || file.name.toLowerCase().endsWith('.tiff'))) {
    await fetchAndDisplayTiffBounds(file);
  }
};

const handleConvertSubmit = async () => {
  if (!convertFile.value || convertLoading.value) {
    return;
  }

  convertLoading.value = true;
  convertMessage.value = '';
  convertError.value = '';

  try {
    const formData = new FormData();
    formData.append('file', convertFile.value);

    const response = await fetch('http://localhost:5000/convert', {
      method: 'POST',
      body: formData
    });

    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.message || 'Convert failed');
    }

    convertMessage.value = result.message || 'Convert finished';

    if (result.download_url) {
      const downloadUrl = `http://localhost:5000${result.download_url}`;
      triggerDownload(downloadUrl);
    }
  } catch (error) {
    convertError.value = error instanceof Error ? error.message : 'Convert failed';
  } finally {
    convertLoading.value = false;
  }
};

const handleRoughnessFileChange = async (event: Event) => {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0] ?? null;
  roughnessFile.value = file;
  
  if (file && (file.name.toLowerCase().endsWith('.tif') || file.name.toLowerCase().endsWith('.tiff'))) {
    await fetchAndDisplayTiffBounds(file);
  }
};

const handleRoughnessTifFileChange = async (event: Event) => {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0] ?? null;
  roughnessTifFile.value = file;
  
  if (file && (file.name.toLowerCase().endsWith('.tif') || file.name.toLowerCase().endsWith('.tiff'))) {
    await fetchAndDisplayTiffBounds(file);
  }
};

const handleRoughnessSubmit = async () => {
  if (!roughnessFile.value || roughnessLoading.value) {
    return;
  }

  roughnessLoading.value = true;
  roughnessMessage.value = '';
  roughnessError.value = '';

  try {
    const formData = new FormData();
    formData.append('file', roughnessFile.value);
    if (roughnessTifFile.value) {
      formData.append('tif_file', roughnessTifFile.value);
    }
    formData.append('show_bounds', roughnessShowBounds.value ? 'true' : 'false');

    const response = await fetch('http://localhost:5000/roughness', {
      method: 'POST',
      body: formData
    });

    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.message || 'Roughness calculation failed');
    }

    roughnessMessage.value = result.message || 'Roughness calculation finished';

    if (roughnessShowBounds.value && result.bounds) {
      displayBoundsOnMap(result.bounds);
    }

    if (result.download_url) {
      const downloadUrl = `http://localhost:5000${result.download_url}`;
      triggerDownload(downloadUrl);
    }
  } catch (error) {
    roughnessError.value = error instanceof Error ? error.message : 'Roughness calculation failed';
  } finally {
    roughnessLoading.value = false;
  }
};

const gttDemPath = ref('D:/Chain1/gtt/TXT/dem.asc');
const gttDepthDir = ref('D:/Chain1/gtt/TXT');
const gttOutputDir = ref('D:/Chain1/gtt/JSON');
const gttRunning = ref(false);
const gttMessage = ref('');

const pickPath = async (type: 'file' | 'dir', field: 'dem' | 'depth' | 'output') => {
  try {
    const response = await fetch('http://localhost:5000/api/choose-path', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type })
    });
    const result = await response.json();
    if (result.success && result.path) {
      const normalizedPath = result.path.replace(/\\/g, '/');
      if (field === 'dem') gttDemPath.value = normalizedPath;
      if (field === 'depth') gttDepthDir.value = normalizedPath;
      if (field === 'output') gttOutputDir.value = normalizedPath;
    }
  } catch (err: any) {
    console.error('Picker error:', err);
  }
};

const runGridToTin = async () => {
  gttRunning.value = true;
  gttMessage.value = '转换中...';
  try {
    const response = await fetch('http://localhost:5000/api/grid-to-tin', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        dem: gttDemPath.value,
        depth_dir: gttDepthDir.value,
        output_dir: gttOutputDir.value
      })
    });

    if (!response.body) {
      throw new Error('没有响应数据');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let done = false;
    let buffer = '';

    while (!done) {
      const { value, done: doneReading } = await reader.read();
      done = doneReading;
      if (value) {
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const data = JSON.parse(line);
            gttMessage.value = data.message;
            if (!data.success && !data.message.includes('✅')) {
              gttMessage.value = `❌ ${data.message}`;
            }
          } catch (e) {
            console.error('JSON parse error:', e, line);
          }
        }
      }
    }
  } catch (err: any) {
    gttMessage.value = `❌ 网络请求失败: ${err.message}`;
  } finally {
    gttRunning.value = false;
  }
};

const handleAsciiFileChange = (event: Event) => {
  const target = event.target as HTMLInputElement;
  asciiFile.value = target.files?.[0] ?? null;
};

const handleAsciiTifFileChange = async (event: Event) => {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0] ?? null;
  asciiTifFile.value = file;
  
  if (file && (file.name.toLowerCase().endsWith('.tif') || file.name.toLowerCase().endsWith('.tiff'))) {
    await fetchAndDisplayTiffBounds(file);
  }
};

const handleLineTxtFileChange = (event: Event) => {
  const target = event.target as HTMLInputElement;
  lineTxtFile.value = target.files?.[0] ?? null;
};

const parseCoordinatesFromTxt = (txtContent: string): Array<{ lon: number; lat: number }> => {
  const coordinates: Array<{ lon: number; lat: number }> = [];
  const lines = txtContent.split('\n');
  let currentLon: number | null = null;
  let currentLat: number | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const lonMatch = line.match(/(?:^|\s)(?:lon|longitude)\s*[:=]\s*(-?\d+(?:\.\d+)?)/i);
    if (lonMatch) {
      currentLon = Number(lonMatch[1]);
    }

    const latMatch = line.match(/(?:^|\s)(?:lat|latitude)\s*[:=]\s*(-?\d+(?:\.\d+)?)/i);
    if (latMatch) {
      currentLat = Number(latMatch[1]);
    }

    if (currentLon !== null && currentLat !== null) {
      if (
        Number.isFinite(currentLon) &&
        Number.isFinite(currentLat) &&
        currentLon >= -180 &&
        currentLon <= 180 &&
        currentLat >= -90 &&
        currentLat <= 90
      ) {
        coordinates.push({ lon: currentLon, lat: currentLat });
      }
      currentLon = null;
      currentLat = null;
    }
  }

  return coordinates;
};

const handleRowcolSubmit = async () => {
  if (!asciiFile.value || !lineTxtFile.value || rowcolLoading.value) {
    return;
  }

  rowcolLoading.value = true;
  rowcolMessage.value = '';
  rowcolError.value = '';

  try {
    const txtContent = await lineTxtFile.value.text();
    const coordinates = parseCoordinatesFromTxt(txtContent);
    if (!coordinates.length) {
      throw new Error('未能从画线 TXT 中解析到坐标（需要 lon/lat 或每行经纬度）');
    }

    const formData = new FormData();
    formData.append('ascii_file', asciiFile.value);
    if (asciiTifFile.value) {
      formData.append('tif_file', asciiTifFile.value);
    }
    formData.append('coordinates', JSON.stringify(coordinates));

    const response = await fetch('http://localhost:5000/get_ascii_values', {
      method: 'POST',
      body: formData
    });

    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.message || 'Get ASCII Row/Col failed');
    }

    rowcolMessage.value = result.message || `成功获取 ${coordinates.length} 个坐标点行列号`;

    if (result.download_url) {
      const downloadUrl = `http://localhost:5000${result.download_url}`;
      triggerDownload(downloadUrl);
    }
  } catch (error) {
    rowcolError.value = error instanceof Error ? error.message : 'Get ASCII Row/Col failed';
  } finally {
    rowcolLoading.value = false;
  }
};

void handleAsciiFileChange;
void handleAsciiTifFileChange;
void handleLineTxtFileChange;
void handleRowcolSubmit;

const _rowcolHandlerRefs = [
  handleAsciiFileChange,
  handleAsciiTifFileChange,
  handleLineTxtFileChange,
  handleRowcolSubmit
];
void _rowcolHandlerRefs;

const clearBoundsOnMap = () => {
  if (!props.viewer) {
    return;
  }

  boundsEntities.value.forEach((entity) => {
    props.viewer?.entities.remove(entity);
  });
  boundsEntities.value = [];
};

const displayBoundsOnMap = (bounds: { boundary_points?: number[][]; coordinates?: number[][] }) => {
  if (!props.viewer) {
    roughnessError.value = 'Cesium viewer is not ready';
    return;
  }

  clearBoundsOnMap();

  const coordinates = bounds.boundary_points?.length ? bounds.boundary_points : bounds.coordinates;
  if (!coordinates || !coordinates.length) {
    return;
  }

  const positions = coordinates
    .filter((coord) => Array.isArray(coord) && coord.length >= 2)
    .map((coord) => Cesium.Cartesian3.fromDegrees(coord[0], coord[1], 0));

  if (positions.length < 2) {
    return;
  }

  const first = positions[0];
  const last = positions[positions.length - 1];
  if (Cesium.Cartesian3.distance(first, last) > 1.0) {
    positions.push(Cesium.Cartesian3.clone(first));
  }

  const polygonEntity = props.viewer.entities.add({
    name: 'ASCII Boundary Polygon',
    polygon: {
      hierarchy: positions,
      material: Cesium.Color.RED.withAlpha(0.0),
      outline: true,
      outlineColor: Cesium.Color.RED,
      outlineWidth: 3
    }
  });

  const polylineEntity = props.viewer.entities.add({
    name: 'ASCII Boundary Line',
    polyline: {
      positions,
      width: 3,
      material: Cesium.Color.RED,
      clampToGround: true
    }
  });

  boundsEntities.value.push(polygonEntity, polylineEntity);
  props.viewer.flyTo(polylineEntity, { duration: 1.2 });
};

const ensureDrawingScriptLoaded = async () => {
  if (drawingScriptReady) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const scriptSrc = '/src/新建文件夹/huaxian.js';
    const existed = document.querySelector(`script[src="${scriptSrc}"]`) as HTMLScriptElement | null;
    if (existed) {
      drawingScriptReady = true;
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = scriptSrc;
    script.async = false;
    script.onload = () => {
      drawingScriptReady = true;
      resolve();
    };
    script.onerror = () => reject(new Error('Failed to load huaxian.js'));
    document.body.appendChild(script);
  });
};

const ensureDrawingModuleReady = async () => {
  window.Cesium = Cesium;
  if (props.viewer) {
    window.cesiumViewer = props.viewer;
  }

  await ensureDrawingScriptLoaded();
  window.drawingModule?.init?.();
};

const handleExportLineTerrainDataTXT = () => {
  window.exportLineTerrainDataTXT?.();
};

const handleCheckAllTilesExist = () => {
  window.checkAllTilesExist?.();
};

const handleCalculateAllIntermediatePoints = () => {
  window.calculateAllIntermediatePoints?.();
};

watch(
  () => props.viewer,
  async (viewer) => {
    if (!viewer) {
      return;
    }
    window.Cesium = Cesium;
    window.cesiumViewer = viewer;
    if (activeItem.value === 'draw') {
      await ensureDrawingModuleReady();
      window.drawingModule?.initializeDrawingEventListeners?.();
    }
  },
  { immediate: true }
);

onMounted(async () => {
  window.Cesium = Cesium;
  if (props.viewer) {
    window.cesiumViewer = props.viewer;
  }
  window.__handleAsciiFileChange = handleAsciiFileChange;
  window.__handleAsciiTifFileChange = handleAsciiTifFileChange;
  window.__handleLineTxtFileChange = handleLineTxtFileChange;
  window.__handleRowcolSubmit = handleRowcolSubmit;
});
</script>

<template>
  <div class="flood-simulation-page">
    <div class="tree-menu-container">
      <h3 class="menu-title">导航菜单</h3>
      <div class="tree-content">
        <div v-for="(item, index) in menuItems" :key="index" class="menu-group">
          <div class="menu-header" @click="toggleGroup(index)">
            <span class="arrow" :class="{ expanded: item.expanded }">▶</span>
            <span class="group-name">{{ item.name }}</span>
          </div>

          <div class="menu-children" v-show="item.expanded">
            <div
              v-for="(child, childIndex) in item.children"
              :key="childIndex"
              class="menu-item"
              :class="{ active: activeItem === child.id }"
              @click="selectItem(child.id)"
            >
              {{ child.name }}
            </div>

            <div v-if="item.name === '模拟'">
              <div
                class="menu-item"
                :style="{ cursor: props.isSimulating ? 'not-allowed' : 'pointer', opacity: props.isSimulating ? 0.7 : 1 }"
                @click="!props.isSimulating && handleStartClick()"
              >
                {{ props.isSimulating ? '模拟中...' : '开始模拟' }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <Teleport to="body">
      <div v-if="isToolPanelActive(activeItem)" class="tool-panel">
        <div v-show="activeItem === 'tif2asc'" class="tool-block">
        <h5>1. 格式转换</h5>
        <form id="convertForm" enctype="multipart/form-data" @submit.prevent="handleConvertSubmit">
          <div class="form-group">
            <label class="form-label" for="convertFile">选择 TIFF 文件</label>
            <StyledFileInput
              input-id="convertFile"
              name="file"
              accept=".tif,.tiff"
              button-text="选择 TIFF"
              placeholder="未选择 TIFF 文件"
              required
              @change="handleConvertFileChange"
            />
          </div>
          <button type="submit" class="btn btn-primary" :disabled="convertLoading">
            {{ convertLoading ? '转换中...' : '转换为 ASC' }}
          </button>
          <p v-if="convertMessage" class="result-text">{{ convertMessage }}</p>
          <p v-if="convertError" class="error-text">{{ convertError }}</p>
        </form>
      </div>

      <div v-show="activeItem === 'roughness'" class="tool-block">
        <h5>2. 粗糙度计算</h5>
        <form id="roughnessForm" enctype="multipart/form-data" @submit.prevent="handleRoughnessSubmit">
          <div class="form-group">
            <label class="form-label" for="roughnessFile">选择 ASC/TXT 文件</label>
            <StyledFileInput
              input-id="roughnessFile"
              name="file"
              accept=".asc,.txt,.tif,.tiff"
              button-text="选择文件"
              placeholder="未选择 ASC/TXT 文件"
              required
              @change="handleRoughnessFileChange"
            />
          </div>
          <div class="form-group">
            <label class="form-label" for="roughnessTifFile">选择 TIF 文件（用于识别经纬度）</label>
            <StyledFileInput
              input-id="roughnessTifFile"
              name="tif_file"
              accept=".tif,.tiff"
              button-text="选择 TIF"
              placeholder="未选择 TIF 文件"
              @change="handleRoughnessTifFileChange"
            />
          </div>
          <label class="form-check-label">
            <input v-model="roughnessShowBounds" type="checkbox" name="show_bounds" value="true">
            显示 ASCII 边界
          </label>
          <button type="submit" class="btn btn-primary" :disabled="roughnessLoading">
            {{ roughnessLoading ? '计算中...' : '计算粗糙度' }}
          </button>
          <p v-if="roughnessMessage" class="result-text">{{ roughnessMessage }}</p>
          <p v-if="roughnessError" class="error-text">{{ roughnessError }}</p>
        </form>
      </div>

      <div v-show="activeItem === 'rowcol'" class="tool-block">
        <h5>3. 根据坐标获取 ASCII 行列号</h5>
        <form id="getAsciiValueForm" enctype="multipart/form-data" @submit.prevent="handleRowcolSubmit">
          <div class="form-group">
            <label class="form-label" for="asciiFile">选择 ASCII 文件</label>
            <StyledFileInput
              input-id="asciiFile"
              name="ascii_file"
              accept=".asc,.txt"
              button-text="选择 ASCII"
              placeholder="未选择 ASCII 文件"
              required
              @change="handleAsciiFileChange"
            />
          </div>
          <div class="form-group">
            <label class="form-label" for="asciiTifFile">选择 TIF 文件（用于识别经纬度）</label>
            <StyledFileInput
              input-id="asciiTifFile"
              name="tif_file"
              accept=".tif,.tiff"
              button-text="选择 TIF"
              placeholder="未选择 TIF 文件"
              @change="handleAsciiTifFileChange"
            />
          </div>
          <div class="form-group">
            <label class="form-label" for="lineTxtFile">选择绘制 TXT 文件</label>
            <StyledFileInput
              input-id="lineTxtFile"
              name="line_txt_file"
              accept=".txt"
              button-text="选择 TXT"
              placeholder="未选择绘制 TXT 文件"
              required
              @change="handleLineTxtFileChange"
            />
          </div>
          <button type="submit" class="btn btn-primary" :disabled="rowcolLoading">
            {{ rowcolLoading ? '导出中...' : '导出行列号' }}
          </button>
          <p v-if="rowcolMessage" class="result-text">{{ rowcolMessage }}</p>
          <p v-if="rowcolError" class="error-text">{{ rowcolError }}</p>
        </form>
      </div>

      <div v-show="activeItem === 'draw'" class="tool-block">
        <h5>4. 地形计算工具</h5>
        <div class="form-group">
          <label class="form-label">在地形上绘线</label>
          <button type="button" class="btn btn-primary" id="startDrawing">开始绘制</button>
          <button type="button" class="btn btn-secondary" id="stopDrawing" style="display: none;">停止</button>
          <button type="button" class="btn btn-secondary" id="clearDrawing" style="display: none;">清空所有线段</button>
        </div>
        <div class="form-group">
          <label class="form-label">坐标管理</label>
          <div id="coordinatesList" class="coordinates-list">
            <p class="text-muted">暂无点位</p>
          </div>
          <div style="margin-top: 10px;">
            <button type="button" class="btn btn-secondary" @click="handleExportLineTerrainDataTXT">
              导出线段地形数据（TXT）
            </button>
          </div>
          <div style="margin-top: 10px;">
            <button type="button" class="btn btn-secondary" @click="handleCheckAllTilesExist">
              检查地形瓦片
            </button>
          </div>
          <div style="margin-top: 10px;">
            <button type="button" class="btn btn-secondary" @click="handleCalculateAllIntermediatePoints">
              计算地形网格信息
            </button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="activeItem && !isToolPanelActive(activeItem)" class="tool-panel">
      <div class="tool-content">
        <h4 class="tool-title">{{ getActiveItemName() }}</h4>
        <div v-if="activeItem === 'params'">
          <div class="panel-content">
            <label class="form-label">DEM 文件（dem.asc）：</label>
            <StyledFileInput class="file-field" accept=".asc" button-text="选择 DEM" placeholder="未选择 dem.asc" @change="handleFileChange($event, 'dem')" />

            <label class="form-label">粗糙度文件（cao.asc）：</label>
            <StyledFileInput class="file-field" accept=".asc" button-text="选择粗糙度" placeholder="未选择 cao.asc" @change="handleFileChange($event, 'cao')" />

            <label class="form-label">溃口文件（InputRiver.dat）：</label>
            <StyledFileInput class="file-field file-field-last" accept=".dat,.txt" button-text="选择溃口" placeholder="未选择 InputRiver.dat" @change="handleFileChange($event, 'river')" />

            <button class="btn btn-primary" @click="uploadAllFiles" :disabled="message === '🚀 模拟中...（30~60秒）' || message.includes('正在打包')">
              {{ message === '🚀 模拟中...（30~60秒）' || message.includes('正在打包') ? '模拟中...' : '开始模拟' }}
            </button>

            <div class="result" style="margin-top: 15px;">
              <p v-if="message" :class="message.includes('❌') ? 'error-text' : 'result-text'">{{ message }}</p>
              <p v-else class="text-muted" style="font-size: 12px;">等待计算中</p>
            </div>
          </div>
        </div>
        <div v-else-if="activeItem === 'run'">
          <div class="panel-content">
            <label class="form-label">DEM 文件（dem.asc）路径：</label>
            <div style="display:flex; margin-bottom: 10px;">
              <input class="form-control" type="text" v-model="gttDemPath" placeholder="D:/Chain1/gtt/TXT/dem.asc" style="flex:1; margin-right:5px;" />
              <button class="btn btn-secondary" style="margin-top:0;" @click="pickPath('file', 'dem')">浏览文件</button>
            </div>

            <label class="form-label">水深 TXT 目录：</label>
            <div style="display:flex; margin-bottom: 10px;">
              <input class="form-control" type="text" v-model="gttDepthDir" placeholder="D:/Chain1/gtt/TXT" style="flex:1; margin-right:5px;" />
              <button class="btn btn-secondary" style="margin-top:0;" @click="pickPath('dir', 'depth')">浏览目录</button>
            </div>

            <label class="form-label">JSON 输出目录：</label>
            <div style="display:flex; margin-bottom: 15px;">
              <input class="form-control" type="text" v-model="gttOutputDir" placeholder="D:/Chain1/gtt/JSON" style="flex:1; margin-right:5px;" />
              <button class="btn btn-secondary" style="margin-top:0;" @click="pickPath('dir', 'output')">浏览目录</button>
            </div>

            <button class="btn btn-primary" @click="runGridToTin" :disabled="gttRunning">
              {{ gttRunning ? '转换中...' : '开始转换' }}
            </button>

            <div class="result" style="margin-top: 15px;">
              <p v-if="gttMessage" :class="gttMessage.includes('❌') ? 'error-text' : 'result-text'" style="white-space: pre-wrap; font-size: 12px;">{{ gttMessage }}</p>
              <p v-else class="text-muted" style="font-size: 12px;">等待转换</p>
            </div>
          </div>
        </div>
        <div v-else-if="activeItem === 'render-flood'">
          <div class="panel-content">
            <FloodLoader v-if="viewer" :viewer="viewer" />
          </div>
        </div>
        <p v-else>模块开发中...</p>
      </div>
    </div>
    </Teleport>
  </div>
</template>

<style scoped>
.flood-simulation-page {
  position: relative;
  width: 100%;
  pointer-events: none;
  z-index: 900;
}

.tree-menu-container {
  pointer-events: auto;
  position: relative;
  width: 100%;
  background-color: transparent;
  border: none;
  color: white;
  overflow-y: auto;
}

.tool-panel {
  pointer-events: auto;
  position: fixed;
  top: 90px;
  right: 360px;
  width: 320px;
  max-height: calc(100vh - 120px);
  background-color: var(--sys-glass-bg, rgba(4, 20, 37, 0.95));
  border: 1px solid var(--sys-border-color, #00e5ff);
  border-radius: 8px;
  color: white;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  padding: 15px;
  overflow-y: auto;
  backdrop-filter: blur(10px);
  z-index: 9999;
}

.menu-title {
  display: none;
}

.tree-content {
  padding: 10px;
}

.menu-group {
  margin-bottom: 6px;
}

.menu-header {
  display: flex;
  align-items: center;
  padding: 10px;
  cursor: pointer;
  background-color: var(--sys-bg-glow, rgba(0, 229, 255, 0.15));
  border: 1px solid var(--sys-border-color-light, rgba(0, 229, 255, 0.1));
  border-radius: 4px;
  transition: all 0.3s ease;
}
.menu-header:hover {
  background-color: var(--sys-bg-glow-active, rgba(0, 229, 255, 0.3));
}

.arrow {
  font-size: 10px;
  margin-right: 8px;
  transition: transform 0.2s;
  color: #00AEFF;
}

.arrow.expanded {
  transform: rotate(90deg);
}

.group-name {
  font-weight: bold;
  font-size: 16px;
}

.menu-children {
  padding-left: 16px;
  margin-top: 5px;
}

.menu-item {
  padding: 8px 10px;
  font-size: 14px;
  cursor: pointer;
  border-radius: 4px;
  color: #ccc;
  margin-bottom: 4px;
  transition: all 0.2s ease;
}

.menu-item:hover {
  background-color: var(--sys-bg-glow-active, rgba(0, 229, 255, 0.3));
  color: #fff;
}

.menu-item.active {
  background-color: var(--sys-bg-glow, rgba(0, 229, 255, 0.15));
  color: var(--sys-theme-color, #00e5ff);
  border-left: 3px solid var(--sys-theme-color, #00e5ff);
}

.tool-content,
.tool-block {
  margin-bottom: 10px;
}

.tool-title {
  margin: 0 0 10px 0;
  border-bottom: 1px solid var(--sys-border-color, #00e5ff);
  padding-bottom: 8px;
  color: var(--sys-theme-color, #00e5ff);
  font-size: 16px;
  text-shadow: var(--sys-text-glow);
}

.form-group {
  margin-bottom: 10px;
}

.form-label {
  display: block;
  margin-bottom: 5px;
  color: #ddd;
  font-size: 12px;
}

.form-control {
  width: 100%;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid var(--sys-border-color-light, rgba(0, 229, 255, 0.1));
  color: white;
  padding: 6px;
  border-radius: 4px;
}
.form-control:focus {
  outline: none;
  border-color: var(--sys-theme-color, #00e5ff);
}

.file-field {
  margin-bottom: 10px;
}

.file-field-last {
  margin-bottom: 15px;
}

.btn {
  margin-right: 5px;
  margin-top: 6px;
  padding: 6px 12px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.btn-primary {
  background-color: var(--sys-bg-glow);
  color: var(--sys-theme-color);
  border: 1px solid var(--sys-border-color);
  transition: all 0.3s;
}
.btn-primary:hover:not(:disabled) {
  background-color: var(--sys-bg-glow-active);
  box-shadow: var(--sys-text-glow);
}

.btn-secondary {
  background-color: transparent;
  color: #ccc;
  border: 1px solid #555;
  transition: all 0.3s;
}
.btn-secondary:hover:not(:disabled) {
  background-color: rgba(255, 255, 255, 0.1);
  color: #fff;
}

.coordinates-list {
  max-height: 260px;
  overflow-y: auto;
  border: 1px solid var(--sys-border-color-light, rgba(0, 229, 255, 0.1));
  padding: 10px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 4px;
}

.text-muted {
  color: #9ca3af;
  margin: 0;
}

.btn:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.result-text {
  margin-top: 8px;
  color: #34d399;
  font-size: 12px;
}

.error-text {
  margin-top: 8px;
  color: #f87171;
  font-size: 12px;
}
</style>
