import { toLocalEN } from './measure';
import { enuToLlh, llhToEnu } from './transforms';
import { LatLon } from './wgs84';

/**
 * Scan grid for cell-mode moisture readings.
 *
 * A grid is a square lattice on the local tangent plane: an origin corner, a
 * bearing for its "row" axis, and a cell size (default 10 ft — the classic
 * moisture-survey grid). Readings taken anywhere inside a cell attribute the
 * whole cell.
 *
 * Two ways to define one:
 *  - Instant grid: derived from a traced roof section — origin at the section's
 *    min corner, rows aligned to its longest edge.
 *  - Calibrated manual grid: the contractor occupies two points on a chalked
 *    grid line (origin corner, then any point along the same row line).
 */

export const DEFAULT_CELL_SIZE_M = 3.048; // 10 ft

export interface GridDefinition {
  originLat: number;
  originLon: number;
  /** Bearing of the grid row (i) axis, degrees clockwise from true north. */
  bearingDeg: number;
  cellSizeM: number;
}

export interface GridCell {
  i: number; // along the row axis
  j: number; // along the column axis (90° CCW from row axis)
}

export function cellKey(cell: GridCell): string {
  return `${cell.i},${cell.j}`;
}

/** Local grid coordinates (meters along row/column axes) of a point. */
function toGridEN(grid: GridDefinition, p: LatLon): { u: number; v: number } {
  const enu = llhToEnu(
    { lat: grid.originLat, lon: grid.originLon, h: 0 },
    { lat: p.lat, lon: p.lon, h: 0 },
  );
  // Row axis unit vector in EN: bearing θ from north → (sinθ, cosθ).
  const th = (grid.bearingDeg * Math.PI) / 180;
  const rowE = Math.sin(th);
  const rowN = Math.cos(th);
  return {
    u: enu.e * rowE + enu.n * rowN, // along rows
    v: -enu.e * rowN + enu.n * rowE, // along columns (left of row axis)
  };
}

export function pointToCell(grid: GridDefinition, p: LatLon): GridCell {
  const { u, v } = toGridEN(grid, p);
  return { i: Math.floor(u / grid.cellSizeM), j: Math.floor(v / grid.cellSizeM) };
}

/** The four corners of a cell as WGS84 positions (unclosed ring, CCW). */
export function cellPolygon(grid: GridDefinition, cell: GridCell): LatLon[] {
  const th = (grid.bearingDeg * Math.PI) / 180;
  const rowE = Math.sin(th);
  const rowN = Math.cos(th);
  const colE = -rowN;
  const colN = rowE;
  const s = grid.cellSizeM;
  const origin = { lat: grid.originLat, lon: grid.originLon, h: 0 };

  const corner = (u: number, v: number) => {
    const e = u * rowE + v * colE;
    const n = u * rowN + v * colN;
    const llh = enuToLlh(origin, { e, n, u: 0 });
    return { lat: llh.lat, lon: llh.lon };
  };

  const u0 = cell.i * s;
  const v0 = cell.j * s;
  return [
    corner(u0, v0),
    corner(u0 + s, v0),
    corner(u0 + s, v0 + s),
    corner(u0, v0 + s),
  ];
}

/**
 * Calibrated manual grid: `origin` is a grid corner, `alongRow` is any point
 * on the same grid line (e.g. the next chalk intersection along the row).
 */
export function gridFromTwoPoints(
  origin: LatLon,
  alongRow: LatLon,
  cellSizeM = DEFAULT_CELL_SIZE_M,
): GridDefinition {
  const enu = llhToEnu({ ...origin, h: 0 }, { ...alongRow, h: 0 });
  const bearingDeg = ((Math.atan2(enu.e, enu.n) * 180) / Math.PI + 360) % 360;
  return { originLat: origin.lat, originLon: origin.lon, bearingDeg, cellSizeM };
}

/**
 * Instant grid from a traced roof section: rows follow the polygon's longest
 * edge; the origin is the section's minimum corner in grid coordinates, so
 * every vertex lands at non-negative (i, j).
 */
export function gridFromPolygon(
  vertices: LatLon[],
  cellSizeM = DEFAULT_CELL_SIZE_M,
): GridDefinition | null {
  if (vertices.length < 3) return null;

  const en = toLocalEN(vertices);
  let bestLen = -1;
  let bearingDeg = 0;
  for (let k = 0; k < en.length; k++) {
    const a = en[k];
    const b = en[(k + 1) % en.length];
    const len = Math.hypot(b.e - a.e, b.n - a.n);
    if (len > bestLen) {
      bestLen = len;
      bearingDeg = ((Math.atan2(b.e - a.e, b.n - a.n) * 180) / Math.PI + 360) % 360;
    }
  }

  // Anchor at the first vertex, then shift the origin so all vertices have
  // non-negative grid coordinates.
  const anchor: GridDefinition = {
    originLat: vertices[0].lat,
    originLon: vertices[0].lon,
    bearingDeg,
    cellSizeM,
  };
  let minU = Infinity;
  let minV = Infinity;
  for (const v of vertices) {
    const { u, v: vv } = toGridEN(anchor, v);
    if (u < minU) minU = u;
    if (vv < minV) minV = vv;
  }
  const th = (bearingDeg * Math.PI) / 180;
  const rowE = Math.sin(th);
  const rowN = Math.cos(th);
  const e = minU * rowE + minV * -rowN;
  const n = minU * rowN + minV * rowE;
  const origin = enuToLlh(
    { lat: vertices[0].lat, lon: vertices[0].lon, h: 0 },
    { e, n, u: 0 },
  );
  return { originLat: origin.lat, originLon: origin.lon, bearingDeg, cellSizeM };
}
