<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import * as Cesium from 'cesium';
import StyledFileInput from './StyledFileInput.vue';

type TabType = 'simulation' | 'results' | 'rowcol' | 'outputpath' | null;

type JsonFileItem = {
  name: string;
  content: string;
  show: boolean;
};

const props = defineProps<{
  viewer?: Cesium.Viewer | null;
}>();

const files = ref<{ dem: File | null; cao: File | null; river: File | null }>({
  dem: null,
  cao: null,
  river: null
});

const message = ref('');
const jsonFiles = ref<JsonFileItem[]>([]);
const isMenuOpen = ref(false);
const activeTab = ref<TabType>(null);
const outputPath = ref('');

let dirHandle: FileSystemDirectoryHandle | null = null;

let scriptLoaded = false;

const ensureLegacyScriptLoaded = async () => {
  if (scriptLoaded) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const src = '/src/新建文件夹/huaxian.js';
    const existing = document.querySelector(`script[src="${src}"]`) as HTMLScriptElement | null;

    if (existing) {
      scriptLoaded = true;
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.onload = () => {
      scriptLoaded = true;
      resolve();
    };
    script.onerror = () => reject(new Error('Failed to load huaxian.js'));
    document.body.appendChild(script);
  });
};

const ensureLegacyContextReady = async () => {
  const win = window as any;
  win.Cesium = Cesium;
  if (props.viewer) {
    win.cesiumViewer = props.viewer;
  }
  await ensureLegacyScriptLoaded();
  win.drawingModule?.init?.();
};

const toggleMenu = () => {
  isMenuOpen.value = !isMenuOpen.value;
  if (!isMenuOpen.value) {
    activeTab.value = null;
  }
};

const closeAll = () => {
  isMenuOpen.value = false;
  activeTab.value = null;
};

const getTabTitle = (tab: TabType) => {
  const titles: Record<string, string> = {
    simulation: '参数设置与模拟',
    results: '查看结果',
    rowcol: '获取 ASCII 行列号',
    outputpath: '选择输出路径'
  };
  return tab ? titles[tab] : '模拟';
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

const fetchJsonFiles = async () => {
  message.value = 'Loading JSON files from Data_dx_5m...';

  try {
    const listRes = await fetch('http://localhost:5000/simulation-results-list');
    const listJson = await listRes.json();

    if (!listRes.ok || !listJson.success) {
      throw new Error(listJson.message || 'Failed to fetch simulation results');
    }

    const fileNames: string[] = Array.isArray(listJson.files) ? listJson.files : [];
    const filesData: JsonFileItem[] = [];

    for (const name of fileNames) {
      const fileRes = await fetch(`http://localhost:5000/simulation-result/${name}`);
      const fileText = await fileRes.text();

      let formatted = fileText;
      try {
        formatted = JSON.stringify(JSON.parse(fileText), null, 2);
      } catch {
        // non-json content keeps raw text
      }

      filesData.push({
        name,
        content: formatted,
        show: false
      });
    }

    jsonFiles.value = filesData;
    message.value = `Loaded successfully, ${jsonFiles.value.length} files found`;
  } catch (error) {
    message.value = 'Load failed: ' + (error instanceof Error ? error.message : String(error));
  }
};

const toggleContent = (idx: number) => {
  jsonFiles.value[idx].show = !jsonFiles.value[idx].show;
};

const handleAsciiRowColFileChange = async (event: Event) => {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) {
    return;
  }

  await ensureLegacyContextReady();
  const win = window as any;
  if (win.CONFIG?.loadAsciiData) {
    await win.CONFIG.loadAsciiData(file);
    message.value = 'ASCII Data loaded';
  } else {
    message.value = 'ASCII loader is not ready';
  }
};

const handleLineFileChange = async (event: Event) => {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) {
    return;
  }

  await ensureLegacyContextReady();
  const text = await file.text();
  const win = window as any;
  const drawingModule = win.drawingModule;
  const loadFromTxt = drawingModule?.['loadFromTxt'];
  if (typeof loadFromTxt === 'function') {
    loadFromTxt(text);
    message.value = 'Drawing TXT loaded';
  } else {
    message.value = 'Drawing module is not ready';
  }
};

