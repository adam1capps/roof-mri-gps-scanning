/** NMEA 0183 checksum: XOR of all characters between '$' and '*'. */
export function nmeaChecksum(body: string): number {
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    sum ^= body.charCodeAt(i);
  }
  return sum;
}

export function checksumHex(body: string): string {
  return nmeaChecksum(body).toString(16).toUpperCase().padStart(2, '0');
}

/**
 * Validates a full sentence like "$GNGGA,...*4C".
 * Returns the payload (between $ and *) when the checksum matches, else null.
 * Sentences without a checksum are rejected — the RX2 always emits one.
 */
export function validateSentence(line: string): string | null {
  if (!line.startsWith('$')) return null;
  const star = line.lastIndexOf('*');
  if (star < 0 || star + 3 > line.length) return null;
  const body = line.slice(1, star);
  const declared = parseInt(line.slice(star + 1, star + 3), 16);
  if (Number.isNaN(declared)) return null;
  return nmeaChecksum(body) === declared ? body : null;
}

/** Builds a valid sentence from a payload (no leading $, no checksum). */
export function buildSentence(body: string): string {
  return `$${body}*${checksumHex(body)}`;
}
