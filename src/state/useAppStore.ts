import { create } from 'zustand';
import {
  createProject,
  FeatureKind,
  RoofProject,
} from '../core/capture/model';
import {
  addVertex,
  closeFeature,
  deleteFeature,
  gatedPointToVertex,
  projectStats,
  startFeature,
  undoVertex,
} from '../core/capture/session';
import { DEFAULT_GATE, GatedPoint, GateResult, TiltMode } from '../core/gnss/gate';
import { GnssEpoch } from '../core/nmea/types';
import { NtripStatus, SourceTableEntry } from '../core/ntrip/client';
import type { BtConnectionState } from '../device/EmlidBluetooth';

export interface NtripSettings {
  host: string;
  port: number;
  mountpoint: string;
  username: string;
  password: string;
  ggaIntervalS: number;
}

export interface Settings {
  maxHorizontalSigmaM: number;
  tiltMode: TiltMode;
  poleHeightM: number;
  rejectFastMotion: boolean;
  /** Epochs averaged per captured point (1 = instant). */
  averagingEpochs: number;
  snapRadiusM: number;
  units: 'ft' | 'm';
  googleApiKey: string;
  ntrip: NtripSettings;
}

export const DEFAULT_SETTINGS: Settings = {
  maxHorizontalSigmaM: DEFAULT_GATE.maxHorizontalSigmaM,
  tiltMode: 'auto',
  poleHeightM: 1.8,
  rejectFastMotion: true,
  averagingEpochs: 5,
  snapRadiusM: 0.25,
  units: 'ft',
  googleApiKey: '',
  ntrip: {
    host: '',
    port: 2101,
    mountpoint: '',
    username: '',
    password: '',
    ggaIntervalS: 10,
  },
};

export interface AveragingProgress {
  featureId: string;
  collected: number;
  target: number;
}

export interface AppState {
  hydrated: boolean;

  // Receiver / corrections status (written by GnssController)
  btState: BtConnectionState;
  btDeviceName?: string;
  lastEpoch: GnssEpoch | null;
  lastGate: GateResult | null;
  lastPoint: GatedPoint | null;
  ntripStatus: NtripStatus | null;
  sourceTable: SourceTableEntry[] | null;
  rtcmMessageCounts: Record<number, number>;

  // Map
  tileSessionToken: string | null;
  mapAttribution: string;

  // Projects
  projects: RoofProject[];
  activeProjectId: string | null;
  activeFeatureId: string | null;
  activeKind: FeatureKind;
  averaging: AveragingProgress | null;

  settings: Settings;

  // actions
  setHydrated(projects: RoofProject[], settings: Settings): void;
  setBtState(state: BtConnectionState, deviceName?: string): void;
  setEpoch(epoch: GnssEpoch, gate: GateResult): void;
  setNtripStatus(status: NtripStatus): void;
  setSourceTable(entries: SourceTableEntry[] | null): void;
  countRtcm(messageType: number): void;
  setTileSession(token: string | null): void;
  setMapAttribution(text: string): void;

  updateSettings(patch: Partial<Settings>): void;
  updateNtripSettings(patch: Partial<NtripSettings>): void;

  createNewProject(name: string): RoofProject;
  removeProject(id: string): void;
  setActiveProject(id: string | null): void;
  setActiveKind(kind: FeatureKind): void;
  beginFeature(kind: FeatureKind): void;
  setActiveFeature(id: string | null): void;
  setAveraging(progress: AveragingProgress | null): void;
  commitVertex(point: GatedPoint, epochs: number): { closedRing: boolean };
  undoActiveVertex(): void;
  closeActiveRing(): void;
  removeFeature(featureId: string): void;
}

function replaceProject(projects: RoofProject[], updated: RoofProject): RoofProject[] {
  return projects.map(p => (p.id === updated.id ? updated : p));
}

