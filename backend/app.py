import os
import json
import struct
import gzip
import mimetypes
from flask import Flask, render_template, request, jsonify, send_file, send_from_directory, Response, stream_with_context
from werkzeug.utils import secure_filename
from datetime import datetime
import rasterio
from rasterio.warp import transform
import math
import shutil
import time
import uuid
import zipfile
from urllib.parse import quote
import xml.etree.ElementTree as ET
import hashlib

BACKEND_ROOT = os.path.abspath(os.path.dirname(__file__))
PROJECT_ROOT = os.path.abspath(os.path.dirname(BACKEND_ROOT))

try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(PROJECT_ROOT, '.env'))
    load_dotenv(os.path.join(BACKEND_ROOT, '.env'))
except ImportError:
    # python-dotenv is optional. Environment variables can still be set by shell.
    pass


def resolve_project_path(env_names, default_relative_path):
    """Resolve a configurable path relative to project root.

    Team rule:
    - default paths are relative to the repository root;
    - local absolute paths should be placed in .env, never hard-coded in source.
    """
    if isinstance(env_names, str):
        env_names = (env_names,)

    for env_name in env_names:
        configured = os.getenv(env_name, '').strip()
        if configured:
            return configured if os.path.isabs(configured) else os.path.abspath(os.path.join(PROJECT_ROOT, configured))

    return os.path.abspath(os.path.join(PROJECT_ROOT, default_relative_path))


def resolve_user_project_path(path_value):
    """Resolve a user-provided path; relative values are based on project root."""
    value = str(path_value or '').strip()
    if not value:
        return ''
    value = os.path.expanduser(value)
    return value if os.path.isabs(value) else os.path.abspath(os.path.join(PROJECT_ROOT, value))

# 导入现有的处理模块
from ASC文件获取粗糙度 import ascii_to_roughness_slope_based, calculate_ascii_bounds, get_boundary_roughness_values, get_ascii_values_by_coordinates, clip_ascii_by_polygon, set_utm_epsg, get_utm_epsg_from_tif
from TIFF转ASC格式 import dem_to_ascii_gdal
from 地图瓦片行列号 import MapCoordinateConverter
app = Flask(__name__)
app.config['SECRET_KEY'] = 'your-secret-key-here'
app.config['MAX_CONTENT_LENGTH'] = 2000 * 1024 * 1024  # 2000MB max file size
app.config['UPLOAD_FOLDER'] = resolve_project_path('FLOOD_UPLOAD_FOLDER', os.path.join('backend', 'uploads'))
app.config['OUTPUT_FOLDER'] = resolve_project_path('FLOOD_OUTPUT_FOLDER', os.path.join('backend', 'outputs'))

@app.after_request
def add_cors_headers(response):
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization'
    return response

# 确保上传和输出文件夹存在
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
os.makedirs(app.config['OUTPUT_FOLDER'], exist_ok=True)

MESH_UPLOAD_ROOT = os.path.abspath(os.path.join(app.config['UPLOAD_FOLDER'], 'mesh_json_jobs'))
MESH_OUTPUT_ROOT = os.path.abspath(os.path.join(app.config['OUTPUT_FOLDER'], 'mesh_jobs'))
os.makedirs(MESH_UPLOAD_ROOT, exist_ok=True)
os.makedirs(MESH_OUTPUT_ROOT, exist_ok=True)

LAYER_RESOURCE_ROOT = resolve_project_path(
    ('LAYER_RESOURCE_ROOT', 'FLOOD_LAYER_RESOURCE_ROOT'),
    os.path.join('backend', 'runtime', 'layers')
)
LAYER_REGISTRY_FILE = os.path.join(LAYER_RESOURCE_ROOT, 'registry.json')
LAYER_UPLOAD_TMP_ROOT = os.path.join(LAYER_RESOURCE_ROOT, '_tmp')
LAYER_KIND_DIRS = {
    'terrain': os.path.join(LAYER_RESOURCE_ROOT, 'terrain'),
    'imagery': os.path.join(LAYER_RESOURCE_ROOT, 'imagery')
}
PUBLIC_TERRAIN_ROOT = os.path.join(PROJECT_ROOT, 'public', 'data', 'terrain')
PUBLIC_IMAGERY_ROOT = os.path.join(PROJECT_ROOT, 'public', 'data', 'imagery')
for layer_dir in [LAYER_RESOURCE_ROOT, LAYER_UPLOAD_TMP_ROOT, *LAYER_KIND_DIRS.values()]:
    os.makedirs(layer_dir, exist_ok=True)


def _safe_json_load(path, default=None):
    try:
        with open(path, 'r', encoding='utf-8') as file:
            return json.load(file)
    except Exception:
        return default


def _safe_json_write(path, data):
    temp_path = f'{path}.tmp'
    with open(temp_path, 'w', encoding='utf-8') as file:
        json.dump(data, file, ensure_ascii=False, indent=2)
    os.replace(temp_path, path)


def _load_layer_registry():
    registry = _safe_json_load(LAYER_REGISTRY_FILE, default={})
    return {
        'terrain': list(registry.get('terrain') or []),
        'imagery': list(registry.get('imagery') or [])
    }


def _save_layer_registry(registry):
    _safe_json_write(LAYER_REGISTRY_FILE, {
        'terrain': list(registry.get('terrain') or []),
        'imagery': list(registry.get('imagery') or [])
    })


def _public_resource_url(*parts):
    return '/' + '/'.join(quote(str(part).strip('/')) for part in parts if str(part).strip('/'))


