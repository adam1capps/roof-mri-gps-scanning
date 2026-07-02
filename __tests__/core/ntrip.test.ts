import {
  NtripClient,
  NtripStatus,
  NtripTransport,
  parseSourceTable,
  SourceTableEntry,
} from '../../src/core/ntrip/client';
import { crc24q, RtcmFrame, RtcmSplitter } from '../../src/core/ntrip/rtcm';
import { base64Encode } from '../../src/core/util/base64';

class FakeTransport implements NtripTransport {
  written: Array<Uint8Array | string> = [];
  closed = false;
  private dataCb: ((chunk: Uint8Array) => void) | null = null;
  private closeCb: ((error?: string) => void) | null = null;

  async connect(): Promise<void> {}
  write(data: Uint8Array | string): void {
    this.written.push(data);
  }
  close(): void {
    this.closed = true;
    this.closeCb?.();
  }
  onData(cb: (chunk: Uint8Array) => void): void {
    this.dataCb = cb;
  }
  onClose(cb: (error?: string) => void): void {
    this.closeCb = cb;
  }

  push(text: string): void {
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff;
    this.dataCb?.(bytes);
  }
  pushBytes(bytes: Uint8Array): void {
    this.dataCb?.(bytes);
  }
}

function makeClient(overrides: Partial<Parameters<typeof harness>[0]> = {}) {
  return harness({ mountpoint: 'MOUNT1', username: 'user', password: 'pass', ...overrides });
}

function harness(cfg: {
  mountpoint: string;
  username?: string;
  password?: string;
  ggaIntervalS?: number;
}) {
  const transport = new FakeTransport();
  const rtcm: Uint8Array[] = [];
  const statuses: NtripStatus[] = [];
  let sourceTable: SourceTableEntry[] | null = null;

  const client = new NtripClient(
    transport,
    { host: 'caster.example.com', port: 2101, ggaIntervalS: 0, ...cfg },
    {
      onRtcm: b => rtcm.push(b),
      onStatus: s => statuses.push(s),
      onSourceTable: e => {
        sourceTable = e;
      },
    },
  );
  return { transport, client, rtcm, statuses, sourceTable: () => sourceTable };
}

describe('base64', () => {
  it('encodes credentials RFC 4648 style', () => {
    expect(base64Encode('user:pass')).toBe('dXNlcjpwYXNz');
    expect(base64Encode('a')).toBe('YQ==');
    expect(base64Encode('ab')).toBe('YWI=');
  });
});

describe('NtripClient', () => {
  it('sends a v2 GET request with basic auth', async () => {
    const { transport, client } = makeClient();
    await client.connect();
    const req = transport.written[0] as string;
    expect(req).toContain('GET /MOUNT1 HTTP/1.1');
    expect(req).toContain('Ntrip-Version: Ntrip/2.0');
    expect(req).toContain(`Authorization: Basic ${base64Encode('user:pass')}`);
    expect(req.endsWith('\r\n\r\n')).toBe(true);
  });

  it('enters streaming on ICY 200 OK and forwards RTCM (v1 caster)', async () => {
    const { transport, client, rtcm } = makeClient();
    await client.connect();
    transport.push('ICY 200 OK\r\n');
    transport.push('\xd3\x00\x01');
    expect(client.getStatus().phase).toBe('streaming');
    expect(rtcm).toHaveLength(1);
    expect(rtcm[0][0]).toBe(0xd3);
  });

  it('handles HTTP/1.1 200 with RTCM glued to the header (v2 caster)', async () => {
    const { transport, client, rtcm } = makeClient();
    await client.connect();
    transport.push(
      'HTTP/1.1 200 OK\r\nContent-Type: gnss/data\r\n\r\n\xd3\x00\x02',
    );
    expect(client.getStatus().phase).toBe('streaming');
    expect(rtcm).toHaveLength(1);
    expect(rtcm[0].length).toBe(3);
  });

  it('sends the first GGA immediately once streaming', async () => {
    const { transport, client } = makeClient();
    await client.connect();
    transport.push('ICY 200 OK\r\n');
    const gga = '$GNGGA,120000.00,3245.0,N,09647.0,W,4,20,0.7,150,M,-26,M,1.0,0000*7F';
    client.updateGga(gga);
    const sent = transport.written.find(w => typeof w === 'string' && w.startsWith('$GNGGA'));
    expect(sent).toBe(gga + '\r\n');
  });

  it('reports auth failures clearly', async () => {
    const { transport, client, statuses } = makeClient();
    await client.connect();
    transport.push('HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Basic\r\n\r\n');
    expect(client.getStatus().phase).toBe('error');
    expect(statuses.some(s => s.message?.includes('username/password'))).toBe(true);
  });

  it('parses a sourcetable response', async () => {
    const h = makeClient({ mountpoint: '' });
    await h.client.connect();
    h.transport.push(
      'SOURCETABLE 200 OK\r\n\r\n' +
        'STR;MOUNT1;Dallas;RTCM 3.2;1005(1),1074(1);2;GPS+GLO;SNIP;USA;32.78;-96.80;1;0;sNTRIP;none;B;N;0;\r\n' +
        'STR;MOUNT2;FortWorth;RTCM 3.2;;2;GPS;SNIP;USA;32.75;-97.33;0;0;sNTRIP;none;B;N;0;\r\n' +
        'ENDSOURCETABLE\r\n',
    );
    const entries = h.sourceTable()!;
    expect(entries).toHaveLength(2);
    expect(entries[0].mountpoint).toBe('MOUNT1');
    expect(entries[0].nmeaRequired).toBe(true);
    expect(entries[1].nmeaRequired).toBe(false);
    expect(entries[1].lat).toBeCloseTo(32.75);
  });
});

