import RNFS from 'react-native-fs';
import { RoofProject } from '../core/capture/model';
import { DEFAULT_SETTINGS, Settings, useAppStore } from '../state/useAppStore';

/**
 * Project + settings persistence as a single JSON document in the app's
 * private documents directory. Captured survey data must survive app
 * restarts — losing a walked roof is not acceptable.
 *
 * NOTE: only vector data (points the RX2 produced) and settings are stored.
 * Map tiles are never persisted (Google Map Tiles API policy).
 */

const FILE = () => `${RNFS.DocumentDirectoryPath}/roofmri-state.json`;

interface PersistedState {
  version: 1;
  projects: RoofProject[];
  settings: Settings;
}

export async function loadPersistedState(): Promise<{ projects: RoofProject[]; settings: Settings }> {
  try {
    const raw = await RNFS.readFile(FILE(), 'utf8');
    const parsed = JSON.parse(raw) as PersistedState;
    return {
      projects: parsed.projects ?? [],
      settings: { ...DEFAULT_SETTINGS, ...parsed.settings, ntrip: { ...DEFAULT_SETTINGS.ntrip, ...parsed.settings?.ntrip } },
    };
  } catch {
    return { projects: [], settings: DEFAULT_SETTINGS };
  }
}

export async function savePersistedState(projects: RoofProject[], settings: Settings): Promise<void> {
  const doc: PersistedState = { version: 1, projects, settings };
  await RNFS.writeFile(FILE(), JSON.stringify(doc), 'utf8');
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** Hydrates the store and installs a debounced auto-save subscription. */
export async function initPersistence(): Promise<void> {
  const { projects, settings } = await loadPersistedState();
  useAppStore.getState().setHydrated(projects, settings);

  useAppStore.subscribe((state, prev) => {
    if (!state.hydrated) return;
    if (state.projects === prev.projects && state.settings === prev.settings) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const s = useAppStore.getState();
      savePersistedState(s.projects, s.settings).catch(() => {
        // Retried on the next state change; data also still lives in memory.
      });
    }, 800);
  });
}
