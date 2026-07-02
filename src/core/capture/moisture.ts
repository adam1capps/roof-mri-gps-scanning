import { GatedPoint } from '../gnss/gate';
import { cellKey, GridCell, GridDefinition, pointToCell } from '../geo/grid';
import { newId, RoofProject } from './model';

/**
 * Moisture readings (Tramex RWS workflow): the RX2 rides on top of the
 * scanner, so each reading's position is the antenna position at the moment
 * the contractor enters the value (keypad or voice).
 *
 * Values are 0–10. 0 means "surveyed, dry" — anywhere without a reading is
 * assumed dry, so contractors normally only enter 1–10.
 */

export type ReadingMode = 'precise' | 'cell';

export interface MoistureReading {
  id: string;
  lat: number;
  lon: number;
  sigmaH: number;
  totalAccuracy2d: number;
  /** 0 (verified dry) … 10 (saturated). */
  value: number;
  mode: ReadingMode;
  /** Grid cell the reading attributes, when taken in cell mode. */
  cell?: GridCell;
  /** How the value was entered. */
  source: 'keypad' | 'voice';
  gpsTime: string;
  capturedAt: string;
}

export interface PhotoAttachment {
  id: string;
  /** File path inside the app documents dir. */
  path: string;
  kind: 'photo' | 'core-sample';
  note?: string;
  lat?: number;
  lon?: number;
  takenAt: string;
}

/** Scan-session bookkeeping for productivity stats. */
export interface ScanSession {
  /** ISO timestamp of the first captured reading. */
  startedAt?: string;
  /** ISO timestamp when the contractor tapped "Finish scan". */
  endedAt?: string;
}

export function isValidReadingValue(v: number): boolean {
  return Number.isInteger(v) && v >= 0 && v <= 10;
}

export function createReading(
  point: GatedPoint,
  value: number,
  mode: ReadingMode,
  source: 'keypad' | 'voice',
  grid: GridDefinition | null,
  now = new Date(),
): MoistureReading {
  const reading: MoistureReading = {
    id: newId('rd'),
    lat: point.lat,
    lon: point.lon,
    sigmaH: point.sigmaH,
    totalAccuracy2d: point.totalAccuracy2d,
    value,
    mode: mode === 'cell' && grid ? 'cell' : 'precise',
    source,
    gpsTime: point.gpsTime,
    capturedAt: now.toISOString(),
  };
  if (reading.mode === 'cell' && grid) {
    reading.cell = pointToCell(grid, point);
  }
  return reading;
}

/**
 * Adds a reading to the project. In cell mode a new reading for an
 * already-read cell replaces the previous one (last measurement wins — the
 * contractor re-checked the square).
 */
export function addReading(project: RoofProject, reading: MoistureReading): RoofProject {
  let readings = project.readings ?? [];
  if (reading.mode === 'cell' && reading.cell) {
    const key = cellKey(reading.cell);
    readings = readings.filter(r => !(r.mode === 'cell' && r.cell && cellKey(r.cell) === key));
  }
  return {
    ...project,
    readings: [...readings, reading],
    scan: { ...(project.scan ?? {}), startedAt: project.scan?.startedAt ?? reading.capturedAt },
    updatedAt: new Date().toISOString(),
  };
}

export function undoReading(project: RoofProject): RoofProject {
  const readings = project.readings ?? [];
  if (readings.length === 0) return project;
  return {
    ...project,
    readings: readings.slice(0, -1),
    updatedAt: new Date().toISOString(),
  };
}

export function finishScan(project: RoofProject, now = new Date()): RoofProject {
  return {
    ...project,
    scan: { ...(project.scan ?? {}), endedAt: now.toISOString() },
    updatedAt: now.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Stats for the preview / report
// ---------------------------------------------------------------------------

export interface MoistureStats {
  totalReadings: number;
  /** Readings with value ≥ 1. */
  wetReadings: number;
  /** Count per value 0..10 (index = value). */
  histogram: number[];
  maxValue: number;
  /** Distinct wet cells (cell mode only). */
  wetCells: number;
  /** wetCells × cellSize², m² (0 when no grid). */
  wetCellAreaM2: number;
  /** Seconds from first reading to finish (or last reading). NaN if unknown. */
  scanDurationS: number;
  readingsPerHour: number;
}

export function moistureStats(project: RoofProject): MoistureStats {
  const readings = project.readings ?? [];
  const histogram = new Array<number>(11).fill(0);
  const wetCellKeys = new Set<string>();
  let maxValue = 0;

  for (const r of readings) {
    if (isValidReadingValue(r.value)) histogram[r.value]++;
    if (r.value > maxValue) maxValue = r.value;
    if (r.value >= 1 && r.mode === 'cell' && r.cell) {
      wetCellKeys.add(cellKey(r.cell));
    }
  }

  const cellSize = project.grid?.cellSizeM ?? 0;
  const start = project.scan?.startedAt ? Date.parse(project.scan.startedAt) : NaN;
  const lastReading = readings.length
    ? Date.parse(readings[readings.length - 1].capturedAt)
    : NaN;
  const end = project.scan?.endedAt ? Date.parse(project.scan.endedAt) : lastReading;
  const scanDurationS = Number.isFinite(start) && Number.isFinite(end)
    ? Math.max(0, (end - start) / 1000)
    : NaN;

  const wetReadings = readings.filter(r => r.value >= 1).length;
  return {
    totalReadings: readings.length,
    wetReadings,
    histogram,
    maxValue,
    wetCells: wetCellKeys.size,
    wetCellAreaM2: wetCellKeys.size * cellSize * cellSize,
    scanDurationS,
    readingsPerHour:
      Number.isFinite(scanDurationS) && scanDurationS > 0
        ? (readings.length / scanDurationS) * 3600
        : NaN,
  };
}
