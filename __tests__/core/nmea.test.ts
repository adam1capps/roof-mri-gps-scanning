import { buildSentence, validateSentence } from '../../src/core/nmea/checksum';
import { EpochAssembler } from '../../src/core/nmea/epoch';
import { parseNmeaCoordinate, parseNmeaSentence } from '../../src/core/nmea/parse';
import { NmeaStreamParser } from '../../src/core/nmea/stream';
import {
  EtcData,
  FixQuality,
  GgaData,
  GnssEpoch,
  GsaData,
  GstData,
  TiltNotification,
  TiltState,
} from '../../src/core/nmea/types';

const GGA_RTK =
  '$GNGGA,193828.80,4717.113993,N,00833.915803,E,4,25,0.7,411.023,M,47.966,M,1.0,0000*5D';
const GGA_FLOAT =
  '$GNGGA,193828.80,4717.113993,N,00833.915803,E,5,25,0.7,411.023,M,47.966,M,1.0,0000*5C';
const GGA_NOFIX = '$GNGGA,,,,,,0,00,99.99,,,,,,*56';
const GST = '$GNGST,193828.80,1.2,0.008,0.006,45.0,0.006,0.005,0.011*77';
const ETC_COMPENSATING =
  '$GNETC,193828.80,30,00,172.543,5.621,2.344,1.013,0.993,1.021*5E';
const ETC_FAST_MOTION =
  '$GNETC,193828.80,30,10,172.543,5.621,2.344,1.013,0.993,1.021*5F';
const ETC_OFF_NO_GNSS = '$GNETC,,,,,,,,,*77';
const ETC_ALIGNMENT = '$GNETC,193828.80,20,00,,,,,,*5A';
const GSA = '$GPGSA,A,3,05,12,20,25,29,31,,,,,,,1.2,0.7,0.9*35';

describe('checksum', () => {
  it('accepts valid sentences and rejects corrupted ones', () => {
    expect(validateSentence(GGA_RTK)).not.toBeNull();
    expect(validateSentence(GGA_RTK.replace('4717', '4718'))).toBeNull();
    expect(validateSentence(GGA_RTK.slice(0, -1) + 'E')).toBeNull();
    expect(validateSentence('garbage')).toBeNull();
  });

  it('buildSentence round-trips through validateSentence', () => {
    const s = buildSentence('GNETC,193828.80,30,00,172.543,5.621,2.344,1.013,0.993,1.021');
    expect(s).toBe(ETC_COMPENSATING);
    expect(validateSentence(s)).not.toBeNull();
  });
});

describe('coordinate parsing', () => {
  it('converts ddmm.mmmm to decimal degrees', () => {
    expect(parseNmeaCoordinate('4717.113993', 'N')).toBeCloseTo(47.28523322, 8);
    expect(parseNmeaCoordinate('00833.915803', 'E')).toBeCloseTo(8.56526338, 8);
    expect(parseNmeaCoordinate('4717.113993', 'S')).toBeCloseTo(-47.28523322, 8);
    expect(parseNmeaCoordinate('00833.915803', 'W')).toBeCloseTo(-8.56526338, 8);
  });

  it('returns NaN for empty fields', () => {
    expect(parseNmeaCoordinate('', '')).toBeNaN();
  });
});

describe('GGA', () => {
  it('parses an RTK FIX sentence', () => {
    const gga = parseNmeaSentence(GGA_RTK) as GgaData;
    expect(gga.kind).toBe('GGA');
    expect(gga.quality).toBe(FixQuality.RtkFix);
    expect(gga.latitude).toBeCloseTo(47.28523322, 7);
    expect(gga.longitude).toBeCloseTo(8.56526338, 7);
    expect(gga.satellites).toBe(25);
    expect(gga.diffAge).toBeCloseTo(1.0);
    expect(gga.raw).toBe(GGA_RTK);
  });

  it('parses no-fix sentences without position', () => {
    const gga = parseNmeaSentence(GGA_NOFIX) as GgaData;
    expect(gga.quality).toBe(FixQuality.Invalid);
    expect(gga.latitude).toBeNaN();
  });
});

describe('GST', () => {
  it('extracts per-axis sigmas', () => {
    const gst = parseNmeaSentence(GST) as GstData;
    expect(gst.kind).toBe('GST');
    expect(gst.sigmaLat).toBeCloseTo(0.006);
    expect(gst.sigmaLon).toBeCloseTo(0.005);
    expect(gst.time).toBe('193828.80');
  });
});

