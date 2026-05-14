import numpy as np
import math
import rasterio
try:
    from pyproj import Transformer, CRS
    PYPROJ_AVAILABLE = True
except ImportError:
    PYPROJ_AVAILABLE = False
import traceback

# 地球半径常量（米）
EARTH_RADIUS = 6378137.0

# 默认UTM投影（47N）
DEFAULT_UTM_EPSG = "EPSG:32647"
# 当前使用的UTM投影
CURRENT_UTM_EPSG = DEFAULT_UTM_EPSG
# 缓存Transformer对象以提高性能
_TRANSFORMER_TO_WGS84 = None
_TRANSFORMER_TO_UTM = None

def get_utm_epsg_from_tif(tif_path):
    """从TIFF文件中获取UTM投影EPSG代码"""
    try:
        if not tif_path:
            return None
        with rasterio.open(tif_path) as src:
            crs = src.crs
            if crs:
                # 首先尝试直接获取EPSG代码
                epsg = crs.to_epsg()
                if epsg:
                     return f"EPSG:{epsg}"
                
                # 如果是WGS84但是没有Projected CRS信息，需要计算Zone
                # 检查是否是地理坐标系
                if crs.is_geographic:
                    # 获取中心点经度计算Zone
                    bounds = src.bounds
                    center_lon = (bounds.left + bounds.right) / 2
                    import math
                    zone = math.floor((center_lon + 180) / 6) + 1
                    # 判断北半球还是南半球 (粗略用中心纬度)
                    center_lat = (bounds.bottom + bounds.top) / 2
                    is_northern = center_lat >= 0
                    
                    base = 32600 if is_northern else 32700
                    return f"EPSG:{base + zone}"

                # 尝试从WKT解析 (兜底)
                return str(crs)
    except Exception as e:
        print(f"Error reading CRS from TIF: {e}")
    return None

def set_utm_epsg(epsg_code):
    """设置当前使用的UTM投影EPSG代码"""
    global CURRENT_UTM_EPSG, _TRANSFORMER_TO_WGS84, _TRANSFORMER_TO_UTM
    if epsg_code != CURRENT_UTM_EPSG:
        CURRENT_UTM_EPSG = epsg_code
        # 清除缓存，下次使用时重新创建
        _TRANSFORMER_TO_WGS84 = None
        _TRANSFORMER_TO_UTM = None
        print(f"坐标投影已更新为: {CURRENT_UTM_EPSG}")

# 指定文件的左上角WGS84坐标（经度, 纬度）
# 如果不需要固定坐标，可以将此设置为 None
TOP_LEFT_WGS84 = None

def smart_round_coordinate(value, mode='nearest'):
    """
    参数:
        value: 要取整的浮点数值
       取整模式
            - 'floor': 向下取整
            - 'ceil': 向上取整
            - 'nearest': 四舍五入到最近整数
            - 'boundary_min': 边界最小值（向下取整）
            - 'boundary_max': 边界最大值（向上取整）
    返回:
        取整后的整数值
    """
    if mode == 'floor' or mode == 'boundary_min':
        return math.floor(value)
    elif mode == 'ceil' or mode == 'boundary_max':
        return math.ceil(value)
    elif mode == 'nearest':
        return round(value)
    else:
        # 默认四舍五入
        return round(value)

def utm_to_wgs84(utm_x, utm_y, epsg_code=None):
    """
    将UTM坐标转换为WGS84经纬度坐标
    如果不指定epsg_code，使用全局设置的CURRENT_UTM_EPSG
    """
    if not PYPROJ_AVAILABLE:
        print("Warning: pyproj not available, returning coordinates as is.")
        return utm_x, utm_y
        
    global _TRANSFORMER_TO_WGS84
    
    # 如果指定了临时的epsg_code，则临时创建transformer
    if epsg_code and epsg_code != CURRENT_UTM_EPSG:
        temp_transformer = Transformer.from_crs(epsg_code, "EPSG:4326", always_xy=True)
        return temp_transformer.transform(utm_x, utm_y)
        
    # 否则使用缓存的transformer
    if _TRANSFORMER_TO_WGS84 is None:
        try:
            _TRANSFORMER_TO_WGS84 = Transformer.from_crs(CURRENT_UTM_EPSG, "EPSG:4326", always_xy=True)
        except Exception as e:
            print(f"创建坐标转换器失败 ({CURRENT_UTM_EPSG} -> EPSG:4326): {e}")
            # 回退到默认
            _TRANSFORMER_TO_WGS84 = Transformer.from_crs(DEFAULT_UTM_EPSG, "EPSG:4326", always_xy=True)
            
    return _TRANSFORMER_TO_WGS84.transform(utm_x, utm_y)

def utm47n_to_wgs84(utm_x, utm_y):
    """兼容旧接口：将UTM47N坐标转换为WGS84经纬度坐标"""
    return utm_to_wgs84(utm_x, utm_y, "EPSG:32647")

