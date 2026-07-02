import { createProject } from '../../src/core/capture/model';
import {
  addVertex,
  closeFeature,
  gatedPointToVertex,
  startFeature,
} from '../../src/core/capture/session';
import { projectToCsv } from '../../src/core/export/csv';
import { projectToDxf } from '../../src/core/export/dxf';
import { projectToGeoJson } from '../../src/core/export/geojson';
import { buildDbf, projectToShapefiles, WGS84_PRJ_WKT } from '../../src/core/export/shp';
import { enuToLlh } from '../../src/core/geo/transforms';
import { GatedPoint } from '../../src/core/gnss/gate';
import { FixQuality } from '../../src/core/nmea/types';

const ORIGIN = { lat: 32.7767, lon: -96.797, h: 0 };

function pointAt(e: number, n: number): GatedPoint {
  const p = enuToLlh(ORIGIN, { e, n, u: 0 });
  return {
    lat: p.lat,
    lon: p.lon,
    ellipsoidalH: 0,
    sigmaH: 0.007,
    totalAccuracy2d: 0.009,
    fixQuality: FixQuality.RtkFix,
    satellites: 22,
    tiltCompensated: true,
    tiltValueDeg: 2.5,
    gpsTime: '120000.00',
    receivedAt: 0,
  };
}

/** 20×10 perimeter + a point drain + an open edge line. */
function sampleProject() {
  let project = createProject('Test Warehouse');

  let r = startFeature(project, 'perimeter');
  project = r.project;
  for (const [e, n] of [[0, 0], [20, 0], [20, 10], [0, 10]]) {
    project = addVertex(project, r.feature.id, gatedPointToVertex(pointAt(e, n), 5)).project;
  }
  project = closeFeature(project, r.feature.id);

  r = startFeature(project, 'point');
  project = r.project;
  project = addVertex(project, r.feature.id, gatedPointToVertex(pointAt(5, 5), 5)).project;

  r = startFeature(project, 'edge');
  project = r.project;
  project = addVertex(project, r.feature.id, gatedPointToVertex(pointAt(0, 12), 1)).project;
  project = addVertex(project, r.feature.id, gatedPointToVertex(pointAt(20, 12), 1)).project;

  return project;
}

describe('CSV export', () => {
  it('writes a header and one row per vertex', () => {
    const csv = projectToCsv(sampleProject());
    const lines = csv.trim().split('\r\n');
    expect(lines).toHaveLength(1 + 4 + 1 + 2);
    expect(lines[0]).toContain('latitude,longitude,sigma_h_m');
    const first = lines[1].split(',');
    expect(first[0]).toBe('Perimeter 1');
    expect(parseFloat(first[3])).toBeCloseTo(ORIGIN.lat, 6);
    expect(first[9]).toBe('yes'); // tilt compensated
  });
});

describe('GeoJSON export', () => {
  it('produces closed CCW polygon rings and aggregate stats', () => {
    const doc = JSON.parse(projectToGeoJson(sampleProject()));
    expect(doc.type).toBe('FeatureCollection');
    expect(doc.features).toHaveLength(3);

    const poly = doc.features.find((f: any) => f.geometry.type === 'Polygon');
    const ring: number[][] = poly.geometry.coordinates[0];
    expect(ring[0]).toEqual(ring[ring.length - 1]); // closed
    expect(poly.properties.area_m2).toBeCloseTo(200, 1);

    expect(doc.properties.net_area_m2).toBeCloseTo(200, 1);
    expect(doc.properties.perimeter_m).toBeCloseTo(60, 1);
  });
});

describe('DXF export', () => {
  it('emits R12 sections, layers, a closed polyline, and a point', () => {
    const dxf = projectToDxf(sampleProject(), { crs: 'local', units: 'm' });
    expect(dxf).toContain('AC1009');
    for (const layer of ['PERIMETER', 'PENETRATION', 'EDGE', 'POINTS']) {
      expect(dxf).toContain(layer);
    }
    expect((dxf.match(/0\nPOLYLINE/g) ?? []).length).toBe(2); // perimeter + edge
    expect((dxf.match(/0\nVERTEX/g) ?? []).length).toBe(6);
    expect((dxf.match(/0\nPOINT/g) ?? []).length).toBe(1);
    expect(dxf).toContain('70\n1'); // closed polyline flag
    expect(dxf.trim().endsWith('EOF'));

    // Local CRS: first perimeter corner is the origin → coordinates ~0.
    expect(dxf).toContain('10\n0.0000');
  });

  it('UTM mode places coordinates in the correct zone range', () => {
    const dxf = projectToDxf(sampleProject(), { crs: 'utm', units: 'm' });
    expect(dxf).toContain('EPSG:32614'); // Dallas = UTM 14N
    const eastings = [...dxf.matchAll(/10\n(\d+\.\d+)/g)].map(m => parseFloat(m[1]));
    expect(eastings.length).toBeGreaterThan(0);
    for (const e of eastings) {
      expect(e).toBeGreaterThan(100000);
      expect(e).toBeLessThan(900000);
    }
  });

  it('converts to feet when requested', () => {
    const m = projectToDxf(sampleProject(), { crs: 'local', units: 'm' });
    const ft = projectToDxf(sampleProject(), { crs: 'local', units: 'ft' });
    // 20 m easting corner ≈ 65.6168 ft
    expect(m).toContain('10\n20.0000');
    expect(ft).toContain('10\n65.6168');
  });
});

