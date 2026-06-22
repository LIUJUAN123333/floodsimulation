<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref } from 'vue';
import * as Cesium from 'cesium';
import DrawTriangleMesh from '../js/DrawTriangleMesh';
import * as proj4 from 'proj4';
import {
  lastLoadedFloodJson,
  currentShowcaseCaseId,
  floodCellSize,
  currentFloodPrimitive,
  floodPlaybackToken,
  clearFloodDepthMonitorPoint,
  recordFloodAreaPoint,
  recordFloodPointDepth,
  resetFloodAreaSeries,
  resetFloodPointDepthSeries
} from '../store/floodState';
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

defineOptions({
  inheritAttrs: false
});

const isLoading = ref(false);
const frameIntervalMs = 10;
const ascFile = ref<File | null>(null);
const utmZone = ref<number>(48);
const parsedCellsize = ref<number | null>(null);
const coordMessage = ref('');
const floodFiles = ref<File[]>([]);

type ShowcaseCaseId = 'yongchuan' | 'jinshajiang' | 'xiaojiaqiao' | 'bonn';

type ShowcaseManifest = {
  success: boolean;
  caseId: ShowcaseCaseId;
  name: string;
  utmZone: number;
  ascFile: string | null;
  xmlFile: string;
  xmlDir?: string;
  jsonBaseDir?: string;
  center?: {
    lon: number;
    lat: number;
    height?: number;
  };
  cameraCenter?: {
    lon: number;
    lat: number;
    height?: number;
  };
  anchorOffset?: {
    east?: number;
    north?: number;
    up?: number;
  };
  headingOffsetDegrees?: number;
  cellSize?: number;
  jsonCount: number;
  xmlJsonCount?: number;
  missingJsonCount?: number;
  excludedJsonCount?: number;
  floodUrls?: string[];
  floodFrameSizes?: number[];
  totalJsonBytes?: number;
  maxJsonBytes?: number;
  fileBaseUrl: string;
  message?: string;
};

type ShowcasePlaybackOptions = {
  initialBufferCount: number;
  prefetchCount: number;
  initialBufferBytes: number;
  prefetchBytes: number;
  startupBufferCount: number;
  startupBufferBytes: number;
  frameIntervalMs: number;
  statsIntervalFrames: number;
  uiIntervalFrames: number;
  frameSizes?: number[];
};

type ShowcasePlaybackStatus = 'idle' | 'buffering' | 'playing' | 'paused' | 'seeking' | 'ended';

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
const waitForFrames = async (frameCount: number) => {
  for (let index = 0; index < frameCount; index += 1) {
    await nextFrame();
  }
};
const MB = 1024 * 1024;
const SHOWCASE_STATS_INTERVAL_FRAMES = 4;
const SHOWCASE_UI_INTERVAL_FRAMES = 4;
const SHOWCASE_FIRST_FRAME_WARMUP_FRAMES = 3;
const SHOWCASE_PREFETCH_CONCURRENCY = 6;
const SHOWCASE_CACHE_BACK_FRAMES = 20;
const SHOWCASE_CACHE_AHEAD_FRAMES = 180;
const activeShowcaseFetchControllers = new Set<AbortController>();
const showcaseDockRef = ref<HTMLElement | null>(null);

const showcasePlayback = reactive({
  visible: false,
  status: 'idle' as ShowcasePlaybackStatus,
  caseId: null as ShowcaseCaseId | null,
  caseName: '',
  currentIndex: 0,
  sliderIndex: 0,
  totalFrames: 0,
  cacheLoadedFrames: 0,
  cacheTargetFrames: 0,
  cacheLoadedBytes: 0,
  cacheTargetBytes: 0,
  pendingSeekIndex: null as number | null,
  resumeAfterSeek: true,
  pauseAfterNextFrame: false
});

const showcaseDockPosition = reactive({
  left: 28,
  top: null as number | null
});
const showcaseDockDrag = reactive({
  active: false,
  offsetX: 0,
  offsetY: 0
});

const SHOWCASE_FAST_STEP_FRAMES = 30;
const SHOWCASE_FRAME_SECONDS = 100;
const formatShowcaseElapsedTime = (frameIndex: number) => {
  const totalSeconds = Math.max(0, Math.round(frameIndex)) * SHOWCASE_FRAME_SECONDS;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
};
const showcaseDockStyle = computed(() => (
  showcaseDockPosition.top === null
    ? { left: `${showcaseDockPosition.left}px`, top: 'auto', bottom: '48px' }
    : { left: `${showcaseDockPosition.left}px`, top: `${showcaseDockPosition.top}px`, bottom: 'auto' }
));
const showcaseMaxFrameIndex = computed(() => Math.max(showcasePlayback.totalFrames - 1, 0));
const showcaseTimelineIndex = computed(() => (
  Math.min(
    Math.max(Math.round(Number(showcasePlayback.sliderIndex) || 0), 0),
    showcaseMaxFrameIndex.value
  )
));
const showcaseFrameLabel = computed(() => {
  if (!showcasePlayback.totalFrames) {
    return '0 / 0';
  }
  return `${showcaseTimelineIndex.value + 1} / ${showcasePlayback.totalFrames}`;
});
const showcaseEvolutionTimeLabel = computed(() => formatShowcaseElapsedTime(showcaseTimelineIndex.value));
const showcaseCachePercent = computed(() => (
  showcasePlayback.cacheTargetFrames > 0
    ? Math.min(100, Math.round((showcasePlayback.cacheLoadedFrames / showcasePlayback.cacheTargetFrames) * 100))
    : 0
));
const showcaseCacheBytesLabel = computed(() => {
  const loaded = formatBytes(showcasePlayback.cacheLoadedBytes) || '0 B';
  const target = formatBytes(showcasePlayback.cacheTargetBytes);
  return target ? `${loaded} / ${target}` : loaded;
});
const showcaseStatusText = computed(() => {
  const statusMap: Record<ShowcasePlaybackStatus, string> = {
    idle: '待开始',
    buffering: '缓冲中',
    playing: '播放中',
    paused: '已暂停',
    seeking: '跳转中',
    ended: '已结束'
  };
  return statusMap[showcasePlayback.status];
});

const waterDepthMax = computed(() => {
  const depthRange = lastLoadedFloodJson.value?.Depth?.[1];
  const maxDepth = Array.isArray(depthRange) ? Number(depthRange[1]) : 0;
  return Number.isFinite(maxDepth) && maxDepth > 0 ? maxDepth : 0;
});