def _normalize_layer_bounds(value):
    if isinstance(value, dict):
        west = value.get('west')
        south = value.get('south')
        east = value.get('east')
        north = value.get('north')
    elif isinstance(value, (list, tuple)) and len(value) >= 4:
        west, south, east, north = value[:4]
    else:
        return None

    try:
        west = float(west)
        south = float(south)
        east = float(east)
        north = float(north)
    except (TypeError, ValueError):
        return None

    if not (-180 <= west <= 180 and -180 <= east <= 180 and -90 <= south <= 90 and -90 <= north <= 90):
        return None
    if west >= east or south >= north:
        return None
    return {'west': west, 'south': south, 'east': east, 'north': north}


def _extract_layer_bounds(*metadata_items):
    for metadata in metadata_items:
        if not isinstance(metadata, dict):
            continue
        for key in ('valid_bounds', 'latLonBounds', 'bounds'):
            bounds = _normalize_layer_bounds(metadata.get(key))
            if bounds:
                return bounds
    return None


def _hash_resource_id(kind, name):
    digest = hashlib.sha1(f'{kind}:{name}'.encode('utf-8')).hexdigest()[:10]
    return f'builtin-{kind}-{digest}'


def _detect_imagery_extension(resource_dir):
    for extension in ('.png', '.jpg', '.jpeg', '.webp', '.terrain'):
        for _root, _dirs, files in os.walk(resource_dir):
            if any(name.lower().endswith(extension) for name in files):
                return extension.lstrip('.').replace('jpeg', 'jpg')
    return 'png'


def _resource_from_public_dir(kind, name, path):
    layer_json = _safe_json_load(os.path.join(path, 'layer.json'), default={})
    meta_json = _safe_json_load(os.path.join(path, 'meta.json'), default={})

    if kind == 'terrain':
        if not os.path.isfile(os.path.join(path, 'layer.json')):
            return None
        bounds = _extract_layer_bounds(layer_json, meta_json)
        if not bounds:
            return None
        return {
            'id': _hash_resource_id('terrain', name),
            'name': name,
            'kind': 'terrain',
            'source': 'builtin',
            'url': _public_resource_url('data', 'terrain', name) + '/',
            'bounds': bounds,
            'minzoom': int(layer_json.get('minzoom') or meta_json.get('minzoom') or 0),
            'maxzoom': int(layer_json.get('maxzoom') or meta_json.get('maxzoom') or 0),
            'format': layer_json.get('format') or meta_json.get('contentType') or 'quantized-mesh-1.0',
            'enabledForAutoMatch': True
        }

    if kind == 'imagery':
        if not os.path.isfile(os.path.join(path, 'meta.json')):
            return None
        bounds = _extract_layer_bounds(meta_json)
        if not bounds:
            return None
        extension = _detect_imagery_extension(path)
        return {
            'id': _hash_resource_id('imagery', name),
            'name': name,
            'kind': 'imagery',
            'source': 'builtin',
            'url': _public_resource_url('data', 'imagery', name) + '/',
            'bounds': bounds,
            'minzoom': int(meta_json.get('minzoom') or 0),
            'maxzoom': int(meta_json.get('maxzoom') or 18),
            'format': meta_json.get('contentType') or f'image/{extension}',
            'extension': extension,
            'tileScheme': meta_json.get('tiletrans') or 'google',
            'visible': False,
            'alpha': 0.88
        }
    return None


def _list_builtin_layer_resources(kind):
    root = PUBLIC_TERRAIN_ROOT if kind == 'terrain' else PUBLIC_IMAGERY_ROOT
    if not os.path.isdir(root):
        return []

    resources = []
    for name in sorted(os.listdir(root)):
        path = os.path.join(root, name)
        if not os.path.isdir(path):
            continue
        resource = _resource_from_public_dir(kind, name, path)
        if resource:
            resources.append(resource)
    return resources


def _validate_zip_members(zip_file):
    for member in zip_file.infolist():
        normalized = member.filename.replace('\\', '/')
        if not normalized or normalized.startswith('/') or '..' in normalized.split('/'):
            raise ValueError(f'ZIP 中包含不安全路径：{member.filename}')


def _find_extracted_resource_root(extracted_root, kind):
    required = 'layer.json' if kind == 'terrain' else 'meta.json'
    direct = os.path.join(extracted_root, required)
    if os.path.isfile(direct):
        return extracted_root

    child_dirs = [
        os.path.join(extracted_root, name)
        for name in os.listdir(extracted_root)
        if os.path.isdir(os.path.join(extracted_root, name))
    ]
    if len(child_dirs) == 1 and os.path.isfile(os.path.join(child_dirs[0], required)):
        return child_dirs[0]
    return None