const exportPointCoordinatesTXT = () => {
  const win = window as any;
  if (typeof win.exportElevationDataTXT === 'function') {
    win.exportElevationDataTXT();
  }
};

const selectOutputPath = async () => {
  if (!('showDirectoryPicker' in window)) {
    message.value = '当前浏览器不支持目录选取，请手动输入路径';
    return;
  }
  try {
    dirHandle = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
    outputPath.value = dirHandle!.name;
    message.value = `已选择输出目录：${dirHandle!.name}`;
  } catch (err: any) {
    if (err?.name !== 'AbortError') {
      message.value = '目录选取失败：' + (err instanceof Error ? err.message : String(err));
    }
  }
};

watch(
  () => props.viewer,
  (viewer) => {
    const win = window as any;
    if (viewer) {
      win.Cesium = Cesium;
      win.cesiumViewer = viewer;
    }
  },
  { immediate: true }
);

onMounted(() => {
  void ensureLegacyContextReady();
});
</script>

<template>
  <div class="panel-root">
    <button class="toggle-btn" @click="toggleMenu">
      {{ isMenuOpen ? '关闭模拟面板' : '打开模拟面板' }}
    </button>

    <div class="container menu-panel" v-if="isMenuOpen && !activeTab">
      <div class="panel-header">
        <h3>洪水模拟计算</h3>
        <button class="close-btn" @click="closeAll">×</button>
      </div>
      <div class="menu-list">
        <div class="menu-item" @click="activeTab = 'simulation'">
          <span>模拟文件输入</span>
          <span class="arrow">></span>
        </div>
        <div class="menu-item" @click="activeTab = 'results'">
          <span>查看模拟结果</span>
          <span class="arrow">></span>
        </div>
        <div class="menu-item" @click="activeTab = 'rowcol'">
          <span>获取 ASCII 行列号</span>
          <span class="arrow">></span>
        </div>
        <div class="menu-item" @click="activeTab = 'outputpath'">
          <span>选择输出保存路径</span>
          <span class="arrow">></span>
        </div>
      </div>
    </div>

    <div class="container detail-panel" v-if="isMenuOpen && activeTab">
      <div class="panel-header">
        <button class="back-btn" @click="activeTab = null">← 返回</button>
        <h3>{{ getTabTitle(activeTab) }}</h3>
        <button class="close-btn" @click="closeAll">×</button>
      </div>

      <div class="panel-content">
        <div v-if="activeTab === 'simulation'">
          <label>DEM 文件（dem.asc）：</label>
          <StyledFileInput accept=".asc" button-text="选择 DEM" placeholder="未选择 dem.asc" @change="handleFileChange($event, 'dem')" />

          <label>粗糙度文件（cao.asc）：</label>
          <StyledFileInput accept=".asc" button-text="选择粗糙度" placeholder="未选择 cao.asc" @change="handleFileChange($event, 'cao')" />

          <label>溃口文件（InputRiver.dat）：</label>
          <StyledFileInput accept=".dat,.txt" button-text="选择溃口" placeholder="未选择 InputRiver.dat" @change="handleFileChange($event, 'river')" />
          
     


          <button @click="uploadAllFiles" :disabled="message === '🚀 模拟中...（30~60秒）' || message.includes('正在打包')">
            {{ message === '🚀 模拟中...（30~60秒）' || message.includes('正在打包') ? '模拟中...' : '开始模拟' }}
          </button>

          <div class="result">
            <p v-if="message">{{ message }}</p>
            <p v-else>等待计算中</p>
          </div>
        </div>

        <div v-if="activeTab === 'results'">
          <button @click="fetchJsonFiles">获取模拟结果 JSON</button>

          <div class="result" v-if="message && !message.includes('Upload')">
            <p>{{ message }}</p>
          </div>

          <ul v-if="jsonFiles.length" class="json-list">
            <li v-for="(file, index) in jsonFiles" :key="index">
              <div class="json-header">
                <strong>{{ file.name }}</strong>
                <button class="mini-btn" @click="toggleContent(index)">{{ file.show ? '隐藏' : '显示' }} 内容</button>
              </div>
              <pre v-if="file.show">{{ file.content }}</pre>
            </li>
          </ul>
        </div>

        <div v-if="activeTab === 'rowcol'">
          <label>选择 ASCII 文件：</label>
          <StyledFileInput accept=".asc" button-text="选择 ASCII" placeholder="未选择 ASCII 文件" @change="handleAsciiRowColFileChange" />

          <label>选择绘制文件（TXT）：</label>
          <StyledFileInput accept=".txt" button-text="选择 TXT" placeholder="未选择绘制 TXT 文件" @change="handleLineFileChange" />

          <button class="btn" @click="exportPointCoordinatesTXT">
            导出点位坐标（TXT）
          </button>
          <div id="coordinatesList" class="coordinates-list"></div>
        </div>

        <div v-if="activeTab === 'outputpath'">
          <label>当前输出路径：</label>
          <div class="path-row">
            <input
              type="text"
              v-model="outputPath"
              placeholder="请选择或手动输入保存路径"
              class="path-input"
            />
            <button class="browse-btn" @click="selectOutputPath">浏览…</button>
          </div>
          <p class="path-hint">路径将在上传模拟文件时一并提交至服务端</p>
          <div class="result" v-if="message">
            <p>{{ message }}</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.panel-root {
  position: absolute;
  right: 340px;
  bottom: 40px;
  z-index: 10020;
  pointer-events: auto;
}

