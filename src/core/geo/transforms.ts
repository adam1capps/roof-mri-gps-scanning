import {
  DEG2RAD,
  Ecef,
  Enu,
  Llh,
  RAD2DEG,
  WGS84_A,
  WGS84_B,
  WGS84_E2,
} from './wgs84';

/** Geodetic (degrees, meters) → ECEF (meters). */
export function llhToEcef(p: Llh): Ecef {
  const lat = p.lat * DEG2RAD;
  const lon = p.lon * DEG2RAD;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const N = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
  return {
    x: (N + p.h) * cosLat * Math.cos(lon),
    y: (N + p.h) * cosLat * Math.sin(lon),
    z: (N * (1 - WGS84_E2) + p.h) * sinLat,
  };
}

/** ECEF → geodetic via Bowring's method (sub-millimeter for terrestrial points). */
export function ecefToLlh(p: Ecef): Llh {
  const { x, y, z } = p;
  const lon = Math.atan2(y, x);
  const r = Math.sqrt(x * x + y * y);
  const e2b = (WGS84_A * WGS84_A - WGS84_B * WGS84_B) / (WGS84_B * WGS84_B);

  const theta = Math.atan2(z * WGS84_A, r * WGS84_B);
  const sinT = Math.sin(theta);
  const cosT = Math.cos(theta);
  const lat = Math.atan2(
    z + e2b * WGS84_B * sinT * sinT * sinT,
    r - WGS84_E2 * WGS84_A * cosT * cosT * cosT,
  );

  const sinLat = Math.sin(lat);
  const N = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
  const h = r / Math.cos(lat) - N;
  return { lat: lat * RAD2DEG, lon: lon * RAD2DEG, h };
}

/**
 * ENU offset (meters, tangent plane at `origin`) → geodetic point.
 * This is the conversion the Emlid ETC doc prescribes for applying tilt deltas.
 */
export function enuToLlh(origin: Llh, d: Enu): Llh {
  const lat0 = origin.lat * DEG2RAD;
  const lon0 = origin.lon * DEG2RAD;
  const sinLat = Math.sin(lat0);
  const cosLat = Math.cos(lat0);
  const sinLon = Math.sin(lon0);
  const cosLon = Math.cos(lon0);

  const t = cosLat * d.u - sinLat * d.n;
  const dx = cosLon * t - sinLon * d.e;
  const dy = sinLon * t + cosLon * d.e;
  const dz = sinLat * d.u + cosLat * d.n;

  const o = llhToEcef(origin);
  return ecefToLlh({ x: o.x + dx, y: o.y + dy, z: o.z + dz });
}

/** Geodetic point → ENU offset from `origin` (meters). */
export function llhToEnu(origin: Llh, p: Llh): Enu {
  const o = llhToEcef(origin);
  const q = llhToEcef(p);
  const dx = q.x - o.x;
  const dy = q.y - o.y;
  const dz = q.z - o.z;

  const lat0 = origin.lat * DEG2RAD;
  const lon0 = origin.lon * DEG2RAD;
  const sinLat = Math.sin(lat0);
  const cosLat = Math.cos(lat0);
  const sinLon = Math.sin(lon0);
  const cosLon = Math.cos(lon0);

  return {
    e: -sinLon * dx + cosLon * dy,
    n: -sinLat * cosLon * dx - sinLat * sinLon * dy + cosLat * dz,
    u: cosLat * cosLon * dx + cosLat * sinLon * dy + sinLat * dz,
  };
}