const formatDepthValue = (value: number) => {
  if (!Number.isFinite(value)) {
    return '--';
  }

  return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)} m`;
};

const waterDepthLegendLabels = computed(() => {
  const maxDepth = waterDepthMax.value;
  return {
    max: maxDepth ? formatDepthValue(maxDepth) : '--',
    mid: maxDepth ? formatDepthValue(maxDepth / 2) : '--',
    min: '0.00 m'
  };
});

const clampShowcaseFrameIndex = (index: number) => {
  const maxIndex = showcaseMaxFrameIndex.value;
  if (!Number.isFinite(index)) {
    return 0;
  }
  return Math.min(Math.max(Math.round(index), 0), maxIndex);
};

const isShowcaseRunningStatus = (status: ShowcasePlaybackStatus) => (
  status === 'buffering' || status === 'playing' || status === 'seeking'
);

const abortShowcaseFetches = () => {
  activeShowcaseFetchControllers.forEach((controller) => controller.abort());
  activeShowcaseFetchControllers.clear();
};

const isAbortError = (error: unknown) => (
  error instanceof DOMException && error.name === 'AbortError'
);

const formatBytes = (bytes?: number) => {
  if (!Number.isFinite(bytes) || !bytes) {
    return '';
  }

  if (bytes >= 1024 * MB) {
    return `${(bytes / (1024 * MB)).toFixed(1)}GB`;
  }

  return `${(bytes / MB).toFixed(0)}MB`;
};

const flyToCameraCenter = (cameraCenter?: ShowcaseManifest['cameraCenter']) => new Promise<void>((resolve) => {
  if (!cameraCenter) {
    resolve();
    return;
  }

  props.viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(
      cameraCenter.lon,
      cameraCenter.lat,
      cameraCenter.height ?? 42000
    ),
    duration: 1.1,
    complete: resolve,
    cancel: resolve
  });
});

const encodeFileName = (fileName: string) => fileName.split('/').map(encodeURIComponent).join('/');

const joinRelativePath = (basePath: string | undefined, filePath: string) => {
  const normalizedFilePath = filePath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!basePath || normalizedFilePath.includes('/')) {
    return normalizedFilePath;
  }

  return `${basePath.replace(/\\/g, '/').replace(/\/+$/, '')}/${normalizedFilePath}`;
};

const fetchText = async (url: string) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`读取失败 ${response.status}: ${url}`);
  }
  return response.text();
};

const fetchJson = async (url: string, init?: RequestInit) => {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`读取失败 ${response.status}: ${url}`);
  }
  return response.json();
};

const fetchShowcaseJson = async (url: string) => {
  const controller = new AbortController();
  activeShowcaseFetchControllers.add(controller);
  try {
    return await fetchJson(url, { signal: controller.signal });
  } finally {
    activeShowcaseFetchControllers.delete(controller);
  }
};

const getShowcasePlaybackOptions = (caseId: ShowcaseCaseId, manifest?: ShowcaseManifest): ShowcasePlaybackOptions => {
  const frameSizes = manifest?.floodFrameSizes;
  const baseOptions = {
    initialBufferCount: 8,
    prefetchCount: 8,
    initialBufferBytes: 24 * MB,
    prefetchBytes: 40 * MB,
    startupBufferCount: 0,
    startupBufferBytes: 0,
    statsIntervalFrames: SHOWCASE_STATS_INTERVAL_FRAMES,
    uiIntervalFrames: SHOWCASE_UI_INTERVAL_FRAMES,
    frameSizes
  };

  if (caseId === 'xiaojiaqiao') {
    return {
      ...baseOptions,
      frameIntervalMs: 10
    };
  }

  if (caseId === 'jinshajiang') {
    return {
      ...baseOptions,
      frameIntervalMs: 8
    };
  }

  if (caseId === 'bonn') {
    return {
      ...baseOptions,
      frameIntervalMs: 10
    };
  }

  return {
    ...baseOptions,
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

const requestShowcaseSeek = (index: number, resumeAfterSeek = isShowcaseRunningStatus(showcasePlayback.status)) => {
  if (!showcasePlayback.totalFrames) {
    return;
  }

  const targetIndex = clampShowcaseFrameIndex(index);
  showcasePlayback.sliderIndex = targetIndex;
  showcasePlayback.pendingSeekIndex = targetIndex;
  showcasePlayback.resumeAfterSeek = resumeAfterSeek;

  if (showcasePlayback.status !== 'ended' && showcasePlayback.status !== 'idle') {
    showcasePlayback.status = 'seeking';
    abortShowcaseFetches();
  }
};

const handleShowcaseSliderInput = (event: Event) => {
  const target = event.target as HTMLInputElement;
  showcasePlayback.sliderIndex = clampShowcaseFrameIndex(Number(target.value));
};

const handleShowcaseSeekCommit = (event: Event) => {
  const target = event.target as HTMLInputElement;
  const targetIndex = clampShowcaseFrameIndex(Number(target.value));

  if (showcasePlayback.status === 'ended' || showcasePlayback.status === 'idle') {
    showcasePlayback.sliderIndex = targetIndex;
    showcasePlayback.currentIndex = targetIndex;
    return;
  }

  requestShowcaseSeek(targetIndex);
};

const handleShowcaseStart = () => {
  if (!showcasePlayback.caseId) {
    return;
  }

  if (showcasePlayback.status === 'ended' || showcasePlayback.status === 'idle') {
    const restartIndex = showcasePlayback.sliderIndex >= showcaseMaxFrameIndex.value
      ? 0
      : showcasePlayback.sliderIndex;
    void playShowcase(showcasePlayback.caseId, restartIndex);
  }
};

const handleShowcaseResume = () => {
  if (showcasePlayback.status === 'paused' || showcasePlayback.status === 'seeking') {
    showcasePlayback.status = 'playing';
    showcasePlayback.resumeAfterSeek = true;
    showcasePlayback.pauseAfterNextFrame = false;
  }
};

const handleShowcasePause = () => {
  if (isShowcaseRunningStatus(showcasePlayback.status)) {
    showcasePlayback.status = 'paused';
    showcasePlayback.resumeAfterSeek = false;
    showcasePlayback.pauseAfterNextFrame = false;
  }
};

const handleShowcaseStop = () => {
  if (showcasePlayback.status === 'idle' || showcasePlayback.status === 'ended') {
    return;
  }

  nextPlaybackToken();
  abortShowcaseFetches();
  removeCurrentFloodPrimitive();
  isLoading.value = false;
  showcasePlayback.status = 'ended';
  showcasePlayback.pendingSeekIndex = null;
  showcasePlayback.pauseAfterNextFrame = false;
  coordMessage.value = `${showcasePlayback.caseName || '案例'} 回放已结束`;
};

const handleShowcaseClose = () => {
  nextPlaybackToken();
  abortShowcaseFetches();
  removeCurrentFloodPrimitive();
  isLoading.value = false;
  showcasePlayback.visible = false;
  showcasePlayback.status = 'ended';
  showcasePlayback.pendingSeekIndex = null;
  showcasePlayback.pauseAfterNextFrame = false;
  coordMessage.value = '';
};

const jumpShowcaseFrames = (delta: number, pauseAfterJump: boolean) => {
  if (!showcasePlayback.caseId || showcasePlayback.totalFrames <= 0) {
    return;
  }

  const baseIndex = showcasePlayback.sliderIndex;
  const targetIndex = clampShowcaseFrameIndex(baseIndex + delta);

  if (showcasePlayback.status === 'ended' || showcasePlayback.status === 'idle') {
    showcasePlayback.pauseAfterNextFrame = pauseAfterJump;
    void playShowcase(showcasePlayback.caseId, targetIndex, { pauseOnFirstFrame: pauseAfterJump });
    return;
  }

  showcasePlayback.pauseAfterNextFrame = pauseAfterJump;
  requestShowcaseSeek(
    targetIndex,
    pauseAfterJump ? false : isShowcaseRunningStatus(showcasePlayback.status)
  );
};

const handleShowcaseRewind = () => {
  jumpShowcaseFrames(-SHOWCASE_FAST_STEP_FRAMES, false);
};

const handleShowcaseFastForward = () => {
  jumpShowcaseFrames(SHOWCASE_FAST_STEP_FRAMES, false);
};

const handleShowcasePreviousFrame = () => {
  jumpShowcaseFrames(-1, true);
};

const handleShowcaseNextFrame = () => {
  jumpShowcaseFrames(1, true);
};

const clampShowcaseDockPosition = (left: number, top: number) => {
  const dock = showcaseDockRef.value;
  const dockWidth = dock?.offsetWidth ?? 520;
  const dockHeight = dock?.offsetHeight ?? 220;
  const margin = 12;
  const maxLeft = Math.max(margin, window.innerWidth - dockWidth - margin);
  const maxTop = Math.max(margin, window.innerHeight - dockHeight - margin);

  return {
    left: Math.min(Math.max(left, margin), maxLeft),
    top: Math.min(Math.max(top, margin), maxTop)
  };
};

const stopShowcaseDockDrag = () => {
  if (!showcaseDockDrag.active) {
    return;
  }

  showcaseDockDrag.active = false;
  window.removeEventListener('pointermove', handleShowcaseDockDragMove);
  window.removeEventListener('pointerup', stopShowcaseDockDrag);
  window.removeEventListener('pointercancel', stopShowcaseDockDrag);
};

const handleShowcaseDockDragMove = (event: PointerEvent) => {
  if (!showcaseDockDrag.active) {
    return;
  }

  const nextPosition = clampShowcaseDockPosition(
    event.clientX - showcaseDockDrag.offsetX,
    event.clientY - showcaseDockDrag.offsetY
  );
  showcaseDockPosition.left = nextPosition.left;
  showcaseDockPosition.top = nextPosition.top;
};

const startShowcaseDockDrag = (event: PointerEvent) => {
  const target = event.target as HTMLElement | null;
  if (target?.closest('button,input')) {
    return;
  }

  const dock = showcaseDockRef.value;
  if (!dock) {
    return;
  }

  event.preventDefault();
  const rect = dock.getBoundingClientRect();
  showcaseDockDrag.active = true;
  showcaseDockDrag.offsetX = event.clientX - rect.left;
  showcaseDockDrag.offsetY = event.clientY - rect.top;
  showcaseDockPosition.left = rect.left;
  showcaseDockPosition.top = rect.top;
  window.addEventListener('pointermove', handleShowcaseDockDragMove);
  window.addEventListener('pointerup', stopShowcaseDockDrag);
  window.addEventListener('pointercancel', stopShowcaseDockDrag);
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
  DrawTriangleMesh.setHeadingOffsetDegrees(0);
  coordMessage.value = `${label} 坐标识别成功：西经度 ${bounds.west.toFixed(6)}，北纬度 ${bounds.north.toFixed(6)}`;

  props.viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(bounds.centerLon, bounds.centerLat, 20000),
    duration: 0.8
  });

  removeCurrentFloodPrimitive();

  return bounds;
};

const prepareFloodSceneFromManifest = (manifest: ShowcaseManifest): LonLatBounds => {
  const center = manifest.center;
  if (!center) {
    throw new Error('案例缺少中心点配置，且没有可用 ASC 文件');
  }

  const cellSize = manifest.cellSize ?? 20;
  parsedCellsize.value = cellSize;
  floodCellSize.value = cellSize;
  DrawTriangleMesh.setGridCellSize(cellSize);
  utmZone.value = manifest.utmZone;

  const height = center.height ?? 0;
  props.viewer.scene.globe.depthTestAgainstTerrain = true;
  const anchorPosition = Cesium.Cartesian3.fromDegrees(center.lon, center.lat, height);
  const anchorOffset = manifest.anchorOffset ?? {};
  const east = anchorOffset.east ?? 0;
  const north = anchorOffset.north ?? 0;
  const up = anchorOffset.up ?? 0;
  const headingOffsetDegrees = manifest.headingOffsetDegrees ?? 0;
  const offsetPosition = (east || north || up)
    ? Cesium.Matrix4.multiplyByPoint(
      Cesium.Transforms.eastNorthUpToFixedFrame(anchorPosition),
      new Cesium.Cartesian3(east, north, up),
      new Cesium.Cartesian3()
    )
    : anchorPosition;

  DrawTriangleMesh.setFloodCenterPosition(offsetPosition);
  DrawTriangleMesh.setHeadingOffsetDegrees(headingOffsetDegrees);
  coordMessage.value = `${manifest.name} 锚点已设置：经度 ${center.lon.toFixed(6)}，纬度 ${center.lat.toFixed(6)}，偏移 E${east}m N${north}m U${up}m，旋转 ${headingOffsetDegrees}°`;

  removeCurrentFloodPrimitive();

  return {
    west: center.lon,
    east: center.lon,
    south: center.lat,
    north: center.lat,
    centerLon: center.lon,
    centerLat: center.lat
  };
};

const renderFloodFrames = async (
  token: number,
  floodUrls: string[],
  readJsonData: (url: string) => Promise<any>
) => {
  let firstPrimitive: Cesium.Primitive | null = null;

  for (let index = 0; index < floodUrls.length; index += 1) {
    const url = floodUrls[index];
    if (!isPlaybackCurrent(token)) {
      break;
    }

    const jsonData = await readJsonData(url);
    if (!isPlaybackCurrent(token)) {
      break;
    }

    lastLoadedFloodJson.value = jsonData;
    recordFloodAreaPoint(index + 1, jsonData, floodCellSize.value);
    recordFloodPointDepth(index + 1, jsonData);
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

const flyToFirstPrimitive = (
  firstPrimitive: Cesium.Primitive | null,
  bounds: LonLatBounds,
  options: { legacyView?: boolean } = {}
) => {
  if (!firstPrimitive) {
    return;
  }

  const primitiveWithBound = firstPrimitive as Cesium.Primitive & {
    _boundingSphereWorld?: Cesium.BoundingSphere;
  };
  if (primitiveWithBound._boundingSphereWorld) {
    const cameraRange = options.legacyView
      ? primitiveWithBound._boundingSphereWorld.radius * 3.0
      : Math.max(primitiveWithBound._boundingSphereWorld.radius * 6, 18000);
    const cameraPitch = options.legacyView ? -0.7 : -0.75;
    props.viewer.camera.flyToBoundingSphere(primitiveWithBound._boundingSphereWorld, {
      duration: 1.2,
      offset: new Cesium.HeadingPitchRange(0.0, cameraPitch, cameraRange)
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
  resetFloodAreaSeries();
  resetFloodPointDepthSeries();

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
  abortShowcaseFetches();
  removeCurrentFloodPrimitive();
  lastLoadedFloodJson.value = null;
  floodCellSize.value = 0;
  resetFloodAreaSeries();
  clearFloodDepthMonitorPoint();
  DrawTriangleMesh.setHeadingOffsetDegrees(0);
  isLoading.value = false;
  coordMessage.value = '';
  showcasePlayback.visible = false;
  showcasePlayback.status = 'idle';
  showcasePlayback.caseId = null;
  currentShowcaseCaseId.value = null;
  showcasePlayback.caseName = '';
  showcasePlayback.currentIndex = 0;
  showcasePlayback.sliderIndex = 0;
  showcasePlayback.totalFrames = 0;
  showcasePlayback.cacheLoadedFrames = 0;
  showcasePlayback.cacheTargetFrames = 0;
  showcasePlayback.cacheLoadedBytes = 0;
  showcasePlayback.cacheTargetBytes = 0;
  showcasePlayback.pendingSeekIndex = null;
  showcasePlayback.resumeAfterSeek = true;
  showcasePlayback.pauseAfterNextFrame = false;
};

const renderPrefetchedFloodFrames = async (
  token: number,
  floodUrls: string[],
  readJsonData: (url: string) => Promise<any>,
  options: ShowcasePlaybackOptions,
  onFirstPrimitive?: (primitive: Cesium.Primitive) => void,
  startIndex = 0
) => {
  const frameCache = new Map<number, any>();
  const inFlightFrames = new Map<number, Promise<any>>();
  let firstPrimitive: Cesium.Primitive | null = null;
  let latestPrimitive: Cesium.Primitive | null = null;
  let hasCalledFirstPrimitive = false;
  const progressStep = Math.max(1, Math.floor(floodUrls.length / 20));

  const consumePendingSeekIndex = () => {
    if (showcasePlayback.pendingSeekIndex === null) {
      return null;
    }

    const targetIndex = clampShowcaseFrameIndex(showcasePlayback.pendingSeekIndex);
    showcasePlayback.pendingSeekIndex = null;
    return targetIndex;
  };

  const getBufferedFrameCount = (startIndex: number, maxCount: number, byteBudget: number) => {
    const remainingFrames = Math.max(0, floodUrls.length - startIndex);
    const safeMaxCount = Math.min(maxCount, remainingFrames);
    if (safeMaxCount <= 0) {
      return 0;
    }

    const frameSizes = options.frameSizes;
    if (!frameSizes?.length || byteBudget <= 0) {
      return safeMaxCount;
    }

    let totalBytes = 0;
    let count = 0;
    for (let index = startIndex; index < startIndex + safeMaxCount; index += 1) {
      const frameBytes = Math.max(0, Number(frameSizes[index]) || 0);
      if (count > 0 && totalBytes + frameBytes > byteBudget) {
        break;
      }
      totalBytes += frameBytes;
      count += 1;
    }

    return Math.max(1, count);
  };

  const fetchFrame = async (frameIndex: number) => {
    if (frameCache.has(frameIndex)) {
      return frameCache.get(frameIndex);
    }

    const existingPromise = inFlightFrames.get(frameIndex);
    if (existingPromise) {
      return existingPromise;
    }

    const framePromise = readJsonData(floodUrls[frameIndex])
      .then((jsonData) => {
        frameCache.set(frameIndex, jsonData);
        inFlightFrames.delete(frameIndex);
        return jsonData;
      })
      .catch((error) => {
        inFlightFrames.delete(frameIndex);
        throw error;
      });

    inFlightFrames.set(frameIndex, framePromise);
    return framePromise;
  };

  const pruneFrameCache = (currentIndex: number) => {
    const minIndex = Math.max(0, currentIndex - SHOWCASE_CACHE_BACK_FRAMES);
    const maxIndex = Math.min(floodUrls.length - 1, currentIndex + SHOWCASE_CACHE_AHEAD_FRAMES);

    frameCache.forEach((_, frameIndex) => {
      if (frameIndex < minIndex || frameIndex > maxIndex) {
        frameCache.delete(frameIndex);
      }
    });
  };

  const prefetchFrames = (startIndex: number, maxCount: number, byteBudget: number) => {
    const prefetchCount = getBufferedFrameCount(startIndex, maxCount, byteBudget);
    const endIndex = Math.min(floodUrls.length, startIndex + prefetchCount);
    for (let frameIndex = startIndex; frameIndex < endIndex; frameIndex += 1) {
      if (inFlightFrames.size >= SHOWCASE_PREFETCH_CONCURRENCY) {
        break;
      }

      if (frameCache.has(frameIndex) || inFlightFrames.has(frameIndex)) {
        continue;
      }

      fetchFrame(frameIndex).catch((error) => {
        if (!isAbortError(error)) {
          console.warn('Showcase prefetch failed:', error);
        }
      });
    }
  };

  const prefetchAhead = (startIndex: number) => {
    prefetchFrames(startIndex, options.prefetchCount, options.prefetchBytes);
  };

  const warmStartupFrames = async (startIndex: number) => {
    const startupCount = getBufferedFrameCount(
      startIndex,
      options.startupBufferCount,
      options.startupBufferBytes
    );
    const endIndex = Math.min(floodUrls.length, startIndex + startupCount);
    const frameSizes = options.frameSizes;
    const targetBytes = frameSizes?.length
      ? frameSizes
        .slice(startIndex, endIndex)
        .reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0)
      : options.startupBufferBytes;

    showcasePlayback.cacheLoadedFrames = 0;
    showcasePlayback.cacheTargetFrames = Math.max(0, endIndex - startIndex);
    showcasePlayback.cacheLoadedBytes = 0;
    showcasePlayback.cacheTargetBytes = targetBytes;

    for (let frameIndex = startIndex; frameIndex < endIndex; frameIndex += 1) {
      if (!isPlaybackCurrent(token) || showcasePlayback.pendingSeekIndex !== null) {
        return;
      }

      await fetchFrame(frameIndex);
      showcasePlayback.cacheLoadedFrames += 1;
      showcasePlayback.cacheLoadedBytes += Math.max(0, Number(frameSizes?.[frameIndex]) || 0);
      await nextFrame();
    }
  };

  const waitUntilPlayable = async () => {
    while (
      isPlaybackCurrent(token) &&
      showcasePlayback.status === 'paused' &&
      showcasePlayback.pendingSeekIndex === null
    ) {
      await sleep(120);
    }

    return isPlaybackCurrent(token);
  };

  let index = clampShowcaseFrameIndex(startIndex);
  showcasePlayback.currentIndex = index;
  showcasePlayback.sliderIndex = index;
  prefetchFrames(index, options.initialBufferCount, options.initialBufferBytes);
  if (options.startupBufferCount > 0 && options.startupBufferBytes > 0) {
    coordMessage.value = '正在缓存前段关键帧...';
    await warmStartupFrames(index);
    coordMessage.value = '前段关键帧已就绪，正在播放案例数据...';
  } else {
    showcasePlayback.cacheLoadedFrames = 0;
    showcasePlayback.cacheTargetFrames = 0;
    showcasePlayback.cacheLoadedBytes = 0;
    showcasePlayback.cacheTargetBytes = 0;
    coordMessage.value = '正在读取首帧并开始播放...';
  }

  while (index < floodUrls.length) {
    if (!isPlaybackCurrent(token)) {
      break;
    }

    const seekIndex = consumePendingSeekIndex();
    if (seekIndex !== null) {
      inFlightFrames.clear();
      index = seekIndex;
      showcasePlayback.currentIndex = index;
      showcasePlayback.sliderIndex = index;
      showcasePlayback.status = 'seeking';
      pruneFrameCache(index);
      prefetchAhead(index);
    }

    if (!(await waitUntilPlayable())) {
      break;
    }

    const url = floodUrls[index];
    let jsonData: any;
    try {
      jsonData = await fetchFrame(index);
    } catch (error) {
      if (isAbortError(error) && isPlaybackCurrent(token)) {
        continue;
      }
      throw error;
    }

    if (!isPlaybackCurrent(token)) {
      break;
    }

    if (!(await waitUntilPlayable())) {
      break;
    }

    const frameStartedAt = performance.now();
    const isFirstFrame = index === 0;
    const isLastFrame = index === floodUrls.length - 1;
    const shouldUpdateStats = isFirstFrame || isLastFrame || index % options.statsIntervalFrames === 0;
    const shouldUpdateUi = isFirstFrame || isLastFrame || index % options.uiIntervalFrames === 0;
    lastLoadedFloodJson.value = jsonData;
    if (shouldUpdateStats) {
      recordFloodAreaPoint(index + 1, jsonData, floodCellSize.value);
      recordFloodPointDepth(index + 1, jsonData);
    }
    const primitive = DrawTriangleMesh(jsonData);
    removeCurrentFloodPrimitive();

    currentFloodPrimitive.value = primitive;
    props.viewer.scene.primitives.add(primitive);
    latestPrimitive = primitive;
    if (shouldUpdateUi) {
      showcasePlayback.currentIndex = index;
      showcasePlayback.sliderIndex = index;
    }

    if (!firstPrimitive) {
      firstPrimitive = primitive;
    }

    if (!hasCalledFirstPrimitive) {
      hasCalledFirstPrimitive = true;
      onFirstPrimitive?.(primitive);
      if (isPlaybackCurrent(token) && showcasePlayback.status === 'buffering') {
        showcasePlayback.status = 'playing';
        showcasePlayback.cacheTargetFrames = 0;
      }
      if (isFirstFrame && isPlaybackCurrent(token)) {
        coordMessage.value = '首帧已就绪，正在预热渲染管线...';
        await waitForFrames(SHOWCASE_FIRST_FRAME_WARMUP_FRAMES);
      }
    }

    if (shouldUpdateUi && (isFirstFrame || isLastFrame || index % progressStep === 0)) {
      coordMessage.value = `正在播放案例数据：${index + 1}/${floodUrls.length}`;
      console.log("Flood data loaded and rendered:", url);
    }

    prefetchAhead(index + 1);
    pruneFrameCache(index);

    if (showcasePlayback.status === 'seeking') {
      showcasePlayback.status = showcasePlayback.resumeAfterSeek ? 'playing' : 'paused';
    }

    if (showcasePlayback.pauseAfterNextFrame) {
      showcasePlayback.pauseAfterNextFrame = false;
      showcasePlayback.status = 'paused';
    }

    const waitMs = Math.max(0, options.frameIntervalMs - (performance.now() - frameStartedAt));
    if (waitMs > 0) {
      await sleep(waitMs);
    }
    await nextFrame();

    index += 1;
  }

  return latestPrimitive ?? firstPrimitive;
};

const playShowcase = async (
  caseId: ShowcaseCaseId,
  startFrameIndex = 0,
  options: { pauseOnFirstFrame?: boolean } = {}
) => {
  if (isLoading.value) {
    nextPlaybackToken();
    abortShowcaseFetches();
  }

  isLoading.value = true;
  const token = nextPlaybackToken();
  resetFloodAreaSeries();
  resetFloodPointDepthSeries();

  try {
    coordMessage.value = '正在读取案例数据...';
    const manifestUrl = `/data/showcase/${caseId}/manifest.json`;
    const manifest = await fetchJson(manifestUrl) as ShowcaseManifest;
    if (!manifest.success) {
      throw new Error(manifest.message || '案例清单读取失败');
    }

    await flyToCameraCenter(manifest.cameraCenter);
    if (!isPlaybackCurrent(token)) {
      return;
    }

    let bounds: LonLatBounds;
    if (manifest.center) {
      bounds = prepareFloodSceneFromManifest(manifest);
    } else if (manifest.ascFile) {
      const ascText = await fetchText(`${manifest.fileBaseUrl}/${encodeFileName(manifest.ascFile)}`);
      bounds = prepareFloodScene(ascText, manifest.utmZone, manifest.name);
    } else {
      throw new Error('案例缺少 ASC 文件和中心点配置');
    }

    const floodUrls = manifest.floodUrls?.length
      ? manifest.floodUrls
      : parseFloodUrlsFromXml(await fetchText(`${manifest.fileBaseUrl}/${encodeFileName(manifest.xmlFile)}`));
    if (floodUrls.length === 0) {
      throw new Error('案例 XML 中没有可播放的洪水帧，请检查 JSON 文件是否存在');
    }

    const normalizedStartIndex = Math.min(Math.max(Math.round(startFrameIndex), 0), floodUrls.length - 1);
    showcasePlayback.visible = true;
    showcasePlayback.status = 'buffering';
    showcasePlayback.caseId = caseId;
    currentShowcaseCaseId.value = caseId;
    showcasePlayback.caseName = manifest.name;
    showcasePlayback.totalFrames = floodUrls.length;
    showcasePlayback.currentIndex = normalizedStartIndex;
    showcasePlayback.sliderIndex = normalizedStartIndex;
    showcasePlayback.cacheLoadedFrames = 0;
    showcasePlayback.cacheTargetFrames = 0;
    showcasePlayback.cacheLoadedBytes = 0;
    showcasePlayback.cacheTargetBytes = 0;
    showcasePlayback.pendingSeekIndex = null;
    showcasePlayback.resumeAfterSeek = true;
    showcasePlayback.pauseAfterNextFrame = options.pauseOnFirstFrame ?? false;

    const playbackOptions = getShowcasePlaybackOptions(caseId, manifest);
    const missingText = manifest.missingJsonCount ? `，跳过缺失 ${manifest.missingJsonCount} 帧` : '';
    const excludedText = manifest.excludedJsonCount ? `，剔除异常 ${manifest.excludedJsonCount} 帧` : '';
    const sizeText = formatBytes(manifest.totalJsonBytes);
    coordMessage.value = `正在缓冲 ${manifest.name}：逐帧播放 ${floodUrls.length} 帧${sizeText ? `，约 ${sizeText}` : ''}${missingText}${excludedText}`;
    const jsonBaseDir = manifest.jsonBaseDir || manifest.xmlDir;
    let firstShowcasePrimitive: Cesium.Primitive | null = null;
    await renderPrefetchedFloodFrames(token, floodUrls, (url) => (
      fetchShowcaseJson(`${manifest.fileBaseUrl}/${encodeFileName(joinRelativePath(jsonBaseDir, url))}`)
    ), playbackOptions, (primitive) => {
      if (!firstShowcasePrimitive) {
        firstShowcasePrimitive = primitive;
      }
      if (isPlaybackCurrent(token) && !manifest.cameraCenter && caseId !== 'xiaojiaqiao') {
        flyToFirstPrimitive(primitive, bounds);
      }
    });

    if (isPlaybackCurrent(token)) {
      showcasePlayback.status = 'ended';
      showcasePlayback.currentIndex = floodUrls.length - 1;
      showcasePlayback.sliderIndex = floodUrls.length - 1;
      coordMessage.value = `${manifest.name} 逐帧播放完成：共 ${floodUrls.length} 帧`;
    }
  } catch (error) {
    console.error("Error loading showcase flood data:", error);
    if (isPlaybackCurrent(token)) {
      coordMessage.value = error instanceof Error ? error.message : '案例数据加载失败';
      showcasePlayback.status = isAbortError(error) ? 'ended' : showcasePlayback.status;
    }
  } finally {
    if (isPlaybackCurrent(token)) {
      isLoading.value = false;
    }
  }
};

onBeforeUnmount(() => {
  stopShowcaseDockDrag();
});

defineExpose({ playShowcase, resetFloodData });
</script>

<template>
  <Teleport to="body">
    <div
      v-if="showcasePlayback.visible"
      ref="showcaseDockRef"
      class="showcase-playback-dock"
      :class="{ dragging: showcaseDockDrag.active }"
      :style="showcaseDockStyle"
    >
      <div class="showcase-playback-panel">
        <div class="showcase-playback-header drag-handle" title="拖动控制框位置" @pointerdown="startShowcaseDockDrag">
          <span class="showcase-title">{{ showcasePlayback.caseName || '案例回放' }}</span>
          <div class="showcase-header-actions">
            <span class="showcase-status">{{ showcaseStatusText }}</span>
            <button
              type="button"
              class="showcase-close-btn"
              title="关闭"
              aria-label="关闭案例回放控制框"
              @pointerdown.stop
              @click="handleShowcaseClose"
            >
              ×
            </button>
          </div>
        </div>

        <div v-if="showcasePlayback.status === 'buffering' && showcasePlayback.cacheTargetFrames > 0" class="showcase-cache-progress">
          <div class="showcase-cache-meta">
            <span>正在缓存案例数据</span>
            <strong>{{ showcasePlayback.cacheLoadedFrames }} / {{ showcasePlayback.cacheTargetFrames }} 帧</strong>
          </div>
          <div class="showcase-cache-track">
            <i :style="{ width: `${showcaseCachePercent}%` }"></i>
          </div>
          <div class="showcase-cache-foot">
            <span>{{ showcaseCacheBytesLabel }}</span>
            <b>{{ showcaseCachePercent }}%</b>
          </div>
        </div>

        <div class="showcase-progress-row">
          <input
            type="range"
            min="0"
            :max="showcaseMaxFrameIndex"
            :value="showcasePlayback.sliderIndex"
            :style="`--progress: ${showcaseMaxFrameIndex > 0 ? (showcasePlayback.sliderIndex / showcaseMaxFrameIndex) * 100 : 0}%`"
            :disabled="showcasePlayback.totalFrames <= 0"
            @input="handleShowcaseSliderInput"
            @change="handleShowcaseSeekCommit"
          />
          <div class="showcase-progress-meta">
            <span class="showcase-frame-label">{{ showcaseFrameLabel }}</span>
            <span class="showcase-time-label">演进时间 {{ showcaseEvolutionTimeLabel }}</span>
          </div>
        </div>

        <div class="showcase-actions">
          <button
            type="button"
            class="showcase-control-btn primary"
            @click="handleShowcaseStart"
            :disabled="!showcasePlayback.caseId || showcasePlayback.status === 'buffering' || showcasePlayback.status === 'playing' || showcasePlayback.status === 'paused' || showcasePlayback.status === 'seeking'"
          >
            开始
          </button>
          <button
            type="button"
            class="showcase-control-btn primary"
            @click="handleShowcaseResume"
            :disabled="showcasePlayback.status !== 'paused' && showcasePlayback.status !== 'seeking'"
          >
            继续
          </button>
          <button
            type="button"
            class="showcase-control-btn"
            @click="handleShowcasePause"
            :disabled="!isShowcaseRunningStatus(showcasePlayback.status)"
          >
            暂停
          </button>
          <button
            type="button"
            class="showcase-control-btn danger"
            @click="handleShowcaseStop"
            :disabled="showcasePlayback.status === 'idle' || showcasePlayback.status === 'ended'"
          >
            结束
          </button>
        </div>

        <div class="showcase-actions frame-actions">
          <button
            type="button"
            class="showcase-control-btn ghost"
            @click="handleShowcaseRewind"
            :disabled="showcasePlayback.totalFrames <= 0 || showcasePlayback.status === 'buffering' || showcasePlayback.status === 'seeking'"
          >
            后退
          </button>
          <button
            type="button"
            class="showcase-control-btn ghost"
            @click="handleShowcasePreviousFrame"
            :disabled="showcasePlayback.totalFrames <= 0 || showcasePlayback.status === 'buffering' || showcasePlayback.status === 'seeking'"
          >
            上一帧
          </button>
          <button
            type="button"
            class="showcase-control-btn ghost"
            @click="handleShowcaseNextFrame"
            :disabled="showcasePlayback.totalFrames <= 0 || showcasePlayback.status === 'buffering' || showcasePlayback.status === 'seeking'"
          >
            下一帧
          </button>
          <button
            type="button"
            class="showcase-control-btn ghost"
            @click="handleShowcaseFastForward"
            :disabled="showcasePlayback.totalFrames <= 0 || showcasePlayback.status === 'buffering' || showcasePlayback.status === 'seeking'"
          >
            快进
          </button>
        </div>
      </div>

      <div class="showcase-depth-legend" aria-label="水深图例">
        <div class="legend-title drag-handle" title="拖动图例和控制框位置" @pointerdown="startShowcaseDockDrag">水深</div>
        <div class="legend-body">
          <div class="legend-ramp" />
          <div class="legend-labels">
            <span>{{ waterDepthLegendLabels.max }}</span>
            <span>{{ waterDepthLegendLabels.mid }}</span>
            <span>{{ waterDepthLegendLabels.min }}</span>
          </div>
        </div>
      </div>
    </div>
  </Teleport>

  <div class="flood-controller" v-bind="$attrs">
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
.showcase-playback-dock {
  position: fixed;
  left: 28px;
  bottom: 48px;
  z-index: 10050;
  display: flex;
  align-items: flex-end;
  gap: 12px;
  pointer-events: none;
}

.showcase-playback-dock.dragging {
  user-select: none;
}

.drag-handle {
  cursor: move;
  touch-action: none;
}

.showcase-playback-panel {
  position: relative;
  width: min(400px, calc(100vw - 48px));
  padding: 16px 20px;
  color: #e0f2fe;
  background: rgba(8, 22, 38, 0.75);
  border: 1px solid rgba(0, 229, 255, 0.2);
  border-radius: 12px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5), inset 0 1px 1px rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(12px);
  pointer-events: auto;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol";
}

.showcase-depth-legend {
  order: -1;
  width: 104px;
  padding: 12px 10px;
  color: #e0f2fe;
  background: rgba(8, 22, 38, 0.72);
  border: 1px solid rgba(0, 229, 255, 0.18);
  border-radius: 12px;
  box-shadow: 0 10px 26px rgba(0, 0, 0, 0.38), inset 0 1px 1px rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(12px);
  pointer-events: auto;
}

.legend-title {
  margin-bottom: 8px;
  color: #bae6fd;
  font-size: 12px;
  font-weight: 600;
  text-align: center;
}

.legend-body {
  display: flex;
  justify-content: center;
  gap: 8px;
}

.legend-ramp {
  width: 18px;
  height: 128px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 5px;
  background: linear-gradient(
    to bottom,
    rgb(9, 9, 145) 0%,
    rgb(54, 44, 163) 24%,
    rgb(101, 101, 191) 50%,
    rgb(151, 179, 222) 74%,
    rgb(182, 237, 240) 100%
  );
  box-shadow: inset 0 0 8px rgba(0, 0, 0, 0.35), 0 0 10px rgba(0, 229, 255, 0.18);
}

.legend-labels {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  min-width: 48px;
  height: 128px;
  color: #dbeafe;
  font-size: 11px;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  line-height: 1;
}

.showcase-playback-header,
.showcase-progress-row,
.showcase-actions {
  display: flex;
  align-items: center;
}

.showcase-playback-header {
  justify-content: space-between;
  margin-bottom: 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  padding-bottom: 8px;
}

.showcase-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 6px;
}

.showcase-title::before {
  content: '';
  display: inline-block;
  width: 3px;
  height: 14px;
  background: #00e5ff;
  border-radius: 2px;
  box-shadow: 0 0 6px rgba(0, 229, 255, 0.6);
}

.showcase-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
}

.showcase-status {
  flex: 0 0 auto;
  padding: 2px 10px;
  color: #00e5ff;
  background: rgba(0, 229, 255, 0.1);
  border: 1px solid rgba(0, 229, 255, 0.25);
  border-radius: 10px;
  font-size: 12px;
  font-weight: 500;
}

.showcase-close-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  margin: 0;
  padding: 0;
  color: #bae6fd;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 50%;
  box-shadow: none;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  transition: all 0.2s ease;
}

.showcase-close-btn:hover {
  color: #ffffff;
  background: rgba(239, 68, 68, 0.22);
  border-color: rgba(239, 68, 68, 0.45);
  transform: translateY(-1px);
}

.showcase-progress-row {
  gap: 12px;
  margin-bottom: 14px;
}

.showcase-cache-progress {
  margin: -2px 0 12px;
  padding: 9px 10px;
  border: 1px solid rgba(0, 229, 255, 0.18);
  border-radius: 8px;
  background: rgba(2, 18, 32, 0.52);
  box-shadow: inset 0 0 18px rgba(0, 229, 255, 0.06);
}

.showcase-cache-meta,
.showcase-cache-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  color: #9eddf1;
  font-size: 12px;
}

.showcase-cache-meta strong,
.showcase-cache-foot b {
  color: #f7fcff;
  font-size: 12px;
  font-weight: 700;
}

.showcase-cache-track {
  position: relative;
  height: 7px;
  margin: 8px 0 7px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.12);
}

.showcase-cache-track i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #00e5ff, #48f2a6);
  box-shadow: 0 0 12px rgba(0, 229, 255, 0.45);
  transition: width 0.18s ease;
}

.showcase-progress-row input[type="range"] {
  flex: 1;
  -webkit-appearance: none;
  background: linear-gradient(to right, #00e5ff 0%, #00e5ff var(--progress, 0%), rgba(255, 255, 255, 0.15) var(--progress, 0%), rgba(255, 255, 255, 0.15) 100%);
  height: 6px;
  border-radius: 4px;
  outline: none;
  cursor: pointer;
  transition: opacity 0.2s ease;
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.5);
  position: relative;
}

.showcase-progress-row input[type="range"]::-webkit-slider-runnable-track {
  width: 100%;
  height: 6px;
  cursor: pointer;
  background: transparent;
  border: none;
}

.showcase-progress-row input[type="range"]:hover {
  background: linear-gradient(to right, #00e5ff 0%, #00e5ff var(--progress, 0%), rgba(255, 255, 255, 0.25) var(--progress, 0%), rgba(255, 255, 255, 0.25) 100%);
}

.showcase-progress-row input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  border: 2px solid #00e5ff;
  cursor: pointer;
  box-shadow: 0 0 12px rgba(0, 229, 255, 0.8), 0 2px 4px rgba(0, 0, 0, 0.3);
  transition: transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275), background 0.2s, box-shadow 0.2s;
  margin-top: -6px; /* align to center of track (18/2 - 6/2 = 6) */
}

.showcase-progress-row input[type="range"]::-webkit-slider-thumb:hover {
  transform: scale(1.2);
  background: #e0faff;
  box-shadow: 0 0 16px rgba(0, 229, 255, 1), 0 2px 6px rgba(0, 0, 0, 0.4);
}

.showcase-progress-row input[type="range"]::-webkit-slider-thumb:active {
  transform: scale(1.1);
  background: #00e5ff;
}

/* Firefox Support */
.showcase-progress-row input[type="range"]::-moz-range-track {
  width: 100%;
  height: 6px;
  cursor: pointer;
  background: transparent;
  border-radius: 4px;
  border: none;
}

.showcase-progress-row input[type="range"]::-moz-range-thumb {
  width: 14px; /* Slightly smaller to match inner area */
  height: 14px;
  border-radius: 50%;
  background: #fff;
  border: 2px solid #00e5ff;
  cursor: pointer;
  box-shadow: 0 0 12px rgba(0, 229, 255, 0.8), 0 2px 4px rgba(0, 0, 0, 0.3);
  transition: transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
}

.showcase-progress-row input[type="range"]::-moz-range-thumb:hover {
  transform: scale(1.2);
  background: #e0faff;
}

.showcase-progress-meta {
  flex: 0 0 136px;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 3px;
}

.showcase-frame-label,
.showcase-time-label {
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  white-space: nowrap;
}

.showcase-frame-label {
  color: #bae6fd;
  font-size: 12px;
}

.showcase-time-label {
  color: #67e8f9;
  font-size: 11px;
}

.showcase-actions {
  justify-content: center;
  gap: 8px;
  flex-wrap: wrap;
}

.frame-actions {
  justify-content: center;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed rgba(255, 255, 255, 0.08);
}

.showcase-control-btn {
  min-width: 60px;
  padding: 6px 12px;
  margin: 0;
  font-size: 12px;
  font-weight: 500;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: rgba(255, 255, 255, 0.05);
  color: #e0f2fe;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
  transition: all 0.2s ease;
  cursor: pointer;
}

.showcase-control-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.12);
  border-color: rgba(255, 255, 255, 0.3);
  transform: translateY(-1px);
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
}

.showcase-control-btn:active:not(:disabled) {
  transform: translateY(0);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
}

.showcase-control-btn.primary {
  color: #fff;
  background: linear-gradient(135deg, #00b4d8, #0077b6);
  border: none;
  font-weight: 600;
  box-shadow: 0 4px 12px rgba(0, 180, 216, 0.3);
}

.showcase-control-btn.primary:hover:not(:disabled) {
  background: linear-gradient(135deg, #00c3eb, #0088cb);
  box-shadow: 0 6px 16px rgba(0, 180, 216, 0.4);
}

.showcase-control-btn.danger {
  border-color: rgba(239, 68, 68, 0.3);
  background: rgba(239, 68, 68, 0.15);
  color: #fca5a5;
}

.showcase-control-btn.danger:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.25);
  border-color: rgba(239, 68, 68, 0.5);
  color: #fecaca;
}

.showcase-control-btn.ghost {
  min-width: 80px;
  background: transparent;
  border-color: transparent;
  box-shadow: none;
  color: #7dd3fc;
}

.showcase-control-btn.ghost:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.08);
  color: #bae6fd;
}

.showcase-control-btn:disabled {
  color: rgba(255, 255, 255, 0.3);
  background: rgba(255, 255, 255, 0.05);
  border-color: rgba(255, 255, 255, 0.1);
  box-shadow: none;
  cursor: not-allowed;
  transform: none;
}

@media (max-width: 640px) {
  .showcase-playback-dock {
    left: 16px;
    bottom: 44px;
    flex-direction: column;
    align-items: flex-start;
  }

  .showcase-playback-panel {
    width: 100%;
  }

  .showcase-depth-legend {
    width: 104px;
  }
}

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
