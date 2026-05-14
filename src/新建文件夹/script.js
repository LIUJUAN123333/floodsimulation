// 全局变量
let isProcessing = false;
let currentTaskId = null;
// 瓦片计算相关变量
let isLineCalculationMode = false;
let selectedPoints = [];
let lineCalculationEntities = [];
// DOM加载完成后初始化
document.addEventListener('DOMContentLoaded', function () {
    initializeEventListeners();
});

// 初始化事件监听器
function initializeEventListeners() {
    // 格式转换表单
    const convertForm = document.getElementById('convertForm');
    if (convertForm) {
        convertForm.addEventListener('submit', handleConvert);
    }
    // 粗糙度计算表单
    const roughnessForm = document.getElementById('roughnessForm');
    if (roughnessForm) {
        roughnessForm.addEventListener('submit', handleRoughness);
    }
    // 瓦片计算相关事件
    const startLineCalculationBtn = document.getElementById('startLineCalculation');
    const clearLineCalculationBtn = document.getElementById('clearLineCalculation');
    const exportTilesResultBtn = document.getElementById('exportTilesResult');
    if (startLineCalculationBtn) {
        startLineCalculationBtn.addEventListener('click', startLineCalculation);
    }
    if (clearLineCalculationBtn) {
        clearLineCalculationBtn.addEventListener('click', clearLineCalculation);
    }
    if (exportTilesResultBtn) {
        exportTilesResultBtn.addEventListener('click', exportTilesResult);
    }
}
// 全局变量：存储边界框实体
let boundsEntities = [];
// 全局变量：存储高程采样点实体
let elevationSampleEntities = [];
// 全局变量：存储当前粗糙度文件名
let currentRoughnessFile = null;
// 全局变量：存储红色边框的边界信息
let roughnessBounds = null;

// 处理格式转换
async function handleConvert(event) {
    event.preventDefault();

    if (isProcessing) {
        return;
    }
    const formData = new FormData(event.target);
    const file = formData.get('file');
    // 获取是否显示边框的选项
    const showBoundsCheckbox = document.getElementById('showBoundsCheckbox');
    const showBounds = showBoundsCheckbox && showBoundsCheckbox.checked;

    if (showBounds) {
        formData.append('show_bounds', 'true');
    }

    if (!file || file.size === 0) {
        showError('请选择一个TIFF文件');
        return;
    }
    if (!file.name.toLowerCase().endsWith('.tif') && !file.name.toLowerCase().endsWith('.tiff')) {
        showError('请选择TIFF格式的文件');
        return;
    }
    startProcessing();
    try {
        const response = await fetch('/convert', {
            method: 'POST',
            body: formData
        });
        const result = await response.json();
        if (result.success) {
            // 如果返回了边界框信息，在地球上显示红色边框
            if (result.bounds && showBounds) {
                displayBoundsOnMap(result.bounds);
            }
            showResult({
                message: result.message,
                download_url: result.download_url
            });
            stopProcessing();
        } else {
            showError(result.message || '转换失败');
            stopProcessing();
        }
    } catch (error) {
        console.error('转换错误:', error);
        showError('网络错误，请检查连接后重试');
        stopProcessing();
    }
}

