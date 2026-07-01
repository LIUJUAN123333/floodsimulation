const fs = require("fs");
const os = require("os");
const path = require("path");
const { Worker, isMainThread, parentPort, workerData } = require("worker_threads");

const root = path.resolve(__dirname, ".");

const sourceDir = path.resolve(
  root,
  workerData?.sourceDir ||
    process.argv[2] ||
    process.env.MESH_SOURCE_DIR ||
    "temp",
);

const outputDir = path.resolve(
  root,
  workerData?.outputDir ||
    process.argv[3] ||
    process.env.MESH_OUTPUT_DIR ||
    "mesh",
);

/*
 * 允许跨越的最大格网列数。
 *
 * 1：只连接严格相邻格网，最安全，但水面边缘可能略有空洞。
 * 2：允许跨 1 个缺失点。
 * 3：允许跨 2 个缺失点。
 *
 * 建议先用 2。
 */
const gridMaxGap = Number(process.env.MESH_GRID_MAX_GAP || 2);

/*
 * 同一行最大允许列数。
 * 这个值只用于识别一行是否结束。
 */
const gridRowMaxGap = Number(process.env.MESH_GRID_ROW_MAX_GAP || 1000);

const boundaryEdgeScale = Number(
  process.env.MESH_BOUNDARY_EDGE_SCALE || 1.9,
);

const triangulationMode =
  process.env.MESH_TRIANGULATION || "auto";

const workerCount = Math.max(
  1,
  Math.min(
    Number(
      process.env.MESH_WORKERS ||
        Math.max(os.cpus().length - 1, 1),
    ),
    os.cpus().length,
  ),
);

/* ============================================================
   读取标准 JSON 或旧式 JS 对象文本
   ============================================================ */
function parseLooseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return new Function(`return (${text});`)();
  }
}

/* ============================================================
   提取并清洗点
   ============================================================ */
function normalizePoints(data) {
  const rawPoints = Array.isArray(data)
    ? data
    : data?.points || data?.data || [];

  const unique = new Map();

  for (const point of rawPoints) {
    const x = Number(point?.x);
    const y = Number(point?.y);
    const value = Number(point?.value);

    if (
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      !Number.isFinite(value)
    ) {
      continue;
    }

    const key = `${x.toFixed(9)},${y.toFixed(9)}`;

    const old = unique.get(key);

    if (!old || value > old.value) {
      unique.set(key, { x, y, value });
    }
  }

  return [...unique.values()];
}

/* ============================================================
   通用工具
   ============================================================ */
function median(values) {
  if (!values.length) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }

  return (sorted[middle - 1] + sorted[middle]) * 0.5;
}

function pointKey(point) {
  return `${point.x.toFixed(9)},${point.y.toFixed(9)}`;
}

function edgeKey(a, b) {
  return a < b ? `${a},${b}` : `${b},${a}`;
}

/* ============================================================
   经纬度转近似平面米坐标
   仅用于判断边长、Delaunay 三角化
   ============================================================ */
function buildScaledPoints(points) {
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));

  const centerY = (minY + maxY) * 0.5;

  const meterX =
    Math.cos((centerY * Math.PI) / 180) * 111320;

  const meterY = 110540;

  return points.map((point) => ({
    ...point,
    sx: (point.x - minX) * meterX,
    sy: (point.y - minY) * meterY,
  }));
}

function distance(points, a, b) {
  const dx = points[a].sx - points[b].sx;
  const dy = points[a].sy - points[b].sy;

  return Math.sqrt(dx * dx + dy * dy);
}

/* ============================================================
   Delaunay 备用算法
   仅当无法识别规则网格时使用
   ============================================================ */
function circumcircle(points, a, b, c) {
  const ax = points[a].sx;
  const ay = points[a].sy;
  const bx = points[b].sx;
  const by = points[b].sy;
  const cx = points[c].sx;
  const cy = points[c].sy;

  const d =
    2 * (
      ax * (by - cy) +
      bx * (cy - ay) +
      cx * (ay - by)
    );

  if (Math.abs(d) < 1e-12) {
    return null;
  }

  const ax2ay2 = ax * ax + ay * ay;
  const bx2by2 = bx * bx + by * by;
  const cx2cy2 = cx * cx + cy * cy;

  const ux =
    (
      ax2ay2 * (by - cy) +
      bx2by2 * (cy - ay) +
      cx2cy2 * (ay - by)
    ) / d;

  const uy =
    (
      ax2ay2 * (cx - bx) +
      bx2by2 * (ax - cx) +
      cx2cy2 * (bx - ax)
    ) / d;

  const dx = ux - ax;
  const dy = uy - ay;

  return {
    x: ux,
    y: uy,
    r2: dx * dx + dy * dy,
  };
}