def array_index_to_utm(i, j, nrows, xllcorner, yllcorner, cellsize):
    """从数组索引计算UTM坐标（考虑y轴翻转）"""
    utm_x = xllcorner + j * cellsize + cellsize / 2
    utm_y = yllcorner + (nrows - 1 - i) * cellsize + cellsize / 2
    return utm_x, utm_y

def array_index_to_wgs84(i, j, nrows, xllcorner, yllcorner, cellsize):
    """从数组索引计算WGS84坐标（考虑y轴翻转）"""
    utm_x, utm_y = array_index_to_utm(i, j, nrows, xllcorner, yllcorner, cellsize)
    
    # 如果原始坐标看起来像经纬度（范围在 -180~180, -90~90 之间），则不再进行转换
    # 这里用宽松一点的范围判断 xllcorner，避免有些边缘情况
    if -360 <= xllcorner <= 360 and -90 <= yllcorner <= 90:
        return utm_x, utm_y
        
    return utm_to_wgs84(utm_x, utm_y)

def wgs84_to_utm(lon, lat, epsg_code=None):
    """
    将WGS84坐标转换为UTM坐标
    如果不指定epsg_code，使用全局设置的CURRENT_UTM_EPSG
    """
    if not PYPROJ_AVAILABLE:
        return lon, lat
        
    global _TRANSFORMER_TO_UTM
    
    # 如果指定了临时的epsg_code，则临时创建transformer
    if epsg_code and epsg_code != CURRENT_UTM_EPSG:
        temp_transformer = Transformer.from_crs("EPSG:4326", epsg_code, always_xy=True)
        return temp_transformer.transform(lon, lat)
        
    # 否则使用缓存的transformer
    if _TRANSFORMER_TO_UTM is None:
        try:
            _TRANSFORMER_TO_UTM = Transformer.from_crs("EPSG:4326", CURRENT_UTM_EPSG, always_xy=True)
        except Exception as e:
            print(f"创建坐标转换器失败 (EPSG:4326 -> {CURRENT_UTM_EPSG}): {e}")
            # 回退到默认
            _TRANSFORMER_TO_UTM = Transformer.from_crs("EPSG:4326", DEFAULT_UTM_EPSG, always_xy=True)
            
    return _TRANSFORMER_TO_UTM.transform(lon, lat)

def calculate_row_col_range(min_lon, max_lon, min_lat, max_lat, xllcorner, yllcorner, cellsize, ncols, nrows):
    """计算WGS84坐标范围对应的行列范围"""
    min_utm_x, min_utm_y = wgs84_to_utm(min_lon, min_lat)
    max_utm_x, max_utm_y = wgs84_to_utm(max_lon, max_lat)

    # 最小列边界：向下取整
    min_col = max(0, smart_round_coordinate((min_utm_x - xllcorner) / cellsize, 'boundary_min'))
    # 最大列边界：向上取整后+1
    max_col = min(ncols - 1, smart_round_coordinate((max_utm_x - xllcorner) / cellsize, 'boundary_max') + 1)

    # 南边行边界：向下取整
    row_south = max(0, smart_round_coordinate((min_utm_y - yllcorner) / cellsize, 'boundary_min'))
    # 北边行边界：向上取整后+1
    row_north = min(nrows - 1, smart_round_coordinate((max_utm_y - yllcorner) / cellsize, 'boundary_max') + 1)
    min_row = nrows - 1 - row_north
    max_row = nrows - 1 - row_south

    return min_row, max_row, min_col, max_col

def create_valid_mask(array, nodata_values):
    """创建有效数据掩码（非nodata值且非NaN）"""
    valid_mask = np.ones(array.shape, dtype=bool)
    for ndv in nodata_values:
        valid_mask = valid_mask & (array != ndv)
    valid_mask = valid_mask & ~np.isnan(array)
    return valid_mask

def find_boundary_points(valid_mask, nrows, ncols):
    """找到所有边界点：有效点且至少有一个邻居是无效点或超出边界 (NumPy优化版)"""
    # 使用NumPy操作代替双重循环，提高性能
    
    # 构造padding后的mask，边缘填False（视为无效）
    padded = np.pad(valid_mask, pad_width=1, mode='constant', constant_values=False)
    
    # 获取上下左右四个方向的邻居
    up = padded[:-2, 1:-1]
    down = padded[2:, 1:-1]
    left = padded[1:-1, :-2]
    right = padded[1:-1, 2:]
    
    # 如果一个点是有效的，且它的4个邻居（上下左右）只要有一个是无效的，或者是边界，它就是边界点
    # 这里的eroded是指所有4个邻居都有效的核心区域
    eroded = up & down & left & right
    
    # 边界 = 原图有效区域 - 腐蚀后的核心区域
    boundary_mask = valid_mask & ~eroded
    
    # 获取边界点的坐标索引
    rows, cols = np.nonzero(boundary_mask)
    
    # 转换为集合格式返回，保持与原接口一致
    boundary_indices_set = set(zip(rows, cols))
    
    return boundary_indices_set