// 在地球上显示边界框（红色边框）
function displayBoundsOnMap(bounds) {
    if (!bounds) {
        console.warn('边界框数据无效');
        return;
    }

    // 清除之前的边界框
    clearBoundsOnMap();

    // 确保viewer存在
    if (!window.cesiumViewer) {
        console.error('Cesium viewer未初始化');
        return;
    }

    const viewer = window.cesiumViewer;

    try {
        // 优先使用所有边界点，如果没有则使用四个角点
        let coordinates = bounds.boundary_points || bounds.coordinates;

        if (!coordinates || coordinates.length === 0) {
            console.warn('边界坐标数据无效');
            return;
        }

        // 将经纬度坐标转换为Cesium的Cartesian3数组
        const positions = coordinates.map(coord => {
            return Cesium.Cartesian3.fromDegrees(coord[0], coord[1]);
        });

        // 确保边界闭合（如果使用边界点，需要添加第一个点作为最后一个点）
        if (bounds.boundary_points && positions.length > 0) {
            // 边界点已经按顺序排列（下边界->右边界->上边界->左边界）
            // 检查是否需要闭合（第一个点和最后一个点是否相同）
            const firstPos = positions[0];
            const lastPos = positions[positions.length - 1];
            const distance = Cesium.Cartesian3.distance(firstPos, lastPos);
            // 如果距离大于1米，说明边界未闭合，需要添加第一个点
            if (distance > 1.0) {
                positions.push(Cesium.Cartesian3.clone(firstPos));
            }
        }

        // 创建红色边框多边形（贴地显示）
        const polygonEntity = viewer.entities.add({
            name: 'ASCII文件边界框',
            polygon: {
                hierarchy: positions,
                material: Cesium.Color.RED.withAlpha(0.0), // 透明填充
                outline: true,
                outlineColor: Cesium.Color.RED, // 红色边框
                outlineWidth: 3.0,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND // 贴地显示
            }
        });

        boundsEntities.push(polygonEntity);

        // 创建红色边框线（更明显的边框效果）
        const polylineEntity = viewer.entities.add({
            name: 'ASCII文件边界框线',
            polyline: {
                positions: positions,
                width: 3.0,
                material: Cesium.Color.RED,
                clampToGround: true,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
            }
        });

        boundsEntities.push(polylineEntity);

        // 不显示边界点标记，只显示红色边界线
        console.log(`边界框已显示在地球上，使用了${coordinates.length}个边界点，仅显示红色边界线`);
    } catch (error) {
        console.error('显示边界框时出错:', error);
    }
}

// 清除边界框
function clearBoundsOnMap() {
    if (!window.cesiumViewer) {
        return;
    }

    const viewer = window.cesiumViewer;
    boundsEntities.forEach(entity => {
        viewer.entities.remove(entity);
    });
    boundsEntities = [];
    // 清除红色边框的边界信息
    roughnessBounds = null;
    // 清除边界内点
    clearInteriorPoints();
}

// 在地球上显示高程采样点)
function displayElevationSamples(sampleInfo) {
    if (!sampleInfo || !sampleInfo.sample_points || sampleInfo.sample_points.length === 0) {
        console.warn('高程采样数据无效');
        return;
    }

    // 清除之前的高程采样点
    clearElevationSamples();

    // 确保viewer存在
    if (!window.cesiumViewer) {
        console.error('Cesium viewer未初始化');
        return;
    }

    const viewer = window.cesiumViewer;

    try {
        const samplePoints = sampleInfo.sample_points;
        const targetHeight = sampleInfo.target_height || 4000.0;

        // 批量添加采样点(限制数量以避免性能问题)
        const maxPoints = 1000; // 最多显示1000个点
        const pointsToShow = samplePoints.slice(0, maxPoints);

        pointsToShow.forEach((point, index) => {
            // 创建采样点实体，高度设置为4000m
            const pointEntity = viewer.entities.add({
                name: `高程采样点_${index + 1}`,
                position: Cesium.Cartesian3.fromDegrees(
                    point.longitude,
                    point.latitude,
                    point.height // 使用采样高度()
                ),
                point: {
                    pixelSize: 5,
                    color: Cesium.Color.CYAN,
                    outlineColor: Cesium.Color.BLUE,
                    outlineWidth: 1,
                    heightReference: Cesium.HeightReference.NONE // 使用绝对高度
                }
            });

            elevationSampleEntities.push(pointEntity);
        });

        console.log(`已显示${pointsToShow.length}个高程采样点(高度${targetHeight}m)`);

        // 如果采样点太多，提示用户
        if (samplePoints.length > maxPoints) {
            console.warn(`采样点过多(${samplePoints.length}个)，仅显示前${maxPoints}个点`);
        }
    } catch (error) {
        console.error('显示高程采样点时出错:', error);
    }
}

