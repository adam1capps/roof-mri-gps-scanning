import type { Feature, FeatureCollection, LineString, Point, Polygon } from 'geojson';
import { RoofFeature, RoofProject } from '../core/capture/model';
import { colors } from './theme';

/**
 * Builds the GeoJSON fed to MapLibre ShapeSources: captured geometry rendered
 * over the aerial basemap. Split into three collections so fills, lines and
 * vertices can be styled independently.
 */

export interface OverlayShapes {
  polygons: FeatureCollection<Polygon>;
  lines: FeatureCollection<LineString>;
  vertices: FeatureCollection<Point>;
}

const KIND_COLOR: Record<string, string> = {
  perimeter: colors.perimeter,
  penetration: colors.penetration,
  edge: colors.edge,
  point: colors.point,
};

function ring(f: RoofFeature): number[][] {
  const c = f.vertices.map(v => [v.lon, v.lat]);
  return [...c, c[0]];
}

export function buildOverlays(
  project: RoofProject | null,
  activeFeatureId: string | null,
): OverlayShapes {
  const polygons: Array<Feature<Polygon>> = [];
  const lines: Array<Feature<LineString>> = [];
  const vertices: Array<Feature<Point>> = [];

  for (const f of project?.features ?? []) {
    const color = KIND_COLOR[f.kind] ?? colors.info;
    const isActive = f.id === activeFeatureId;
    const coords = f.vertices.map(v => [v.lon, v.lat]);

    if ((f.kind === 'perimeter' || f.kind === 'penetration') && f.closed && coords.length >= 3) {
      polygons.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [ring(f)] },
        properties: { color, kind: f.kind },
      });
    } else if (coords.length >= 2) {
      lines.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: coords },
        properties: { color, active: isActive },
      });
    }

    f.vertices.forEach((v, i) => {
      vertices.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [v.lon, v.lat] },
        properties: {
          color,
          // First vertex of the active open polygon = the snap target.
          snapTarget:
            isActive &&
            !f.closed &&
            i === 0 &&
            (f.kind === 'perimeter' || f.kind === 'penetration') &&
            f.vertices.length >= 3,
        },
      });
    });
  }

  return {
    polygons: { type: 'FeatureCollection', features: polygons },
    lines: { type: 'FeatureCollection', features: lines },
    vertices: { type: 'FeatureCollection', features: vertices },
  };
}
