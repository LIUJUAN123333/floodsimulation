// 主入口文件 - 初始化所有功能

// DOM加载完成后初始化
document.addEventListener('DOMContentLoaded', function () {
    initializeEventListeners();
});

// 初始化事件监听器
function initializeEventListeners() {
    // 格式转换表单
    const convertForm = document.getElementById('convertForm');
    if (convertForm) {
        convertForm.addEventListener('submit', window.convertHandler.handleConvert);
    }
    // 粗糙度计算表单
    const roughnessForm = document.getElementById('roughnessForm');
    if (roughnessForm) {
        roughnessForm.addEventListener('submit', window.roughnessHandler.handleRoughness);
    }
    // 瓦片计算相关事件
    const startLineCalculationBtn = document.getElementById('startLineCalculation');
    const clearLineCalculationBtn = document.getElementById('clearLineCalculation');
    const exportTilesResultBtn = document.getElementById('exportTilesResult');
    if (startLineCalculationBtn) {
        startLineCalculationBtn.addEventListener('click', window.tileCalculation.startLineCalculation);
    }
    if (clearLineCalculationBtn) {
        clearLineCalculationBtn.addEventListener('click', window.tileCalculation.clearLineCalculation);
    }
    if (exportTilesResultBtn) {
        exportTilesResultBtn.addEventListener('click', window.tileCalculation.exportTilesResult);
    }
}

// 导出到全局作用域，保持向后兼容
window.clearAllBounds = window.mapDisplay.clearAllBounds;

// 导出函数供全局使用，保持向后兼容
window.terrainProcessor = {
    showError: window.uiUtils.showError,
    showResult: window.uiUtils.showResult,
    startAutoDownload: window.uiUtils.startAutoDownload,
    startLineCalculation: window.tileCalculation.startLineCalculation,
    clearLineCalculation: window.tileCalculation.clearLineCalculation,
    exportTilesResult: window.tileCalculation.exportTilesResult,
    displayBoundsOnMap: window.mapDisplay.displayBoundsOnMap,
    clearBoundsOnMap: window.mapDisplay.clearBoundsOnMap,
    displayElevationSamples: window.mapDisplay.displayElevationSamples,
    clearElevationSamples: window.mapDisplay.clearElevationSamples,
    clearAllBounds: window.mapDisplay.clearAllBounds
};

