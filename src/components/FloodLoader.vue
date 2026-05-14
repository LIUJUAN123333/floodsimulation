<script setup lang="ts">
import { ref } from 'vue';
import * as Cesium from 'cesium';
import DrawTriangleMesh from '../js/DrawTriangleMesh';
import * as proj4 from 'proj4';
import { lastLoadedFloodJson, floodCellSize } from '../store/floodState';

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
const currentPrimitive = ref<Cesium.Primitive | null>(null);
const playToken = ref(0);
const frameIntervalMs = 10;
const ascFile = ref<File | null>(null);
const utmZone = ref<number>(48);
const parsedCellsize = ref<number | null>(null);
const coordMessage = ref('');
const floodFiles = ref<File[]>([]);

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
  playToken.value += 1;
  const token = playToken.value;

  try {
    const ascText = await ascFile.value.text();
    const ascHeader = parseAscHeader(ascText);
    parsedCellsize.value = ascHeader.cellsize;
    floodCellSize.value = ascHeader.cellsize;
    DrawTriangleMesh.setGridCellSize(ascHeader.cellsize);
    const bounds = calcLonLatByAscHeader(ascHeader, utmZone.value);

    // 1. 读取 XML 索引
    const xmlFile = floodFiles.value.find(f => f.name.toLowerCase().endsWith('.xml'));
    if (!xmlFile) {
      coordMessage.value = '错误：未在选中目录内找到 XML 配置文件';
      isLoading.value = false;
      return;
    }
    const xmlText = await xmlFile.text();
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, "text/xml");
    const floodElements = xmlDoc.getElementsByTagName("flood");

    if (floodElements.length === 0) {
      console.error("No flood data found in XML");
      return;
    }

    // 获取全部数据文件 URL
    const floodUrls = Array.from(floodElements)
      .map((item) => item.getAttribute("url"))
      .filter((url): url is string => Boolean(url));

    if (floodUrls.length === 0) {
      console.error("No valid flood urls found in XML");
      return;
    }

    // 3. 渲染数据
    // 使用 ASC 头部 + 投影带号识别的经纬度
    const centerPos = Cesium.Cartesian3.fromDegrees(bounds.west, bounds.north, 0);
    DrawTriangleMesh.setFloodCenterPosition(centerPos);
    coordMessage.value = `识别坐标成功：西经度 ${bounds.west.toFixed(6)}，北纬度 ${bounds.north.toFixed(6)}`;

    // 点击后立即把视角移动到洪水区域中心
    props.viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(bounds.centerLon, bounds.centerLat, 20000),
      duration: 0.8
    });

    // 如果之前有渲染的，先移除
    if (currentPrimitive.value) {
      props.viewer.scene.primitives.remove(currentPrimitive.value);
      currentPrimitive.value = null;
    }

    // 2. 按 XML 顺序逐帧加载并渲染（流动效果）
    let firstPrimitive: Cesium.Primitive | null = null;
    for (const url of floodUrls) {
      if (token !== playToken.value) {
        break;
      }

      const jsonFile = floodFiles.value.find(f => f.name === url || f.webkitRelativePath.endsWith(url));
      if (!jsonFile) {
        console.warn(`未找到名为 ${url} 的数据文件，跳过渲染`);
        continue;
      }

      const jsonText = await jsonFile.text();
      const jsonData = JSON.parse(jsonText);

      lastLoadedFloodJson.value = jsonData;

      const primitive = DrawTriangleMesh(jsonData);

      if (currentPrimitive.value) {
        props.viewer.scene.primitives.remove(currentPrimitive.value);
      }

      currentPrimitive.value = primitive;
      props.viewer.scene.primitives.add(primitive);

      if (!firstPrimitive) {
        firstPrimitive = primitive;
      }

      console.log("Flood data loaded and rendered:", url);
      await sleep(frameIntervalMs);
    }

    // 视角定位到第一份数据包围球，避免固定经纬度偏差
    if (firstPrimitive) {
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
    }
    console.log("Flood files played:", floodUrls.length);
  } catch (error) {
    console.error("Error loading flood data:", error);
  } finally {
    if (token === playToken.value) {
      isLoading.value = false;
    }
  }
};
</script>

<template>
  <div class="flood-controller">
    <label class="control-label">上传 ASC 文件</label>
    <input type="file" accept=".asc,.txt" @change="handleAscFileChange">

    <label class="control-label">输入投影带号（1-60）</label>
    <input v-model.number="utmZone" type="number" min="1" max="60">

    <label class="control-label">识别像元大小（cellsize）</label>
    <input :value="parsedCellsize ?? ''" type="number" readonly placeholder="未读取">

    <label class="control-label">选择洪水数据目录</label>
    <input type="file" webkitdirectory directory @change="handleFloodDirChange">

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

input[type="file"],
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
