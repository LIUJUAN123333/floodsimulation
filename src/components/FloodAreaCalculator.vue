<script setup lang="ts">
import { ref, watch } from 'vue';
import { lastLoadedFloodJson, floodCellSize } from '../store/floodState';

const floodAreaM2 = ref(0);

watch(lastLoadedFloodJson, (newData) => {
  if (newData && newData.Vector && newData.Face && floodCellSize.value > 0) {
    const v = newData.Vector;
    const faces = newData.Face;
    let area = 0.0;
    
    for (let i = 0; i < faces.length; i += 3) {
      const idx0 = faces[i] * 3;
      const idx1 = faces[i + 1] * 3;
      const idx2 = faces[i + 2] * 3;
      
      const x0 = v[idx0], y0 = v[idx0 + 1];
      const x1 = v[idx1], y1 = v[idx1 + 1];
      const x2 = v[idx2], y2 = v[idx2 + 1];
      
      area += 0.5 * Math.abs((x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0));
    }
    
    floodAreaM2.value = area * floodCellSize.value * floodCellSize.value;
  } else {
    floodAreaM2.value = 0;
  }
}, { immediate: true });
</script>

<template>
  <div class="flood-area-panel" v-if="lastLoadedFloodJson && floodAreaM2 > 0">
    <div class="panel-header">淹没面积结算</div>
    <div class="panel-content">
      <div class="info-row">
        <span>当前淹没面积:</span>
        <span class="value">{{ (floodAreaM2 / 1000000).toFixed(6) }} km²</span>
      </div>
      <div class="info-row" style="margin-top: 5px;">
        <span></span>
        <span class="value">{{ (floodAreaM2 / 10000).toFixed(6) }} hm²</span>
      </div>
      <div class="info-row" style="margin-top: 5px;">
        <span></span>
        <span class="value">{{ floodAreaM2.toFixed(3) }} m²</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.flood-area-panel {
  position: absolute;
  top: 350px;
  right: 340px;
  z-index: 1000;
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