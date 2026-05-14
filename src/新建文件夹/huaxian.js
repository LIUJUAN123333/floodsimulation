// 全局ASCII数据存储
let currentAsciiData = null;

//配置
const CONFIG = {
    DEM_BOUNDS: {
        west: 98.6660671234131,
        east: 98.8336086273193,
        south: 30.9583568572998,
        north: 31.1058139801025
    },
    // 更新DEM边界的方法
    updateDEMBounds(bounds) {
        if (bounds && bounds.min_lon !== undefined && bounds.max_lon !== undefined &&
            bounds.min_lat !== undefined && bounds.max_lat !== undefined) {
            this.DEM_BOUNDS.west = bounds.min_lon;
            this.DEM_BOUNDS.east = bounds.max_lon;
            this.DEM_BOUNDS.south = bounds.min_lat;
            this.DEM_BOUNDS.north = bounds.max_lat;
            console.log('DEM边界已更新:', this.DEM_BOUNDS);
            return true;
        }
        return false;
    },
    DEM_RESOLUTION: 0.0001,
    POINT_STYLE: {
        pixelSize: 8,
        color: Cesium.Color.YELLOW,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2
    },
    LINE_STYLE: {
        width: 3,
        material: Cesium.Color.CYAN
    },
    LABEL_STYLE: {
        font: '10pt sans-serif',
        pixelOffset: new Cesium.Cartesian2(0, -30),
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 1,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE
    },
    INTERPOLATION_STEP_DISTANCE: 10,
    COORDINATE_STEP_SIZE: 0.0001,
    FILE_COUNTER: 0,
    // 从ASCII文件加载cellsize并更新插值步长
    loadCellsizeFromAsciiFile: async function (file) {
        try {
            const text = await file.text();
            const lines = text.split('\n');

            // 查找cellsize行
            for (let line of lines) {
                line = line.trim();
                if (line.toLowerCase().startsWith('cellsize')) {
                    const parts = line.split(/\s+/);
                    if (parts.length >= 2) {
                        const cellsize = parseFloat(parts[1]);
                        if (!isNaN(cellsize) && cellsize > 0) {
                            this.INTERPOLATION_STEP_DISTANCE = cellsize;
                            console.log(`插值步长已从ASCII文件更新为: ${cellsize} 米`);
                            return cellsize;
                        }
                    }
                }
            }

            console.warn('在ASCII文件中未找到有效的cellsize值');
            return null;
        } catch (error) {
            console.error('读取ASCII文件cellsize失败:', error);
            return null;
        }
    },
    // 加载完整的ASCII数据用于插值计算
    loadAsciiData: async function (file) {
        try {
            const text = await file.text();
            const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);

            let header = {};
            let dataStartIndex = 0;

            // 解析header信息
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const parts = line.split(/\s+/);
                if (parts.length >= 2) {
                    const key = parts[0].toLowerCase();
                    const value = parseFloat(parts[1]);

                    if (['ncols', 'nrows', 'xllcorner', 'yllcorner', 'cellsize', 'nodata_value'].includes(key)) {
                        header[key] = value;
                        dataStartIndex = i + 1;
                    }
                }
            }

            // 检查必要的header信息
            const requiredFields = ['ncols', 'nrows', 'xllcorner', 'yllcorner', 'cellsize'];
            for (const field of requiredFields) {
                if (!(field in header)) {
                    throw new Error(`ASCII文件缺少必要的header字段: ${field}`);
                }
            }

            // 如果没有nodata_value，设置为默认值
            if (!('nodata_value' in header)) {
                header.nodata_value = -9999;
            }

            // 解析数据
            const data = [];
            for (let i = dataStartIndex; i < lines.length; i++) {
                const values = lines[i].split(/\s+/).map(v => parseFloat(v)).filter(v => !isNaN(v));
                data.push(...values);
            }

            // 验证数据长度
            const expectedLength = header.ncols * header.nrows;
            if (data.length !== expectedLength) {
                throw new Error(`数据长度不匹配，期望 ${expectedLength}，实际 ${data.length}`);
            }

            // 存储ASCII数据
            currentAsciiData = {
                ncols: Math.floor(header.ncols),
                nrows: Math.floor(header.nrows),
                xllcorner: header.xllcorner,
                yllcorner: header.yllcorner,
                cellsize: header.cellsize,
                nodata: header.nodata_value,
                data: data
            };

            console.log(`ASCII数据加载完成: ${currentAsciiData.ncols}x${currentAsciiData.nrows} 网格`);
            return currentAsciiData;
        } catch (error) {
            console.error('加载ASCII数据失败:', error);
            currentAsciiData = null;
            throw error;
        }
    },
    // 获取当前ASCII数据的插值函数
    getInterpolatedValue: function (longitude, latitude) {
        if (!currentAsciiData) {
            console.warn('没有加载ASCII数据，无法进行插值计算');
            return null;
        }

        return CoordinateUtils.bilinearInterpolation(currentAsciiData, longitude, latitude);
    },
    // 清除ASCII数据
    clearAsciiData: function () {
        currentAsciiData = null;
        console.log('ASCII数据已清除');
    }
};
// 画图管理模块
const DrawingManager = {
    // 状态变量
    isDrawingMode: false,
    drawingPoints: [],
    drawingEntities: [],
    currentDrawingLine: null,
    selectedCoordinates: [],
    // 初始化
    init() {
        this.isDrawingMode = false;
        this.drawingPoints = [];
        this.drawingEntities = [];
        this.currentDrawingLine = null;
        this.selectedCoordinates = [];
    },
    // 开始画线模式
    startDrawing() {
        this.isDrawingMode = true;
        this.drawingPoints = [];
        this.drawingEntities = [];
        this.currentDrawingLine = null;
        UIManager.updateDrawingState(false, true, true);
        if (window.cesiumViewer) {
            const handler = window.cesiumViewer.cesiumWidget.screenSpaceEventHandler;
            handler.setInputAction((event) => this.onDrawingClick(event), Cesium.ScreenSpaceEventType.LEFT_CLICK);
            handler.setInputAction((event) => this.onDrawingRightClick(event), Cesium.ScreenSpaceEventType.RIGHT_CLICK);
        }
    },
    // 停止画线模式
    stopDrawing() {
        this.isDrawingMode = false;
        if (this.currentDrawingLine && this.drawingPoints.length > 1) {
            this.finishCurrentLine();
        }
        UIManager.updateDrawingState(true, false, true);
        if (window.cesiumViewer) {
            const handler = window.cesiumViewer.cesiumWidget.screenSpaceEventHandler;
            handler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_CLICK);
            handler.removeInputAction(Cesium.ScreenSpaceEventType.RIGHT_CLICK);
        }
    },
    // 清除所有画线
    clearDrawing() {
        this.isDrawingMode = false;
        this.drawingPoints = [];
        this.selectedCoordinates = [];
        ElevationDataManager.clearData();
        if (window.cesiumViewer) {
            this.drawingEntities.forEach(entity => window.cesiumViewer.entities.remove(entity));
            this.drawingEntities = [];

            if (this.currentDrawingLine) {
                window.cesiumViewer.entities.remove(this.currentDrawingLine);
                this.currentDrawingLine = null;
            }
            const handler = window.cesiumViewer.cesiumWidget.screenSpaceEventHandler;
            handler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_CLICK);
            handler.removeInputAction(Cesium.ScreenSpaceEventType.RIGHT_CLICK);
        }
        UIManager.updateDrawingState(true, false, false);
        UIManager.updateCoordinatesDisplay();
    },
    // 画线点击事件处理
    onDrawingClick(event) {
        if (!this.isDrawingMode) return;
        const coordinates = CoordinateUtils.getPreciseCoordinates(event.position);
        if (!coordinates) return;
        const pointData = {
            longitude: coordinates.longitude,
            latitude: coordinates.latitude,
            screenX: event.position.x,
            screenY: event.position.y,
            id: this.drawingPoints.length + 1
        };
        if (coordinates.height !== undefined && coordinates.height !== null) {
            pointData.height = coordinates.height;
        }
        if (coordinates.cartesian) {
            pointData.cartesian = coordinates.cartesian;
        }
        this.drawingPoints.push(pointData);
        const demRowCol = CoordinateUtils.getDEMRowColumn(coordinates.longitude, coordinates.latitude);
        this.selectedCoordinates.push({
            ...pointData,
            timestamp: new Date().toLocaleString(),
            demRow: demRowCol.row,
            demCol: demRowCol.col
        });
        this.addPointEntity(pointData);
        this.updateCurrentLine();
        UIManager.updateCoordinatesDisplay();
        ElevationDataManager.getSinglePointElevation(this.selectedCoordinates[this.selectedCoordinates.length - 1]);
    },
    // 画线右键点击事件处理
    onDrawingRightClick() {
        if (!this.isDrawingMode) return;
        // 右键结束当前线条
        if (this.drawingPoints.length > 1) {
            this.finishCurrentLine();
        }
    },
    // 添加点实体
    addPointEntity(pointData) {
        const hasHeight = pointData.height !== undefined && pointData.height !== null;
        const position = pointData.cartesian
            ? pointData.cartesian
            : (hasHeight
                ? Cesium.Cartesian3.fromDegrees(pointData.longitude, pointData.latitude, pointData.height)
                : Cesium.Cartesian3.fromDegrees(pointData.longitude, pointData.latitude));

        const pointEntity = window.cesiumViewer.entities.add({
            position: position,
            point: {
                ...CONFIG.POINT_STYLE,
                heightReference: hasHeight ? Cesium.HeightReference.NONE : Cesium.HeightReference.CLAMP_TO_GROUND
            },
            label: {
                text: `${pointData.id}`,
                ...CONFIG.LABEL_STYLE,
                heightReference: hasHeight ? Cesium.HeightReference.NONE : Cesium.HeightReference.CLAMP_TO_GROUND,
                position: position // Ensure label also uses the explicit position
            }
        });
        this.drawingEntities.push(pointEntity);
    },
    // 更新当前线条
    updateCurrentLine() {
        if (this.drawingPoints.length < 2) return;
        // 移除之前的线条
        if (this.currentDrawingLine) {
            window.cesiumViewer.entities.remove(this.currentDrawingLine);
        }
        // 创建新的线条
        const hasHeight = this.drawingPoints.some(point => point.height !== undefined && point.height !== null);
        const positions = this.drawingPoints.map(point => {
            if (point.cartesian) return point.cartesian;
            if (point.height !== undefined && point.height !== null) {
                return Cesium.Cartesian3.fromDegrees(point.longitude, point.latitude, point.height);
            }
            return Cesium.Cartesian3.fromDegrees(point.longitude, point.latitude);
        });
        this.currentDrawingLine = window.cesiumViewer.entities.add({
            polyline: {
                positions: positions,
                ...CONFIG.LINE_STYLE,
                clampToGround: !hasHeight,
                show: true
            }
        });
    },
    // 完成当前线条
    finishCurrentLine() {
        if (this.currentDrawingLine) {
            this.drawingEntities.push(this.currentDrawingLine);
            this.currentDrawingLine = null;
        }
        this.drawingPoints = [];
    },
    // 重新绘制所有实体
    redrawAllEntities() {
        if (!window.cesiumViewer) return;
        this.drawingEntities.forEach(entity => window.cesiumViewer.entities.remove(entity));
        this.drawingEntities = [];
        this.selectedCoordinates.forEach((coord, index) => {
            const hasHeight = coord.height !== undefined && coord.height !== null;
            const position = coord.cartesian
                ? coord.cartesian
                : (hasHeight
                    ? Cesium.Cartesian3.fromDegrees(coord.longitude, coord.latitude, coord.height)
                    : Cesium.Cartesian3.fromDegrees(coord.longitude, coord.latitude));
            const pointEntity = window.cesiumViewer.entities.add({
                position: position,
                point: {
                    ...CONFIG.POINT_STYLE,
                    heightReference: hasHeight ? Cesium.HeightReference.NONE : Cesium.HeightReference.CLAMP_TO_GROUND
                },
                label: {
                    text: `${index + 1}`,
                    ...CONFIG.LABEL_STYLE,
                    heightReference: hasHeight ? Cesium.HeightReference.NONE : Cesium.HeightReference.CLAMP_TO_GROUND,
                    position: position
                }
            });
            this.drawingEntities.push(pointEntity);
        });
        if (this.selectedCoordinates.length > 1) {
            const positions = this.selectedCoordinates.map(coord =>
                Cesium.Cartesian3.fromDegrees(coord.longitude, coord.latitude)
            );
            const lineEntity = window.cesiumViewer.entities.add({
                polyline: {
                    positions: positions,
                    ...CONFIG.LINE_STYLE,
                    clampToGround: true,
                    show: true
                }
            });
            this.drawingEntities.push(lineEntity);
        }
    },
    // 删除指定坐标点
    removeCoordinate(coordId) {
        const index = this.selectedCoordinates.findIndex(coord => coord.id === coordId);
        if (index !== -1) {
            this.selectedCoordinates.splice(index, 1);
            this.redrawAllEntities();
            UIManager.updateCoordinatesDisplay();
        }
    },
    // 加载TXT点数据
    loadFromTxt(text) {
        this.clearDrawing();
        const lines = text.split('\n');
        let pointId = 1;
        lines.forEach(line => {
            line = line.trim();
            if(!line) return;
            const nums = line.split(/[,\s]+/).map(p => parseFloat(p)).filter(n => !isNaN(n));
            if (nums.length >= 2) {
                let lon = nums[0];
                let lat = nums[1];
                // Simple heuristic if order is swapped (lat < 90, lon > 90 for this region)
                if (lat > 60 && lon < 60) { // China region logic
                     [lon, lat] = [lat, lon];
                }

                const pointData = {
                    longitude: lon,
                    latitude: lat,
                    id: pointId++
                };
                this.drawingPoints.push(pointData);
                 const demRowCol = CoordinateUtils.getDEMRowColumn(lon, lat);
                this.selectedCoordinates.push({
                    ...pointData,
                    timestamp: new Date().toLocaleString(),
                    demRow: demRowCol.row,
                    demCol: demRowCol.col
                });
                this.addPointEntity(pointData);
            }
        });
        if(this.drawingPoints.length > 1) {
             this.updateCurrentLine();
             this.finishCurrentLine();
        }
        UIManager.updateCoordinatesDisplay();
        // Automatically fetch elevation data for loaded points
        ElevationDataManager.getElevationData();
    }
};
// 坐标转换模块
const CoordinateUtils = {
    // 获取精确坐标
    getPreciseCoordinates(position) {
        // 优先使用地形拾取获取精确坐标 (Depth Buffer)
        const scene = window.cesiumViewer.scene;
        // 检查 depthTestAgainstTerrain 状态
        // 拾取坐标
        const cartesian = scene.pickPosition(position);

        if (Cesium.defined(cartesian)) {
            const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
            const longitude = Cesium.Math.toDegrees(cartographic.longitude);
            const latitude = Cesium.Math.toDegrees(cartographic.latitude);
            const height = cartographic.height;
            return { longitude, latitude, height, cartesian };
        }

        // 如果地形拾取失败，回退到射线检测 (Raycasting)
        const ray = scene.camera.getPickRay(position);
        const rayPosition = scene.globe.pick(ray, scene);
        if (Cesium.defined(rayPosition)) {
             const cartographic = Cesium.Cartographic.fromCartesian(rayPosition);
             return {
                 longitude: Cesium.Math.toDegrees(cartographic.longitude),
                 latitude: Cesium.Math.toDegrees(cartographic.latitude),
                 height: cartographic.height,
                 cartesian: rayPosition
             };
        }

        // 最后回退到椭球体拾取
        const screenPosition = scene.camera.pickEllipsoid(position, scene.globe.ellipsoid);
        if (!screenPosition) return null;
        const cartographic = Cesium.Cartographic.fromCartesian(screenPosition);
        const longitude = Cesium.Math.toDegrees(cartographic.longitude);
        const latitude = Cesium.Math.toDegrees(cartographic.latitude);
        return { longitude, latitude, height: 0, cartesian: screenPosition };
    },
    // 检查坐标是否在DEM数据覆盖范围内
    isCoordinateInDEMBounds(longitude, latitude) {
        return longitude >= CONFIG.DEM_BOUNDS.west && longitude <= CONFIG.DEM_BOUNDS.east &&
            latitude >= CONFIG.DEM_BOUNDS.south && latitude <= CONFIG.DEM_BOUNDS.north;
    },
    // 经纬度坐标转换为瓦片行列号
    getTileCoordinates(longitude, latitude, zoom) {
        const xRatio = (longitude - CONFIG.DEM_BOUNDS.west) / (CONFIG.DEM_BOUNDS.east - CONFIG.DEM_BOUNDS.west);
        const yRatio = (latitude - CONFIG.DEM_BOUNDS.south) / (CONFIG.DEM_BOUNDS.north - CONFIG.DEM_BOUNDS.south);
        const x = Math.floor(25364 + xRatio * (25381 - 25364));
        const y = Math.floor(11008 + yRatio * (11023 - 11008));
        return { x, y, zoom };
    },
    // 指定坐标点的瓦片信息
    getTileInfo(longitude, latitude, zoom = 14) {
        const tile = this.getTileCoordinates(longitude, latitude, zoom);
        // 计算瓦片边界
        const n = Math.pow(2, zoom);
        const lon_deg_per_tile = 360 / n;
        const lat_deg_per_tile = 180 / n;
        const west = tile.x * lon_deg_per_tile - 180;
        const east = (tile.x + 1) * lon_deg_per_tile - 180;
        const north = 90 - tile.y * lat_deg_per_tile;
        const south = 90 - (tile.y + 1) * lat_deg_per_tile;
        return {
            x: tile.x,
            y: tile.y,
            zoom: zoom,
            bounds: {
                west: west,
                east: east,
                north: north,
                south: south
            },
            tilePath: `${zoom}/${tile.x}/${tile.y}.terrain`
        };
    },
    // 获取坐标点在DEM数据中的行列号
    getDEMRowColumn(longitude, latitude) {
        const xRatio = (longitude - CONFIG.DEM_BOUNDS.west) / (CONFIG.DEM_BOUNDS.east - CONFIG.DEM_BOUNDS.west);
        const yRatio = (latitude - CONFIG.DEM_BOUNDS.south) / (CONFIG.DEM_BOUNDS.north - CONFIG.DEM_BOUNDS.south);
        const demCols = Math.ceil((CONFIG.DEM_BOUNDS.east - CONFIG.DEM_BOUNDS.west) / CONFIG.DEM_RESOLUTION);
        const demRows = Math.ceil((CONFIG.DEM_BOUNDS.north - CONFIG.DEM_BOUNDS.south) / CONFIG.DEM_RESOLUTION);
        const col = Math.floor(xRatio * demCols);
        const row = Math.floor((1 - yRatio) * demRows);
        return {
            row: Math.max(0, Math.min(row, demRows - 1)),
            col: Math.max(0, Math.min(col, demCols - 1)),
            demRows: demRows,
            demCols: demCols,
            resolution: CONFIG.DEM_RESOLUTION
        };
    },
    // 计算两点间的距离（米）
    calculateDistance(point1, point2) {
        const R = 6371000;
        const lat1Rad = point1.latitude * Math.PI / 180;
        const lat2Rad = point2.latitude * Math.PI / 180;
        const deltaLat = (point2.latitude - point1.latitude) * Math.PI / 180;
        const deltaLon = (point2.longitude - point1.longitude) * Math.PI / 180;
        const a = Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
            Math.cos(lat1Rad) * Math.cos(lat2Rad) *
            Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    },
    // 在两点间生成插值点
    generateInterpolatedPoints(point1, point2, stepDistance = CONFIG.INTERPOLATION_STEP_DISTANCE) {
        // 如果未设置stepDistance且CONFIG.INTERPOLATION_STEP_DISTANCE为null，使用默认值并警告
        if (stepDistance === null || stepDistance === undefined) {
            console.warn('插值步长未设置，请先加载ASCII文件以获取cellsize值。使用默认步长10米。');
            stepDistance = 10; // 默认回退值
        }
        const distance = this.calculateDistance(point1, point2);
        const numPoints = Math.max(2, Math.ceil(distance / stepDistance));
        const interpolatedPoints = [];
        for (let i = 0; i < numPoints; i++) {
            const ratio = i / (numPoints - 1);
            let longitude = point1.longitude + (point2.longitude - point1.longitude) * ratio;
            let latitude = point1.latitude + (point2.latitude - point1.latitude) * ratio;
            // 移除硬性边界限制，允许在DEM范围外画线导出
            // longitude = Math.max(CONFIG.DEM_BOUNDS.west, Math.min(longitude, CONFIG.DEM_BOUNDS.east));
            // latitude = Math.max(CONFIG.DEM_BOUNDS.south, Math.min(latitude, CONFIG.DEM_BOUNDS.north));
            interpolatedPoints.push({
                longitude: longitude,
                latitude: latitude
            });
        }
        return interpolatedPoints;
    },
    // 计算两点之间的所有坐标点（包括中间插值点）
    calculateIntermediatePoints(startPoint, endPoint, stepSize = CONFIG.COORDINATE_STEP_SIZE) {
        const points = [];
        // 计算两点间的距离
        const deltaLon = endPoint.longitude - startPoint.longitude;
        const deltaLat = endPoint.latitude - startPoint.latitude;
        const distance = Math.sqrt(deltaLon * deltaLon + deltaLat * deltaLat);
        // 计算插值点个数
        const numSteps = Math.ceil(distance / stepSize);
        // 生成插值点
        for (let i = 0; i <= numSteps; i++) {
            const ratio = numSteps > 0 ? i / numSteps : 0;
            const lon = startPoint.longitude + deltaLon * ratio;
            const lat = startPoint.latitude + deltaLat * ratio;
            // 获取DEM行列号
            const demRowCol = this.getDEMRowColumn(lon, lat);
            points.push({
                longitude: lon,
                latitude: lat,
                demRow: demRowCol.row,
                demCol: demRowCol.col,
                stepIndex: i,
                totalSteps: numSteps,
                distanceFromStart: distance * ratio
            });
        }
        return points;
    },
    // 检查瓦片文件
    async checkTileExists(tilePath) {
        try {
            const response = await fetch(`./DEMTiles/${tilePath}`, { method: 'HEAD' });
            return response.ok;
        } catch (error) {
            return false;
        }
    },
    // 双线性插值计算不在网格节点上的点值
    bilinearInterpolation(gridData, x, y) {
        const { data, ncols, nrows, xllcorner, yllcorner, cellsize, nodata } = gridData;

        // 计算点在网格中的相对位置
        const gridX = (x - xllcorner) / cellsize;
        const gridY = (nrows - 1) - ((y - yllcorner) / cellsize); // Y轴翻转

        // 获取四个角点的坐标
        const x1 = Math.floor(gridX);
        const y1 = Math.floor(gridY);
        const x2 = x1 + 1;
        const y2 = y1 + 1;

        // 检查边界
        if (x1 < 0 || x2 >= ncols || y1 < 0 || y2 >= nrows) {
            return nodata;
        }

        // 获取四个角点的值
        const q11 = data[y1 * ncols + x1]; // 左上
        const q12 = data[y2 * ncols + x1]; // 左下
        const q21 = data[y1 * ncols + x2]; // 右上
        const q22 = data[y2 * ncols + x2]; // 右下

        // 检查是否有无效值
        if (q11 === nodata || q12 === nodata || q21 === nodata || q22 === nodata) {
            return nodata;
        }

        // 计算插值权重
        const dx = gridX - x1;
        const dy = gridY - y1;

        // 双线性插值公式
        const interpolatedValue =
            q11 * (1 - dx) * (1 - dy) +
            q21 * dx * (1 - dy) +
            q12 * (1 - dx) * dy +
            q22 * dx * dy;

        return interpolatedValue;
    },
    // 从坐标计算在ASCII网格中的行列号（考虑插值）
    getAsciiRowColWithInterpolation(longitude, latitude, asciiMetadata) {
        if (!asciiMetadata) {
            return null;
        }

        const { ncols, nrows, xllcorner, yllcorner, cellsize } = asciiMetadata;

        // 计算点在网格中的相对位置
        const gridCol = (longitude - xllcorner) / cellsize;
        const gridRow = (nrows - 1) - ((latitude - yllcorner) / cellsize); // Y轴翻转

        // 获取四个角点的行列号
        const row1 = Math.floor(gridRow);
        const col1 = Math.floor(gridCol);
        const row2 = row1 + 1;
        const col2 = col1 + 1;

        return {
            interpolatedRow: gridRow,
            interpolatedCol: gridCol,
            cornerPoints: {
                topLeft: { row: row1, col: col1 },
                topRight: { row: row1, col: col2 },
                bottomLeft: { row: row2, col: col1 },
                bottomRight: { row: row2, col: col2 }
            },
            // 检查是否在边界内
            isWithinBounds: gridCol >= 0 && gridCol < ncols && gridRow >= 0 && gridRow < nrows
        };
    }
};
//  高程数据模块
const ElevationDataManager = {
    elevationData: [],
    // 清除高程数据
    clearData() {
        this.elevationData = [];
    },
    // 获取单个点的高程数据
    async getSinglePointElevation(coord) {
        const isInBounds = CoordinateUtils.isCoordinateInDEMBounds(coord.longitude, coord.latitude);
        if (!isInBounds) {
            console.warn(`点${coord.id}超出DEM数据覆盖范围`);
        }
        const height = await window.cesiumViewer.scene.globe.getHeight(
            Cesium.Cartographic.fromDegrees(coord.longitude, coord.latitude)
        );
        const elevation = height !== undefined ? height : 0;

        const elevationInfo = {
            id: coord.id,
            longitude: coord.longitude,
            latitude: coord.latitude,
            elevation: elevation,
            timestamp: coord.timestamp
        };
        const existingIndex = this.elevationData.findIndex(e => e.id === coord.id);
        if (existingIndex !== -1) {
            this.elevationData[existingIndex] = elevationInfo;
        } else {
            this.elevationData.push(elevationInfo);
        }
        UIManager.updateCoordinatesDisplay();

    },
    // 获取画线经过的地形高程数据
    async getElevationData() {
        if (DrawingManager.selectedCoordinates.length < 2) {
            alert('请先完成画线！');
            return;
        }
        const outOfBoundsPoints = DrawingManager.selectedCoordinates.filter(coord =>
            !CoordinateUtils.isCoordinateInDEMBounds(coord.longitude, coord.latitude)
        );
        if (outOfBoundsPoints.length > 0) {
            const warningMessage = `有 ${outOfBoundsPoints.length} 个坐标点不在本地DEM数据覆盖范围内。\n\nDEM数据覆盖范围：\n经度: 98.67° - 98.83°\n纬度: 30.96° - 31.11°\n\n这些点的高程可能为0或不可靠`;
            if (!confirm(warningMessage)) return;
        }
        this.elevationData = [];
        for (const coord of DrawingManager.selectedCoordinates) {
            const height = await window.cesiumViewer.scene.globe.getHeight(
                Cesium.Cartographic.fromDegrees(coord.longitude, coord.latitude)
            );
            this.elevationData.push({
                id: coord.id,
                longitude: coord.longitude,
                latitude: coord.latitude,
                elevation: height !== undefined ? height : 0,
                timestamp: coord.timestamp
            });
        }
        UIManager.updateCoordinatesDisplay();
    },
    // 获取两点间所有地形坐标和高程
    async getLineTerrainCoordinates(point1, point2, stepDistance = CONFIG.INTERPOLATION_STEP_DISTANCE) {
        // 如果未设置stepDistance且CONFIG.INTERPOLATION_STEP_DISTANCE为null，使用默认值并警告
        if (stepDistance === null || stepDistance === undefined) {
            console.warn('插值步长未设置，请先加载ASCII文件以获取cellsize值。使用默认步长10米。');
            stepDistance = 10; // 默认回退值
        }
        try {
            const interpolatedPoints = CoordinateUtils.generateInterpolatedPoints(point1, point2, stepDistance);
            const terrainCoordinates = [];
            for (let i = 0; i < interpolatedPoints.length; i++) {
                const point = interpolatedPoints[i];
                try {
                    const height = await window.cesiumViewer.scene.globe.getHeight(
                        Cesium.Cartographic.fromDegrees(point.longitude, point.latitude)
                    );
                    const elevation = height !== undefined ? height : 0;
                    terrainCoordinates.push({
                        id: i + 1,
                        longitude: point.longitude,
                        latitude: point.latitude,
                        elevation: elevation,
                        timestamp: new Date().toLocaleString()
                    });
                } catch (error) {
                    terrainCoordinates.push({
                        id: i + 1,
                        longitude: point.longitude,
                        latitude: point.latitude,
                        elevation: 0,
                        timestamp: new Date().toLocaleString()
                    });
                }
            }
            return terrainCoordinates;
        } catch (error) {
            throw error;
        }
    }
};
//  UI管理
const UIManager = {
    // 更新绘图状态UI
    updateDrawingState(startVisible, stopVisible, clearVisible) {
        document.getElementById('startDrawing').style.display = startVisible ? 'inline-block' : 'none';
        document.getElementById('stopDrawing').style.display = stopVisible ? 'inline-block' : 'none';
        document.getElementById('clearDrawing').style.display = clearVisible ? 'inline-block' : 'none';
    },
    // 更新坐标显示
    updateCoordinatesDisplay() {
        const coordinatesContainer = document.getElementById('coordinatesList');
        if (!coordinatesContainer) return;
        if (DrawingManager.selectedCoordinates.length === 0) {
            coordinatesContainer.innerHTML = '<p class="text-muted">暂无坐标点</p>';
            return;
        }
        let html = '<h6>选择的坐标点：</h6>';
        DrawingManager.selectedCoordinates.forEach((coord) => {
            // 查找对应的高程数据
            const elevationInfo = ElevationDataManager.elevationData.find(e => e.id === coord.id);
            const isInBounds = CoordinateUtils.isCoordinateInDEMBounds(coord.longitude, coord.latitude);
            // 获取瓦片信息
            const tileInfo = CoordinateUtils.getTileInfo(coord.longitude, coord.latitude, 14);
            // 使用存储的DEM行列号信息，如果没有则重新计算
            const demRowCol = coord.demRow !== undefined && coord.demCol !== undefined ?
                { row: coord.demRow, col: coord.demCol, resolution: CONFIG.DEM_RESOLUTION } :
                CoordinateUtils.getDEMRowColumn(coord.longitude, coord.latitude);
            let elevationText = '';
            if (elevationInfo) {
                const dataSource = currentAsciiData ? 'ASCII插值' : 'Cesium地形';
                if (isInBounds) {
                    elevationText = `<br><small class="text-success">高程: ${elevationInfo.elevation.toFixed(2)}m (${dataSource})</small>`;
                } else {
                    elevationText = `<br><small class="text-warning">高程: ${elevationInfo.elevation.toFixed(2)}m 超出DEM范围 (${dataSource})</small>`;
                }
            } else if (!isInBounds) {
                elevationText = '<br><small class="text-danger">高程:超出DEM数据范围</small>';
            }
            const boundsWarning = !isInBounds ? '<br><small class="text-danger">超出DEM数据覆盖范围</small>' : '';
            // 瓦片信息显示
            const tileText = `<br><small class="text-info">瓦片: ${tileInfo.x},${tileInfo.y}</small>`;
            // DEM行列号信息显示
            const demRowColText = `<br><small class="text-warning">DEM行列号: 行${demRowCol.row}, 列${demRowCol.col}</small>`;
            const screenCoordText = coord.screenX !== undefined && coord.screenY !== undefined ?
                `<br><small class="text-secondary">屏幕坐标: (${coord.screenX.toFixed(0)}, ${coord.screenY.toFixed(0)})</small>` : '';
            html += `
                <div class="coordinate-item">
                    <div class="d-flex justify-content-between align-items-center">
                        <div>
                            <strong>点 ${coord.id}</strong>
                            <br>
                            <small class="text-primary">坐标: 经度 ${coord.longitude.toFixed(6)}°, 纬度 ${coord.latitude.toFixed(6)}°</small>
                            ${screenCoordText}
                            ${elevationText}
                            ${boundsWarning}
                            ${tileText}
                            ${demRowColText}
                            <br>
                            <small class="text-muted">时间: ${coord.timestamp}</small>
                        </div>
                        <button class="btn btn-sm btn-outline-danger" onclick="DrawingManager.removeCoordinate(${coord.id})">删除</button>
                    </div>
                </div>
            `;
        });
        coordinatesContainer.innerHTML = html;
    },
    // 显示中间坐标点的结果
    displayIntermediatePoints(points) {
        const container = document.getElementById('intermediatePointsContainer');
        container.classList.remove('d-none');
        const listContainer = document.getElementById('intermediatePointsList');
        let html = '<table class="table table-striped table-sm">';
        html += '<thead><tr><th>线段</th><th>点</th><th>lon</th><th>lat</th><th>row</th><th>col</th><th>点位</th></tr></thead><tbody>';
        points.forEach(point => {
            const pointType = point.isIntermediate ? '线上' : '端点';
            const rowClass = point.isIntermediate ? '' : 'table-primary';
            html += `<tr class="${rowClass}">
                <td>${point.segmentIndex}</td>
                <td>${point.pointIndex + 1}</td>
                <td>${point.longitude.toFixed(6)}</td>
                <td>${point.latitude.toFixed(6)}</td>
                <td>${point.demRow}</td>
                <td>${point.demCol}</td>
                <td>${pointType}</td>
            </tr>`;
        });
        html += '</tbody></table>';
        listContainer.innerHTML = html;

        // 存储到全局变量供导出使用
        window.intermediatePointsData = points;
    },

    // 初始化事件监听器
    initializeEventListeners() {
        const startDrawingBtn = document.getElementById('startDrawing');
        const stopDrawingBtn = document.getElementById('stopDrawing');
        const clearDrawingBtn = document.getElementById('clearDrawing');
        if (startDrawingBtn) startDrawingBtn.onclick = () => DrawingManager.startDrawing();
        if (stopDrawingBtn) stopDrawingBtn.onclick = () => DrawingManager.stopDrawing();
        if (clearDrawingBtn) clearDrawingBtn.onclick = () => DrawingManager.clearDrawing();
    }
};
//  数据导出模块
const DataExportManager = {

    // 下载CSV文件
    downloadCSV(csvContent, filename) {
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    },

    // 下载TXT文件
    downloadTXT(txtContent, filename) {
        const blob = new Blob([txtContent], { type: 'text/plain;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    },

    // 导出坐标信息CSV
    exportElevationData() {
        if (DrawingManager.selectedCoordinates.length === 0) {
            alert('没有导出坐标数据');
            return;
        }
        if (ElevationDataManager.elevationData.length === 0) {
            alert('没有高程数据');
            return;
        }
        let csvContent = 'ID,lon,lat,depth(m),times,X,Y,level,path,DEM_row,DEM_col\n';
        DrawingManager.selectedCoordinates.forEach(coord => {
            const tileInfo = CoordinateUtils.getTileInfo(coord.longitude, coord.latitude, 14);
            const demRowCol = coord.demRow !== undefined && coord.demCol !== undefined ?
                { row: coord.demRow, col: coord.demCol } :
                CoordinateUtils.getDEMRowColumn(coord.longitude, coord.latitude);

            const elevationInfo = ElevationDataManager.elevationData.find(e => e.id === coord.id);
            const elevation = elevationInfo ? elevationInfo.elevation.toFixed(2) : 'N/A';

            csvContent += `${coord.id},${coord.longitude},${coord.latitude},${elevation},"${coord.timestamp}",${tileInfo.x},${tileInfo.y},${tileInfo.zoom},"${tileInfo.tilePath}",${demRowCol.row},${demRowCol.col}\n`;
        });

        this.downloadCSV(csvContent, `线坐标信息_${new Date().toISOString()}.csv`);
    },

    // 导出坐标信息TXT
    exportElevationDataTXT() {
        if (DrawingManager.selectedCoordinates.length === 0) {
            alert('没有导出坐标数据');
            return;
        }
        if (ElevationDataManager.elevationData.length === 0) {
            alert('没有高程数据');
            return;
        }
        let txtContent = ' ';
        DrawingManager.selectedCoordinates.forEach(coord => {
            const tileInfo = CoordinateUtils.getTileInfo(coord.longitude, coord.latitude, 14);
            const demRowCol = coord.demRow !== undefined && coord.demCol !== undefined ?
                { row: coord.demRow, col: coord.demCol } :
                CoordinateUtils.getDEMRowColumn(coord.longitude, coord.latitude);

            const elevationInfo = ElevationDataManager.elevationData.find(e => e.id === coord.id);
            const elevation = elevationInfo ? elevationInfo.elevation.toFixed(2) : 'N/A';

            txtContent += ` pints ${coord.id}\n`;
            txtContent += `  lon:${coord.longitude}\n`;
            txtContent += `  lat:${coord.latitude}\n`;
            txtContent += `  Depth:${elevation} m\n`;
            txtContent += `  Tilecoordinates: X${tileInfo.x}, Y${tileInfo.y}\n`;
            txtContent += `  DEMRC:row${demRowCol.row},col${demRowCol.col}\n`;
            txtContent += '\n';
        });
        this.downloadTXT(txtContent, `点坐标信息${CONFIG.FILE_COUNTER}.txt`);
        CONFIG.FILE_COUNTER++;
    },

    // 导出两点间连线地形坐标CSV
    async exportLineTerrainData() {
        if (DrawingManager.selectedCoordinates.length < 2) {
            alert('请先完成画线！');
            return;
        }
        const startPoint = DrawingManager.selectedCoordinates[0];
        const endPoint = DrawingManager.selectedCoordinates[DrawingManager.selectedCoordinates.length - 1];
        const lineTerrainData = await ElevationDataManager.getLineTerrainCoordinates(startPoint, endPoint, CONFIG.INTERPOLATION_STEP_DISTANCE);
        if (lineTerrainData.length === 0) {
            alert('未获取地形坐标数据！');
            return;
        }
        let csvContent = 'ID,longitude,latitude,depth(m),time,DEM_row,DEM_col,tile_x,tile_y\n';
        lineTerrainData.forEach(point => {
            const demRowCol = CoordinateUtils.getDEMRowColumn(point.longitude, point.latitude);
            const tileInfo = CoordinateUtils.getTileInfo(point.longitude, point.latitude, 14);
            csvContent += `${point.id},${point.longitude.toFixed(6)},${point.latitude.toFixed(6)},${point.elevation.toFixed(2)},${point.timestamp},${demRowCol.row},${demRowCol.col},${tileInfo.x},${tileInfo.y}\n`;
        });
        this.downloadCSV(csvContent, `地形坐标信息${new Date().getTime()}.csv`);
    },

    // 导出点间连线地形坐标TXT
    async exportLineTerrainDataTXT() {
        if (DrawingManager.selectedCoordinates.length < 2) {
            alert('请先完成画线！');
            return;
        }
        const startPoint = DrawingManager.selectedCoordinates[0];
        const endPoint = DrawingManager.selectedCoordinates[DrawingManager.selectedCoordinates.length - 1];
        const lineTerrainData = await ElevationDataManager.getLineTerrainCoordinates(startPoint, endPoint, CONFIG.INTERPOLATION_STEP_DISTANCE);

        let txtContent = ' ';
        txtContent += `Terrain resolution: ${CONFIG.INTERPOLATION_STEP_DISTANCE}m\n`;
        txtContent += `Total points: ${lineTerrainData.length}\n`;

        lineTerrainData.forEach(point => {
            const demRowCol = CoordinateUtils.getDEMRowColumn(point.longitude, point.latitude);
            const tileInfo = CoordinateUtils.getTileInfo(point.longitude, point.latitude, 14);

            txtContent += `pint ${point.id}\n`;
            txtContent += `  lon: ${point.longitude.toFixed(6)}\n`;
            txtContent += `  lat: ${point.latitude.toFixed(6)}\n`;
            txtContent += `  Depth: ${point.elevation.toFixed(2)} m\n`;
            txtContent += `  DEMRC: row${demRowCol.row}, col${demRowCol.col}\n`;
            txtContent += `  Tile coordinates: X${tileInfo.x}, Y${tileInfo.y}\n`;
        });
        this.downloadTXT(txtContent, `连线坐标信息${CONFIG.FILE_COUNTER}.txt`);
        CONFIG.FILE_COUNTER++;
    }
};

// 主模块 
const DrawingModule = {
    // 初始化所有模块
    init() {
        DrawingManager.init();
        UIManager.initializeEventListeners();
    },
    // 计算所有选择点之间的中间坐标点
    calculateAllIntermediatePoints() {
        if (DrawingManager.selectedCoordinates.length < 2) {
            alert('至少选两点计算坐标');
            return;
        }
        const allIntermediatePoints = [];
        // 遍历相邻的点对
        for (let i = 0; i < DrawingManager.selectedCoordinates.length - 1; i++) {
            const startPoint = DrawingManager.selectedCoordinates[i];
            const endPoint = DrawingManager.selectedCoordinates[i + 1];
            // 计算中间点
            const intermediatePoints = CoordinateUtils.calculateIntermediatePoints(startPoint, endPoint);
            intermediatePoints.forEach((point, index) => {
                point.segmentIndex = i + 1; // 选线段的编号
                point.pointIndex = index; // 点编号
                point.isIntermediate = index > 0 && index < intermediatePoints.length - 1; // 是否为线上点
            });
            allIntermediatePoints.push(...intermediatePoints);
        }
        UIManager.displayIntermediatePoints(allIntermediatePoints);
        return allIntermediatePoints;
    },
    // 检查所有坐标点的瓦片是否存在
    async checkAllTilesExist() {
        if (DrawingManager.selectedCoordinates.length === 0) return;
        const results = [];
        for (const coord of DrawingManager.selectedCoordinates) {
            const tileInfo = CoordinateUtils.getTileInfo(coord.longitude, coord.latitude, 14);
            const exists = await CoordinateUtils.checkTileExists(tileInfo.tilePath);

            results.push({
                coord: coord,
                tileInfo: tileInfo,
                exists: exists
            });
        }
        // 显示检查结果
        const existingTiles = results.filter(r => r.exists).length;
        const totalTiles = results.length;
        let message = `瓦片存在性检查：\n\n`;
        message += `存在 ${existingTiles}/${totalTiles} 个瓦片\n\n`;
        results.forEach(result => {
            const status = result.exists ? 'true' : 'false';
            message += `${status} 点${result.coord.id}: ${result.tileInfo.tilePath}\n`;
        });
        alert(message);
        return results;
    }
};
// 将CONFIG暴露到全局作用域
window.CONFIG = CONFIG;

// 全局API
window.drawingModule = {
    // 绘图管理
    startDrawing: () => DrawingManager.startDrawing(),
    stopDrawing: () => DrawingManager.stopDrawing(),
    clearDrawing: () => DrawingManager.clearDrawing(),
    removeCoordinate: (coordId) => DrawingManager.removeCoordinate(coordId),
    loadFromTxt: (text) => DrawingManager.loadFromTxt(text),
    // UI管理
    updateCoordinatesDisplay: () => UIManager.updateCoordinatesDisplay(),
    initializeDrawingEventListeners: () => UIManager.initializeEventListeners(),
    // 高程数据
    getElevationData: () => ElevationDataManager.getElevationData(),
    getSinglePointElevation: (coord) => ElevationDataManager.getSinglePointElevation(coord),
    // 数据导出
    exportElevationData: () => DataExportManager.exportElevationData(),
    exportElevationDataTXT: () => DataExportManager.exportElevationDataTXT(),
    exportLineTerrainData: () => DataExportManager.exportLineTerrainData(),
    exportLineTerrainDataTXT: () => DataExportManager.exportLineTerrainDataTXT(),
    exportIntermediatePoints: () => DataExportManager.exportIntermediatePoints(),
    exportIntermediatePointsTXT: () => DataExportManager.exportIntermediatePointsTXT(),
    // 坐标工具
    calculateAllIntermediatePoints: () => DrawingModule.calculateAllIntermediatePoints(),
    checkAllTilesExist: () => DrawingModule.checkAllTilesExist(),
    // ASCII数据管理
    clearAsciiData: () => CONFIG.clearAsciiData(),
    // 初始化
    init: () => DrawingModule.init()
};
// 直接导出到全局作用域，HTML直接调用
window.startDrawing = () => DrawingManager.startDrawing();
window.stopDrawing = () => DrawingManager.stopDrawing();
window.clearDrawing = () => DrawingManager.clearDrawing();
window.removeCoordinate = (coordId) => DrawingManager.removeCoordinate(coordId);
window.updateCoordinatesDisplay = () => UIManager.updateCoordinatesDisplay();
window.getElevationData = () => ElevationDataManager.getElevationData();
window.getSinglePointElevation = (coord) => ElevationDataManager.getSinglePointElevation(coord);
window.exportElevationData = () => DataExportManager.exportElevationData();
window.exportElevationDataTXT = () => DataExportManager.exportElevationDataTXT();
window.exportLineTerrainData = () => DataExportManager.exportLineTerrainData();
window.exportLineTerrainDataTXT = () => DataExportManager.exportLineTerrainDataTXT();
window.calculateAllIntermediatePoints = () => DrawingModule.calculateAllIntermediatePoints();
window.checkAllTilesExist = () => DrawingModule.checkAllTilesExist();

// 中间坐标相关界面函数
window.hideIntermediatePoints = () => {
    const container = document.getElementById('intermediatePointsContainer');
    if (container) {
        container.classList.add('d-none');
    }
};
// 自动初始化
document.addEventListener('DOMContentLoaded', () => {
    DrawingModule.init();
});
