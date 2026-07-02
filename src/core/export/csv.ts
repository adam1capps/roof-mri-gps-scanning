import { RoofProject } from '../capture/model';
import { cellKey } from '../geo/grid';
import { fixQualityLabel } from '../gnss/gate';

function csvField(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Geometry vertices: one row per captured vertex:
 * feature, kind, index, lat, lon, accuracy, fix, tilt, timestamps.
 */
export function projectToCsv(project: RoofProject): string {
  const rows: string[] = [
    [
      'feature_name',
      'feature_kind',
      'vertex_index',
      'latitude',
      'longitude',
      'sigma_h_m',
      'total_accuracy_2d_m',
      'fix_quality',
      'satellites',
      'tilt_compensated',
      'tilt_deg',
      'epochs_averaged',
      'gps_time_utc',
      'captured_at',
    ].join(','),
  ];

  for (const f of project.features) {
    f.vertices.forEach((v, i) => {
      rows.push(
        [
          csvField(f.name),
          f.kind,
          String(i + 1),
          v.lat.toFixed(9),
          v.lon.toFixed(9),
          Number.isFinite(v.sigmaH) ? v.sigmaH.toFixed(4) : '',
          Number.isFinite(v.totalAccuracy2d) ? v.totalAccuracy2d.toFixed(4) : '',
          fixQualityLabel(v.fixQuality),
          String(v.satellites),
          v.tiltCompensated ? 'yes' : 'no',
          v.tiltValueDeg !== undefined ? v.tiltValueDeg.toFixed(2) : '',
          String(v.epochs),
          v.gpsTime,
          v.capturedAt,
        ].join(','),
      );
    });
  }
  return rows.join('\r\n') + '\r\n';
}

/** Moisture readings: one row per reading (Tramex value 0–10 at RX2 position). */
export function readingsToCsv(project: RoofProject): string {
  const rows: string[] = [
    [
      'reading_index',
      'latitude',
      'longitude',
      'moisture_value',
      'mode',
      'grid_cell',
      'source',
      'sigma_h_m',
      'total_accuracy_2d_m',
      'gps_time_utc',
      'captured_at',
    ].join(','),
  ];

  (project.readings ?? []).forEach((r, i) => {
    rows.push(
      [
        String(i + 1),
        r.lat.toFixed(9),
        r.lon.toFixed(9),
        String(r.value),
        r.mode,
        r.cell ? csvField(cellKey(r.cell)) : '',
        r.source,
        Number.isFinite(r.sigmaH) ? r.sigmaH.toFixed(4) : '',
        Number.isFinite(r.totalAccuracy2d) ? r.totalAccuracy2d.toFixed(4) : '',
        r.gpsTime,
        r.capturedAt,
      ].join(','),
    );
  });
  return rows.join('\r\n') + '\r\n';
}
