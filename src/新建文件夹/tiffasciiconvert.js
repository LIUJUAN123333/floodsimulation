// 格式转换功能处理

// 处理格式转换
async function handleConvert(event) {
    event.preventDefault();

    if (window.config.isProcessing) {
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
        window.uiUtils.showError('请选择一个TIFF文件');
        return;
    }
    if (!file.name.toLowerCase().endsWith('.tif') && !file.name.toLowerCase().endsWith('.tiff')) {
        window.uiUtils.showError('请选择TIFF格式的文件');
        return;
    }
    window.uiUtils.startProcessing();
    try {
        const response = await fetch('/convert', {
            method: 'POST',
            body: formData
        });
        const result = await response.json();
        if (result.success) {
            // 如果返回了边界框信息，在地球上显示红色边框
            if (result.bounds && showBounds) {
                window.mapDisplay.displayBoundsOnMap(result.bounds);
            }
            window.uiUtils.showResult({
                message: result.message,
                download_url: result.download_url
            });
            window.uiUtils.stopProcessing();
        } else {
            window.uiUtils.showError(result.message || '转换失败');
            window.uiUtils.stopProcessing();
        }
    } catch (error) {
        console.error('转换错误:', error);
        window.uiUtils.showError('网络错误，请检查连接后重试');
        window.uiUtils.stopProcessing();
    }
}

// 导出到全局作用域
window.convertHandler = {
    handleConvert
};

