import argparse
import json
import os
from pathlib import Path
from typing import Dict, List, Sequence, Tuple
import numpy as np

try:
    import cupy as cp  # type: ignore
except ImportError:  # pragma: no cover - optional dependency
    cp = None  # CUDA acceleration will be disabled


def parse_dem(dem_path: Path) -> Tuple[np.ndarray, Dict[str, float]]:
    """Read DEM ASCII grid, returning height grid and header values."""
    with dem_path.open("r", encoding="utf-8") as f:
        header_lines = [next(f).strip() for _ in range(6)]
        header: Dict[str, float] = {}
        for line in header_lines:
            parts = line.split()
            if len(parts) >= 2:
                header[parts[0].lower()] = float(parts[-1])
        data = np.loadtxt(f, dtype=np.float32)
    nrows = int(header.get("nrows", data.shape[0]))
    ncols = int(header.get("ncols", data.shape[1] if data.ndim > 1 else 1))
    data = data.reshape((nrows, ncols))
    return data.astype(np.float32), header


def parse_depth(depth_path: Path, shape: Tuple[int, int]) -> np.ndarray:
    """Read depth ASCII grid (6-line header + body) with robust fallback.

    Primary path uses numpy.loadtxt. If column count is irregular, falls back to
    tokenizing all numeric values and reshaping/padding/truncating to expected shape.
    """
    try:
        with depth_path.open("r", encoding="utf-8") as f:
            for _ in range(6):
                next(f, None)
            data = np.loadtxt(f, dtype=np.float32)
        return data.reshape(shape)
    except Exception as e:
        try:
            with depth_path.open("r", encoding="utf-8") as f:
                for _ in range(6):
                    next(f, None)
                text = f.read()
            text = text.replace(",", " ")
            tokens = text.split()
            values: List[float] = []
            for tok in tokens:
                try:
                    values.append(float(tok))
                except ValueError:
                    continue
            expected = int(shape[0] * shape[1])
            if len(values) < expected:
                values.extend([0.0] * (expected - len(values)))
            elif len(values) > expected:
                values = values[:expected]
            arr = np.asarray(values, dtype=np.float32).reshape(shape)
            print(f"Warning: used fallback parser for {depth_path.name} due to irregular columns ({e})")
            return arr
        except Exception:
            raise


def build_index_map(grid_depth: np.ndarray) -> Tuple[Dict[Tuple[int, int], int], List[Tuple[int, int]]]:
    positions: List[Tuple[int, int]] = []
    h, w = grid_depth.shape
    for i in range(h):
        row = grid_depth[i]
        for j in range(w):
            if row[j] != 0:
                positions.append((i, j))
    mapping = {(i, j): idx for idx, (i, j) in enumerate(positions)}
    return mapping, positions


def triangulate(grid_depth: np.ndarray, index_map: Dict[Tuple[int, int], int]) -> List[Tuple[int, int, int]]:
    """Vectorized triangulation of the grid."""
    print("开始三角剖分...")
    h, w = grid_depth.shape
    
    # 1. 识别所有有效点 (depth != 0)
    valid_mask = grid_depth != 0
    
    # 2. 创建四个偏移的有效点掩码，用于识别邻居
    #    - p_tl (top-left): 当前点 (i, j)
    #    - p_tr (top-right): 右侧点 (i, j+1)
    #    - p_bl (bottom-left):下方点 (i+1, j)
    #    - p_br (bottom-right): 右下角点 (i+1, j+1)
    p_tl = valid_mask[:-1, :-1]
    p_tr = valid_mask[:-1, 1:]
    p_bl = valid_mask[1:, :-1]
    p_br = valid_mask[1:, 1:]

    triangles: List[Tuple[int, int, int]] = []

    # 3. 组合一: (i,j), (i+1,j), (i+1,j+1)
    #    - 条件: p_tl, p_bl, p_br 都有效
    mask1 = p_tl & p_bl & p_br
    indices1 = np.argwhere(mask1)
    for i, j in indices1:
        idx1 = index_map[(i, j)]
        idx2 = index_map[(i + 1, j)]
        idx3 = index_map[(i + 1, j + 1)]
        triangles.append((idx1, idx2, idx3))

    # 4. 组合二: (i,j), (i+1,j+1), (i,j+1)
    #    - 条件: p_tl, p_br, p_tr 都有效
    mask2 = p_tl & p_br & p_tr
    indices2 = np.argwhere(mask2)
    for i, j in indices2:
        idx1 = index_map[(i, j)]
        idx2 = index_map[(i + 1, j + 1)]
        idx3 = index_map[(i, j + 1)]
        triangles.append((idx1, idx2, idx3))
        
    print(f"三角剖分完成，生成 {len(triangles)} 个三角形。")
    return triangles


def build_vectors_and_depths(
    positions: Sequence[Tuple[int, int]], grid_dem: np.ndarray, grid_depth: np.ndarray
) -> Tuple[List[float], List[float], float, float]:
    vectors: List[float] = []
    depths: List[float] = []
    min_depth = float("inf")
    max_depth = float("-inf")

    for i, j in positions:
        z = float(grid_dem[i, j])
        depth_val = round(float(grid_depth[i, j]), 1)
        # depth_val = int(float(grid_depth[i, j]))
        vectors.extend([float(i), float(j), float(z)])
        depths.append(depth_val)
        if depth_val < min_depth:
            min_depth = depth_val
        if depth_val > max_depth:
            max_depth = depth_val

    if not depths:
        min_depth = 0.0
        max_depth = 0.0

    return vectors, depths, min_depth, max_depth


