import os
from flask import Flask, render_template, request, jsonify, send_file, send_from_directory, Response, stream_with_context
from werkzeug.utils import secure_filename
from datetime import datetime
import rasterio
from rasterio.warp import transform
import math
import xml.etree.ElementTree as ET
# 导入现有的处理模块
from ASC文件获取粗糙度 import ascii_to_roughness_slope_based, calculate_ascii_bounds, get_boundary_roughness_values, get_ascii_values_by_coordinates, clip_ascii_by_polygon, set_utm_epsg, get_utm_epsg_from_tif
from TIFF转ASC格式 import dem_to_ascii_gdal
from 地图瓦片行列号 import MapCoordinateConverter
app = Flask(__name__)
app.config['SECRET_KEY'] = 'your-secret-key-here'
app.config['MAX_CONTENT_LENGTH'] = 2000 * 1024 * 1024  # 2000MB max file size
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['OUTPUT_FOLDER'] = 'outputs'

@app.after_request
def add_cors_headers(response):
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization'
    return response

# 确保上传和输出文件夹存在
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
os.makedirs(app.config['OUTPUT_FOLDER'], exist_ok=True)

SHOWCASE_ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'data_showcase'))
SHOWCASE_CASES = {
    'jinshajiang': {
        'name': '金沙江',
        'directory': os.path.join(SHOWCASE_ROOT, 'jinshajiang'),
        'utm_zone': 47,
        'asc_file': None,
        'xml_file': 'Flood_New.xml',
        'json_base_dir': '',
        'center': {
            'lon': 98.6877608534,
            'lat': 31.0793427182,
            'height': 0
        },
        # 无 ASC 案例使用局部原点锚点；这里按米调整锚点：east 向东，north 向北，up 向上。
        'anchor_offset': {
            'east': 1450,
            'north': -350,
            'up': 0
        },
        'camera_center': {
            'lon': 98.751219,
            'lat': 31.042324,
            'height': 30000
        },
        'heading_offset_degrees': 0,
        'cell_size': 20
    },
    'xiaojiaqiao': {
        'name': '肖家桥',
        'directory': os.path.join(SHOWCASE_ROOT, 'xiaojiaqiao'),
        'utm_zone': 48,
        'asc_file': 'CCC (1).asc',
        'xml_file': 'Flood_New.xml'
    },
    'bonn': {
        'name': '德国波恩',
        'directory': os.path.join(SHOWCASE_ROOT, 'Bonn'),
        'utm_zone': 32,
        'asc_file': None,
        'xml_file': 'Flood_New.xml',
        'json_base_dir': '',
        # Flood1 与 Flood481 是该批波恩数据中的异常帧：首帧接近最大淹没、末帧又突然回落。
        # 案例演示按连续演进段 Flood2-Flood480 播放，避免开头/结尾突跳。
        'exclude_flood_files': {'flood1.json', 'flood481.json'},
        'center': {
            'lon': 7.0982,
            'lat': 50.7374,
            'height': 0
        },
        'anchor_offset': {
            'east': 0,
            'north': 0,
            'up': 0
        },
        'heading_offset_degrees': 0,
        'cell_size': 20
    }
}
SHOWCASE_ALLOWED_EXTENSIONS = {'.asc', '.xml', '.json'}


def get_showcase_case(case_id):
    case_config = SHOWCASE_CASES.get(case_id)
    if not case_config:
        return None, jsonify({'success': False, 'message': '未知案例'}), 404

    case_dir = os.path.abspath(case_config['directory'])
    if not os.path.isdir(case_dir):
        return None, jsonify({'success': False, 'message': f'案例目录不存在: {case_dir}'}), 404

    return {**case_config, 'directory': case_dir}, None, None


def get_showcase_file_path(case_config, filename):
    if not filename:
        return None

    normalized_filename = filename.replace('\\', '/')
    path_parts = normalized_filename.split('/')
    if normalized_filename in ('', '.', '..') or any(part in ('', '.', '..') for part in path_parts):
        return None

    extension = os.path.splitext(normalized_filename)[1].lower()
    if extension not in SHOWCASE_ALLOWED_EXTENSIONS:
        return None

    file_path = os.path.abspath(os.path.join(case_config['directory'], normalized_filename))
    case_dir = os.path.abspath(case_config['directory'])
    if os.path.commonpath([case_dir, file_path]) != case_dir:
        return None
    if not os.path.isfile(file_path):
        return None

    return file_path


def count_showcase_frames(xml_path):
    try:
        tree = ET.parse(xml_path)
        return len(tree.getroot().findall('.//flood'))
    except Exception:
        return 0


def get_showcase_xml_urls(xml_path):
    try:
        tree = ET.parse(xml_path)
        urls = []
        for flood in tree.getroot().findall('.//flood'):
            url = flood.get('url')
            if url:
                urls.append(url)
        return urls
    except Exception:
        return []


