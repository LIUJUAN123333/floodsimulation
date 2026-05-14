/**
 * 根据坐标从ASCII文件获取行列号功能
 * 功能说明：
 * 1. 用户选择ASCII文件和画线txt文件
 * 2. 系统读取txt文件并解析其中的lon和lat值
 * 3. 对于每个坐标点：
 *    - 将WGS84坐标转换为UTM坐标
 
 *    - 考虑y轴翻转（ASCII文件从北向南存储）
 *    - 从ASCII文件中获取对应位置的行列号
 * 4. 将所有行列号输出到txt文件（格式：row,col）
  /

(function () {
    'use strict';

    // 处理状态 - 使用全局配置

    /**
     * 从txt文件中解析坐标
     * @param {string} txtContent - txt文件内容
     * @returns {Array} 坐标数组，每个元素包含 {lon, lat}
     */
function parseCoordinatesFromTxt(txtContent) {
    const coordinates = [];
    const lines = txtContent.split('\n');

    let currentLon = null;
    let currentLat = null;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        // 查找包含 "lon:" 的行
        if (line.includes('lon:')) {
            const lonMatch = line.match(/lon:\s*([\d.]+)/);
            if (lonMatch) {
                currentLon = parseFloat(lonMatch[1]);
            }
        }

        // 查找包含 "lat:" 的行
        if (line.includes('lat:')) {
            const latMatch = line.match(/lat:\s*([\d.]+)/);
            if (latMatch) {
                currentLat = parseFloat(latMatch[1]);
            }
        }

        // 如果同时找到了lon和lat，添加到坐标列表
        if (currentLon !== null && currentLat !== null && !isNaN(currentLon) && !isNaN(currentLat)) {
            coordinates.push({ lon: currentLon, lat: currentLat });
            // 重置，准备查找下一个点
            currentLon = null;
            currentLat = null;
        }
    }

    return coordinates;
}

/**
 * 显示错误信息
 * @param {string} message - 错误消息
 */
function showError(message) {
    const errorContainer = document.getElementById('errorContainer');
    const errorMessage = document.getElementById('errorMessage');

    if (errorContainer && errorMessage) {
        errorMessage.textContent = message;
        errorContainer.classList.remove('d-none');

        // 3秒后自动隐藏
        setTimeout(() => {
            errorContainer.classList.add('d-none');
        }, 3000);
    } else {
        alert(message);
    }
}

/**
 * 隐藏所有容器
 */
function hideAllContainers() {
    const containers = ['resultContainer', 'errorContainer'];
    containers.forEach(id => {
        const container = document.getElementById(id);
        if (container) {
            container.classList.add('d-none');
        }
    });
}

/**
 * 显示进度条
 */
function showProgress() {
    const container = document.getElementById('progressContainer');
    if (container) {
        container.classList.remove('d-none');
    }
}

/**
 * 隐藏进度条
 */
function hideProgress() {
    const container = document.getElementById('progressContainer');
    if (container) {
        container.classList.add('d-none');
    }
}

/**
 * 更新进度
 * @param {number} progress - 进度百分比 (0-100)
 * @param {string} message - 进度消息
 */
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

/**
 * 开始处理
 */
function startProcessing() {
    window.config.isProcessing = true;
    hideAllContainers();
    showProgress();

    // 禁用所有表单
    const forms = document.querySelectorAll('form');
    forms.forEach(form => {
        const inputs = form.querySelectorAll('input, select, button');
        inputs.forEach(input => input.disabled = true);
    });
}

/**
 * 停止处理
 */
function stopProcessing() {
    window.config.isProcessing = false;
    hideProgress();

    // 启用所有表单
    const forms = document.querySelectorAll('form');
    forms.forEach(form => {
        const inputs = form.querySelectorAll('input, select, button');
        inputs.forEach(input => input.disabled = false);
    });
}

/**
 * 显示结果
 * @param {Object} result - 结果对象，包含 message 和 download_url
 */
function showResult(result) {
    hideAllContainers();
    const container = document.getElementById('resultContainer');
    const messageDiv = document.getElementById('resultMessage');
    const downloadDiv = document.getElementById('downloadSection');

    if (container && messageDiv) {
        messageDiv.textContent = result.message || '处理完成';

        if (result.download_url && downloadDiv) {
            downloadDiv.innerHTML = `
                    <a href="${result.download_url}" class="btn btn-success" download>
                        下载结果文件
                    </a>
                `;
        }

        container.classList.remove('d-none');
    } else {
        alert(result.message || '处理完成');
        if (result.download_url) {
            window.location.href = result.download_url;
        }
    }
}

/**
 * 处理获取ASCII行列号的表单提交
 * @param {Event} event - 表单提交事件
 */
