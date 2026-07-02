import { RoofFeature, RoofProject } from '../capture/model';
import { featureStats } from '../capture/session';

/**
 * ESRI Shapefile writer (pure TypeScript, no deps).
 *
 * Produces the classic sidecar set per geometry type:
 *   .shp (geometry) + .shx (index) + .dbf (attributes) + .prj (WGS84 WKT)
 *
 * Coordinates are WGS84 lon/lat (EPSG:4326) — GIS packages reproject as
 * needed. One shapefile can hold only one geometry type, so a project
 * exports up to three: *_polygons, *_lines, *_points.
 */

export type ShapeType = 1 | 3 | 5; // Point, PolyLine, Polygon

export interface ShpFileSet {
  /** e.g. "warehouse_roof_polygons" */
  baseName: string;
  shp: Uint8Array;
  shx: Uint8Array;
  dbf: Uint8Array;
  prj: string;
}

export const WGS84_PRJ_WKT =
  'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],' +
  'PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';

type XY = [number, number]; // lon, lat

interface DbfField {
  name: string; // ≤ 10 chars
  type: 'C' | 'N';
  length: number;
  decimals: number;
}

const FIELDS: DbfField[] = [
  { name: 'NAME', type: 'C', length: 40, decimals: 0 },
  { name: 'KIND', type: 'C', length: 12, decimals: 0 },
  { name: 'AREA_M2', type: 'N', length: 14, decimals: 3 },
  { name: 'PERIM_M', type: 'N', length: 12, decimals: 3 },
  { name: 'LENGTH_M', type: 'N', length: 12, decimals: 3 },
  { name: 'ACC_M', type: 'N', length: 8, decimals: 4 },
];

function attributeRow(f: RoofFeature): string[] {
  const s = featureStats(f);
  return [
    f.name,
    f.kind,
    s.areaM2.toFixed(3),
    s.perimeterM.toFixed(3),
    s.lengthM.toFixed(3),
    Number.isFinite(s.worstAccuracyM) ? s.worstAccuracyM.toFixed(4) : '',
  ];
}

