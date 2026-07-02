import { base64Encode } from '../util/base64';

/**
 * NTRIP client (v1 + v2) as a transport-agnostic state machine.
 * The actual TCP socket lives in the device layer (react-native-tcp-socket);
 * this class only builds/parses protocol bytes, so it is fully unit-testable.
 *
 * Flow:
 *   connect → send GET request → parse handshake
 *     - "ICY 200 OK" (v1) or "HTTP/1.x 200 OK" (v2)  → stream RTCM3 to onRtcm
 *     - "SOURCETABLE 200 OK" (v1) or v2 sourcetable  → parse entries
 *   while streaming: send the latest GGA upstream every ggaIntervalS
 *   (required by VRS / nearest-base casters to pick a reference station).
 */

export interface NtripTransport {
  connect(host: string, port: number): Promise<void>;
  write(data: Uint8Array | string): void;
  close(): void;
  onData(cb: (chunk: Uint8Array) => void): void;
  onClose(cb: (error?: string) => void): void;
}

export interface NtripConfig {
  host: string;
  port: number;
  mountpoint: string;
  username?: string;
  password?: string;
  /** Seconds between GGA uploads. 0 disables. Default 10. */
  ggaIntervalS?: number;
  userAgent?: string;
}

export type NtripPhase =
  | 'idle'
  | 'connecting'
  | 'handshake'
  | 'streaming'
  | 'sourcetable'
  | 'error';

export interface NtripStatus {
  phase: NtripPhase;
  message?: string;
  bytesReceived: number;
  /** ms timestamp of last RTCM data. */
  lastDataAt?: number;
  /** ms timestamp of last GGA sent upstream. */
  lastGgaSentAt?: number;
}

export interface SourceTableEntry {
  mountpoint: string;
  identifier: string;
  format: string;
  navSystem: string;
  country: string;
  lat: number;
  lon: number;
  /** Caster expects the client to send NMEA GGA (VRS). */
  nmeaRequired: boolean;
}

export interface NtripCallbacks {
  onRtcm(bytes: Uint8Array): void;
  onStatus(status: NtripStatus): void;
  onSourceTable?(entries: SourceTableEntry[]): void;
}

const decoder = {
  decode(b: Uint8Array): string {
    let s = '';
    for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return s;
  },
};

export class NtripClient {
  private phase: NtripPhase = 'idle';
  private handshakeBuffer = '';
  private bytesReceived = 0;
  private lastDataAt?: number;
  private lastGgaSentAt?: number;
  private latestGga: string | null = null;
  private ggaTimer?: ReturnType<typeof setInterval>;
  private closedByUser = false;

  constructor(
    private readonly transport: NtripTransport,
    private readonly config: NtripConfig,
    private readonly callbacks: NtripCallbacks,
  ) {
    transport.onData(chunk => this.handleData(chunk));
    transport.onClose(error => this.handleClose(error));
  }

  getStatus(): NtripStatus {
    return {
      phase: this.phase,
      bytesReceived: this.bytesReceived,
      lastDataAt: this.lastDataAt,
      lastGgaSentAt: this.lastGgaSentAt,
    };
  }

  async connect(): Promise<void> {
    this.closedByUser = false;
    this.setPhase('connecting');
    try {
      await this.transport.connect(this.config.host, this.config.port);
    } catch (e) {
      this.setPhase('error', `Connection failed: ${String(e)}`);
      throw e;
    }
    this.handshakeBuffer = '';
    this.setPhase('handshake');
    this.transport.write(this.buildRequest());
  }

  disconnect(): void {
    this.closedByUser = true;
    this.stopGgaTimer();
    this.transport.close();
    this.setPhase('idle');
  }

  /** Feed the latest GGA sentence (raw, with $ and checksum, no CRLF). */
  updateGga(ggaSentence: string): void {
    const first = this.latestGga === null;
    this.latestGga = ggaSentence;
    // Casters expect a GGA promptly after connecting; send the first one now.
    if (first && this.phase === 'streaming') this.sendGga();
  }

  buildRequest(): string {
    const { mountpoint, username, password, userAgent } = this.config;
    const mount = mountpoint.startsWith('/') ? mountpoint : `/${mountpoint}`;
    const lines = [
      `GET ${mount} HTTP/1.1`,
      `Host: ${this.config.host}:${this.config.port}`,
      'Ntrip-Version: Ntrip/2.0',
      `User-Agent: NTRIP ${userAgent ?? 'RoofMRI/1.0'}`,
      'Accept: */*',
      'Connection: close',
    ];
    if (username || password) {
      lines.push(`Authorization: Basic ${base64Encode(`${username ?? ''}:${password ?? ''}`)}`);
    }
    return lines.join('\r\n') + '\r\n\r\n';
  }