def get_existing_showcase_flood_urls(case_config, xml_path):
    return [entry['url'] for entry in get_existing_showcase_flood_entries(case_config, xml_path)]


def get_existing_showcase_flood_entries(case_config, xml_path):
    xml_dir = os.path.dirname(case_config['xml_file']).replace('\\', '/')
    json_base_dir = case_config.get('json_base_dir', xml_dir)
    excluded_flood_files = {
        filename.lower()
        for filename in case_config.get('exclude_flood_files', set())
    }
    existing_entries = []

    for url in get_showcase_xml_urls(xml_path):
        normalized_url = url.replace('\\', '/').lstrip('/')
        if not normalized_url:
            continue
        if os.path.basename(normalized_url).lower() in excluded_flood_files:
            continue

        if '/' in normalized_url or not json_base_dir:
            relative_path = normalized_url
        else:
            relative_path = f"{json_base_dir.rstrip('/')}/{normalized_url}"

        file_path = get_showcase_file_path(case_config, relative_path)
        if file_path:
            existing_entries.append({
                'url': url,
                'size': os.path.getsize(file_path)
            })

    return existing_entries


def get_showcase_anchor_offset(case_config):
    configured_offset = case_config.get('anchor_offset') or {}

    def parse_offset(name, fallback):
        value = request.args.get(name)
        if value is None:
            return fallback
        try:
            return float(value)
        except ValueError:
            return fallback

    return {
        'east': parse_offset('dx', float(configured_offset.get('east', 0))),
        'north': parse_offset('dy', float(configured_offset.get('north', 0))),
        'up': parse_offset('dz', float(configured_offset.get('up', 0)))
    }


def get_showcase_heading_offset(case_config):
    value = request.args.get('heading')
    if value is not None:
        try:
            return float(value)
        except ValueError:
            pass
    return float(case_config.get('heading_offset_degrees', 0))


@app.route('/api/showcase/<case_id>/manifest', methods=['GET'])
def get_showcase_manifest(case_id):
    case_config, error_response, status_code = get_showcase_case(case_id)
    if error_response:
        return error_response, status_code

    asc_file = case_config.get('asc_file')
    asc_path = get_showcase_file_path(case_config, asc_file) if asc_file else None
    xml_path = get_showcase_file_path(case_config, case_config['xml_file'])
    if (asc_file and not asc_path) or not xml_path:
        return jsonify({'success': False, 'message': '案例 ASC 或 XML 文件不存在'}), 404

    xml_dir = os.path.dirname(case_config['xml_file']).replace('\\', '/')
    flood_entries = get_existing_showcase_flood_entries(case_config, xml_path)
    flood_urls = [entry['url'] for entry in flood_entries]
    flood_frame_sizes = [entry['size'] for entry in flood_entries]
    xml_frame_count = count_showcase_frames(xml_path)
    excluded_flood_files = {
        filename.lower()
        for filename in case_config.get('exclude_flood_files', set())
    }
    excluded_json_count = sum(
        1
        for url in get_showcase_xml_urls(xml_path)
        if os.path.basename(url.replace('\\', '/').lstrip('/')).lower() in excluded_flood_files
    )

    return jsonify({
        'success': True,
        'caseId': case_id,
        'name': case_config['name'],
        'utmZone': case_config['utm_zone'],
        'ascFile': asc_file,
        'xmlFile': case_config['xml_file'],
        'xmlDir': xml_dir,
        'jsonBaseDir': case_config.get('json_base_dir', xml_dir),
        'center': case_config.get('center'),
        'cameraCenter': case_config.get('camera_center'),
        'anchorOffset': get_showcase_anchor_offset(case_config),
        'headingOffsetDegrees': get_showcase_heading_offset(case_config),
        'cellSize': case_config.get('cell_size'),
        'jsonCount': len(flood_urls),
        'xmlJsonCount': xml_frame_count,
        'missingJsonCount': max(xml_frame_count - len(flood_urls) - excluded_json_count, 0),
        'excludedJsonCount': excluded_json_count,
        'floodUrls': flood_urls,
        'floodFrameSizes': flood_frame_sizes,
        'totalJsonBytes': sum(flood_frame_sizes),
        'maxJsonBytes': max(flood_frame_sizes, default=0),
        'fileBaseUrl': f"{request.host_url.rstrip('/')}/api/showcase/{case_id}/file"
    })


@app.route('/api/showcase/<case_id>/file/<path:filename>', methods=['GET'])
def get_showcase_file(case_id, filename):
    case_config, error_response, status_code = get_showcase_case(case_id)
    if error_response:
        return error_response, status_code

    file_path = get_showcase_file_path(case_config, filename)
    if not file_path:
        return jsonify({'success': False, 'message': '文件不存在或不允许访问'}), 404

    response = send_file(file_path, conditional=True, max_age=3600)
    response.headers['Cache-Control'] = 'public, max-age=3600'
    return response

