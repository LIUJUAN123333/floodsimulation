import * as Cesium from 'cesium';

export interface RoamGroundSample {
  cartographic: Cesium.Cartographic;
  groundPosition: Cesium.Cartesian3;
}

export interface RoamTrackSample extends RoamGroundSample {
  flightPosition: Cesium.Cartesian3;
  distance: number;
}

export interface RoamTrackPoint extends RoamTrackSample {
  segmentIndex: number;
}

const MIN_POINT_DISTANCE = 0.75;
const MIN_ROUTE_SPACING = 18;
const TARGET_ROUTE_SAMPLES = 900;
const TERRAIN_SAMPLE_BATCH_SIZE = 240;

const cloneCartographicAtHeight = (source: Cesium.Cartographic, height: number) => (
  new Cesium.Cartographic(source.longitude, source.latitude, height)
);

const getSurfaceDistance = (from: Cesium.Cartographic, to: Cesium.Cartographic) => {
  const geodesic = new Cesium.EllipsoidGeodesic(from, to);
  return Number.isFinite(geodesic.surfaceDistance) ? geodesic.surfaceDistance : 0;
};

const appendUniqueCartographic = (target: Cesium.Cartographic[], position: Cesium.Cartographic) => {
  const previous = target[target.length - 1];
  if (!previous || getSurfaceDistance(previous, position) >= MIN_POINT_DISTANCE) {
    target.push(cloneCartographicAtHeight(position, 0));
  }
};

const createPolylineTimes = (points: Cesium.Cartesian3[]) => {
  const times = [0];
  for (let index = 1; index < points.length; index += 1) {
    const distance = Math.max(MIN_POINT_DISTANCE, Cesium.Cartesian3.distance(points[index - 1], points[index]));
    times.push(times[index - 1] + distance);
  }
  return times;
};

export const dedupeRoamControlPoints = (positions: Cesium.Cartesian3[]) => {
  const result: Cesium.Cartesian3[] = [];
  positions.forEach((position) => {
    const previous = result[result.length - 1];
    if (!previous || Cesium.Cartesian3.distance(previous, position) >= MIN_POINT_DISTANCE) {
      result.push(Cesium.Cartesian3.clone(position));
    }
  });
  return result;
};

export const buildSmoothHorizontalRoute = (sourcePositions: Cesium.Cartesian3[]) => {
  const source = dedupeRoamControlPoints(sourcePositions).map((position) => {
    const cartographic = Cesium.Cartographic.fromCartesian(position);
    return cloneCartographicAtHeight(cartographic, 0);
  });

  if (source.length < 2) return source;

  let sourceDistance = 0;
  for (let index = 1; index < source.length; index += 1) {
    sourceDistance += getSurfaceDistance(source[index - 1], source[index]);
  }
  const spacing = Math.max(MIN_ROUTE_SPACING, sourceDistance / TARGET_ROUTE_SAMPLES);

  // Densifying first keeps Catmull-Rom turns local even when waypoint spacing is uneven.
  const splineControls: Cesium.Cartographic[] = [source[0]];
  const maxControlSpan = Math.max(70, spacing * 4);
  for (let index = 1; index < source.length; index += 1) {
    const start = source[index - 1];
    const end = source[index];
    const geodesic = new Cesium.EllipsoidGeodesic(start, end);
    const count = Math.max(1, Math.ceil(geodesic.surfaceDistance / maxControlSpan));
    for (let step = 1; step <= count; step += 1) {
      appendUniqueCartographic(splineControls, geodesic.interpolateUsingFraction(step / count));
    }
  }

  const controlPoints = splineControls.map((position) => (
    Cesium.Cartesian3.fromRadians(position.longitude, position.latitude, 0)
  ));
  const times = createPolylineTimes(controlPoints);
  const spline = new Cesium.CatmullRomSpline({ times, points: controlPoints });
  const result: Cesium.Cartographic[] = [];

  for (let index = 0; index < controlPoints.length - 1; index += 1) {
    const span = times[index + 1] - times[index];
    const count = Math.max(1, Math.ceil(span / spacing));
    const firstStep = index === 0 ? 0 : 1;
    for (let step = firstStep; step <= count; step += 1) {
      const time = Cesium.Math.lerp(times[index], times[index + 1], step / count);
      const evaluated = spline.evaluate(time);
      const cartographic = Cesium.Cartographic.fromCartesian(evaluated);
      appendUniqueCartographic(result, cartographic);
    }
  }

  return result;
};

