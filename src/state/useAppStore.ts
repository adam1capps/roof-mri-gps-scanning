import { create } from 'zustand';
import {
  createProject,
  FeatureKind,
  RoofProject,
} from '../core/capture/model';
import {
  addReading as addReadingToProject,
  finishScan,
  MoistureReading,
  PhotoAttachment,
  ReadingMode,
  undoReading,
} from '../core/capture/moisture';
import { DEFAULT_COMMAND_WORDS } from '../core/capture/voice';
import { DEFAULT_CELL_SIZE_M, GridDefinition, gridFromPolygon, gridFromTwoPoints } from '../core/geo/grid';
import { LatLon } from '../core/geo/wgs84';
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
  /** Moisture scan grid cell size, meters (default 10 ft). */
  cellSizeM: number;
  /** Default reading mode: pin the exact spot or attribute the whole cell. */
  readingMode: ReadingMode;
  /** Words that trigger a voice reading, e.g. "mark seven". */
  voiceCommandWords: string[];
  /** POST target for the report request JSON (Report Creation Team intake). */
  reportWebhookUrl: string;
  /** Email shown in the share sheet fallback for report requests. */
  reportEmail: string;
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
  cellSizeM: DEFAULT_CELL_SIZE_M,
  readingMode: 'precise',
  voiceCommandWords: DEFAULT_COMMAND_WORDS,
  reportWebhookUrl: '',
  reportEmail: 'reports@re-dry.com',
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

  // Moisture scan
  scanMode: boolean;
  voiceActive: boolean;
  lastVoiceHeard: string | null;
  lastReadingFlash: MoistureReading | null;
  gridCalibrationOrigin: LatLon | null;

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

  // Moisture scan actions
  setScanMode(on: boolean): void;
  setVoiceActive(on: boolean): void;
  setLastVoiceHeard(text: string | null): void;
  applyReading(reading: MoistureReading): void;
  undoLastReading(): void;
  setGrid(grid: GridDefinition | null): void;
  instantGridFromSection(): boolean;
  setGridCalibrationOrigin(p: LatLon | null): void;
  finishGridCalibration(alongRow: LatLon): boolean;
  finishActiveScan(): void;
  addPhoto(photo: PhotoAttachment): void;
  removePhoto(photoId: string): void;
  setProjectNotes(notes: string): void;
  markReportSubmitted(): void;
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
  scanMode: false,
  voiceActive: false,
  lastVoiceHeard: null,
  lastReadingFlash: null,
  gridCalibrationOrigin: null,
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

  setScanMode: on => set({ scanMode: on }),
  setVoiceActive: on => set({ voiceActive: on }),
  setLastVoiceHeard: text => set({ lastVoiceHeard: text }),

  applyReading: reading => {
    const s = get();
    const project = s.projects.find(p => p.id === s.activeProjectId);
    if (!project) return;
    set({
      projects: replaceProject(s.projects, addReadingToProject(project, reading)),
      lastReadingFlash: reading,
    });
  },

  undoLastReading: () => {
    const s = get();
    const project = s.projects.find(p => p.id === s.activeProjectId);
    if (!project) return;
    set({ projects: replaceProject(s.projects, undoReading(project)), lastReadingFlash: null });
  },

  setGrid: grid => {
    const s = get();
    const project = s.projects.find(p => p.id === s.activeProjectId);
    if (!project) return;
    set({
      projects: replaceProject(s.projects, {
        ...project,
        grid: grid ?? undefined,
        updatedAt: new Date().toISOString(),
      }),
      gridCalibrationOrigin: null,
    });
  },

  instantGridFromSection: () => {
    const s = get();
    const project = s.projects.find(p => p.id === s.activeProjectId);
    if (!project) return false;
    const section = project.features.find(
      f => f.kind === 'perimeter' && f.closed && f.vertices.length >= 3,
    );
    if (!section) return false;
    const grid = gridFromPolygon(section.vertices, s.settings.cellSizeM);
    if (!grid) return false;
    get().setGrid(grid);
    return true;
  },

  setGridCalibrationOrigin: p => set({ gridCalibrationOrigin: p }),

  finishGridCalibration: alongRow => {
    const s = get();
    if (!s.gridCalibrationOrigin) return false;
    const grid = gridFromTwoPoints(s.gridCalibrationOrigin, alongRow, s.settings.cellSizeM);
    get().setGrid(grid);
    return true;
  },

  finishActiveScan: () => {
    const s = get();
    const project = s.projects.find(p => p.id === s.activeProjectId);
    if (!project) return;
    set({ projects: replaceProject(s.projects, finishScan(project)), scanMode: false });
  },

  addPhoto: photo => {
    const s = get();
    const project = s.projects.find(p => p.id === s.activeProjectId);
    if (!project) return;
    set({
      projects: replaceProject(s.projects, {
        ...project,
        photos: [...(project.photos ?? []), photo],
        updatedAt: new Date().toISOString(),
      }),
    });
  },

  removePhoto: photoId => {
    const s = get();
    const project = s.projects.find(p => p.id === s.activeProjectId);
    if (!project) return;
    set({
      projects: replaceProject(s.projects, {
        ...project,
        photos: (project.photos ?? []).filter(p => p.id !== photoId),
        updatedAt: new Date().toISOString(),
      }),
    });
  },

  setProjectNotes: notes => {
    const s = get();
    const project = s.projects.find(p => p.id === s.activeProjectId);
    if (!project) return;
    set({
      projects: replaceProject(s.projects, {
        ...project,
        notes,
        updatedAt: new Date().toISOString(),
      }),
    });
  },

  markReportSubmitted: () => {
    const s = get();
    const project = s.projects.find(p => p.id === s.activeProjectId);
    if (!project) return;
    set({
      projects: replaceProject(s.projects, {
        ...project,
        reportSubmittedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
    });
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