  private handleData(chunk: Uint8Array): void {
    if (this.phase === 'streaming') {
      this.bytesReceived += chunk.length;
      this.lastDataAt = Date.now();
      this.callbacks.onRtcm(chunk);
      this.emitStatus();
      return;
    }

    if (this.phase !== 'handshake' && this.phase !== 'sourcetable') return;

    this.handshakeBuffer += decoder.decode(chunk);

    if (this.phase === 'handshake') {
      const headerEnd = this.findHeaderEnd(this.handshakeBuffer);
      if (headerEnd < 0) {
        // v1 casters answer "ICY 200 OK\r\n" and immediately stream binary.
        const icy = this.handshakeBuffer.indexOf('ICY 200 OK\r\n');
        if (icy >= 0) this.enterStreaming(this.handshakeBuffer, icy + 'ICY 200 OK\r\n'.length);
        return;
      }

      const header = this.handshakeBuffer.slice(0, headerEnd.valueOf());
      const statusLine = header.split('\r\n')[0] ?? '';

      if (/^(ICY|HTTP\/\d\.\d) 200 OK/.test(statusLine)) {
        if (/SOURCETABLE|gnss\/sourcetable/i.test(header)) {
          this.phase = 'sourcetable';
          this.tryFinishSourceTable();
          return;
        }
        this.enterStreaming(this.handshakeBuffer, headerEnd + 4);
        return;
      }
      if (/^SOURCETABLE 200 OK/.test(statusLine)) {
        this.phase = 'sourcetable';
        this.tryFinishSourceTable();
        return;
      }
      if (/ 401 /.test(statusLine)) {
        this.fail('Unauthorized — check NTRIP username/password');
        return;
      }
      if (/ 404 /.test(statusLine)) {
        this.fail(`Mountpoint "${this.config.mountpoint}" not found`);
        return;
      }
      this.fail(`Caster refused: ${statusLine.trim() || 'no response'}`);
      return;
    }

    this.tryFinishSourceTable();
  }

  private findHeaderEnd(buf: string): number {
    return buf.indexOf('\r\n\r\n');
  }

  private enterStreaming(buffered: string, bodyStart: number): void {
    this.setPhase('streaming');
    this.handshakeBuffer = '';
    this.startGgaTimer();
    if (this.latestGga) this.sendGga();
    // Bytes that arrived glued to the handshake are RTCM payload.
    if (bodyStart < buffered.length) {
      const rest = new Uint8Array(buffered.length - bodyStart);
      for (let i = 0; i < rest.length; i++) rest[i] = buffered.charCodeAt(bodyStart + i) & 0xff;
      this.bytesReceived += rest.length;
      this.lastDataAt = Date.now();
      this.callbacks.onRtcm(rest);
    }
    this.emitStatus();
  }

  private tryFinishSourceTable(): void {
    if (!this.handshakeBuffer.includes('ENDSOURCETABLE')) return;
    const entries = parseSourceTable(this.handshakeBuffer);
    this.callbacks.onSourceTable?.(entries);
    this.setPhase('sourcetable', `${entries.length} mountpoints`);
    this.transport.close();
  }

  private sendGga(): void {
    if (!this.latestGga || this.phase !== 'streaming') return;
    this.transport.write(this.latestGga + '\r\n');
    this.lastGgaSentAt = Date.now();
    this.emitStatus();
  }

  private startGgaTimer(): void {
    const interval = this.config.ggaIntervalS ?? 10;
    if (interval <= 0) return;
    this.stopGgaTimer();
    this.ggaTimer = setInterval(() => this.sendGga(), interval * 1000);
  }

  private stopGgaTimer(): void {
    if (this.ggaTimer) clearInterval(this.ggaTimer);
    this.ggaTimer = undefined;
  }

  private handleClose(error?: string): void {
    this.stopGgaTimer();
    if (this.closedByUser || this.phase === 'sourcetable' || this.phase === 'idle') return;
    this.setPhase('error', error ?? 'Connection closed by caster');
  }

  private fail(message: string): void {
    this.setPhase('error', message);
    this.transport.close();
  }

  private setPhase(phase: NtripPhase, message?: string): void {
    this.phase = phase;
    this.emitStatus(message);
  }

  private emitStatus(message?: string): void {
    this.callbacks.onStatus({ ...this.getStatus(), message });
  }
}

/** Parses NTRIP sourcetable STR lines. */
export function parseSourceTable(raw: string): SourceTableEntry[] {
  const entries: SourceTableEntry[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith('STR;')) continue;
    const f = line.split(';');
    entries.push({
      mountpoint: f[1] ?? '',
      identifier: f[2] ?? '',
      format: f[3] ?? '',
      navSystem: f[6] ?? '',
      country: f[8] ?? '',
      lat: parseFloat(f[9] ?? ''),
      lon: parseFloat(f[10] ?? ''),
      nmeaRequired: f[11] === '1',
    });
  }
  return entries;
}
