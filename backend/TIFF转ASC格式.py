import numpy as np
import rasterio
import os

def dem_to_ascii_gdal(dem_file_path, output_asc_path=None):
    if output_asc_path is None:
        base_name = os.path.splitext(dem_file_path)[0]
        output_asc_path = base_name + '.asc'
    
    try:
        with rasterio.open(dem_file_path) as dataset:
            dem_data = dataset.read(1).astype(np.float64)
            cols = dataset.width
            rows = dataset.height
            
            # dataset.bounds returns (left, bottom, right, top)
            xllcorner = dataset.bounds.left
            yllcorner = dataset.bounds.bottom
            
            # dataset.res returns (x_res, y_res)
            cellsize_x = dataset.res[0]
            cellsize_y = dataset.res[1]
            cellsize = (cellsize_x + cellsize_y) / 2  # Use average cell size
            
            nodata_value = dataset.nodata
            
            # Process data: replace nodata and nan with 9999
            if nodata_value is not None:
                dem_data = np.where(dem_data == nodata_value, 9999, dem_data)
            
            dem_data = np.where(np.isnan(dem_data), 9999, dem_data)
            
            with open(output_asc_path, 'w', encoding='utf-8') as asc_file:
                asc_file.write(f"ncols {cols}\n")
                asc_file.write(f"nrows {rows}\n")
                asc_file.write(f"xllcorner {xllcorner}\n")
                asc_file.write(f"yllcorner {yllcorner}\n")
                asc_file.write(f"cellsize {cellsize}\n")
                asc_file.write(f"NODATA_value 9999\n")
                
                for i in range(rows):
                    row_data = dem_data[i, :]
                    formatted_values = []
                    for value in row_data:
                        if abs(value - 9999) < 1e-6 or np.isnan(value):
                            formatted_values.append("9999")
                        else:
                            formatted_values.append(f"{value:.6f}")
                    asc_file.write(" ".join(formatted_values) + "\n")
                    
        return output_asc_path
        
    except Exception as e:
        print(f"Error converting DEM to ASCII: {e}")
        raise e

if __name__ == "__main__":
    input_dem = "C:/Users/19676/Desktop/项目地灾功能/灾后DEM.tif"
    output_asc = "灾后dem转1.txt"
    # result = dem_to_ascii_gdal(input_dem, output_asc)
