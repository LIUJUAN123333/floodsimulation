<script setup lang="ts">
import { ref } from 'vue';
import * as Cesium from 'cesium';
import DrawTriangleMesh from '../js/DrawTriangleMesh';
import * as proj4 from 'proj4';
import { lastLoadedFloodJson, floodCellSize, currentFloodPrimitive, floodPlaybackToken } from '../store/floodState';
import StyledFileInput from './StyledFileInput.vue';

type Proj4Like = {
  defs: (name: string, projection: string) => void;
  (fromProjection: string, toProjection: string, coordinate: [number, number]): [number, number];
};

const proj4Lib = ((proj4 as unknown as { default?: unknown }).default ?? proj4) as unknown as Proj4Like;

const props = defineProps({
  viewer: {
    type: Object as () => Cesium.Viewer,
    required: true
  }
});

const isLoading = ref(false);
const frameIntervalMs = 10;
const ascFile = ref<File | null>(null);
const utmZone = ref<number>(48);
const parsedCellsize = ref<number | null>(null);
const coordMessage = ref('');
const floodFiles = ref<File[]>([]);

type ShowcaseCaseId = 'jinshajiang' | 'xiaojiaqiao';

type ShowcaseManifest = {
  success: boolean;
  caseId: ShowcaseCaseId;
  name: string;
  utmZone: number;
  ascFile: string;
  xmlFile: string;
  jsonCount: number;
  fileBaseUrl: string;
  message?: string;
};

type ShowcasePlaybackOptions = {
  initialBufferCount: number;
  prefetchCount: number;
  frameIntervalMs: number;
};

type AscHeader = {
  ncols: number;
  nrows: number;
  xllcorner: number;
  yllcorner: number;
  cellsize: number;
};

type LonLatBounds = {
  west: number;
  east: number;
  south: number;
  north: number;
  centerLon: number;
  centerLat: number;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

const encodeFileName = (fileName: string) => fileName.split('/').map(encodeURIComponent).join('/');

const fetchText = async (url: string) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`读取失败 ${response.status}: ${url}`);
  }
  return response.text();
};

const fetchJson = async (url: string) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`读取失败 ${response.status}: ${url}`);
  }
  return response.json();
};

const getShowcasePlaybackOptions = (caseId: ShowcaseCaseId): ShowcasePlaybackOptions => {
  if (caseId === 'jinshajiang') {
    return {
      initialBufferCount: 80,
      prefetchCount: 12,
      frameIntervalMs: 8
    };
  }

  return {
    initialBufferCount: 8,
    prefetchCount: 2,
    frameIntervalMs: 12
  };
};

const nextPlaybackToken = () => {
  floodPlaybackToken.value += 1;
  return floodPlaybackToken.value;
};

const isPlaybackCurrent = (token: number) => token === floodPlaybackToken.value;

const removeCurrentFloodPrimitive = () => {
  if (currentFloodPrimitive.value) {
    props.viewer.scene.primitives.remove(currentFloodPrimitive.value);
    currentFloodPrimitive.value = null;
  }
};

const parseAscHeader = (text: string): AscHeader => {
  const headerMap: Record<string, number> = {};
  const lines = text.split(/\r?\n/).slice(0, 20);

  for (const line of lines) {
    const match = line.trim().match(/^([A-Za-z_]+)\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)$/);
    if (!match) {
      continue;
    }
    const key = match[1].toLowerCase();
    const value = Number(match[2]);
    if (Number.isFinite(value)) {
      headerMap[key] = value;
    }
  }

  const requiredKeys: Array<keyof AscHeader> = ['ncols', 'nrows', 'xllcorner', 'yllcorner', 'cellsize'];
  for (const key of requiredKeys) {
    if (!Number.isFinite(headerMap[key])) {
      throw new Error(`ASC 头部缺少或无法识别字段：${key}`);
    }
  }

  return {
    ncols: headerMap.ncols,
    nrows: headerMap.nrows,
    xllcorner: headerMap.xllcorner,
    yllcorner: headerMap.yllcorner,
    cellsize: headerMap.cellsize
  };
};