async function handleGetAsciiValue(event) {
    event.preventDefault();

    if (window.config.isProcessing) {
        return;
    }

    const formData = new FormData(event.target);
    const asciiFile = formData.get('ascii_file');
    const lineTxtFile = formData.get('line_txt_file');

    // 验证文件
    if (!asciiFile || asciiFile.size === 0) {
        showError('请选择ASCII文件');
        return;
    }

    if (!lineTxtFile || lineTxtFile.size === 0) {
        showError('请选择画线txt文件');
        return;
    }

    if (!asciiFile.name.toLowerCase().endsWith('.asc') && !asciiFile.name.toLowerCase().endsWith('.txt')) {
        showError('请选择ASC或TXT格式的ASCII文件');
        return;
    }

    if (!lineTxtFile.name.toLowerCase().endsWith('.txt')) {
        showError('请选择TXT格式的画线文件');
        return;
    }

    startProcessing();
    updateProgress(10, '正在读取txt文件...');

    try {
        // 读取txt文件并解析坐标
        const txtContent = await lineTxtFile.text();
        updateProgress(30, '正在解析坐标...');

        const coordinates = parseCoordinatesFromTxt(txtContent);

        if (coordinates.length === 0) {
            showError('未能从txt文件中解析出坐标，请检查文件格式');
            stopProcessing();
            return;
        }

        updateProgress(50, `已解析${coordinates.length}个坐标点，正在上传文件...`);

        // 将坐标添加到formData
        formData.append('coordinates', JSON.stringify(coordinates));

        updateProgress(70, '正在处理...');

        // 发送请求到后端
        const response = await fetch('/get_ascii_values', {
            method: 'POST',
            body: formData
        });

        updateProgress(90, '正在获取结果...');

        // 检查响应状态
        if (!response.ok) {
            throw new Error(`HTTP错误: ${response.status} ${response.statusText}`);
        }

        const result = await response.json();

        if (result.success) {
            updateProgress(100, '处理完成');
            showResult({
                message: result.message,
                download_url: result.download_url
            });
            stopProcessing();
        } else {
            showError(result.message || '获取ASCII行列号失败');
            stopProcessing();
        }
    } catch (error) {
        console.error('处理错误:', error);
        let errorMessage = '网络错误，请检查连接后重试';
        if (error.message) {
            errorMessage = `错误: ${error.message}`;
        }
        showError(errorMessage);
        stopProcessing();
    }
}



/**
 * 从ASCII文件读取cellsize并更新插值步长，同时加载完整数据用于插值
 * @param {File} file - ASCII文件
 */
async function loadCellsizeFromAsciiFile(file) {
    if (window.CONFIG && window.CONFIG.loadCellsizeFromAsciiFile) {
        try {
            // 先加载完整的ASCII数据用于插值
            if (window.CONFIG.loadAsciiData) {
                await window.CONFIG.loadAsciiData(file);
            }

            // 再读取cellsize
            const cellsize = await window.CONFIG.loadCellsizeFromAsciiFile(file);
            if (cellsize) {
                // 更新UI显示
                showCellsizeUpdateMessage(cellsize);
            }
        } catch (error) {
            console.error('加载ASCII数据失败:', error);
            showError('加载ASCII数据失败: ' + error.message);
        }
    }
}

/**
 * 显示cellsize更新消息
 * @param {number} cellsize - 新的cellsize值
 */
function showCellsizeUpdateMessage(cellsize) {
    const message = `插值步长已更新为ASCII文件的cellsize: ${cellsize} 米`;

    // 显示在页面上
    let messageDiv = document.getElementById('cellsizeMessage');
    const form = document.getElementById('getAsciiValueForm');
    if (!messageDiv) {
        if (!form) {
            console.warn('未找到表单 #getAsciiValueForm，无法显示cellsize提示');
            return;
        }
        messageDiv = document.createElement('div');
        messageDiv.id = 'cellsizeMessage';
        messageDiv.className = 'alert alert-info mt-2';
        messageDiv.style.cssText = 'padding: 8px; font-size: 12px; margin-bottom: 10px;';
        form.appendChild(messageDiv);
    }
    messageDiv.textContent = message;

    // 3秒后自动隐藏
    setTimeout(() => {
        if (messageDiv) {
            messageDiv.remove();
        }
    }, 3000);

    console.log(message);
}

let initObserver = null;
function init() {
    const form = document.getElementById('getAsciiValueForm');
    if (form) {
        if (initObserver) {
            initObserver.disconnect();
            initObserver = null;
        }
        // 绑定表单提交事件
        form.addEventListener('submit', handleGetAsciiValue);

        // 绑定文件选择事件，当选择ASCII文件时自动读取cellsize
        const asciiFileInput = document.getElementById('asciiFile');
        if (asciiFileInput) {
            asciiFileInput.addEventListener('change', function (event) {
                const file = event.target.files[0];
                if (file) {
                    loadCellsizeFromAsciiFile(file);
                }
            });
        }

        console.log('ASCII行列号获取功能已初始化');
        return true;
    }

    if (!initObserver && document.body) {
        console.warn('未找到表单 #getAsciiValueForm，等待DOM渲染后初始化');
        initObserver = new MutationObserver(() => {
            if (document.getElementById('getAsciiValueForm')) {
                init();
            }
        });
        initObserver.observe(document.body, { childList: true, subtree: true });
    }
    return false;
}

// DOM加载完成后初始化
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    // DOM已经加载完成
    init();
}

// 导出到全局作用域（可选，用于外部调用）
window.GetAsciiValues = {
    parseCoordinatesFromTxt: parseCoordinatesFromTxt,
    handleGetAsciiValue: handleGetAsciiValue,
    init: init
};