// 清除高程采样点
function clearElevationSamples() {
    if (!window.cesiumViewer) {
        return;
    }

    const viewer = window.cesiumViewer;
    elevationSampleEntities.forEach(entity => {
        viewer.entities.remove(entity);
    });
    elevationSampleEntities = [];
}

// 存储边界点的实体
let interiorPointEntities = [];

// 在地球上显示边界点（高程3500米，只显示边界，不显示内部点）
function displayInteriorPoints(interiorInfo) {
    if (!interiorInfo || !interiorInfo.sample_points || interiorInfo.sample_points.length === 0) {
        console.warn('边界点数据无效');
        return;
    }

    // 清除之前的边界点
    clearInteriorPoints();

    // 确保viewer存在
    if (!window.cesiumViewer) {
        console.error('Cesium viewer未初始化');
        return;
    }

    const viewer = window.cesiumViewer;

    try {
        const samplePoints = interiorInfo.sample_points;
        const targetHeight = interiorInfo.target_height || 3500.0;

        // 批量添加点（限制数量以避免性能问题）
        const maxPoints = 50000; // 最多显示50000个点
        const pointsToShow = samplePoints.slice(0, maxPoints);

        pointsToShow.forEach((point, index) => {
            // 创建点实体，高度设置为3500m
            const pointEntity = viewer.entities.add({
                name: `边界点_${index + 1}`,
                position: Cesium.Cartesian3.fromDegrees(
                    point.longitude,
                    point.latitude,
                    point.height // 使用采样高度(3500m)
                ),
                point: {
                    pixelSize: 4,
                    color: Cesium.Color.YELLOW,
                    outlineColor: Cesium.Color.ORANGE,
                    outlineWidth: 1,
                    heightReference: Cesium.HeightReference.NONE // 使用绝对高度
                }
            });

            interiorPointEntities.push(pointEntity);
        });

        console.log(`已显示${pointsToShow.length}个边界点(高度${targetHeight}m)`);

        // 如果点太多，提示用户
        if (samplePoints.length > maxPoints) {
            console.warn(`边界点过多(${samplePoints.length}个)，仅显示前${maxPoints}个点`);
        }
    } catch (error) {
        console.error('显示边界点时出错:', error);
    }
}

// 清除边界点
function clearInteriorPoints() {
    if (!window.cesiumViewer) {
        return;
    }

    const viewer = window.cesiumViewer;
    interiorPointEntities.forEach(entity => {
        viewer.entities.remove(entity);
    });
    interiorPointEntities = [];
}
// 处理粗糙度计算
async function handleRoughness(event) {
    event.preventDefault();

    if (isProcessing) {
        return;
    }
    const formData = new FormData(event.target);
    const file = formData.get('file');
    // 获取是否显示边框的选项
    const showBoundsCheckbox = document.getElementById('showRoughnessBoundsCheckbox');
    const showBounds = showBoundsCheckbox && showBoundsCheckbox.checked;

    if (showBounds) {
        formData.append('show_bounds', 'true');
    }


    if (!file || file.size === 0) {
        showError('请选择一个ASC或TXT文件');
        return;
    }

    if (!file.name.toLowerCase().endsWith('.asc') && !file.name.toLowerCase().endsWith('.txt')) {
        showError('请选择ASC或TXT格式的文件');
        return;
    }
    startProcessing();
    try {
        const response = await fetch('/roughness', {
            method: 'POST',
            body: formData
        });

        const result = await response.json();

        if (result.success) {
            // 保存粗糙度文件名
            if (result.roughness_file) {
                currentRoughnessFile = result.roughness_file;
            }

            // 如果返回了边界框信息，在地形上显示红色边框（贴地显示）
            if (result.bounds && showBounds) {
                displayBoundsOnMap(result.bounds);
                // 保存红色边框的边界信息
                roughnessBounds = result.bounds;
            }

            // 如果返回了边界点信息，显示这些点（高程3500米，只显示边界，不显示内部点）
            if (result.interior_points && showBounds) {
                displayInteriorPoints(result.interior_points);
            }

            showResult({
                message: result.message,
                download_url: result.download_url
            });
            stopProcessing();
        } else {
            showError(result.message || '计算失败');
            stopProcessing();
        }
    } catch (error) {
        console.error('计算错误:', error);
        showError('网络错误，请检查连接后重试');
        stopProcessing();
    }
}


