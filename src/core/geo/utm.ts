import { DEG2RAD, LatLon, WGS84_A, WGS84_E2 } from './wgs84';

export interface UtmCoord {
  zone: number;
  hemisphere: 'N' | 'S';
  easting: number;
  northing: number;
  /** e.g. "EPSG:32617" (WGS84 / UTM zone 17N). */
  epsg: string;
}

export function utmZone(lon: number, lat: number): number {
  // Standard exceptions (Norway/Svalbard) are irrelevant for US roofs but kept correct.
  if (lat >= 56 && lat < 64 && lon >= 3 && lon < 12) return 32;
  if (lat >= 72 && lat < 84) {
    if (lon >= 0 && lon < 9) return 31;
    if (lon >= 9 && lon < 21) return 33;
    if (lon >= 21 && lon < 33) return 35;
    if (lon >= 33 && lon < 42) return 37;
  }
  return (Math.floor((lon + 180) / 6) % 60) + 1;
}

/**
 * WGS84 → UTM (Transverse Mercator, Redfearn series; mm-level within a zone).
 * Used only for georeferenced exports — measurement math uses the local
 * tangent plane instead (see measure.ts).
 */
export function llToUtm(p: LatLon): UtmCoord {
  const zone = utmZone(p.lon, p.lat);
  const lat = p.lat * DEG2RAD;
  const lon = p.lon * DEG2RAD;
  const lon0 = ((zone - 1) * 6 - 180 + 3) * DEG2RAD;

  const k0 = 0.9996;
  const e2 = WGS84_E2;
  const ep2 = e2 / (1 - e2);

  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const tanLat = Math.tan(lat);

  const N = WGS84_A / Math.sqrt(1 - e2 * sinLat * sinLat);
  const T = tanLat * tanLat;
  const C = ep2 * cosLat * cosLat;
  const A = cosLat * (lon - lon0);

  // Meridional arc (Snyder 3-21).
  const M =
    WGS84_A *
    ((1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 * e2 * e2) / 256) * lat -
      ((3 * e2) / 8 + (3 * e2 * e2) / 32 + (45 * e2 * e2 * e2) / 1024) *
        Math.sin(2 * lat) +
      ((15 * e2 * e2) / 256 + (45 * e2 * e2 * e2) / 1024) * Math.sin(4 * lat) -
      ((35 * e2 * e2 * e2) / 3072) * Math.sin(6 * lat));

  const easting =
    k0 *
      N *
      (A +
        ((1 - T + C) * A * A * A) / 6 +
        ((5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5) / 120) +
    500000;

  let northing =
    k0 *
    (M +
      N *
        tanLat *
        ((A * A) / 2 +
          ((5 - T + 9 * C + 4 * C * C) * A ** 4) / 24 +
          ((61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6) / 720));

  const hemisphere: 'N' | 'S' = p.lat >= 0 ? 'N' : 'S';
  if (hemisphere === 'S') northing += 10000000;

  return {
    zone,
    hemisphere,
    easting,
    northing,
    epsg: `EPSG:${(hemisphere === 'N' ? 32600 : 32700) + zone}`,
  };
}
