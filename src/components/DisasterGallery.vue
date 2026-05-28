<template>
  <div class="gallery-container">
    <header class="header">
      <h1>灾害案例展示库 (Disaster Gallery)</h1>
      <div class="search-filter-group">
        <input 
          type="text" 
          class="search-box" 
          placeholder="🔍 搜索灾害案例..." 
          v-model="searchQuery"
        />
        <div class="filter-wrapper">
          <button class="filter-btn" @click="toggleDropdown">
            ⚲ {{ selectedTag || '标签筛选' }} ▼
          </button>
          <!-- 标签下拉菜单 -->
          <div class="filter-dropdown" v-if="showDropdown">
            <div 
              class="dropdown-item" 
              :class="{ 'active': selectedTag === '' }" 
              @click="selectTag('')"
            >
              全部标签
            </div>
            <div 
              class="dropdown-item" 
              v-for="tag in allTags" 
              :key="tag" 
              :class="{ 'active': selectedTag === tag }" 
              @click="selectTag(tag)"
            >
              {{ tag }}
            </div>
          </div>
        </div>
      </div>
    </header>

    <div class="results-info">
      当前展示: <strong>{{ selectedTag || '全部' }}</strong> 专题 (共 {{ filteredCases.length }} 个典型实例)
      <span v-if="searchQuery" style="margin-left: 10px; color: #a0c4e0;">搜索关键字: "{{ searchQuery }}"</span>
    </div>

    <div class="card-list">
      <div class="card" v-for="item in filteredCases" :key="item.id">
        <div class="card-image-wrapper">
          <img :src="item.img" :alt="item.title">
        </div>
        <div class="card-content">
          <div class="card-header">
            <h2 class="card-title">{{ item.title }}</h2>
            <span class="code-icon">&lt;/&gt;</span>
          </div>
          <p class="card-desc">
            {{ item.desc }}
          </p>
          <div class="tags">
            <template v-for="(tag, index) in item.tags" :key="index">
              <button
                v-if="tag === 'SHOWCASE'"
                class="tag tag-highlight showcase-tag"
                type="button"
                @click.stop="emitShowcase(item.id)"
              >
                {{ tag }}
              </button>
              <span v-else class="tag">
                {{ tag }}
              </span>
            </template>
          </div>
        </div>
      </div>
      
      <!-- 搜索为空时的提示 -->
      <div v-if="filteredCases.length === 0" class="empty-state">
        没有任何匹配的案例...
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';

type ShowcaseCaseId = 'jinshajiang' | 'xiaojiaqiao' | 'bonn';

const emit = defineEmits<{
  showcase: [caseId: ShowcaseCaseId];
}>();

// 导入本地图片
import imgXiaojiaqiao from '../案例图片/肖家桥.png';
import imgJinsha from '../案例图片/金沙江.png';
// import imgBonn from '../案例图片/德国波恩.png'; // 提示：请补充图片后取消注释

// 原始数据源
const cases = ref([
  {
    id: 'bonn',
    title: '德国波恩',
    img: imgJinsha, // 提示：暂时使用金沙江图片占位，有了图片后请换成 imgBonn
    desc: '位于莱茵河畔的德国波恩（Bonn）曾经历极端暴雨引发的城市内涝与洪水。本案例结合高分辨率城市DEM及实体建筑模型信息，通过精细化的网格动态计算，推演城市建筑密集区内复杂的地表水汇聚、演进与积水过程，为城市应急防涝提供决策支持。',
    tags: ['城市内涝', '暴雨洪涝', '三维淹没', 'SHOWCASE']
  },
  {
    id: 'xiaojiaqiao',
    title: '肖家桥',
    img: imgXiaojiaqiao,
    desc: '肖家桥地区因地形狭长突发山洪风险极高。本案例采用启发式元胞自动机（CA）模型，将空间区域离散为规则元胞网格，基于局部水动力转移规则，动态模拟极端暴雨条件下的地表径流产汇流过程，精准推演洪水扩散路径与淹没演变趋势。',
    tags: ['洪水灾害', '山洪爆发', '三维淹没', 'SHOWCASE']
  },
  {
    id: 'jinshajiang',
    title: '金沙江',
    img: imgJinsha,
    desc: '金沙江白格高位滑坡曾引发堵江蓄水及溃坝特大洪水灾害。本案例引入多变量耦合元胞自动机（CA）模型，通过局部邻域的状态迭代实现大尺度复杂灾害全链条的快速高精度仿真。',
    tags: ['洪水灾害', '堰塞湖', '灾害全链条', 'SHOWCASE']
  }
]);

