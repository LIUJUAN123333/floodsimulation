
import math
from typing import Tuple, List, Optional

class MapCoordinateConverter:
 
    def __init__(self, origin_x: float, origin_y: float, tile_size: int = 256):
      
        self.origin_x = origin_x
        self.origin_y = origin_y
        self.tile_size = tile_size
    
        self.level_resolutions = {
            0: 156543.03392800014,
            1: 78271.51696399994,
            2: 39135.75848200009,
            3: 19567.87924099992,
            4: 9783.93962049996,
            5: 4891.96981024998,
            6: 2445.98490512499,
            7: 1222.992452562495,
            8: 611.4962262813797,
            9: 305.74811314055756,
            10: 152.87405657041106,
            11: 76.43702828507324,
            12: 38.21851414253662,
            13: 19.10925707126831,
            14: 9.554628535634155,
            15: 4.77731426794937,
            16: 2.388657133974685,
            17: 1.1943285668550503,
            18: 0.5971642835598172,
            19: 0.29858214164761665
        }
    
    def get_resolution(self, level: int) -> float:
        if level in self.level_resolutions:
            return self.level_resolutions[level]
        else:
            # 如果级别超出预定义范围，使用公式计算
            return 156543.03392800014 / (2 ** level)
    
    def calculate_center_geo_point(self, geo_min_x: float, geo_max_x: float, 
                                 geo_min_y: float, geo_max_y: float) -> Tuple[float, float]:
        center_x = (geo_min_x + geo_max_x) / 2
        center_y = (geo_min_y + geo_max_y) / 2
        return center_x, center_y
    
    def calculate_nearest_level(self, geo_min_x: float, geo_max_x: float,
                              geo_min_y: float, geo_max_y: float,
                              canvas_width: int, canvas_height: int) -> int:
        # 计算地理范围的实际大小
        geo_width = geo_max_x - geo_min_x
        geo_height = geo_max_y - geo_min_y
        
        # 计算本需求的瓦片实际大小
        tile_count_x = canvas_width / self.tile_size
        tile_count_y = canvas_height / self.tile_size
        
        required_tile_size_x = geo_width / tile_count_x
        required_tile_size_y = geo_height / tile_count_y
        
        # 取较大的值作为参考
        required_tile_size = max(required_tile_size_x, required_tile_size_y)
        
        # 遍历所有级别，找到最接近的
        min_diff = float('inf')
        nearest_level = 0
        
        for level, resolution in self.level_resolutions.items():
            actual_tile_size = resolution * self.tile_size
            diff = abs(actual_tile_size - required_tile_size)
            
            if diff < min_diff:
                min_diff = diff
                nearest_level = level
        
        return nearest_level
    
    def calculate_screen_geo_bounds(self, center_x: float, center_y: float,
                                  level: int, canvas_width: int, canvas_height: int) -> Tuple[float, float, float, float]:
        resolution = self.get_resolution(level)
        
        # 计算屏幕范围对应的地理范围
        half_width = (resolution * canvas_width) / 2
        half_height = (resolution * canvas_height) / 2
        
        min_x = center_x - half_width
        max_x = center_x + half_width
        min_y = center_y - half_height
        max_y = center_y + half_height
        
        return min_x, min_y, max_x, max_y
    
    def calculate_tile_bounds(self, min_x: float, min_y: float, max_x: float, max_y: float,
                            level: int) -> Tuple[int, int, int, int, float, float, float, float]:
        resolution = self.get_resolution(level)
        cur_level_clip_length = resolution * self.tile_size
        
        # 5.2.4.1 计算瓦片起始行列号
        fixed_tile_left_top_num_x = math.floor((abs(self.origin_x - min_x)) / resolution * self.tile_size)
        fixed_tile_left_top_num_y = math.floor((abs(self.origin_y - max_y)) / resolution * self.tile_size)
        
        # 5.2.4.2 计算实际地理范围
        real_min_x = fixed_tile_left_top_num_x * cur_level_clip_length + self.origin_x
        real_max_y = self.origin_y - fixed_tile_left_top_num_y * cur_level_clip_length
        
        # 5.2.4.3 计算左上角偏移像素
        offset_x = (real_min_x - min_x) / resolution
        offset_y = (max_y - real_max_y) / resolution
        
        # 5.2.4.4 计算X、Y轴上的瓦片个数
        canvas_width = max_x - min_x
        canvas_height = max_y - min_y
        map_x_clip_num = math.ceil((canvas_width + abs(offset_x)) / self.tile_size)
        map_y_clip_num = math.ceil((canvas_height + abs(offset_y)) / self.tile_size)
        
        return (fixed_tile_left_top_num_x, fixed_tile_left_top_num_y, 
                map_x_clip_num, map_y_clip_num, real_min_x, real_max_y, offset_x, offset_y)
    
    def screen_to_geo(self, screen_x: float, screen_y: float, 
                     canvas_width: int, canvas_height: int,
                     geo_min_x: float, geo_max_x: float,
                     geo_min_y: float, geo_max_y: float,
                     level: Optional[int] = None) -> Tuple[float, float]:
        # 如果没有指定级别，自动计算最合适的级别
        if level is None:
            level = self.calculate_nearest_level(geo_min_x, geo_max_x, geo_min_y, geo_max_y, 
                                              canvas_width, canvas_height)
        # 计算屏幕范围对应的地理范围
        center_x, center_y = self.calculate_center_geo_point(geo_min_x, geo_max_x, geo_min_y, geo_max_y)
        screen_min_x, screen_min_y, screen_max_x, screen_max_y = self.calculate_screen_geo_bounds(
            center_x, center_y, level, canvas_width, canvas_height)
        
        # 计算分辨率
        resolution = self.get_resolution(level)
        
        # 转换坐标
        geo_x = screen_min_x + (screen_x / canvas_width) * (screen_max_x - screen_min_x)
        geo_y = screen_max_y - (screen_y / canvas_height) * (screen_max_y - screen_min_y)
        
        return geo_x, geo_y
    
    
    def calculate_line_tiles(self, point1_screen: Tuple[float, float], point2_screen: Tuple[float, float],
                           canvas_width: int, canvas_height: int,
                           geo_min_x: float, geo_max_x: float,
                           geo_min_y: float, geo_max_y: float,
                           level: Optional[int] = None) -> List[Tuple[int, int]]:
        # 如果没有指定级别，自动计算最合适的级别
        if level is None:
            level = self.calculate_nearest_level(geo_min_x, geo_max_x, geo_min_y, geo_max_y, 
                                              canvas_width, canvas_height)
        
        # 将屏幕坐标转换为地理坐标
        geo1_x, geo1_y = self.screen_to_geo(point1_screen[0], point1_screen[1], 
                                           canvas_width, canvas_height,
                                           geo_min_x, geo_max_x, geo_min_y, geo_max_y, level)
        geo2_x, geo2_y = self.screen_to_geo(point2_screen[0], point2_screen[1], 
                                           canvas_width, canvas_height,
                                           geo_min_x, geo_max_x, geo_min_y, geo_max_y, level)
        
        # 计算瓦片相关参数
        center_x, center_y = self.calculate_center_geo_point(geo_min_x, geo_max_x, geo_min_y, geo_max_y)
        screen_min_x, screen_min_y, screen_max_x, screen_max_y = self.calculate_screen_geo_bounds(
            center_x, center_y, level, canvas_width, canvas_height)
        
        self.calculate_tile_bounds(
            screen_min_x, screen_min_y, screen_max_x, screen_max_y, level)
        
        resolution = self.get_resolution(level)
        cur_level_clip_length = resolution * self.tile_size
        
        # 计算起点和终点的瓦片行列号
        start_tile_x = math.floor((geo1_x - self.origin_x) / cur_level_clip_length)
        start_tile_y = math.floor((self.origin_y - geo1_y) / cur_level_clip_length)
        end_tile_x = math.floor((geo2_x - self.origin_x) / cur_level_clip_length)
        end_tile_y = math.floor((self.origin_y - geo2_y) / cur_level_clip_length)
        
        tiles = []

        dx = abs(end_tile_x - start_tile_x)
        dy = abs(end_tile_y - start_tile_y)

        step_x = 1 if start_tile_x < end_tile_x else -1
        step_y = 1 if start_tile_y < end_tile_y else -1
  
        x, y = start_tile_x, start_tile_y
        tiles.append((y, x))  # 注意：行列号顺序为(row, col)
        
        if dx > dy:
            # 斜率小于1
            error = 2 * dy - dx
            for _ in range(dx):
                if error >= 0:
                    y += step_y
                    error -= 2 * dx
                x += step_x
                error += 2 * dy
                tiles.append((y, x))
        else:
            # 斜率大于等于1
            error = 2 * dx - dy
            for _ in range(dy):
                if error >= 0:
                    x += step_x
                    error -= 2 * dy
                y += step_y
                error += 2 * dx
                tiles.append((y, x))
        
        return tiles

default_converter = MapCoordinateConverter(
    origin_x=-20037508.34,  # 可以根据实际地图调整
    origin_y= 20037508.34,  # 可以根据实际地图调整
    tile_size=256
)
