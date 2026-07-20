<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import * as Cesium from 'cesium';
import FloodLoader from './FloodLoader.vue';
import SceneEffectsPanel from './SceneEffectsPanel.vue';
import StyledFileInput from './StyledFileInput.vue';
import DrawTriangleMesh from '../js/DrawTriangleMesh';
import {
  currentFloodPrimitive,
  floodPlaybackToken,
  lastLoadedFloodJson,
  meshRenderCloseToken,
  recordFloodPointDepth,
  recordMeshAreaPoint,
  requestFloodAreaPanelOpen,
  resetFloodAreaSeries,
  resetFloodPointDepthSeries
} from '../store/floodState';

const props = defineProps<{
  viewer?: Cesium.Viewer | null;
  terrainEnabled?: boolean;
  panelActive?: boolean;
  rainstormEnabled?: boolean;
  riverRunoffEnabled?: boolean;
  floodRenderEnabled?: boolean;
}>();

const emit = defineEmits<{
  (e: 'menu-select', id: string): void;
  (e: 'toggle-rainstorm'): void;
  (e: 'toggle-river-runoff'): void;
  (e: 'toggle-flood-render'): void;
}>();

type MenuChild = { id: string; name: string };
type MenuGroup = { name: string; expanded: boolean; children: MenuChild[] };

const PY_API_BASE = '/py-api';
const pythonApiUrl = (path: string) => `${PY_API_BASE}${path.startsWith('/') ? path : `/${path}`}`;

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
const simulationUtmZone = ref('48');
const isSimulating = ref(false);
const meshSourceDir = ref('');
const meshOutputDir = ref('');
const meshConversionStatus = ref('等待转换');
const isConvertingMesh = ref(false);
const meshFolder = ref('');
const meshFrames = ref<any[]>([]);
const activeMeshFrameIndex = ref(0);
const meshStatus = ref('等待选择 Mesh 文件夹');
const meshFileName = ref('尚未选择 Mesh 文件夹');
const meshPointCount = ref(0);
const meshTriangleCount = ref(0);
const meshDepthRange = ref('--');
const floodAreaText = ref('-');
const meshEvolutionTimeText = ref('-');
const meshOpacity = ref(0.78);
const meshHeightScale = ref(1);
const meshColorRamp = ref('water');
const meshPlaybackRate = ref(1);
const renderSettingsExpanded = ref(false);
const sceneEffectsExpanded = ref(false);
const isMeshPlaying = ref(false);
const isMeshPreloading = ref(false);
const meshPlaybackDockVisible = ref(false);
const meshDepthLegendVisible = ref(true);
let meshPlaybackTimer: number | undefined;
const meshTerrainHeightCache = new Map<string, number>();
const meshFrameCache = new Map<string, any>();
const MAX_MESH_TERRAIN_HEIGHT_CACHE_ENTRIES = 150000;
const MAX_MESH_FRAME_CACHE_ENTRIES = 1000;
let meshPreloadPromise: Promise<void> | null = null;
let meshPreloadToken = 0;
const EARTH_RADIUS_METERS = 6378137;
const MESH_FRAME_SECONDS = 20;

const MESH_COLOR_RAMPS: Record<string, string[]> = {
  water: ['#d9fbff', '#87d8f5', '#3b9fe0', '#1766bd', '#102f83'],
  depth: ['#e9f9ff', '#a9dff7', '#4aa7dd', '#1761aa', '#092d68'],
  heat: ['#fff7a8', '#6ed6e6', '#2584d9', '#3846b5', '#32176b']
};

const meshPlaybackTitle = computed(() => {
  const folderName = meshFolder.value.replace(/\\/g, '/').split('/').filter(Boolean).pop();
  return folderName || '洪水动画';
});

const sceneRainstormEnabled = computed(() => Boolean(props.rainstormEnabled));
const sceneRiverRunoffEnabled = computed(() => Boolean(props.riverRunoffEnabled));
const sceneFloodRenderEnabled = computed(() => Boolean(props.floodRenderEnabled));

const meshPlaybackStatusText = computed(() => {
  if (isMeshPreloading.value) return '缓存中';
  if (isMeshPlaying.value) return '播放中';
  if (meshFrames.value.length) return '已暂停';
  return '待加载';
});

const meshDepthLegend = computed(() => {
  const match = meshDepthRange.value.match(/([\d.]+)\s*~\s*([\d.]+)/);
  const min = match ? Number(match[1]) : 0;
  const max = match ? Number(match[2]) : 0;
  const mid = (min + max) / 2;
  return {
    min: `${min.toFixed(2)} m`,
    mid: `${mid.toFixed(2)} m`,
    max: `${max.toFixed(2)} m`
  };
});

const showMeshPlaybackDock = () => {
  if (meshFrames.value.length) {
    meshPlaybackDockVisible.value = true;
    meshDepthLegendVisible.value = true;
  }
};

const hideMeshPlaybackDock = () => {
  meshPlaybackDockVisible.value = false;
};

const hideMeshDepthLegend = () => {
  meshDepthLegendVisible.value = false;
};

const hideMeshFloatingPanels = () => {
  meshPlaybackDockVisible.value = false;
  meshDepthLegendVisible.value = false;
};

type MeshAreaVertex = {
  lon: number;
  lat: number;
};

function calculateMeshArea(vertices: MeshAreaVertex[], triangles: number[]) {
  if (!vertices.length || !triangles.length) return 0;
  const referenceLat = vertices.reduce((sum, vertex) => sum + vertex.lat, 0) / vertices.length;
  const xScale = EARTH_RADIUS_METERS * Math.cos(Cesium.Math.toRadians(referenceLat));
  const yScale = EARTH_RADIUS_METERS;
  const projected = vertices.map((vertex) => ({
    x: Cesium.Math.toRadians(vertex.lon) * xScale,
    y: Cesium.Math.toRadians(vertex.lat) * yScale
  }));
  let area = 0;
  for (let index = 0; index + 2 < triangles.length; index += 3) {
    const a = projected[triangles[index]];
    const b = projected[triangles[index + 1]];
    const c = projected[triangles[index + 2]];
    if (!a || !b || !c) continue;
    const triangleArea = Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
    if (Number.isFinite(triangleArea)) area += triangleArea;
  }
  return area;
}

function formatArea(area: number) {
  if (!Number.isFinite(area) || area <= 0) return '0 km²';
  return `${Number((area / 1_000_000).toFixed(3))} km²`;
}

function formatEvolutionTime(totalSeconds: number) {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return '-';
  const seconds = Math.round(totalSeconds);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  return [hours, minutes, remainingSeconds]
    .map((item) => String(item).padStart(2, '0'))
    .join(':');
}

