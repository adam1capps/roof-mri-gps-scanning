import { createProject } from '../../src/core/capture/model';
import {
  addVertex,
  closeFeature,
  featureStats,
  gatedPointToVertex,
  projectStats,
  startFeature,
  undoVertex,
} from '../../src/core/capture/session';
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
    tiltValueDeg: 3,
    gpsTime: '120000.00',
    receivedAt: 0,
  };
}

const v = (e: number, n: number) => gatedPointToVertex(pointAt(e, n), 5);

describe('capture session', () => {
  it('builds a perimeter, snaps closed near the first vertex, and measures it', () => {
    let { project, feature } = startFeature(createProject('Test Roof'), 'perimeter');

    for (const [e, n] of [
      [0, 0],
      [20, 0],
      [20, 10],
      [0, 10],
    ]) {
      const r = addVertex(project, feature.id, v(e, n), 0.25);
      project = r.project;
      expect(r.closedRing).toBe(false);
    }

    // Tap again within 25 cm of the first corner → ring closes, no 5th vertex.
    const r = addVertex(project, feature.id, v(0.1, 0.05), 0.25);
    expect(r.closedRing).toBe(true);
    project = r.project;

    const f = project.features[0];
    expect(f.closed).toBe(true);
    expect(f.vertices).toHaveLength(4);

    const stats = featureStats(f);
    expect(stats.areaM2).toBeCloseTo(200, 2);
    expect(stats.perimeterM).toBeCloseTo(60, 3);
    expect(stats.worstAccuracyM).toBeCloseTo(0.009);
  });

  it('does not snap-close before 3 vertices exist', () => {
    let { project, feature } = startFeature(createProject('T'), 'perimeter');
    project = addVertex(project, feature.id, v(0, 0)).project;
    const r = addVertex(project, feature.id, v(0.05, 0), 0.25);
    expect(r.closedRing).toBe(false);
    expect(r.project.features[0].vertices).toHaveLength(2);
  });

  it('undo removes the last vertex; after closing it re-opens the ring', () => {
    let { project, feature } = startFeature(createProject('T'), 'perimeter');
    for (const [e, n] of [[0, 0], [10, 0], [10, 10]]) {
      project = addVertex(project, feature.id, v(e, n)).project;
    }
    project = closeFeature(project, feature.id);
    expect(project.features[0].closed).toBe(true);

    project = undoVertex(project, feature.id);
    expect(project.features[0].closed).toBe(false);
    expect(project.features[0].vertices).toHaveLength(3);

    project = undoVertex(project, feature.id);
    expect(project.features[0].vertices).toHaveLength(2);
  });

  it('point features hold exactly one vertex (re-capture replaces)', () => {
    let { project, feature } = startFeature(createProject('T'), 'point');
    project = addVertex(project, feature.id, v(1, 1)).project;
    project = addVertex(project, feature.id, v(2, 2)).project;
    expect(project.features[0].vertices).toHaveLength(1);
  });

  it('net area subtracts penetrations from perimeters', () => {
    let project = createProject('Warehouse');

    let r = startFeature(project, 'perimeter');
    project = r.project;
    for (const [e, n] of [[0, 0], [50, 0], [50, 40], [0, 40]]) {
      project = addVertex(project, r.feature.id, v(e, n)).project;
    }
    project = closeFeature(project, r.feature.id);

    r = startFeature(project, 'penetration');
    project = r.project;
    for (const [e, n] of [[10, 10], [14, 10], [14, 15], [10, 15]]) {
      project = addVertex(project, r.feature.id, v(e, n)).project;
    }
    project = closeFeature(project, r.feature.id);

    const stats = projectStats(project);
    expect(stats.grossAreaM2).toBeCloseTo(2000, 1);
    expect(stats.penetrationAreaM2).toBeCloseTo(20, 2);
    expect(stats.netAreaM2).toBeCloseTo(1980, 1);
    expect(stats.perimeterM).toBeCloseTo(180, 2);
  });
});
