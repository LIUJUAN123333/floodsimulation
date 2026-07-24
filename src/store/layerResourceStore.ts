import { computed, ref } from 'vue';

export type LayerBounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};

export type LayerResourceSource = 'builtin' | 'uploaded';

export type TerrainResource = {
  id: string;
  name: string;
  kind: 'terrain';
  source: LayerResourceSource;
  url: string;
  bounds: LayerBounds;
  minzoom?: number;
  maxzoom?: number;
  format?: string;
  enabledForAutoMatch: boolean;
  createdAt?: string;
};

export type ImageryResource = {
  id: string;
  name: string;
  kind: 'imagery';
  source: LayerResourceSource;
  url: string;
  bounds: LayerBounds;
  minzoom?: number;
  maxzoom?: number;
  format?: string;
  extension?: string;
  tileScheme?: string;
  visible?: boolean;
  alpha?: number;
  createdAt?: string;
};

export type TerrainProviderKind = 'world' | 'terrain-resource' | 'ellipsoid';

const PY_API_BASE = '/py-api';
const pythonApiUrl = (path: string) => `${PY_API_BASE}${path.startsWith('/') ? path : `/${path}`}`;

const parseApiJson = async (response: Response, fallbackMessage: string) => {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    const looksLikeHtml = text.trim().startsWith('<');
    throw new Error(looksLikeHtml
      ? '图层资源接口未生效，请重启 Python 后端后再试。'
      : fallbackMessage);
  }
};

export const normalizeLayerResourceUrl = (url: string) => {
  if (/^(https?:|blob:|data:)/i.test(url) || url.startsWith('/data/') || url.startsWith(PY_API_BASE)) {
    return url;
  }
  return pythonApiUrl(url);
};

export const terrainResources = ref<TerrainResource[]>([]);
export const imageryResources = ref<ImageryResource[]>([]);
export const layerResourcesLoading = ref(false);
export const layerResourcesError = ref('');
export const currentFloodExtent = ref<LayerBounds | null>(null);
export const selectedTerrainResourceId = ref<string | null>(null);
export const activeTerrainId = ref('ellipsoid');
export const activeTerrainName = ref('无地形');
export const activeTerrainKind = ref<TerrainProviderKind>('ellipsoid');

const FALLBACK_TERRAIN_RESOURCES: TerrainResource[] = [
  {
    id: 'builtin-terrain-yongchuan-3blocks-qm',
    name: 'yongchuan-3blocks-qm',
    kind: 'terrain',
    source: 'builtin',
    url: '/data/terrain/yongchuan-3blocks-qm/',
    bounds: {
      west: 105.91839551925659,
      south: 29.42561388015747,
      east: 105.95354318618774,
      north: 29.453766345977783
    },
    minzoom: 0,
    maxzoom: 16,
    format: 'quantized-mesh-1.0',
    enabledForAutoMatch: true
  }
];

const FALLBACK_IMAGERY_RESOURCES: ImageryResource[] = [
  {
    id: 'builtin-imagery-yongchuan-3-l19',
    name: 'yongchuan-3-l19',
    kind: 'imagery',
    source: 'builtin',
    url: '/data/imagery/yongchuan-3-l19/',
    bounds: {
      west: 105.91845550696213,
      south: 29.425627967833694,
      east: 105.9518409625705,
      north: 29.452205640319157
    },
    minzoom: 0,
    maxzoom: 19,
    format: 'image/png',
    extension: 'png',
    tileScheme: 'google',
    visible: false,
    alpha: 0.88
  }
];

export const activeTerrainSummary = computed(() => {
  if (activeTerrainKind.value === 'world') return 'Cesium 全球地形';
  if (activeTerrainKind.value === 'terrain-resource') return activeTerrainName.value;
  return '无地形';
});

const isValidBounds = (bounds: LayerBounds | null | undefined) => (
  !!bounds &&
  Number.isFinite(bounds.west) &&
  Number.isFinite(bounds.south) &&
  Number.isFinite(bounds.east) &&
  Number.isFinite(bounds.north) &&
  bounds.west < bounds.east &&
  bounds.south < bounds.north
);

const normalizeTerrain = (resource: TerrainResource): TerrainResource => ({
  ...resource,
  enabledForAutoMatch: resource.enabledForAutoMatch !== false,
  url: normalizeLayerResourceUrl(resource.url)
});

const normalizeImagery = (resource: ImageryResource): ImageryResource => ({
  ...resource,
  url: normalizeLayerResourceUrl(resource.url),
  extension: resource.extension || 'png',
  tileScheme: resource.tileScheme || 'google',
  alpha: Number.isFinite(resource.alpha) ? Number(resource.alpha) : 0.88,
  visible: !!resource.visible
});