function makeTriangle(points, a, b, c) {
  const orientation =
    (points[b].sx - points[a].sx) *
      (points[c].sy - points[a].sy) -
    (points[b].sy - points[a].sy) *
      (points[c].sx - points[a].sx);

  const triangle =
    orientation >= 0
      ? { a, b, c }
      : { a, b: c, c: b };

  const circle = circumcircle(
    points,
    triangle.a,
    triangle.b,
    triangle.c,
  );

  if (!circle) {
    return null;
  }

  return {
    ...triangle,
    circle,
  };
}

function addBoundaryEdge(edges, a, b) {
  const forward = `${a},${b}`;
  const reverse = `${b},${a}`;

  if (edges.has(reverse)) {
    edges.delete(reverse);
    return;
  }

  edges.set(forward, [a, b]);
}

function getBoundaryEdgeLimit(points, indices) {
  const lengths = [];
  const seen = new Set();

  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i];
    const b = indices[i + 1];
    const c = indices[i + 2];

    const edges = [
      [a, b],
      [b, c],
      [c, a],
    ];

    for (const [from, to] of edges) {
      const key = edgeKey(from, to);

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      lengths.push(distance(points, from, to));
    }
  }

  return median(lengths) * boundaryEdgeScale;
}

function filterBoundaryTriangles(points, indices) {
  const edgeLimit = getBoundaryEdgeLimit(points, indices);

  if (
    !Number.isFinite(edgeLimit) ||
    edgeLimit <= 0
  ) {
    return indices;
  }

  const filtered = [];

  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i];
    const b = indices[i + 1];
    const c = indices[i + 2];

    const maxEdge = Math.max(
      distance(points, a, b),
      distance(points, b, c),
      distance(points, c, a),
    );

    if (maxEdge <= edgeLimit) {
      filtered.push(a, b, c);
    }
  }

  return filtered;
}

function buildDelaunayTriangles(points) {
  if (points.length < 3) {
    return [];
  }

  const scaledPoints = buildScaledPoints(points);

  const sxValues = scaledPoints.map((point) => point.sx);
  const syValues = scaledPoints.map((point) => point.sy);

  const sxMin = Math.min(...sxValues);
  const sxMax = Math.max(...sxValues);
  const syMin = Math.min(...syValues);
  const syMax = Math.max(...syValues);

  const span = Math.max(
    sxMax - sxMin,
    syMax - syMin,
    1,
  );

  const baseIndex = scaledPoints.length;

  scaledPoints.push(
    {
      sx: sxMin - 16 * span,
      sy: syMin - span,
    },
    {
      sx: sxMin + 0.5 * span,
      sy: syMax + 16 * span,
    },
    {
      sx: sxMax + 16 * span,
      sy: syMin - span,
    },
  );

  let triangles = [
    makeTriangle(
      scaledPoints,
      baseIndex,
      baseIndex + 1,
      baseIndex + 2,
    ),
  ];

  for (let pointIndex = 0; pointIndex < points.length; pointIndex++) {
    const point = scaledPoints[pointIndex];

    const edges = new Map();
    const kept = [];

    for (const triangle of triangles) {
      const dx = point.sx - triangle.circle.x;
      const dy = point.sy - triangle.circle.y;

      if (dx * dx + dy * dy <= triangle.circle.r2 + 1e-9) {
        addBoundaryEdge(edges, triangle.a, triangle.b);
        addBoundaryEdge(edges, triangle.b, triangle.c);
        addBoundaryEdge(edges, triangle.c, triangle.a);
      } else {
        kept.push(triangle);
      }
    }

    for (const [a, b] of edges.values()) {
      const triangle = makeTriangle(
        scaledPoints,
        a,
        b,
        pointIndex,
      );

      if (triangle) {
        kept.push(triangle);
      }
    }

    triangles = kept;
  }

  const indices = [];

  for (const triangle of triangles) {
    if (
      triangle.a >= points.length ||
      triangle.b >= points.length ||
      triangle.c >= points.length
    ) {
      continue;
    }

    indices.push(
      triangle.a,
      triangle.b,
      triangle.c,
    );
  }

  return filterBoundaryTriangles(
    scaledPoints,
    indices,
  );
}

/* ============================================================
   规则网格识别
   ============================================================ */
function getConsecutiveDeltas(points) {
  const deltas = [];

  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;

    const length = Math.sqrt(dx * dx + dy * dy);

    if (length > 0) {
      deltas.push({ dx, dy, length });
    }
  }

  return deltas;
}

