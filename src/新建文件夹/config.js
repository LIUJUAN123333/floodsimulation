// 全局变量和配置
// 使用对象来存储所有配置，确保可以正确更新
window.config = {
    isProcessing: false,
    currentTaskId: null,
    isLineCalculationMode: false,
    selectedPoints: [],
    lineCalculationEntities: [],
    boundsEntities: [],
    elevationSampleEntities: [],
    currentRoughnessFile: null,
    roughnessBounds: null,
    interiorPointEntities: []
};

