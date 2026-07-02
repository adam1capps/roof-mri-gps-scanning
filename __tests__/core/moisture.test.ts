import { createProject } from '../../src/core/capture/model';
import {
  addReading,
  createReading,
  finishScan,
  isValidReadingValue,
  moistureStats,
  undoReading,
} from '../../src/core/capture/moisture';
import {
  addVertex,
  closeFeature,
  gatedPointToVertex,
  startFeature,
} from '../../src/core/capture/session';
import { parseVoiceCommand } from '../../src/core/capture/voice';
import {
  cellKey,
  cellPolygon,
  DEFAULT_CELL_SIZE_M,
  gridFromPolygon,
  gridFromTwoPoints,
  pointToCell,
} from '../../src/core/geo/grid';
import { polygonAreaM2 } from '../../src/core/geo/measure';
import { enuToLlh } from '../../src/core/geo/transforms';
import { GatedPoint } from '../../src/core/gnss/gate';
import { buildReportRequest } from '../../src/core/report/manifest';
import { projectToGeoJson } from '../../src/core/export/geojson';
import { readingsToCsv } from '../../src/core/export/csv';
import { projectToShapefiles } from '../../src/core/export/shp';
import { FixQuality } from '../../src/core/nmea/types';

const ORIGIN = { lat: 32.7767, lon: -96.797, h: 0 };

function at(e: number, n: number) {
  const p = enuToLlh(ORIGIN, { e, n, u: 0 });
  return { lat: p.lat, lon: p.lon };
}

function pointAt(e: number, n: number, receivedAt = 0): GatedPoint {
  return {
    ...at(e, n),
    ellipsoidalH: 0,
    sigmaH: 0.008,
    totalAccuracy2d: 0.01,
    fixQuality: FixQuality.RtkFix,
    satellites: 22,
    tiltCompensated: false,
    gpsTime: '120000.00',
    receivedAt,
  };
}