export const sampleRoamGround = async (
  terrainProvider: Cesium.TerrainProvider,
  route: Cesium.Cartographic[],
  getLoadedHeight: (position: Cesium.Cartographic) => number | undefined
) => {
  const samples = route.map((position) => cloneCartographicAtHeight(position, 0));
  const loadedHeights = route.map((position) => getLoadedHeight(position));
  const terrainSampled = route.map(() => false);

  if (terrainProvider.availability && samples.length > 0) {
    for (let start = 0; start < samples.length; start += TERRAIN_SAMPLE_BATCH_SIZE) {
      const batch = samples.slice(start, start + TERRAIN_SAMPLE_BATCH_SIZE);
      try {
        await Cesium.sampleTerrainMostDetailed(terrainProvider, batch, false);
        batch.forEach((sample, index) => {
          terrainSampled[start + index] = Number.isFinite(sample.height);
        });
      } catch (error) {
        console.warn('漫游路线 DEM 采样未完全完成，使用当前已加载地形补齐。', error);
      }
    }
  }

  return samples.map<RoamGroundSample>((cartographic, index) => {
    const loadedHeight = loadedHeights[index];
    const height = terrainSampled[index] && Number.isFinite(cartographic.height)
      ? cartographic.height
      : Number.isFinite(loadedHeight)
        ? loadedHeight as number
        : 0;
    const resolved = cloneCartographicAtHeight(cartographic, height);
    return {
      cartographic: resolved,
      groundPosition: Cesium.Cartesian3.fromRadians(resolved.longitude, resolved.latitude, resolved.height)
    };
  });
};

export const buildRoamFlightTrack = (groundSamples: RoamGroundSample[], relativeHeight: number) => {
  let distance = 0;
  return groundSamples.map<RoamTrackSample>((sample, index) => {
    const flightPosition = Cesium.Cartesian3.fromRadians(
      sample.cartographic.longitude,
      sample.cartographic.latitude,
      sample.cartographic.height + relativeHeight
    );
    if (index > 0) {
      distance += Cesium.Cartesian3.distance(
        Cesium.Cartesian3.fromRadians(
          groundSamples[index - 1].cartographic.longitude,
          groundSamples[index - 1].cartographic.latitude,
          groundSamples[index - 1].cartographic.height + relativeHeight
        ),
        flightPosition
      );
    }
    return {
      ...sample,
      flightPosition,
      distance
    };
  });
};

const findTrackSegment = (track: RoamTrackSample[], distance: number) => {
  let low = 1;
  let high = track.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (track[middle].distance < distance) low = middle + 1;
    else high = middle;
  }
  return low;
};

export const sampleRoamTrack = (track: RoamTrackSample[], distance: number): RoamTrackPoint | null => {
  if (track.length === 0) return null;
  if (track.length === 1) return { ...track[0], segmentIndex: 0 };

  const total = track[track.length - 1].distance;
  const clamped = Cesium.Math.clamp(distance, 0, total);
  const nextIndex = clamped <= 0 ? 1 : findTrackSegment(track, clamped);
  const previous = track[nextIndex - 1];
  const next = track[nextIndex];
  const span = Math.max(0.001, next.distance - previous.distance);
  const ratio = Cesium.Math.clamp((clamped - previous.distance) / span, 0, 1);
  const flightPosition = Cesium.Cartesian3.lerp(previous.flightPosition, next.flightPosition, ratio, new Cesium.Cartesian3());
  const groundPosition = Cesium.Cartesian3.lerp(previous.groundPosition, next.groundPosition, ratio, new Cesium.Cartesian3());
  const groundCartographic = Cesium.Cartographic.fromCartesian(groundPosition);

  return {
    cartographic: groundCartographic,
    groundPosition,
    flightPosition,
    distance: clamped,
    segmentIndex: nextIndex
  };
};

export const getRoamTrackProgressPositions = (track: RoamTrackSample[], distance: number) => {
  if (track.length < 2) return track.map((sample) => sample.flightPosition);
  const current = sampleRoamTrack(track, distance);
  if (!current) return [];
  const positions = track
    .slice(0, Math.max(1, current.segmentIndex))
    .map((sample) => sample.flightPosition);
  positions.push(current.flightPosition);
  return positions;
};
