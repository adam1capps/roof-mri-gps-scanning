/**
 * RTCM3 frame splitter — used for diagnostics (message types seen, data rate)
 * while the raw bytes are forwarded untouched to the RX2.
 *
 * Frame: 0xD3 | 6 reserved bits + 10-bit length | payload | 24-bit CRC24Q.
 */

const CRC24Q_POLY = 0x1864cfb;

const crcTable: number[] = (() => {
  const table = new Array<number>(256);
  for (let i = 0; i < 256; i++) {
    let crc = i << 16;
    for (let j = 0; j < 8; j++) {
      crc <<= 1;
      if (crc & 0x1000000) crc ^= CRC24Q_POLY;
    }
    table[i] = crc & 0xffffff;
  }
  return table;
})();

export function crc24q(data: Uint8Array, length = data.length): number {
  let crc = 0;
  for (let i = 0; i < length; i++) {
    crc = ((crc << 8) & 0xffffff) ^ crcTable[((crc >> 16) ^ data[i]) & 0xff];
  }
  return crc;
}

export interface RtcmFrame {
  /** RTCM message number (first 12 bits of payload), e.g. 1005, 1074. */
  messageType: number;
  payloadLength: number;
  frameLength: number;
}

/** Incremental splitter tolerant of arbitrary chunking and garbage bytes. */
export class RtcmSplitter {
  private buffer = new Uint8Array(0);

  constructor(private readonly onFrame: (frame: RtcmFrame) => void) {}

  feed(chunk: Uint8Array): void {
    const merged = new Uint8Array(this.buffer.length + chunk.length);
    merged.set(this.buffer);
    merged.set(chunk, this.buffer.length);
    this.buffer = merged;
    this.drain();
  }

  private drain(): void {
    let offset = 0;
    const buf = this.buffer;

    while (offset < buf.length) {
      if (buf[offset] !== 0xd3) {
        offset++;
        continue;
      }
      if (offset + 3 > buf.length) break; // need header
      const payloadLength = ((buf[offset + 1] & 0x03) << 8) | buf[offset + 2];
      const frameLength = 3 + payloadLength + 3;
      if (offset + frameLength > buf.length) break; // incomplete frame

      const frame = buf.subarray(offset, offset + frameLength);
      const declaredCrc =
        (frame[frameLength - 3] << 16) |
        (frame[frameLength - 2] << 8) |
        frame[frameLength - 1];

      if (crc24q(frame, frameLength - 3) === declaredCrc) {
        const messageType = payloadLength >= 2 ? (frame[3] << 4) | (frame[4] >> 4) : 0;
        this.onFrame({ messageType, payloadLength, frameLength });
        offset += frameLength;
      } else {
        offset++; // false preamble — resync
      }
    }

    this.buffer = buf.subarray(offset).slice();
    if (this.buffer.length > 4096) {
      // Not RTCM (e.g. an HTML error page) — don't grow forever.
      this.buffer = this.buffer.subarray(this.buffer.length - 1024).slice();
    }
  }

  reset(): void {
    this.buffer = new Uint8Array(0);
  }
}