// 响应式状态
const searchQuery = ref('');
const selectedTag = ref('');
const showDropdown = ref(false);

// 提取所有不重复的标签 (过滤掉特殊的 SHOWCASE 标签作为普遍特征)
const allTags = computed(() => {
  const tagsSet = new Set<string>();
  cases.value.forEach(c => {
    c.tags.forEach(t => {
      if (t !== 'SHOWCASE') {
        tagsSet.add(t);
      }
    });
  });
  return Array.from(tagsSet);
});

// 计算属性：过滤后的案例数据
const filteredCases = computed(() => {
  return cases.value.filter(c => {
    // 搜索过滤
    const keyword = searchQuery.value.toLowerCase();
    const matchSearch = c.title.toLowerCase().includes(keyword) || c.desc.toLowerCase().includes(keyword);
    // 标签过滤
    const matchTag = selectedTag.value ? c.tags.includes(selectedTag.value) : true;
    return matchSearch && matchTag;
  });
});

// 交互方法
const toggleDropdown = () => {
  showDropdown.value = !showDropdown.value;
};

const selectTag = (tag: string) => {
  selectedTag.value = tag;
  showDropdown.value = false;
};

const emitShowcase = (caseId: string) => {
  if (caseId === 'jinshajiang' || caseId === 'xiaojiaqiao' || caseId === 'bonn') {
    emit('showcase', caseId as ShowcaseCaseId);
  }
};
</script>

<style scoped>
/* 核心容器 */
.gallery-container {
  width: 100%;
  background: var(--sys-glass-bg);
  border: 1px solid var(--sys-border-color);
  box-shadow: inset 0 0 40px var(--sys-border-color-light), 0 16px 50px rgba(0, 0, 0, 0.8), 0 0 10px var(--sys-bg-glow);
  border-radius: 16px;
  padding: 30px; 
  backdrop-filter: blur(15px);
  -webkit-backdrop-filter: blur(15px);
  overflow: hidden;
}

/* 顶部导航与搜索区域 */
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 25px;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--sys-border-color-light);
  gap: 20px;
}

.header h1 {
  font-size: 20px;
  font-weight: 700;
  margin: 0;
  color: #fff;
  text-shadow: var(--sys-text-glow);
  letter-spacing: 1.5px;
  white-space: normal; /* 根据面板宽度自动调整 */
}

/* 搜索和筛选组合，强行保持单行布局 */
.search-filter-group {
  display: flex;
  align-items: center;
  gap: 15px;
  flex-shrink: 0;
}

/* HUD风格输入框 */
.search-box {
  background-color: rgba(0, 0, 0, 0.5);
  border: 1px solid var(--sys-border-color-light);
  border-radius: 6px;
  padding: 10px 18px;
  color: #a0c4e0;
  display: flex;
  align-items: center;
  width: 260px;
  font-size: 13px;
  transition: all 0.3s ease;
  box-shadow: inset 0 0 5px rgba(0, 0, 0, 0.5);
  white-space: nowrap;
  outline: none; /* 移除输入框默认聚焦边框 */
}

.search-box::placeholder {
  color: #a0c4e0;
  opacity: 0.8;
}

.search-box:hover, .search-box:focus {
  border-color: var(--sys-border-color);
  box-shadow: 0 0 12px var(--sys-bg-glow);
}

/* 过滤组件包裹器 (为了定位下拉菜单) */
.filter-wrapper {
  position: relative;
}

/* HUD风格按钮：增加 white-space: nowrap 确保绝对是一行 */
.filter-btn {
  background-color: rgba(0, 229, 255, 0.08);
  border: 1px solid var(--sys-border-color-light);
  border-radius: 6px;
  padding: 10px 18px;
  color: var(--sys-theme-color);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 700;
  transition: all 0.2s ease;
  white-space: nowrap; /* 强制单行显示，绝不换行 */
}

.filter-btn:hover {
  background-color: var(--sys-bg-glow);
  border-color: var(--sys-theme-color);
  text-shadow: var(--sys-text-glow);
  box-shadow: 0 0 10px var(--sys-bg-glow);
}

