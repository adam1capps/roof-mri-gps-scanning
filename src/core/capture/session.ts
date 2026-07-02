import { distanceM, polygonAreaM2, polygonPerimeterM, polylineLengthM } from '../geo/measure';
import { GatedPoint } from '../gnss/gate';
import {
  CapturedVertex,
  defaultFeatureName,
  FeatureKind,
  FeatureStats,
  newId,
  ProjectStats,
  RoofFeature,
  RoofProject,
} from './model';

/**
 * Pure functions that evolve a RoofProject as points are captured.
 * All functions return new objects (immutable style) so they slot straight
 * into the zustand store and undo stays trivial.
 */

export function gatedPointToVertex(p: GatedPoint, epochs: number, now = new Date()): CapturedVertex {
  return {
    lat: p.lat,
    lon: p.lon,
    ellipsoidalH: p.ellipsoidalH,
    sigmaH: p.sigmaH,
    totalAccuracy2d: p.totalAccuracy2d,
    fixQuality: p.fixQuality,
    satellites: p.satellites,
    tiltCompensated: p.tiltCompensated,
    tiltValueDeg: p.tiltValueDeg,
    gpsTime: p.gpsTime,
    capturedAt: now.toISOString(),
    epochs,
  };
}

export function startFeature(
  project: RoofProject,
  kind: FeatureKind,
  name?: string,
): { project: RoofProject; feature: RoofFeature } {
  const feature: RoofFeature = {
    id: newId('ft'),
    kind,
    name: name ?? defaultFeatureName(kind, project.features),
    vertices: [],
    closed: false,
  };
  return {
    project: touch({ ...project, features: [...project.features, feature] }),
    feature,
  };
}

export interface AddVertexResult {
  project: RoofProject;
  /** True when the vertex snapped onto the first vertex and closed the ring. */
  closedRing: boolean;
}

/**
 * Appends a vertex to a feature. For polygon kinds, a point landing within
 * `snapRadiusM` of the first vertex (with ≥ 3 vertices already down) closes
 * the ring instead of adding a duplicate corner.
 */
export function addVertex(
  project: RoofProject,
  featureId: string,
  vertex: CapturedVertex,
  snapRadiusM = 0.25,
): AddVertexResult {
  const feature = project.features.find(f => f.id === featureId);
  if (!feature || feature.closed) return { project, closedRing: false };

  const isPolygon = feature.kind === 'perimeter' || feature.kind === 'penetration';

  if (isPolygon && feature.vertices.length >= 3) {
    const first = feature.vertices[0];
    if (distanceM(first, vertex) <= snapRadiusM) {
      return { project: closeFeature(project, featureId), closedRing: true };
    }
  }

  if (feature.kind === 'point' && feature.vertices.length >= 1) {
    // A point feature holds exactly one vertex — replace it.
    return {
      project: updateFeature(project, featureId, f => ({ ...f, vertices: [vertex] })),
      closedRing: false,
    };
  }

  return {
    project: updateFeature(project, featureId, f => ({
      ...f,
      vertices: [...f.vertices, vertex],
    })),
    closedRing: false,
  };
}

export function undoVertex(project: RoofProject, featureId: string): RoofProject {
  return updateFeature(project, featureId, f =>
    f.closed
      ? { ...f, closed: false } // first undo after closing re-opens the ring
      : { ...f, vertices: f.vertices.slice(0, -1) },
  );
}

export function closeFeature(project: RoofProject, featureId: string): RoofProject {
  return updateFeature(project, featureId, f => {
    const isPolygon = f.kind === 'perimeter' || f.kind === 'penetration';
    if (!isPolygon || f.vertices.length < 3) return f;
    return { ...f, closed: true };
  });
}

export function deleteFeature(project: RoofProject, featureId: string): RoofProject {
  return touch({
    ...project,
    features: project.features.filter(f => f.id !== featureId),
  });
}

export function renameFeature(project: RoofProject, featureId: string, name: string): RoofProject {
  return updateFeature(project, featureId, f => ({ ...f, name }));
}

function updateFeature(
  project: RoofProject,
  featureId: string,
  fn: (f: RoofFeature) => RoofFeature,
): RoofProject {
  return touch({
    ...project,
    features: project.features.map(f => (f.id === featureId ? fn(f) : f)),
  });
}

function touch(project: RoofProject): RoofProject {
  return { ...project, updatedAt: new Date().toISOString() };
}

export function featureStats(f: RoofFeature): FeatureStats {
  const pts = f.vertices.map(v => ({
    lat: v.lat,
    lon: v.lon,
    h: Number.isFinite(v.ellipsoidalH) ? v.ellipsoidalH : undefined,
  }));
  const isPolygon = f.kind === 'perimeter' || f.kind === 'penetration';
  const areaM2 = isPolygon && pts.length >= 3 ? polygonAreaM2(pts) : 0;
  const perimeterM = isPolygon && pts.length >= 3 ? polygonPerimeterM(pts) : 0;
  const lengthM = f.kind === 'edge' && pts.length >= 2 ? polylineLengthM(pts) : 0;
  return {
    featureId: f.id,
    name: f.name,
    kind: f.kind,
    vertexCount: pts.length,
    areaM2,
    perimeterM,
    lengthM,
    worstAccuracyM: f.vertices.reduce(
      (m, v) => (Number.isFinite(v.totalAccuracy2d) ? Math.max(m, v.totalAccuracy2d) : m),
      0,
    ),
  };
}

export function projectStats(project: RoofProject): ProjectStats {
  const features = project.features.map(featureStats);
  const gross = features
    .filter(f => f.kind === 'perimeter')
    .reduce((s, f) => s + f.areaM2, 0);
  const pen = features
    .filter(f => f.kind === 'penetration')
    .reduce((s, f) => s + f.areaM2, 0);
  return {
    grossAreaM2: gross,
    penetrationAreaM2: pen,
    netAreaM2: Math.max(0, gross - pen),
    perimeterM: features
      .filter(f => f.kind === 'perimeter')
      .reduce((s, f) => s + f.perimeterM, 0),
    features,
  };
}