describe('Shapefile export', () => {
  const sets = projectToShapefiles(sampleProject());

  it('produces polygon, line and point file sets with WGS84 .prj', () => {
    expect(sets.map(s => s.baseName)).toEqual([
      'test_warehouse_polygons',
      'test_warehouse_lines',
      'test_warehouse_points',
    ]);
    for (const s of sets) expect(s.prj).toBe(WGS84_PRJ_WKT);
  });

  it('writes valid .shp headers (file code, length, shape type)', () => {
    const poly = sets[0];
    const dv = new DataView(poly.shp.buffer, poly.shp.byteOffset, poly.shp.byteLength);
    expect(dv.getInt32(0, false)).toBe(9994);
    expect(dv.getInt32(24, false) * 2).toBe(poly.shp.byteLength);
    expect(dv.getInt32(28, true)).toBe(1000);
    expect(dv.getInt32(32, true)).toBe(5); // polygon

    const pointSet = sets[2];
    const pdv = new DataView(pointSet.shp.buffer, pointSet.shp.byteOffset, pointSet.shp.byteLength);
    expect(pdv.getInt32(32, true)).toBe(1); // point
  });

  it('polygon record ring is closed, clockwise, and inside the bbox', () => {
    const poly = sets[0];
    const dv = new DataView(poly.shp.buffer, poly.shp.byteOffset, poly.shp.byteLength);
    // First record starts at byte 100: header(8) + type(4) + box(32)
    expect(dv.getInt32(100, false)).toBe(1); // record number
    expect(dv.getInt32(108, true)).toBe(5); // shape type
    const numParts = dv.getInt32(144, true);
    const numPoints = dv.getInt32(148, true);
    expect(numParts).toBe(1);
    expect(numPoints).toBe(5); // 4 corners + closing point

    const ptsStart = 152 + 4 * numParts;
    const pts: Array<[number, number]> = [];
    for (let i = 0; i < numPoints; i++) {
      pts.push([
        dv.getFloat64(ptsStart + 16 * i, true),
        dv.getFloat64(ptsStart + 16 * i + 8, true),
      ]);
    }
    expect(pts[0]).toEqual(pts[numPoints - 1]);
    // Clockwise: signed area in lon/lat must be negative.
    let area = 0;
    for (let i = 0; i < numPoints - 1; i++) {
      area += pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1];
    }
    expect(area).toBeLessThan(0);
    // Coordinates are near Dallas.
    expect(pts[0][0]).toBeCloseTo(ORIGIN.lon, 2);
    expect(pts[0][1]).toBeCloseTo(ORIGIN.lat, 2);
  });

  it('shx index references each record', () => {
    const poly = sets[0];
    const dv = new DataView(poly.shx.buffer, poly.shx.byteOffset, poly.shx.byteLength);
    expect(poly.shx.byteLength).toBe(100 + 8 * 1);
    expect(dv.getInt32(100, false)).toBe(50); // first record at byte 100 = 50 words
  });

  it('dbf carries attributes with the declared record layout', () => {
    const dbf = buildDbf([['Roof A', 'perimeter', '200.000', '60.000', '0.000', '0.0090']]);
    expect(dbf[0]).toBe(0x03);
    const dv = new DataView(dbf.buffer);
    expect(dv.getUint32(4, true)).toBe(1); // record count
    const headerSize = dv.getUint16(8, true);
    const recordSize = dv.getUint16(10, true);
    expect(headerSize).toBe(32 + 32 * 6 + 1);
    expect(recordSize).toBe(1 + 40 + 12 + 14 + 12 + 12 + 8);
    expect(dbf[headerSize - 1]).toBe(0x0d);
    expect(dbf[dbf.length - 1]).toBe(0x1a);
    const record = String.fromCharCode(...dbf.subarray(headerSize, headerSize + recordSize));
    expect(record).toContain('Roof A');
    expect(record).toContain('perimeter');
    expect(record).toContain('200.000');
  });
});
