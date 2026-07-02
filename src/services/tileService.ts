import {
  createTileSession,
  getViewportInfo,
  sessionValid,
  TileSession,
} from '../core/tiles/googleTiles';
import { useAppStore } from '../state/useAppStore';

/**
 * Manages the Google Map Tiles API session token and on-map attribution.
 * Tokens are held in memory only — nothing tile-related is persisted.
 */

let session: TileSession | null = null;
let pending: Promise<TileSession> | null = null;

export async function ensureTileSession(): Promise<string | null> {
  const { settings, setTileSession } = useAppStore.getState();
  const apiKey = settings.googleApiKey.trim();
  if (!apiKey) {
    setTileSession(null);
    return null;
  }
  if (sessionValid(session)) return session.session;

  if (!pending) {
    pending = createTileSession(apiKey).finally(() => {
      pending = null;
    });
  }
  try {
    session = await pending;
    setTileSession(session.session);
    return session.session;
  } catch {
    setTileSession(null);
    return null;
  }
}

/** Refresh the attribution string for the current viewport (policy: display it). */
export async function refreshAttribution(bounds: {
  north: number;
  south: number;
  east: number;
  west: number;
  zoom: number;
}): Promise<void> {
  const { settings, setMapAttribution } = useAppStore.getState();
  const apiKey = settings.googleApiKey.trim();
  if (!apiKey || !sessionValid(session)) return;
  try {
    const info = await getViewportInfo(session.session, apiKey, bounds);
    setMapAttribution(info.copyright);
  } catch {
    // keep the previous attribution string
  }
}

export function clearTileSession(): void {
  session = null;
  useAppStore.getState().setTileSession(null);
}