# 辅助函数：清理临时文件
def cleanup_file(file_path):
    """删除文件"""
    if file_path and os.path.exists(file_path):
        try:
            os.remove(file_path)
        except Exception:
            pass

# 辅助函数：获取粗糙度文件路径并验证
def get_roughness_file_path(roughness_filename):
    """获取粗糙度文件路径并验证文件是否存在"""
    if not roughness_filename:
        return None, jsonify({'success': False, 'message': '缺少粗糙度文件名'})
    file_path = os.path.join(app.config['OUTPUT_FOLDER'], roughness_filename)
    if not os.path.exists(file_path):
        return None, jsonify({'success': False, 'message': '粗糙度文件不存在'})
    return file_path, None

@app.route('/simulation-results-list', methods=['GET'])
def list_simulation_results():
    """List JSON files in Data_dx_5m"""
    # Assuming Data_dx_5m is sibling to backend or in project root
    # Adjust this path as needed. '..' from backend is project root.
    target_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'backend', 'Data_dx_5m')
    
    # Try alternate location if not found (e.g., project root)
    if not os.path.exists(target_dir):
        target_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'Data_dx_5m')

    if not os.path.exists(target_dir):
         # Create it to see if that helps external service? No, better to return empty.
         return jsonify({'success': False, 'message': f'Directory not found: {target_dir}'})

    try:
        files = [f for f in os.listdir(target_dir) if f.endswith('.json')]
        return jsonify({'success': True, 'files': files})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

@app.route('/simulation-result/<path:filename>', methods=['GET'])
def get_simulation_result(filename):
    """Serve specific JSON file"""
    target_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'backend', 'Data_dx_5m')
    if not os.path.exists(target_dir):
        target_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'Data_dx_5m')
        
    return send_from_directory(target_dir, filename)

# 添加favicon路由
@app.route('/favicon.ico')
def favicon():
    """提供favicon服务"""
    return send_from_directory('cesium/Apps/CesiumViewer', 'favicon.ico')
# 添加Cesium静态文件路由
@app.route('/cesium/<path:filename>')
def cesium_static(filename):
    """提供Cesium静态文件服务"""
    return send_from_directory('cesium', filename)

# 添加DEMTiles静态文件路由
@app.route('/DEMTiles/<path:filename>')
def demtiles_static(filename):
    """提供DEMTiles地形数据服务"""
    return send_from_directory('DEMTiles', filename)

# 添加TIFF影像文件路由
@app.route('/tiff_images/<path:filename>')
def tiff_images_static(filename):
    """提供TIFF转换后的PNG影像文件服务"""
    response = send_from_directory('tiff_images', filename)
    # 添加CORS头，允许跨域访问
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Methods'] = 'GET, OPTIONS'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type'
    return response
@app.route('/')
def index():
    """主页"""
    return render_template('index.html')
import subprocess
import tkinter as tk
from tkinter import filedialog

@app.route('/api/choose-path', methods=['POST'])
def choose_path():
    try:
        data = request.json or {}
        path_type = data.get('type', 'file')
        
        root = tk.Tk()
        root.attributes('-topmost', True)
        root.withdraw()
        
        if path_type == 'file':
            result = filedialog.askopenfilename()
        else:
            result = filedialog.askdirectory()
            
        root.destroy()
        return jsonify({'success': True, 'path': result})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

@app.route('/api/grid-to-tin', methods=['POST'])
def run_grid_to_tin():
    try:
        data = request.json or {}
        dem_path = data.get('dem', '')
        depth_dir = data.get('depth_dir', '')
        output_dir = data.get('output_dir', '')
        
        script_path = os.path.join(os.path.dirname(__file__), 'grid_to_tin.py')
        
        cmd = ["python", script_path]
        if dem_path:
            cmd.extend(["--dem", dem_path])
        if depth_dir:
            cmd.extend(["--depth-dir", depth_dir])
        if output_dir:
            cmd.extend(["--output-dir", output_dir])
            
        def generate():
            try:
                env = os.environ.copy()
                env['PYTHONUNBUFFERED'] = '1'
                process = subprocess.Popen(
                    cmd, 
                    stdout=subprocess.PIPE, 
                    stderr=subprocess.STDOUT, 
                    text=True,
                    bufsize=1, 
                    universal_newlines=True,
                    env=env
                )
                for line in process.stdout:
                    if line.strip():
                        import json
                        yield json.dumps({'success': True, 'message': line.strip()}) + '\n'
                process.wait()
                if process.returncode == 0:
                    yield json.dumps({'success': True, 'message': '✅ 转换完成'}) + '\n'
                else:
                    yield json.dumps({'success': False, 'message': f'转换失败，返回码: {process.returncode}'}) + '\n'
            except Exception as e:
                import json
                yield json.dumps({'success': False, 'message': f'服务端错误: {str(e)}'}) + '\n'

        return Response(stream_with_context(generate()), mimetype='application/x-ndjson')
    except Exception as e:
        return jsonify({'success': False, 'message': f'服务端错误: {str(e)}'})

