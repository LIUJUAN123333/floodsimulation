import DrawTriangleMesh from './DrawTriangleMesh.obfuscated.js';

'use strict';

var destroyObject = Cesium.destroyObject;
var loadJson = Cesium.Resource.fetchJson;
var when = Cesium.when;

var FloodState = {
    BeforInitial: -1,
    Initialed: 0,
    Started: 1,
    Paused: 2,
    End: 3
};

var FloodManager = function (options) {
    this.floodDataURL = options.floodDataURL;
    if (typeof window !== 'undefined') {
        // expose instance for debugging in browser console
        window.__floodManager = this;
        console.log('[FloodManager] created for', this.floodDataURL);
    }
    DrawTriangleMesh.setFloodCenterPosition(options.centerPos);

    this.fileNames = [];
    this.currentFileIndex = 0;

    this.currentFlood = null;
    this.preFlood = null;
    this.state = FloodState.BeforInitial;
    this.allFlood = [];
    this.allCatched = false;
    this.timerID = null;
};

// 动态加载文件名列表并排序
var GetAllFloodSeriseFileName = function (floodManager) {
    var xmlUrl = floodManager.floodDataURL + '/Flood_New.xml';
    return Cesium.Resource.fetchXML(xmlUrl).then((xmlDoc) => {
        console.log('[FloodManager] loaded Flood_New.xml from', xmlUrl);
        var fileList = [];
        var floods = xmlDoc.getElementsByTagName('flood');
        for (var i = 0; i < floods.length; i++) {
            var url = floods[i].getAttribute('url');
            if (url) {
                fileList.push(url);
            }
        }
        console.log('[FloodManager] parsed file list count=', fileList.length);

        fileList.sort((a, b) => {
            const getNum = s => parseInt(s.match(/\d+/)?.[0] || 0)
            return getNum(a) - getNum(b);
        });
        floodManager.fileNames = fileList;
    }, (err) => {
        console.error('[FloodManager] failed to load Flood_New.xml from', xmlUrl, err);
    });
};

FloodManager.prototype.initial = function () {
    GetAllFloodSeriseFileName(this).then(() => {
        this.state = FloodState.Initialed;
        this.start();
        this.checkForNewFiles(); // 启动动态检测新文件
    });
};

FloodManager.prototype.start = function () {
    this.currentFileIndex = 0;
    this.dynamic();
};

FloodManager.prototype.pause = function () {
    this.state = FloodState.Paused;
};

FloodManager.prototype.resume = function () {
    this.state = FloodState.Started;
    this.dynamic();
};

FloodManager.prototype.stop = function () {
    clearTimeout(this.timerID);
    this.state = FloodState.End;
};

FloodManager.prototype.dynamic = function () {
    if (this.state === FloodState.Paused) return;

    if (this.currentFileIndex >= this.fileNames.length) {
        this.state = FloodState.End;
        return;
    }

    const currentFile = this.fileNames[this.currentFileIndex];
    const fullPath = this.floodDataURL + '/' + currentFile;

    loadJson(fullPath).then((jsonObj) => {
        console.log('[FloodManager] loaded', fullPath);
        try {
            const oneNewFloodSurface = DrawTriangleMesh(jsonObj);
            if (oneNewFloodSurface) {
                console.log('[FloodManager] DrawTriangleMesh returned a surface for', currentFile);
                this.allFlood.push(oneNewFloodSurface);
                try {
                    if (this.viewer && this.viewer.scene && this.viewer.scene.primitives) {
                        this.viewer.scene.primitives.add(oneNewFloodSurface);

                        // 如果 DrawTriangleMesh 提供了世界坐标系下的包围球，飞到该包围球中心（只在首次加载时）
                        try {
                            var shouldFly = (this.allFlood.length === 1); // 第一个 surface 时飞行
                            // if (shouldFly && oneNewFloodSurface && oneNewFloodSurface._boundingSphereWorld && this.viewer && this.viewer.camera) {
                            //     try {
                            //         this.viewer.camera.flyToBoundingSphere(oneNewFloodSurface._boundingSphereWorld, { duration: 2 });
                            //     } catch (e) {
                            //         console.warn('[FloodManager] camera.flyToBoundingSphere failed', e);
                            //     }
                            // }
                        } catch (e) {
                            // 忽略定位错误
                            console.warn('[FloodManager] compute fly-to failed', e);
                        }
                    }
                } catch (e) {
                    console.warn('[FloodManager] failed to add surface to viewer.primitives', e);
                }
            } else {
                console.warn('[FloodManager] DrawTriangleMesh returned null/undefined for', currentFile);
            }
        } catch (e) {
            console.warn('[FloodManager] Failed to draw mesh for', currentFile, e);
        }

        this.currentFileIndex++;

        if (this.state !== FloodState.Paused) {
            this.timerID = setTimeout(() => this.dynamic(), 0);
        }
    }, (err) => {
        console.error('[FloodManager] Failed to load flood JSON:', fullPath, err);
        this.currentFileIndex++;
        setTimeout(() => this.dynamic(), 100); // 继续尝试加载下一个
    });
};

// 定时检查是否有新文件
FloodManager.prototype.checkForNewFiles = function () {
    if (this.state === FloodState.End || this.state === FloodState.Paused) return;

    GetAllFloodSeriseFileName(this).then(() => {
        if (this.currentFileIndex < this.fileNames.length) {
            this.state = FloodState.Started;
            this.dynamic();
        }

       // setTimeout(() => this.checkForNewFiles(), 3000); // 每 3 秒检查一次
    });
};

FloodManager.prototype.update = function (frameState) {
    if (!this.allFlood.length) return;

    if (this.state === FloodState.End) {
        const lastSurface = this.allFlood[this.allFlood.length - 1];
        if (lastSurface.ready) lastSurface.update(frameState);
        return;
    }

    for (let i = 0; i < this.allFlood.length; i++) {
        const surface = this.allFlood[i];
        if (surface.ready) {
            surface.show = true;
            surface.update(frameState);
        }
    }
};

FloodManager.prototype.isDestroyed = function () {
    return false;
};

FloodManager.prototype.destroy = function () {
    this.allFlood.forEach(oneFloodSurface => {
        if (oneFloodSurface) {
            try {
                if (this.viewer && this.viewer.scene && this.viewer.scene.primitives) {
                    this.viewer.scene.primitives.remove(oneFloodSurface);
                }
            } catch (e) {
                // ignore
            }
            oneFloodSurface.destroy();
        }
    });
    clearTimeout(this.timerID);
    return destroyObject(this);
};

export default FloodManager;
