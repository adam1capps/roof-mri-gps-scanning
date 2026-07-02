import {
  distanceM,
  m2ToSqFt,
  m2ToSquares,
  polygonAreaM2,
  polygonPerimeterM,
  polylineLengthM,
  toLocalEN,
} from '../../src/core/geo/measure';
import { ecefToLlh, enuToLlh, llhToEcef, llhToEnu } from '../../src/core/geo/transforms';
import { compensateTilt, antennaHeightM, RX2_BOTTOM_TO_ARP_M, tiltAccuracy2dMm } from '../../src/core/geo/tilt';
import { llToUtm, utmZone } from '../../src/core/geo/utm';
import { Llh } from '../../src/core/geo/wgs84';
import { EtcData, TiltNotification, TiltState } from '../../src/core/nmea/types';

const DALLAS: Llh = { lat: 32.7767, lon: -96.797, h: 150 };

describe('ECEF / geodetic transforms', () => {
  it('llhToEcef matches a canonical value (equator/prime meridian)', () => {
    const e = llhToEcef({ lat: 0, lon: 0, h: 0 });
    expect(e.x).toBeCloseTo(6378137, 3);
    expect(e.y).toBeCloseTo(0, 6);
    expect(e.z).toBeCloseTo(0, 6);
  });

  it('round-trips llh → ecef → llh to sub-millimeter', () => {
    const back = ecefToLlh(llhToEcef(DALLAS));
    expect(back.lat).toBeCloseTo(DALLAS.lat, 9);
    expect(back.lon).toBeCloseTo(DALLAS.lon, 9);
    expect(back.h).toBeCloseTo(DALLAS.h, 4);
  });

  it('ENU round-trip: shift 10 m east/north and come back', () => {
    const moved = enuToLlh(DALLAS, { e: 10, n: 10, u: 0 });
    const enu = llhToEnu(DALLAS, moved);
    expect(enu.e).toBeCloseTo(10, 6);
    expect(enu.n).toBeCloseTo(10, 6);
    expect(enu.u).toBeCloseTo(0, 5);
  });
});

describe('tilt compensation (Emlid ETC rev.3 formulas)', () => {
  it('adds the bottom-to-ARP offset to pole height', () => {
    expect(antennaHeightM(1.8)).toBeCloseTo(1.945);
    expect(RX2_BOTTOM_TO_ARP_M).toBe(0.145);
  });

  it('offsets horizontally by antennaHeight·sin(tilt) opposite the tilt direction', () => {
    const antH = antennaHeightM(1.8);
    const tiltDeg = 10;
    // Pole tilted toward due east (tilt direction 90°): tip is WEST of antenna.
    const tip = compensateTilt(DALLAS, 90, tiltDeg, antH);
    const enu = llhToEnu(DALLAS, tip);
    const expected = antH * Math.sin((tiltDeg * Math.PI) / 180);
    expect(enu.e).toBeCloseTo(-expected, 4);
    expect(enu.n).toBeCloseTo(0, 4);
    expect(enu.u).toBeCloseTo(-antH * Math.cos((tiltDeg * Math.PI) / 180), 4);
  });

  it('vertical pole → tip directly below antenna', () => {
    const tip = compensateTilt(DALLAS, 0, 0, 2);
    const enu = llhToEnu(DALLAS, tip);
    expect(Math.hypot(enu.e, enu.n)).toBeLessThan(1e-6);
    expect(enu.u).toBeCloseTo(-2, 5);
  });

  it('computes 2D tilt accuracy from ETC coefficients (mm)', () => {
    const etc: EtcData = {
      kind: 'ETC',
      talker: 'GN',
      time: '',
      state: TiltState.Compensating,
      notification: TiltNotification.None,
      heading: 0,
      tiltDirection: 0,
      tiltValue: 5,
      nAxisAcc: 3,
      eAxisAcc: 4,
      uAxisAcc: 1,
    };
    // 3-4-5 triangle: sqrt((3·2)² + (4·2)²) = 10 mm at 2 m antenna height.
    expect(tiltAccuracy2dMm(etc, 2)).toBeCloseTo(10);
  });
});

