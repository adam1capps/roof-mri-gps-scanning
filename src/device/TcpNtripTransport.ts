import TcpSocket from 'react-native-tcp-socket';
import type { NtripTransport } from '../core/ntrip/client';

type Socket = ReturnType<typeof TcpSocket.createConnection>;

/** react-native-tcp-socket implementation of the NTRIP transport. */
export class TcpNtripTransport implements NtripTransport {
  private socket: Socket | null = null;
  private dataCb: ((chunk: Uint8Array) => void) | null = null;
  private closeCb: ((error?: string) => void) | null = null;

  connect(host: string, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const socket = TcpSocket.createConnection(
        { host, port, tls: false },
        () => {
          settled = true;
          resolve();
        },
      );
      this.socket = socket;

      socket.on('data', data => {
        if (!this.dataCb) return;
        if (typeof data === 'string') {
          const bytes = new Uint8Array(data.length);
          for (let i = 0; i < data.length; i++) bytes[i] = data.charCodeAt(i) & 0xff;
          this.dataCb(bytes);
        } else {
          this.dataCb(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
        }
      });
      socket.on('error', error => {
        if (!settled) {
          settled = true;
          reject(error);
        }
        this.closeCb?.(String(error));
      });
      socket.on('close', () => {
        this.closeCb?.();
      });
    });
  }

  write(data: Uint8Array | string): void {
    if (!this.socket) return;
    if (typeof data === 'string') {
      this.socket.write(data);
    } else {
      // Latin-1 string keeps bytes intact without needing a Buffer polyfill.
      let s = '';
      for (let i = 0; i < data.length; i++) s += String.fromCharCode(data[i]);
      this.socket.write(s, 'latin1' as never);
    }
  }

  close(): void {
    this.socket?.destroy();
    this.socket = null;
  }

  onData(cb: (chunk: Uint8Array) => void): void {
    this.dataCb = cb;
  }

  onClose(cb: (error?: string) => void): void {
    this.closeCb = cb;
  }
}