def read_ascii_file(ascii_file_path, top_left_lon_lat=TOP_LEFT_WGS84):
    """
    读取ASCII文件并返回文件头信息和高程数组
    注意：DEM数据通常从北向南存储（第一行是北边，最后一行是南边），
    而屏幕坐标系从南向北递增，需要翻转y轴方向。
    因此在使用数组索引i时，需要使用 (nrows - 1 - i) 来计算实际的y坐标。

    参数:
        ascii_file_path: ASCII文件路径
        top_left_lon_lat: 可选的左上角WGS84坐标 (lon, lat)，如果提供则覆盖文件中的坐标
    """
    with open(ascii_file_path, 'r', encoding='utf-8') as f:
        lines = f.readlines()
    
    ncols = int(lines[0].split()[1])
    nrows = int(lines[1].split()[1])
    xllcorner = float(lines[2].split()[1])
    yllcorner = float(lines[3].split()[1])
    cellsize = float(lines[4].split()[1])
    
    # 处理 nodata line 可能的大小写或格式
    nodata_line = lines[5].split()
    if len(nodata_line) >= 2:
        nodata_value = float(nodata_line[1])
    else:
        nodata_value = -9999.0 # Default if missing
        print("Warning: NODATA_value not found in header, using -9999.0")
    
    elevation_data = []
    # 从第6行开始读取数据
    start_line_idx = 6
    for line in lines[start_line_idx:]:
        if line.strip():
            elevation_data.append([float(x) for x in line.split()])

    # 如果指定了左上角坐标，则覆盖文件中的坐标
    if top_left_lon_lat is not None:
        top_left_lon, top_left_lat = top_left_lon_lat
        # 将左上角WGS84坐标转换为UTM坐标
        top_left_utm_x, top_left_utm_y = wgs84_to_utm(top_left_lon, top_left_lat)
        # 重新计算xllcorner和yllcorner
        # xllcorner = 左上角x坐标（左上角是数组[0,0]对应的坐标）
        xllcorner = top_left_utm_x
        # yllcorner = 左上角y坐标 - nrows * cellsize（左下角y坐标）
        yllcorner = top_left_utm_y - nrows * cellsize

    return {
        'ncols': ncols,
        'nrows': nrows,
        'xllcorner': xllcorner,
        'yllcorner': yllcorner,
        'cellsize': cellsize,
        'nodata_value': nodata_value,
        'elevation_array': np.array(elevation_data, dtype=np.float64)
    }

def calculate_ascii_bounds(ascii_file_path, tif_path=None):
    """计算ASCII文件的四个顶点坐标并转换为WGS84"""
    data = read_ascii_file(ascii_file_path)
    ncols, nrows = data['ncols'], data['nrows']
    xllcorner, yllcorner = data['xllcorner'], data['yllcorner']
    cellsize = data['cellsize']
    
    utm_coords = [
        [xllcorner, yllcorner],  # 左下
        [xllcorner + ncols * cellsize, yllcorner],  # 右下
        [xllcorner + ncols * cellsize, yllcorner + nrows * cellsize],  # 右上
        [xllcorner, yllcorner + nrows * cellsize]  # 左上
    ]
    
    # 智能判断：如果坐标看起来已经是经纬度，就不转了
    # 经度通常在 -180 到 180 之间 (考虑 0-360 的表示法)
    # 纬度在 -90 到 90 之间
    is_geographic = (-180 <= xllcorner <= 360 and -90 <= yllcorner <= 90)
    
    if is_geographic:
         wgs84_coords = utm_coords
    else:
         epsg_code = None
         if tif_path:
             epsg_code = get_utm_epsg_from_tif(tif_path)
             if epsg_code:
                 print(f"Using EPSG from TIF for bounds calculation: {epsg_code}")
                 # Update global default so subsequent calls (like processing) also use it
                 set_utm_epsg(epsg_code)
         
         wgs84_coords = [utm_to_wgs84(x, y, epsg_code) for x, y in utm_coords]

    lons, lats = [c[0] for c in wgs84_coords], [c[1] for c in wgs84_coords]
    
    return {
        **data,
        'coordinates': wgs84_coords,
        'min_lon': min(lons), 'max_lon': max(lons),
        'min_lat': min(lats), 'max_lat': max(lats),
        'utm_coordinates': utm_coords
    }

def sample_elevation(bounds_info, target_height=3500.0):
    """将高程数据采样到指定高度，返回用于Cesium显示的采样点数据"""
    elevation_array = bounds_info['elevation_array']
    ncols, nrows = bounds_info['ncols'], bounds_info['nrows']
    cellsize = bounds_info['cellsize']
    xllcorner, yllcorner = bounds_info['xllcorner'], bounds_info['yllcorner']
    nodata_value = bounds_info['nodata_value']
    
    sample_interval = max(1, smart_round_coordinate(20.0 / cellsize, 'nearest'))
    sample_points = []
    
    for i in range(0, nrows, sample_interval):
        for j in range(0, ncols, sample_interval):
            elevation = elevation_array[i, j]
            if elevation != nodata_value and not np.isnan(elevation):
                lon, lat = array_index_to_wgs84(i, j, nrows, xllcorner, yllcorner, cellsize)
                sample_points.append({
                    'longitude': lon,
                    'latitude': lat,
                    'height': target_height,
                    'elevation': elevation
                })
    
    return {
        'sample_points': sample_points,
        'sample_count': len(sample_points),
        'target_height': target_height
    }

