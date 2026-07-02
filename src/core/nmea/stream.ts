import { parseNmeaSentence } from './parse';
import { NmeaSentence } from './types';

/**
 * Reassembles NMEA sentences from an arbitrary-chunked byte/text stream
 * (Bluetooth SPP delivers data in unpredictable chunk sizes).
 *
 * Tolerates garbage between sentences: anything before a '$' is dropped.
 */
export class NmeaStreamParser {
  private buffer = '';
  private readonly maxBuffer = 16 * 1024;

  constructor(
    private readonly onSentence: (sentence: NmeaSentence, rawLine: string) => void,
    private readonly onRawLine?: (line: string) => void,
  ) {}

  feed(chunk: string): void {
    this.buffer += chunk;
    if (this.buffer.length > this.maxBuffer) {
      // Runaway garbage (e.g. binary data on the line) — keep only the tail.
      this.buffer = this.buffer.slice(-1024);
    }

    for (;;) {
      const nl = this.buffer.indexOf('\n');
      if (nl < 0) return;
      const line = this.buffer.slice(0, nl).replace(/\r$/, '');
      this.buffer = this.buffer.slice(nl + 1);
      this.processLine(line);
    }
  }

  private processLine(line: string): void {
    const dollar = line.indexOf('$');
    if (dollar < 0) return;
    const candidate = line.slice(dollar);
    this.onRawLine?.(candidate);
    const sentence = parseNmeaSentence(candidate);
    if (sentence) this.onSentence(sentence, candidate);
  }

  reset(): void {
    this.buffer = '';
  }
}