def _build_uploaded_resource(kind, resource_id, name, root_dir):
    layer_json = _safe_json_load(os.path.join(root_dir, 'layer.json'), default={})
    meta_json = _safe_json_load(os.path.join(root_dir, 'meta.json'), default={})
    bounds = _extract_layer_bounds(layer_json, meta_json)
    if not bounds:
        raise ValueError('切片元数据中缺少有效经纬度范围 bounds/valid_bounds。')

    if kind == 'terrain':
        if not os.path.isfile(os.path.join(root_dir, 'layer.json')):
            raise ValueError('地形切片 ZIP 根目录必须包含 layer.json。')
        if layer_json.get('format') and layer_json.get('format') != 'quantized-mesh-1.0':
            raise ValueError('当前仅支持 quantized-mesh-1.0 地形切片。')
        return {
            'id': resource_id,
            'name': name,
            'kind': 'terrain',
            'source': 'uploaded',
            'url': f'/api/layer-resources/files/terrain/{resource_id}/',
            'bounds': bounds,
            'minzoom': int(layer_json.get('minzoom') or meta_json.get('minzoom') or 0),
            'maxzoom': int(layer_json.get('maxzoom') or meta_json.get('maxzoom') or 0),
            'format': layer_json.get('format') or 'quantized-mesh-1.0',
            'enabledForAutoMatch': True,
            'createdAt': datetime.utcnow().isoformat() + 'Z'
        }

    if not os.path.isfile(os.path.join(root_dir, 'meta.json')):
        raise ValueError('影像切片 ZIP 根目录必须包含 meta.json。')
    extension = _detect_imagery_extension(root_dir)
    return {
        'id': resource_id,
        'name': name,
        'kind': 'imagery',
        'source': 'uploaded',
        'url': f'/api/layer-resources/files/imagery/{resource_id}/',
        'bounds': bounds,
        'minzoom': int(meta_json.get('minzoom') or 0),
        'maxzoom': int(meta_json.get('maxzoom') or 18),
        'format': meta_json.get('contentType') or f'image/{extension}',
        'extension': extension,
        'tileScheme': meta_json.get('tiletrans') or 'google',
        'visible': False,
        'alpha': 0.88,
        'createdAt': datetime.utcnow().isoformat() + 'Z'
    }


def _layer_resource_dir(kind, resource_id):
    root = LAYER_KIND_DIRS.get(kind)
    if not root:
        return None
    path = os.path.abspath(os.path.join(root, resource_id))
    if os.path.commonpath([root, path]) != root:
        return None
    return path

