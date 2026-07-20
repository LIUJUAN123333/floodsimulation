import proj4 from 'proj4';
import type {
  ShapefileAttributeSummary,
  ShapefileComponentCheck,
  ShapefileComponentExtension,
  ShapefileCrsSummary,
  ShapefileGeometrySummary,
  ShapefileImportReport,
  ShapefileImportSource,
  ShapefileRouteImportResult
} from '../types/shapefile';

type Coordinate = [number, number];

interface DatasetFiles {
  datasetName: string;
  files: Partial<Record<ShapefileComponentExtension, File>>;
}

interface ParsedShp {
  shapeType: number;
  recordCount: number;
  parts: Coordinate[][];
  pointCount: number;
  hasZ: boolean;
  declaredLengthBytes: number;
}

interface ParsedShx {
  shapeType: number;
  recordCount: number;
  declaredLengthBytes: number;
  records: Array<{ offsetBytes: number; contentLengthBytes: number }>;
}

interface ParsedDbf {
  summary: ShapefileAttributeSummary;
  headerLength: number;
  recordLength: number;
}

const COMPONENT_LABELS: Record<ShapefileComponentExtension, string> = {
  shp: '几何',
  shx: '索引',
  dbf: '属性',
  prj: '坐标系',
  cpg: '编码'
};

const REQUIRED_COMPONENTS: ShapefileComponentExtension[] = ['shp', 'shx', 'dbf', 'prj'];
const SUPPORTED_COMPONENTS = new Set<ShapefileComponentExtension>(['shp', 'shx', 'dbf', 'prj', 'cpg']);
const LINE_SHAPE_TYPES = new Set([3, 13, 23]);
const MAX_DATASET_SIZE = 150 * 1024 * 1024;
const MAX_ROUTE_CONTROL_POINTS = 5000;
const CONNECT_TOLERANCE_METERS = 8;
const EARTH_RADIUS_METERS = 6378137;

export class ShapefileImportError extends Error {
  report: ShapefileImportReport;

  constructor(message: string, report: ShapefileImportReport) {
    super(message);
    this.name = 'ShapefileImportError';
    this.report = report;
  }
}

const extensionOf = (fileName: string) => {
  const match = /\.([^.]+)$/.exec(fileName.toLowerCase());
  return match?.[1] ?? '';
};

const datasetKeyOf = (file: File) => {
  const path = file.webkitRelativePath || file.name;
  return path.replace(/\.[^.]+$/, '').replaceAll('\\', '/').toLowerCase();
};

const fileStemOf = (file: File) => file.name.replace(/\.[^.]+$/, '');

const createComponentChecks = (
  files: Partial<Record<ShapefileComponentExtension, File>>
): ShapefileComponentCheck[] => (
  (Object.keys(COMPONENT_LABELS) as ShapefileComponentExtension[]).map((extension) => {
    const required = REQUIRED_COMPONENTS.includes(extension);
    const present = Boolean(files[extension]);
    return {
      extension,
      label: COMPONENT_LABELS[extension],
      required,
      present,
      status: present ? 'passed' : required ? 'error' : 'warning',
      detail: present
        ? files[extension]?.name ?? `.${extension}`
        : required
          ? `缺少 .${extension}`
          : '可选文件'
    };
  })
);

const createReport = (
  source: ShapefileImportSource,
  datasetName: string,
  files: Partial<Record<ShapefileComponentExtension, File>>
): ShapefileImportReport => ({
  status: 'error',
  source,
  datasetName,
  componentChecks: createComponentChecks(files),
  warnings: [],
  message: ''
});

const fail = (report: ShapefileImportReport, message: string): never => {
  report.status = 'error';
  report.message = message;
  throw new ShapefileImportError(message, report);
};