def calculate_slope(elevation_array, cellsize=1, no_data_values=[0, 9999, -9999]):
    """计算坡度"""
    elevation_array = np.asarray(elevation_array, dtype=np.float64)
    mask = np.isin(elevation_array, no_data_values)
    data = elevation_array.copy()
    data[mask] = np.nan
    dy, dx = np.gradient(data, cellsize, cellsize)
    slope_degrees = np.degrees(np.arctan(np.sqrt(dx ** 2 + dy ** 2)))
    slope_degrees[mask] = np.nan
    return slope_degrees

def calculate_roughness_from_slope(elevation_array, cellsize=1, no_data_values=[0, 9999, -9999]):
    """基于坡度计算地面粗糙度，并归一化到(0, 1)之间"""
    slope_degrees = calculate_slope(elevation_array, cellsize, no_data_values)
    slope_radians = slope_degrees * np.pi / 180
    roughness = 1/np.cos(slope_radians)
    roughness[np.isnan(slope_radians)] = np.nan
    roughness[slope_degrees >= 89] = 1
    
    # 归一化到(0, 1)之间
    valid_mask = ~np.isnan(roughness)
    if np.any(valid_mask):
        valid_values = roughness[valid_mask]
        min_val = np.min(valid_values)
        max_val = np.max(valid_values)
        
        if max_val > min_val:
            # 线性归一化: (x - min) / (max - min)
            roughness[valid_mask] = (valid_values-min_val) / (max_val - min_val)
        else:
            roughness[valid_mask] = 0.5
    
    return roughness

def get_roughness_statistics(roughness_array):
    """获取粗糙度统计信息"""
    valid_values = roughness_array[~np.isnan(roughness_array)]
    if len(valid_values) == 0:
        return None
    return {
        'valid_count': len(valid_values),
        'min': np.min(valid_values),
        'max': np.max(valid_values),
        'mean': np.mean(valid_values),
        'std': np.std(valid_values),
        'median': np.median(valid_values)
    }

def trace_boundary_contour(boundary_set, nrows, ncols):
    """
    轮廓跟踪算法：从边界点集合中，按照轮廓顺序排列边界点
    使用Moore邻域跟踪算法（Moore neighborhood tracing）
    返回按顺序排列的边界点索引列表
    """
    if len(boundary_set) == 0:
        return []
    
    # 找到最左上角的边界点作为起始点（i最小，j最小）
    start_i, start_j = min(boundary_set, key=lambda x: (x[0], x[1]))    # 8邻域方向（顺时针）：上、右上、右、右下、下、左下、左、左上
    directions = [(-1, 0), (-1, 1), (0, 1), (1, 1), (1, 0), (1, -1), (0, -1), (-1, -1)]
    contour = []
    visited = set()
    current_i, current_j = start_i, start_j
    # 初始方向：从右上方开始搜索（顺时针方向）
    start_direction = 1
    
    max_iterations = len(boundary_set) * 2  # 防止无限循环
    iteration = 0
    
    while iteration < max_iterations:
        iteration += 1
        
        # 如果当前点已经在轮廓中（除了第一个点），说明已经形成闭环
        if (current_i, current_j) in visited and len(contour) > 0:
            break
        
        visited.add((current_i, current_j))
        contour.append((current_i, current_j))
        
        # 从当前方向开始，顺时针搜索下一个边界点
        found_next = False
        for offset in range(8):
            direction_idx = (start_direction + offset) % 8
            di, dj = directions[direction_idx]
            next_i, next_j = current_i + di, current_j + dj
            
            # 检查下一个点是否在边界点集合中
            if (next_i, next_j) in boundary_set:
                # 如果这个点还没有被访问过，或者是起始点（形成闭环）
                if (next_i, next_j) not in visited or (next_i, next_j) == (start_i, start_j):
                    current_i, current_j = next_i, next_j
                    # 下一个搜索方向是当前方向的反方向的前一个方向（顺时针）
                    start_direction = (direction_idx + 6) % 8
                    found_next = True
                    break
        
        if not found_next:
            # 如果找不到下一个点，尝试找到最近的未访问边界点
            unvisited = boundary_set - visited
            if unvisited:
                # 找到距离当前点最近的未访问边界点
                nearest = min(unvisited, key=lambda p: abs(p[0] - current_i) + abs(p[1] - current_j))
                current_i, current_j = nearest
                start_direction = 1  # 重置方向
            else:
                break
    
    # 如果还有未访问的边界点，按距离添加到轮廓中
    remaining = boundary_set - set(contour)
    if remaining:
        # 对于剩余的边界点，按照距离已排序点的距离插入
        for point in remaining:
            # 找到插入位置（距离最近的点之后）
            min_dist = float('inf')
            insert_idx = len(contour)
            for idx, ordered_point in enumerate(contour):
                dist = abs(point[0] - ordered_point[0]) + abs(point[1] - ordered_point[1])
                if dist < min_dist:
                    min_dist = dist
                    insert_idx = idx + 1
            contour.insert(insert_idx, point)
    return contour