/** Signed ring area in lon/lat plane — sign only used for orientation. */
function ringSigned(ring: XY[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

/** Shapefile outer rings must be clockwise. */
function clockwise(ring: XY[]): XY[] {
  return ringSigned(ring) > 0 ? [...ring].reverse() : ring;
}

function closeRing(ring: XY[]): XY[] {
  const [fx, fy] = ring[0];
  const [lx, ly] = ring[ring.length - 1];
  return fx === lx && fy === ly ? ring : [...ring, [fx, fy]];
}

class ByteWriter {
  private buf: DataView;
  private bytes: Uint8Array;
  private pos = 0;

  constructor(size: number) {
    const ab = new ArrayBuffer(size);
    this.buf = new DataView(ab);
    this.bytes = new Uint8Array(ab);
  }

  i32be(v: number): void {
    this.buf.setInt32(this.pos, v, false);
    this.pos += 4;
  }
  i32le(v: number): void {
    this.buf.setInt32(this.pos, v, true);
    this.pos += 4;
  }
  f64le(v: number): void {
    this.buf.setFloat64(this.pos, v, true);
    this.pos += 8;
  }
  u8(v: number): void {
    this.bytes[this.pos++] = v & 0xff;
  }
  ascii(s: string, fixedLength?: number): void {
    const len = fixedLength ?? s.length;
    for (let i = 0; i < len; i++) {
      this.bytes[this.pos++] = i < s.length ? s.charCodeAt(i) & 0x7f : 0x20;
    }
  }
  asciiZeroPadded(s: string, fixedLength: number): void {
    for (let i = 0; i < fixedLength; i++) {
      this.bytes[this.pos++] = i < s.length ? s.charCodeAt(i) & 0x7f : 0;
    }
  }
  seek(pos: number): void {
    this.pos = pos;
  }
  get position(): number {
    return this.pos;
  }
  result(): Uint8Array {
    return this.bytes;
  }
}

interface Bounds {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
}

function boundsOf(points: XY[]): Bounds {
  let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;
  for (const [x, y] of points) {
    if (x < xmin) xmin = x;
    if (y < ymin) ymin = y;
    if (x > xmax) xmax = x;
    if (y > ymax) ymax = y;
  }
  return { xmin, ymin, xmax, ymax };
}

function writeMainHeader(w: ByteWriter, fileLengthBytes: number, shapeType: ShapeType, b: Bounds): void {
  w.i32be(9994);
  for (let i = 0; i < 5; i++) w.i32be(0);
  w.i32be(fileLengthBytes / 2);
  w.i32le(1000);
  w.i32le(shapeType);
  w.f64le(b.xmin);
  w.f64le(b.ymin);
  w.f64le(b.xmax);
  w.f64le(b.ymax);
  w.f64le(0); // zmin
  w.f64le(0); // zmax
  w.f64le(0); // mmin
  w.f64le(0); // mmax
}

/** Geometry of one record: point = single XY; line/polygon = parts of XY[]. */
export interface ShpGeometry {
  point?: XY;
  parts?: XY[][];
}

export function buildShp(
  shapeType: ShapeType,
  geometries: ShpGeometry[],
): { shp: Uint8Array; shx: Uint8Array } {
  const contents: number[] = geometries.map(geom => {
    if (shapeType === 1) return 4 + 16;
    const parts = geom.parts!;
    const numPoints = parts.reduce((s, p) => s + p.length, 0);
    return 4 + 32 + 4 + 4 + 4 * parts.length + 16 * numPoints;
  });

  const totalShp = 100 + contents.reduce((s, c) => s + 8 + c, 0);
  const shpW = new ByteWriter(totalShp);
  const shxW = new ByteWriter(100 + 8 * geometries.length);

  const allPoints: XY[] = geometries.flatMap(gm =>
    shapeType === 1 ? [gm.point!] : gm.parts!.flat(),
  );
  const bounds = allPoints.length
    ? boundsOf(allPoints)
    : { xmin: 0, ymin: 0, xmax: 0, ymax: 0 };

  writeMainHeader(shpW, totalShp, shapeType, bounds);
  writeMainHeader(shxW, 100 + 8 * geometries.length, shapeType, bounds);

  geometries.forEach((geom, idx) => {
    const contentLen = contents[idx];
    shxW.i32be(shpW.position / 2);
    shxW.i32be(contentLen / 2);

    shpW.i32be(idx + 1);
    shpW.i32be(contentLen / 2);
    shpW.i32le(shapeType);

    if (shapeType === 1) {
      shpW.f64le(geom.point![0]);
      shpW.f64le(geom.point![1]);
      return;
    }

    const parts = geom.parts!;
    const flat = parts.flat();
    const b = boundsOf(flat);
    shpW.f64le(b.xmin);
    shpW.f64le(b.ymin);
    shpW.f64le(b.xmax);
    shpW.f64le(b.ymax);
    shpW.i32le(parts.length);
    shpW.i32le(flat.length);
    let offset = 0;
    for (const part of parts) {
      shpW.i32le(offset);
      offset += part.length;
    }
    for (const [x, y] of flat) {
      shpW.f64le(x);
      shpW.f64le(y);
    }
  });

  return { shp: shpW.result(), shx: shxW.result() };
}

export function buildDbf(rows: string[][], now = new Date()): Uint8Array {
  const recordSize = 1 + FIELDS.reduce((s, f) => s + f.length, 0);
  const headerSize = 32 + 32 * FIELDS.length + 1;
  const total = headerSize + recordSize * rows.length + 1;
  const w = new ByteWriter(total);

  w.u8(0x03);
  w.u8(now.getFullYear() - 1900);
  w.u8(now.getMonth() + 1);
  w.u8(now.getDate());
  w.i32le(rows.length);
  w.u8(headerSize & 0xff);
  w.u8((headerSize >> 8) & 0xff);
  w.u8(recordSize & 0xff);
  w.u8((recordSize >> 8) & 0xff);
  for (let i = 12; i < 32; i++) w.u8(0);

  for (const f of FIELDS) {
    w.asciiZeroPadded(f.name, 11);
    w.ascii(f.type, 1);
    w.i32le(0);
    w.u8(f.length);
    w.u8(f.decimals);
    for (let i = 18; i < 32; i++) w.u8(0);
  }
  w.u8(0x0d);

  for (const row of rows) {
    w.u8(0x20); // not deleted
    FIELDS.forEach((f, i) => {
      const raw = row[i] ?? '';
      const val =
        f.type === 'N'
          ? raw.slice(0, f.length).padStart(f.length, ' ')
          : raw.slice(0, f.length).padEnd(f.length, ' ');
      w.ascii(val, f.length);
    });
  }
  w.u8(0x1a);

  return w.result();
}

export function projectToShapefiles(project: RoofProject): ShpFileSet[] {
  const safe = project.name.replace(/[^A-Za-z0-9_-]+/g, '_').toLowerCase() || 'roof';
  const out: ShpFileSet[] = [];

  const polygonFeatures = project.features.filter(
    f => (f.kind === 'perimeter' || f.kind === 'penetration') && f.closed && f.vertices.length >= 3,
  );
  if (polygonFeatures.length) {
    const geoms = polygonFeatures.map(f => ({
      parts: [clockwise(closeRing(f.vertices.map(v => [v.lon, v.lat] as XY)))],
    }));
    const { shp, shx } = buildShp(5, geoms);
    out.push({
      baseName: `${safe}_polygons`,
      shp,
      shx,
      dbf: buildDbf(polygonFeatures.map(attributeRow)),
      prj: WGS84_PRJ_WKT,
    });
  }

  const lineFeatures = project.features.filter(
    f =>
      f.kind === 'edge' ? f.vertices.length >= 2
      : (f.kind === 'perimeter' || f.kind === 'penetration') && !f.closed && f.vertices.length >= 2,
  );
  if (lineFeatures.length) {
    const geoms = lineFeatures.map(f => ({
      parts: [f.vertices.map(v => [v.lon, v.lat] as XY)],
    }));
    const { shp, shx } = buildShp(3, geoms);
    out.push({
      baseName: `${safe}_lines`,
      shp,
      shx,
      dbf: buildDbf(lineFeatures.map(attributeRow)),
      prj: WGS84_PRJ_WKT,
    });
  }

  const pointFeatures = project.features.filter(
    f => f.kind === 'point' && f.vertices.length >= 1,
  );
  if (pointFeatures.length) {
    const geoms = pointFeatures.map(f => ({
      point: [f.vertices[0].lon, f.vertices[0].lat] as XY,
    }));
    const { shp, shx } = buildShp(1, geoms);
    out.push({
      baseName: `${safe}_points`,
      shp,
      shx,
      dbf: buildDbf(pointFeatures.map(attributeRow)),
      prj: WGS84_PRJ_WKT,
    });
  }

  return out;
}
