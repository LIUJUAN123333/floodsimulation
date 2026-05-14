// shp_handler.js
window.shpHandler = {
    init: function() {
        const shpForm = document.getElementById('shpUploadForm');
        if(shpForm) shpForm.addEventListener('submit', this.handleShpUpload.bind(this));

        const geojsonForm = document.getElementById('geojsonUploadForm');
        if(geojsonForm) geojsonForm.addEventListener('submit', this.handleGeoJsonUpload.bind(this));
        
        const clearBtn = document.getElementById('clearShpLayer');
        if(clearBtn) clearBtn.addEventListener('click', this.clearLayers.bind(this));
    },
    
    handleShpUpload: async function(e) {
        e.preventDefault();
        const input = document.getElementById('shpFile');
        if (input.files.length === 0) return;

        const formData = new FormData(e.target);
        
        // Show progress
        if (window.uiUtils) window.uiUtils.startProcessing();
        const statusDiv = document.getElementById('shpUploadStatus');
        if (statusDiv) statusDiv.textContent = 'Uploading and processing...';

        try {
            const response = await fetch('/upload_shp', { 
                method: 'POST', 
                body: formData 
            });
            const result = await response.json();
            
            if(result.success) {
                this.loadGeoJson(result.data); // data is geojson object
                if (statusDiv) statusDiv.textContent = 'SHP loaded successfully.';
                if (window.uiUtils) window.uiUtils.showResult({message: 'SHP file loaded successfully'});
            } else {
                if (statusDiv) statusDiv.textContent = 'Error: ' + result.message;
                if (window.uiUtils) window.uiUtils.showError(result.message);
            }
        } catch(err) {
            if (statusDiv) statusDiv.textContent = 'Error: ' + err.message;
            if (window.uiUtils) window.uiUtils.showError(err.message);
        } finally {
            if (window.uiUtils) window.uiUtils.stopProcessing();
        }
    },
    
    handleGeoJsonUpload: function(e) {
        e.preventDefault();
        const file = document.getElementById('geojsonFile').files[0];
        if(!file) return;
        
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const json = JSON.parse(e.target.result);
                this.loadGeoJson(json);
                const statusDiv = document.getElementById('shpUploadStatus');
                if (statusDiv) statusDiv.textContent = 'GeoJSON loaded successfully.';
            } catch(err) {
                if (window.uiUtils) window.uiUtils.showError("Invalid GeoJSON");
            }
        };
        reader.readAsText(file);
    },

    loadGeoJson: function(geojson) {
       if(!window.cesiumViewer) return;
       const options = this.getStyleOptions();
       
       Cesium.GeoJsonDataSource.load(geojson, {
           stroke: options.stroke,
           fill: options.fill,
           strokeWidth: options.strokeWidth,
           clampToGround: options.clampToGround
       }).then(dataSource => {
           window.cesiumViewer.dataSources.add(dataSource);
           window.cesiumViewer.zoomTo(dataSource);
           
           // Apply entities style adjustments if needed (GeoJsonDataSource mostly handles it)
           const entities = dataSource.entities.values;
           for (let i = 0; i < entities.length; i++) {
               const entity = entities[i];
               // For lines
               if (entity.polyline) {
                   entity.polyline.material = options.stroke;
                   entity.polyline.width = options.strokeWidth;
                   entity.polyline.clampToGround = options.clampToGround;
               }
               // For polygons
               if (entity.polygon) {
                   entity.polygon.material = options.fill; // This handles alpha
                   entity.polygon.outline = true;
                   entity.polygon.outlineColor = options.stroke;
                   entity.polygon.heightReference = options.clampToGround ? Cesium.HeightReference.CLAMP_TO_GROUND : Cesium.HeightReference.NONE;
               }
               // For points
               if (entity.billboard) {
                    // Disable billboard if we use point
               }
               if (entity.point) {
                    entity.point.color = options.stroke;
                    entity.point.pixelSize = options.strokeWidth * 2;
                    entity.point.heightReference = options.clampToGround ? Cesium.HeightReference.CLAMP_TO_GROUND : Cesium.HeightReference.NONE;
               }
           }

           if(!window.shpLayers) window.shpLayers = [];
           window.shpLayers.push(dataSource);
       });
    },
    
    getStyleOptions: function() {
        const colorHex = document.getElementById('shpStyleColor').value;
        const color = Cesium.Color.fromCssColorString(colorHex);
        const alpha = parseFloat(document.getElementById('shpStyleAlpha').value);
        color.alpha = alpha;
        
        const width = parseFloat(document.getElementById('shpStyleWidth').value);
        const fillChecked = document.getElementById('shpStyleFill').checked;
        const clamp = document.getElementById('shpClampToGround').checked;
        
        return {
            stroke: color,
            fill: fillChecked ? color : Cesium.Color.TRANSPARENT,
            strokeWidth: width,
            clampToGround: clamp
        };
    },
    
    clearLayers: function() {
        if(window.shpLayers && window.cesiumViewer) {
            window.shpLayers.forEach(ds => window.cesiumViewer.dataSources.remove(ds));
            window.shpLayers = [];
        }
         const statusDiv = document.getElementById('shpUploadStatus');
         if (statusDiv) statusDiv.textContent = 'Layers cleared.';
    }
};

document.addEventListener('DOMContentLoaded', () => {
    window.shpHandler.init();
});