const calculateMeshAreaM2FromMesh = (mesh: any) => {
  const positions = Array.isArray(mesh?.positions) ? mesh.positions : [];
  const triangles = Array.isArray(mesh?.triangles) ? mesh.triangles : [];
  const vertices: MeshAreaVertex[] = [];

  for (let index = 0; index + 1 < positions.length; index += 2) {
    const lon = Number(positions[index]);
    const lat = Number(positions[index + 1]);
    if (Number.isFinite(lon) && Number.isFinite(lat)) {
      vertices.push({ lon, lat });
    }
  }

  return calculateMeshArea(vertices, triangles.map((item: unknown) => Number(item)));
};

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

const fetchJsonResult = async (url: string, options?: RequestInit) => {
  const response = await fetch(url, options);
  const text = await response.text();
  let result: any = {};

  try {
    result = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`接口返回了非 JSON 内容：${text.slice(0, 300)}`);
  }

  if (!response.ok) {
    throw new Error(result.error || result.message || `接口返回状态码 ${response.status}`);
  }

  return result;
};

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

const downloadApiZip = async (url: string, fallbackName: string) => {
  const response = await fetch(`/api${url}`);
  if (!response.ok) {
    throw new Error(`下载 ${fallbackName} 失败：${await response.text()}`);
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = fallbackName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
};

const waitForFloodSimulationComplete = async (statusUrl?: string) => {
  const startedAt = Date.now();
  const timeoutMs = 3 * 60 * 60 * 1000;
  const apiStatusUrl = `/api${statusUrl || '/simulation-status'}`;

  while (Date.now() - startedAt < timeoutMs) {
    await sleep(3000);
    const result = await fetchJsonResult(apiStatusUrl);

    if (result.status === 'finished') {
      return result;
    }
    if (result.status === 'failed') {
      throw new Error(result.error || result.message || '后端模拟失败');
    }

    message.value = result.message || '后端正在计算，请稍候...';
  }

  throw new Error('等待模拟完成超时，请检查后端服务是否仍在运行');
};

const runOptimizedFloodSimulation = async () => {
  if (!files.value.dem || !files.value.cao || !files.value.river) {
    message.value = '请先选择 DEM、糙率和溃口文件';
    return;
  }

  const normalizedUtmZone = String(simulationUtmZone.value).trim();
  if (!/^(?:[1-9]|[1-5]\d|60)$/.test(normalizedUtmZone)) {
    message.value = '请输入 1-60 之间的 UTM 投影带号';
    return;
  }

  isSimulating.value = true;
  message.value = '正在启动后端模拟...';

  try {
    const formData = new FormData();
    formData.append('dem', files.value.dem);
    formData.append('cao', files.value.cao);
    formData.append('river', files.value.river);
    formData.append('utmZone', normalizedUtmZone);

    const startResult = await fetchJsonResult(`/api/upload-all?utmZone=${encodeURIComponent(normalizedUtmZone)}`, {
      method: 'POST',
      body: formData
    });

    message.value = '后端已开始计算，正在等待结果...';
    const result = startResult.status === 'finished'
      ? startResult
      : await waitForFloodSimulationComplete(startResult.statusUrl);

    if (result.txtZipUrl) {
      message.value = '模拟完成，正在下载 TXT 结果...';
      await downloadApiZip(result.txtZipUrl, 'flood_txt.zip');
    }
    if (result.jsonZipUrl) {
      message.value = 'TXT 下载完成，正在下载 JSON 结果...';
      await downloadApiZip(result.jsonZipUrl, 'flood_json.zip');
    }
    if (result.restartUrl) {
      message.value = '结果下载完成，正在重启后端服务...';
      await fetchJsonResult(`/api${result.restartUrl}`, { method: 'POST' });
    }

    message.value = '模拟完成，结果已下载';
  } catch (error) {
    message.value = `模拟失败：${error instanceof Error ? error.message : String(error)}`;
  } finally {
    isSimulating.value = false;
  }
};

const pickMeshPath = async (field: 'source' | 'output' | 'folder') => {
  try {
    const response = await fetch('/api/select-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'dir' })
    });
    const result = await response.json();
    if (!result.success) {
      throw new Error(result.message || '选择目录失败');
    }
    if (!result.path) {
      return;
    }

    const normalizedPath = String(result.path).replace(/\\/g, '/');
    if (field === 'source') meshSourceDir.value = normalizedPath;
    if (field === 'output') meshOutputDir.value = normalizedPath;
    if (field === 'folder') {
      meshFolder.value = normalizedPath;
      await loadMeshAnimationFolder(normalizedPath);
    }
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    if (field === 'folder') {
      meshStatus.value = `选择失败：${messageText}`;
    } else {
      meshConversionStatus.value = `选择失败：${messageText}`;
    }
  }
};

const convertJsonToMesh = async () => {
  if (!meshSourceDir.value.trim() || !meshOutputDir.value.trim()) {
    meshConversionStatus.value = '请选择 JSON 源目录和 Mesh 输出目录';
    return;
  }

  isConvertingMesh.value = true;
  meshConversionStatus.value = '正在转换 Mesh...';
  try {
    const response = await fetch('/api/build-mesh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceDir: meshSourceDir.value.trim(),
        outputDir: meshOutputDir.value.trim()
      })
    });
    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.error || result.message || 'Mesh 转换失败');
    }
    meshConversionStatus.value = result.message || 'Mesh 转换完成';
  } catch (error) {
    meshConversionStatus.value = `转换失败：${error instanceof Error ? error.message : String(error)}`;
  } finally {
    isConvertingMesh.value = false;
  }
};

const stopMeshPlayback = () => {
  isMeshPlaying.value = false;
  if (meshPlaybackTimer) {
    window.clearTimeout(meshPlaybackTimer);
    meshPlaybackTimer = undefined;
  }
};

const completeMeshPlayback = () => {
  stopMeshPlayback();
  meshStatus.value = `播放完成：已到第 ${meshFrames.value.length} / ${meshFrames.value.length} 帧`;
};

const removeMeshFlood = () => {
  if (currentFloodPrimitive.value && props.viewer) {
    props.viewer.scene.primitives.remove(currentFloodPrimitive.value);
    currentFloodPrimitive.value = null;
  }
};

const getMeshFrameCacheKey = (folder: string, name: string) => `${folder}::${name}`;