def get_boundary_roughness_values(roughness_file_path, num_points=20):
    """获取边界上的粗糙值采样点（边界为最边缘的非-9999、9999值的点，按轮廓顺序排列）"""
    data = read_ascii_file(roughness_file_path)
    roughness_array = data['elevation_array']
    ncols, nrows = data['ncols'], data['nrows']
    cellsize = data['cellsize']
    xllcorner, yllcorner = data['xllcorner'], data['yllcorner']
    nodata_value = data['nodata_value']
    
    nodata_values = [nodata_value, -9999, 9999]
    valid_mask = create_valid_mask(roughness_array, nodata_values)
    boundary_indices_set = find_boundary_points(valid_mask, nrows, ncols)
    if len(boundary_indices_set) == 0:
        return []
    ordered_boundary_indices = trace_boundary_contour(boundary_indices_set, nrows, ncols)
    if num_points > 0 and len(ordered_boundary_indices) > num_points:
        step = len(ordered_boundary_indices) / num_points
        ordered_boundary_indices = [ordered_boundary_indices[int(i * step)] for i in range(num_points) 
                                   if int(i * step) < len(ordered_boundary_indices)]
    boundary_points = []
    for i, j in ordered_boundary_indices:
        lon, lat = array_index_to_wgs84(i, j, nrows, xllcorner, yllcorner, cellsize)
        boundary_points.append({
            'longitude': lon,
            'latitude': lat,
            'roughness': float(roughness_array[i, j])
        })
    return boundary_points
def ascii_to_roughness_slope_based(ascii_file_path, output_file_path, return_bounds=False, sample_height=3500.0, tif_path=None):
    """计算粗糙度并可选地返回边界信息"""
    data = read_ascii_file(ascii_file_path)
    elevation_array = data['elevation_array']
    ncols, nrows = data['ncols'], data['nrows']
    cellsize = data['cellsize']
    nodata_value = data['nodata_value']
    
    roughness_array = calculate_roughness_from_slope(
        elevation_array,
        cellsize=cellsize,
        no_data_values=[0, 9999, -9999, nodata_value]
    )
    
    with open(output_file_path, 'w', encoding='utf-8') as f:
        f.write(f"ncols {ncols}\n")
        f.write(f"nrows {nrows}\n")
        f.write(f"xllcorner {data['xllcorner']}\n")
        f.write(f"yllcorner {data['yllcorner']}\n")
        f.write(f"cellsize {cellsize}\n")
        f.write(f"NODATA_value {nodata_value}\n")
        
        for i in range(nrows):
            row_data = roughness_array[i, :]
            formatted_values = [
                f"{int(nodata_value)}" if np.isnan(x) else f"{x:.6f}"
                for x in row_data
            ]
            f.write(" ".join(formatted_values) + "\n")
    
    if return_bounds:
        bounds_info = calculate_ascii_bounds(ascii_file_path, tif_path=tif_path)
        sample_info = sample_elevation(bounds_info, target_height=sample_height)
        return roughness_array, bounds_info, sample_info
    return roughness_array

def get_line_segment_grid_points(start_coord, end_coord, cellsize, xllcorner, yllcorner, ncols, nrows):
    """
    获取连接两个坐标点的线段上的采样点行列号（只记录起点、采样点和终点）
    """
    # 将坐标转换为UTM (注意：这里假设外部已经处理好了global projection或者这里调用就是正确的)
    # 由于该函数会被 get_ascii_values_by_coordinates 调用，而那里已经处理了 epsg/tif
    start_utm_x, start_utm_y = wgs84_to_utm(start_coord['lon'], start_coord['lat'])
    end_utm_x, end_utm_y = wgs84_to_utm(end_coord['lon'], end_coord['lat'])

    # 计算两个点之间的距离和方向
    dx = end_utm_x - start_utm_x
    dy = end_utm_y - start_utm_y
    distance = np.sqrt(dx**2 + dy**2)

    if distance == 0:
        # 两个点重合，只返回一个点
        col = int((start_utm_x - xllcorner) / cellsize)
        row_from_south = int((start_utm_y - yllcorner) / cellsize)
        return [(col, row_from_south)]

    # 计算采样间隔（采样距离为cellsize）
    num_samples = max(1, int(distance / cellsize))

    grid_points = set()  # 使用集合去重

    # 1. 始终包含起点
    col_start = int((start_utm_x - xllcorner) / cellsize)
    row_start = int((start_utm_y - yllcorner) / cellsize)
    if 0 <= col_start < ncols and 0 <= row_start < nrows:
        grid_points.add((col_start, row_start))

    # 2. 按照cellsize距离间隔添加采样点
    for i in range(1, num_samples + 1):
        # 计算采样距离
        sample_distance = i * cellsize
        if sample_distance >= distance:
            break

        # 线性插值计算采样点
        t = sample_distance / distance
        sample_x = start_utm_x + t * dx
        sample_y = start_utm_y + t * dy

        # 计算网格行列号
        col = int((sample_x - xllcorner) / cellsize)
        row_from_south = int((sample_y - yllcorner) / cellsize)

        # 检查是否在有效范围内
        if 0 <= col < ncols and 0 <= row_from_south < nrows:
            grid_points.add((col, row_from_south))

    # 3. 始终包含终点
    col_end = int((end_utm_x - xllcorner) / cellsize)
    row_end = int((end_utm_y - yllcorner) / cellsize)
    if 0 <= col_end < ncols and 0 <= row_end < nrows:
        grid_points.add((col_end, row_end))

    return list(grid_points)

