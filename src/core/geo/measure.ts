import { llhToEnu } from './transforms';
import { LatLon } from './wgs84';

/**
 * All area/perimeter math is done on a local East-North tangent plane
 * (meters) centered on the geometry itself — NOT on Web Mercator and NOT on
 * raw lat/lon. At roof scale (< ~1 km) tangent-plane distortion is far below
 * the RTK noise floor, unlike UTM's up-to-4 cm/100 m scale distortion.
 */

export interface EnPoint {
  e: number;
  n: number;
}

/** A 2D point that may carry its ellipsoidal height (meters). */
export interface GeoPoint extends LatLon {
  h?: number;
}

/**
 * Projects points to a local tangent plane anchored at the first point.
 * The plane is evaluated at the points' (mean) ellipsoidal height: horizontal
 * distances physically grow by ~h/R with elevation (~16 ppm per 100 m), which
 * matters on large roofs at altitude.
 */
export function toLocalEN(points: GeoPoint[], origin?: GeoPoint): EnPoint[] {
  if (points.length === 0) return [];
  const hs = points
    .map(p => p.h)
    .filter((h): h is number => h !== undefined && Number.isFinite(h));
  const meanH = hs.length ? hs.reduce((a, b) => a + b, 0) / hs.length : 0;
  const anchor = origin ?? points[0];
  const o = { lat: anchor.lat, lon: anchor.lon, h: anchor.h ?? meanH };
  return points.map(p => {
    const enu = llhToEnu(o, { lat: p.lat, lon: p.lon, h: p.h ?? meanH });
    return { e: enu.e, n: enu.n };
  });
}

/** Planar shoelace area. Input ring need not be explicitly closed. */
export function ringAreaM2(en: EnPoint[]): number {
  if (en.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < en.length; i++) {
    const a = en[i];
    const b = en[(i + 1) % en.length];
    sum += a.e * b.n - b.e * a.n;
  }
  return Math.abs(sum) / 2;
}

/** Signed shoelace area (positive = counter-clockwise). */
export function ringAreaSigned(en: EnPoint[]): number {
  let sum = 0;
  for (let i = 0; i < en.length; i++) {
    const a = en[i];
    const b = en[(i + 1) % en.length];
    sum += a.e * b.n - b.e * a.n;
  }
  return sum / 2;
}

export function pathLengthM(en: EnPoint[], close = false): number {
  let len = 0;
  const last = close ? en.length : en.length - 1;
  for (let i = 0; i < last; i++) {
    const a = en[i];
    const b = en[(i + 1) % en.length];
    len += Math.hypot(b.e - a.e, b.n - a.n);
  }
  return len;
}

export function polygonAreaM2(points: GeoPoint[]): number {
  return ringAreaM2(toLocalEN(points));
}

export function polygonPerimeterM(points: GeoPoint[]): number {
  return pathLengthM(toLocalEN(points), true);
}

export function polylineLengthM(points: GeoPoint[]): number {
  return pathLengthM(toLocalEN(points), false);
}

/** Ground distance between two points, meters. */
export function distanceM(a: GeoPoint, b: GeoPoint): number {
  const [pa, pb] = toLocalEN([a, b]);
  return Math.hypot(pb.e - pa.e, pb.n - pa.n);
}

export const SQM_PER_SQFT = 0.09290304;

export function m2ToSqFt(m2: number): number {
  return m2 / SQM_PER_SQFT;
}

/** Roofing "square" = 100 sq ft. */
export function m2ToSquares(m2: number): number {
  return m2ToSqFt(m2) / 100;
}

export function mToFt(m: number): number {
  return m / 0.3048;
}