const readMeshFrame = async (frame: any) => {
  const cacheKey = getMeshFrameCacheKey(meshFolder.value, frame.name);
  const cachedMesh = meshFrameCache.get(cacheKey);
  if (cachedMesh) {
    return cachedMesh;
  }

  const response = await fetch(
    `/api/mesh-frame?folder=${encodeURIComponent(meshFolder.value)}&name=${encodeURIComponent(frame.name)}`
  );
  const mesh = await response.json();
  if (!response.ok) {
    throw new Error(mesh.error || 'Mesh 帧读取失败');
  }
  if (!Array.isArray(mesh.positions) || !Array.isArray(mesh.values) || !Array.isArray(mesh.triangles)) {
    throw new Error('Mesh 帧缺少 positions、values 或 triangles 字段');
  }

  if (meshFrameCache.size >= MAX_MESH_FRAME_CACHE_ENTRIES) {
    meshFrameCache.clear();
  }
  meshFrameCache.set(cacheKey, mesh);
  return mesh;
};

const isAllMeshFramesCached = () => (
  meshFrames.value.length > 0
  && meshFrames.value.every((frame) => meshFrameCache.has(getMeshFrameCacheKey(meshFolder.value, frame.name)))
);

const preloadMeshFrames = async (showStatus = true) => {
  if (!meshFrames.value.length || isAllMeshFramesCached()) {
    return;
  }
  if (meshPreloadPromise) {
    return meshPreloadPromise;
  }

  isMeshPreloading.value = true;
  let loadedCount = 0;
  let nextFrameIndex = 0;
  const total = meshFrames.value.length;
  const concurrency = Math.min(8, total);
  const currentToken = meshPreloadToken;

  meshPreloadPromise = (async () => {
    const workers = Array.from({ length: concurrency }, async () => {
      while (nextFrameIndex < total) {
        if (currentToken !== meshPreloadToken) {
          return;
        }
        const frame = meshFrames.value[nextFrameIndex];
        nextFrameIndex += 1;
        await readMeshFrame(frame);
        loadedCount += 1;
        if (showStatus && (loadedCount === total || loadedCount % 10 === 0)) {
          meshStatus.value = `正在预加载 Mesh 帧 ${loadedCount} / ${total}`;
        }
      }
    });

    await Promise.all(workers);
    if (showStatus && currentToken === meshPreloadToken) {
      meshStatus.value = `Mesh 帧已预加载 ${total} / ${total}`;
    }
  })().finally(() => {
    if (currentToken === meshPreloadToken) {
      isMeshPreloading.value = false;
      meshPreloadPromise = null;
    }
  });

  return meshPreloadPromise;
};

const getMeshTerrainHeightCacheKey = (lon: number, lat: number) => `${lon.toFixed(9)},${lat.toFixed(9)}`;
const MESH_TERRAIN_SAMPLE_BATCH_SIZE = 2000;
const MESH_TERRAIN_SAMPLE_LEVEL = 13;
const MESH_TERRAIN_FALLBACK_LEVEL = 8;

const isRealTerrainEnabled = () => {
  const terrainProvider = props.viewer?.terrainProvider;
  return !!props.terrainEnabled && !!terrainProvider && !(terrainProvider instanceof Cesium.EllipsoidTerrainProvider);
};

const sampleMeshTerrainHeights = async (mesh: any) => {
  if (!props.viewer || !isRealTerrainEnabled()) {
    return undefined;
  }

  const vertexCount = Array.isArray(mesh.values) ? mesh.values.length : 0;
  const heights = new Float64Array(vertexCount);
  const missing: Array<{ index: number; key: string; cartographic: Cesium.Cartographic }> = [];

  for (let index = 0; index < vertexCount; index += 1) {
    const lon = Number(mesh.positions[index * 2]);
    const lat = Number(mesh.positions[index * 2 + 1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || lon < -180 || lon > 180 || lat < -90 || lat > 90) {
      continue;
    }

    const key = getMeshTerrainHeightCacheKey(lon, lat);
    const cachedHeight = meshTerrainHeightCache.get(key);
    if (cachedHeight !== undefined) {
      heights[index] = cachedHeight;
    } else {
      missing.push({
        index,
        key,
        cartographic: Cesium.Cartographic.fromDegrees(lon, lat)
      });
    }
  }

  if (!missing.length) {
    return heights;
  }

  if (meshTerrainHeightCache.size + missing.length > MAX_MESH_TERRAIN_HEIGHT_CACHE_ENTRIES) {
    meshTerrainHeightCache.clear();
  }

  try {
    for (let batchStart = 0; batchStart < missing.length; batchStart += MESH_TERRAIN_SAMPLE_BATCH_SIZE) {
      const batch = missing.slice(batchStart, batchStart + MESH_TERRAIN_SAMPLE_BATCH_SIZE);
      const positions = batch.map((item) => item.cartographic);
      const sampled = await Cesium.sampleTerrain(
        props.viewer.terrainProvider,
        MESH_TERRAIN_SAMPLE_LEVEL,
        positions
      );

      const unresolved = sampled.filter((position) => !Number.isFinite(position.height));
      if (unresolved.length) {
        await Cesium.sampleTerrain(
          props.viewer.terrainProvider,
          MESH_TERRAIN_FALLBACK_LEVEL,
          unresolved
        );
      }

      sampled.forEach((position, sampleIndex) => {
        const item = batch[sampleIndex];
        const height = Number.isFinite(position.height) ? Number(position.height) : 0;
        meshTerrainHeightCache.set(item.key, height);
        heights[item.index] = height;
      });
    }
  } catch (error) {
    console.warn('Mesh terrain sampling failed', error);
    return undefined;
  }

  return heights;
};

const renderMeshFrame = async (frameIndex: number, shouldFly = false, sessionToken?: number) => {
  const frame = meshFrames.value[frameIndex];
  if (!frame || !props.viewer) {
    return;
  }

  // 手动渲染会接管洪水图层；连续播放则沿用同一个令牌。
  const renderToken = sessionToken ?? (floodPlaybackToken.value += 1);

  try {
    if (!isMeshPlaying.value) {
      meshStatus.value = `正在渲染第 ${frameIndex + 1} / ${meshFrames.value.length} 帧`;
    }
    const mesh = await readMeshFrame(frame);

    const terrainHeights = await sampleMeshTerrainHeights(mesh);

    if (renderToken !== floodPlaybackToken.value) {
      return;
    }

    const primitive = DrawTriangleMesh.createMeshPrimitive({
      mesh,
      stats: mesh.stats || frame.stats,
      alpha: meshOpacity.value,
      heightScale: meshHeightScale.value,
      surfaceOffset: 1.2,
      terrainHeights,
      colorRamp: MESH_COLOR_RAMPS[meshColorRamp.value] || MESH_COLOR_RAMPS.water
    });

    removeMeshFlood();
    currentFloodPrimitive.value = primitive;
    props.viewer.scene.primitives.add(primitive);
    lastLoadedFloodJson.value = mesh;

    activeMeshFrameIndex.value = frameIndex;
    meshFileName.value = frame.name;
    meshPointCount.value = mesh.pointCount || mesh.values.length;
    meshTriangleCount.value = mesh.triangleCount || Math.floor(mesh.triangles.length / 3);
    const stats = mesh.stats || frame.stats || {};
    const minDepth = Number.isFinite(stats.minValue) ? Number(stats.minValue) : Math.min(...mesh.values.slice(0, 10000));
    const maxDepth = Number.isFinite(stats.maxValue) ? Number(stats.maxValue) : Math.max(...mesh.values.slice(0, 10000));
    meshDepthRange.value = `${minDepth.toFixed(3)} ~ ${maxDepth.toFixed(3)} m`;
    const meshAreaM2 = calculateMeshAreaM2FromMesh(mesh);
    floodAreaText.value = formatArea(meshAreaM2);
    recordMeshAreaPoint(frameIndex + 1, meshAreaM2);
    recordFloodPointDepth(frameIndex + 1, mesh);
    meshEvolutionTimeText.value = formatEvolutionTime((frameIndex + 1) * MESH_FRAME_SECONDS);
    if (!isMeshPlaying.value || frameIndex % 5 === 0) {
      meshStatus.value = `已渲染第 ${frameIndex + 1} / ${meshFrames.value.length} 帧：${frame.name}`;
    }

    if (shouldFly) {
      flyToMeshFlood();
    }
  } catch (error) {
    meshStatus.value = `渲染失败：${error instanceof Error ? error.message : String(error)}`;
  }
};

const loadMeshAnimationFolder = async (folder: string) => {
  if (!folder) {
    return;
  }
  stopMeshPlayback();
  meshPreloadToken += 1;
  meshPreloadPromise = null;
  isMeshPreloading.value = false;
  meshFrameCache.clear();
  try {
    meshStatus.value = '正在读取 index.json...';
    const response = await fetch('/api/mesh-index', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder })
    });
    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.error || result.message || 'index.json 读取失败');
    }
    meshFolder.value = result.folder;
    meshFrames.value = result.frames.sort((a: any, b: any) => Number(a.index) - Number(b.index));
    resetFloodAreaSeries();
    resetFloodPointDepthSeries();
    await renderMeshFrame(0, true);
    requestFloodAreaPanelOpen();
    showMeshPlaybackDock();
    void preloadMeshFrames(false);
  } catch (error) {
    meshStatus.value = `加载 Mesh 文件夹失败：${error instanceof Error ? error.message : String(error)}`;
  }
};

