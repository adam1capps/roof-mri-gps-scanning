/**
 * Parsed NMEA sentence types for the Emlid Reach RX2 (2D roof measurement).
 *
 * The RX2 outputs NMEA 0183 at 5 Hz over Bluetooth. We parse:
 *  - GGA: position + fix quality (the primary position source)
 *  - GST: per-epoch coordinate error estimates (accuracy gating)
 *  - ETC: Emlid proprietary tilt-compensation data (ETC rev.3 spec)
 *  - GSA/GSV: DOP + satellite health (display only)
 */

/** GGA fix quality indicator. Points are only recorded at RTK_FIX. */
export enum FixQuality {
  Invalid = 0,
  Gps = 1,
  Dgps = 2,
  Pps = 3,
  RtkFix = 4,
  RtkFloat = 5,
  DeadReckoning = 6,
  Manual = 7,
  Simulation = 8,
}

export interface GgaData {
  kind: 'GGA';
  talker: string;
  /** UTC time-of-fix as transmitted, e.g. "193828.80" (hhmmss.ss). */
  time: string;
  /** Decimal degrees, positive north. NaN when no fix. */
  latitude: number;
  /** Decimal degrees, positive east. NaN when no fix. */
  longitude: number;
  quality: FixQuality;
  satellites: number;
  hdop: number;
  /** Orthometric height (MSL), meters. Unused for 2D but parsed. */
  altitudeMsl: number;
  geoidSeparation: number;
  /** Age of differential corrections, seconds (NaN if absent). */
  diffAge: number;
  refStationId: string;
  /** Raw sentence including $ and checksum — forwarded upstream to NTRIP casters (VRS). */
  raw: string;
}

export interface GstData {
  kind: 'GST';
  talker: string;
  time: string;
  /** RMS of pseudorange residuals. */
  rms: number;
  /** Error ellipse semi-major/minor sigma, meters. */
  sigmaSemiMajor: number;
  sigmaSemiMinor: number;
  /** Error ellipse orientation, degrees from true north. */
  ellipseOrientation: number;
  /** 1-sigma latitude error, meters. */
  sigmaLat: number;
  /** 1-sigma longitude error, meters. */
  sigmaLon: number;
  /** 1-sigma altitude error, meters (unused in 2D). */
  sigmaAlt: number;
}

/**
 * Emlid tilt-compensation engine state (ETC rev.3, field 2).
 * `null` = tilt engine is off (field empty).
 */
export enum TiltState {
  FatalError = 0,
  Setup = 10,
  Alignment = 20,
  Compensating = 30,
}

/**
 * Emlid tilt notification (ETC rev.3, field 3).
 * `null` = tilt is off (field empty).
 */
export enum TiltNotification {
  None = 0,
  FastMotion = 10,
  BadGnss = 20,
  FilterFault = 30,
}

/**
 * $GNETC — Emlid proprietary tilt compensation data (message rev.1, doc rev.3).
 *
 * Format:
 * $GNETC,<UTC>,<State>,<Notification>,<Heading>,<Tilt Direction>,<Tilt Value>,
 *        <n-axis-acc>,<e-axis-acc>,<u-axis-acc>*<CS>
 *
 * Heading / tilt direction / tilt value / accuracy coefficients are only
 * populated in the Compensating state (30). ETC is emitted at the same rate
 * as GGA; match the two by the UTC timestamp field.
 */
export interface EtcData {
  kind: 'ETC';
  talker: string;
  time: string;
  /** null = tilt off. */
  state: TiltState | null;
  /** null = tilt off. */
  notification: TiltNotification | null;
  /** Degrees [0, 360). Only in Compensating state. */
  heading: number;
  /** Direction the pole is tilted toward, degrees [0, 360). Compensating only. */
  tiltDirection: number;
  /** Tilt from vertical, degrees [0, 180]. Compensating only. */
  tiltValue: number;
  /** Per-axis accuracy coefficients (multiply by antenna height in m → mm). */
  nAxisAcc: number;
  eAxisAcc: number;
  uAxisAcc: number;
}

export interface GsaData {
  kind: 'GSA';
  talker: string;
  fixMode: number; // 1 = none, 2 = 2D, 3 = 3D
  satelliteIds: string[];
  pdop: number;
  hdop: number;
  vdop: number;
}

export interface GsvSatellite {
  prn: string;
  elevationDeg: number;
  azimuthDeg: number;
  snrDbHz: number;
}

export interface GsvData {
  kind: 'GSV';
  talker: string;
  totalMessages: number;
  messageNumber: number;
  satellitesInView: number;
  satellites: GsvSatellite[];
}

export type NmeaSentence = GgaData | GstData | EtcData | GsaData | GsvData;

/**
 * One GNSS epoch: GGA plus the same-timestamp GST/ETC sentences.
 * This is the unit the fix gate evaluates.
 */
export interface GnssEpoch {
  /** UTC time-of-fix string shared by the sentences, e.g. "193828.80". */
  time: string;
  gga: GgaData;
  gst?: GstData;
  etc?: EtcData;
  /** Phone wall-clock time when the epoch was assembled (ms since Unix epoch). */
  receivedAt: number;
}