function inferColumnVector(points) {
  const deltas = getConsecutiveDeltas(points);

  if (!deltas.length) {
    return null;
  }

  const minLength = Math.min(
    ...deltas.map((delta) => delta.length),
  );

  const candidates = deltas.filter(
    (delta) =>
      delta.dx > 0 &&
      delta.length <= minLength * 1.8 &&
      Math.abs(delta.dy) <= Math.abs(delta.dx) * 0.25,
  );

  if (
    candidates.length <
    Math.max(3, Math.floor(points.length * 0.05))
  ) {
    return null;
  }

  return {
    dx: median(candidates.map((item) => item.dx)),
    dy: median(candidates.map((item) => item.dy)),
  };
}

function isSameGridRow(delta, columnVector) {
  const length2 =
    columnVector.dx * columnVector.dx +
    columnVector.dy * columnVector.dy;

  if (length2 <= 0) {
    return false;
  }

  const projection =
    (
      delta.dx * columnVector.dx +
      delta.dy * columnVector.dy
    ) / length2;

  const step = Math.round(projection);

  if (
    step < 1 ||
    step > gridRowMaxGap
  ) {
    return false;
  }

  const residualX =
    delta.dx - step * columnVector.dx;

  const residualY =
    delta.dy - step * columnVector.dy;

  const residualLength = Math.sqrt(
    residualX * residualX +
    residualY * residualY,
  );

  const stepLength = Math.sqrt(length2);

  return residualLength <= stepLength * 0.35;
}

function getRowItems(
  points,
  row,
  origin,
  columnVector,
  length2,
) {
  const items = [];

  for (const index of row) {
    const point = points[index];

    const dx = point.x - origin.x;
    const dy = point.y - origin.y;

    const projection =
      (
        dx * columnVector.dx +
        dy * columnVector.dy
      ) / length2;

    items.push({
      index,
      column: Math.round(projection),
    });
  }

  items.sort((a, b) => a.column - b.column);

  return items;
}

/* ============================================================
   判断两个行列号是否跨越太大缺口
   ============================================================ */
function hasLargeColumnGap(a, b) {
  return Math.abs(a.column - b.column) > gridMaxGap;
}

/*
 * 判断三角形三个点是否允许连接。
 *
 * 关键：不增加顶点，只拒绝跨越过大空洞的三角形。
 */
function canBuildGridTriangle(a, b, c) {
  if (!a || !b || !c) {
    return false;
  }

  return !(
    hasLargeColumnGap(a, b) ||
    hasLargeColumnGap(a, c) ||
    hasLargeColumnGap(b, c)
  );
}

function addGridTriangle(
  points,
  triangles,
  a,
  b,
  c,
) {
  if (
    a === b ||
    b === c ||
    c === a
  ) {
    return;
  }

  const ax = points[a].x;
  const ay = points[a].y;
  const bx = points[b].x;
  const by = points[b].y;
  const cx = points[c].x;
  const cy = points[c].y;

  const area2 =
    (bx - ax) * (cy - ay) -
    (by - ay) * (cx - ax);

  if (Math.abs(area2) < 1e-15) {
    return;
  }

  if (area2 > 0) {
    triangles.push(a, b, c);
  } else {
    triangles.push(a, c, b);
  }
}

/* ============================================================
   核心修改：稀疏行之间安全拼接

   不补齐点；
   不创建新顶点；
   只阻止跨空洞的大三角形。
   ============================================================ */