const collectDatasetFiles = (
  inputFiles: File[],
  source: ShapefileImportSource
): { dataset: DatasetFiles; report: ShapefileImportReport } => {
  const supported = inputFiles.filter((file) => (
    SUPPORTED_COMPONENTS.has(extensionOf(file.name) as ShapefileComponentExtension)
  ));
  const shpFiles = supported.filter((file) => extensionOf(file.name) === 'shp');

  if (shpFiles.length === 0) {
    const report = createReport(source, '未识别数据集', {});
    fail(report, '未找到 .shp 主文件，请选择同一航线数据集的全部文件。');
  }
  if (shpFiles.length > 1) {
    const report = createReport(source, '多个数据集', {});
    const names = shpFiles.slice(0, 4).map((file) => file.name).join('、');
    fail(report, `检测到多个 .shp 数据集（${names}），请一次只导入一套航线。`);
  }

  const shpFile = shpFiles[0];
  const datasetKey = datasetKeyOf(shpFile);
  const groupedFiles: Partial<Record<ShapefileComponentExtension, File>> = {};

  supported.forEach((file) => {
    if (datasetKeyOf(file) !== datasetKey) return;
    const extension = extensionOf(file.name) as ShapefileComponentExtension;
    if (!groupedFiles[extension]) groupedFiles[extension] = file;
  });

  const datasetName = fileStemOf(shpFile);
  const report = createReport(source, datasetName, groupedFiles);
  const missing = REQUIRED_COMPONENTS.filter((extension) => !groupedFiles[extension]);
  if (missing.length > 0) {
    fail(
      report,
      `数据集不完整：缺少 ${missing.map((extension) => `.${extension}`).join('、')}。请同时选择同名的 .shp、.shx、.dbf 与 .prj 文件。`
    );
  }

  const totalSize = Object.values(groupedFiles).reduce((sum, file) => sum + (file?.size ?? 0), 0);
  if (totalSize > MAX_DATASET_SIZE) {
    fail(report, `数据集总大小超过 ${Math.round(MAX_DATASET_SIZE / 1024 / 1024)} MB，当前浏览器端导入已停止。`);
  }

  if (!groupedFiles.cpg) {
    report.warnings.push('未提供 .cpg，属性编码将按 DBF 头信息或 UTF-8 兜底识别。');
  }

  return {
    dataset: {
      datasetName,
      files: groupedFiles
    },
    report
  };
};

const validateMainHeader = (view: DataView, label: string) => {
  if (view.byteLength < 100) {
    throw new Error(`${label} 文件长度不足，无法读取标准 Shapefile 文件头。`);
  }
  if (view.getInt32(0, false) !== 9994) {
    throw new Error(`${label} 文件头标识无效，不是标准 Shapefile 文件。`);
  }
  if (view.getInt32(28, true) !== 1000) {
    throw new Error(`${label} 版本号无效。`);
  }
};

const parseShp = async (buffer: ArrayBuffer): Promise<ParsedShp> => {
  const view = new DataView(buffer);
  validateMainHeader(view, '.shp');
  const shapeType = view.getInt32(32, true);
  if (!LINE_SHAPE_TYPES.has(shapeType)) {
    throw new Error(`当前几何类型为 ${shapeTypeName(shapeType)}，漫游航线仅支持 PolyLine、PolyLineZ 或 PolyLineM。`);
  }

  const declaredLengthBytes = view.getInt32(24, false) * 2;
  const parts: Coordinate[][] = [];
  let recordCount = 0;
  let pointCount = 0;
  let hasZ = false;
  let offset = 100;

  while (offset + 8 <= view.byteLength) {
    const contentLengthBytes = view.getInt32(offset + 4, false) * 2;
    const contentStart = offset + 8;
    const contentEnd = contentStart + contentLengthBytes;
    if (contentLengthBytes < 4 || contentEnd > view.byteLength) {
      throw new Error(`.shp 第 ${recordCount + 1} 条记录长度异常，几何数据可能已损坏。`);
    }

    recordCount += 1;
    const recordShapeType = view.getInt32(contentStart, true);
    if (recordShapeType === 0) {
      offset = contentEnd;
      continue;
    }
    if (!LINE_SHAPE_TYPES.has(recordShapeType)) {
      throw new Error(`.shp 第 ${recordCount} 条记录不是线状几何，无法作为连续漫游航线。`);
    }
    if (contentLengthBytes < 44) {
      throw new Error(`.shp 第 ${recordCount} 条线记录内容不完整。`);
    }

    const partCount = view.getInt32(contentStart + 36, true);
    const recordPointCount = view.getInt32(contentStart + 40, true);
    if (partCount <= 0 || recordPointCount <= 1 || partCount > recordPointCount) {
      throw new Error(`.shp 第 ${recordCount} 条记录的部件数或节点数无效。`);
    }

    const partsOffset = contentStart + 44;
    const pointsOffset = partsOffset + partCount * 4;
    const pointsEnd = pointsOffset + recordPointCount * 16;
    if (pointsEnd > contentEnd) {
      throw new Error(`.shp 第 ${recordCount} 条记录的坐标数组越界。`);
    }

    for (let partIndex = 0; partIndex < partCount; partIndex += 1) {
      const pointStart = view.getInt32(partsOffset + partIndex * 4, true);
      const pointEnd = partIndex === partCount - 1
        ? recordPointCount
        : view.getInt32(partsOffset + (partIndex + 1) * 4, true);
      if (pointStart < 0 || pointEnd > recordPointCount || pointEnd - pointStart < 2) {
        throw new Error(`.shp 第 ${recordCount} 条记录的第 ${partIndex + 1} 个线部件索引无效。`);
      }

      const coordinates: Coordinate[] = [];
      for (let pointIndex = pointStart; pointIndex < pointEnd; pointIndex += 1) {
        const pointOffset = pointsOffset + pointIndex * 16;
        const x = view.getFloat64(pointOffset, true);
        const y = view.getFloat64(pointOffset + 8, true);
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          throw new Error(`.shp 第 ${recordCount} 条记录包含无效坐标。`);
        }
        coordinates.push([x, y]);
      }
      parts.push(coordinates);
      pointCount += coordinates.length;
    }

    hasZ ||= recordShapeType === 13;
    offset = contentEnd;
    if (recordCount % 250 === 0) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    }
  }

  if (recordCount === 0 || parts.length === 0) {
    throw new Error('未在 .shp 中识别到可用于漫游的线状几何。');
  }

  return {
    shapeType,
    recordCount,
    parts,
    pointCount,
    hasZ,
    declaredLengthBytes
  };
};

