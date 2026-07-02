const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Base64 for ASCII strings (NTRIP basic auth) — RN has no btoa by default. */
export function base64Encode(input: string): string {
  let out = '';
  for (let i = 0; i < input.length; i += 3) {
    const c1 = input.charCodeAt(i) & 0xff;
    const c2 = i + 1 < input.length ? input.charCodeAt(i + 1) & 0xff : NaN;
    const c3 = i + 2 < input.length ? input.charCodeAt(i + 2) & 0xff : NaN;

    out += ALPHABET[c1 >> 2];
    out += ALPHABET[((c1 & 3) << 4) | (Number.isNaN(c2) ? 0 : c2 >> 4)];
    out += Number.isNaN(c2) ? '=' : ALPHABET[((c2 & 15) << 2) | (Number.isNaN(c3) ? 0 : c3 >> 6)];
    out += Number.isNaN(c3) ? '=' : ALPHABET[c3 & 63];
  }
  return out;
}

/** Uint8Array → base64 (for writing binary RTCM over the Bluetooth bridge). */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return base64Encode(bin);
}