SHOWCASE_ROOT = resolve_project_path(('SHOWCASE_ROOT', 'FLOOD_SHOWCASE_ROOT'), 'data_showcase')
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
        'cell_size': 20,
        'demo_sample_max_frames': 60
    },
    'yongchuan': {
        'name': '永川',
        'directory': os.path.join(SHOWCASE_ROOT, 'yongchuan2'),
        'utm_zone': 48,
        'asc_file': 'Yongchuan_DEM_20m_48N.asc',
        'xml_file': 'Flood_New.xml',
        'demo_sample_max_frames': 120,
        'camera_height': 22000
    },
    'xiaojiaqiao': {
        'name': '肖家桥',
        'directory': os.path.join(SHOWCASE_ROOT, 'xiaojiaqiao'),
        'utm_zone': 48,
        'asc_file': 'CCC (1).asc',
        'xml_file': 'Flood_New.xml',
        'demo_sample_max_frames': 10,
        'camera_height': 26000
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
# ????????? Cloudflare R2/CDN???????? SHOWCASE_CDN_BASE_URL ???
DEFAULT_SHOWCASE_CDN_BASE_URL = 'https://flood-data.disaster.website/showcase'
BUILDINGS_ROOT = os.path.abspath(os.path.join(
    os.path.dirname(os.path.dirname(__file__)),
    'public',
    'data',
    'buildings'
))
ANXIAN_BUILDINGS_DIR = os.path.join(BUILDINGS_ROOT, 'anxianbuildings')
ANXIAN_BUILDINGS_SHP = os.path.join(ANXIAN_BUILDINGS_DIR, 'anxianbuildings.shp')
ANXIAN_BUILDINGS_CACHE = os.path.join(ANXIAN_BUILDINGS_DIR, 'anxianbuildings.filtered.geojson')
ANXIAN_BUILDINGS_SRC_CRS = 'EPSG:32649'
ANXIAN_BUILDINGS_DST_CRS = 'EPSG:4326'
ANXIAN_BUILDINGS_BBOX = {
    'min_lon': 104.286360,
    'max_lon': 104.487012,
    'min_lat': 31.558172,
    'max_lat': 31.653796
}


def bbox_intersects_filter(lons, lats):
    if not lons or not lats:
        return False

    return not (
        max(lons) < ANXIAN_BUILDINGS_BBOX['min_lon']
        or min(lons) > ANXIAN_BUILDINGS_BBOX['max_lon']
        or max(lats) < ANXIAN_BUILDINGS_BBOX['min_lat']
        or min(lats) > ANXIAN_BUILDINGS_BBOX['max_lat']
    )


def read_anxian_building_shapes(shp_path):
    features = []

    with open(shp_path, 'rb') as shp_file:
        header = shp_file.read(100)
        if len(header) < 100:
            raise ValueError('建筑 shp 文件头不完整')

        while True:
            record_header = shp_file.read(8)
            if not record_header:
                break
            if len(record_header) < 8:
                raise ValueError('建筑 shp 记录头不完整')

            record_number, content_length_words = struct.unpack('>2i', record_header)
            content = shp_file.read(content_length_words * 2)
            if len(content) < 4:
                continue

            shape_type = struct.unpack('<i', content[:4])[0]
            if shape_type == 0:
                continue
            if shape_type not in (5, 15, 25):
                continue
            if len(content) < 44:
                continue

            num_parts, num_points = struct.unpack('<2i', content[36:44])
            if num_parts <= 0 or num_points <= 0:
                continue

            parts_offset = 44
            points_offset = parts_offset + num_parts * 4
            points_end = points_offset + num_points * 16
            if len(content) < points_end:
                continue

            parts = list(struct.unpack(f'<{num_parts}i', content[parts_offset:points_offset]))
            raw_points = struct.unpack(f'<{num_points * 2}d', content[points_offset:points_end])
            points = [(raw_points[index], raw_points[index + 1]) for index in range(0, len(raw_points), 2)]

            rings = []
            feature_lons = []
            feature_lats = []
            for part_index, start in enumerate(parts):
                end = parts[part_index + 1] if part_index + 1 < len(parts) else num_points
                ring_points = points[start:end]
                if len(ring_points) < 3:
                    continue

                xs = [point[0] for point in ring_points]
                ys = [point[1] for point in ring_points]
                lons, lats = transform(ANXIAN_BUILDINGS_SRC_CRS, ANXIAN_BUILDINGS_DST_CRS, xs, ys)
                feature_lons.extend(lons)
                feature_lats.extend(lats)
                ring = [[round(lon, 7), round(lat, 7)] for lon, lat in zip(lons, lats)]
                if ring[0] != ring[-1]:
                    ring.append(ring[0])
                rings.append(ring)

            if rings and bbox_intersects_filter(feature_lons, feature_lats):
                features.append({
                    'type': 'Feature',
                    'properties': {
                        'id': record_number,
                        'height': 12
                    },
                    'geometry': {
                        'type': 'Polygon',
                        'coordinates': rings
                    }
                })

    return {
        'type': 'FeatureCollection',
        'features': features
    }


def get_anxian_buildings_geojson():
    if not os.path.exists(ANXIAN_BUILDINGS_SHP):
        raise FileNotFoundError(f'建筑 shp 文件不存在: {ANXIAN_BUILDINGS_SHP}')

    should_rebuild = (
        not os.path.exists(ANXIAN_BUILDINGS_CACHE)
        or os.path.getmtime(ANXIAN_BUILDINGS_CACHE) < os.path.getmtime(ANXIAN_BUILDINGS_SHP)
    )

    if should_rebuild:
        geojson = read_anxian_building_shapes(ANXIAN_BUILDINGS_SHP)
        with open(ANXIAN_BUILDINGS_CACHE, 'w', encoding='utf-8') as cache_file:
            json.dump(geojson, cache_file, ensure_ascii=False, separators=(',', ':'))

    return ANXIAN_BUILDINGS_CACHE


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



def read_asc_header_from_file(file_path):
    """Read only the ASCII-grid header, avoiding loading full ASC payloads."""
    header = {}
    with open(file_path, 'r', encoding='utf-8', errors='ignore') as asc_file:
        for _ in range(32):
            line = asc_file.readline()
            if not line:
                break
            parts = line.strip().split()
            if len(parts) < 2:
                continue
            key = parts[0].lower()
            if key not in {'ncols', 'nrows', 'xllcorner', 'yllcorner', 'xllcenter', 'yllcenter', 'cellsize'}:
                # ASC header is normally continuous; stop once grid values begin.
                if {'ncols', 'nrows', 'cellsize'}.issubset(header.keys()):
                    break
                continue
            try:
                value = float(parts[1])
            except ValueError:
                continue
            header[key] = value

    required = {'ncols', 'nrows', 'cellsize'}
    if not required.issubset(header.keys()):
        raise ValueError('ASC header missing ncols/nrows/cellsize')
    if 'xllcorner' not in header and 'xllcenter' not in header:
        raise ValueError('ASC header missing xllcorner/xllcenter')
    if 'yllcorner' not in header and 'yllcenter' not in header:
        raise ValueError('ASC header missing yllcorner/yllcenter')

    ncols = int(header['ncols'])
    nrows = int(header['nrows'])
    cellsize = float(header['cellsize'])
    if 'xllcorner' in header:
        xllcorner = float(header['xllcorner'])
    else:
        xllcorner = float(header['xllcenter']) - cellsize / 2
    if 'yllcorner' in header:
        yllcorner = float(header['yllcorner'])
    else:
        yllcorner = float(header['yllcenter']) - cellsize / 2

    return {
        'ncols': ncols,
        'nrows': nrows,
        'xllcorner': xllcorner,
        'yllcorner': yllcorner,
        'cellsize': cellsize
    }


def calc_lon_lat_bounds_from_asc_header(asc_header, utm_zone):
    if not isinstance(utm_zone, int) or utm_zone < 1 or utm_zone > 60:
        raise ValueError('UTM zone must be an integer between 1 and 60')

    xmin = asc_header['xllcorner']
    ymin = asc_header['yllcorner']
    xmax = xmin + asc_header['ncols'] * asc_header['cellsize']
    ymax = ymin + asc_header['nrows'] * asc_header['cellsize']
    xs = [xmin, xmin, xmax, xmax]
    ys = [ymin, ymax, ymin, ymax]
    lons, lats = transform(f"EPSG:326{utm_zone:02d}", 'EPSG:4326', xs, ys)
    west = min(lons)
    east = max(lons)
    south = min(lats)
    north = max(lats)

    return {
        'west': west,
        'east': east,
        'south': south,
        'north': north,
        'centerLon': (west + east) / 2,
        'centerLat': (south + north) / 2
    }


def get_showcase_spatial_metadata(case_config, asc_path):
    """Return manifest spatial metadata without downloading/parsing full ASC on the frontend."""
    metadata = {
        'center': case_config.get('center'),
        'camera_center': case_config.get('camera_center'),
        'cell_size': case_config.get('cell_size'),
        'bounds': case_config.get('bounds')
    }

    if asc_path:
        asc_header = read_asc_header_from_file(asc_path)
        bounds = calc_lon_lat_bounds_from_asc_header(asc_header, int(case_config['utm_zone']))
        # Keep the same anchor convention as the old frontend ASC path:
        # flood mesh origin = west/north corner transformed from ASC header.
        metadata['center'] = metadata['center'] or {
            'lon': bounds['west'],
            'lat': bounds['north'],
            'height': 0
        }
        metadata['camera_center'] = metadata['camera_center'] or {
            'lon': bounds['centerLon'],
            'lat': bounds['centerLat'],
            'height': case_config.get('camera_height', 22000)
        }
        metadata['cell_size'] = metadata['cell_size'] or asc_header['cellsize']
        metadata['bounds'] = metadata['bounds'] or bounds
        metadata['ascHeader'] = asc_header

    return metadata


def parse_demo_sample_limit(case_config):
    # Default to full original frames. Use ?mode=demo or ?mode=demo&frames=60 for sampled playback.
    mode = request.args.get('mode', 'full').lower()
    if mode in {'full', 'origin', 'original', 'raw'}:
        return mode, None

    default_limit = case_config.get('demo_sample_max_frames')
    requested_limit = request.args.get('frames') or request.args.get('maxFrames')
    if requested_limit is None:
        return mode, default_limit

    try:
        limit = int(requested_limit)
    except ValueError:
        return mode, default_limit

    return mode, max(2, limit)


def sample_showcase_entries(entries, max_frames):
    if not max_frames or len(entries) <= max_frames:
        return entries, 1

    if max_frames <= 1:
        return [entries[0]], len(entries)

    last_index = len(entries) - 1
    indexes = sorted({round(index * last_index / (max_frames - 1)) for index in range(max_frames)})
    sampled_entries = [entries[index] for index in indexes]
    stride = max(1, round(len(entries) / max(1, len(sampled_entries))))
    return sampled_entries, stride


def make_showcase_public_base_url(case_id):
    cdn_base_url = os.getenv('SHOWCASE_CDN_BASE_URL', DEFAULT_SHOWCASE_CDN_BASE_URL).strip().rstrip('/')
    if cdn_base_url:
        return f"{cdn_base_url}/{case_id}"

    forwarded_proto = request.headers.get('X-Forwarded-Proto')
    forwarded_host = request.headers.get('X-Forwarded-Host')
    if forwarded_proto and forwarded_host:
        return f"{forwarded_proto}://{forwarded_host}/py-api/api/showcase/{case_id}/file"
    return f"{request.host_url.rstrip('/')}/api/showcase/{case_id}/file"

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
        return jsonify({'success': False, 'message': 'showcase ASC or XML file not found'}), 404

    xml_dir = os.path.dirname(case_config['xml_file']).replace('\\', '/')
    flood_entries = get_existing_showcase_flood_entries(case_config, xml_path)
    mode, max_demo_frames = parse_demo_sample_limit(case_config)
    selected_entries, sample_stride = sample_showcase_entries(flood_entries, max_demo_frames)
    flood_urls = [entry['url'] for entry in selected_entries]
    flood_frame_sizes = [entry['size'] for entry in selected_entries]
    full_frame_sizes = [entry['size'] for entry in flood_entries]
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

    try:
        spatial_metadata = get_showcase_spatial_metadata(case_config, asc_path)
    except Exception as error:
        return jsonify({'success': False, 'message': f'showcase spatial metadata read failed: {str(error)}'}), 500

    return jsonify({
        'success': True,
        'caseId': case_id,
        'name': case_config['name'],
        'utmZone': case_config['utm_zone'],
        'ascFile': asc_file,
        'xmlFile': case_config['xml_file'],
        'xmlDir': xml_dir,
        'jsonBaseDir': case_config.get('json_base_dir', xml_dir),
        'center': spatial_metadata.get('center'),
        'cameraCenter': spatial_metadata.get('camera_center'),
        'bounds': spatial_metadata.get('bounds'),
        'anchorOffset': get_showcase_anchor_offset(case_config),
        'headingOffsetDegrees': get_showcase_heading_offset(case_config),
        'cellSize': spatial_metadata.get('cell_size'),
        'mode': mode,
        'samplingStrategy': 'uniform' if max_demo_frames and len(selected_entries) < len(flood_entries) else 'none',
        'isSampled': len(selected_entries) < len(flood_entries),
        'sampleStride': sample_stride,
        'sampleMaxFrames': max_demo_frames,
        'jsonCount': len(flood_urls),
        'sampledJsonCount': len(flood_urls),
        'fullJsonCount': len(flood_entries),
        'xmlJsonCount': xml_frame_count,
        'missingJsonCount': max(xml_frame_count - len(flood_entries) - excluded_json_count, 0),
        'excludedJsonCount': excluded_json_count,
        'floodUrls': flood_urls,
        'floodFrameSizes': flood_frame_sizes,
        'totalJsonBytes': sum(flood_frame_sizes),
        'maxJsonBytes': max(flood_frame_sizes, default=0),
        'fullTotalJsonBytes': sum(full_frame_sizes),
        'fullMaxJsonBytes': max(full_frame_sizes, default=0),
        'fileBaseUrl': make_showcase_public_base_url(case_id)
    })

@app.route('/api/showcase/<case_id>/file/<path:filename>', methods=['GET'])
def get_showcase_file(case_id, filename):
    case_config, error_response, status_code = get_showcase_case(case_id)
    if error_response:
        return error_response, status_code

    file_path = get_showcase_file_path(case_config, filename)
    if not file_path:
        return jsonify({'success': False, 'message': 'file not found or access denied'}), 404

    extension = os.path.splitext(file_path)[1].lower()
    accepts_gzip = 'gzip' in request.headers.get('Accept-Encoding', '').lower()
    if accepts_gzip and extension in {'.json', '.asc', '.xml'}:
        with open(file_path, 'rb') as data_file:
            compressed = gzip.compress(data_file.read(), compresslevel=5)
        mime_type = mimetypes.guess_type(file_path)[0] or 'application/octet-stream'
        response = Response(compressed, mimetype=mime_type)
        response.headers['Content-Encoding'] = 'gzip'
        response.headers['Vary'] = 'Accept-Encoding'
    else:
        response = send_file(file_path, conditional=True, max_age=3600)

    response.headers['Cache-Control'] = 'public, max-age=3600'
    return response

# 辅助函数：清理临时文件
@app.route('/api/buildings/anxianbuildings/geojson', methods=['GET'])
def get_anxian_buildings():
    try:
        geojson_path = get_anxian_buildings_geojson()
        response = send_file(geojson_path, mimetype='application/geo+json', conditional=True, max_age=3600)
        response.headers['Cache-Control'] = 'public, max-age=3600'
        return response
    except Exception as e:
        return jsonify({'success': False, 'message': f'建筑数据读取失败: {str(e)}'}), 500


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
        dem_path = resolve_user_project_path(data.get('dem', ''))
        depth_dir = resolve_user_project_path(data.get('depth_dir', ''))
        output_dir = resolve_user_project_path(data.get('output_dir', ''))
        
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

@app.route('/api/mesh-index', methods=['POST'])
def get_mesh_index():
    try:
        data = request.get_json(silent=True) or {}
        folder = os.path.abspath(str(data.get('folder') or ''))
        index_path = os.path.abspath(os.path.join(folder, 'index.json'))

        if not os.path.isfile(index_path):
            return jsonify({'success': False, 'error': f'index.json 不存在: {index_path}'}), 404

        with open(index_path, 'r', encoding='utf-8') as file:
            index = json.load(file)

        frames = index.get('frames')
        if not isinstance(frames, list) or not frames:
            return jsonify({'success': False, 'error': 'index.json 中没有 frames 索引'}), 400

        safe_frames = []
        for frame in frames:
            name = os.path.basename(str(frame.get('name') or ''))
            if not name.lower().endswith('.mesh.json'):
                continue
            safe_frames.append({
                'name': name,
                'index': frame.get('index'),
                'pointCount': frame.get('pointCount'),
                'triangleCount': frame.get('triangleCount'),
                'triangulation': frame.get('triangulation'),
                'stats': frame.get('stats')
            })

        return jsonify({'success': True, 'folder': os.path.dirname(index_path), 'frames': safe_frames})
    except Exception as e:
        return jsonify({'success': False, 'error': f'无法读取 Mesh 索引: {str(e)}'}), 500


@app.route('/api/mesh-frame', methods=['GET'])
def get_mesh_frame():
    try:
        folder = os.path.abspath(str(request.args.get('folder') or ''))
        name = os.path.basename(str(request.args.get('name') or ''))
        if not name.lower().endswith('.mesh.json'):
            return jsonify({'success': False, 'error': '无效的 Mesh 文件名'}), 400

        file_path = os.path.abspath(os.path.join(folder, name))
        if os.path.commonpath([folder, file_path]) != folder:
            return jsonify({'success': False, 'error': '无效的 Mesh 路径'}), 400
        if not os.path.isfile(file_path):
            return jsonify({'success': False, 'error': f'Mesh 文件不存在: {name}'}), 404

        return send_file(file_path, mimetype='application/json')
    except Exception as e:
        return jsonify({'success': False, 'error': f'无法读取 Mesh 帧: {str(e)}'}), 500


@app.route('/api/build-mesh', methods=['POST'])
def build_mesh_cache():
    try:
        data = request.get_json(silent=True) or {}
        source_dir = os.path.abspath(str(data.get('sourceDir') or ''))
        output_dir = os.path.abspath(str(data.get('outputDir') or ''))

        if not os.path.isdir(source_dir):
            return jsonify({'success': False, 'error': f'JSON 源目录不存在: {source_dir}'}), 400
        os.makedirs(output_dir, exist_ok=True)

        script_path = os.path.join(os.path.dirname(__file__), 'build-mesh-cache.cjs')
        if not os.path.isfile(script_path):
            return jsonify({'success': False, 'error': f'Mesh 转换脚本不存在: {script_path}'}), 500

        env = os.environ.copy()
        env['MESH_WORKERS'] = str(data.get('workers') or 4)
        process = subprocess.run(
            ['node', script_path, source_dir, output_dir],
            cwd=os.path.dirname(__file__),
            capture_output=True,
            text=True,
            encoding='utf-8',
            errors='replace',
            env=env
        )

        output = (process.stdout or '') + (process.stderr or '')
        if process.returncode != 0:
            return jsonify({'success': False, 'error': output or f'Mesh 转换失败，退出码 {process.returncode}'}), 500

        return jsonify({'success': True, 'message': 'Mesh 转换完成', 'output': output, 'outputDir': output_dir})
    except Exception as e:
        return jsonify({'success': False, 'error': f'Mesh 转换失败: {str(e)}'}), 500


@app.route('/api/layer-resources', methods=['GET'])
def list_layer_resources():
    registry = _load_layer_registry()
    return jsonify({
        'success': True,
        'terrain': _list_builtin_layer_resources('terrain') + registry['terrain'],
        'imagery': _list_builtin_layer_resources('imagery') + registry['imagery']
    })


@app.route('/api/layer-resources/upload', methods=['POST'])
def upload_layer_resource():
    kind = str(request.form.get('kind') or '').strip().lower()
    if kind not in LAYER_KIND_DIRS:
        return jsonify({'success': False, 'error': 'kind 必须是 terrain 或 imagery'}), 400

    file = request.files.get('file')
    if not file or not file.filename:
        return jsonify({'success': False, 'error': '请选择 ZIP 文件'}), 400
    if not file.filename.lower().endswith('.zip'):
        return jsonify({'success': False, 'error': '当前仅支持上传 ZIP 切片包'}), 400

    resource_id = uuid.uuid4().hex
    display_name = str(request.form.get('name') or '').strip()
    if not display_name:
        display_name = os.path.splitext(os.path.basename(file.filename))[0] or f'{kind}-{resource_id[:8]}'

    temp_zip = os.path.join(LAYER_UPLOAD_TMP_ROOT, f'{resource_id}.zip')
    temp_extract_root = os.path.join(LAYER_UPLOAD_TMP_ROOT, resource_id)
    final_root = _layer_resource_dir(kind, resource_id)

    try:
        os.makedirs(temp_extract_root, exist_ok=True)
        file.save(temp_zip)

        with zipfile.ZipFile(temp_zip, 'r') as archive:
            _validate_zip_members(archive)
            archive.extractall(temp_extract_root)

        extracted_resource_root = _find_extracted_resource_root(temp_extract_root, kind)
        if not extracted_resource_root:
            required = 'layer.json' if kind == 'terrain' else 'meta.json'
            raise ValueError(f'ZIP 根目录或唯一一级目录必须包含 {required}')

        resource = _build_uploaded_resource(kind, resource_id, display_name, extracted_resource_root)
        if final_root and os.path.isdir(final_root):
            shutil.rmtree(final_root, ignore_errors=True)
        shutil.move(extracted_resource_root, final_root)

        registry = _load_layer_registry()
        registry[kind] = [item for item in registry[kind] if item.get('id') != resource_id]
        registry[kind].append(resource)
        _save_layer_registry(registry)

        return jsonify({'success': True, 'resource': resource})
    except zipfile.BadZipFile:
        return jsonify({'success': False, 'error': 'ZIP 文件无法读取或已损坏'}), 400
    except ValueError as error:
        return jsonify({'success': False, 'error': str(error)}), 400
    except Exception as error:
        return jsonify({'success': False, 'error': f'图层资源上传失败: {str(error)}'}), 500
    finally:
        if os.path.isfile(temp_zip):
            os.remove(temp_zip)
        if os.path.isdir(temp_extract_root):
            shutil.rmtree(temp_extract_root, ignore_errors=True)


@app.route('/api/layer-resources/<kind>/<resource_id>', methods=['DELETE'])
def delete_layer_resource(kind, resource_id):
    kind = str(kind or '').strip().lower()
    if kind not in LAYER_KIND_DIRS:
        return jsonify({'success': False, 'error': '图层类型不存在'}), 404

    registry = _load_layer_registry()
    resource = next((item for item in registry[kind] if item.get('id') == resource_id), None)
    if not resource:
        return jsonify({'success': False, 'error': '只能删除已上传的图层资源'}), 404

    registry[kind] = [item for item in registry[kind] if item.get('id') != resource_id]
    _save_layer_registry(registry)

    resource_dir = _layer_resource_dir(kind, resource_id)
    if resource_dir and os.path.isdir(resource_dir):
        shutil.rmtree(resource_dir, ignore_errors=True)

    return jsonify({'success': True})


@app.route('/api/layer-resources/files/<kind>/<resource_id>/', defaults={'filename': 'layer.json'}, methods=['GET'])
@app.route('/api/layer-resources/files/<kind>/<resource_id>/<path:filename>', methods=['GET'])
def serve_layer_resource_file(kind, resource_id, filename):
    kind = str(kind or '').strip().lower()
    resource_dir = _layer_resource_dir(kind, resource_id)
    if not resource_dir or not os.path.isdir(resource_dir):
        return jsonify({'success': False, 'error': '图层资源不存在'}), 404

    safe_filename = str(filename or '').replace('\\', '/').lstrip('/')
    file_path = os.path.abspath(os.path.join(resource_dir, safe_filename))
    if os.path.commonpath([resource_dir, file_path]) != resource_dir or not os.path.isfile(file_path):
        return jsonify({'success': False, 'error': '图层文件不存在'}), 404

    extension = os.path.splitext(file_path)[1].lower()
    if extension == '.terrain':
        mimetype = 'application/vnd.quantized-mesh'
    elif extension == '.json':
        mimetype = 'application/json'
    else:
        mimetype = mimetypes.guess_type(file_path)[0] or 'application/octet-stream'

    response = send_from_directory(os.path.dirname(file_path), os.path.basename(file_path), mimetype=mimetype)
    response.headers['Cache-Control'] = 'public, max-age=86400'
    return response


def _safe_mesh_job_id(job_id):
    job_id = str(job_id or '')
    if not job_id or any(ch not in '0123456789abcdef-' for ch in job_id.lower()):
        return None
    return job_id


def _mesh_job_output_dir(job_id):
    safe_job_id = _safe_mesh_job_id(job_id)
    if not safe_job_id:
        return None
    output_dir = os.path.abspath(os.path.join(MESH_OUTPUT_ROOT, safe_job_id))
    if os.path.commonpath([MESH_OUTPUT_ROOT, output_dir]) != MESH_OUTPUT_ROOT:
        return None
    return output_dir


def _cleanup_old_mesh_jobs(max_age_seconds=24 * 60 * 60):
    now = time.time()
    for root_dir in (MESH_UPLOAD_ROOT, MESH_OUTPUT_ROOT):
        if not os.path.isdir(root_dir):
            continue
        for name in os.listdir(root_dir):
            path = os.path.join(root_dir, name)
            try:
                if os.path.isdir(path) and now - os.path.getmtime(path) > max_age_seconds:
                    shutil.rmtree(path, ignore_errors=True)
            except Exception:
                pass


@app.route('/api/build-mesh-upload', methods=['POST'])
def build_mesh_cache_from_upload():
    try:
        _cleanup_old_mesh_jobs()
        uploaded_files = request.files.getlist('files')
        if not uploaded_files:
            return jsonify({'success': False, 'error': 'No JSON files uploaded'}), 400

        job_id = str(uuid.uuid4())
        source_dir = os.path.abspath(os.path.join(MESH_UPLOAD_ROOT, job_id))
        output_dir = os.path.abspath(os.path.join(MESH_OUTPUT_ROOT, job_id))
        os.makedirs(source_dir, exist_ok=True)
        os.makedirs(output_dir, exist_ok=True)

        saved_count = 0
        used_names = set()
        for index, file in enumerate(uploaded_files, start=1):
            original_name = os.path.basename(str(file.filename or f'Flood{index}.json').replace('\\', '/'))
            if not original_name.lower().endswith('.json') or original_name.lower().endswith('.mesh.json'):
                continue
            safe_name = secure_filename(original_name) or f'Flood{index}.json'
            base, ext = os.path.splitext(safe_name)
            candidate = safe_name
            duplicate_index = 2
            while candidate.lower() in used_names:
                candidate = f'{base}_{duplicate_index}{ext}'
                duplicate_index += 1
            used_names.add(candidate.lower())
            file.save(os.path.join(source_dir, candidate))
            saved_count += 1

        if saved_count == 0:
            shutil.rmtree(source_dir, ignore_errors=True)
            shutil.rmtree(output_dir, ignore_errors=True)
            return jsonify({'success': False, 'error': 'Uploaded folder does not contain convertible JSON files'}), 400

        script_path = os.path.join(os.path.dirname(__file__), 'build-mesh-cache.cjs')
        if not os.path.isfile(script_path):
            return jsonify({'success': False, 'error': f'Mesh build script not found: {script_path}'}), 500

        env = os.environ.copy()
        env['MESH_WORKERS'] = str(request.form.get('workers') or 4)
        process = subprocess.run(
            ['node', script_path, source_dir, output_dir],
            cwd=os.path.dirname(__file__),
            capture_output=True,
            text=True,
            encoding='utf-8',
            errors='replace',
            env=env
        )

        output = (process.stdout or '') + (process.stderr or '')
        if process.returncode != 0:
            return jsonify({'success': False, 'error': output or f'Mesh build failed with code {process.returncode}'}), 500

        output_names = [name for name in os.listdir(output_dir) if name.lower().endswith('.mesh.json')]
        if os.path.isfile(os.path.join(output_dir, 'index.json')):
            output_names.insert(0, 'index.json')
        output_names = sorted(output_names, key=lambda name: (name.lower() != 'index.json', name.lower()))

        files = [
            {
                'name': name,
                'url': f'/api/build-mesh-upload/{job_id}/file/{quote(name)}',
                'size': os.path.getsize(os.path.join(output_dir, name))
            }
            for name in output_names
        ]

        return jsonify({
            'success': True,
            'message': f'Mesh conversion completed. {saved_count} JSON files processed.',
            'jobId': job_id,
            'files': files,
            'archiveUrl': f'/api/build-mesh-upload/{job_id}/archive',
            'archiveName': f'mesh-output-{job_id[:8]}.zip',
            'output': output
        })
    except Exception as e:
        return jsonify({'success': False, 'error': f'Mesh upload conversion failed: {str(e)}'}), 500


@app.route('/api/build-mesh-upload/<job_id>/file/<path:filename>', methods=['GET'])
def download_mesh_build_file(job_id, filename):
    output_dir = _mesh_job_output_dir(job_id)
    if not output_dir or not os.path.isdir(output_dir):
        return jsonify({'success': False, 'error': 'Mesh job not found'}), 404

    safe_name = os.path.basename(str(filename or '').replace('\\', '/'))
    if safe_name != 'index.json' and not safe_name.lower().endswith('.mesh.json'):
        return jsonify({'success': False, 'error': 'Invalid mesh output file'}), 400

    file_path = os.path.abspath(os.path.join(output_dir, safe_name))
    if os.path.commonpath([output_dir, file_path]) != output_dir or not os.path.isfile(file_path):
        return jsonify({'success': False, 'error': 'Mesh output file not found'}), 404
    return send_from_directory(output_dir, safe_name, mimetype='application/json')


@app.route('/api/build-mesh-upload/<job_id>/archive', methods=['GET'])
def download_mesh_build_archive(job_id):
    output_dir = _mesh_job_output_dir(job_id)
    if not output_dir or not os.path.isdir(output_dir):
        return jsonify({'success': False, 'error': 'Mesh job not found'}), 404

    archive_path = os.path.join(output_dir, 'mesh-output.zip')
    with zipfile.ZipFile(archive_path, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name in os.listdir(output_dir):
            if name == 'mesh-output.zip':
                continue
            if name == 'index.json' or name.lower().endswith('.mesh.json'):
                archive.write(os.path.join(output_dir, name), arcname=name)

    return send_file(
        archive_path,
        mimetype='application/zip',
        as_attachment=True,
        download_name=f'mesh-output-{job_id[:8]}.zip'
    )


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
    # 默认关闭 Flask debug，避免演示/内网穿透部署时暴露调试模式。
    # 如需本地开发调试，可在 PowerShell 中临时执行：$env:FLASK_DEBUG="1"
    debug = os.environ.get('FLASK_DEBUG', '').strip().lower() in {'1', 'true', 'yes', 'on'}
    host = os.environ.get('HOST', '0.0.0.0')
    port = int(os.environ.get('PORT', '5000'))
    app.run(host=host, port=port, debug=debug)
