import { llhToEnu } from '../../src/core/geo/transforms';
import { antennaHeightM } from '../../src/core/geo/tilt';
import { PointAverager } from '../../src/core/gnss/averager';
import {
  DEFAULT_GATE,
  evaluateEpoch,
  GateConfig,
  GatedPoint,
  horizontalSigmaM,
} from '../../src/core/gnss/gate';
import {
  EtcData,
  FixQuality,
  GgaData,
  GnssEpoch,
  GstData,
  TiltNotification,
  TiltState,
} from '../../src/core/nmea/types';

const LAT = 32.7767;
const LON = -96.797;

function gga(quality: FixQuality): GgaData {
  return {
    kind: 'GGA',
    talker: 'GN',
    time: '120000.00',
    latitude: LAT,
    longitude: LON,
    quality,
    satellites: 24,
    hdop: 0.7,
    altitudeMsl: 150,
    geoidSeparation: -26,
    diffAge: 1,
    refStationId: '0000',
    raw: '$GNGGA,...',
  };
}

function gst(sigmaLat = 0.006, sigmaLon = 0.005): GstData {
  return {
    kind: 'GST',
    talker: 'GN',
    time: '120000.00',
    rms: 1,
    sigmaSemiMajor: 0.008,
    sigmaSemiMinor: 0.005,
    ellipseOrientation: 40,
    sigmaLat,
    sigmaLon,
    sigmaAlt: 0.01,
  };
}

function etc(
  state: TiltState | null,
  notification: TiltNotification | null = TiltNotification.None,
  tiltValue = 5,
  tiltDirection = 90,
): EtcData {
  return {
    kind: 'ETC',
    talker: 'GN',
    time: '120000.00',
    state,
    notification,
    heading: 180,
    tiltDirection,
    tiltValue,
    nAxisAcc: 1.0,
    eAxisAcc: 1.0,
    uAxisAcc: 1.0,
  };
}

function epoch(parts: { gga: GgaData; gst?: GstData; etc?: EtcData }): GnssEpoch {
  return { time: '120000.00', receivedAt: 1700000000000, ...parts };
}

const config: GateConfig = { ...DEFAULT_GATE, tiltMode: 'auto', poleHeightM: 1.8 };

