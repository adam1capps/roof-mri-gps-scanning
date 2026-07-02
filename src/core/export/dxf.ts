import { RoofProject } from '../capture/model';
import { GeoPoint, toLocalEN } from '../geo/measure';
import { llToUtm } from '../geo/utm';
import { LatLon } from '../geo/wgs84';

/**
 * DXF R12 (AC1009) export — the most widely readable DXF flavor.
 *
 * Coordinate options:
 *  - 'local': meters (or feet) on a local tangent plane anchored at the first
 *    captured vertex. Best for CAD takeoff — small, clean numbers.
 *  - 'utm':   absolute UTM easting/northing (meters) so drawings land
 *    georeferenced in CAD/GIS. The zone/EPSG goes in a header comment.
 */
export interface DxfOptions {
  crs: 'local' | 'utm';
  units: 'm' | 'ft';
}

const LAYERS: Record<string, { color: number }> = {
  PERIMETER: { color: 3 }, // green
  PENETRATION: { color: 1 }, // red
  EDGE: { color: 5 }, // blue
  POINTS: { color: 2 }, // yellow
};

const KIND_TO_LAYER: Record<string, string> = {
  perimeter: 'PERIMETER',
  penetration: 'PENETRATION',
  edge: 'EDGE',
  point: 'POINTS',
};

const M_TO_FT = 1 / 0.3048;

export function projectToDxf(
  project: RoofProject,
  options: DxfOptions = { crs: 'local', units: 'm' },
): string {
  const allVertices = project.features.flatMap(f => f.vertices);
  if (allVertices.length === 0) return emptyDxf('empty project');

  const origin: LatLon = { lat: allVertices[0].lat, lon: allVertices[0].lon };
  const scale = options.units === 'ft' ? M_TO_FT : 1;

  const toXY = (pts: GeoPoint[]): Array<{ x: number; y: number }> => {
    if (options.crs === 'utm') {
      return pts.map(p => {
        const u = llToUtm(p);
        return { x: u.easting * scale, y: u.northing * scale };
      });
    }
    return toLocalEN(pts, origin).map(p => ({ x: p.e * scale, y: p.n * scale }));
  };

  const originUtm = llToUtm(origin);
  const comment =
    options.crs === 'utm'
      ? `RoofMRI export | CRS ${originUtm.epsg} (UTM zone ${originUtm.zone}${originUtm.hemisphere}) | units ${options.units}`
      : `RoofMRI export | local tangent plane, origin lat ${origin.lat.toFixed(9)} lon ${origin.lon.toFixed(9)} | units ${options.units}`;

  const g = (code: number, value: string | number): string => `${code}\n${value}`;
  const lines: string[] = [];

  lines.push(g(999, comment));

  // HEADER
  lines.push(g(0, 'SECTION'), g(2, 'HEADER'));
  lines.push(g(9, '$ACADVER'), g(1, 'AC1009'));
  lines.push(g(0, 'ENDSEC'));

  // TABLES → LAYER table
  lines.push(g(0, 'SECTION'), g(2, 'TABLES'));
  lines.push(g(0, 'TABLE'), g(2, 'LAYER'), g(70, Object.keys(LAYERS).length));
  for (const [name, { color }] of Object.entries(LAYERS)) {
    lines.push(
      g(0, 'LAYER'),
      g(2, name),
      g(70, 0),
      g(62, color),
      g(6, 'CONTINUOUS'),
    );
  }
  lines.push(g(0, 'ENDTAB'), g(0, 'ENDSEC'));

  // ENTITIES
  lines.push(g(0, 'SECTION'), g(2, 'ENTITIES'));

  for (const f of project.features) {
    const layer = KIND_TO_LAYER[f.kind] ?? '0';
    const xy = toXY(
      f.vertices.map(v => ({
        lat: v.lat,
        lon: v.lon,
        h: Number.isFinite(v.ellipsoidalH) ? v.ellipsoidalH : undefined,
      })),
    );

    if (f.kind === 'point' && xy.length >= 1) {
      lines.push(
        g(0, 'POINT'),
        g(8, layer),
        g(10, fmt(xy[0].x)),
        g(20, fmt(xy[0].y)),
        g(30, 0),
      );
      continue;
    }

    if (xy.length < 2) continue;

    const isPolygon = f.kind === 'perimeter' || f.kind === 'penetration';
    const closedFlag = isPolygon && f.closed ? 1 : 0;

    lines.push(
      g(0, 'POLYLINE'),
      g(8, layer),
      g(66, 1),
      g(70, closedFlag),
    );
    for (const p of xy) {
      lines.push(
        g(0, 'VERTEX'),
        g(8, layer),
        g(10, fmt(p.x)),
        g(20, fmt(p.y)),
        g(30, 0),
      );
    }
    lines.push(g(0, 'SEQEND'));
  }

  lines.push(g(0, 'ENDSEC'), g(0, 'EOF'));
  return lines.join('\n') + '\n';
}

function fmt(n: number): string {
  return n.toFixed(4);
}

function emptyDxf(comment: string): string {
  return [
    `999\n${comment}`,
    '0\nSECTION',
    '2\nENTITIES',
    '0\nENDSEC',
    '0\nEOF',
  ].join('\n');
}
