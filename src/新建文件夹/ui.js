// UI状态管理工具函数

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

// 停止处理
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

    //下载
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
                downloadStatus.textContent = '文件下载已开始';
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
            console.error('下载失败:', error);
            if (downloadStatus) {
                downloadStatus.textContent = '下载失败';
            }
            if (downloadLink) {
                downloadLink.style.display = 'inline-block';
            }
        }
    }, 2000); // 2秒后开始下载
}

// 导出到全局作用域
window.uiUtils = {
    updateProgress,
    startProcessing,
    stopProcessing,
    showProgress,
    hideProgress,
    showResult,
    showError,
    hideAllContainers,
    startAutoDownload
};