def write_json(
    out_path: Path,
    vectors: List[float],
    faces: List[Tuple[int, int, int]],
    depths: List[float],
    min_depth: float,
    max_depth: float,
    rush_time: str,
    disaster_area: float,
) -> None:
    face_flat: List[int] = []
    for a, b, c in faces:
        face_flat.extend([a, b, c])

    v_str = json.dumps(vectors, separators=(",", ":"))
    f_str = json.dumps(face_flat, separators=(",", ":"))
    d_str = json.dumps([depths, [min_depth, max_depth]], separators=(",", ":"))
    i_str = json.dumps({
        "RushTime": rush_time,
        "RestVolum": 0,
        "DisasterArea": disaster_area
    }, separators=(",", ":"))

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as f:
        f.write("{\n")
        f.write(f'"Vector":{v_str},\n')
        f.write(f'"Face":{f_str},\n')
        f.write(f'"Depth":{d_str},\n')
        f.write(f'"Information":{i_str}\n')
        f.write("}")


def write_xml(xml_path: Path, flood_files: List[str]) -> None:
    import xml.etree.ElementTree as ET

    root = ET.Element("floods")
    for fname in flood_files:
        node = ET.SubElement(root, "flood")
        node.set("url", fname)

    tree = ET.ElementTree(root)
    try:
        ET.indent(tree, space="    ", level=0)  # type: ignore[attr-defined]
    except AttributeError:
        pass

    xml_path.parent.mkdir(parents=True, exist_ok=True)
    tree.write(xml_path, encoding="utf-8", xml_declaration=True)


def sorted_depth_files(depth_dir: Path) -> List[Path]:
    txt_files = list(depth_dir.glob("*.txt"))
    def sort_key(p: Path):
        try:
            return int(p.stem)
        except ValueError:
            return p.stem
    return sorted(txt_files, key=sort_key)


def main() -> None:
    parser = argparse.ArgumentParser(description="Convert grid + depth TXT to TIN-style JSON and XML.")
    parser.add_argument("--dem", type=Path, default=Path(r"D:/Chain1/gtt/TXT/dem.asc"), help="Path to DEM ASCII grid (.asc)")
    parser.add_argument("--depth-dir", type=Path, default=Path(r"D:/Chain1/gtt/TXT"), help="Directory containing depth TXT files")
    parser.add_argument("--output-dir", type=Path, default=Path(r"D:/Chain1/gtt/JSON"), help="Directory to write JSON outputs")
    parser.add_argument("--xml", type=Path, default=None, help="Path to summary XML (default: output-dir/Flood_New.xml)")
    parser.add_argument("--use-cuda", action="store_true", help="Try to use CuPy for acceleration if available")
    args = parser.parse_args()

    grid_dem, header = parse_dem(args.dem)
    nrows, ncols = grid_dem.shape
    shape = (nrows, ncols)

    depth_files = sorted_depth_files(args.depth_dir)
    if not depth_files:
        raise FileNotFoundError(f"No .txt files found in {args.depth_dir}")

    # Ensure output directory exists and is a directory (not a file), otherwise give a clear error.
    try:
        if args.output_dir.exists() and not args.output_dir.is_dir():
            raise NotADirectoryError(f"Output path {args.output_dir} exists and is not a directory. Choose another --output-dir.")
        args.output_dir.mkdir(parents=True, exist_ok=True)
    except PermissionError as exc:
        raise PermissionError(
            f"Cannot create or write to {args.output_dir}. Check permissions or pick another --output-dir."
        ) from exc

    xml_path = args.xml or args.output_dir / "Flood_New.xml"
    generated_files: List[str] = []

    for idx, depth_file in enumerate(depth_files, start=1):
        grid_depth = parse_depth(depth_file, shape)

        if not np.any(grid_depth):
            print(f"Skipped {depth_file} (all depths are zero)")
            continue

        if args.use_cuda and cp is not None:
            depth_gpu = cp.asarray(grid_depth)
            # Fetch back only when needed for Python loops.
            grid_depth = cp.asnumpy(depth_gpu)

        index_map, positions = build_index_map(grid_depth)
        faces = triangulate(grid_depth, index_map)
        vectors, depths, min_depth, max_depth = build_vectors_and_depths(positions, grid_dem, grid_depth)

        # 统一命名：Flood<数字>.json
        num_str = None
        stem = depth_file.stem
        if stem.isdigit():
            num_str = stem
        else:
            try:
                import re  # 延迟导入避免全局依赖
                m = re.search(r"(\d+)", stem)
                if m:
                    num_str = m.group(1)
            except Exception:
                pass
        if num_str is None:
            num_str = str(idx)
        # 去前导零，保持 Flood15.json 这种格式
        try:
            num_val = int(num_str)
            num_str = str(num_val)
            
            # 计算 RushTime: 假设每帧2秒
            total_seconds = num_val * 2
            h = total_seconds // 3600
            m = (total_seconds % 3600) // 60
            s = total_seconds % 60
            if h > 0:
                rush_time = f"{h}h{m}min{s}s"
            elif m > 0:
                rush_time = f"{m}min{s}s"
            else:
                rush_time = f"{s}s"
        except Exception:
            rush_time = "00h00min00s"

        out_name = f"Flood{num_str}.json"
        out_path = args.output_dir / out_name
        
        # 计算灾区面积: 有效点数量 * 像元面积
        cellsize = float(header.get("cellsize", 10.0))
        disaster_area = len(positions) * cellsize * cellsize

        write_json(out_path, vectors, faces, depths, min_depth, max_depth, rush_time, disaster_area)
        generated_files.append(out_name)
        print(f"Exported {out_path}")

    write_xml(xml_path, generated_files)
    print(f"XML summary written to {xml_path}")


if __name__ == "__main__":
    main()
