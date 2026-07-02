import {
  Camera,
  CircleLayer,
  FillLayer,
  LineLayer,
  MapView,
  ShapeSource,
} from '@maplibre/maplibre-react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { gnssController } from '../../app/GnssController';
import { FeatureKind } from '../../core/capture/model';
import { m2ToSqFt, m2ToSquares, mToFt } from '../../core/geo/measure';
import { fixQualityLabel, tiltStateLabel } from '../../core/gnss/gate';
import { FixQuality } from '../../core/nmea/types';
import { buildMapStyle } from '../../core/tiles/googleTiles';
import { ensureTileSession, refreshAttribution } from '../../services/tileService';
import {
  activeProject,
  activeProjectStats,
  useAppStore,
} from '../../state/useAppStore';
import { Pill, SegmentedControl } from '../components';
import { buildOverlays } from '../mapOverlays';
import { colors, spacing } from '../theme';
import type { RootStackParamList } from '../navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'Capture'>;

const KIND_OPTIONS: Array<{ value: FeatureKind; label: string; color: string }> = [
  { value: 'perimeter', label: 'Perimeter', color: colors.perimeter },
  { value: 'penetration', label: 'Penetr.', color: colors.penetration },
  { value: 'edge', label: 'Edge', color: colors.edge },
  { value: 'point', label: 'Point', color: colors.point },
];