/* 标签下拉菜单样式 */
.filter-dropdown {
  position: absolute;
  top: calc(100% + 5px);
  right: 0;
  background: var(--sys-glass-bg);
  border: 1px solid var(--sys-border-color);
  border-radius: 6px;
  min-width: 140px;
  z-index: 10;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  padding: 5px 0;
}

.dropdown-item {
  padding: 8px 16px;
  font-size: 13px;
  color: #b8d5ea;
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
}

.dropdown-item:hover, .dropdown-item.active {
  background: rgba(0, 229, 255, 0.15);
  color: var(--sys-theme-color);
}

/* 结果统计信息 */
.results-info {
  color: #b8d5ea;
  font-size: 13px;
  margin-bottom: 25px;
}

.results-info strong {
  color: var(--sys-theme-color);
  font-weight: 700;
}

/* 卡片列表 */
.card-list {
  display: flex;
  flex-direction: column;
  gap: 25px;
  max-height: 60vh;
  overflow-y: auto;
  padding-right: 10px;
}

/* 修改滚动条样式 */
.card-list::-webkit-scrollbar {
  width: 6px;
}
.card-list::-webkit-scrollbar-thumb {
  background: var(--sys-border-color);
  border-radius: 3px;
}
.card-list::-webkit-scrollbar-track {
  background: rgba(0, 0, 0, 0.2);
}

/* 科技风卡片样式 */
.card {
  display: flex;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--sys-border-color-light);
  border-radius: 10px;
  overflow: hidden;
  min-height: 190px;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  cursor: pointer;
}

.card:hover {
  border-color: var(--sys-theme-color);
  box-shadow: inset 0 0 20px rgba(0, 229, 255, 0.15), 0 6px 20px rgba(0, 0, 0, 0.6);
  background: rgba(0, 229, 255, 0.04);
  transform: translateY(-3px) scale(1.01);
}

/* 卡片左侧：纯净图片区域，适配侧边栏宽度可以调整为顶部或按比例 */
.card-image-wrapper {
  width: 320px;
  min-width: 320px;
  position: relative;
  background-color: #04070f;
  border-right: 1px solid var(--sys-border-color-light);
}

.card-image-wrapper img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0.9;
  transition: opacity 0.3s;
}

.card:hover .card-image-wrapper img {
  opacity: 1;
}

/* 卡片右侧：内容区域 */
.card-content {
  padding: 18px 24px;
  display: flex;
  flex-direction: column;
  flex-grow: 1;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 10px;
}

.card-title {
  font-size: 18px;
  font-weight: 700;
  margin: 0;
  color: #fff;
  transition: color 0.3s;
  text-shadow: 0 0 5px rgba(255, 255, 255, 0.1);
}

.card:hover .card-title {
  color: var(--sys-theme-color);
  text-shadow: var(--sys-text-glow);
}

.code-icon {
  color: rgba(0, 229, 255, 0.5);
  font-family: monospace;
  font-size: 16px;
  cursor: pointer;
  transition: color 0.2s;
}

.code-icon:hover {
  color: var(--sys-theme-color);
}

.card-desc {
  color: #b8d5ea;
  font-size: 13px;
  line-height: 1.6;
  margin: 0 0 16px 0;
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 标签样式 */
.tags {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: auto;
}

.tag {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #a0c4e0;
  padding: 4px 14px;
  border-radius: 14px;
  font-size: 11px;
  font-weight: 500;
}

.showcase-tag {
  cursor: pointer;
  font-family: inherit;
}

.showcase-tag:hover {
  background: rgba(0, 229, 255, 0.28);
  box-shadow: 0 0 14px var(--sys-bg-glow);
}

.tag-highlight {
  background: var(--sys-bg-glow);
  border-color: var(--sys-theme-color);
  color: var(--sys-theme-color);
  box-shadow: 0 0 8px var(--sys-bg-glow);
  font-weight: 700;
  letter-spacing: 0.8px;
}

/* 空状态提示 */
.empty-state {
  text-align: center;
  padding: 40px;
  color: #89a8bf;
  font-size: 14px;
  border: 1px dashed var(--sys-border-color-light);
  border-radius: 8px;
  margin-top: 10px;
}
</style>
