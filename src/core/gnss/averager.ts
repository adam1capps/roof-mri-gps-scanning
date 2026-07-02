import { llhToEnu, enuToLlh } from '../geo/transforms';
import { GatedPoint } from './gate';

/**
 * Averages N consecutive gated epochs into one point (optional; at 5 Hz,
 * 10 epochs = 2 s of occupation). Averaging happens on the local tangent
 * plane anchored at the first sample, then converts back to geodetic.
 */
export class PointAverager {
  private samples: GatedPoint[] = [];

  constructor(readonly targetCount: number) {}

  get count(): number {
    return this.samples.length;
  }

  get done(): boolean {
    return this.samples.length >= this.targetCount;
  }

  add(point: GatedPoint): boolean {
    if (!this.done) this.samples.push(point);
    return this.done;
  }

  reset(): void {
    this.samples = [];
  }

  /** Averaged point, or null if no samples yet. */
  result(): GatedPoint | null {
    const s = this.samples;
    if (s.length === 0) return null;
    if (s.length === 1) return s[0];

    const origin = { lat: s[0].lat, lon: s[0].lon, h: 0 };
    let e = 0;
    let n = 0;
    for (const p of s) {
      const enu = llhToEnu(origin, { lat: p.lat, lon: p.lon, h: 0 });
      e += enu.e;
      n += enu.n;
    }
    const avg = enuToLlh(origin, { e: e / s.length, n: n / s.length, u: 0 });

    const mean = (f: (p: GatedPoint) => number) =>
      s.reduce((acc, p) => acc + f(p), 0) / s.length;

    const last = s[s.length - 1];
    return {
      ...last,
      lat: avg.lat,
      lon: avg.lon,
      sigmaH: mean(p => p.sigmaH),
      totalAccuracy2d: mean(p => p.totalAccuracy2d),
    };
  }
}
