export type RoamViewMode = 'third' | 'first';

export type RoamPhase =
  | 'idle'
  | 'drawing'
  | 'building'
  | 'ready'
  | 'transitioning'
  | 'running'
  | 'paused'
  | 'stopped'
  | 'completed'
  | 'error';

export interface RoamUiState {
  phase: RoamPhase;
  mode: RoamViewMode;
  progress: number;
  distance: number;
  totalDistance: number;
  speed: number;
  relativeHeight: number;
  pointCount: number;
  routeReady: boolean;
  message: string;
}

export const createInitialRoamState = (): RoamUiState => ({
  phase: 'idle',
  mode: 'third',
  progress: 0,
  distance: 0,
  totalDistance: 0,
  speed: 80,
  relativeHeight: 120,
  pointCount: 0,
  routeReady: false,
  message: '可手动规划路径，或导入包含坐标系信息的完整 Shapefile 航线。'
});