export const useAppStore = create<AppState>((set, get) => ({
  hydrated: false,
  btState: 'disconnected',
  lastEpoch: null,
  lastGate: null,
  lastPoint: null,
  ntripStatus: null,
  sourceTable: null,
  rtcmMessageCounts: {},
  tileSessionToken: null,
  mapAttribution: '',
  projects: [],
  activeProjectId: null,
  activeFeatureId: null,
  activeKind: 'perimeter',
  averaging: null,
  settings: DEFAULT_SETTINGS,

  setHydrated: (projects, settings) =>
    set({ hydrated: true, projects, settings }),

  setBtState: (btState, btDeviceName) => set({ btState, btDeviceName }),

  setEpoch: (epoch, gate) =>
    set({ lastEpoch: epoch, lastGate: gate, lastPoint: gate.point ?? get().lastPoint }),

  setNtripStatus: ntripStatus => set({ ntripStatus }),
  setSourceTable: sourceTable => set({ sourceTable }),

  countRtcm: messageType =>
    set(s => ({
      rtcmMessageCounts: {
        ...s.rtcmMessageCounts,
        [messageType]: (s.rtcmMessageCounts[messageType] ?? 0) + 1,
      },
    })),

  setTileSession: tileSessionToken => set({ tileSessionToken }),
  setMapAttribution: mapAttribution => set({ mapAttribution }),

  updateSettings: patch => set(s => ({ settings: { ...s.settings, ...patch } })),
  updateNtripSettings: patch =>
    set(s => ({ settings: { ...s.settings, ntrip: { ...s.settings.ntrip, ...patch } } })),

  createNewProject: name => {
    const project = createProject(name);
    set(s => ({
      projects: [project, ...s.projects],
      activeProjectId: project.id,
      activeFeatureId: null,
    }));
    return project;
  },

  removeProject: id =>
    set(s => ({
      projects: s.projects.filter(p => p.id !== id),
      activeProjectId: s.activeProjectId === id ? null : s.activeProjectId,
      activeFeatureId: s.activeProjectId === id ? null : s.activeFeatureId,
    })),

  setActiveProject: id => set({ activeProjectId: id, activeFeatureId: null, averaging: null }),
  setActiveKind: kind => set({ activeKind: kind }),

  beginFeature: kind => {
    const s = get();
    const project = s.projects.find(p => p.id === s.activeProjectId);
    if (!project) return;
    const { project: updated, feature } = startFeature(project, kind);
    set({
      projects: replaceProject(s.projects, updated),
      activeFeatureId: feature.id,
      activeKind: kind,
    });
  },

  setActiveFeature: id => set({ activeFeatureId: id }),
  setAveraging: averaging => set({ averaging }),

  commitVertex: (point, epochs) => {
    const s = get();
    const project = s.projects.find(p => p.id === s.activeProjectId);
    if (!project || !s.activeFeatureId) return { closedRing: false };
    const vertex = gatedPointToVertex(point, epochs);
    const { project: updated, closedRing } = addVertex(
      project,
      s.activeFeatureId,
      vertex,
      s.settings.snapRadiusM,
    );
    set({
      projects: replaceProject(s.projects, updated),
      averaging: null,
      activeFeatureId: closedRing ? null : s.activeFeatureId,
    });
    return { closedRing };
  },

  undoActiveVertex: () => {
    const s = get();
    const project = s.projects.find(p => p.id === s.activeProjectId);
    if (!project || !s.activeFeatureId) return;
    set({ projects: replaceProject(s.projects, undoVertex(project, s.activeFeatureId)) });
  },

  closeActiveRing: () => {
    const s = get();
    const project = s.projects.find(p => p.id === s.activeProjectId);
    if (!project || !s.activeFeatureId) return;
    set({
      projects: replaceProject(s.projects, closeFeature(project, s.activeFeatureId)),
      activeFeatureId: null,
    });
  },

  removeFeature: featureId => {
    const s = get();
    const project = s.projects.find(p => p.id === s.activeProjectId);
    if (!project) return;
    set({
      projects: replaceProject(s.projects, deleteFeature(project, featureId)),
      activeFeatureId: s.activeFeatureId === featureId ? null : s.activeFeatureId,
    });
  },
}));

export function activeProject(state: AppState): RoofProject | null {
  return state.projects.find(p => p.id === state.activeProjectId) ?? null;
}

export function activeProjectStats(state: AppState) {
  const p = activeProject(state);
  return p ? projectStats(p) : null;
}
