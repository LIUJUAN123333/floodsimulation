export type ShapefileComponentExtension = 'shp' | 'shx' | 'dbf' | 'prj' | 'cpg';

export type ShapefileCheckStatus = 'passed' | 'warning' | 'error';

export type ShapefileImportSource = 'files' | 'folder' | 'drop';

export interface ShapefileComponentCheck {
  extension: ShapefileComponentExtension;
  label: string;
  required: boolean;
  present: boolean;
  status: ShapefileCheckStatus;
  detail: string;
}

export interface ShapefileCrsSummary {
  name: string;
  authority?: string;
  kind: 'geographic' | 'projected' | 'unknown';
  target: 'WGS 84 / EPSG:4326';
  transformed: boolean;
}

export interface ShapefileGeometrySummary {
  shapeType: string;
  recordCount: number;
  partCount: number;
  pointCount: number;
  selectedPointCount: number;
  routeCount: number;
  selectedLengthMeters: number;
  hasZ: boolean;
}

export interface ShapefileAttributeSummary {
  recordCount: number;
  fieldCount: number;
  fieldNames: string[];
  encoding: string;
}

export interface ShapefileImportReport {
  status: 'ready' | 'error';
  source: ShapefileImportSource;
  datasetName: string;
  componentChecks: ShapefileComponentCheck[];
  sourceCrs?: ShapefileCrsSummary;
  geometry?: ShapefileGeometrySummary;
  attributes?: ShapefileAttributeSummary;
  warnings: string[];
  message: string;
}

export interface ShapefileRouteImportResult {
  report: ShapefileImportReport;
  coordinates: Array<[number, number]>;
}
