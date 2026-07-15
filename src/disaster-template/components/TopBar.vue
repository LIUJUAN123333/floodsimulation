<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';

type SubsystemId = 'landslide' | 'flood' | 'earthquake' | 'waterlog' | 'debris';

const props = withDefaults(
  defineProps<{
    systemTitle?: string;
    activeSubsystem?: SubsystemId;
  }>(),
  {
    systemTitle: '洪水动态模拟与三维可视化系统',
    activeSubsystem: 'flood'
  }
);

const dateStr = ref('');
const timeStr = ref('');
const weekStr = ref('');

let timer: ReturnType<typeof setInterval> | null = null;
const weekDays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

const subsystemItems = computed(() => [
  { id: 'flood', name: '洪水', icon: '🌊', color: '#cbd5e1' }, /* 亮银灰 */
  { id: 'landslide', name: '滑坡', icon: '⛰️', color: '#94a3b8' }, /* 科技冷灰 */
  { id: 'earthquake', name: '地震', icon: '💥', color: '#64748b' }, /* 深板岩灰 */
  { id: 'waterlog', name: '内涝', icon: '💧', color: '#a0aec0' }, /* 标准灰 */
  { id: 'debris', name: '泥石流', icon: '🪨', color: '#8892b0' }  /* 灰蓝色 */
]);

const navMenus = ref([
  { id: 'intro', name: '项目简介' },
  { id: 'simulation', name: '仿真模拟' },
  { id: 'analysis', name: '灾情分析' },
  { id: 'demo', name: '案例演示' },
  { id: 'monitor', name: '数据监测' },
  { id: 'basic', name: '基础功能' },
  { id: 'help', name: '帮助' }
]);
const activeNavMenu = ref('simulation');
const emit = defineEmits<{
  (e: 'open-panel', payload: { id: string; title: string }): void;
  (e: 'reset-ui'): void;
}>();

const handleNavClick = (menu: { id: string; name: string }) => {
  if (activeNavMenu.value === menu.id) {
    activeNavMenu.value = ''; // 再次点击取消高亮
  } else {
    activeNavMenu.value = menu.id;
  }
  emit('open-panel', { id: menu.id, title: menu.name });
};

const handleSubsystemClick = (id: string) => {
  if (id === 'flood') {
    activeNavMenu.value = ''; // 重置顶部导航高亮
    emit('reset-ui');
  }
};

const updateTime = () => {
  const now = new Date();
  const fmt = (value: number) => String(value).padStart(2, '0');

  dateStr.value = `${now.getFullYear()}.${fmt(now.getMonth() + 1)}.${fmt(now.getDate())}`;
  timeStr.value = `${fmt(now.getHours())}:${fmt(now.getMinutes())}:${fmt(now.getSeconds())}`;
  weekStr.value = weekDays[now.getDay()];
};

onMounted(() => {
  updateTime();
  timer = setInterval(updateTime, 1000);
});

onUnmounted(() => {
  if (timer) clearInterval(timer);
});
</script>