// 更新进度
function updateProgress(progress, message) {
    const progressBar = document.querySelector('.progress-bar');
    if (progressBar) {
        progressBar.style.width = `${progress}%`;
    }

    const progressContainer = document.getElementById('progressContainer');
    if (progressContainer) {
        const messageElement = progressContainer.querySelector('p');
        if (messageElement) {
            messageElement.textContent = message || '正在计算...';
        }
    }
}
// 开始处理
function startProcessing() {
    isProcessing = true;
    hideAllContainers();
    showProgress();

    // 禁用所有表单
    const forms = document.querySelectorAll('form');
    forms.forEach(form => {
        const inputs = form.querySelectorAll('input, select, button');
        inputs.forEach(input => input.disabled = true);
    });
}
// 停止处理
function stopProcessing() {
    isProcessing = false;
    hideProgress();

    // 启用所有表单
    const forms = document.querySelectorAll('form');
    forms.forEach(form => {
        const inputs = form.querySelectorAll('input, select, button');
        inputs.forEach(input => input.disabled = false);
    });
}
// 显示进度条
function showProgress() {
    const container = document.getElementById('progressContainer');
    if (container) {
        container.classList.remove('d-none');
    }
}
// 隐藏进度条
function hideProgress() {
    const container = document.getElementById('progressContainer');
    if (container) {
        container.classList.add('d-none');
    }
}
// 显示结果
function showResult(result) {
    hideAllContainers();
    const container = document.getElementById('resultContainer');
    const messageDiv = document.getElementById('resultMessage');
    const downloadDiv = document.getElementById('downloadSection');
    if (container && messageDiv) {
        // 显示成功消息
        messageDiv.innerHTML = `
            <div class="alert alert-success">
                <strong>${result.message}</strong>
            </div>
        `;
        // 显示下载链接
        if (result.download_url && downloadDiv) {
            downloadDiv.innerHTML = `
                <div style="margin-top: 10px;">
                    <a href="${result.download_url}" class="download-btn" download>
                        点击下载结果文件
                    </a>
                </div>
            `;
        }
        container.classList.remove('d-none');
    }
}
// 显示错误
function showError(message) {
    hideAllContainers();
    const container = document.getElementById('errorContainer');
    const messageDiv = document.getElementById('errorMessage');
    if (container && messageDiv) {
        messageDiv.innerHTML = `
            <div class="alert alert-danger">
                <strong>错误：</strong>${message}
            </div>
        `;
        container.classList.remove('d-none');
    }
}
// 隐藏所有容器
function hideAllContainers() {
    const containers = [
        'progressContainer',
        'resultContainer',
        'errorContainer'
    ];
    containers.forEach(id => {
        const container = document.getElementById(id);
        if (container) {
            container.classList.add('d-none');
        }
    });
}
// 自动下载函数
function startAutoDownload(downloadUrl) {
    const downloadStatus = document.getElementById('downloadStatus');
    const downloadProgress = document.getElementById('downloadProgress');
    const progressBar = document.querySelector('#downloadProgress .progress-bar');
    const progressText = document.getElementById('downloadProgressText');
    const downloadLink = document.getElementById('autoDownloadLink');
    // 更新状态
    if (downloadStatus) {
        downloadStatus.textContent = '正在准备下载...';
    }
    // 模拟下载进度
    let progress = 0;
    const progressInterval = setInterval(() => {
        progress += Math.random() * 20;
        if (progress > 90) progress = 90;

        if (progressBar) {
            progressBar.style.width = `${progress}%`;
        }

        if (progressText) {
            progressText.textContent = `下载中... ${Math.round(progress)}%`;
        }
    }, 200);

    // 延迟触发下载
    setTimeout(() => {
        try {
            // 清除进度模拟
            clearInterval(progressInterval);

            // 完成进度条
            if (progressBar) {
                progressBar.style.width = '100%';
            }
            if (progressText) {
                progressText.textContent = '下载完成！';
            }
            if (downloadStatus) {
                downloadStatus.textContent = '文件下载已开始，请检查浏览器下载文件夹';
            }
            // 显示下载链接作为备用
            if (downloadLink) {
                downloadLink.style.display = 'inline-block';
            }
            // 触发下载
            if (downloadLink) {
                downloadLink.click();
            }
        } catch (error) {
            console.error('自动下载失败:', error);
            if (downloadStatus) {
                downloadStatus.textContent = '自动下载失败，请手动点击下载按钮';
            }
            if (downloadLink) {
                downloadLink.style.display = 'inline-block';
            }
        }
    }, 2000); // 2秒后开始下载
}
// 开始瓦片计算模式
function startLineCalculation() {
    isLineCalculationMode = true;
    selectedPoints = [];
    lineCalculationEntities = [];
    // 更新UI状态
    document.getElementById('startLineCalculation').style.display = 'none';
    document.getElementById('clearLineCalculation').style.display = 'inline-block';
    document.getElementById('lineCalculationStatus').classList.remove('d-none');
    document.getElementById('lineCalculationResult').classList.add('d-none');
    updateCalculationStatus('准备选择第一个点', 0);
    // 添加Cesium点击事件监听器
    if (window.cesiumViewer) {
        window.cesiumViewer.cesiumWidget.screenSpaceEventHandler.setInputAction(onCesiumClick, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    }
}
// 清除瓦片计算
function clearLineCalculation() {
    isLineCalculationMode = false;
    selectedPoints = [];
    // 清除地图上的实体
    if (window.cesiumViewer) {
        lineCalculationEntities.forEach(entity => {
            window.cesiumViewer.entities.remove(entity);
        });
        lineCalculationEntities = [];
    }

    // 更新UI状态
    document.getElementById('startLineCalculation').style.display = 'inline-block';
    document.getElementById('clearLineCalculation').style.display = 'none';
    document.getElementById('lineCalculationStatus').classList.add('d-none');
    document.getElementById('lineCalculationResult').classList.add('d-none');

    // 移除Cesium点击事件监听器
    if (window.cesiumViewer) {
        window.cesiumViewer.cesiumWidget.screenSpaceEventHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_CLICK);
    }
}