const calcLonLatByAscHeader = (ascHeader: AscHeader, zone: number): LonLatBounds => {
  if (!Number.isInteger(zone) || zone < 1 || zone > 60) {
    throw new Error('投影带号必须是 1-60 的整数');
  }

  if (typeof proj4Lib !== 'function' || typeof proj4Lib.defs !== 'function') {
    throw new Error('proj4 初始化失败，请检查依赖加载');
  }

  const zoneCode = String(zone).padStart(2, '0');
  const epsgCode = `EPSG:326${zoneCode}`;
  proj4Lib.defs(epsgCode, `+proj=utm +zone=${zone} +datum=WGS84 +units=m +no_defs`);

  const xmin = ascHeader.xllcorner;
  const ymin = ascHeader.yllcorner;
  const xmax = ascHeader.xllcorner + ascHeader.ncols * ascHeader.cellsize;
  const ymax = ascHeader.yllcorner + ascHeader.nrows * ascHeader.cellsize;

  const corners = [
    [xmin, ymin],
    [xmin, ymax],
    [xmax, ymin],
    [xmax, ymax]
  ];

  const lonLat = corners.map(([x, y]) => proj4Lib(epsgCode, 'WGS84', [x, y]));
  const lons = lonLat.map(([lon]) => lon);
  const lats = lonLat.map(([, lat]) => lat);

  const west = Math.min(...lons);
  const east = Math.max(...lons);
  const south = Math.min(...lats);
  const north = Math.max(...lats);

  return {
    west,
    east,
    south,
    north,
    centerLon: (west + east) / 2,
    centerLat: (south + north) / 2
  };
};

const handleFloodDirChange = (event: Event) => {
  const target = event.target as HTMLInputElement;
  if (target.files) {
    floodFiles.value = Array.from(target.files);
  } else {
    floodFiles.value = [];
  }
};

const handleAscFileChange = async (event: Event) => {
  const target = event.target as HTMLInputElement;
  ascFile.value = target.files?.[0] ?? null;
  parsedCellsize.value = null;

  if (!ascFile.value) {
    return;
  }

  try {
    const ascText = await ascFile.value.text();
    const ascHeader = parseAscHeader(ascText);
    parsedCellsize.value = ascHeader.cellsize;
    floodCellSize.value = ascHeader.cellsize;
    DrawTriangleMesh.setGridCellSize(ascHeader.cellsize);
  } catch (error) {
    console.error('解析 ASC 头部失败:', error);
    parsedCellsize.value = null;
  }
};

const parseFloodUrlsFromXml = (xmlText: string) => {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlText, "text/xml");
  const parseError = xmlDoc.querySelector('parsererror');
  if (parseError) {
    throw new Error('XML 配置文件解析失败');
  }

  return Array.from(xmlDoc.getElementsByTagName("flood"))
    .map((item) => item.getAttribute("url"))
    .filter((url): url is string => Boolean(url));
};

const prepareFloodScene = (ascText: string, zone: number, label: string) => {
  const ascHeader = parseAscHeader(ascText);
  parsedCellsize.value = ascHeader.cellsize;
  floodCellSize.value = ascHeader.cellsize;
  DrawTriangleMesh.setGridCellSize(ascHeader.cellsize);
  utmZone.value = zone;

  const bounds = calcLonLatByAscHeader(ascHeader, zone);
  const centerPos = Cesium.Cartesian3.fromDegrees(bounds.west, bounds.north, 0);
  DrawTriangleMesh.setFloodCenterPosition(centerPos);
  coordMessage.value = `${label} 坐标识别成功：西经度 ${bounds.west.toFixed(6)}，北纬度 ${bounds.north.toFixed(6)}`;

  props.viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(bounds.centerLon, bounds.centerLat, 20000),
    duration: 0.8
  });

  removeCurrentFloodPrimitive();

  return bounds;
};

const renderFloodFrames = async (
  token: number,
  floodUrls: string[],
  readJsonData: (url: string) => Promise<any>
) => {
  let firstPrimitive: Cesium.Primitive | null = null;

  for (const url of floodUrls) {
    if (!isPlaybackCurrent(token)) {
      break;
    }

    const jsonData = await readJsonData(url);
    if (!isPlaybackCurrent(token)) {
      break;
    }

    lastLoadedFloodJson.value = jsonData;
    const primitive = DrawTriangleMesh(jsonData);

    removeCurrentFloodPrimitive();

    currentFloodPrimitive.value = primitive;
    props.viewer.scene.primitives.add(primitive);

    if (!firstPrimitive) {
      firstPrimitive = primitive;
    }

    console.log("Flood data loaded and rendered:", url);
    await sleep(frameIntervalMs);
  }

  return firstPrimitive;
};