@app.route('/convert', methods=['POST'])
def convert_file():
    """处理TIFF到ASC格式转换"""
    try:
        file = request.files['file']
        if not file or file.filename == '':
            return jsonify({'success': False, 'message': '选择文件'})
        if not file.filename.lower().endswith(('.tif', '.tiff')):
            return jsonify({'success': False, 'message': '选择TIFF格式文件'})
        # 保存上传的文件
        filename = secure_filename(file.filename)
        input_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(input_path)
        # 准备输出路径
        base_name = os.path.splitext(filename)[0]
        output_filename = f"{base_name}.asc"
        output_path = os.path.join(app.config['OUTPUT_FOLDER'], output_filename)
        # 执行转换
        dem_to_ascii_gdal(input_path, output_path)
        # 清理上传的临时文件
        cleanup_file(input_path)
        return jsonify({
            'success': True, 
            'message': '完成',
            'download_url': f'/download/{os.path.basename(output_path)}'
        })
    except Exception as e:
        cleanup_file(input_path if 'input_path' in locals() else None)
        return jsonify({'success': False, 'message': f'失败: {str(e)}'})
# 辅助函数：根据经度计算UTM带号EPSG代码


@app.route('/get_asc_header', methods=['POST'])
def get_asc_header():
    """读取ASC文件的Header信息"""
    input_path = None
    try:
        if 'file' not in request.files:
            return jsonify({'success': False, 'message': 'No file part'})
            
        file = request.files['file']
        if file.filename == '':
            return jsonify({'success': False, 'message': 'No selected file'})
            
        filename = secure_filename(file.filename)
        input_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(input_path)
        
        # Read header only (simple parsing)
        header = {}
        with open(input_path, 'r', encoding='utf-8') as f:
             for _ in range(6):
                 line = f.readline().strip().split()
                 if len(line) >= 2:
                     key = line[0].lower()
                     value = line[1]
                     if key == 'ncols': header['ncols'] = int(value)
                     elif key == 'nrows': header['nrows'] = int(value)
                     elif key == 'xllcorner': header['xllcorner'] = value # Return as string for full precision
                     elif key == 'yllcorner': header['yllcorner'] = value # Return as string for full precision
                     elif key == 'cellsize': header['cellsize'] = value # Return as string
                     elif key.startswith('nodata'): header['nodata_value'] = value
        
        response = jsonify({'success': True, 'header': header})
        response.headers['Access-Control-Allow-Origin'] = '*'
        return response
    except Exception as e:
        response = jsonify({'success': False, 'message': str(e)})
        response.headers['Access-Control-Allow-Origin'] = '*'
        return response
    finally:
        cleanup_file(input_path)

@app.route('/get_epsg', methods=['POST'])
def get_epsg():
    """从上传的TIFF文件中提取EPSG代码"""
    input_path = None
    try:
        if 'file' not in request.files:
            return jsonify({'success': False, 'message': 'No file part'})
            
        file = request.files['file']
        if file.filename == '':
            return jsonify({'success': False, 'message': 'No selected file'})
            
        filename = secure_filename(file.filename)
        input_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(input_path)
        
        epsg_code = get_utm_epsg_from_tif(input_path)
        
        response = None
        if epsg_code:
            response = jsonify({'success': True, 'epsg': epsg_code})
        else:
            response = jsonify({'success': False, 'message': 'Could not determine EPSG from file'})
            
        response.headers['Access-Control-Allow-Origin'] = '*'
        return response
            
    except Exception as e:
        response = jsonify({'success': False, 'message': str(e)})
        response.headers['Access-Control-Allow-Origin'] = '*'
        return response
    finally:
        cleanup_file(input_path)

def get_utm_epsg_from_lon(lon):
    """根据经度计算UTM投影EPSG代码 (WGS84)"""
    # 简单的带号计算公式: zone = floor((lon + 180) / 6) + 1
    zone = int((lon + 180) / 6) + 1
    # 假设都在北半球 (EPSG: 326xx), 如果是南半球则是 327xx.
    # 目前根据用户场景，假设为北半球。更严谨的做法是判断lat > 0
    # 这里我们只支持北半球作为默认，或者可以传入lat判断
    epsg_code = f"EPSG:326{zone:02d}"
    return epsg_code, zone

