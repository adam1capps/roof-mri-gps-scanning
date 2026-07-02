/** WGS84 ellipsoid constants. */
export const WGS84_A = 6378137.0;
export const WGS84_F = 1 / 298.257223563;
export const WGS84_B = WGS84_A * (1 - WGS84_F);
export const WGS84_E2 = WGS84_F * (2 - WGS84_F); // first eccentricity squared

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

export interface LatLon {
  lat: number;
  lon: number;
}

export interface Llh extends LatLon {
  /** Ellipsoidal height, meters. 0 is fine for 2D work. */
  h: number;
}

export interface Ecef {
  x: number;
  y: number;
  z: number;
}

export interface Enu {
  e: number;
  n: number;
  u: number;
}