const flyToFirstPrimitive = (firstPrimitive: Cesium.Primitive | null, bounds: LonLatBounds) => {
  if (!firstPrimitive) {
    return;
  }

  const primitiveWithBound = firstPrimitive as Cesium.Primitive & {
    _boundingSphereWorld?: Cesium.BoundingSphere;
  };
  if (primitiveWithBound._boundingSphereWorld) {
    props.viewer.camera.flyToBoundingSphere(primitiveWithBound._boundingSphereWorld, {
      duration: 1.2,
      offset: new Cesium.HeadingPitchRange(0.0, -0.7, primitiveWithBound._boundingSphereWorld.radius * 3.0)
    });
  } else {
    props.viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(bounds.centerLon, bounds.centerLat, 20000)
    });
  }
};

const loadFloodData = async () => {
  if (isLoading.value) return;
  if (!ascFile.value) {
    coordMessage.value = '请先上传 ASC 文件';
    return;
  }
  if (floodFiles.value.length === 0) {
    coordMessage.value = '请先选择洪水数据目录';
    return;
  }

  isLoading.value = true;
  const token = nextPlaybackToken();

  try {
    const ascText = await ascFile.value.text();
    const bounds = prepareFloodScene(ascText, utmZone.value, '识别');

    // 1. 读取 XML 索引
    const xmlFile = floodFiles.value.find(f => f.name.toLowerCase().endsWith('.xml'));
    if (!xmlFile) {
      coordMessage.value = '错误：未在选中目录内找到 XML 配置文件';
      isLoading.value = false;
      return;
    }
    const xmlText = await xmlFile.text();
    const floodUrls = parseFloodUrlsFromXml(xmlText);

    if (floodUrls.length === 0) {
      console.error("No valid flood urls found in XML");
      return;
    }

    const firstPrimitive = await renderFloodFrames(token, floodUrls, async (url) => {
      const jsonFile = floodFiles.value.find(f => f.name === url || f.webkitRelativePath.endsWith(url));
      if (!jsonFile) {
        throw new Error(`未找到名为 ${url} 的数据文件`);
      }

      const jsonText = await jsonFile.text();
      return JSON.parse(jsonText);
    });

    // 视角定位到第一份数据包围球，避免固定经纬度偏差
    flyToFirstPrimitive(firstPrimitive, bounds);
    console.log("Flood files played:", floodUrls.length);
  } catch (error) {
    console.error("Error loading flood data:", error);
    coordMessage.value = error instanceof Error ? error.message : '洪水数据加载失败';
  } finally {
    if (isPlaybackCurrent(token)) {
      isLoading.value = false;
    }
  }
};

const resetFloodData = () => {
  nextPlaybackToken();
  removeCurrentFloodPrimitive();
  lastLoadedFloodJson.value = null;
  floodCellSize.value = 0;
  isLoading.value = false;
  coordMessage.value = '';
};

const renderPrefetchedFloodFrames = async (
  token: number,
  floodUrls: string[],
  readJsonData: (url: string) => Promise<any>,
  options: ShowcasePlaybackOptions
) => {
  const preloadQueue = new Map<string, Promise<any>>();
  let firstPrimitive: Cesium.Primitive | null = null;

  const preloadFrom = (startIndex: number) => {
    const endIndex = Math.min(floodUrls.length, startIndex + options.prefetchCount);
    for (let i = startIndex; i < endIndex; i += 1) {
      const url = floodUrls[i];
      if (!preloadQueue.has(url)) {
        preloadQueue.set(url, readJsonData(url));
      }
    }
  };

  const initialBufferCount = Math.min(floodUrls.length, options.initialBufferCount);
  preloadFrom(0);
  for (let index = 0; index < initialBufferCount; index += 1) {
    if (!isPlaybackCurrent(token)) {
      return null;
    }
    preloadFrom(index);
    const url = floodUrls[index];
    await (preloadQueue.get(url) ?? readJsonData(url));
  }
  coordMessage.value = '缓冲完成，正在播放案例数据...';

  for (let index = 0; index < floodUrls.length; index += 1) {
    if (!isPlaybackCurrent(token)) {
      break;
    }

    preloadFrom(index);
    const url = floodUrls[index];
    const jsonData = await (preloadQueue.get(url) ?? readJsonData(url));
    preloadQueue.delete(url);

    if (!isPlaybackCurrent(token)) {
      break;
    }

    lastLoadedFloodJson.value = jsonData;
    const primitive = DrawTriangleMesh(jsonData);
    removeCurrentFloodPrimitive();

    currentFloodPrimitive.value = primitive;
    props.viewer.scene.primitives.add(primitive);

    if (!firstPrimitive) {
      firstPrimitive = primitive;
    }

    console.log("Flood data loaded and rendered:", url);
    await sleep(options.frameIntervalMs);
    await nextFrame();
  }

  return firstPrimitive;
};

