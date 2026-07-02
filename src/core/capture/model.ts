import { FixQuality } from '../nmea/types';

/**
 * Data model for a roof measurement project.
 *
 * A project is one roof. Features are the things you walk and tap:
 *  - perimeter:   closed polygon around a roof section (counts as + area)
 *  - penetration: closed polygon around an HVAC curb, skylight… (− area)
 *  - edge:        open polyline (parapet line, expansion joint…)
 *  - point:       single marker (drain, pipe boot, scupper…)
 */

export type FeatureKind = 'perimeter' | 'penetration' | 'edge' | 'point';

export interface CapturedVertex {
  lat: number;
  lon: number;
  /** Ellipsoidal height, meters (NaN when the receiver sent none). Used to
   *  evaluate the measurement tangent plane at roof height. */
  ellipsoidalH: number;
  /** GST horizontal 1-sigma, meters. */
  sigmaH: number;
  /** Total 2D accuracy incl. tilt term, meters. */
  totalAccuracy2d: number;
  fixQuality: FixQuality;
  satellites: number;
  tiltCompensated: boolean;
  tiltValueDeg?: number;
  /** GPS UTC time-of-fix (hhmmss.ss). */
  gpsTime: string;
  /** Phone wall clock, ISO 8601. */
  capturedAt: string;
  /** Number of epochs averaged into this vertex. */
  epochs: number;
}

export interface RoofFeature {
  id: string;
  kind: FeatureKind;
  name: string;
  vertices: CapturedVertex[];
  /** Polygons only: true once the ring is closed. */
  closed: boolean;
}

export interface RoofProject {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  features: RoofFeature[];
  notes?: string;
}

export interface FeatureStats {
  featureId: string;
  name: string;
  kind: FeatureKind;
  vertexCount: number;
  areaM2: number;
  perimeterM: number;
  lengthM: number;
  /** Worst vertex accuracy, meters. */
  worstAccuracyM: number;
}

export interface ProjectStats {
  /** Sum of perimeter polygon areas. */
  grossAreaM2: number;
  /** Sum of penetration polygon areas. */
  penetrationAreaM2: number;
  /** gross − penetrations. */
  netAreaM2: number;
  /** Total length of all perimeter rings. */
  perimeterM: number;
  features: FeatureStats[];
}

let counter = 0;

/** Time-based unique id — no crypto dependency needed. */
export function newId(prefix: string): string {
  counter = (counter + 1) % 0xffff;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}`;
}

export function createProject(name: string, now = new Date()): RoofProject {
  const iso = now.toISOString();
  return {
    id: newId('prj'),
    name,
    createdAt: iso,
    updatedAt: iso,
    features: [],
  };
}

export const KIND_LABEL: Record<FeatureKind, string> = {
  perimeter: 'Perimeter',
  penetration: 'Penetration',
  edge: 'Edge line',
  point: 'Point',
};

export function defaultFeatureName(kind: FeatureKind, existing: RoofFeature[]): string {
  const n = existing.filter(f => f.kind === kind).length + 1;
  return `${KIND_LABEL[kind]} ${n}`;
}