describe('fix gate', () => {
  it('accepts RTK FIX + good sigma + tilt off', () => {
    const r = evaluateEpoch(epoch({ gga: gga(FixQuality.RtkFix), gst: gst() }), config);
    expect(r.accepted).toBe(true);
    expect(r.point!.lat).toBeCloseTo(LAT, 9);
    expect(r.point!.sigmaH).toBeCloseTo(horizontalSigmaM(0.006, 0.005));
    expect(r.point!.tiltCompensated).toBe(false);
  });

  it('rejects RTK FLOAT', () => {
    const r = evaluateEpoch(epoch({ gga: gga(FixQuality.RtkFloat), gst: gst() }), config);
    expect(r.accepted).toBe(false);
    expect(r.rejections.join()).toContain('RTK FLOAT');
  });

  it('rejects when sigma exceeds the threshold', () => {
    const r = evaluateEpoch(
      epoch({ gga: gga(FixQuality.RtkFix), gst: gst(0.05, 0.04) }),
      config,
    );
    expect(r.accepted).toBe(false);
    expect(r.rejections.join()).toContain('Accuracy');
  });

  it('rejects when GST is missing and required', () => {
    const r = evaluateEpoch(epoch({ gga: gga(FixQuality.RtkFix) }), config);
    expect(r.accepted).toBe(false);
    expect(r.rejections.join()).toContain('GST');
  });

  it('applies tilt compensation when compensating (auto mode)', () => {
    const r = evaluateEpoch(
      epoch({
        gga: gga(FixQuality.RtkFix),
        gst: gst(),
        etc: etc(TiltState.Compensating),
      }),
      config,
    );
    expect(r.accepted).toBe(true);
    expect(r.point!.tiltCompensated).toBe(true);

    // Tilted 5° toward east → recorded point is west of the antenna.
    const enu = llhToEnu(
      { lat: LAT, lon: LON, h: 0 },
      { lat: r.point!.lat, lon: r.point!.lon, h: 0 },
    );
    const antH = antennaHeightM(config.poleHeightM);
    expect(enu.e).toBeCloseTo(-antH * Math.sin((5 * Math.PI) / 180), 4);
    expect(enu.n).toBeCloseTo(0, 4);

    // Total accuracy grows by the tilt term: sqrt(2)·antH mm at coeff 1/1.
    const tiltMm = Math.sqrt(2) * antH;
    expect(r.point!.totalAccuracy2d).toBeCloseTo(
      r.point!.sigmaH + tiltMm / 1000,
      6,
    );
  });

  it('rejects alignment state in auto mode', () => {
    const r = evaluateEpoch(
      epoch({ gga: gga(FixQuality.RtkFix), gst: gst(), etc: etc(TiltState.Alignment) }),
      config,
    );
    expect(r.accepted).toBe(false);
    expect(r.rejections.join()).toContain('aligning');
  });

  it('require-compensated rejects tilt-off epochs', () => {
    const r = evaluateEpoch(epoch({ gga: gga(FixQuality.RtkFix), gst: gst() }), {
      ...config,
      tiltMode: 'require-compensated',
    });
    expect(r.accepted).toBe(false);
    expect(r.rejections.join()).toContain('Tilt is off');
  });

  it('receiver-compensated mode keeps the GGA position (no double compensation)', () => {
    const r = evaluateEpoch(
      epoch({
        gga: gga(FixQuality.RtkFix),
        gst: gst(),
        etc: etc(TiltState.Compensating),
      }),
      { ...config, tiltMode: 'receiver-compensated' },
    );
    expect(r.accepted).toBe(true);
    // Position passes through untouched — the receiver already applied the offset.
    expect(r.point!.lat).toBeCloseTo(LAT, 12);
    expect(r.point!.lon).toBeCloseTo(LON, 12);
    expect(r.point!.tiltCompensated).toBe(true);
    // No tilt error term added: compensated GST reflects full accuracy.
    expect(r.point!.totalAccuracy2d).toBeCloseTo(r.point!.sigmaH, 12);
  });

  it('receiver-compensated mode rejects non-compensating states', () => {
    for (const e of [
      epoch({ gga: gga(FixQuality.RtkFix), gst: gst() }), // tilt off
      epoch({ gga: gga(FixQuality.RtkFix), gst: gst(), etc: etc(TiltState.Alignment) }),
    ]) {
      expect(
        evaluateEpoch(e, { ...config, tiltMode: 'receiver-compensated' }).accepted,
      ).toBe(false);
    }
  });

  it('level-pole mode uses the raw antenna position even when compensating', () => {
    const r = evaluateEpoch(
      epoch({
        gga: gga(FixQuality.RtkFix),
        gst: gst(),
        etc: etc(TiltState.Compensating),
      }),
      { ...config, tiltMode: 'level-pole' },
    );
    expect(r.accepted).toBe(true);
    expect(r.point!.lat).toBeCloseTo(LAT, 12);
    expect(r.point!.tiltCompensated).toBe(false);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('rejects fast motion by default, warns when allowed', () => {
    const e = epoch({
      gga: gga(FixQuality.RtkFix),
      gst: gst(),
      etc: etc(TiltState.Compensating, TiltNotification.FastMotion),
    });
    expect(evaluateEpoch(e, config).accepted).toBe(false);
    const relaxed = evaluateEpoch(e, { ...config, rejectFastMotion: false });
    expect(relaxed.accepted).toBe(true);
    expect(relaxed.warnings.join()).toContain('Fast motion');
  });

  it('rejects bad-gnss and filter-fault notifications outright', () => {
    for (const n of [TiltNotification.BadGnss, TiltNotification.FilterFault]) {
      const r = evaluateEpoch(
        epoch({
          gga: gga(FixQuality.RtkFix),
          gst: gst(),
          etc: etc(TiltState.Compensating, n),
        }),
        config,
      );
      expect(r.accepted).toBe(false);
    }
  });
});

describe('PointAverager', () => {
  function pointAt(e: number, n: number): GatedPoint {
    const base = { lat: LAT, lon: LON, h: 0 };
    const moved = require('../../src/core/geo/transforms').enuToLlh(base, { e, n, u: 0 });
    return {
      lat: moved.lat,
      lon: moved.lon,
      ellipsoidalH: NaN,
    sigmaH: 0.008,
      totalAccuracy2d: 0.01,
      fixQuality: FixQuality.RtkFix,
      satellites: 24,
      tiltCompensated: false,
      gpsTime: '120000.00',
      receivedAt: 0,
    };
  }

  it('averages symmetric scatter back to the center', () => {
    const avg = new PointAverager(4);
    avg.add(pointAt(0.02, 0));
    avg.add(pointAt(-0.02, 0));
    avg.add(pointAt(0, 0.02));
    expect(avg.done).toBe(false);
    avg.add(pointAt(0, -0.02));
    expect(avg.done).toBe(true);

    const result = avg.result()!;
    const enu = llhToEnu(
      { lat: LAT, lon: LON, h: 0 },
      { lat: result.lat, lon: result.lon, h: 0 },
    );
    expect(Math.hypot(enu.e, enu.n)).toBeLessThan(1e-4);
  });

  it('single sample passes through unchanged', () => {
    const avg = new PointAverager(1);
    const p = pointAt(0.01, 0.01);
    avg.add(p);
    expect(avg.result()).toEqual(p);
  });
});