<template>
  <div class="layout-wrapper">
    <!-- 左侧竖列灾害图标导航 -->
    <div class="side-nav-dock">
      <div
        v-for="sys in subsystemItems"
        :key="sys.id"
        class="orbit-node"
        :class="{ active: sys.id === props.activeSubsystem }"
        :style="{ '--node-color': sys.color }"
        @click="handleSubsystemClick(sys.id)"
      >
        <!-- 洪水 -->
        <svg v-if="sys.id === 'flood'" class="node-icon" viewBox="0 0 24 24" aria-hidden>
          <path d="M2 13.5C4.5 12 7 15 12 13.5C17 12 19.5 15 22 13.5V20C19.5 21.5 17 18.5 12 20C7 21.5 4.5 18.5 2 20V13.5Z" fill="currentColor" opacity="0.6"/>
          <path d="M2 9.5C4.5 8 7 11 12 9.5C17 8 19.5 11 22 9.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        </svg>
        <!-- 滑坡 -->
        <svg v-else-if="sys.id === 'landslide'" class="node-icon" viewBox="0 0 24 24" aria-hidden>
          <path d="M11 15L21 21H3Z" fill="currentColor" opacity="0.4"/>
          <path d="M3 21L10 7L13 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
          <circle cx="16" cy="14" r="1.5" fill="currentColor"/>
          <circle cx="18" cy="18" r="1.2" fill="currentColor"/>
          <path d="M14 9 L15 11" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        <!-- 地震 -->
        <svg v-else-if="sys.id === 'earthquake'" class="node-icon" viewBox="0 0 24 24" aria-hidden>
          <path d="M2 12H6L8 7L12 18L15 10L17 12H22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M3 20H21" fill="none" stroke="currentColor" stroke-width="1.8" stroke-dasharray="2 3"/>
        </svg>
        <!-- 内涝 -->
        <svg v-else-if="sys.id === 'waterlog'" class="node-icon" viewBox="0 0 24 24" aria-hidden>
          <path d="M6 14V5H10V8H14V4H18V14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
          <path d="M2 15C5 13.5 7 16.5 12 15C17 13.5 19 16.5 22 15V20H2V15Z" fill="currentColor" opacity="0.9"/>
        </svg>
        <!-- 泥石流 -->
        <svg v-else-if="sys.id === 'debris'" class="node-icon" viewBox="0 0 24 24" aria-hidden>
          <path d="M3 5L20 20H3V5Z" fill="currentColor" opacity="0.2"/>
          <path d="M5 9L15 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
          <rect x="9" y="8" width="4" height="4" rx="1" fill="currentColor" transform="rotate(20 11 10)"/>
          <rect x="15" y="14" width="3" height="3" rx="0.5" fill="currentColor" transform="rotate(45 16 15)"/>
          <circle cx="8" cy="14" r="1.5" fill="currentColor"/>
        </svg>
        <svg v-else class="node-icon" viewBox="0 0 24 24" aria-hidden>
          <circle cx="12" cy="12" r="8" fill="currentColor" />
        </svg>
        <div class="node-tooltip">{{ sys.name }}</div>
        <div v-if="sys.id === props.activeSubsystem" class="node-glow-ring"></div>
      </div>
    </div>

    <!-- 顶部导航栏 -->
    <div id="top-bar">
      <!-- 左侧内容：标题 -->
      <div class="top-left-container">
        <div id="top-title-wrapper">
          <span class="title-text">{{ props.systemTitle }}</span>
        </div>
      </div>

      <!-- 右侧内容：菜单、时间 -->
      <div class="top-right-container">
        <div class="nav-menu">
          <div
            v-for="menu in navMenus"
              :key="menu.id"
              class="nav-tab"
              :class="{ active: activeNavMenu === menu.id }"
              @click="handleNavClick(menu)"
          >
            {{ menu.name }}
          </div>
        </div>

        <div class="time-display-container">
          <div class="main-time">{{ timeStr }}</div>
          <div class="sub-date">
            <span class="date-text">{{ dateStr }}</span>
            <span class="date-divider"></span>
            <span class="accent-week">{{ weekStr }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 整个顶栏加上对侧边栏的统筹容器 */
.layout-wrapper {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

#top-bar {
  position: absolute;
  top: 12px;
  left: 20px; /* 左右间距一致 */
  right: 20px;
  min-height: 46px;
  z-index: 9999;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 34px; /* 右侧内边距加大，让右边内容往右移动 */
  box-sizing: border-box;
  background: rgba(30, 40, 70, 0.35);
  border-radius: 12px;
  box-shadow: 0 8px 32px 0 rgba(30, 40, 70, 0.18);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(80, 120, 255, 0.18);
  pointer-events: none;
}

.top-left-container,
.top-right-container,
#top-title-wrapper {
  pointer-events: auto;
}

.top-left-container {
  display: flex;
  gap: 16px;
  align-items: center;
  flex: 1;
  justify-content: flex-start;
}

.top-right-container {
  display: flex;
  flex: 1.4; /* 放大右侧容器 */
  justify-content: flex-end;
  align-items: center;
  gap: 20px;
  padding-right: 8px; /* 进一步把内部内容往右挤 */
}

.nav-menu {
  display: flex;
  align-items: center;
}

.nav-tab {
  padding: 8px 14px;
  font-size: 17px;
  color: #a0aec0;
  cursor: pointer;
  position: relative;
  transition: all 0.3s ease;
  background: transparent;
  border: none;
  font-weight: 500;
  white-space: nowrap;
  letter-spacing: 1px;
  display: flex;
  align-items: center;
}

.nav-menu {
  display: flex;
  align-items: center;
  gap: 0; /* 使用短竖线分隔，不依赖 gap */
}

/* 使用伪元素绘制短竖线，居中显示并保持文字与分隔线距离较近 */
.nav-tab + .nav-tab {
  border-left: none;
  padding-left: 10px; /* 分隔线右侧的文字间距 */
  margin-left: 6px;   /* 分隔线左侧的间距 */
  position: relative;
}