const parseShx = (buffer: ArrayBuffer, shpByteLength: number): ParsedShx => {
  const view = new DataView(buffer);
  validateMainHeader(view, '.shx');
  const declaredLengthBytes = view.getInt32(24, false) * 2;
  if ((view.byteLength - 100) % 8 !== 0) {
    throw new Error('.shx 索引记录长度无效。');
  }

  const records: ParsedShx['records'] = [];
  for (let offset = 100; offset + 8 <= view.byteLength; offset += 8) {
    const offsetBytes = view.getInt32(offset, false) * 2;
    const contentLengthBytes = view.getInt32(offset + 4, false) * 2;
    if (offsetBytes < 100 || contentLengthBytes < 4 || offsetBytes + 8 + contentLengthBytes > shpByteLength) {
      throw new Error(`.shx 第 ${records.length + 1} 条索引超出 .shp 数据范围。`);
    }
    records.push({ offsetBytes, contentLengthBytes });
  }

  return {
    shapeType: view.getInt32(32, true),
    recordCount: records.length,
    declaredLengthBytes,
    records
  };
};

const readAscii = (bytes: Uint8Array) => (
  Array.from(bytes, (value) => String.fromCharCode(value)).join('')
);

const parseDbf = (buffer: ArrayBuffer, encodingText: string): ParsedDbf => {
  const view = new DataView(buffer);
  if (view.byteLength < 33) {
    throw new Error('.dbf 文件长度不足，无法读取属性表头。');
  }

  const recordCount = view.getUint32(4, true);
  const headerLength = view.getUint16(8, true);
  const recordLength = view.getUint16(10, true);
  if (headerLength < 33 || headerLength > view.byteLength || recordLength < 1) {
    throw new Error('.dbf 属性表头长度或记录长度无效。');
  }

  const fieldNames: string[] = [];
  for (let offset = 32; offset + 32 <= headerLength - 1; offset += 32) {
    if (view.getUint8(offset) === 0x0d) break;
    const rawName = readAscii(new Uint8Array(buffer, offset, 11));
    const fieldName = rawName.replace(/\0.*$/, '').trim();
    if (fieldName) fieldNames.push(fieldName);
  }

  const expectedMinimumLength = headerLength + recordCount * recordLength;
  if (expectedMinimumLength > view.byteLength + 1) {
    throw new Error('.dbf 声明的属性记录数量超过文件实际长度。');
  }

  return {
    headerLength,
    recordLength,
    summary: {
      recordCount,
      fieldCount: fieldNames.length,
      fieldNames,
      encoding: encodingText || '未声明（UTF-8 兜底）'
    }
  };
};

const shapeTypeName = (shapeType: number) => {
  const names: Record<number, string> = {
    0: 'Null Shape',
    1: 'Point',
    3: 'PolyLine',
    5: 'Polygon',
    8: 'MultiPoint',
    11: 'PointZ',
    13: 'PolyLineZ',
    15: 'PolygonZ',
    21: 'PointM',
    23: 'PolyLineM',
    25: 'PolygonM',
    31: 'MultiPatch'
  };
  return names[shapeType] ?? `未知类型(${shapeType})`;
};

