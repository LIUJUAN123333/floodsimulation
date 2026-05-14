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
}

declare function DrawTriangleMesh(json: DrawTriangleMesh.FloodMeshData): Cesium.Primitive;

declare namespace DrawTriangleMesh {
  function setFloodCenterPosition(position: Cesium.Cartesian3): void;
  function setFloodMatrx(matrix: Cesium.Matrix4): void;
  function setGridCellSize(size: number): void;
}

export default DrawTriangleMesh;