@app.route('/roughness', methods=['POST'])
def calculate_roughness():
    """粗糙度计算"""
    tif_ref_path = None
    input_path = None
    try:
        file = request.files['file']
        window_size = int(request.form.get('window_size', 3))
        # 获取是否显示边框的选项
        show_bounds = request.form.get('show_bounds') == 'true'
        
        # 获取参考TIFF文件（用于坐标识别）
        tif_ref_file = request.files.get('tif_file')
        
        if tif_ref_file and tif_ref_file.filename != '':
             tif_ref_filename = secure_filename(tif_ref_file.filename)
             tif_ref_path = os.path.join(app.config['UPLOAD_FOLDER'], tif_ref_filename)
             tif_ref_file.save(tif_ref_path)
             
             # 尝试从参考TIFF设置投影
             epsg = get_utm_epsg_from_tif(tif_ref_path)
             if epsg:
                 print(f"根据上传的参考TIFF文件设置投影: {epsg}")
                 set_utm_epsg(epsg)

        if not file or file.filename == '':
            return jsonify({'success': False, 'message': '选择文件'})
        
        filename = secure_filename(file.filename)
        ext = os.path.splitext(filename)[1].lower()
        
        if ext not in ['.asc', '.txt', '.tif', '.tiff']:
            return jsonify({'success': False, 'message': '选择ASC, TXT或TIFF文件'})
            
        input_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(input_path)
        base_name = os.path.splitext(filename)[0]
        
        # 确定要处理的ASC文件路径
        asc_file_path = input_path
        
        # 如果是TIFF文件，需要先处理投影并转换为ASC
        if ext in ['.tif', '.tiff']:
            try:
                with rasterio.open(input_path) as src:
                    # 获取bounds
                    left, bottom, right, top = src.bounds
                    crs = src.crs
                    
                    # 计算中心点坐标
                    center_x = (left + right) / 2
                    center_y = (bottom + top) / 2
                    
                    center_lon = center_x
                    center_lat = center_y
                    
                    # 如果不是经纬度坐标，则转换
                    if crs and crs.to_string() != 'EPSG:4326':
                        try:
                            # 转换中心点到WGS84获取经纬度
                            xs = [center_x]
                            ys = [center_y]
                            lons, lats = transform(crs, 'EPSG:4326', xs, ys)
                            center_lon = lons[0]
                            center_lat = lats[0]
                        except Exception as e:
                            print(f"坐标转换失败，尝试将其视为WGS84: {e}")
                    
                    # 根据中心经度计算UTM带号
                    epsg_code, zone = get_utm_epsg_from_lon(center_lon)
                    print(f"TIFF中心经纬度: ({center_lon}, {center_lat}), 计算得出的投影: {epsg_code}")
                    
                    # 设置后端使用的全局投影
                    set_utm_epsg(epsg_code)
                    
                    # 将TIFF转为ASC
                    output_asc_name = f"{base_name}_converted.asc"
                    asc_file_path = os.path.join(app.config['OUTPUT_FOLDER'], output_asc_name)
                    dem_to_ascii_gdal(input_path, asc_file_path)
                    
            except Exception as e:
                print(f"处理TIFF文件失败: {e}")
                cleanup_file(input_path)
                return jsonify({'success': False, 'message': f'TIFF文件处理失败: {str(e)}'})
        else:
            # 如果是ASC文件
            # 只有在没有参考TIFF且当前可能没有正确设置投影时，才回退到默认
            if not tif_ref_path:
                print("未提供参考TIFF文件，使用默认投影 EPSG:32647")
                set_utm_epsg("EPSG:32647")
            pass

        output_filename = f"roughness_{base_name}.asc"
        output_path = os.path.join(app.config['OUTPUT_FOLDER'], output_filename)
        
        # 如果需要显示边界，计算边界信息
        bounds = None
        boundary_points = None
        
        # 总是计算边界信息以便前端跳转，但只有show_bounds为True时才计算详细轮廓
        try:
            # 使用新函数计算粗糙度并获取边界信息
            result = ascii_to_roughness_slope_based(asc_file_path, output_path, return_bounds=True, sample_height=3500.0, tif_path=tif_ref_path)
            if isinstance(result, tuple):
                roughness_array, bounds_info, interior_points = result
                
                boundary_coordinates = []
                if show_bounds:
                    try:
                        # 获取所有边界点（用于绘制红色边框）
                        boundary_points_data = get_boundary_roughness_values(output_path, num_points=10000)
                        # 提取所有边界点的坐标
                        if boundary_points_data:
                                boundary_coordinates = [[point['longitude'], point['latitude']] for point in boundary_points_data]
                    except Exception as e:
                        print(f"获取精确边界轮廓失败，将使用矩形边界: {str(e)}")
                        # 如果获取轮廓失败，boundary_coordinates 保持为空，前端将使用 coordinates（矩形框）
                
                # 格式化边界信息用于前端显示
                bounds = {
                    'coordinates': bounds_info['coordinates'],  # 保留四个角点（用于兼容和回退）
                    'boundary_points': boundary_coordinates,  # 所有边界点（用于绘制红色边框）
                    'min_lon': bounds_info['min_lon'],
                    'max_lon': bounds_info['max_lon'],
                    'min_lat': bounds_info['min_lat'],
                    'max_lat': bounds_info['max_lat']
                }
                
                # 如果不需要显示内部点，确保不返回大量数据
                if not show_bounds:
                    # 如果不显示边界，interior_points 也未被请求显示（虽然函数返回了）
                    pass
            else:
                # Should not happen given return_bounds=True
                pass

        except Exception as e:
            # 如果获取边界失败，仍然计算粗糙度 (fallback)
            print(f"获取边界信息完全失败: {str(e)}")
            import traceback
            traceback.print_exc()
            # 尝试不带边界计算
            ascii_to_roughness_slope_based(asc_file_path, output_path, tif_path=tif_ref_path)
        
        # 清理临时文件 (如果是上传的ASC则删除，如果是转换后的ASC可能需要保留给后续步骤?)
        # 这里 input_path 是上传的文件
        cleanup_file(input_path)
        # 如果生成了临时的ASC文件（从TIFF转来的），是否需要清理？
        # 目前 asc_file_path 如果不等于 input_path，就是生成的。可以清理。
        if asc_file_path != input_path:
             cleanup_file(asc_file_path)
        
        # 清理参考TIFF文件
        if tif_ref_path:
             cleanup_file(tif_ref_path)
        
        response_data = {
            'success': True, 
            'message': '粗糙度计算完成',
            'download_url': f'/download/{os.path.basename(output_path)}',
            'roughness_file': os.path.basename(output_path)  # 保存粗糙度文件名
        }
        
        # 如果获取到了边界信息，添加到响应中
        if bounds:
            response_data['bounds'] = bounds
        
        return jsonify(response_data)
    except Exception as e:
        # cleanup_file(input_path if 'input_path' in locals() else None)
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'message': f'失败: {str(e)}'})
@app.route('/download/<filename>')
def download_file(filename):
    file_path = os.path.join(app.config['OUTPUT_FOLDER'], filename)
    return send_file(file_path, as_attachment=True, download_name=filename)