const extractCrsSummary = (wkt: string): ShapefileCrsSummary => {
  const normalized = wkt.replace(/\s+/g, ' ').trim();
  const nameMatch = /^(?:PROJCS|GEOGCS|PROJCRS|GEOGCRS)\s*\[\s*"([^"]+)"/i.exec(normalized);
  const authorities = Array.from(normalized.matchAll(/(?:AUTHORITY|ID)\s*\[\s*"?(EPSG)"?\s*,\s*"?(?<code>\d+)"?\s*\]/gi));
  const authorityCode = authorities.at(-1)?.groups?.code;
  const kind = /^(?:PROJCS|PROJCRS)/i.test(normalized)
    ? 'projected'
    : /^(?:GEOGCS|GEOGCRS)/i.test(normalized)
      ? 'geographic'
      : 'unknown';
  const isWgs84 = authorityCode === '4326' || (
    kind === 'geographic' &&
    /WGS[_\s]?1984|WGS\s*84/i.test(normalized)
  );

  return {
    name: nameMatch?.[1] ?? '未命名坐标参考系',
    authority: authorityCode ? `EPSG:${authorityCode}` : undefined,
    kind,
    target: 'WGS 84 / EPSG:4326',
    transformed: !isWgs84
  };
};

const distanceMeters = (from: Coordinate, to: Coordinate) => {
  const lat1 = from[1] * Math.PI / 180;
  const lat2 = to[1] * Math.PI / 180;
  const deltaLat = lat2 - lat1;
  const deltaLon = (to[0] - from[0]) * Math.PI / 180;
  const sinLat = Math.sin(deltaLat / 2);
  const sinLon = Math.sin(deltaLon / 2);
  const a = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(a)));
};

const routeLengthMeters = (route: Coordinate[]) => {
  let total = 0;
  for (let index = 1; index < route.length; index += 1) {
    total += distanceMeters(route[index - 1], route[index]);
  }
  return total;
};

const dedupeCoordinates = (route: Coordinate[]) => {
  const result: Coordinate[] = [];
  route.forEach((coordinate) => {
    const previous = result.at(-1);
    if (!previous || distanceMeters(previous, coordinate) >= 0.05) {
      result.push(coordinate);
    }
  });
  return result;
};

const joinRoutes = (base: Coordinate[], addition: Coordinate[], mode: 'append' | 'appendReverse' | 'prepend' | 'prependReverse') => {
  if (mode === 'append') return [...base, ...addition.slice(1)];
  if (mode === 'appendReverse') return [...base, ...addition.slice(0, -1).reverse()];
  if (mode === 'prepend') return [...addition.slice(0, -1), ...base];
  return [...addition.slice(1).reverse(), ...base];
};

const mergeConnectedParts = (parts: Coordinate[][]) => {
  const remaining = parts
    .map(dedupeCoordinates)
    .filter((part) => part.length >= 2);
  const routes: Coordinate[][] = [];

  while (remaining.length > 0) {
    let route = remaining.shift() as Coordinate[];
    let didMerge = true;
    while (didMerge) {
      didMerge = false;
      const start = route[0];
      const end = route.at(-1) as Coordinate;
      for (let index = 0; index < remaining.length; index += 1) {
        const candidate = remaining[index];
        const candidateStart = candidate[0];
        const candidateEnd = candidate.at(-1) as Coordinate;
        const joins: Array<{ distance: number; mode: Parameters<typeof joinRoutes>[2] }> = [
          { distance: distanceMeters(end, candidateStart), mode: 'append' },
          { distance: distanceMeters(end, candidateEnd), mode: 'appendReverse' },
          { distance: distanceMeters(start, candidateEnd), mode: 'prepend' },
          { distance: distanceMeters(start, candidateStart), mode: 'prependReverse' }
        ];
        const best = joins.sort((a, b) => a.distance - b.distance)[0];
        if (best.distance <= CONNECT_TOLERANCE_METERS) {
          route = joinRoutes(route, candidate, best.mode);
          remaining.splice(index, 1);
          didMerge = true;
          break;
        }
      }
    }
    routes.push(dedupeCoordinates(route));
  }

  return routes;
};