const toggleMeshPlayback = async () => {
  if (!meshFrames.value.length) {
    return;
  }
  if (isMeshPlaying.value) {
    stopMeshPlayback();
    return;
  }

  if (!isAllMeshFramesCached()) {
    meshStatus.value = '正在预加载 Mesh 帧，完成后开始播放...';
    await preloadMeshFrames(true);
  }

  if (activeMeshFrameIndex.value >= meshFrames.value.length - 1) {
    completeMeshPlayback();
    return;
  }

  const playbackToken = floodPlaybackToken.value + 1;
  floodPlaybackToken.value = playbackToken;
  isMeshPlaying.value = true;
  const playNext = async () => {
    if (!isMeshPlaying.value || playbackToken !== floodPlaybackToken.value) {
      stopMeshPlayback();
      return;
    }
    if (activeMeshFrameIndex.value >= meshFrames.value.length - 1) {
      completeMeshPlayback();
      return;
    }
    const nextIndex = activeMeshFrameIndex.value + 1;
    await renderMeshFrame(nextIndex, false, playbackToken);
    if (!isMeshPlaying.value || playbackToken !== floodPlaybackToken.value) {
      stopMeshPlayback();
      return;
    }
    if (nextIndex >= meshFrames.value.length - 1) {
      completeMeshPlayback();
      return;
    }
    meshPlaybackTimer = window.setTimeout(playNext, Math.max(30, Math.round(350 / meshPlaybackRate.value)));
  };
  meshPlaybackTimer = window.setTimeout(playNext, Math.max(30, Math.round(350 / meshPlaybackRate.value)));
};

const restartMeshPlayback = async () => {
  if (!meshFrames.value.length) {
    return;
  }

  stopMeshPlayback();
  if (!isAllMeshFramesCached()) {
    meshStatus.value = '正在预加载 Mesh 帧，完成后从头播放...';
    await preloadMeshFrames(true);
  }

  const playbackToken = floodPlaybackToken.value + 1;
  floodPlaybackToken.value = playbackToken;
  await renderMeshFrame(0, false, playbackToken);
  if (meshFrames.value.length === 1) {
    completeMeshPlayback();
    return;
  }
  isMeshPlaying.value = true;
  const playNext = async () => {
    if (!isMeshPlaying.value || playbackToken !== floodPlaybackToken.value) {
      stopMeshPlayback();
      return;
    }
    if (activeMeshFrameIndex.value >= meshFrames.value.length - 1) {
      completeMeshPlayback();
      return;
    }
    const nextIndex = activeMeshFrameIndex.value + 1;
    await renderMeshFrame(nextIndex, false, playbackToken);
    if (!isMeshPlaying.value || playbackToken !== floodPlaybackToken.value) {
      stopMeshPlayback();
      return;
    }
    if (nextIndex >= meshFrames.value.length - 1) {
      completeMeshPlayback();
      return;
    }
    meshPlaybackTimer = window.setTimeout(playNext, Math.max(30, Math.round(350 / meshPlaybackRate.value)));
  };
  meshPlaybackTimer = window.setTimeout(playNext, Math.max(30, Math.round(350 / meshPlaybackRate.value)));
};

const renderPreviousMeshFrame = () => {
  if (!meshFrames.value.length) {
    return;
  }
  stopMeshPlayback();
  const previousIndex = (activeMeshFrameIndex.value - 1 + meshFrames.value.length) % meshFrames.value.length;
  void renderMeshFrame(previousIndex);
};

const renderNextMeshFrame = () => {
  if (!meshFrames.value.length) {
    return;
  }
  stopMeshPlayback();
  const nextIndex = (activeMeshFrameIndex.value + 1) % meshFrames.value.length;
  void renderMeshFrame(nextIndex);
};

const seekMeshFrame = (event: Event) => {
  const target = event.target as HTMLInputElement;
  const frameIndex = Number(target.value);
  if (!meshFrames.value.length || !Number.isFinite(frameIndex)) {
    return;
  }
  stopMeshPlayback();
  void renderMeshFrame(Math.min(Math.max(Math.round(frameIndex), 0), meshFrames.value.length - 1));
};

