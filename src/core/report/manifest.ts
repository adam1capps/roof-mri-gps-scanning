import { ProjectStats, RoofProject } from '../capture/model';
import { moistureStats, MoistureStats } from '../capture/moisture';
import { projectStats } from '../capture/session';
import { m2ToSqFt, m2ToSquares } from '../geo/measure';

/**
 * Report request payload for the Roof MRI Report Creation Team.
 *
 * Submitted automatically when the contractor finalizes a scan: POSTed as
 * JSON to the configured webhook and/or attached to the share-sheet email.
 * Photos travel as separate files; the manifest lists them by name.
 */

export interface ReportRequest {
  version: 1;
  requestedAt: string;
  project: {
    id: string;
    name: string;
    createdAt: string;
    notes?: string;
  };
  geometry: {
    grossAreaSqFt: number;
    penetrationAreaSqFt: number;
    netAreaSqFt: number;
    netSquares: number;
    perimeterFt: number;
    featureCount: number;
  };
  moisture: {
    totalReadings: number;
    wetReadings: number;
    maxValue: number;
    histogram: number[];
    wetCells: number;
    wetCellAreaSqFt: number;
    gridCellSizeM: number | null;
  };
  productivity: {
    scanDurationS: number | null;
    readingsPerHour: number | null;
    scanStartedAt?: string;
    scanEndedAt?: string;
  };
  photos: Array<{
    fileName: string;
    kind: 'photo' | 'core-sample';
    note?: string;
    lat?: number;
    lon?: number;
    takenAt: string;
  }>;
  /** Embedded full data set (GeoJSON string) for the report team's GIS. */
  geojson: string;
}

const FT_PER_M = 1 / 0.3048;

export function buildReportRequest(
  project: RoofProject,
  geojson: string,
  now = new Date(),
): ReportRequest {
  const stats: ProjectStats = projectStats(project);
  const moisture: MoistureStats = moistureStats(project);

  return {
    version: 1,
    requestedAt: now.toISOString(),
    project: {
      id: project.id,
      name: project.name,
      createdAt: project.createdAt,
      notes: project.notes,
    },
    geometry: {
      grossAreaSqFt: round(m2ToSqFt(stats.grossAreaM2)),
      penetrationAreaSqFt: round(m2ToSqFt(stats.penetrationAreaM2)),
      netAreaSqFt: round(m2ToSqFt(stats.netAreaM2)),
      netSquares: round(m2ToSquares(stats.netAreaM2), 1),
      perimeterFt: round(stats.perimeterM * FT_PER_M, 1),
      featureCount: project.features.length,
    },
    moisture: {
      totalReadings: moisture.totalReadings,
      wetReadings: moisture.wetReadings,
      maxValue: moisture.maxValue,
      histogram: moisture.histogram,
      wetCells: moisture.wetCells,
      wetCellAreaSqFt: round(m2ToSqFt(moisture.wetCellAreaM2)),
      gridCellSizeM: project.grid?.cellSizeM ?? null,
    },
    productivity: {
      scanDurationS: Number.isFinite(moisture.scanDurationS)
        ? Math.round(moisture.scanDurationS)
        : null,
      readingsPerHour: Number.isFinite(moisture.readingsPerHour)
        ? round(moisture.readingsPerHour, 1)
        : null,
      scanStartedAt: project.scan?.startedAt,
      scanEndedAt: project.scan?.endedAt,
    },
    photos: (project.photos ?? []).map(p => ({
      fileName: p.path.split('/').pop() ?? p.path,
      kind: p.kind,
      note: p.note,
      lat: p.lat,
      lon: p.lon,
      takenAt: p.takenAt,
    })),
    geojson,
  };
}

function round(n: number, d = 0): number {
  const p = 10 ** d;
  return Math.round(n * p) / p;
}