def get_ascii_values_by_coordinates(ascii_file_path, coordinates, output_txt_path, tif_path=None):
    """
    根据坐标从ASCII文件中获取行列号并输出到txt文件，只记录画线区域内格网点上的坐标
    """
    try:
        # 如果提供了TIF文件，优先从TIF获取投影信息
        if tif_path:
            epsg_code = get_utm_epsg_from_tif(tif_path)
            if epsg_code:
                print(f"Using EPSG from TIF for values calculation: {epsg_code}")
                set_utm_epsg(epsg_code)

        # 读取ASCII文件
        data = read_ascii_file(ascii_file_path)
        ncols, nrows = data['ncols'], data['nrows']
        cellsize = data['cellsize']
        xllcorner, yllcorner = data['xllcorner'], data['yllcorner']
        elevation_array = data['elevation_array']
        nodata_value = data['nodata_value']

        output_data = []
        valid_count = 0
        
        # 收集所有网格点 (使用 segment 逻辑)
        all_grid_points = set()

        if len(coordinates) > 1:
            # 只有当有多个点时才进行线段插值
            for i in range(len(coordinates) - 1):
                start_coord = coordinates[i]
                end_coord = coordinates[i + 1]
                
                # 获取线段经过的网格点
                segment_points = get_line_segment_grid_points(
                    start_coord, end_coord, cellsize, xllcorner, yllcorner, ncols, nrows
                )
                all_grid_points.update(segment_points)
        elif len(coordinates) == 1:
             # 单点处理
             coords = get_line_segment_grid_points(
                    coordinates[0], coordinates[0], cellsize, xllcorner, yllcorner, ncols, nrows
                )
             all_grid_points.update(coords)

        # 转换为列表并排序 (参考提供的代码逻辑)
        grid_points_list = sorted(list(all_grid_points))

        for col, row_from_south in grid_points_list:
            # 计算数组中的行索引（考虑y轴翻转）
            # 数组i=0对应北边
            row = nrows - 1 - row_from_south

            # 检查坐标是否在有效范围内
            if 0 <= row < nrows and 0 <= col < ncols:
                # 进一步检查该位置是否有有效值（非nodata且非NaN）
                elevation_value = elevation_array[row, col]
                if elevation_value != nodata_value and not np.isnan(elevation_value):
                    # 只有当该位置有有效值时才记录行列号
                    # 注意：参考代码输出的是 row_from_south (南起索引)，我们保持一致
                    output_data.append(f"{col} {row_from_south}\n")
                    valid_count += 1
                else:
                    # 该位置是nodata值或NaN，标记为无效
                    output_data.append(f"-00 -00\n")
            else:
                # 如果坐标超出范围，输出-1,-1 (或 -00,-00) 表示无效
                output_data.append(f"-00 -00\n")
        
        # 写入输出文件
        with open(output_txt_path, 'w', encoding='utf-8') as f:
            f.write(f"{valid_count}\n")  # 第一行写入有效行列号总数
            f.writelines(output_data)
        
        return True
    except Exception as e:
        print(f"获取ASCII行列号失败: {str(e)}")
        import traceback
        traceback.print_exc()
        return False

