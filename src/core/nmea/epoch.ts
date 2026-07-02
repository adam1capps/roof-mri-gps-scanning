import { GnssEpoch, GstData, NmeaSentence } from './types';

/**
 * Groups GGA + GST + ETC sentences that share a UTC time-of-fix into epochs.
 *
 * Per the RX2 NMEA specification, GGA and ETC stream at 5 Hz but GST only at
 * 1 Hz. An epoch is emitted immediately when all three sentences for one
 * timestamp are present; otherwise it is flushed when a sentence for a newer
 * timestamp arrives (≤200 ms latency at 5 Hz). Epochs flushed without their
 * own GST get the most recent GST carried forward (default max age 2 s) so
 * the accuracy gate can run on every fix, not just the 1 Hz ones.
 */

export interface EpochAssemblerOptions {
  /** Max age (seconds of GPS time) for carrying the last GST forward. */
  gstMaxAgeS?: number;
  now?: () => number;
}

/** "hhmmss.ss" → seconds of day, or null when malformed/empty. */
export function gpsTimeToSeconds(t: string): number | null {
  if (!/^\d{6}(\.\d+)?$/.test(t)) return null;
  return (
    parseInt(t.slice(0, 2), 10) * 3600 +
    parseInt(t.slice(2, 4), 10) * 60 +
    parseFloat(t.slice(4))
  );
}

/** Absolute difference of two times-of-day, tolerant of the midnight wrap. */
export function gpsTimeDiffS(a: string, b: string): number {
  const sa = gpsTimeToSeconds(a);
  const sb = gpsTimeToSeconds(b);
  if (sa === null || sb === null) return Infinity;
  const d = Math.abs(sa - sb);
  return Math.min(d, 86400 - d);
}

export class EpochAssembler {
  private pending = new Map<string, Partial<GnssEpoch>>();
  private order: string[] = [];
  private lastGst: GstData | null = null;
  private readonly gstMaxAgeS: number;
  private readonly now: () => number;

  constructor(
    private readonly onEpoch: (epoch: GnssEpoch) => void,
    options: EpochAssemblerOptions = {},
  ) {
    this.gstMaxAgeS = options.gstMaxAgeS ?? 2;
    this.now = options.now ?? (() => Date.now());
  }

  feed(sentence: NmeaSentence): void {
    if (sentence.kind !== 'GGA' && sentence.kind !== 'GST' && sentence.kind !== 'ETC') {
      return;
    }
    const time = sentence.time;
    if (!time) return;

    if (sentence.kind === 'GST') this.lastGst = sentence;

    let entry = this.pending.get(time);
    if (!entry) {
      // A new timestamp appeared — flush every older pending epoch first.
      this.flushOlderThan(time);
      entry = { time, receivedAt: this.now() };
      this.pending.set(time, entry);
      this.order.push(time);
    }

    if (sentence.kind === 'GGA') entry.gga = sentence;
    else if (sentence.kind === 'GST') entry.gst = sentence;
    else entry.etc = sentence;

    if (entry.gga && entry.gst && entry.etc) {
      this.emit(time);
    }
  }

  /** Flushes any complete-enough (has GGA) epochs older than `newTime`. */
  private flushOlderThan(newTime: string): void {
    for (const t of [...this.order]) {
      if (t !== newTime) this.emit(t);
    }
  }

  private emit(time: string): void {
    const entry = this.pending.get(time);
    this.pending.delete(time);
    this.order = this.order.filter(t => t !== time);
    if (!entry?.gga) return; // position is mandatory — drop orphans

    // GST streams at 1 Hz: reuse the latest one for the 5 Hz epochs between.
    if (!entry.gst && this.lastGst && gpsTimeDiffS(time, this.lastGst.time) <= this.gstMaxAgeS) {
      entry.gst = this.lastGst;
      entry.gstCarried = true;
    }

    this.onEpoch(entry as GnssEpoch);
  }

  reset(): void {
    this.pending.clear();
    this.order = [];
    this.lastGst = null;
  }
}