// Cesium点击事件处理
function onCesiumClick(event) {
    if (!isLineCalculationMode) return;

    const position = event.position;
    if (!position) return;

    // 获取屏幕坐标
    const screenPosition = window.cesiumViewer.camera.pickEllipsoid(position, window.cesiumViewer.scene.globe.ellipsoid);
    if (!screenPosition) return;

    // 转换为地理坐标
    const cartographic = Cesium.Cartographic.fromCartesian(screenPosition);
    const longitude = Cesium.Math.toDegrees(cartographic.longitude);
    const latitude = Cesium.Math.toDegrees(cartographic.latitude);

    // 获取更精确的坐标（考虑地形）
    let preciseLongitude = longitude;
    let preciseLatitude = latitude;

    try {
        // 尝试从地形获取更精确的坐标
        const terrainPosition = window.cesiumViewer.scene.pickPosition(position);
        if (terrainPosition) {
            const terrainCartographic = Cesium.Cartographic.fromCartesian(terrainPosition);
            preciseLongitude = Cesium.Math.toDegrees(terrainCartographic.longitude);
            preciseLatitude = Cesium.Math.toDegrees(terrainCartographic.latitude);
        }
    } catch (error) {
        console.warn('无法获取地形坐标，使用椭球坐标:', error);
    }

    // 限制坐标在DEM边界范围内
    // 使用CONFIG中的DEM_BOUNDS，如果不存在则使用默认值
    const demBounds = window.CONFIG ? window.CONFIG.DEM_BOUNDS : {
        west: 98.6660671234131,
        east: 98.8336086273193,
        south: 30.9583568572998,
        north: 31.1058139801025
    };
    const originalLongitude = preciseLongitude;
    const originalLatitude = preciseLatitude;
    preciseLongitude = Math.max(demBounds.west, Math.min(preciseLongitude, demBounds.east));
    preciseLatitude = Math.max(demBounds.south, Math.min(preciseLatitude, demBounds.north));

    // 如果坐标被限制，提示用户
    if (originalLongitude !== preciseLongitude || originalLatitude !== preciseLatitude) {
        console.warn('点击位置超出DEM范围，已自动限制到边界内');
    }

    // 获取屏幕坐标
    const canvas = window.cesiumViewer.canvas;
    const rect = canvas.getBoundingClientRect();
    const screenX = position.x;
    const screenY = position.y;

    // 添加点到选择列表
    selectedPoints.push({
        screenX: screenX,
        screenY: screenY,
        longitude: preciseLongitude,
        latitude: preciseLatitude,
        originalLongitude: longitude, // 保存原始椭球坐标
        originalLatitude: latitude
    });

    // 在地图上添加点标记
    const pointEntity = window.cesiumViewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(preciseLongitude, preciseLatitude),
        point: {
            pixelSize: 10,
            color: selectedPoints.length === 1 ? Cesium.Color.YELLOW : Cesium.Color.RED,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
        }
    });

    lineCalculationEntities.push(pointEntity);

    // 更新状态
    updateCalculationStatus(`已选择第${selectedPoints.length}个点`, selectedPoints.length);

    // 如果选择了两个点，计算瓦片
    if (selectedPoints.length === 2) {
        calculateLineTiles();
    }
}

