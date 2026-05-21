import { ref, shallowRef } from 'vue';
import type * as Cesium from 'cesium';

export const lastLoadedFloodJson = shallowRef<any>(null);
export const floodCellSize = ref<number>(0);
export const currentFloodPrimitive = shallowRef<Cesium.Primitive | null>(null);
export const floodPlaybackToken = ref<number>(0);
