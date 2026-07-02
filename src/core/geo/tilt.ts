import { EtcData, TiltState } from '../nmea/types';
import { enuToLlh } from './transforms';
import { DEG2RAD, LatLon, Llh } from './wgs84';

/**
 * Bottom-of-receiver to Antenna Reference Point offset for the Reach RX2
 * (ETC doc rev.3: "The bottom to ARP height for Reach RX2 is 0.145 meters").
 */
export const RX2_BOTTOM_TO_ARP_M = 0.145;

/** Pole height (tip → receiver bottom) → antenna height used in tilt math. */
export function antennaHeightM(poleHeightM: number): number {
  return poleHeightM + RX2_BOTTOM_TO_ARP_M;
}

/**
 * Applies Emlid tilt compensation (ETC doc rev.3 "How to apply position
 * compensation") to a GGA antenna position, returning the pole-tip position.
 *
 *   Δe = -antennaHeight · sin(tilt) · sin(tiltDirection)
 *   Δn = -antennaHeight · sin(tilt) · cos(tiltDirection)
 *   Δu = -antennaHeight · cos(tilt)
 *
 * The deltas live on a local tangent plane centered at the rover position and
 * are converted back to geodetic coordinates via ECEF.
 */
export function compensateTilt(
  antenna: Llh,
  tiltDirectionDeg: number,
  tiltValueDeg: number,
  antennaHeight: number,
): Llh {
  const tilt = tiltValueDeg * DEG2RAD;
  const dir = tiltDirectionDeg * DEG2RAD;
  const sinTilt = Math.sin(tilt);
  return enuToLlh(antenna, {
    e: -antennaHeight * sinTilt * Math.sin(dir),
    n: -antennaHeight * sinTilt * Math.cos(dir),
    u: -antennaHeight * Math.cos(tilt),
  });
}

/**
 * 2D tilt-compensation accuracy contribution in millimeters
 * (ETC doc rev.3: coefficient × antennaHeight[m] → mm per axis).
 */
export function tiltAccuracy2dMm(etc: EtcData, antennaHeight: number): number {
  const eMm = etc.eAxisAcc * antennaHeight;
  const nMm = etc.nAxisAcc * antennaHeight;
  return Math.sqrt(eMm * eMm + nMm * nMm);
}

/** True when the ETC epoch carries usable compensation data. */
export function isCompensating(etc: EtcData | undefined): etc is EtcData {
  return (
    !!etc &&
    etc.state === TiltState.Compensating &&
    Number.isFinite(etc.tiltDirection) &&
    Number.isFinite(etc.tiltValue)
  );
}

/** Convenience: 2D result of tilt compensation for display/storage. */
export function compensate2d(
  antenna: LatLon,
  etc: EtcData,
  poleHeightM: number,
): LatLon {
  const h = antennaHeightM(poleHeightM);
  const out = compensateTilt(
    { ...antenna, h: 0 },
    etc.tiltDirection,
    etc.tiltValue,
    h,
  );
  return { lat: out.lat, lon: out.lon };
}