function addGridStripTriangles(
  points,
  triangles,
  upperRow,
  lowerRow,
) {
  if (
    !upperRow.length ||
    !lowerRow.length ||
    upperRow.length + lowerRow.length < 3
  ) {
    return;
  }

  const minColumn = Math.max(
    upperRow[0].column,
    lowerRow[0].column,
  );

  const maxColumn = Math.min(
    upperRow[upperRow.length - 1].column,
    lowerRow[lowerRow.length - 1].column,
  );

  if (maxColumn <= minColumn) {
    return;
  }

  const upper = upperRow.filter(
    (item) =>
      item.column >= minColumn &&
      item.column <= maxColumn,
  );

  const lower = lowerRow.filter(
    (item) =>
      item.column >= minColumn &&
      item.column <= maxColumn,
  );

  if (
    !upper.length ||
    !lower.length ||
    upper.length + lower.length < 3
  ) {
    return;
  }

  let upperIndex = 0;
  let lowerIndex = 0;

  while (
    upperIndex < upper.length - 1 ||
    lowerIndex < lower.length - 1
  ) {
    if (upperIndex >= upper.length - 1) {
      const p1 = lower[lowerIndex];
      const p2 = lower[lowerIndex + 1];
      const p3 = upper[upperIndex];

      if (canBuildGridTriangle(p1, p2, p3)) {
        addGridTriangle(
          points,
          triangles,
          p1.index,
          p2.index,
          p3.index,
        );
      }

      lowerIndex++;
      continue;
    }

    if (lowerIndex >= lower.length - 1) {
      const p1 = upper[upperIndex];
      const p2 = upper[upperIndex + 1];
      const p3 = lower[lowerIndex];

      if (canBuildGridTriangle(p1, p2, p3)) {
        addGridTriangle(
          points,
          triangles,
          p1.index,
          p2.index,
          p3.index,
        );
      }

      upperIndex++;
      continue;
    }

    const nextUpper = upper[upperIndex + 1];
    const nextLower = lower[lowerIndex + 1];

    if (nextUpper.column <= nextLower.column) {
      const p1 = upper[upperIndex];
      const p2 = nextUpper;
      const p3 = lower[lowerIndex];

      if (canBuildGridTriangle(p1, p2, p3)) {
        addGridTriangle(
          points,
          triangles,
          p1.index,
          p2.index,
          p3.index,
        );
      }

      upperIndex++;
    } else {
      const p1 = upper[upperIndex];
      const p2 = nextLower;
      const p3 = lower[lowerIndex];

      if (canBuildGridTriangle(p1, p2, p3)) {
        addGridTriangle(
          points,
          triangles,
          p1.index,
          p2.index,
          p3.index,
        );
      }

      lowerIndex++;
    }
  }
}

function buildGridTriangles(points) {
  if (points.length < 3) {
    return [];
  }

  const columnVector = inferColumnVector(points);

  if (!columnVector) {
    return null;
  }

  const rows = [[]];

  for (let index = 0; index < points.length; index++) {
    if (index > 0) {
      const delta = {
        dx: points[index].x - points[index - 1].x,
        dy: points[index].y - points[index - 1].y,
      };

      if (!isSameGridRow(delta, columnVector)) {
        rows.push([]);
      }
    }

    rows[rows.length - 1].push(index);
  }

  if (rows.length < 2) {
    return null;
  }

  const origin = points[0];

  const length2 =
    columnVector.dx * columnVector.dx +
    columnVector.dy * columnVector.dy;

  const rowItems = rows.map((row) =>
    getRowItems(
      points,
      row,
      origin,
      columnVector,
      length2,
    ),
  );

  const triangles = [];

  for (let rowIndex = 0; rowIndex < rowItems.length - 1; rowIndex++) {
    addGridStripTriangles(
      points,
      triangles,
      rowItems[rowIndex],
      rowItems[rowIndex + 1],
    );
  }

  return triangles.length ? triangles : null;
}

/* ============================================================
   构建单个 Mesh
   ============================================================ */
function buildMesh(fileName) {
  const inputPath = path.join(sourceDir, fileName);

  const data = parseLooseJson(
    fs.readFileSync(inputPath, "utf8"),
  );

  const sourcePoints = normalizePoints(data);

  if (sourcePoints.length < 3) {
    throw new Error(
      `${fileName} 有效点不足，无法生成 mesh。`,
    );
  }

  const gridTriangles =
    triangulationMode !== "delaunay"
      ? buildGridTriangles(sourcePoints)
      : null;

  const points = gridTriangles
    ? sourcePoints
    : [...sourcePoints].sort(
        (a, b) => a.y - b.y || a.x - b.x,
      );

  const triangles =
    gridTriangles &&
    triangulationMode !== "delaunay"
      ? gridTriangles
      : buildDelaunayTriangles(points);

  const positions = [];
  const values = [];

  for (const point of points) {
    positions.push(point.x, point.y);
    values.push(point.value);
  }

  const stats = points.reduce(
    (acc, point) => {
      acc.minX = Math.min(acc.minX, point.x);
      acc.maxX = Math.max(acc.maxX, point.x);
      acc.minY = Math.min(acc.minY, point.y);
      acc.maxY = Math.max(acc.maxY, point.y);
      acc.minValue = Math.min(
        acc.minValue,
        point.value,
      );
      acc.maxValue = Math.max(
        acc.maxValue,
        point.value,
      );

      return acc;
    },
    {
      minX: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
      minValue: Number.POSITIVE_INFINITY,
      maxValue: Number.NEGATIVE_INFINITY,
    },
  );

  return {
    source: fileName,
    frame: Number.parseInt(
      path.basename(fileName, ".json"),
      10,
    ),
    triangulation: gridTriangles
      ? "grid-sparse-safe"
      : "delaunay",
    pointCount: points.length,
    triangleCount: triangles.length / 3,
    stats,
    positions,
    values,
    triangles,
  };
}

