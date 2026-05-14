/*
 * @Description: For WEB-GIS
 * @Author: BruceGuo
 * @Date: 2024-05-08 15:58:37
 * @LastEditTime: 2026-01-20
 * @LastEditors: ChatGPT
 * @FilePath: \xinhangcheng——station\src\utils\js\MenuView.js
 */

import FloodManager from "./FloodManager.obfuscated.js";
import proj4 from "proj4";

function MenuView(option) {
  this.viewer = option.viewer;
  this.floodManager = null;
}

// =========================
// 洪水加载与定位
// =========================
MenuView.prototype.demoFlyto = function (
  centerPosData
) {
  const self = this;

  // =========================
  // 洪水数据路径
  // =========================
  let FloodDataURL = "/src/Ffile/"; 


  // =========================
  // 计算 centerPos
  // =========================
  let centerPos;

  /*
   * centerPosData 结构示例：
   * {
   *   lon: 98.66,
   *   lat: 31.10,
   *   ascHeader: {
   *     ncols: 797,
   *     nrows: 814,
   *     xllcorner: 468176.3125,
   *     yllcorner: 3425068.0,
   *     cellsize: 20.0,
   *     utmZone: 47
   *   }
   * }
   */

  // =========================
  // 计算 centerPos
  // =========================


  if (centerPosData && centerPosData.ascHeader) {
      const ncols = parseFloat(centerPosData.ascHeader.ncols);
      const nrows = parseFloat(centerPosData.ascHeader.nrows);
      const xllcorner = parseFloat(centerPosData.ascHeader.xllcorner);
      const yllcorner = parseFloat(centerPosData.ascHeader.yllcorner);
      const cellsize = parseFloat(centerPosData.ascHeader.cellsize);
      const utmZone = parseInt(centerPosData.ascHeader.utmZone) || 48; // Default if missing

      // Defined projection dynamically
      const epsgCode = `EPSG:326${utmZone}`;
      proj4.defs(epsgCode, `+proj=utm +zone=${utmZone} +datum=WGS84 +units=m +no_defs`);

      // UTM Extent
      const xmin = xllcorner;
      const ymin = yllcorner;
      const xmax = xllcorner + ncols * cellsize;
      const ymax = yllcorner + nrows * cellsize;

      // Densify logic (ArcGIS-like)
      const STEP = 1.0;
      let west = Infinity;
      let east = -Infinity;
      let south = Infinity;
      let north = -Infinity;

      const update = (lon, lat) => {
        if (typeof lon !== 'number' || typeof lat !== 'number') return;
        if (lon < west) west = lon;
        if (lon > east) east = lon;
        if (lat < south) south = lat;
        if (lat > north) north = lat;
      }

      // Loop X (Bottom & Top)
      if (Number.isFinite(xmin) && Number.isFinite(xmax)) {
        for (let x = xmin; x <= xmax; x += STEP) {
          try {
            update(...proj4(epsgCode, "WGS84", [x, ymin]));
            update(...proj4(epsgCode, "WGS84", [x, ymax]));
          } catch (e) {}
        }
      }

      // Loop Y (Left & Right)
      if (Number.isFinite(ymin) && Number.isFinite(ymax)) {
        for (let y = ymin; y <= ymax; y += STEP) {
          try {
            update(...proj4(epsgCode, "WGS84", [xmin, y]));
            update(...proj4(epsgCode, "WGS84", [xmax, y]));
          } catch (e) {}
        }
      }

      console.log("===== ArcGIS-consistent WGS84 extent =====");
      console.log("West  :", west);
      console.log("North :", north);
      
      // Flood input coordinates: west(lon), north(lat)
      if (Number.isFinite(west) && Number.isFinite(north)) {
          centerPos = Cesium.Cartesian3.fromDegrees(west, north, 0);
      } else {
          console.error("Calculated extent is invalid (Infinite or NaN). Using default center.");
          centerPos = Cesium.Cartesian3.fromDegrees(102.0, 31.0, 0);
      }

  } else if (centerPosData && Number.isFinite(centerPosData.lon) && Number.isFinite(centerPosData.lat)) {
     centerPos = Cesium.Cartesian3.fromDegrees(centerPosData.lon, centerPosData.lat, 0);
  } else {
    console.warn("[MenuView] No valid centerPosData, using default center.");
    centerPos = Cesium.Cartesian3.fromDegrees(98.6663, 31.1059, 0);
    //centerPos = Cesium.Cartesian3.fromDegrees(98.695377,31.093020,0);
  }



  // =========================
  // 创建并初始化 FloodManager
  // =========================
  self.floodManager = new FloodManager({
    floodDataURL: FloodDataURL,
    centerPos: centerPos
  });

  self.floodManager.viewer = self.viewer;
  self.floodManager.initial();
  self.viewer.scene.primitives.add(self.floodManager);
};

// =========================
// 控制方法
// =========================
MenuView.prototype.demoPause = function () {
  if (this.floodManager) {
    this.floodManager.pause();
  }
};

MenuView.prototype.demoResume = function () {
  if (this.floodManager) {
    this.floodManager.resume();
  }
};

MenuView.prototype.demoStop = function () {
  if (this.floodManager) {
    this.viewer.scene.primitives.remove(this.floodManager);
    this.floodManager = null;
  }
};

export default MenuView;