describe('area / perimeter on the local tangent plane', () => {
  /** Build a lat/lon square of side `s` meters centered on DALLAS. */
  function square(s: number) {
    const half = s / 2;
    return [
      enuToLlh(DALLAS, { e: -half, n: -half, u: 0 }),
      enuToLlh(DALLAS, { e: half, n: -half, u: 0 }),
      enuToLlh(DALLAS, { e: half, n: half, u: 0 }),
      enuToLlh(DALLAS, { e: -half, n: half, u: 0 }),
    ]; // keep h — the tangent plane must be evaluated at roof height
  }

  it('measures a 30 m × 30 m roof to millimeter-level accuracy', () => {
    const poly = square(30);
    expect(polygonAreaM2(poly)).toBeCloseTo(900, 3);
    expect(polygonPerimeterM(poly)).toBeCloseTo(120, 4);
  });

  it('measures an L-shaped building correctly', () => {
    // 40×20 rectangle with a 20×10 notch removed → 800 − 200 = 600 m².
    const pts = [
      { e: 0, n: 0 },
      { e: 40, n: 0 },
      { e: 40, n: 10 },
      { e: 20, n: 10 },
      { e: 20, n: 20 },
      { e: 0, n: 20 },
    ].map(({ e, n }) => enuToLlh(DALLAS, { e, n, u: 0 }));
    expect(polygonAreaM2(pts)).toBeCloseTo(600, 3);
  });

  it('polyline length and point distance', () => {
    const a = enuToLlh(DALLAS, { e: 0, n: 0, u: 0 });
    const b = enuToLlh(DALLAS, { e: 3, n: 4, u: 0 });
    expect(distanceM(a, b)).toBeCloseTo(5, 5);
    expect(polylineLengthM([a, b])).toBeCloseTo(5, 5);
  });

  it('unit conversions', () => {
    expect(m2ToSqFt(92.90304)).toBeCloseTo(1000);
    expect(m2ToSquares(92.90304)).toBeCloseTo(10);
  });

  it('dropping heights shrinks distances by ~h/R (documented effect)', () => {
    const poly2d = square(30).map(p => ({ lat: p.lat, lon: p.lon }));
    const shrink = 1 - polygonAreaM2(poly2d) / 900;
    expect(shrink).toBeGreaterThan(3e-5); // 2·h/R at h≈150 m
    expect(shrink).toBeLessThan(7e-5);
  });

  it('toLocalEN anchors at the first point', () => {
    const en = toLocalEN([DALLAS, enuToLlh(DALLAS, { e: 7, n: -2, u: 0 })]);
    expect(en[0].e).toBeCloseTo(0, 6);
    expect(en[1].e).toBeCloseTo(7, 5);
    expect(en[1].n).toBeCloseTo(-2, 5);
  });
});

describe('UTM', () => {
  it('picks the right zone', () => {
    expect(utmZone(-96.797, 32.7767)).toBe(14); // Dallas
    expect(utmZone(-74.006, 40.7128)).toBe(18); // NYC
  });

  it('is exact at a zone central meridian on the equator', () => {
    const u = llToUtm({ lat: 0, lon: 3 }); // zone 31 central meridian
    expect(u.zone).toBe(31);
    expect(u.easting).toBeCloseTo(500000, 3);
    expect(u.northing).toBeCloseTo(0, 3);
    expect(u.epsg).toBe('EPSG:32631');
  });

  it('preserves local distances within scale-factor tolerance', () => {
    const a = { lat: 32.7767, lon: -96.797 };
    const pb = enuToLlh({ ...a, h: 0 }, { e: 100, n: 0, u: 0 });
    const ua = llToUtm(a);
    const ub = llToUtm({ lat: pb.lat, lon: pb.lon });
    const d = Math.hypot(ub.easting - ua.easting, ub.northing - ua.northing);
    expect(d).toBeGreaterThan(99.9);
    expect(d).toBeLessThan(100.1); // k ∈ [0.9996, 1.0004]
  });
});
