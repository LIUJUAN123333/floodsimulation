import { ref, shallowRef } from 'vue';

export const lastLoadedFloodJson = shallowRef<any>(null);
export const floodCellSize = ref<number>(0);