function convertOneFile(fileName) {
  const mesh = buildMesh(fileName);

  const outputName =
    `${path.basename(fileName, ".json")}.mesh.json`;

  const outputPath = path.join(outputDir, outputName);

  fs.writeFileSync(
    outputPath,
    JSON.stringify(mesh),
    "utf8",
  );

  return {
    source: fileName,
    output: outputName,
    index: Number.parseInt(path.basename(fileName, ".json"), 10),
    pointCount: mesh.pointCount,
    triangleCount: mesh.triangleCount,
    triangulation: mesh.triangulation,
    stats: mesh.stats,
  };
}

/* ============================================================
   Worker
   ============================================================ */
function runWorker() {
  const files = workerData.files || [];
  const results = [];
  const errors = [];

  for (const fileName of files) {
    try {
      results.push(convertOneFile(fileName));
    } catch (error) {
      errors.push({
        fileName,
        error: error.message,
      });
    }
  }

  parentPort.postMessage({ results, errors });
}

function splitFiles(files, count) {
  const groups = Array.from(
    { length: count },
    () => [],
  );

  files.forEach((file, index) => {
    groups[index % count].push(file);
  });

  return groups.filter((group) => group.length);
}

/* ============================================================
   主线程
   ============================================================ */
async function runMain() {
  if (!fs.existsSync(sourceDir)) {
    throw new Error(`输入目录不存在：${sourceDir}`);
  }

  fs.mkdirSync(outputDir, {
    recursive: true,
  });

  const files = fs.readdirSync(sourceDir)
    .filter(
      (fileName) =>
        fileName.toLowerCase().endsWith(".json") &&
        !fileName.toLowerCase().endsWith(".mesh.json"),
    )
    .sort((a, b) => {
      const indexA = Number.parseInt(
        path.basename(a, ".json"),
        10,
      );

      const indexB = Number.parseInt(
        path.basename(b, ".json"),
        10,
      );

      if (
        Number.isFinite(indexA) &&
        Number.isFinite(indexB)
      ) {
        return indexA - indexB;
      }

      return a.localeCompare(b);
    });

  if (!files.length) {
    console.log("未找到可转换的 JSON 文件。");
    return;
  }

  const groups = splitFiles(
    files,
    Math.min(workerCount, files.length),
  );

  const jobs = groups.map(
    (group) =>
      new Promise((resolve, reject) => {
        const worker = new Worker(__filename, {
          workerData: {
            sourceDir,
            outputDir,
            files: group,
          },
        });

        worker.on("message", resolve);
        worker.on("error", reject);

        worker.on("exit", (code) => {
          if (code !== 0) {
            reject(
              new Error(
                `Worker 异常退出，退出码：${code}`,
              ),
            );
          }
        });
      }),
  );

  const workerResults = await Promise.all(jobs);

  const results = [];
  const errors = [];

  for (const result of workerResults) {
    results.push(...result.results);
    errors.push(...result.errors);
  }

  results.sort((a, b) => {
    const indexA = Number.isFinite(a.index) ? a.index : Number.MAX_SAFE_INTEGER;
    const indexB = Number.isFinite(b.index) ? b.index : Number.MAX_SAFE_INTEGER;
    return indexA - indexB || a.source.localeCompare(b.source);
  });

  const index = {
    generatedAt: new Date().toISOString(),
    frames: results.map((item, position) => ({
      name: item.output,
      index: Number.isFinite(item.index) ? item.index : position + 1,
      url: `/mesh/${item.output}`,
      pointCount: item.pointCount,
      triangleCount: item.triangleCount,
      triangulation: item.triangulation,
      stats: item.stats,
    })),
  };

  fs.writeFileSync(
    path.join(outputDir, "index.json"),
    JSON.stringify(index),
    "utf8",
  );

  for (const item of results) {
    console.log(
      `[完成] ${item.source} -> ${item.output}` +
        ` | 点数：${item.pointCount}` +
        ` | 三角形：${item.triangleCount}` +
        ` | 方法：${item.triangulation}`,
    );
  }

  for (const item of errors) {
    console.error(
      `[失败] ${item.fileName}：${item.error}`,
    );
  }

  console.log(
    `完成：成功 ${results.length} 个，失败 ${errors.length} 个。`,
  );
}

if (isMainThread) {
  runMain().catch((error) => {
    console.error(error);
    process.exit(1);
  });
} else {
  runWorker();
}