describe('ETC (Emlid tilt, rev.3)', () => {
  it('parses the compensating state with all fields', () => {
    const etc = parseNmeaSentence(ETC_COMPENSATING) as EtcData;
    expect(etc.kind).toBe('ETC');
    expect(etc.state).toBe(TiltState.Compensating);
    expect(etc.notification).toBe(TiltNotification.None);
    expect(etc.heading).toBeCloseTo(172.543);
    expect(etc.tiltDirection).toBeCloseTo(5.621);
    expect(etc.tiltValue).toBeCloseTo(2.344);
    expect(etc.nAxisAcc).toBeCloseTo(1.013);
    expect(etc.eAxisAcc).toBeCloseTo(0.993);
    expect(etc.uAxisAcc).toBeCloseTo(1.021);
  });

  it('parses tilt-off (empty state) as null', () => {
    const etc = parseNmeaSentence(ETC_OFF_NO_GNSS) as EtcData;
    expect(etc.state).toBeNull();
    expect(etc.notification).toBeNull();
  });

  it('parses alignment state with empty value fields', () => {
    const etc = parseNmeaSentence(ETC_ALIGNMENT) as EtcData;
    expect(etc.state).toBe(TiltState.Alignment);
    expect(etc.tiltValue).toBeNaN();
  });

  it('parses the fast-motion notification', () => {
    const etc = parseNmeaSentence(ETC_FAST_MOTION) as EtcData;
    expect(etc.state).toBe(TiltState.Compensating);
    expect(etc.notification).toBe(TiltNotification.FastMotion);
  });
});

describe('GSA', () => {
  it('parses DOP and satellite ids', () => {
    const gsa = parseNmeaSentence(GSA) as GsaData;
    expect(gsa.satelliteIds).toEqual(['05', '12', '20', '25', '29', '31']);
    expect(gsa.hdop).toBeCloseTo(0.7);
  });
});

describe('NmeaStreamParser', () => {
  it('reassembles sentences split across arbitrary chunks', () => {
    const seen: string[] = [];
    const parser = new NmeaStreamParser(s => seen.push(s.kind));
    const stream = `${GGA_RTK}\r\n${GST}\r\n${ETC_COMPENSATING}\r\n`;
    for (const ch of stream) parser.feed(ch); // worst case: 1-byte chunks
    expect(seen).toEqual(['GGA', 'GST', 'ETC']);
  });

  it('skips garbage between sentences', () => {
    const seen: string[] = [];
    const parser = new NmeaStreamParser(s => seen.push(s.kind));
    parser.feed(`\x00\x7f junk${GGA_RTK}\r\nnoise line\r\n${GST}\r\n`);
    expect(seen).toEqual(['GGA', 'GST']);
  });

  it('drops sentences with bad checksums', () => {
    const seen: string[] = [];
    const parser = new NmeaStreamParser(s => seen.push(s.kind));
    parser.feed(GGA_RTK.replace('25', '26') + '\r\n');
    expect(seen).toEqual([]);
  });
});

describe('EpochAssembler', () => {
  const feed = (assembler: EpochAssembler, lines: string[]) => {
    for (const line of lines) {
      const s = parseNmeaSentence(line);
      if (s) assembler.feed(s);
    }
  };

  it('assembles GGA+GST+ETC sharing a timestamp', () => {
    const epochs: GnssEpoch[] = [];
    const assembler = new EpochAssembler(e => epochs.push(e));
    feed(assembler, [GGA_RTK, GST, ETC_COMPENSATING]);
    expect(epochs).toHaveLength(1);
    expect(epochs[0].gga.quality).toBe(FixQuality.RtkFix);
    expect(epochs[0].gst?.sigmaLat).toBeCloseTo(0.006);
    expect(epochs[0].etc?.state).toBe(TiltState.Compensating);
  });

  it('flushes an incomplete epoch when a newer timestamp arrives', () => {
    const epochs: GnssEpoch[] = [];
    const assembler = new EpochAssembler(e => epochs.push(e));
    // Epoch 1 without ETC, then epoch 2 begins.
    feed(assembler, [GGA_RTK, GST]);
    expect(epochs).toHaveLength(0);
    const nextGga = buildSentence(
      'GNGGA,193829.00,4717.113993,N,00833.915803,E,4,25,0.7,411.023,M,47.966,M,1.0,0000',
    );
    feed(assembler, [nextGga]);
    expect(epochs).toHaveLength(1);
    expect(epochs[0].time).toBe('193828.80');
    expect(epochs[0].etc).toBeUndefined();
  });

  it('drops orphan GST/ETC without GGA', () => {
    const epochs: GnssEpoch[] = [];
    const assembler = new EpochAssembler(e => epochs.push(e));
    feed(assembler, [GST, ETC_COMPENSATING]);
    const nextGga = buildSentence(
      'GNGGA,193829.00,4717.113993,N,00833.915803,E,4,25,0.7,411.023,M,47.966,M,1.0,0000',
    );
    feed(assembler, [nextGga]);
    expect(epochs).toHaveLength(0);
  });
});
