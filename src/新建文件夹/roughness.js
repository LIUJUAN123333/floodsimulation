// 粗糙度计算功能处理

// 处理粗糙度计算
async function handleRoughness(event) {
    event.preventDefault();

    if (window.config.isProcessing) {
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
    const tifFile = formData.get('tif_file');
    if (tifFile && tifFile.size > 0) {
        formData.append('has_tif', 'true');
    }

    if (!file || file.size === 0) {
        window.uiUtils.showError('请选择一个ASC或TXT文件');
        return;
    }

    if (!file.name.toLowerCase().endsWith('.asc') && !file.name.toLowerCase().endsWith('.txt')) {
        window.uiUtils.showError('请选择ASC或TXT格式的文件');
        return;
    }
    window.uiUtils.startProcessing();
    try {
        const response = await fetch('/roughness', {
            method: 'POST',
            body: formData
        });

        const result = await response.json();
        console.log('=== 粗糙度计算结果 ===');
        console.log('Success:', result.success);
        console.log('Bounds 存在:', !!result.bounds);
        console.log('showBounds:', showBounds);
        if (result.bounds) {
            console.log('Bounds 内容:', JSON.stringify(result.bounds));
        }

        if (result.success) {
            // 保存粗糙度文件名
            if (result.roughness_file) {
                window.config.currentRoughnessFile = result.roughness_file;
            }

            // 如果返回了边界框信息
            if (result.bounds) {
                console.log('准备处理边界框...');
                if (showBounds) {
                    console.log('调用 displayBoundsOnMap (显示边界)');
                    // 在地形上显示红色边框（贴地显示）
                    window.mapDisplay.displayBoundsOnMap(result.bounds);
                    // 保存红色边框的边界信息
                    window.config.roughnessBounds = result.bounds;
                } else {
                    console.log('调用 flyToBounds (仅飞行)');
                    // 不显示边框，但跳转到对应位置
                    if (window.mapDisplay && window.mapDisplay.flyToBounds) {
                        window.mapDisplay.flyToBounds(result.bounds);
                    } else {
                        console.error('❌ flyToBounds 函数不存在');
                    }
                }
            } else {
                console.warn('⚠ 后端未返回 bounds 数据');
            }

            // 如果返回了边界点信息，显示这些点（高程3500米，只显示边界，不显示内部点）
            if (result.interior_points && showBounds) {
                window.mapDisplay.displayInteriorPoints(result.interior_points);
            }

            window.uiUtils.showResult({
                message: result.message,
                download_url: result.download_url
            });
            window.uiUtils.stopProcessing();
        } else {
            window.uiUtils.showError(result.message || '计算失败');
            window.uiUtils.stopProcessing();
        }
    } catch (error) {
        console.error('计算错误:', error);
        window.uiUtils.showError('网络错误，请检查连接后重试');
        window.uiUtils.stopProcessing();
    }
}
// 导出到全局作用域
window.roughnessHandler = {
    handleRoughness
};

