// ============================================
// 多边形绘制管理模块
// ============================================

/**
 * 显示cellsize更新消息
 * @param {number} cellsize - 新的cellsize值
 * @param {string} inputId - 输入框ID，用于定位消息显示位置
 */
function showCellsizeUpdateMessage(cellsize, inputId) {
    const message = `插值步长已更新为ASCII文件的cellsize: ${cellsize} 米`;

    // 查找对应的表单容器
    const form = document.getElementById('polygonClipForm');
    if (!form) return;

    // 移除已有的消息
    const existingMessage = document.getElementById('polygonCellsizeMessage');
    if (existingMessage) {
        existingMessage.remove();
    }

    // 创建新消息
    const messageDiv = document.createElement('div');
    messageDiv.id = 'polygonCellsizeMessage';
    messageDiv.className = 'alert alert-info mt-2';
    messageDiv.style.cssText = 'padding: 8px; font-size: 12px; margin-bottom: 10px;';
    messageDiv.textContent = message;

    // 插入到表单中
    form.appendChild(messageDiv);

    // 3秒后自动隐藏
    setTimeout(() => {
        if (messageDiv) {
            messageDiv.remove();
        }
    }, 3000);

    console.log(message);
}
const PolygonDrawingManager = {
    // 状态变量
    isDrawingMode: false,
    polygonPoints: [],
    polygonEntities: [],
    currentPolygon: null,
    floatingPoint: null,
    floatingPointPosition: null,
    handler: null,

    // 初始化
    init() {
        this.isDrawingMode = false;
        this.polygonPoints = [];
        this.polygonEntities = [];
        this.currentPolygon = null;
        this.floatingPoint = null;
        this.floatingPointPosition = null;
        this.handler = null;
    },

    // 移除实体
    safeRemoveEntity(entity) {
        if (entity && window.cesiumViewer && window.cesiumViewer.entities.contains(entity)) {
            window.cesiumViewer.entities.remove(entity);
        }
    },

    // 隐藏信息框和清除选中实体
    hideInfoBoxAndClearSelection() {
        if (window.cesiumViewer) {
            if (window.cesiumViewer.infoBox) {
                window.cesiumViewer.infoBox.viewModel.showInfo = false;
            }
            if (window.cesiumViewer.selectedEntity) {
                window.cesiumViewer.selectedEntity = undefined;
            }
        }
    },

    // 恢复相机控制
    restoreCameraControls() {
        if (window.cesiumViewer && this.originalEnableRotate !== undefined) {
            const cameraController = window.cesiumViewer.scene.screenSpaceCameraController;
            cameraController.enableRotate = this.originalEnableRotate;
            cameraController.enableTilt = this.originalEnableTilt;
            cameraController.enableLook = this.originalEnableLook;
        }
    },

    // 恢复选择指示器
    restoreSelectionIndicator() {
        if (window.cesiumViewer?._selectionIndicator) {
            window.cesiumViewer._selectionIndicator.container.style.display = "";
        }
    },

    // 销毁事件处理器
    destroyHandler() {
        if (this.handler) {
            this.handler.destroy();
            this.handler = null;
        }
    },

    // 清除当前绘制状态
    clearCurrentDrawing() {
        this.safeRemoveEntity(this.currentPolygon);
        this.currentPolygon = null;
        this.polygonPoints = [];
        this.floatingPointPosition = null;
    },

    // 获取多边形样式配置
    getPolygonStyle(outlineWidth = 1) {
        return {
            material: Cesium.Color.CYAN.withAlpha(0.3),
            outline: true,
            outlineColor: Cesium.Color.CYAN,
            outlineWidth: outlineWidth,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
        };
    },

    // 开始画多边形模式
    startDrawing() {
        if (!window.cesiumViewer) return;

        this.safeRemoveEntity(this.currentPolygon);
        this.currentPolygon = null;
        this.hideInfoBoxAndClearSelection();

        this.isDrawingMode = true;
        this.polygonPoints = [];
        this.floatingPointPosition = null;
        this.updateDrawingState(false, true, true);

        // 禁用相机旋转、倾斜和查看，但保留平移和缩放功能
        const cameraController = window.cesiumViewer.scene.screenSpaceCameraController;
        this.originalEnableRotate = cameraController.enableRotate;
        this.originalEnableTilt = cameraController.enableTilt;
        this.originalEnableLook = cameraController.enableLook;
        cameraController.enableRotate = false;
        cameraController.enableTilt = false;
        cameraController.enableLook = false;

        // 禁用选择指示器
        if (window.cesiumViewer._selectionIndicator) {
            window.cesiumViewer._selectionIndicator.container.style.display = "none";
        }

        // 创建事件处理器
        this.handler = new Cesium.ScreenSpaceEventHandler(window.cesiumViewer.scene.canvas);
        this.handler.setInputAction((event) => {
            this.hideInfoBoxAndClearSelection();
            this.onDrawingClick(event);
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
        this.handler.setInputAction((event) => this.onMouseMove(event), Cesium.ScreenSpaceEventType.MOUSE_MOVE);
        this.handler.setInputAction((event) => this.onRightClick(event), Cesium.ScreenSpaceEventType.RIGHT_CLICK);
    },

    // 停止画多边形模式
    stopDrawing() {
        this.isDrawingMode = false;

        if (this.polygonPoints.length >= 3) {
            this.finishCurrentPolygon();
        } else {
            this.clearCurrentDrawing();
        }

        this.updateDrawingState(true, false, true);
        this.restoreCameraControls();
        this.restoreSelectionIndicator();
        this.destroyHandler();
    },

    // 清除所有多边形
    clearDrawing() {
        this.isDrawingMode = false;
        this.polygonPoints = [];
        this.floatingPointPosition = null;

        if (window.cesiumViewer) {
            this.polygonEntities.forEach(entity => this.safeRemoveEntity(entity));
            this.polygonEntities = [];
            this.safeRemoveEntity(this.currentPolygon);
            this.currentPolygon = null;
            this.safeRemoveEntity(this.floatingPoint);
            this.floatingPoint = null;
        }

        this.restoreCameraControls();
        this.restoreSelectionIndicator();
        this.destroyHandler();
        this.updateDrawingState(true, false, false);
    },

    // 画多边形点击事件处理
    onDrawingClick(event) {
        if (!this.isDrawingMode) return;

        const ray = window.cesiumViewer.camera.getPickRay(event.position);
        const earthPosition = window.cesiumViewer.scene.globe.pick(ray, window.cesiumViewer.scene);
        if (!Cesium.defined(earthPosition)) return;

        // 如果是第一个点，创建动态多边形
        if (this.polygonPoints.length === 0) {
            const dynamicPositions = new Cesium.CallbackProperty(() => {
                const positions = [...this.polygonPoints];
                if (this.floatingPointPosition) {
                    positions.push(this.floatingPointPosition);
                }
                return new Cesium.PolygonHierarchy(positions);
            }, false);

            this.currentPolygon = window.cesiumViewer.entities.add({
                polygon: {
                    hierarchy: dynamicPositions,
                    ...this.getPolygonStyle()
                }
            });
        }

        this.polygonPoints.push(earthPosition);
    },

    // 鼠标移动事件处理
    onMouseMove(event) {
        if (!this.isDrawingMode || this.polygonPoints.length === 0) return;

        const ray = window.cesiumViewer.camera.getPickRay(event.endPosition);
        const newPosition = window.cesiumViewer.scene.globe.pick(ray, window.cesiumViewer.scene);

        if (Cesium.defined(newPosition)) {
            this.floatingPointPosition = newPosition;
            // 动态多边形会自动更新（通过CallbackProperty）
        }
    },

    // 右键点击：完成多边形
    onRightClick(event) {
        if (!this.isDrawingMode || this.polygonPoints.length < 3) return;

        this.finishCurrentPolygon();
        this.updateDrawingState(true, false, true);
        this.restoreCameraControls();
        this.restoreSelectionIndicator();
        this.destroyHandler();
        this.isDrawingMode = false;
    },

    // 完成当前多边形
    finishCurrentPolygon() {
        if (this.polygonPoints.length < 3) {
            this.clearCurrentDrawing();
            return;
        }

        this.floatingPointPosition = null;
        this.safeRemoveEntity(this.currentPolygon);
        this.currentPolygon = null;

        if (window.cesiumViewer) {
            const finalPolygon = window.cesiumViewer.entities.add({
                polygon: {
                    hierarchy: new Cesium.PolygonHierarchy(this.polygonPoints),
                    ...this.getPolygonStyle(2)
                }
            });
            this.polygonEntities.push(finalPolygon);
        }
    },

    // 更新绘制状态UI
    updateDrawingState(startVisible, stopVisible, clearVisible) {
        const buttons = {
            startPolygonDrawing: startVisible,
            stopPolygonDrawing: stopVisible,
            clearPolygonDrawing: clearVisible
        };
        Object.entries(buttons).forEach(([id, visible]) => {
            const btn = document.getElementById(id);
            if (btn) btn.style.display = visible ? 'inline-block' : 'none';
        });
    },

    // 获取多边形坐标（用于提交到后端）
    getPolygonCoordinates() {
        if (this.polygonPoints.length < 3) {
            return null;
        }

        const coordinates = [];
        for (const position of this.polygonPoints) {
            const cartographic = Cesium.Cartographic.fromCartesian(position);
            coordinates.push({
                lon: Cesium.Math.toDegrees(cartographic.longitude),
                lat: Cesium.Math.toDegrees(cartographic.latitude)
            });
        }

        return coordinates;
    }
};


// 多边形处理模块
const PolygonClipHandler = {
    // 处理多边形表单提交
    async handlePolygonClip(event) {
        event.preventDefault();

        const form = event.target;
        const formData = new FormData(form);

        // 获取多边形坐标
        const polygonCoordinates = window.PolygonDrawingManager.getPolygonCoordinates();

        // 检查是否选择了ASCII文件
        const asciiFile = formData.get('ascii_file');
        if (!asciiFile || asciiFile.size === 0) {
            alert('请选择ASCII文件');
            return;
        }
        // 添加多边形坐标到表单数据
        formData.append('polygon_coordinates', JSON.stringify(polygonCoordinates));

        // 显示进度
        window.uiUtils.startProcessing();
        window.uiUtils.updateProgress(0, '正在上传文件...');

        try {
            const response = await fetch('/polygon_clip', {
                method: 'POST',
                body: formData
            });

            const result = await response.json();

            window.uiUtils.stopProcessing();

            if (result.success) {
                window.uiUtils.showResult({
                    message: result.message || '多边形处理完成',
                    download_url: result.download_url
                });

                // 自动下载
                if (result.download_url) {
                    setTimeout(() => {
                        window.uiUtils.startAutoDownload(result.download_url);
                    }, 500);
                }
            } else {
                window.uiUtils.showError(result.message || '多边形处理失败');
            }
        } catch (error) {
            window.uiUtils.stopProcessing();
            window.uiUtils.showError(`处理失败: ${error.message}`);
            console.error('多边形错误:', error);
        }
    },

    // 初始化事件监听器
    init() {
        const polygonClipForm = document.getElementById('polygonClipForm');
        if (polygonClipForm) {
            polygonClipForm.addEventListener('submit', this.handlePolygonClip.bind(this));
        }
    }
};

// ASCII文件边界显示功能
/**
 * 处理ASCII文件选择，自动显示边界
 * @param {File} file - 选择的ASCII文件
 * @param {string} inputId - 输入框ID（用于区分不同的输入框）
 */
async function handleAsciiFileSelect(file, inputId) {
    if (!file || file.size === 0) {
        return;
    }

    // 验证文件格式
    if (!file.name.toLowerCase().endsWith('.asc') && !file.name.toLowerCase().endsWith('.txt')) {
        return;
    }

    // 加载cellsize并更新插值步长，同时加载完整数据用于插值
    if (window.CONFIG && window.CONFIG.loadCellsizeFromAsciiFile) {
        try {
            // 先加载完整的ASCII数据用于插值
            if (window.CONFIG.loadAsciiData) {
                await window.CONFIG.loadAsciiData(file);
            }

            // 再读取cellsize
            const cellsize = await window.CONFIG.loadCellsizeFromAsciiFile(file);
            if (cellsize) {
                showCellsizeUpdateMessage(cellsize, inputId);
            }
        } catch (error) {
            console.warn('读取ASCII文件cellsize失败:', error);
        }
    }

    try {
        // 创建FormData并上传文件
        const formData = new FormData();
        formData.append('ascii_file', file);

        // 调用API获取边界
        const response = await fetch('/get_ascii_bounds', {
            method: 'POST',
            body: formData
        });

        const result = await response.json();

        if (result.success && result.bounds) {
            // 显示边界
            if (window.mapDisplay && window.mapDisplay.displayBoundsOnMap) {
                window.mapDisplay.displayBoundsOnMap(result.bounds);
                console.log(`已显示ASCII文件边界: ${file.name}`);
            } else {
                console.warn('地图显示功能未初始化');
            }
        } else {
            console.warn('获取ASCII文件边界失败:', result.message || '未知错误');
        }
    } catch (error) {
        console.error('处理ASCII文件选择时出错:', error);
    }
}

/**
 * 初始化所有ASCII文件选择输入框的事件监听器
 */
function initializeAsciiBoundsListeners() {
    // 粗糙度计算中的ASCII文件选择
    const roughnessFileInput = document.getElementById('roughnessFile');
    if (roughnessFileInput) {
        roughnessFileInput.addEventListener('change', function (event) {
            const file = event.target.files[0];
            if (file) {
                handleAsciiFileSelect(file, 'roughnessFile');
            }
        });
    }

    // 根据坐标获取ASCII行列号中的ASCII文件选择
    const asciiFileInput = document.getElementById('asciiFile');
    if (asciiFileInput) {
        asciiFileInput.addEventListener('change', function (event) {
            const file = event.target.files[0];
            if (file) {
                handleAsciiFileSelect(file, 'asciiFile');
            }
        });
    }

    // 多边形处理中的ASCII文件选择
    const polygonAsciiFileInput = document.getElementById('polygonAsciiFile');
    if (polygonAsciiFileInput) {
        polygonAsciiFileInput.addEventListener('change', function (event) {
            const file = event.target.files[0];
            if (file) {
                handleAsciiFileSelect(file, 'polygonAsciiFile');
            }
        });
    }
}

// 初始化多边形绘制按钮事件监听器
function initPolygonDrawingButtons() {
    const buttonHandlers = {
        startPolygonDrawing: () => PolygonDrawingManager.startDrawing(),
        stopPolygonDrawing: () => PolygonDrawingManager.stopDrawing(),
        clearPolygonDrawing: () => PolygonDrawingManager.clearDrawing()
    };

    Object.entries(buttonHandlers).forEach(([id, handler]) => {
        const btn = document.getElementById(id);
        if (btn) btn.addEventListener('click', handler);
    });
}


// 统一初始化函数
function initializeAll() {
    initPolygonDrawingButtons();
    PolygonClipHandler.init();
    initializeAsciiBoundsListeners();
}


// 导出到全局作用域
window.PolygonDrawingManager = PolygonDrawingManager;
window.PolygonClipHandler = PolygonClipHandler;
window.asciiBounds = {
    handleAsciiFileSelect,
    initializeAsciiBoundsListeners
};

// 全局函数
window.startPolygonDrawing = () => PolygonDrawingManager.startDrawing();
window.stopPolygonDrawing = () => PolygonDrawingManager.stopDrawing();
window.clearPolygonDrawing = () => PolygonDrawingManager.clearDrawing();


// 自动初始化
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeAll);
} else {
    initializeAll();
}

