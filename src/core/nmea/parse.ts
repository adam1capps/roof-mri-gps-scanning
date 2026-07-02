import { validateSentence } from './checksum';
import {
  EtcData,
  FixQuality,
  GgaData,
  GsaData,
  GstData,
  GsvData,
  GsvSatellite,
  NmeaSentence,
  TiltNotification,
  TiltState,
} from './types';

/** ddmm.mmmm / dddmm.mmmm → decimal degrees. Returns NaN for empty fields. */
export function parseNmeaCoordinate(value: string, hemisphere: string): number {
  if (!value || !hemisphere) return NaN;
  const dot = value.indexOf('.');
  const degDigits = (dot < 0 ? value.length : dot) - 2;
  if (degDigits < 1) return NaN;
  const degrees = parseInt(value.slice(0, degDigits), 10);
  const minutes = parseFloat(value.slice(degDigits));
  if (Number.isNaN(degrees) || Number.isNaN(minutes)) return NaN;
  const dd = degrees + minutes / 60;
  return hemisphere === 'S' || hemisphere === 'W' ? -dd : dd;
}

const num = (s: string | undefined): number =>
  s === undefined || s === '' ? NaN : parseFloat(s);

const intOrNull = (s: string | undefined): number | null =>
  s === undefined || s === '' ? null : parseInt(s, 10);

function parseGga(talker: string, f: string[], raw: string): GgaData {
  return {
    kind: 'GGA',
    talker,
    time: f[1] ?? '',
    latitude: parseNmeaCoordinate(f[2] ?? '', f[3] ?? ''),
    longitude: parseNmeaCoordinate(f[4] ?? '', f[5] ?? ''),
    quality: (intOrNull(f[6]) ?? FixQuality.Invalid) as FixQuality,
    satellites: intOrNull(f[7]) ?? 0,
    hdop: num(f[8]),
    altitudeMsl: num(f[9]),
    geoidSeparation: num(f[11]),
    diffAge: num(f[13]),
    refStationId: f[14] ?? '',
    raw,
  };
}

function parseGst(talker: string, f: string[]): GstData {
  return {
    kind: 'GST',
    talker,
    time: f[1] ?? '',
    rms: num(f[2]),
    sigmaSemiMajor: num(f[3]),
    sigmaSemiMinor: num(f[4]),
    ellipseOrientation: num(f[5]),
    sigmaLat: num(f[6]),
    sigmaLon: num(f[7]),
    sigmaAlt: num(f[8]),
  };
}

/** ETC rev.3: $GNETC,<UTC>,<State>,<Notif>,<Heading>,<TiltDir>,<TiltVal>,<n>,<e>,<u>*CS */
function parseEtc(talker: string, f: string[]): EtcData {
  return {
    kind: 'ETC',
    talker,
    time: f[1] ?? '',
    state: intOrNull(f[2]) as TiltState | null,
    notification: intOrNull(f[3]) as TiltNotification | null,
    heading: num(f[4]),
    tiltDirection: num(f[5]),
    tiltValue: num(f[6]),
    nAxisAcc: num(f[7]),
    eAxisAcc: num(f[8]),
    uAxisAcc: num(f[9]),
  };
}

function parseGsa(talker: string, f: string[]): GsaData {
  const ids: string[] = [];
  for (let i = 3; i <= 14; i++) {
    if (f[i]) ids.push(f[i]);
  }
  return {
    kind: 'GSA',
    talker,
    fixMode: intOrNull(f[2]) ?? 1,
    satelliteIds: ids,
    pdop: num(f[15]),
    hdop: num(f[16]),
    vdop: num(f[17]),
  };
}

function parseGsv(talker: string, f: string[]): GsvData {
  const satellites: GsvSatellite[] = [];
  for (let i = 4; i + 3 < f.length || i + 3 === f.length; i += 4) {
    const prn = f[i];
    if (prn === undefined) break;
    if (prn === '' && !f[i + 1] && !f[i + 2] && !f[i + 3]) continue;
    satellites.push({
      prn,
      elevationDeg: num(f[i + 1]),
      azimuthDeg: num(f[i + 2]),
      snrDbHz: num(f[i + 3]),
    });
  }
  return {
    kind: 'GSV',
    talker,
    totalMessages: intOrNull(f[1]) ?? 0,
    messageNumber: intOrNull(f[2]) ?? 0,
    satellitesInView: intOrNull(f[3]) ?? 0,
    satellites,
  };
}

/**
 * Parses one complete NMEA line (with $ and checksum).
 * Returns null for unknown sentence types or failed checksums.
 */
export function parseNmeaSentence(line: string): NmeaSentence | null {
  const body = validateSentence(line.trim());
  if (body === null) return null;

  const fields = body.split(',');
  const address = fields[0]; // e.g. GNGGA, GPGSV, GNETC
  if (address.length < 5) return null;
  const talker = address.slice(0, 2);
  const type = address.slice(2);

  switch (type) {
    case 'GGA':
      return parseGga(talker, fields, line.trim());
    case 'GST':
      return parseGst(talker, fields);
    case 'ETC':
      return parseEtc(talker, fields);
    case 'GSA':
      return parseGsa(talker, fields);
    case 'GSV':
      return parseGsv(talker, fields);
    default:
      return null; // RMC/VTG/ZDA etc. — not needed for 2D capture
  }
}