const jumpMeshFrame = (offset: number) => {
  if (!meshFrames.value.length) {
    return;
  }
  stopMeshPlayback();
  const nextIndex = Math.min(
    Math.max(activeMeshFrameIndex.value + offset, 0),
    meshFrames.value.length - 1
  );
  void renderMeshFrame(nextIndex);
};

const flyToMeshFlood = () => {
  const primitive = currentFloodPrimitive.value as (Cesium.Primitive & { _boundingSphereWorld?: Cesium.BoundingSphere }) | null;
  if (!primitive?._boundingSphereWorld || !props.viewer) {
    return;
  }
  props.viewer.camera.flyToBoundingSphere(primitive._boundingSphereWorld, {
    duration: 1.2,
    offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-55), primitive._boundingSphereWorld.radius * 3)
  });
};

const clearMeshFlood = () => {
  stopMeshPlayback();
  hideMeshPlaybackDock();
  meshPreloadToken += 1;
  meshPreloadPromise = null;
  isMeshPreloading.value = false;
  meshFrameCache.clear();
  removeMeshFlood();
  meshFileName.value = '尚未选择 Mesh 文件夹';
  meshPointCount.value = 0;
  meshTriangleCount.value = 0;
  meshDepthRange.value = '--';
  floodAreaText.value = '-';
  meshEvolutionTimeText.value = '-';
  resetFloodAreaSeries();
  resetFloodPointDepthSeries();
  lastLoadedFloodJson.value = null;
  meshStatus.value = '洪水图层已清空';
};

watch(meshRenderCloseToken, () => {
  clearMeshFlood();
});