const playShowcase = async (caseId: ShowcaseCaseId) => {
  if (isLoading.value) {
    nextPlaybackToken();
  }

  isLoading.value = true;
  const token = nextPlaybackToken();

  try {
    coordMessage.value = '正在读取案例数据...';
    const manifest = await fetchJson(`http://localhost:5000/api/showcase/${caseId}/manifest`) as ShowcaseManifest;
    if (!manifest.success) {
      throw new Error(manifest.message || '案例清单读取失败');
    }

    const ascText = await fetchText(`${manifest.fileBaseUrl}/${encodeFileName(manifest.ascFile)}`);
    const bounds = prepareFloodScene(ascText, manifest.utmZone, manifest.name);

    const xmlText = await fetchText(`${manifest.fileBaseUrl}/${encodeFileName(manifest.xmlFile)}`);
    const floodUrls = parseFloodUrlsFromXml(xmlText);
    if (floodUrls.length === 0) {
      throw new Error('案例 XML 中没有有效洪水帧');
    }

    const playbackOptions = getShowcasePlaybackOptions(caseId);
    coordMessage.value = `正在缓冲 ${manifest.name}：共 ${floodUrls.length} 帧`;
    const firstPrimitive = await renderPrefetchedFloodFrames(token, floodUrls, (url) => (
      fetchJson(`${manifest.fileBaseUrl}/${encodeFileName(url)}`)
    ), playbackOptions);

    if (isPlaybackCurrent(token)) {
      flyToFirstPrimitive(firstPrimitive, bounds);
      coordMessage.value = `${manifest.name} 播放完成：共 ${floodUrls.length} 帧`;
    }
  } catch (error) {
    console.error("Error loading showcase flood data:", error);
    if (isPlaybackCurrent(token)) {
      coordMessage.value = error instanceof Error ? error.message : '案例数据加载失败';
    }
  } finally {
    if (isPlaybackCurrent(token)) {
      isLoading.value = false;
    }
  }
};

defineExpose({ playShowcase, resetFloodData });
</script>

<template>
  <div class="flood-controller">
    <label class="control-label">上传 ASC 文件</label>
    <StyledFileInput accept=".asc,.txt" button-text="选择 ASC" placeholder="未选择 ASC 文件" @change="handleAscFileChange" />

    <label class="control-label">输入投影带号（1-60）</label>
    <input v-model.number="utmZone" type="number" min="1" max="60">

    <label class="control-label">识别像元大小（cellsize）</label>
    <input :value="parsedCellsize ?? ''" type="number" readonly placeholder="未读取">

    <label class="control-label">选择洪水数据目录</label>
    <StyledFileInput directory button-text="选择目录" placeholder="未选择洪水数据目录" @change="handleFloodDirChange" />

    <p v-if="coordMessage" class="coord-message">{{ coordMessage }}</p>

    <button @click="loadFloodData" :disabled="isLoading || !ascFile || floodFiles.length === 0">
      {{ isLoading ? '加载中...' : '加载并渲染洪水数据' }}
    </button>
  </div>
</template>

<style scoped>
.flood-controller {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}

.control-label {
  color: white;
  font-size: 12px;
}

input[type="number"] {
  color: white;
  background-color: #0f2439;
  border: 1px solid #31467D;
  border-radius: 4px;
  padding: 6px;
}

.coord-message {
  margin: 0;
  color: #9be7ff;
  font-size: 12px;
}

button {
  padding: 10px 12px;
  background-color: #0078d4;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  box-shadow: 0 2px 5px rgba(0,0,0,0.3);
}

button:hover {
  background-color: #005a9e;
}

button:disabled {
  background-color: #cccccc;
  cursor: not-allowed;
}
</style>