def get_line_segment_grid_points(start_coord, end_coord, cellsize, xllcorner, yllcorner, ncols, nrows):
    """
    获取连接两个坐标点的线段上的采样点行列号（只记录起点、采样点和终点）

    参数:
        start_coord: 起始坐标 {'lon': lon, 'lat': lat}
        end_coord: 结束坐标 {'lon': lon, 'lat': lat}
        cellsize: 网格大小（同时作为采样距离）
        xllcorner, yllcorner: 左下角坐标
        ncols, nrows: 列数和行数

    返回:
        线段上的关键网格点行列号列表 [(col, row), ...]
        只包含：起点、每隔cellsize距离的采样点、终点
    """
    # 判断ASCII是否为地理坐标(经纬度)而非UTM投影
    is_geographic = (
        -360 <= xllcorner <= 360 and
        -90 <= yllcorner <= 90 and
        cellsize <= 1
    )

    # 将坐标转换为UTM或直接使用经纬度
    if is_geographic:
        start_utm_x, start_utm_y = start_coord['lon'], start_coord['lat']
        end_utm_x, end_utm_y = end_coord['lon'], end_coord['lat']
    else:
        start_utm_x, start_utm_y = wgs84_to_utm(start_coord['lon'], start_coord['lat'])
        end_utm_x, end_utm_y = wgs84_to_utm(end_coord['lon'], end_coord['lat'])

    # 计算两个点之间的距离和方向
    dx = end_utm_x - start_utm_x
    dy = end_utm_y - start_utm_y
    distance = np.sqrt(dx**2 + dy**2)

    if distance == 0:
        # 两个点重合，只返回一个点
        col = smart_round_coordinate((start_utm_x - xllcorner) / cellsize, 'nearest')
        row_from_south = smart_round_coordinate((start_utm_y - yllcorner) / cellsize, 'nearest')
        return [(col, row_from_south)]

    # 计算采样间隔（采样距离为cellsize）
    num_samples = max(1, smart_round_coordinate(distance / cellsize, 'nearest'))

    grid_points = set()  # 使用集合去重，只记录起点、采样点和终点

    # 1. 始终包含起点
    col_start = smart_round_coordinate((start_utm_x - xllcorner) / cellsize, 'nearest')
    row_start = smart_round_coordinate((start_utm_y - yllcorner) / cellsize, 'nearest')
    if 0 <= col_start < ncols and 0 <= row_start < nrows:
        grid_points.add((col_start, row_start))

    # 2. 按照cellsize距离间隔添加采样点
    for i in range(1, num_samples + 1):
        # 计算采样距离
        sample_distance = i * cellsize
        if sample_distance >= distance:
            break

        # 线性插值计算采样点
        t = sample_distance / distance
        sample_x = start_utm_x + t * dx
        sample_y = start_utm_y + t * dy

        # 计算网格行列号
        col = smart_round_coordinate((sample_x - xllcorner) / cellsize, 'nearest')
        row_from_south = smart_round_coordinate((sample_y - yllcorner) / cellsize, 'nearest')

        # 检查是否在有效范围内
        if 0 <= col < ncols and 0 <= row_from_south < nrows:
            grid_points.add((col, row_from_south))

    # 3. 始终包含终点
    col_end = smart_round_coordinate((end_utm_x - xllcorner) / cellsize, 'nearest')
    row_end = smart_round_coordinate((end_utm_y - yllcorner) / cellsize, 'nearest')
    if 0 <= col_end < ncols and 0 <= row_end < nrows:
        grid_points.add((col_end, row_end))

    return list(grid_points)

def get_ascii_values_by_line_segments(ascii_file_path, coordinates, output_txt_path):
    """
    根据坐标连线段获取线段经过的所有网格点行列号并输出到txt文件

    参数:
        ascii_file_path: ASCII文件路径
        coordinates: 坐标列表，每个元素包含 {'lon': lon, 'lat': lat}
        output_txt_path: 输出txt文件路径
    """
    try:
        # 读取ASCII文件
        data = read_ascii_file(ascii_file_path)
        ncols, nrows = data['ncols'], data['nrows']
        cellsize = data['cellsize']
        xllcorner, yllcorner = data['xllcorner'], data['yllcorner']
        elevation_array = data['elevation_array']
        nodata_value = data['nodata_value']

        all_grid_points = set()  # 使用集合存储所有唯一的网格点

        # 处理每条线段
        for i in range(len(coordinates) - 1):
            start_coord = coordinates[i]
            end_coord = coordinates[i + 1]

            # 获取线段经过的网格点
            segment_points = get_line_segment_grid_points(
                start_coord, end_coord, cellsize, xllcorner, yllcorner, ncols, nrows
            )

            # 将这些点添加到总集合中
            all_grid_points.update(segment_points)

        # 转换为列表并排序（可选）
        grid_points_list = sorted(list(all_grid_points))

        output_data = []
        valid_count = 0

        for col, row_from_south in grid_points_list:
            # 计算数组中的行索引（考虑y轴翻转）
            row = nrows - 1 - row_from_south

            # 检查该位置是否有有效值
            if 0 <= row < nrows and 0 <= col < ncols:
                elevation_value = elevation_array[row, col]
                if elevation_value != nodata_value and not np.isnan(elevation_value):
                    # 交换行列顺序输出为 row,col
                    output_data.append(f"{row_from_south},{col}\n")
                    valid_count += 1
                else:
                    # 该位置是nodata值或NaN，标记为无效
                    output_data.append(f"-00,-00\n")
            else:
                # 超出范围，标记为无效
                output_data.append(f"-00,-00\n")

        # 写入输出文件
        # 输出文件扩展名调整为 .dat
        output_path = output_txt_path
        if not output_path.lower().endswith('.dat'):
            output_path = f"{output_path.rsplit('.', 1)[0]}.dat" if '.' in output_path else f"{output_path}.dat"

        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(f"{valid_count}\n")  # 第一行写入有效行列号总数
            f.writelines(output_data)

        return True
    except Exception as e:
        print(f"获取线段ASCII行列号失败: {str(e)}")
        import traceback
        traceback.print_exc()
        return False

