import { compensate2d, antennaHeightM, isCompensating, tiltAccuracy2dMm } from '../geo/tilt';
import { LatLon } from '../geo/wgs84';
import {
  FixQuality,
  GnssEpoch,
  TiltNotification,
  TiltState,
} from '../nmea/types';

/**
 * Fix gate: decides whether a GNSS epoch is good enough to record.
 *
 * A point is recorded only when:
 *  1. GGA quality is RTK FIX (4),
 *  2. GST horizontal sigma (plus the tilt error contribution when
 *     compensating) is under the configured threshold,
 *  3. the tilt policy is satisfied (see TiltMode).
 */

export type TiltMode =
  /** Only accept epochs with the tilt engine compensating (state 30); apply the offset. */
  | 'require-compensated'
  /** Pole is held level (or tilt disabled): use GGA position as-is; reject if tilt engine is active. */
  | 'level-pole'
  /** Compensate when state 30, pass through when tilt is off, reject transitional states. */
  | 'auto';

export interface GateConfig {
  /** Max accepted 2D accuracy, meters. Default 0.03 m. */
  maxHorizontalSigmaM: number;
  tiltMode: TiltMode;
  /** Pole tip → receiver bottom, meters (tilt offset arm). */
  poleHeightM: number;
  /** Reject epochs flagged with the fast-motion notification (10). */
  rejectFastMotion: boolean;
  /** Require a GST sentence — without it there is no per-point accuracy. */
  requireGst: boolean;
}

export const DEFAULT_GATE: GateConfig = {
  maxHorizontalSigmaM: 0.03,
  tiltMode: 'auto',
  poleHeightM: 1.8,
  rejectFastMotion: true,
  requireGst: true,
};

/** A gated, accepted, tilt-resolved 2D point ready to be captured. */
export interface GatedPoint {
  lat: number;
  lon: number;
  /** Ellipsoidal height of the point, meters (GGA MSL + geoid sep; NaN if absent). */
  ellipsoidalH: number;
  /** GST-derived horizontal 1-sigma RMS, meters. */
  sigmaH: number;
  /** Total 2D accuracy incl. tilt contribution, meters. */
  totalAccuracy2d: number;
  fixQuality: FixQuality;
  satellites: number;
  tiltCompensated: boolean;
  tiltValueDeg?: number;
  headingDeg?: number;
  gpsTime: string;
  receivedAt: number;
}

export interface GateResult {
  accepted: boolean;
  point?: GatedPoint;
  /** Human-readable reasons why the epoch was rejected (empty on accept). */
  rejections: string[];
  /** Non-fatal notices (e.g. fast-motion warning when configured to allow). */
  warnings: string[];
}

/** GST horizontal RMS: sqrt(sigmaLat² + sigmaLon²), meters. */
export function horizontalSigmaM(sigmaLat: number, sigmaLon: number): number {
  return Math.sqrt(sigmaLat * sigmaLat + sigmaLon * sigmaLon);
}

const FIX_LABEL: Record<number, string> = {
  0: 'NO FIX',
  1: 'SINGLE',
  2: 'DGPS',
  4: 'RTK FIX',
  5: 'RTK FLOAT',
};

export function fixQualityLabel(q: FixQuality): string {
  return FIX_LABEL[q] ?? `Q${q}`;
}

export function evaluateEpoch(epoch: GnssEpoch, config: GateConfig): GateResult {
  const rejections: string[] = [];
  const warnings: string[] = [];
  const { gga, gst, etc } = epoch;

  if (!Number.isFinite(gga.latitude) || !Number.isFinite(gga.longitude)) {
    return { accepted: false, rejections: ['No position'], warnings };
  }

  if (gga.quality !== FixQuality.RtkFix) {
    rejections.push(`Not RTK FIX (${fixQualityLabel(gga.quality)})`);
  }

  let sigmaH = NaN;
  if (gst) {
    sigmaH = horizontalSigmaM(gst.sigmaLat, gst.sigmaLon);
  } else if (config.requireGst) {
    rejections.push('No GST accuracy data');
  }

  // Resolve tilt policy.
  const tiltOff = !etc || etc.state === null;
  const tiltState = etc ? etc.state : null;
  let position: LatLon = { lat: gga.latitude, lon: gga.longitude };
  let tiltCompensated = false;
  let tiltErrorMm = 0;

  if (etc && etc.notification === TiltNotification.FastMotion) {
    if (config.rejectFastMotion) rejections.push('Receiver moving too fast');
    else warnings.push('Fast motion — accuracy may be degraded');
  }
  if (etc && etc.notification === TiltNotification.BadGnss) {
    rejections.push('Tilt engine reports bad GNSS');
  }
  if (etc && etc.notification === TiltNotification.FilterFault) {
    rejections.push('Tilt filter fault');
  }

  switch (config.tiltMode) {
    case 'require-compensated':
      if (!isCompensating(etc)) {
        rejections.push(tiltOff ? 'Tilt is off (required on)' : tiltStateLabel(tiltState));
      }
      break;
    case 'level-pole':
      if (!tiltOff && etc?.state === TiltState.Compensating) {
        warnings.push('Tilt engine active but level-pole mode set — using raw position');
      }
      break;
    case 'auto':
      if (!tiltOff && !isCompensating(etc)) {
        rejections.push(tiltStateLabel(tiltState));
      }
      break;
  }

  if (
    (config.tiltMode === 'require-compensated' || config.tiltMode === 'auto') &&
    isCompensating(etc)
  ) {
    const antH = antennaHeightM(config.poleHeightM);
    position = compensate2d(position, etc, config.poleHeightM);
    tiltCompensated = true;
    tiltErrorMm = tiltAccuracy2dMm(etc, antH);
  }

  const totalAccuracy2d = Number.isFinite(sigmaH)
    ? sigmaH + tiltErrorMm / 1000
    : NaN;

  if (Number.isFinite(totalAccuracy2d) && totalAccuracy2d > config.maxHorizontalSigmaM) {
    rejections.push(
      `Accuracy ${(totalAccuracy2d * 100).toFixed(1)} cm > limit ${(config.maxHorizontalSigmaM * 100).toFixed(1)} cm`,
    );
  }

  if (rejections.length > 0) {
    return { accepted: false, rejections, warnings };
  }

  return {
    accepted: true,
    rejections,
    warnings,
    point: {
      lat: position.lat,
      lon: position.lon,
      ellipsoidalH: gga.altitudeMsl + gga.geoidSeparation,
      sigmaH,
      totalAccuracy2d,
      fixQuality: gga.quality,
      satellites: gga.satellites,
      tiltCompensated,
      tiltValueDeg: tiltCompensated ? etc!.tiltValue : undefined,
      headingDeg: tiltCompensated ? etc!.heading : undefined,
      gpsTime: epoch.time,
      receivedAt: epoch.receivedAt,
    },
  };
}

export function tiltStateLabel(state: TiltState | null | undefined): string {
  switch (state) {
    case TiltState.FatalError:
      return 'Tilt fatal error — reboot receiver';
    case TiltState.Setup:
      return 'Tilt initializing';
    case TiltState.Alignment:
      return 'Tilt aligning — move the receiver';
    case TiltState.Compensating:
      return 'Compensating';
    case null:
    case undefined:
      return 'Tilt off';
    default:
      return `Tilt state ${state}`;
  }
}