// 计算连线上经过的瓦片
async function calculateLineTiles() {
    try {
        // 获取当前地图的地理范围
        const camera = window.cesiumViewer.camera;
        const canvas = window.cesiumViewer.canvas;
        const canvasWidth = canvas.width;
        const canvasHeight = canvas.height;

        // 计算当前视图的地理范围
        const rectangle = camera.computeViewRectangle();
        if (!rectangle) {
            showError('无法获取当前地图的地理范围');
            return;
        }

        const geoBounds = {
            min_x: Cesium.Math.toDegrees(rectangle.west),
            max_x: Cesium.Math.toDegrees(rectangle.east),
            min_y: Cesium.Math.toDegrees(rectangle.south),
            max_y: Cesium.Math.toDegrees(rectangle.north),
            origin_x: 0.0,
            origin_y: 0.0
        };

        // 准备请求数据
        const requestData = {
            point1: {
                x: selectedPoints[0].screenX,
                y: selectedPoints[0].screenY
            },
            point2: {
                x: selectedPoints[1].screenX,
                y: selectedPoints[1].screenY
            },
            canvas_width: canvasWidth,
            canvas_height: canvasHeight,
            geo_bounds: geoBounds
        };

        // 发送请求
        const response = await fetch('/calculate_line_tiles', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestData)
        });

        const result = await response.json();

        if (result.success) {
            displayTilesResult(result.tiles);

            // 在地图上绘制连线
            drawLineOnMap(selectedPoints[0], selectedPoints[1]);
        } else {
            showError(result.message || '瓦片计算失败');
        }

    } catch (error) {
        console.error('瓦片计算错误:', error);
        showError('网络错误，请检查连接后重试');
    }
}