@app.route('/calculate_line_tiles', methods=['POST'])
def calculate_line_tiles():
    """计算两点连线上经过的瓦片行列号"""
    try:
        data = request.get_json()
        # 获取请求参数
        point1 = data.get('point1')  # {'x': x, 'y': y}
        point2 = data.get('point2')  # {'x': x, 'y': y}
        canvas_width = data.get('canvas_width', 1920)
        canvas_height = data.get('canvas_height', 1080)
        geo_bounds = data.get('geo_bounds')  # {'min_x': x, 'max_x': x, 'min_y': y, 'max_y': y}
        level = data.get('level')  # 可选的地图级别
        if not point1 or not point2 or not geo_bounds:
            return jsonify({'success': False, 'message': '缺少必要参数'})
        # 创建坐标转换器
        converter = MapCoordinateConverter(
            origin_x=geo_bounds.get('origin_x', 0.0),
            origin_y=geo_bounds.get('origin_y', 0.0),
            tile_size=256
        )
        # 计算连线上经过的瓦片行列号
        tiles = converter.calculate_line_tiles(
            point1_screen=(point1['x'], point1['y']),
            point2_screen=(point2['x'], point2['y']),
            canvas_width=canvas_width,
            canvas_height=canvas_height,
            geo_min_x=geo_bounds['min_x'],
            geo_max_x=geo_bounds['max_x'],
            geo_min_y=geo_bounds['min_y'],
            geo_max_y=geo_bounds['max_y'],
            level=level
        ) 
        # 转换瓦片坐标格式
        tile_list = []
        for row, col in tiles:
            tile_list.append({
                'row': int(row),
                'col': int(col),
                'tile_id': f"{int(row)}_{int(col)}"
            })
        return jsonify({
            'success': True,
            'tiles': tile_list,
            'tile_count': len(tile_list),
            'message': f'成功计算经过的{len(tile_list)}个瓦片'
        })   
    except Exception as e:
        return jsonify({'success': False, 'message': f'失败: {str(e)}'})
@app.route('/screen_to_geo', methods=['POST'])
def screen_to_geo():
    """屏幕坐标转换为地理坐标"""
    try:
        data = request.get_json()
        screen_x = data.get('screen_x')
        screen_y = data.get('screen_y')
        canvas_width = data.get('canvas_width', 1920)
        canvas_height = data.get('canvas_height', 1080)
        geo_bounds = data.get('geo_bounds')
        level = data.get('level')
        if screen_x is None or screen_y is None or not geo_bounds:
            return jsonify({'success': False, 'message': '缺少必要参数'})
        # 坐标转换器
        converter = MapCoordinateConverter(
            origin_x=geo_bounds.get('origin_x', 0.0),
            origin_y=geo_bounds.get('origin_y', 0.0),
            tile_size=256
        )
        # 转换坐标
        geo_x, geo_y = converter.screen_to_geo(
            screen_x=screen_x,
            screen_y=screen_y,
            canvas_width=canvas_width,
            canvas_height=canvas_height,
            geo_min_x=geo_bounds['min_x'],
            geo_max_x=geo_bounds['max_x'],
            geo_min_y=geo_bounds['min_y'],
            geo_max_y=geo_bounds['max_y'],
            level=level
        )
        return jsonify({
            'success': True,
            'geo_x': geo_x,
            'geo_y': geo_y,
            'message': '坐标转换成功'
        }) 
    except Exception as e:
        return jsonify({'success': False, 'message': f'坐标转换失败: {str(e)}'})