.toggle-btn {
  margin-bottom: 10px;
  padding: 8px 12px;
  border: none;
  border-radius: 6px;
  background: #06d4f9;
  color: #fff;
  cursor: pointer;
}

.container {
  width: 340px;
  background: rgba(255, 255, 255, 0.95);
  border: 2px dashed #b2b2b2;
  border-radius: 18px;
  box-shadow: 0 4px 24px 0 rgba(0, 0, 0, 0.08);
  padding: 18px;
  box-sizing: border-box;
  max-height: 420px;
  overflow-y: auto;
}

h3 {
  color: #06d4f9;
  font-size: 16px;
  margin: 0;
}

label {
  display: block;
  margin-top: 12px;
  margin-bottom: 4px;
  font-weight: bold;
  color: #333;
}

button {
  margin-top: 10px;
  padding: 8px 14px;
  font-size: 14px;
  border-radius: 4px;
  background: #06d4f9;
  color: #fff;
  border: none;
  cursor: pointer;
}

button:disabled {
  background: #b2e6f9;
  cursor: not-allowed;
}

.result {
  margin-top: 12px;
  color: #1a8a2c;
  min-height: 24px;
}

pre {
  font-size: 12px;
  line-height: 1.3;
  white-space: pre-wrap;
  max-height: 260px;
  overflow: auto;
  background: #f7f7f7;
  padding: 8px;
  border-radius: 6px;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 14px;
  border-bottom: 1px solid #eee;
  padding-bottom: 8px;
}

.close-btn {
  background: none;
  border: none;
  color: #999;
  font-size: 24px;
  cursor: pointer;
  padding: 0;
  margin: 0;
  line-height: 1;
}

.close-btn:hover {
  color: #333;
}

.back-btn {
  background: none;
  border: none;
  color: #06d4f9;
  font-size: 14px;
  cursor: pointer;
  padding: 0;
  margin: 0;
}

.menu-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.menu-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px;
  background: #f8f9fa;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.2s;
  border: 1px solid #eee;
}

.menu-item:hover {
  background: #e9ecef;
}

.menu-item span {
  font-weight: bold;
  color: #333;
}

.menu-item .arrow {
  color: #999;
}

.json-list {
  margin-top: 15px;
  padding-left: 20px;
}

.json-header {
  margin-bottom: 6px;
}

.mini-btn {
  margin-left: 8px;
  font-size: 12px;
  padding: 4px 8px;
}

.coordinates-list {
  margin-top: 10px;
  max-height: 200px;
  overflow-y: auto;
  border: 1px solid #ddd;
  border-radius: 6px;
  padding: 8px;
  background: #fff;
}

.path-row {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-top: 4px;
}

.path-input {
  flex: 1;
  padding: 6px 8px;
  border: 1px solid #ccc;
  border-radius: 4px;
  font-size: 13px;
  color: #333;
}

.browse-btn {
  margin-top: 0;
  padding: 6px 12px;
  white-space: nowrap;
}

.path-hint {
  margin-top: 6px;
  font-size: 12px;
  color: #888;
}
</style>