.nav-tab + .nav-tab::before {
  content: '';
  position: absolute;
  left: 4px; /* 离左侧边缘一点，靠近两项中间 */
  top: 50%;
  transform: translateY(-50%);
  width: 1px;
  height: 12px; /* 缩短竖线长度 */
  background: rgba(255, 255, 255, 0.22);
}

.nav-tab:hover,
.nav-tab.active {
  color: var(--sys-theme-color, #00e5ff);
  text-shadow: 0 0 10px rgba(0, 229, 255, 0.6);
  font-weight: 600;
}

.time-display-container {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: flex-end;
  height: 100%;
  min-width: 120px;
}

.main-time {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: 24px;
  font-weight: 300;
  color: #ffffff;
  letter-spacing: 2px;
  line-height: 1;
  text-shadow: 0 0 10px rgba(0, 229, 255, 0.4);
}

.sub-date {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #8be1ff;
  margin-top: 4px;
  font-weight: 400;
  white-space: nowrap;
}

.date-divider {
  width: 1px;
  height: 10px;
  background: rgba(139, 225, 255, 0.5);
}

.accent-week {
  color: #8be1ff;
  font-weight: 400;
  white-space: nowrap;
}

#top-title-wrapper {
  display: flex;
  align-items: center;
  font-size: 24px;
  font-weight: 600;
  color: #fff;
  letter-spacing: 4px;
  text-shadow: 0 0 10px var(--sys-theme-color), 0 0 20px var(--sys-border-color);
  white-space: nowrap;
}

.side-nav-dock {
  position: absolute;
  top: 110px; /* 下移，错开顶部导航栏下方一定距离 */
  left: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  pointer-events: auto;
  z-index: 10000;
}

.orbit-node {
  position: relative;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: rgba(30, 40, 70, 0.6);
  backdrop-filter: blur(8px);
  border: 4px solid #1a233a;
  display: flex;
  justify-content: center;
  align-items: center;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
}

.orbit-node:hover {
  transform: translateX(4px) scale(1.1);
  box-shadow: 0 0 15px var(--node-color);
  background: rgba(40, 50, 80, 0.8);
}

.orbit-node.active {
  transform: scale(1.15);
  box-shadow: 0 0 20px var(--node-color);
  border-color: rgba(255, 255, 255, 0.2);
}

.node-icon {
  width: 28px;
  height: 28px;
  color: var(--node-color);
  display: block;
}

.node-tooltip {
  position: absolute;
  left: 60px;
  background: rgba(10, 20, 40, 0.9);
  border: 1px solid var(--node-color);
  padding: 6px 12px;
  border-radius: 6px;
  color: #fff;
  font-size: 14px;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transform: translateX(-10px);
  transition: all 0.3s ease;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
}

.orbit-node:hover .node-tooltip {
  opacity: 1;
  transform: translateX(0);
}

.node-tooltip::before {
  content: '';
  position: absolute;
  left: -5px;
  top: 50%;
  transform: translateY(-50%);
  border-width: 5px 5px 5px 0;
  border-style: solid;
  border-color: transparent var(--node-color) transparent transparent;
}

.node-glow-ring {
  position: absolute;
  top: -4px;
  left: -4px;
  right: -4px;
  bottom: -4px;
  border-radius: 50%;
  border: 1px solid var(--node-color);
  animation: pulse-ring 2s infinite cubic-bezier(0.215, 0.61, 0.355, 1);
  pointer-events: none;
}

@keyframes pulse-ring {
  0% {
    opacity: 0.9;
    transform: scale(0.85);
  }

  70% {
    opacity: 0;
    transform: scale(1.4);
  }

  100% {
    opacity: 0;
    transform: scale(1.4);
  }
}

@media (max-width: 860px) {
  #top-bar {
    width: calc(100% - 24px);
    padding: 8px 12px;
    gap: 10px;
  }

  #top-title-wrapper {
    font-size: 16px;
    letter-spacing: 2px;
  }

  .nav-menu {
    gap: 6px;
    padding: 4px 8px;
  }

  .nav-tab {
    padding: 4px 10px;
    font-size: 12px;
  }

  .orbit-node {
    width: 24px;
    height: 24px;
  }

  .orbit-node.active {
    width: 30px;
    height: 30px;
  }
}

@media (max-width: 700px) {
  .nav-menu {
    display: none;
  }

  .main-time {
    font-size: 14px;
  }

  .sub-date {
    font-size: 10px;
  }
}
</style>