defineExpose({
  clearMeshFlood,
  hideMeshFloatingPanels
});

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
      { id: 'tif2asc', name: '高程格式转换' },
      { id: 'roughness', name: '地形粗糙度计算' },
      { id: 'draw', name: '溃口绘制' },
      { id: 'rowcol', name: '溃口位置获取' }
    ]
  },
  {
    name: '洪水模拟',
    expanded: true,
    children: [
      { id: 'simulate-flood', name: '模拟计算' },
      { id: 'json-to-mesh', name: 'JSON 转 Mesh' }
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

const closeActiveToolPanel = () => {
  activeItem.value = null;
  emit('menu-select', '');
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

const fetchAndDisplayTiffBounds = async (file: File) => {
  try {
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch(pythonApiUrl('/get_tiff_bounds'), {
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

    const response = await fetch(pythonApiUrl('/convert'), {
      method: 'POST',
      body: formData
    });

    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.message || 'Convert failed');
    }

    convertMessage.value = result.message || 'Convert finished';

    if (result.download_url) {
      const downloadUrl = pythonApiUrl(result.download_url);
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

    const response = await fetch(pythonApiUrl('/roughness'), {
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
      const downloadUrl = pythonApiUrl(result.download_url);
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
    const response = await fetch(pythonApiUrl('/api/choose-path'), {
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
    const response = await fetch(pythonApiUrl('/api/grid-to-tin'), {
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

    const response = await fetch(pythonApiUrl('/get_ascii_values'), {
      method: 'POST',
      body: formData
    });

    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.message || 'Get ASCII Row/Col failed');
    }

    rowcolMessage.value = result.message || `成功获取 ${coordinates.length} 个坐标点行列号`;

    if (result.download_url) {
      const downloadUrl = pythonApiUrl(result.download_url);
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

onBeforeUnmount(() => {
  stopMeshPlayback();
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

          </div>
        </div>
      </div>
    </div>

    <Teleport to="body">
      <div v-if="props.panelActive && isToolPanelActive(activeItem)" class="tool-panel">
        <button type="button" class="floating-close-btn tool-close-btn" title="关闭" aria-label="关闭功能框" @click="closeActiveToolPanel">×</button>
        <div v-show="activeItem === 'tif2asc'" class="tool-block">
        <h5>高程格式转换</h5>
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
        <h5>地形粗糙度计算</h5>
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
        <h5>溃口位置获取</h5>
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
        <h5>溃口绘制</h5>
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
            <button type="button" class="btn btn-primary" @click="handleExportLineTerrainDataTXT">
              导出线段地形数据（TXT）
            </button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="props.panelActive && activeItem && !isToolPanelActive(activeItem)" class="tool-panel">
      <button type="button" class="floating-close-btn tool-close-btn" title="关闭" aria-label="关闭功能框" @click="closeActiveToolPanel">×</button>
      <div class="tool-content">
        <h4 class="tool-title">{{ getActiveItemName() }}</h4>
        <div v-if="activeItem === 'simulate-flood'">
          <div class="panel-content">
            <label class="form-label">DEM 文件（.asc）</label>
            <StyledFileInput class="file-field" accept=".asc" button-text="选择 DEM" placeholder="未选择 DEM 文件" @change="handleFileChange($event, 'dem')" />

            <label class="form-label">糙率文件（.asc）</label>
            <StyledFileInput class="file-field" accept=".asc" button-text="选择糙率" placeholder="未选择糙率文件" @change="handleFileChange($event, 'cao')" />

            <label class="form-label">溃口文件（.dat）</label>
            <StyledFileInput class="file-field" accept=".dat,.txt" button-text="选择溃口" placeholder="未选择溃口文件" @change="handleFileChange($event, 'river')" />

            <label class="form-label">UTM 投影带号</label>
            <input class="form-control file-field-last" v-model="simulationUtmZone" inputmode="numeric" placeholder="例如 48" />

            <button class="btn btn-primary" @click="runOptimizedFloodSimulation" :disabled="isSimulating">
              {{ isSimulating ? '正在模拟...' : '开始模拟计算' }}
            </button>

            <div class="result" style="margin-top: 15px;">
              <p v-if="message" :class="message.includes('失败') ? 'error-text' : 'result-text'">{{ message }}</p>
              <p v-else class="text-muted" style="font-size: 12px;">等待计算</p>
            </div>
          </div>
        </div>
        <div v-else-if="activeItem === 'json-to-mesh'">
          <div class="panel-content">
            <label class="form-label">JSON 源目录</label>
            <div class="path-row">
              <input class="form-control" type="text" v-model="meshSourceDir" placeholder="选择包含 Flood*.json 的目录" />
              <button class="btn btn-secondary path-btn" @click="pickMeshPath('source')">浏览</button>
            </div>

            <label class="form-label">Mesh 输出目录</label>
            <div class="path-row">
              <input class="form-control" type="text" v-model="meshOutputDir" placeholder="选择 .mesh.json 输出目录" />
              <button class="btn btn-secondary path-btn" @click="pickMeshPath('output')">浏览</button>
            </div>

            <button class="btn btn-primary" @click="convertJsonToMesh" :disabled="isConvertingMesh">
              {{ isConvertingMesh ? '正在转换...' : '开始转换' }}
            </button>

            <div class="result" style="margin-top: 15px;">
              <p :class="meshConversionStatus.includes('失败') ? 'error-text' : 'result-text'" style="white-space: pre-wrap; font-size: 12px;">{{ meshConversionStatus }}</p>
            </div>
          </div>
        </div>
        <div v-else-if="activeItem === 'render-flood'">
          <div class="panel-content render-flood-content">
            <label class="form-label">Mesh 文件夹</label>
            <div class="path-row">
              <input class="form-control" type="text" v-model="meshFolder" placeholder="选择包含 index.json 的目录" />
              <button class="btn btn-secondary path-btn" @click="pickMeshPath('folder')">浏览</button>
            </div>

            <div class="mesh-stats">
              <div><span>点数</span><strong>{{ meshPointCount || '--' }}</strong></div>
              <div><span>三角面</span><strong>{{ meshTriangleCount || '--' }}</strong></div>
            </div>

            <div class="render-settings-group">
              <button type="button" class="render-settings-header" @click="renderSettingsExpanded = !renderSettingsExpanded">
                <span class="render-settings-arrow" :class="{ expanded: renderSettingsExpanded }">▶</span>
                <span>渲染设置</span>
              </button>

              <div v-show="renderSettingsExpanded" class="render-settings-content">
                <label class="form-label">透明度 {{ meshOpacity.toFixed(2) }}</label>
                <input class="range-control" v-model.number="meshOpacity" type="range" min="0.1" max="1" step="0.05" @input="renderMeshFrame(activeMeshFrameIndex)" />

                <label class="form-label">高度比例 {{ meshHeightScale.toFixed(1) }}</label>
                <input class="range-control" v-model.number="meshHeightScale" type="range" min="0" max="5" step="0.1" @input="renderMeshFrame(activeMeshFrameIndex)" />

                <label class="form-label">颜色方案</label>
                <select class="form-control" v-model="meshColorRamp" @change="renderMeshFrame(activeMeshFrameIndex)">
                  <option value="water">水蓝</option>
                  <option value="depth">深水蓝</option>
                  <option value="heat">深度热图</option>
                </select>

                <label class="form-label">播放速率 {{ meshPlaybackRate.toFixed(2) }}x</label>
                <input class="range-control" v-model.number="meshPlaybackRate" type="range" min="0.25" max="4" step="0.25" />
              </div>
            </div>

            <div class="render-settings-group scene-effects-group">
              <button type="button" class="render-settings-header" @click="sceneEffectsExpanded = !sceneEffectsExpanded">
                <span class="render-settings-arrow" :class="{ expanded: sceneEffectsExpanded }">▶</span>
                <span>渲染场景效果</span>
              </button>

              <div v-show="sceneEffectsExpanded" class="render-settings-content scene-effects-content">
                <SceneEffectsPanel
                  class="render-scene-effects"
                  :rainstorm-enabled="sceneRainstormEnabled"
                  :river-runoff-enabled="sceneRiverRunoffEnabled"
                  :flood-render-enabled="sceneFloodRenderEnabled"
                  @toggle-rainstorm="emit('toggle-rainstorm')"
                  @toggle-river-runoff="emit('toggle-river-runoff')"
                  @toggle-flood-render="emit('toggle-flood-render')"
                />
              </div>
            </div>

            <div class="mesh-actions">
              <button class="btn btn-secondary" @click="flyToMeshFlood" :disabled="!currentFloodPrimitive">定位洪水</button>
            </div>

            <div class="mesh-status-card">
              <span class="mesh-file-name">{{ meshFileName }}</span>
              <p :class="meshStatus.includes('失败') ? 'error-text' : 'result-text'">{{ meshStatus }}</p>
            </div>
          </div>
        </div>
        <div v-else-if="activeItem === 'params'">
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

    <div v-if="meshPlaybackDockVisible && meshFrames.length" class="mesh-playback-combined">
    <div v-if="meshDepthLegendVisible" class="mesh-depth-legend">
      <button type="button" class="floating-close-btn legend-close-btn" title="关闭" aria-label="关闭水深图例" @click="hideMeshDepthLegend">×</button>
      <strong>水深</strong>
      <span>{{ meshDepthLegend.max }}</span>
      <div class="depth-gradient"></div>
      <span>{{ meshDepthLegend.mid }}</span>
      <span>{{ meshDepthLegend.min }}</span>
    </div>

    <div v-if="meshPlaybackDockVisible && meshFrames.length" class="mesh-playback-dock">
      <div class="playback-dock-header">
        <h4>{{ meshPlaybackTitle }}</h4>
        <div class="dock-header-actions">
          <span class="playback-status-pill">{{ meshPlaybackStatusText }}</span>
          <button type="button" class="dock-close-btn" title="关闭" aria-label="关闭控制框" @pointerdown.stop @click="hideMeshPlaybackDock">×</button>
        </div>
      </div>

      <div class="playback-main-row">
        <input
          class="playback-progress"
          type="range"
          min="0"
          :max="Math.max(meshFrames.length - 1, 0)"
          :value="activeMeshFrameIndex"
          step="1"
          @change="seekMeshFrame"
        />
        <div class="playback-readout">
          <strong>{{ activeMeshFrameIndex + 1 }} / {{ meshFrames.length }}</strong>
          <span>演进时间 {{ meshEvolutionTimeText }}</span>
        </div>
      </div>

      <div class="playback-primary-actions">
        <button class="dock-action-btn" @click="restartMeshPlayback" :disabled="!meshFrames.length || isMeshPlaying">开始</button>
        <button class="dock-action-btn" @click="toggleMeshPlayback" :disabled="!meshFrames.length || isMeshPlaying || isMeshPreloading">继续</button>
        <button class="dock-action-btn active" @click="stopMeshPlayback" :disabled="!isMeshPlaying">暂停</button>
        <button class="dock-action-btn danger" @click="clearMeshFlood">结束</button>
      </div>

      <div class="playback-secondary-actions">
        <button type="button" @click="jumpMeshFrame(-30)" :disabled="!meshFrames.length">后退</button>
        <button type="button" @click="renderPreviousMeshFrame" :disabled="!meshFrames.length">上一帧</button>
        <button type="button" @click="renderNextMeshFrame" :disabled="!meshFrames.length">下一帧</button>
        <button type="button" @click="jumpMeshFrame(30)" :disabled="!meshFrames.length">快进</button>
      </div>
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
  left: 360px;
  width: 320px;
  max-height: calc(100vh - 120px);
  background-color: var(--sys-glass-bg, rgba(4, 20, 37, 0.95));
  border: 1px solid var(--sys-border-color, #00e5ff);
  border-radius: 8px;
  color: white;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  padding: 18px 15px 15px;
  overflow-y: auto;
  backdrop-filter: blur(10px);
  z-index: 9999;
}

.floating-close-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  margin: 0;
  padding: 0;
  color: #bae6fd;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 50%;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  z-index: 2;
}

.floating-close-btn:hover {
  color: #ffffff;
  background: rgba(239, 68, 68, 0.22);
  border-color: rgba(239, 68, 68, 0.45);
}

.tool-close-btn {
  position: absolute;
  top: 10px;
  right: 10px;
}

.legend-close-btn {
  position: absolute;
  top: 7px;
  right: 7px;
  width: 20px;
  height: 20px;
  font-size: 15px;
}

.mesh-playback-combined {
  pointer-events: auto;
  position: fixed;
  right: 20px;
  top: auto;
  bottom: 90px;
  width: min(480px, calc(100vw - 40px));
  height: 224px;
  min-width: min(430px, calc(100vw - 40px));
  min-height: 176px;
  max-width: calc(100vw - 40px);
  max-height: calc(100vh - 96px);
  box-sizing: border-box;
  display: flex;
  align-items: stretch;
  border: 1px solid rgba(0, 229, 255, 0.2);
  border-radius: 12px;
  color: #e0f2fe;
  background: rgba(8, 22, 38, 0.75);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5), inset 0 1px 1px rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(12px);
  z-index: 10040;
  overflow: hidden;
  resize: both;
}

.mesh-playback-dock {
  pointer-events: auto;
  position: relative;
  order: 1;
  flex: 1 1 auto;
  width: auto;
  height: 100%;
  min-width: 0;
  min-height: 0;
  max-width: none;
  max-height: none;
  padding: 16px 20px;
  box-sizing: border-box;
  color: #e0f2fe;
  background: transparent;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  overflow: auto;
}

.playback-dock-header,
.playback-main-row,
.dock-header-actions,
.playback-primary-actions,
.playback-secondary-actions {
  display: flex;
  align-items: center;
}

.playback-dock-header {
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.playback-dock-header h4 {
  margin: 0;
  min-width: 0;
  overflow: hidden;
  color: #e0f2fe;
  font-size: 14px;
  font-weight: 600;
  line-height: 1;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.playback-dock-header h4::before {
  content: "";
  display: inline-block;
  width: 3px;
  height: 14px;
  margin-right: 6px;
  border-radius: 2px;
  vertical-align: -2px;
  background: #00e5ff;
  box-shadow: 0 0 6px rgba(0, 229, 255, 0.6);
}

.dock-header-actions {
  gap: 8px;
}

.playback-status-pill {
  padding: 2px 10px;
  border: 1px solid rgba(0, 229, 255, 0.25);
  border-radius: 10px;
  color: #00e5ff;
  background: rgba(0, 229, 255, 0.1);
  text-align: center;
  font-size: 12px;
  font-weight: 500;
}

.dock-close-btn {
  width: 24px;
  height: 24px;
  margin: 0;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 50%;
  color: #bae6fd;
  background: rgba(255, 255, 255, 0.06);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
}

.playback-main-row {
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
  padding: 0;
}

.playback-progress {
  flex: 1;
  min-width: 0;
  accent-color: #00e5ff;
}

.playback-readout {
  flex: 0 0 136px;
  min-width: 0;
  color: #67e8f9;
  text-align: right;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-variant-numeric: tabular-nums;
}

.playback-readout strong,
.playback-readout span {
  display: block;
}

.playback-readout strong {
  color: #bae6fd;
  font-size: 12px;
}

.playback-readout span {
  margin-top: 3px;
  font-size: 11px;
}

.playback-primary-actions {
  justify-content: center;
  gap: 8px;
  padding-bottom: 0;
  border-bottom: 0;
  flex-wrap: wrap;
}

.dock-action-btn {
  min-width: 60px;
  height: auto;
  padding: 6px 12px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 4px;
  color: #e0f2fe;
  background: rgba(255, 255, 255, 0.05);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
}

.dock-action-btn.active {
  border-color: rgba(127, 182, 213, 0.52);
}

.dock-action-btn.danger {
  border-color: rgba(239, 68, 68, 0.3);
  color: #fca5a5;
  background: rgba(239, 68, 68, 0.15);
}

.dock-action-btn:disabled,
.playback-secondary-actions button:disabled {
  opacity: 0.42;
  cursor: not-allowed;
}

.playback-secondary-actions {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 4px;
  width: 100%;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed rgba(255, 255, 255, 0.08);
}

.playback-secondary-actions button {
  min-width: 0;
  padding: 6px 2px;
  border: 1px solid transparent;
  border-radius: 4px;
  color: #7dd3fc;
  background: transparent;
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
}

.mesh-depth-legend {
  pointer-events: auto;
  position: relative;
  order: 2;
  flex: 0 0 104px;
  width: 104px;
  height: 100%;
  min-width: 96px;
  min-height: 0;
  max-width: 180px;
  max-height: none;
  padding: 12px 10px;
  box-sizing: border-box;
  border-left: 1px solid rgba(0, 229, 255, 0.18);
  display: grid;
  grid-template-columns: auto 1fr;
  grid-template-rows: auto auto 1fr auto;
  column-gap: 8px;
  align-items: center;
  color: #e0f2fe;
  background: rgba(255, 255, 255, 0.015);
  overflow: auto;
}

.mesh-depth-legend strong {
  grid-column: 1 / -1;
  margin-bottom: 8px;
  color: #bae6fd;
  text-align: center;
  font-size: 12px;
  font-weight: 600;
}

.depth-gradient {
  grid-row: 2 / 5;
  width: 18px;
  height: 128px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 5px;
  background: linear-gradient(to bottom, rgb(9, 9, 145) 0%, rgb(54, 44, 163) 24%, rgb(101, 101, 191) 50%, rgb(151, 179, 222) 74%, rgb(182, 237, 240) 100%);
  box-shadow: inset 0 0 8px rgba(0, 0, 0, 0.35), 0 0 10px rgba(0, 229, 255, 0.18);
}

.mesh-depth-legend span {
  color: #dbeafe;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 11px;
  line-height: 1;
  white-space: nowrap;
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
  padding: 0 34px 8px 0;
  color: var(--sys-theme-color, #00e5ff);
  font-size: 16px;
  text-shadow: var(--sys-text-glow);
}

.tool-block h5 {
  margin: 0 0 10px 0;
  border-bottom: 1px solid var(--sys-border-color, #00e5ff);
  padding: 0 34px 8px 0;
  color: var(--sys-theme-color, #00e5ff);
  font-size: 16px;
  line-height: 1.35;
  text-shadow: var(--sys-text-glow);
}

.tool-block form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.tool-block .form-group {
  margin-bottom: 0;
}

.tool-block .btn {
  align-self: flex-start;
  margin-top: 4px;
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

.path-row {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 12px;
}

.path-row .form-control {
  flex: 1;
  min-width: 0;
}

.path-btn {
  flex: 0 0 auto;
  margin-top: 0;
  white-space: nowrap;
}

.range-control {
  width: 100%;
  margin: 2px 0 12px;
  accent-color: var(--sys-theme-color, #00e5ff);
}

.render-flood-content {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.render-flood-content .form-label {
  margin: 0;
  color: #bdd4df;
  font-size: 12px;
}

.render-flood-content .path-row {
  margin-bottom: 2px;
  gap: 8px;
}

.render-flood-content .form-control {
  min-height: 36px;
  border-color: rgba(0, 229, 255, 0.12);
  background: rgba(3, 14, 24, 0.72);
  font-weight: 600;
}

.render-flood-content .path-btn {
  min-height: 36px;
  padding: 0 14px;
  border-color: rgba(255, 255, 255, 0.24);
}

.mesh-stats {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin: 4px 0 0;
}

.mesh-stats div {
  min-height: 58px;
  padding: 10px 12px;
  border: 1px solid rgba(0, 229, 255, 0.13);
  border-radius: 6px;
  background: linear-gradient(145deg, rgba(6, 24, 37, 0.78), rgba(2, 12, 22, 0.58));
  box-shadow: inset 0 0 14px rgba(0, 229, 255, 0.035);
}

.mesh-stats span {
  display: block;
  margin-bottom: 5px;
  color: #9ca3af;
  font-size: 11px;
}

.mesh-stats strong {
  display: block;
  color: #e5f9ff;
  font-size: 15px;
  font-weight: 800;
  line-height: 1.3;
  word-break: break-word;
}

.area-readout {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: -2px 0 14px;
  padding: 10px 12px;
  border: 1px solid rgba(0, 229, 255, 0.22);
  border-radius: 4px;
  background: rgba(0, 229, 255, 0.08);
}

.time-readout {
  margin-top: -6px;
}

.area-readout span {
  color: #9ca3af;
  font-size: 12px;
}

.area-readout strong {
  color: var(--sys-theme-color, #00e5ff);
  font-size: 14px;
  line-height: 1.3;
  text-align: right;
  word-break: break-word;
}

.render-settings-group {
  margin: 2px 0 4px;
  padding: 10px 12px;
  border: 1px solid rgba(0, 229, 255, 0.16);
  border-radius: 6px;
  background: rgba(3, 18, 32, 0.42);
}

.render-settings-header {
  display: flex;
  align-items: center;
  width: 100%;
  padding: 0;
  border: 0;
  color: #bdeeff;
  background: transparent;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  text-align: left;
}

.render-settings-header::after {
  content: "";
  flex: 1;
  height: 1px;
  margin-left: 10px;
  background: linear-gradient(90deg, rgba(0, 229, 255, 0.28), transparent);
}

.render-settings-arrow {
  display: inline-block;
  width: 18px;
  height: 18px;
  margin-right: 6px;
  border: 1px solid rgba(0, 229, 255, 0.24);
  border-radius: 50%;
  color: var(--sys-theme-color, #00e5ff);
  background: rgba(0, 229, 255, 0.08);
  font-size: 10px;
  line-height: 17px;
  text-align: center;
  transition: transform 0.2s ease;
}

.render-settings-arrow.expanded {
  transform: rotate(90deg);
}

.render-settings-content {
  padding: 10px 0 0;
}

.render-settings-content .form-label {
  margin-top: 8px;
  color: #a8bed0;
  font-size: 12px;
}

.scene-effects-group {
  padding-bottom: 8px;
}

.scene-effects-content {
  padding-top: 10px;
}

.scene-effects-content :deep(.render-scene-effects.scene-effects-panel) {
  width: 100%;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  backdrop-filter: none;
}

.scene-effects-content :deep(.panel-heading) {
  display: none;
}

.scene-effects-content :deep(.effect-toggle) {
  min-height: 50px;
  margin-bottom: 8px;
  border-color: rgba(0, 229, 255, 0.14);
  background: linear-gradient(145deg, rgba(6, 24, 37, 0.78), rgba(2, 12, 22, 0.58));
}

.scene-effects-content :deep(.effect-toggle:hover),
.scene-effects-content :deep(.effect-toggle.active) {
  border-color: rgba(0, 229, 255, 0.42);
  background: rgba(0, 229, 255, 0.09);
}

.scene-effects-content :deep(.effect-icon) {
  background: rgba(0, 229, 255, 0.08);
}

.scene-effects-content :deep(.effect-slots) {
  gap: 7px;
}

.scene-effects-content :deep(.effect-slots span),
.scene-effects-content :deep(.effect-slots button) {
  min-height: 30px;
  border-color: rgba(0, 229, 255, 0.14);
  background: rgba(0, 229, 255, 0.035);
}

.mesh-actions {
  display: flex;
  margin: 0 0 2px;
}

.mesh-actions .btn {
  width: 100%;
  min-height: 36px;
  padding: 6px 12px;
  margin: 0;
  border-color: rgba(0, 229, 255, 0.28);
  border-radius: 6px;
  color: #8fe9ff;
  background: rgba(0, 229, 255, 0.055);
  font-size: 13px;
  font-weight: 600;
  box-shadow: none;
}

.mesh-actions .btn::before {
  content: "";
  width: 6px;
  height: 6px;
  margin-right: 6px;
  display: inline-block;
  border: 2px solid currentColor;
  border-radius: 50%;
  vertical-align: 1px;
}

.mesh-actions .btn:hover:not(:disabled) {
  color: #ffffff;
  border-color: rgba(0, 229, 255, 0.5);
  background: rgba(0, 229, 255, 0.14);
}

.mesh-status-card {
  margin-top: 4px;
  padding: 10px 12px;
  border: 1px solid rgba(0, 229, 255, 0.12);
  border-radius: 6px;
  background: rgba(2, 13, 23, 0.42);
}

.mesh-file-name {
  display: block;
  margin-bottom: 6px;
  color: #9eb4c3;
  font-size: 12px;
  line-height: 1.3;
  word-break: break-word;
}

.mesh-status-card p {
  margin: 0;
  white-space: pre-wrap;
  font-size: 12px;
  line-height: 1.45;
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
