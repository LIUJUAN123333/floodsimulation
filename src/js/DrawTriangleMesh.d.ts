import * as Cesium from 'cesium';

declare namespace DrawTriangleMesh {
  interface FloodDepth {
    0: number[];
    1: [number, number];
  }

  interface FloodMeshData {
    Depth: FloodDepth;
    Vector: number[];
    Face: number[];
  }

  interface CachedMeshData {
    positions: number[];
    values: number[];
    triangles: number[];
    stats?: {
      minValue?: number;
      maxValue?: number;
    };
  }

  interface CachedMeshPrimitiveOptions {
    mesh: CachedMeshData;
    stats?: CachedMeshData['stats'];
    alpha?: number;
    heightScale?: number;
    surfaceOffset?: number;
    terrainHeights?: ArrayLike<number>;
    colorRamp?: Array<string | [number, number, number]>;
    id?: string;
  }
}

declare function DrawTriangleMesh(json: DrawTriangleMesh.FloodMeshData): Cesium.Primitive;

declare namespace DrawTriangleMesh {
  function setFloodCenterPosition(position: Cesium.Cartesian3): void;
  function setFloodMatrx(matrix: Cesium.Matrix4): void;
  function setGridCellSize(size: number): void;
  function setHeadingOffsetDegrees(degrees: number): void;
  function getCurrentModelMatrix(): Cesium.Matrix4 | null;
  function createMeshPrimitive(options: CachedMeshPrimitiveOptions): Cesium.Primitive;
  function worldToFloodGrid(position: Cesium.Cartesian3): {
    x: number;
    y: number;
    z: number;
    localX: number;
    localY: number;
    cellSize: number;
  } | null;
}

export default DrawTriangleMesh;
