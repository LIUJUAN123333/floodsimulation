// 地图显示相关功能

// 在地球上显示边界框（红色边框）
function displayBoundsOnMap(bounds) {
    console.log('=== 开始调用 displayBoundsOnMap ===');
    console.log('Bounds 数据:', JSON.stringify(bounds));
    
    if (!bounds) {
        console.warn('边界框数据无效');
        return;
    }

    // 清除之前的边界框
    clearBoundsOnMap();

    // 确保viewer存在
    if (!window.cesiumViewer) {
        console.error('❌ Cesium viewer未初始化');
        return;
    }

    const viewer = window.cesiumViewer;
    console.log('✓ Cesium viewer 已准备');
    
    // 验证 bounds 包含必要的坐标信息
    if (!bounds.min_lon || !bounds.max_lon || !bounds.min_lat || !bounds.max_lat) {
        console.error('❌ Bounds 缺少 min/max 经纬度信息:', bounds);
    } else {
        console.log('✓ Bounds 包含完整经纬度范围:', {
            lon: [bounds.min_lon, bounds.max_lon],
            lat: [bounds.min_lat, bounds.max_lat]
        });
    }

    try {
        // 优先使用所有边界点，如果没有则使用四个角点
        // 注意：空数组在JS中为真值，需要检查长度
        let coordinates;
        if (bounds.boundary_points && bounds.boundary_points.length > 0) {
            coordinates = bounds.boundary_points;
        } else {
            coordinates = bounds.coordinates;
        }

        if (!coordinates || coordinates.length === 0) {
            console.warn('边界坐标数据无效');
            return;
        }

        console.log(`准备绘制边界，点数: ${coordinates.length}`);

        // 将经纬度坐标转换为Cesium的Cartesian3数组
        const positions = coordinates.map(coord => {
            return Cesium.Cartesian3.fromDegrees(coord[0], coord[1]);
        });

        // 确保边界闭合
        if (positions.length > 0) {
            const firstPos = positions[0];
            const lastPos = positions[positions.length - 1];
            const distance = Cesium.Cartesian3.distance(firstPos, lastPos);
            // 如果距离大于1米，说明边界未闭合，需要添加第一个点
            if (distance > 1.0) {
                positions.push(Cesium.Cartesian3.clone(firstPos));
            }
        }

        // 创建红色边框线（更明显的边框效果）
        const polylineEntity = viewer.entities.add({
            name: 'ASCII文件边界框线',
            polyline: {
                positions: positions,
                width: 5.0,
                material: Cesium.Color.RED,
                clampToGround: true // 贴地显示
            }
        });

        window.config.boundsEntities.push(polylineEntity);

        // 视角飞向边界框 - 使用 camera.flyTo 配合 rectangle 更可靠
        console.log('🚀 准备飞向边界框...');
        
        // 确保 bounds 有 min/max 信息
        if (bounds.min_lon !== undefined && bounds.max_lon !== undefined &&
            bounds.min_lat !== undefined && bounds.max_lat !== undefined) {
            
            console.log('使用 Rectangle 方式飞行');
            const rectangle = Cesium.Rectangle.fromDegrees(
                bounds.min_lon, 
                bounds.min_lat, 
                bounds.max_lon, 
                bounds.max_lat
            );
            
            console.log('Rectangle 创建成功:', {
                west: Cesium.Math.toDegrees(rectangle.west),
                south: Cesium.Math.toDegrees(rectangle.south),
                east: Cesium.Math.toDegrees(rectangle.east),
                north: Cesium.Math.toDegrees(rectangle.north)
            });
            
            // 使用 setTimeout 确保 entity 已经完全添加
            setTimeout(() => {
                viewer.camera.flyTo({
                    destination: rectangle,
                    duration: 2.0
                }).then(() => {
                    console.log('✓ 飞行成功完成');
                }).catch(e => {
                    console.error('❌ Camera FlyTo 错误:', e);
                    // Fallback: 尝试使用 viewer.flyTo
                    viewer.flyTo(polylineEntity, {
                        duration: 2.0
                    }).catch(err => {
                        console.error('❌ Viewer FlyTo 也失败:', err);
                    });
                });
            }, 100);
        } else {
            // 如果没有 min/max 信息，使用 entity 方式
            console.log('使用 Entity 方式飞行');
            setTimeout(() => {
                viewer.flyTo(polylineEntity, {
                    duration: 2.0
                }).then(() => {
                    console.log('✓ Entity 飞行成功');
                }).catch(e => {
                    console.error('❌ FlyTo 错误:', e);
                });
            }, 100);
        }

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
    window.config.boundsEntities.forEach(entity => {
        viewer.entities.remove(entity);
    });
    window.config.boundsEntities = [];
    // 清除红色边框的边界信息
    window.config.roughnessBounds = null;
    // 清除边界内点
    clearInteriorPoints();
}

// 在地球上显示高程采样点
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
                    point.height // 使用采样高度
                ),
                point: {
                    pixelSize: 5,
                    color: Cesium.Color.CYAN,
                    outlineColor: Cesium.Color.BLUE,
                    outlineWidth: 1,
                    heightReference: Cesium.HeightReference.NONE // 使用绝对高度
                }
            });

            window.config.elevationSampleEntities.push(pointEntity);
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
    window.config.elevationSampleEntities.forEach(entity => {
        viewer.entities.remove(entity);
    });
    window.config.elevationSampleEntities = [];
}

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

            window.config.interiorPointEntities.push(pointEntity);
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
    window.config.interiorPointEntities.forEach(entity => {
        viewer.entities.remove(entity);
    });
    window.config.interiorPointEntities = [];
}

// 仅飞向边界区域而不绘制
function flyToBounds(bounds) {
    if (!bounds) return;
    if (!window.cesiumViewer) return;
    const viewer = window.cesiumViewer;
    
    try {
        if (bounds.min_lon !== undefined && bounds.max_lon !== undefined &&
            bounds.min_lat !== undefined && bounds.max_lat !== undefined) {
            
            console.log('Flying to bounds (no border):', bounds);
            const rectangle = Cesium.Rectangle.fromDegrees(
                bounds.min_lon, 
                bounds.min_lat, 
                bounds.max_lon, 
                bounds.max_lat
            );
            
            viewer.camera.flyTo({
                destination: rectangle,
                duration: 2.0
            });
        }
    } catch (e) {
        console.error('FlyToBounds error:', e);
    }
}

// 清除所有边框和采样点
function clearAllBounds() {
    clearBoundsOnMap();
    clearElevationSamples();
    console.log('已清除所有边框和采样点');
}

// 导出到全局作用域
window.mapDisplay = {
    displayBoundsOnMap,
    clearBoundsOnMap,
    displayElevationSamples,
    clearElevationSamples,
    displayInteriorPoints,
    clearInteriorPoints,
    clearAllBounds,
    flyToBounds
};