export function CaptureScreen({ navigation }: Props) {
  const store = useAppStore();
  const project = activeProject(store);
  const stats = activeProjectStats(store);
  const mapRef = useRef<React.ComponentRef<typeof MapView>>(null);
  const cameraRef = useRef<React.ComponentRef<typeof Camera>>(null);
  const centeredOnce = useRef(false);
  const [styleJson, setStyleJson] = useState<object>(() => buildMapStyle(null));

  const apiKey = store.settings.googleApiKey.trim();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = await ensureTileSession();
      if (!cancelled) {
        setStyleJson(buildMapStyle(token && apiKey ? { session: token, apiKey } : null));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiKey]);

  const overlays = useMemo(
    () => buildOverlays(project, store.activeFeatureId),
    [project, store.activeFeatureId],
  );

  // Center on the roof: first captured vertex, else live RTK position.
  const focus = useMemo<[number, number] | null>(() => {
    const verts = project?.features.flatMap(f => f.vertices) ?? [];
    if (verts.length) return [verts[verts.length - 1].lon, verts[verts.length - 1].lat];
    const gga = store.lastEpoch?.gga;
    if (gga && Number.isFinite(gga.latitude)) return [gga.longitude, gga.latitude];
    return null;
  }, [project, store.lastEpoch]);

  useEffect(() => {
    if (focus && !centeredOnce.current && cameraRef.current) {
      centeredOnce.current = true;
      cameraRef.current.setCamera({
        centerCoordinate: focus,
        zoomLevel: 19,
        animationDuration: 400,
      });
    }
  }, [focus]);

  const onRegionDidChange = async () => {
    try {
      const map = mapRef.current;
      if (!map) return;
      const bounds = (await map.getVisibleBounds()) as [[number, number], [number, number]];
      const zoom = await map.getZoom();
      const [[east, north], [west, south]] = bounds;
      await refreshAttribution({
        north: Math.max(north, south),
        south: Math.min(north, south),
        east: Math.max(east, west),
        west: Math.min(east, west),
        zoom: Math.round(zoom),
      });
    } catch {
      // attribution refresh is best-effort
    }
  };

  // ---- capture state ----
  const gate = store.lastGate;
  const epoch = store.lastEpoch;
  const quality = epoch?.gga.quality;
  const fixColor =
    quality === FixQuality.RtkFix
      ? colors.fixRtk
      : quality === FixQuality.RtkFloat
        ? colors.fixFloat
        : colors.fixNone;

  const sigma = epoch?.gst
    ? Math.hypot(epoch.gst.sigmaLat, epoch.gst.sigmaLon)
    : NaN;
  const averaging = store.averaging;

  const activeFeature = project?.features.find(f => f.id === store.activeFeatureId);
  const isPolygonActive =
    activeFeature && (activeFeature.kind === 'perimeter' || activeFeature.kind === 'penetration');

  const unitArea = (m2: number) =>
    store.settings.units === 'ft'
      ? `${m2ToSqFt(m2).toFixed(0)} ft² (${m2ToSquares(m2).toFixed(1)} sq)`
      : `${m2.toFixed(1)} m²`;
  const unitLen = (m: number) =>
    store.settings.units === 'ft' ? `${mToFt(m).toFixed(1)} ft` : `${m.toFixed(1)} m`;

  const onCapture = () => {
    if (averaging) {
      gnssController.cancelCapture();
    } else {
      gnssController.capturePoint();
    }
  };

  const captureLabel = averaging
    ? `Averaging ${averaging.collected}/${averaging.target}… tap to cancel`
    : store.activeFeatureId
      ? 'Capture point'
      : `Capture point (new ${store.activeKind})`;

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        mapStyle={styleJson}
        rotateEnabled={false}
        pitchEnabled={false}
        attributionEnabled={false}
        logoEnabled={false}
        onRegionDidChange={onRegionDidChange}>
        <Camera ref={cameraRef} />

        <ShapeSource id="polygons" shape={overlays.polygons}>
          <FillLayer
            id="polygons-fill"
            style={{ fillColor: ['get', 'color'], fillOpacity: 0.25 }}
          />
          <LineLayer
            id="polygons-outline"
            style={{ lineColor: ['get', 'color'], lineWidth: 2.5 }}
          />
        </ShapeSource>

        <ShapeSource id="lines" shape={overlays.lines}>
          <LineLayer
            id="lines-line"
            style={{
              lineColor: ['get', 'color'],
              lineWidth: 2.5,
              lineDasharray: [2, 1],
            }}
          />
        </ShapeSource>

        <ShapeSource id="vertices" shape={overlays.vertices}>
          <CircleLayer
            id="vertices-circle"
            style={{
              circleRadius: ['case', ['get', 'snapTarget'], 9, 5],
              circleColor: ['get', 'color'],
              circleStrokeColor: '#0b0f14',
              circleStrokeWidth: 1.5,
              circleOpacity: 0.95,
            }}
          />
        </ShapeSource>
      </MapView>

      {/* Status strip */}
      <View style={styles.statusBar}>
        <Pill label="Fix" value={quality !== undefined ? fixQualityLabel(quality) : '—'} tone={fixColor} />
        <Pill
          label="σH"
          value={Number.isFinite(sigma) ? `${(sigma * 100).toFixed(1)} cm` : '—'}
          tone={Number.isFinite(sigma) && sigma <= store.settings.maxHorizontalSigmaM ? colors.fixRtk : colors.fixNone}
        />
        <Pill label="Sats" value={epoch ? String(epoch.gga.satellites) : '—'} />
        <Pill
          label="Tilt"
          value={epoch?.etc ? tiltStateLabel(epoch.etc.state) : '—'}
          tone={epoch?.etc?.state === 30 ? colors.fixRtk : colors.warning}
        />
        <Pill
          label="RTCM"
          value={store.ntripStatus?.phase === 'streaming' ? 'live' : store.ntripStatus?.phase ?? 'off'}
          tone={store.ntripStatus?.phase === 'streaming' ? colors.fixRtk : colors.warning}
        />
      </View>

      {gate && !gate.accepted && averaging && (
        <View style={styles.rejectBanner}>
          <Text style={styles.rejectText}>{gate.rejections.join(' · ')}</Text>
        </View>
      )}

      {/* Stats chip */}
      {stats && stats.grossAreaM2 > 0 && (
        <View style={styles.statsChip}>
          <Text style={styles.statsText}>
            Net {unitArea(stats.netAreaM2)} · Perimeter {unitLen(stats.perimeterM)}
          </Text>
        </View>
      )}

      {/* Attribution (required: keep visible, do not cover) */}
      <View style={styles.attribution} pointerEvents="none">
        <Text style={styles.attributionLogo}>
          {store.tileSessionToken ? 'Google' : 'OpenStreetMap'}
        </Text>
        <Text style={styles.attributionText}>
          {store.tileSessionToken
            ? store.mapAttribution || 'Map data ©Google'
            : '© OpenStreetMap contributors'}
        </Text>
      </View>

      {/* Controls */}
      <View style={styles.controls}>
        <SegmentedControl
          options={KIND_OPTIONS}
          value={store.activeKind}
          onChange={k => store.setActiveKind(k)}
        />
        <View style={styles.buttonRow}>
          <TouchableOpacity style={styles.sideButton} onPress={() => store.undoActiveVertex()}>
            <Text style={styles.sideButtonText}>Undo</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.captureButton, averaging ? styles.captureActive : null]}
            onPress={onCapture}>
            <Text style={styles.captureText}>{captureLabel}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.sideButton, !isPolygonActive && { opacity: 0.4 }]}
            disabled={!isPolygonActive}
            onPress={() => store.closeActiveRing()}>
            <Text style={styles.sideButtonText}>Close</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.navRow}>
          <TouchableOpacity onPress={() => navigation.navigate('Connect')}>
            <Text style={styles.navLink}>Receiver</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate('Settings')}>
            <Text style={styles.navLink}>Settings</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate('Export')}>
            <Text style={styles.navLink}>Export</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  statusBar: {
    position: 'absolute',
    top: spacing(6),
    left: spacing(1),
    right: spacing(1),
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  rejectBanner: {
    position: 'absolute',
    top: spacing(11),
    alignSelf: 'center',
    backgroundColor: 'rgba(255,107,107,0.92)',
    borderRadius: 8,
    paddingHorizontal: spacing(1.5),
    paddingVertical: spacing(0.5),
    maxWidth: '90%',
  },
  rejectText: { color: '#1c0606', fontWeight: '700', fontSize: 12 },
  statsChip: {
    position: 'absolute',
    top: spacing(15),
    alignSelf: 'center',
    backgroundColor: 'rgba(11,15,20,0.85)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing(1.5),
    paddingVertical: spacing(0.5),
  },
  statsText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  attribution: {
    position: 'absolute',
    right: spacing(1),
    bottom: 170,
    alignItems: 'flex-end',
  },
  attributionLogo: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
    textShadowColor: '#000',
    textShadowRadius: 3,
  },
  attributionText: {
    color: '#ffffff',
    fontSize: 9,
    textShadowColor: '#000',
    textShadowRadius: 3,
  },
  controls: {
    position: 'absolute',
    left: spacing(1),
    right: spacing(1),
    bottom: spacing(2),
    backgroundColor: 'rgba(11,15,20,0.88)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing(1.5),
  },
  buttonRow: { flexDirection: 'row', marginTop: spacing(1.5), alignItems: 'stretch' },
  captureButton: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: spacing(2),
    marginHorizontal: spacing(1),
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureActive: { backgroundColor: colors.warning },
  captureText: { color: '#06130d', fontWeight: '800', fontSize: 15, textAlign: 'center' },
  sideButton: {
    backgroundColor: colors.surfaceHigh,
    borderRadius: 12,
    paddingHorizontal: spacing(1.5),
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  sideButtonText: { color: colors.text, fontWeight: '700', fontSize: 13 },
  navRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: spacing(1.5),
  },
  navLink: { color: colors.info, fontWeight: '600', fontSize: 14 },
});