@app.route('/get_tiff_bounds', methods=['POST'])
def get_tiff_bounds():
    """获取TIFF文件的边界信息"""
    tif_path = None
    try:
        tif_file = request.files.get('file')
        if not tif_file or tif_file.filename == '':
            return jsonify({'success': False, 'message': '请选择TIFF文件'})

        if not tif_file.filename.lower().endswith(('.tif', '.tiff')):
            return jsonify({'success': False, 'message': '请选择TIF或TIFF格式的文件'})
            
        tif_filename = secure_filename(tif_file.filename)
        tif_path = os.path.join(app.config['UPLOAD_FOLDER'], tif_filename)
        tif_file.save(tif_path)
        
        import rasterio
        from rasterio.warp import transform as rio_transform
        with rasterio.open(tif_path) as src:
            bounds = src.bounds
            crs = src.crs
            
            left, bottom, right, top = bounds
            
            if crs and crs.to_epsg() != 4326:
                # using rasterio.warp.transform
                xs, ys = rio_transform(crs, 'EPSG:4326', [left, right, right, left], [top, top, bottom, bottom])
                lon_min, lat_min = min(xs), min(ys)
                lon_max, lat_max = max(xs), max(ys)
                coordinates = [
                    [ys[0], xs[0]], # Wait, rasterio transform gives (xs, ys). We usually need [lon, lat] for cesium
                    # Actually, for the frontend we pass `coordinates:[[lon,lat],...]` ? Let's verify `displayBoundsOnMap`.
                ]
                
                coordinates = [
                    [xs[0], ys[0]], # top-left
                    [xs[1], ys[1]], # top-right
                    [xs[2], ys[2]], # bottom-right
                    [xs[3], ys[3]]  # bottom-left
                ]
            else:
                lon_min, lat_min, lon_max, lat_max = left, bottom, right, top
                coordinates = [
                    [left, top], 
                    [right, top], 
                    [right, bottom], 
                    [left, bottom]
                ]

        return jsonify({
            'success': True, 
            'bounds': {
                'coordinates': coordinates,
                'min_lon': lon_min,
                'max_lon': lon_max,
                'min_lat': lat_min,
                'max_lat': lat_max
            }
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'message': f'获取TIFF边界失败: {str(e)}'})
    finally:
        if tif_path and os.path.exists(tif_path):
            try:
                os.remove(tif_path)
            except Exception as e:
                print(f"清理文件失败: {e}")

@app.route('/get_ascii_bounds', methods=['POST'])
def get_ascii_bounds():
    """获取ASCII文件的边界信息"""
    ascii_path = None
    try:
        ascii_file = request.files.get('ascii_file')
        
        if not ascii_file or ascii_file.filename == '':
            return jsonify({'success': False, 'message': '请选择ASCII文件'})
        
        if not ascii_file.filename.lower().endswith(('.asc', '.txt')):
            return jsonify({'success': False, 'message': '请选择ASC或TXT格式的文件'})
        
        # 保存上传的文件
        ascii_filename = secure_filename(ascii_file.filename)
        ascii_path = os.path.join(app.config['UPLOAD_FOLDER'], ascii_filename)
        ascii_file.save(ascii_path)
        
        # 计算边界信息
        bounds_info = calculate_ascii_bounds(ascii_path)
        
        # 格式化边界信息用于前端显示
        bounds = {
            'coordinates': bounds_info['coordinates'],  # 四个角点
            'min_lon': bounds_info['min_lon'],
            'max_lon': bounds_info['max_lon'],
            'min_lat': bounds_info['min_lat'],
            'max_lat': bounds_info['max_lat']
        }
        
        # 清理上传的临时文件
        cleanup_file(ascii_path)
        
        return jsonify({
            'success': True,
            'bounds': bounds,
            'message': '成功获取ASCII文件边界'
        })
    except Exception as e:
        cleanup_file(ascii_path if ascii_path and os.path.exists(ascii_path) else None)
        import traceback
        error_trace = traceback.format_exc()
        print(f"获取ASCII边界错误: {str(e)}")
        print(error_trace)
        return jsonify({'success': False, 'message': f'获取边界失败: {str(e)}'})