export const refreshLayerResources = async () => {
  layerResourcesLoading.value = true;
  layerResourcesError.value = '';
  try {
    const response = await fetch(pythonApiUrl('/api/layer-resources'));
    const result = await parseApiJson(response, '图层资源列表读取失败');
    if (!response.ok || !result.success) {
      throw new Error(result.error || result.message || '图层资源列表读取失败');
    }

    const existingTerrainFlags = new Map(terrainResources.value.map((item) => [item.id, item.enabledForAutoMatch]));
    terrainResources.value = (Array.isArray(result.terrain) ? result.terrain : [])
      .filter((item: TerrainResource) => isValidBounds(item.bounds))
      .map((item: TerrainResource) => {
        const normalized = normalizeTerrain(item);
        const existingFlag = existingTerrainFlags.get(normalized.id);
        return existingFlag === undefined ? normalized : { ...normalized, enabledForAutoMatch: existingFlag };
      });

    const existingImagery = new Map(imageryResources.value.map((item) => [item.id, item]));
    imageryResources.value = (Array.isArray(result.imagery) ? result.imagery : [])
      .filter((item: ImageryResource) => isValidBounds(item.bounds))
      .map((item: ImageryResource) => {
        const normalized = normalizeImagery(item);
        const old = existingImagery.get(normalized.id);
        return old ? { ...normalized, visible: old.visible, alpha: old.alpha } : normalized;
      });
  } catch (error) {
    layerResourcesError.value = error instanceof Error ? error.message : '图层资源列表读取失败';
    if (!terrainResources.value.length) {
      terrainResources.value = FALLBACK_TERRAIN_RESOURCES.map(normalizeTerrain);
    }
    if (!imageryResources.value.length) {
      imageryResources.value = FALLBACK_IMAGERY_RESOURCES.map(normalizeImagery);
    }
  } finally {
    if (
      selectedTerrainResourceId.value &&
      !terrainResources.value.some((resource) => resource.id === selectedTerrainResourceId.value)
    ) {
      selectedTerrainResourceId.value = null;
    }
    layerResourcesLoading.value = false;
  }
};

export const uploadLayerResourceZip = async (kind: 'terrain' | 'imagery', file: File, name?: string) => {
  const formData = new FormData();
  formData.append('kind', kind);
  formData.append('file', file, file.name);
  if (name?.trim()) {
    formData.append('name', name.trim());
  }

  const response = await fetch(pythonApiUrl('/api/layer-resources/upload'), {
    method: 'POST',
    body: formData
  });
  const result = await parseApiJson(response, '图层资源上传失败');
  if (!response.ok || !result.success) {
    throw new Error(result.error || result.message || '图层资源上传失败');
  }
  await refreshLayerResources();
  return result.resource;
};

export const deleteLayerResource = async (resource: TerrainResource | ImageryResource) => {
  if (resource.source !== 'uploaded') {
    throw new Error('内置资源不能删除');
  }

  const response = await fetch(pythonApiUrl(`/api/layer-resources/${resource.kind}/${resource.id}`), {
    method: 'DELETE'
  });
  const result = await parseApiJson(response, '图层资源删除失败');
  if (!response.ok || !result.success) {
    throw new Error(result.error || result.message || '图层资源删除失败');
  }
  await refreshLayerResources();
};

export const setSelectedTerrainResource = (resourceId: string | null) => {
  selectedTerrainResourceId.value = resourceId;
};

export const setImageryVisible = (resourceId: string, visible: boolean) => {
  imageryResources.value = imageryResources.value.map((resource) => (
    resource.id === resourceId ? { ...resource, visible } : resource
  ));
};

export const setImageryAlpha = (resourceId: string, alpha: number) => {
  const safeAlpha = Math.min(Math.max(Number(alpha) || 0, 0), 1);
  imageryResources.value = imageryResources.value.map((resource) => (
    resource.id === resourceId ? { ...resource, alpha: safeAlpha } : resource
  ));
};

export const setCurrentFloodExtent = (bounds: LayerBounds | null) => {
  currentFloodExtent.value = isValidBounds(bounds) ? bounds : null;
};

export const selectedTerrainResource = computed(() => (
  selectedTerrainResourceId.value
    ? terrainResources.value.find((resource) => resource.id === selectedTerrainResourceId.value) ?? null
    : null
));

export const setActiveTerrainState = (
  id: string,
  name: string,
  kind: TerrainProviderKind
) => {
  activeTerrainId.value = id;
  activeTerrainName.value = name;
  activeTerrainKind.value = kind;
};