describe('grid math', () => {
  // North-aligned grid at ORIGIN, 10 ft cells.
  const grid = gridFromTwoPoints(at(0, 0), at(0, 30), DEFAULT_CELL_SIZE_M);

  it('two-point calibration derives the row bearing', () => {
    expect(grid.bearingDeg).toBeCloseTo(0, 3); // due north
    const east = gridFromTwoPoints(at(0, 0), at(25, 0));
    expect(east.bearingDeg).toBeCloseTo(90, 3);
  });

  it('maps points to cells', () => {
    expect(pointToCell(grid, at(1, 1))).toEqual({ i: 0, j: -1 });
    // u axis = north (row), v axis = 90° left of row = west.
    expect(pointToCell(grid, at(-1, 1))).toEqual({ i: 0, j: 0 });
    expect(pointToCell(grid, at(-1, DEFAULT_CELL_SIZE_M + 0.1))).toEqual({ i: 1, j: 0 });
  });

  it('cellPolygon returns a square of cellSize²', () => {
    const cell = pointToCell(grid, at(-1, 1));
    const ring = cellPolygon(grid, cell);
    expect(ring).toHaveLength(4);
    expect(polygonAreaM2(ring)).toBeCloseTo(DEFAULT_CELL_SIZE_M ** 2, 3);
  });

  it('the calibration point itself lands in cell (0,0) corner region', () => {
    const c = pointToCell(grid, at(-0.5, 0.5));
    expect(cellKey(c)).toBe('0,0');
  });

  it('instant grid from a traced section covers all vertices with i,j ≥ 0', () => {
    const poly = [at(0, 0), at(40, 0), at(40, 20), at(0, 20)];
    const grid2 = gridFromPolygon(poly, DEFAULT_CELL_SIZE_M)!;
    // Longest edge runs east — rows follow it.
    expect(grid2.bearingDeg % 180).toBeCloseTo(90, 2);
    for (const v of poly) {
      const cell = pointToCell(grid2, v);
      expect(cell.i).toBeGreaterThanOrEqual(0);
      expect(cell.j).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('moisture readings', () => {
  const grid = gridFromTwoPoints(at(0, 0), at(0, 30));

  it('validates values 0–10', () => {
    expect(isValidReadingValue(0)).toBe(true);
    expect(isValidReadingValue(10)).toBe(true);
    expect(isValidReadingValue(11)).toBe(false);
    expect(isValidReadingValue(3.5)).toBe(false);
    expect(isValidReadingValue(-1)).toBe(false);
  });

  it('cell-mode reading resolves its grid cell; precise mode does not', () => {
    const cellReading = createReading(pointAt(-1, 4), 7, 'cell', 'keypad', grid);
    expect(cellReading.mode).toBe('cell');
    expect(cellReading.cell).toEqual({ i: 1, j: 0 });

    const precise = createReading(pointAt(-1, 4), 7, 'precise', 'keypad', grid);
    expect(precise.cell).toBeUndefined();

    // Cell mode without a grid falls back to precise.
    const noGrid = createReading(pointAt(-1, 4), 7, 'cell', 'voice', null);
    expect(noGrid.mode).toBe('precise');
  });

  it('re-reading a cell replaces the previous value (last wins)', () => {
    let project = createProject('Wet Roof');
    project = addReading(project, createReading(pointAt(-1, 1), 4, 'cell', 'keypad', grid));
    project = addReading(project, createReading(pointAt(-2, 2), 8, 'cell', 'keypad', grid));
    expect(project.readings).toHaveLength(1);
    expect(project.readings![0].value).toBe(8);
  });

  it('tracks scan start on first reading; finishScan closes the session', () => {
    let project = createProject('Timed Roof');
    expect(project.scan?.startedAt).toBeUndefined();
    project = addReading(project, createReading(pointAt(0, 0), 3, 'precise', 'keypad', null));
    expect(project.scan?.startedAt).toBeTruthy();
    project = finishScan(project);
    expect(project.scan?.endedAt).toBeTruthy();
  });

  it('undoReading removes the newest reading', () => {
    let project = createProject('U');
    project = addReading(project, createReading(pointAt(0, 0), 3, 'precise', 'keypad', null));
    project = addReading(project, createReading(pointAt(1, 0), 9, 'precise', 'keypad', null));
    project = undoReading(project);
    expect(project.readings).toHaveLength(1);
    expect(project.readings![0].value).toBe(3);
  });

  it('computes stats: histogram, wet cells/area, duration', () => {
    let project = createProject('S');
    project = { ...project, grid };
    project = addReading(project, createReading(pointAt(-1, 1), 0, 'cell', 'keypad', grid));
    project = addReading(project, createReading(pointAt(-1, 4), 7, 'cell', 'keypad', grid));
    project = addReading(project, createReading(pointAt(-1, 7), 7, 'cell', 'voice', grid));
    project = addReading(project, createReading(pointAt(-5, 1), 10, 'precise', 'keypad', grid));

    const stats = moistureStats(project);
    expect(stats.totalReadings).toBe(4);
    expect(stats.wetReadings).toBe(3);
    expect(stats.histogram[7]).toBe(2);
    expect(stats.histogram[10]).toBe(1);
    expect(stats.histogram[0]).toBe(1);
    expect(stats.maxValue).toBe(10);
    expect(stats.wetCells).toBe(2); // the two wet cell-mode readings
    expect(stats.wetCellAreaM2).toBeCloseTo(2 * DEFAULT_CELL_SIZE_M ** 2, 3);
  });
});

describe('voice command parsing', () => {
  it('parses "<command> <number>" with digits and words', () => {
    expect(parseVoiceCommand('mark 7')).toEqual({ value: 7, commandWord: 'mark' });
    expect(parseVoiceCommand('Mark seven')).toEqual({ value: 7, commandWord: 'mark' });
    expect(parseVoiceCommand('reading ten')).toEqual({ value: 10, commandWord: 'reading' });
    expect(parseVoiceCommand('record 0')).toEqual({ value: 0, commandWord: 'record' });
  });

  it('takes the LAST command in a long transcript', () => {
    expect(parseVoiceCommand('mark 3 uh no wait mark 5')).toEqual({
      value: 5,
      commandWord: 'mark',
    });
  });

  it('tolerates speech-to-text homophones', () => {
    expect(parseVoiceCommand('mark to')?.value).toBe(2);
    expect(parseVoiceCommand('mark for')?.value).toBe(4);
    expect(parseVoiceCommand('mark ate')?.value).toBe(8);
  });

  it('rejects transcripts without a command or with out-of-range values', () => {
    expect(parseVoiceCommand('seven')).toBeNull();
    expect(parseVoiceCommand('mark eleven')).toBeNull();
    expect(parseVoiceCommand('mark 42')).toBeNull();
    expect(parseVoiceCommand('nice roof today')).toBeNull();
  });

  it('honors custom command words', () => {
    expect(parseVoiceCommand('log 6', ['log'])).toEqual({ value: 6, commandWord: 'log' });
    expect(parseVoiceCommand('mark 6', ['log'])).toBeNull();
  });
});

describe('report manifest + exports with readings', () => {
  function scannedProject() {
    let project = createProject('Report Roof');
    let r = startFeature(project, 'perimeter');
    project = r.project;
    for (const [e, n] of [[0, 0], [30, 0], [30, 20], [0, 20]]) {
      project = addVertex(project, r.feature.id, gatedPointToVertex(pointAt(e, n), 5)).project;
    }
    project = closeFeature(project, r.feature.id);

    const grid = gridFromPolygon(project.features[0].vertices)!;
    project = { ...project, grid };
    project = addReading(project, createReading(pointAt(5, 5), 6, 'cell', 'keypad', grid));
    project = addReading(project, createReading(pointAt(15, 5), 9, 'cell', 'voice', grid));
    project = finishScan(project);
    return project;
  }

  it('builds a complete report request', () => {
    const project = scannedProject();
    const geojson = projectToGeoJson(project);
    const req = buildReportRequest(project, geojson, new Date('2026-07-02T10:00:00Z'));

    expect(req.version).toBe(1);
    expect(req.project.name).toBe('Report Roof');
    expect(req.geometry.netAreaSqFt).toBeCloseTo(600 / 0.09290304, 0);
    expect(req.moisture.totalReadings).toBe(2);
    expect(req.moisture.wetCells).toBe(2);
    expect(req.moisture.histogram[6]).toBe(1);
    expect(req.moisture.histogram[9]).toBe(1);
    expect(req.productivity.scanDurationS).not.toBeNull();
    expect(JSON.parse(req.geojson).type).toBe('FeatureCollection');
  });

  it('GeoJSON includes reading points and colored cells', () => {
    const doc = JSON.parse(projectToGeoJson(scannedProject()));
    const readings = doc.features.filter((f: any) => f.properties.kind === 'moisture-reading');
    const cells = doc.features.filter((f: any) => f.properties.kind === 'moisture-cell');
    expect(readings).toHaveLength(2);
    expect(cells).toHaveLength(2);
    expect(cells[0].geometry.type).toBe('Polygon');
    expect(doc.properties.wet_cell_area_m2).toBeGreaterThan(0);
  });

  it('readings CSV has one row per reading with value and cell', () => {
    const csv = readingsToCsv(scannedProject());
    const lines = csv.trim().split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('moisture_value');
    expect(lines[1].split(',')[3]).toBe('6');
  });

  it('shapefile export gains a readings point layer with MOIST attribute', () => {
    const sets = projectToShapefiles(scannedProject());
    const readingSet = sets.find(s => s.baseName.endsWith('_readings'))!;
    expect(readingSet).toBeDefined();
    const dv = new DataView(readingSet.shp.buffer, readingSet.shp.byteOffset, readingSet.shp.byteLength);
    expect(dv.getInt32(32, true)).toBe(1); // point type
    // DBF: 5 reading fields, 2 records.
    const ddv = new DataView(readingSet.dbf.buffer, readingSet.dbf.byteOffset, readingSet.dbf.byteLength);
    expect(ddv.getUint32(4, true)).toBe(2);
    const headerSize = ddv.getUint16(8, true);
    expect(headerSize).toBe(32 + 32 * 5 + 1);
    const record = String.fromCharCode(
      ...readingSet.dbf.subarray(headerSize, headerSize + ddv.getUint16(10, true)),
    );
    expect(record).toContain('6');
    expect(record).toContain('cell');
  });
});