@app.route('/get_ascii_values', methods=['POST'])
def get_ascii_values():
    """根据坐标从ASCII文件中获取行列号并输出txt文件"""
    ascii_path = None
    tif_path = None
    try:
        ascii_file = request.files.get('ascii_file')
        tif_file = request.files.get('tif_file')
        coordinates_json = request.form.get('coordinates')
        
        if not ascii_file or ascii_file.filename == '':
            return jsonify({'success': False, 'message': '请选择ASCII文件'})
        
        if not coordinates_json:
            return jsonify({'success': False, 'message': '缺少坐标数据'})
        
        # 解析坐标
        try:
            import json
            coordinates = json.loads(coordinates_json)
        except (json.JSONDecodeError, ValueError) as e:
            return jsonify({'success': False, 'message': f'坐标数据格式错误: {str(e)}'})
        
        if not coordinates or len(coordinates) == 0:
            return jsonify({'success': False, 'message': '坐标数据为空'})
        
        # 保存上传的文件
        ascii_filename = secure_filename(ascii_file.filename)
        ascii_path = os.path.join(app.config['UPLOAD_FOLDER'], ascii_filename)
        ascii_file.save(ascii_path)

        if tif_file and tif_file.filename != '':
            tif_filename = secure_filename(tif_file.filename)
            tif_path = os.path.join(app.config['UPLOAD_FOLDER'], tif_filename)
            tif_file.save(tif_path)
        
        # 准备输出路径
        timestamp = datetime.now().strftime('%Y%m%d%H%M%S')
        output_filename = f"行列号的值{timestamp}.dat"
        output_path = os.path.join(app.config['OUTPUT_FOLDER'], output_filename)
        
        # 调用处理函数
        success = get_ascii_values_by_coordinates(ascii_path, coordinates, output_path, tif_path)
        
        # 清理上传的临时文件
        cleanup_file(ascii_path)
        if tif_path:
            cleanup_file(tif_path)
        
        if success:
            return jsonify({
                'success': True,
                'message': f'成功获取{len(coordinates)}个坐标点的ASCII行列号',
                'download_url': f'/download/{output_filename}'
            })
        else:
            return jsonify({'success': False, 'message': '获取ASCII行列号失败，请检查控制台日志'})
    except Exception as e:
        cleanup_file(ascii_path if ascii_path and os.path.exists(ascii_path) else None)
        import traceback
        error_trace = traceback.format_exc()
        print(f"获取ASCII行列号错误: {str(e)}")
        print(error_trace)
        return jsonify({'success': False, 'message': f'处理失败: {str(e)}'})

@app.route('/polygon_clip', methods=['POST'])
def polygon_clip():
    """多边形处理ASCII文件"""
    ascii_path = None
    try:
        ascii_file = request.files.get('ascii_file')
        polygon_coordinates_json = request.form.get('polygon_coordinates')
        
        if not ascii_file or ascii_file.filename == '':
            return jsonify({'success': False, 'message': '请选择ASCII文件'})
        
        if not polygon_coordinates_json:
            return jsonify({'success': False, 'message': '缺少多边形坐标数据'})
        
        # 解析多边形坐标
        try:
            import json
            polygon_coordinates = json.loads(polygon_coordinates_json)
        except (json.JSONDecodeError, ValueError) as e:
            return jsonify({'success': False, 'message': f'多边形坐标数据格式错误: {str(e)}'})
        
        if not polygon_coordinates or len(polygon_coordinates) < 3:
            return jsonify({'success': False, 'message': '多边形至少需要3个顶点'})
        
        # 保存上传的文件
        ascii_filename = secure_filename(ascii_file.filename)
        ascii_path = os.path.join(app.config['UPLOAD_FOLDER'], ascii_filename)
        ascii_file.save(ascii_path)
        
        # 准备输出路径
        timestamp = datetime.now().strftime('%Y%m%d%H%M%S')
        base_name = os.path.splitext(ascii_filename)[0]
        output_filename = f"{base_name}{timestamp}.asc"
        output_path = os.path.join(app.config['OUTPUT_FOLDER'], output_filename)
        
        # 调用处理函数
        success = clip_ascii_by_polygon(
            ascii_path, 
            polygon_coordinates, 
            output_path
        )
        
        # 清理上传的临时文件
        cleanup_file(ascii_path)
        
        if success:
            return jsonify({
                'success': True,
                'message': f'多边形处理完成',
                'download_url': f'/download/{output_filename}'
            })
        else:
            return jsonify({'success': False, 'message': '多边形处理失败，请检查控制台日志'})
    except Exception as e:
        cleanup_file(ascii_path if ascii_path and os.path.exists(ascii_path) else None)
        import traceback
        error_trace = traceback.format_exc()
        print(f"多边形处理错误: {str(e)}")
        print(error_trace)
        return jsonify({'success': False, 'message': f'处理失败: {str(e)}'})


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
