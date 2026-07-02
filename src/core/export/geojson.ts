import { RoofFeature, RoofProject } from '../capture/model';
import { featureStats, projectStats } from '../capture/session';

/**
 * GeoJSON export (RFC 7946: WGS84 lon/lat, right-hand-rule rings).
 * Open polygons are exported as LineStrings so nothing is silently invented.
 */

type Position = [number, number];

function coords(f: RoofFeature): Position[] {
  return f.vertices.map(v => [v.lon, v.lat] as Position);
}

function ccwRing(ring: Position[]): Position[] {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    sum += (x2 - x1) * (y2 + y1);
  }
  return sum > 0 ? [...ring].reverse() : ring;
}

function featureGeometry(f: RoofFeature): object | null {
  const c = coords(f);
  switch (f.kind) {
    case 'perimeter':
    case 'penetration': {
      if (f.closed && c.length >= 3) {
        const ring = ccwRing(c);
        return { type: 'Polygon', coordinates: [[...ring, ring[0]]] };
      }
      if (c.length >= 2) return { type: 'LineString', coordinates: c };
      if (c.length === 1) return { type: 'Point', coordinates: c[0] };
      return null;
    }
    case 'edge':
      if (c.length >= 2) return { type: 'LineString', coordinates: c };
      if (c.length === 1) return { type: 'Point', coordinates: c[0] };
      return null;
    case 'point':
      return c.length ? { type: 'Point', coordinates: c[0] } : null;
  }
}

export function projectToGeoJson(project: RoofProject): string {
  const stats = projectStats(project);
  const features = project.features
    .map(f => {
      const geometry = featureGeometry(f);
      if (!geometry) return null;
      const s = featureStats(f);
      return {
        type: 'Feature',
        geometry,
        properties: {
          name: f.name,
          kind: f.kind,
          closed: f.closed,
          vertex_count: s.vertexCount,
          area_m2: round(s.areaM2, 3),
          perimeter_m: round(s.perimeterM, 3),
          length_m: round(s.lengthM, 3),
          worst_accuracy_m: round(s.worstAccuracyM, 4),
        },
      };
    })
    .filter(Boolean);

  return JSON.stringify(
    {
      type: 'FeatureCollection',
      features,
      properties: {
        project: project.name,
        created_at: project.createdAt,
        gross_area_m2: round(stats.grossAreaM2, 3),
        penetration_area_m2: round(stats.penetrationAreaM2, 3),
        net_area_m2: round(stats.netAreaM2, 3),
        perimeter_m: round(stats.perimeterM, 3),
        source: 'Emlid Reach RX2 RTK (RTK FIX gated)',
      },
    },
    null,
    2,
  );
}

function round(n: number, d: number): number {
  const p = 10 ** d;
  return Math.round(n * p) / p;
}