const perpendicularDistance = (point: Coordinate, start: Coordinate, end: Coordinate, cosLat: number) => {
  const scaleX = Math.PI / 180 * EARTH_RADIUS_METERS * cosLat;
  const scaleY = Math.PI / 180 * EARTH_RADIUS_METERS;
  const px = (point[0] - start[0]) * scaleX;
  const py = (point[1] - start[1]) * scaleY;
  const ex = (end[0] - start[0]) * scaleX;
  const ey = (end[1] - start[1]) * scaleY;
  const lengthSquared = ex * ex + ey * ey;
  if (lengthSquared <= 1e-8) return Math.hypot(px, py);
  const ratio = Math.max(0, Math.min(1, (px * ex + py * ey) / lengthSquared));
  return Math.hypot(px - ratio * ex, py - ratio * ey);
};

const simplifyRdp = (points: Coordinate[], tolerance: number) => {
  if (points.length <= 2) return points;
  const meanLatitude = points.reduce((sum, point) => sum + point[1], 0) / points.length;
  const cosLat = Math.max(0.05, Math.cos(meanLatitude * Math.PI / 180));
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];

  while (stack.length > 0) {
    const [startIndex, endIndex] = stack.pop() as [number, number];
    let maxDistance = 0;
    let maxIndex = -1;
    for (let index = startIndex + 1; index < endIndex; index += 1) {
      const distance = perpendicularDistance(points[index], points[startIndex], points[endIndex], cosLat);
      if (distance > maxDistance) {
        maxDistance = distance;
        maxIndex = index;
      }
    }
    if (maxIndex > startIndex && maxDistance > tolerance) {
      keep[maxIndex] = 1;
      stack.push([startIndex, maxIndex], [maxIndex, endIndex]);
    }
  }

  return points.filter((_point, index) => keep[index] === 1);
};

const reduceRoutePoints = (route: Coordinate[]) => {
  if (route.length <= MAX_ROUTE_CONTROL_POINTS) return route;
  let tolerance = 0.2;
  let simplified = route;
  while (simplified.length > MAX_ROUTE_CONTROL_POINTS && tolerance <= 64) {
    simplified = simplifyRdp(route, tolerance);
    tolerance *= 2;
  }
  if (simplified.length <= MAX_ROUTE_CONTROL_POINTS) return simplified;

  const sampled: Coordinate[] = [];
  const stride = (simplified.length - 1) / (MAX_ROUTE_CONTROL_POINTS - 1);
  for (let index = 0; index < MAX_ROUTE_CONTROL_POINTS; index += 1) {
    sampled.push(simplified[Math.round(index * stride)]);
  }
  return dedupeCoordinates(sampled);
};

const transformPartsToWgs84 = async (parts: Coordinate[][], wkt: string) => {
  let converter: proj4.Converter;
  try {
    converter = proj4(wkt, 'EPSG:4326');
  } catch {
    throw new Error('无法解析 .prj 中的坐标参考系，请确认其为标准 WKT 定义。');
  }

  const transformed: Coordinate[][] = [];
  let processed = 0;
  for (const part of parts) {
    const output: Coordinate[] = [];
    for (const coordinate of part) {
      let result: number[];
      try {
        result = converter.forward(coordinate) as number[];
      } catch {
        throw new Error('坐标转换失败，请检查 .prj 是否与 .shp 坐标实际采用的参考系一致。');
      }
      const longitude = result[0];
      const latitude = result[1];
      if (
        !Number.isFinite(longitude) ||
        !Number.isFinite(latitude) ||
        longitude < -180 ||
        longitude > 180 ||
        latitude < -90 ||
        latitude > 90
      ) {
        throw new Error('坐标转换结果超出 WGS84 经纬度范围，请检查源坐标系或轴顺序。');
      }
      output.push([longitude, latitude]);
      processed += 1;
      if (processed % 5000 === 0) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      }
    }
    transformed.push(output);
  }
  return transformed;
};

const validateCrossFileIntegrity = (
  report: ShapefileImportReport,
  shp: ParsedShp,
  shx: ParsedShx,
  dbf: ParsedDbf,
  actualShpLength: number,
  actualShxLength: number
) => {
  if (shp.shapeType !== shx.shapeType) {
    fail(report, '.shp 与 .shx 声明的几何类型不一致。');
  }
  if (shp.recordCount !== shx.recordCount) {
    fail(report, `.shp 记录数（${shp.recordCount}）与 .shx 索引数（${shx.recordCount}）不一致。`);
  }
  if (dbf.summary.recordCount !== shx.recordCount) {
    fail(report, `.dbf 属性记录数（${dbf.summary.recordCount}）与几何记录数（${shx.recordCount}）不一致。`);
  }
  if (shp.declaredLengthBytes !== actualShpLength) {
    report.warnings.push('.shp 文件头声明长度与实际大小不一致，但有效记录仍可读取。');
  }
  if (shx.declaredLengthBytes !== actualShxLength) {
    report.warnings.push('.shx 文件头声明长度与实际大小不一致，但索引记录仍可读取。');
  }
};

