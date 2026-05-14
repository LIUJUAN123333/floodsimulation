// 瓦片计算相关功能

// 开始瓦片计算模式
function startLineCalculation() {
    window.config.isLineCalculationMode = true;
    window.config.selectedPoints = [];
    window.config.lineCalculationEntities = [];
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
    window.config.isLineCalculationMode = false;
    window.config.selectedPoints = [];
    // 清除地图上的实体
    if (window.cesiumViewer) {
        window.config.lineCalculationEntities.forEach(entity => {
            window.cesiumViewer.entities.remove(entity);
        });
        window.config.lineCalculationEntities = [];
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
    if (!window.config.isLineCalculationMode) return;

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
    window.config.selectedPoints.push({
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
            color: window.config.selectedPoints.length === 1 ? Cesium.Color.YELLOW : Cesium.Color.RED,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
        }
    });

    window.config.lineCalculationEntities.push(pointEntity);

    // 更新状态
    updateCalculationStatus(`已选择第${window.config.selectedPoints.length}个点`, window.config.selectedPoints.length);

    // 如果选择了两个点，计算瓦片
    if (window.config.selectedPoints.length === 2) {
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
            window.uiUtils.showError('无法获取当前地图的地理范围');
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
                x: window.config.selectedPoints[0].screenX,
                y: window.config.selectedPoints[0].screenY
            },
            point2: {
                x: window.config.selectedPoints[1].screenX,
                y: window.config.selectedPoints[1].screenY
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
            drawLineOnMap(window.config.selectedPoints[0], window.config.selectedPoints[1]);
        } else {
            window.uiUtils.showError(result.message || '瓦片计算失败');
        }

    } catch (error) {
        console.error('瓦片计算错误:', error);
        window.uiUtils.showError('网络错误，请检查连接后重试');
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

    window.config.lineCalculationEntities.push(lineEntity);
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

// 导出到全局作用域
window.tileCalculation = {
    startLineCalculation,
    clearLineCalculation,
    exportTilesResult
};