describe('parseSourceTable', () => {
  it('ignores CAS/NET lines', () => {
    const entries = parseSourceTable(
      'CAS;caster;2101;X;Y;0;USA;0;0;\r\nNET;A;B;\r\nSTR;M;I;RTCM 3;;2;GPS;N;USA;1;2;0;0;s;n;B;N;0;\r\nENDSOURCETABLE',
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].mountpoint).toBe('M');
  });
});

describe('RTCM3 splitter', () => {
  function buildFrame(messageType: number, payloadLength = 8): Uint8Array {
    const frame = new Uint8Array(3 + payloadLength + 3);
    frame[0] = 0xd3;
    frame[1] = (payloadLength >> 8) & 0x03;
    frame[2] = payloadLength & 0xff;
    frame[3] = (messageType >> 4) & 0xff;
    frame[4] = (messageType & 0x0f) << 4;
    const crc = crc24q(frame, 3 + payloadLength);
    frame[3 + payloadLength] = (crc >> 16) & 0xff;
    frame[3 + payloadLength + 1] = (crc >> 8) & 0xff;
    frame[3 + payloadLength + 2] = crc & 0xff;
    return frame;
  }

  it('crc24q matches the CRC-24/LTE-A check value', () => {
    const data = new Uint8Array([...'123456789'].map(c => c.charCodeAt(0)));
    expect(crc24q(data)).toBe(0xcde703);
  });

  it('splits frames across chunk boundaries and reads message types', () => {
    const frames: RtcmFrame[] = [];
    const splitter = new RtcmSplitter(f => frames.push(f));
    const f1005 = buildFrame(1005);
    const f1074 = buildFrame(1074, 20);
    const all = new Uint8Array([...f1005, ...f1074]);

    // Feed in 5-byte chunks.
    for (let i = 0; i < all.length; i += 5) {
      splitter.feed(all.subarray(i, Math.min(i + 5, all.length)));
    }
    expect(frames.map(f => f.messageType)).toEqual([1005, 1074]);
  });

  it('resyncs after garbage and corrupted CRC', () => {
    const frames: RtcmFrame[] = [];
    const splitter = new RtcmSplitter(f => frames.push(f));
    const good = buildFrame(1230);
    const corrupted = buildFrame(1005);
    corrupted[corrupted.length - 1] ^= 0xff;

    splitter.feed(new Uint8Array([0x00, 0x42])); // leading garbage
    splitter.feed(corrupted);
    splitter.feed(good);
    expect(frames.map(f => f.messageType)).toEqual([1230]);
  });

  it('recovers from a false preamble with a bogus large length', () => {
    // 0xd3 followed by bytes implying a 467-byte payload: the splitter must
    // wait for the full candidate, fail its CRC, then resync to real frames.
    const frames: RtcmFrame[] = [];
    const splitter = new RtcmSplitter(f => frames.push(f));
    splitter.feed(new Uint8Array([0xd3, 0x01, 0xd3]));
    splitter.feed(new Uint8Array(500)); // zero filler completes the candidate
    const good = buildFrame(1074, 12);
    splitter.feed(good);
    expect(frames.map(f => f.messageType)).toEqual([1074]);
  });
});
