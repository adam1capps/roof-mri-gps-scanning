import { GnssEpoch, NmeaSentence } from './types';

/**
 * Groups GGA + GST + ETC sentences that share a UTC time-of-fix into epochs.
 *
 * The RX2 emits ETC at the same rate as GGA (5 Hz) and the spec says to match
 * them by timestamp. An epoch is emitted as soon as GGA/GST/ETC for one
 * timestamp are all present, or — because a sentence can be disabled on the
 * receiver — when a sentence for a *newer* timestamp arrives (flush).
 */
export class EpochAssembler {
  private pending = new Map<string, Partial<GnssEpoch>>();
  private order: string[] = [];

  constructor(
    private readonly onEpoch: (epoch: GnssEpoch) => void,
    private readonly now: () => number = () => Date.now(),
  ) {}

  feed(sentence: NmeaSentence): void {
    if (sentence.kind !== 'GGA' && sentence.kind !== 'GST' && sentence.kind !== 'ETC') {
      return;
    }
    const time = sentence.time;
    if (!time) return;

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
    if (entry?.gga) {
      this.onEpoch(entry as GnssEpoch);
    }
    // Entries without GGA are dropped — position is mandatory.
  }

  reset(): void {
    this.pending.clear();
    this.order = [];
  }
}
