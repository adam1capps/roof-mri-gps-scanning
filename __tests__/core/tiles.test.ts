import {
  buildMapStyle,
  createTileSession,
  getViewportInfo,
  maxZoomAt,
  sessionValid,
  tileUrlTemplate,
} from '../../src/core/tiles/googleTiles';

function mockFetch(status: number, body: unknown): typeof fetch {
  return jest.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  })) as unknown as typeof fetch;
}

describe('Google Map Tiles API session', () => {
  it('creates a satellite session with the documented body', async () => {
    const fetchImpl = mockFetch(200, {
      session: 'TOKEN123',
      expiry: String(Math.floor(Date.now() / 1000) + 14 * 86400),
      tileWidth: 256,
      tileHeight: 256,
      imageFormat: 'png',
    });
    const session = await createTileSession('KEY', fetchImpl);
    expect(session.session).toBe('TOKEN123');

    const [url, init] = (fetchImpl as jest.Mock).mock.calls[0];
    expect(url).toBe('https://tile.googleapis.com/v1/createSession?key=KEY');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      mapType: 'satellite',
      language: 'en-US',
      region: 'US',
    });
  });

  it('throws on HTTP errors', async () => {
    await expect(createTileSession('BAD', mockFetch(403, { error: 'denied' }))).rejects.toThrow(
      '403',
    );
  });

  it('validates session expiry with a 1-hour margin', () => {
    const soon = { session: 's', expiry: String(Math.floor(Date.now() / 1000) + 60), tileWidth: 256, tileHeight: 256, imageFormat: 'png' };
    const later = { ...soon, expiry: String(Math.floor(Date.now() / 1000) + 7200) };
    expect(sessionValid(soon)).toBe(false);
    expect(sessionValid(later)).toBe(true);
    expect(sessionValid(null)).toBe(false);
  });

  it('builds the documented tile URL template', () => {
    expect(tileUrlTemplate('S T', 'K/1')).toBe(
      'https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session=S%20T&key=K%2F1',
    );
  });

  it('fetches viewport attribution and max zoom', async () => {
    const fetchImpl = mockFetch(200, {
      copyright: 'Imagery ©2026 Google, Maxar Technologies',
      maxZoomRects: [
        { maxZoom: 22, north: 33, south: 32, east: -96, west: -97 },
        { maxZoom: 12, north: 90, south: -90, east: 180, west: -180 },
      ],
    });
    const info = await getViewportInfo('T', 'K', { north: 33, south: 32, east: -96, west: -97, zoom: 19 }, fetchImpl);
    expect(info.copyright).toContain('Google');
    expect(maxZoomAt(info, 32.7, -96.8)).toBe(22);
    expect(maxZoomAt(info, 0, 0)).toBe(12);

    const [url] = (fetchImpl as jest.Mock).mock.calls[0];
    expect(url).toContain('https://tile.googleapis.com/v1/viewport?session=T&key=K');
    expect(url).toContain('zoom=19');
  });
});

describe('map style', () => {
  it('uses Google raster source when a session exists', () => {
    const style = buildMapStyle({ session: 'S', apiKey: 'K' }) as any;
    expect(style.sources.base.tiles[0]).toContain('tile.googleapis.com');
    expect(style.sources.base.maxzoom).toBe(22);
  });

  it('falls back to OSM with attribution when unconfigured', () => {
    const style = buildMapStyle(null) as any;
    expect(style.sources.base.tiles[0]).toContain('openstreetmap.org');
    expect(style.sources.base.attribution).toContain('OpenStreetMap');
  });
});