def point_in_polygon(point_x, point_y, polygon):
    """
    判断点是否在多边形内（射线法）
    
    参数:
        point_x: 点的x坐标（经度或UTM X）
        point_y: 点的y坐标（纬度或UTM Y）
        polygon: 多边形顶点列表，每个元素为 [x, y] 或 {'lon': lon, 'lat': lat}
    
    返回:
        True表示点在多边形内，False表示点在多边形外
    """
    n = len(polygon)
    if n < 3:
        return False
    
    inside = False
    j = n - 1
    
    for i in range(n):
        # 获取当前顶点坐标
        if isinstance(polygon[i], (list, tuple)) and len(polygon[i]) >= 2:
            xi, yi = polygon[i][0], polygon[i][1]
        elif isinstance(polygon[i], dict):
            xi = polygon[i].get('lon', polygon[i].get('x', 0))
            yi = polygon[i].get('lat', polygon[i].get('y', 0))
        else:
            j = i
            continue
            
        # 获取前一个顶点坐标
        if isinstance(polygon[j], (list, tuple)) and len(polygon[j]) >= 2:
            xj, yj = polygon[j][0], polygon[j][1]
        elif isinstance(polygon[j], dict):
            xj = polygon[j].get('lon', polygon[j].get('x', 0))
            yj = polygon[j].get('lat', polygon[j].get('y', 0))
        else:
            j = i
            continue
        
        # 射线法判断：从点向右发射一条射线，计算与多边形边的交点数
        # 检查边是否与水平射线相交
        if ((yi > point_y) != (yj > point_y)):
            # 计算射线与边的交点的x坐标
            if yj != yi:  # 避免除零
                intersect_x = (xj - xi) * (point_y - yi) / (yj - yi) + xi
                if point_x < intersect_x:
                    inside = not inside
        
        j = i
    
    return inside

def clip_ascii_by_polygon(ascii_file_path, polygon_coordinates, output_file_path):
    """
    使用多边形处理ASCII文件：多边形内的值保留，多边形外的值设置为9999

    参数:
        ascii_file_path: 输入ASCII文件路径
        polygon_coordinates: 多边形顶点坐标列表，每个元素为 {'lon': lon, 'lat': lat}
        output_file_path: 输出ASCII文件路径
    """
    try:
        # 读取ASCII文件
        data = read_ascii_file(ascii_file_path)
        elevation_array = data['elevation_array']
        ncols, nrows = data['ncols'], data['nrows']
        cellsize = data['cellsize']
        xllcorner, yllcorner = data['xllcorner'], data['yllcorner']
        nodata_value = data['nodata_value']

        # 将多边形坐标从WGS84转换为UTM坐标
        polygon_utm = []
        for coord in polygon_coordinates:
            lon, lat = coord.get('lon', coord.get('x', 0)), coord.get('lat', coord.get('y', 0))
            utm_x, utm_y = wgs84_to_utm(lon, lat)
            polygon_utm.append([utm_x, utm_y])
        
        # 创建输出数组（复制原数组）
        output_array = elevation_array.copy()
        
        # 遍历每个像素点，判断是否在多边形内
        print(f"开始处理 {nrows} x {ncols} 的ASCII文件...")
        total_pixels = nrows * ncols
        processed = 0
        
        for i in range(nrows):
            for j in range(ncols):
                # 计算当前像素的UTM坐标
                utm_x = xllcorner + j * cellsize + cellsize / 2
                utm_y = yllcorner + (nrows - 1 - i) * cellsize + cellsize / 2
                
                is_inside = point_in_polygon(utm_x, utm_y, polygon_utm)
                
                # 如果点不在多边形内，且当前值不是nodata，则设置为9999
                if not is_inside:
                    current_value = elevation_array[i, j]
                    if current_value != nodata_value and not np.isnan(current_value):
                        output_array[i, j] = 9999
                
                processed += 1
                if processed % 10000 == 0:
                    progress = (processed / total_pixels) * 100
                
        
        # 写入输出文件
        with open(output_file_path, 'w', encoding='utf-8') as f:
            f.write(f"ncols {ncols}\n")
            f.write(f"nrows {nrows}\n")
            f.write(f"xllcorner {xllcorner}\n")
            f.write(f"yllcorner {yllcorner}\n")
            f.write(f"cellsize {cellsize}\n")
            f.write(f"NODATA_value {nodata_value}\n")
            
            for i in range(nrows):
                row_data = output_array[i, :]
                formatted_values = [
                    f"{int(nodata_value)}" if np.isnan(x) or x == nodata_value else f"{x:.6f}"
                    for x in row_data
                ]
                f.write(" ".join(formatted_values) + "\n")
        
        print(f"完成，输出文件: {output_file_path}")
        return True
        
    except Exception as e:
        print(f"失败: {str(e)}")
        import traceback
        traceback.print_exc()
        return False