export const importShapefileRoute = async (
  inputFiles: File[],
  source: ShapefileImportSource
): Promise<ShapefileRouteImportResult> => {
  const { dataset, report } = collectDatasetFiles(inputFiles, source);
  const shpFile = dataset.files.shp as File;
  const shxFile = dataset.files.shx as File;
  const dbfFile = dataset.files.dbf as File;
  const prjFile = dataset.files.prj as File;
  const cpgFile = dataset.files.cpg;

  try {
    const [shpBuffer, shxBuffer, dbfBuffer, prjText, cpgText] = await Promise.all([
      shpFile.arrayBuffer(),
      shxFile.arrayBuffer(),
      dbfFile.arrayBuffer(),
      prjFile.text(),
      cpgFile?.text() ?? Promise.resolve('')
    ]);
    const normalizedPrj = prjText.replace(/^\uFEFF/, '').trim();
    if (!normalizedPrj) {
      fail(report, '.prj 文件为空，无法确定源数据坐标系并进行空间配准。');
    }

    const shp = await parseShp(shpBuffer);
    const shx = parseShx(shxBuffer, shpBuffer.byteLength);
    const encoding = cpgText.replace(/^\uFEFF/, '').trim();
    const dbf = parseDbf(dbfBuffer, encoding);
    validateCrossFileIntegrity(report, shp, shx, dbf, shpBuffer.byteLength, shxBuffer.byteLength);

    const sourceCrs = extractCrsSummary(normalizedPrj);
    if (sourceCrs.kind === 'unknown') {
      fail(report, '无法识别 .prj 中的地理或投影坐标系类型。');
    }

    const transformedParts = await transformPartsToWgs84(shp.parts, normalizedPrj);
    const routes = mergeConnectedParts(transformedParts)
      .filter((route) => route.length >= 2)
      .sort((a, b) => routeLengthMeters(b) - routeLengthMeters(a));
    const longestRoute = routes[0];
    if (!longestRoute) {
      fail(report, '坐标转换后未形成有效的连续线状航线。');
    }

    const selectedRoute = reduceRoutePoints(longestRoute);
    const selectedLengthMeters = routeLengthMeters(selectedRoute);
    if (!Number.isFinite(selectedLengthMeters) || selectedLengthMeters < 1) {
      fail(report, '航线长度小于 1 米，无法生成有效漫游轨迹。');
    }

    if (routes.length > 1) {
      report.warnings.push(`检测到 ${routes.length} 条不连续路线，已采用长度最大的连续航线。`);
    }
    if (shp.parts.length > routes.length) {
      report.warnings.push(`已按端点邻接关系拼接 ${shp.parts.length} 个线部件。`);
    }
    if (selectedRoute.length < longestRoute.length) {
      report.warnings.push(`原始路线节点较密，已在保持线形的前提下从 ${longestRoute.length} 点优化为 ${selectedRoute.length} 点。`);
    }
    if (shp.hasZ) {
      report.warnings.push('检测到 PolyLineZ；漫游高度仍按“DEM 地表 + 相对高度”统一重建。');
    }

    const geometry: ShapefileGeometrySummary = {
      shapeType: shapeTypeName(shp.shapeType),
      recordCount: shp.recordCount,
      partCount: shp.parts.length,
      pointCount: shp.pointCount,
      selectedPointCount: selectedRoute.length,
      routeCount: routes.length,
      selectedLengthMeters,
      hasZ: shp.hasZ
    };

    report.status = 'ready';
    report.sourceCrs = sourceCrs;
    report.geometry = geometry;
    report.attributes = dbf.summary;
    report.message = sourceCrs.transformed
      ? `坐标已由 ${sourceCrs.authority ?? sourceCrs.name} 转换为 WGS84，航线可用于漫游。`
      : '坐标系已确认为 WGS84，航线可用于漫游。';

    return {
      report,
      coordinates: selectedRoute
    };
  } catch (error) {
    if (error instanceof ShapefileImportError) throw error;
    const message = error instanceof Error ? error.message : 'Shapefile 数据集解析失败。';
    return fail(report, message);
  }
};
