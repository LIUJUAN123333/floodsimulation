<script setup lang="ts">
import { computed } from 'vue';
import { currentFloodAreaM2, lastLoadedFloodJson } from '../store/floodState';

const floodAreaM2 = computed(() => currentFloodAreaM2.value);
</script>

<template>
  <div class="flood-area-panel" v-if="lastLoadedFloodJson && floodAreaM2 > 0">
    <div class="panel-header">淹没面积结算</div>
    <div class="panel-content">
      <div class="info-row">
        <span>当前淹没面积:</span>
        <span class="value">{{ Number((floodAreaM2 / 1_000_000).toFixed(3)) }} km²</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.flood-area-panel {
  position: absolute;
  top: 725px;      /* 将位置移到左上角，避开右侧的所有控制面板 */
  right: 20px;
  z-index: 10001; /* 保持最顶层级 */
  width: 280px;
  background-color: rgba(4, 20, 37, 0.9);
  border: 1px solid #31467D;
  border-radius: 6px;
  color: white;
  display: flex;
  flex-direction: column;
}

.panel-header {
  padding: 10px;
  font-size: 14px;
  font-weight: bold;
  border-bottom: 1px solid #31467D;
}

.panel-content {
  padding: 12px;
  font-size: 13px;
}

.info-row {
  display: flex;
  justify-content: space-between;
}

.value {
  color: #00ffff;
  font-weight: bold;
}
</style>