// 在地图上绘制连线
function drawLineOnMap(point1, point2) {
    const lineEntity = window.cesiumViewer.entities.add({
        polyline: {
            positions: [
                Cesium.Cartesian3.fromDegrees(point1.longitude, point1.latitude),
                Cesium.Cartesian3.fromDegrees(point2.longitude, point2.latitude)
            ],
            width: 3,
            material: Cesium.Color.CYAN,
            clampToGround: true
        }
    });

    lineCalculationEntities.push(lineEntity);
}

// 显示瓦片计算结果
function displayTilesResult(tiles) {
    const resultContainer = document.getElementById('lineCalculationResult');
    const tilesResult = document.getElementById('tilesResult');

    if (resultContainer && tilesResult) {
        // 显示结果容器
        resultContainer.classList.remove('d-none');

        // 创建结果HTML
        let html = `
            <div class="alert alert-success">
                <strong>计算完成！</strong> 连线上经过 ${tiles.length} 个瓦片
            </div>
            <div style="max-height: 300px; overflow-y: auto; border: 1px solid #ddd; padding: 10px;">
                <table style="width: 100%; border-collapse: collapse;">
                    <thead>
                        <tr style="background: #f5f5f5;">
                            <th style="border: 1px solid #ddd; padding: 8px;">序号</th>
                            <th style="border: 1px solid #ddd; padding: 8px;">行号</th>
                            <th style="border: 1px solid #ddd; padding: 8px;">列号</th>
                            <th style="border: 1px solid #ddd; padding: 8px;">瓦片ID</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        tiles.forEach((tile, index) => {
            html += `
                <tr>
                    <td style="border: 1px solid #ddd; padding: 8px;">${index + 1}</td>
                    <td style="border: 1px solid #ddd; padding: 8px;">${tile.row}</td>
                    <td style="border: 1px solid #ddd; padding: 8px;">${tile.col}</td>
                    <td style="border: 1px solid #ddd; padding: 8px;">${tile.tile_id}</td>
                </tr>
            `;
        });

        html += `
                    </tbody>
                </table>
            </div>
        `;

        tilesResult.innerHTML = html;

        // 隐藏状态容器
        document.getElementById('lineCalculationStatus').classList.add('d-none');
    }
}

// 更新计算状态
function updateCalculationStatus(status, pointCount) {
    const statusElement = document.getElementById('calculationStatus');
    const countElement = document.getElementById('selectedPointsCount');

    if (statusElement) {
        statusElement.textContent = status;
    }
    if (countElement) {
        countElement.textContent = pointCount;
    }
}

// 导出瓦片结果
function exportTilesResult() {
    const tilesResult = document.getElementById('tilesResult');
    if (!tilesResult) return;

    // 获取表格数据
    const table = tilesResult.querySelector('table');
    if (!table) return;
    // 创建CSV内容
    let csvContent = 'xu,hang,lie,wID\n';
    const rows = table.querySelectorAll('tbody tr');
    rows.forEach(row => {
        const cells = row.querySelectorAll('td');
        if (cells.length >= 4) {
            csvContent += `${cells[0].textContent},${cells[1].textContent},${cells[2].textContent},${cells[3].textContent}\n`;
        }
    });

    // 创建下载链接
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `瓦片行列号_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}


// 清除所有边框和采样点
function clearAllBounds() {
    clearBoundsOnMap();
    clearElevationSamples();
    console.log('已清除所有边框和采样点');
}





// 导出到全局作用域
window.clearAllBounds = clearAllBounds;

// 导出函数供全局使用
window.terrainProcessor = {
    showError,
    showResult,
    startAutoDownload,
    startLineCalculation,
    clearLineCalculation,
    exportTilesResult,
    displayBoundsOnMap,
    clearBoundsOnMap,
    displayElevationSamples,
    clearElevationSamples,
    clearAllBounds
};