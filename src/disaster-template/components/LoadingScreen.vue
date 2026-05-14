<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';

const props = defineProps<{
  isReady: boolean;
  systemTitle?: string;
}>();

const emit = defineEmits<{
  (e: 'loading-complete'): void;
}>();

const progress = ref(0);
const loadingText = ref('INITIALIZING SYSTEM ...');
const isVisible = ref(true);
const isFadingOut = ref(false);
let progressInterval: number | null = null;

const texts = [
  'INITIALIZING SYSTEM ...',
  'LOADING SATELLITE IMAGERY ...',
  'ESTABLISHING ORBITAL UPLINK ...',
  'CALIBRATING TERRAIN DATA ...',
  'SYNCING DISASTER MODULES ...',
  'PREPARING VISUALIZATION ENGINE ...'
];

const completeLoading = () => {
  if (progressInterval) {
    clearInterval(progressInterval);
  }

  setTimeout(() => {
    isFadingOut.value = true;

    setTimeout(() => {
      isVisible.value = false;

      setTimeout(() => {
        emit('loading-complete');
      }, 500);
    }, 1000);
  }, 500);
};

onMounted(() => {
  let textIndex = 0;

  progressInterval = window.setInterval(() => {
    if (progress.value < 85) {
      progress.value += Math.random() * 5;
      if (progress.value > 85) {
        progress.value = 85;
      }
    } else if (props.isReady && progress.value < 100) {
      progress.value += Math.random() * 10;
      if (progress.value >= 100) {
        progress.value = 100;
        loadingText.value = 'SYSTEM READY.';
        completeLoading();
      }
    }

    if (Math.random() > 0.6 && progress.value < 100) {
      textIndex = (textIndex + 1) % texts.length;
      loadingText.value = texts[textIndex];
    }
  }, 150);
});

onUnmounted(() => {
  if (progressInterval) {
    clearInterval(progressInterval);
  }
});
</script>

<template>
  <div v-if="isVisible" class="loading-screen" :class="{ 'fade-out': isFadingOut }">
    <div class="background-overlay"></div>

    <div class="center-content">
      <div class="logo-box">
        <div class="logo-ring"></div>
        <div class="logo-ring-inner"></div>
        <div class="logo-text">{{ props.systemTitle || '洪水动态模拟与三维可视化系统' }}</div>
      </div>

      <div class="progress-container">
        <div class="progress-bar">
          <div class="progress-fill" :style="{ width: `${progress}%` }"></div>
          <div class="progress-glow" :style="{ width: `${progress}%` }"></div>
        </div>

        <div class="text-row">
          <div class="loading-text">{{ loadingText }}</div>
          <div class="percentage">{{ Math.floor(progress) }}%</div>
        </div>
      </div>
    </div>

    <div class="scan-line"></div>
  </div>
</template>

<style scoped>
.loading-screen {
  position: absolute;
  inset: 0;
  z-index: 9999;
  background-color: #050a15;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  transition: opacity 1s cubic-bezier(0.4, 0, 0.2, 1), transform 1s cubic-bezier(0.4, 0, 0.2, 1);
  transform: scale(1);
}

.loading-screen.fade-out {
  opacity: 0;
  transform: scale(1.1);
  pointer-events: none;
}

.background-overlay {
  position: absolute;
  inset: 0;
  background: radial-gradient(circle at center, transparent 0%, #030610 100%);
  background-size: 100% 100%;
  opacity: 0.8;
}

.center-content {
  position: relative;
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 600px;
  max-width: 90vw;
}

.logo-box {
  position: relative;
  width: 150px;
  height: 150px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 50px;
}

.logo-ring {
  position: absolute;
  inset: 0;
  border: 2px dashed rgba(0, 229, 255, 0.4);
  border-radius: 50%;
  animation: spin 8s linear infinite;
}

.logo-ring-inner {
  position: absolute;
  inset: 15px;
  border: 2px solid rgba(0, 229, 255, 0.1);
  border-top-color: var(--sys-theme-color);
  border-bottom-color: var(--sys-theme-color);
  border-radius: 50%;
  animation: spin-reverse 4s linear infinite;
}

.logo-text {
  text-align: center;
  color: var(--sys-theme-color);
  font-weight: 700;
  font-size: 18px;
  letter-spacing: 3px;
  text-shadow: 0 0 10px var(--sys-theme-color);
  line-height: 1.5;
}

.progress-container {
  width: 100%;
}

.progress-bar {
  width: 100%;
  height: 4px;
  background: rgba(255, 255, 255, 0.1);
  position: relative;
  overflow: hidden;
  border-radius: 2px;
}

.progress-fill {
  position: relative;
  z-index: 2;
  height: 100%;
  background: var(--sys-theme-color);
  transition: width 0.2s ease;
}

.progress-glow {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 1;
  height: 100%;
  background: var(--sys-theme-color);
  filter: blur(5px);
  transition: width 0.2s ease;
}

.text-row {
  display: flex;
  justify-content: space-between;
  margin-top: 12px;
  font-family: monospace;
  font-size: 12px;
  letter-spacing: 1px;
}

.loading-text {
  color: #a0c4e0;
}

.percentage {
  color: var(--sys-theme-color);
  font-weight: 700;
  text-shadow: 0 0 5px var(--sys-theme-color);
}

.scan-line {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 2px;
  background: rgba(0, 229, 255, 0.3);
  box-shadow: 0 0 10px rgba(0, 229, 255, 0.5);
  animation: scan 3s linear infinite;
  z-index: 10;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}

@keyframes spin-reverse {
  from {
    transform: rotate(360deg);
  }

  to {
    transform: rotate(0deg);
  }
}

@keyframes scan {
  0% {
    top: -10%;
    opacity: 0;
  }

  10% {
    opacity: 1;
  }

  90% {
    opacity: 1;
  }

  100% {
    top: 110%;
    opacity: 0;
  }
}
</style>
