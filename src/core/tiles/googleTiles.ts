/**
 * Google Maps Platform — Map Tiles API (2D satellite tiles).
 *
 * Policy constraints implemented by design (Google Map Tiles API terms):
 *  - NO offline caching: tiles are only ever fetched live by the map renderer;
 *    the app also disables MapLibre's persistent ambient cache at startup.
 *  - Visualization ONLY: no pixel analysis / feature extraction is performed —
 *    every measurement comes from the RX2, never from imagery.
 *  - Attribution: the copyright string from the viewport endpoint plus the
 *    Google logo must stay visible over the map (AttributionBadge component).
 */

const TILE_API = 'https://tile.googleapis.com/v1';

export interface TileSession {
  session: string;
  /** Seconds-since-epoch string per API. */
  expiry: string;
  tileWidth: number;
  tileHeight: number;
  imageFormat: string;
}

export interface ViewportInfo {
  /** e.g. "Imagery ©2026 Google, Maxar Technologies" — must be displayed on-map. */
  copyright: string;
  maxZoomRects: Array<{
    maxZoom: number;
    north: number;
    south: number;
    east: number;
    west: number;
  }>;
}

type FetchLike = typeof fetch;

export async function createTileSession(
  apiKey: string,
  fetchImpl: FetchLike = fetch,
): Promise<TileSession> {
  const res = await fetchImpl(`${TILE_API}/createSession?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mapType: 'satellite',
      language: 'en-US',
      region: 'US',
    }),
  });
  if (!res.ok) {
    throw new Error(`createSession failed: HTTP ${res.status} ${await safeText(res)}`);
  }
  const json = (await res.json()) as TileSession;
  if (!json.session) throw new Error('createSession: no session token in response');
  return json;
}

/** Session valid if it exists and expires more than an hour from now. */
export function sessionValid(s: TileSession | null, nowMs = Date.now()): s is TileSession {
  if (!s) return false;
  const expiryMs = parseInt(s.expiry, 10) * 1000;
  return Number.isFinite(expiryMs) && expiryMs - nowMs > 3600_000;
}

/** MapLibre-compatible {z}/{x}/{y} URL template. */
export function tileUrlTemplate(session: string, apiKey: string): string {
  return `${TILE_API}/2dtiles/{z}/{x}/{y}?session=${encodeURIComponent(session)}&key=${encodeURIComponent(apiKey)}`;
}

/**
 * Viewport info: attribution string (required!) and max available zoom for
 * the current area — satellite max is often 19–21, up to 22.
 */
export async function getViewportInfo(
  session: string,
  apiKey: string,
  bounds: { north: number; south: number; east: number; west: number; zoom: number },
  fetchImpl: FetchLike = fetch,
): Promise<ViewportInfo> {
  const q =
    `session=${encodeURIComponent(session)}&key=${encodeURIComponent(apiKey)}` +
    `&zoom=${bounds.zoom}&north=${bounds.north}&south=${bounds.south}` +
    `&east=${bounds.east}&west=${bounds.west}`;
  const res = await fetchImpl(`${TILE_API}/viewport?${q}`);
  if (!res.ok) {
    throw new Error(`viewport failed: HTTP ${res.status} ${await safeText(res)}`);
  }
  const json = (await res.json()) as { copyright?: string; maxZoomRects?: ViewportInfo['maxZoomRects'] };
  return {
    copyright: json.copyright ?? 'Map data ©Google',
    maxZoomRects: json.maxZoomRects ?? [],
  };
}

/** Highest zoom available at a location according to viewport info. */
export function maxZoomAt(info: ViewportInfo, lat: number, lon: number): number {
  let best = 0;
  for (const r of info.maxZoomRects) {
    if (lat <= r.north && lat >= r.south && lon <= r.east && lon >= r.west) {
      best = Math.max(best, r.maxZoom);
    }
  }
  return best || 19;
}

/**
 * MapLibre GL style with the Google satellite raster as the only base layer.
 * Falls back to OpenStreetMap raster when no Google key is configured
 * (useful before the API key is set up; attribution switches accordingly).
 */
export function buildMapStyle(google: { session: string; apiKey: string } | null): object {
  const source = google
    ? {
        type: 'raster',
        tiles: [tileUrlTemplate(google.session, google.apiKey)],
        tileSize: 256,
        maxzoom: 22,
        attribution: 'Google',
      }
    : {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        maxzoom: 19,
        attribution: '© OpenStreetMap contributors',
      };

  return {
    version: 8,
    name: google ? 'google-satellite' : 'osm-fallback',
    sources: { base: source },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#0b0f14' } },
      { id: 'base', type: 'raster', source: 'base' },
    ],
  };
}

async function safeText(res: { text(): Promise<string> }): Promise<string> {
  try {
    return (await res.text()).slice(0, 200);
  } catch {
    return '';
  }
}
