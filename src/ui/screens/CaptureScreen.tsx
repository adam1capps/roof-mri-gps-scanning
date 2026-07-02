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
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { gnssController } from '../../app/GnssController';
import { FeatureKind } from '../../core/capture/model';
import { ReadingMode } from '../../core/capture/moisture';
import { m2ToSqFt, m2ToSquares, mToFt } from '../../core/geo/measure';
import { fixQualityLabel, tiltStateLabel } from '../../core/gnss/gate';
import { FixQuality } from '../../core/nmea/types';
import { buildMapStyle } from '../../core/tiles/googleTiles';
import { ensureTileSession, refreshAttribution } from '../../services/tileService';
import { startVoiceCapture, stopVoiceCapture } from '../../services/voice';
import {
  activeProject,
  activeProjectStats,
  useAppStore,
} from '../../state/useAppStore';
import { MoistureKeypad } from '../components/MoistureKeypad';
import { Pill, SegmentedControl } from '../components';
import { buildMoistureOverlays, buildOverlays } from '../mapOverlays';
import { moistureColorExpression } from '../moistureScale';
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
  const [flash, setFlash] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
  const moisture = useMemo(() => buildMoistureOverlays(project), [project]);

  // Center on the roof: last captured vertex/reading, else live RTK position.
  const focus = useMemo<[number, number] | null>(() => {
    const readings = project?.readings ?? [];
    if (readings.length) {
      const r = readings[readings.length - 1];
      return [r.lon, r.lat];
    }
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

  const showFlash = (message: string, error = false) => {
    setFlash(`${error ? '✕ ' : ''}${message}`);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 2000);
  };

  // ---- live status ----
  const gate = store.lastGate;
  const epoch = store.lastEpoch;
  const quality = epoch?.gga.quality;
  const fixColor =
    quality === FixQuality.RtkFix
      ? colors.fixRtk
      : quality === FixQuality.RtkFloat
        ? colors.fixFloat
        : colors.fixNone;

  const sigma = epoch?.gst ? Math.hypot(epoch.gst.sigmaLat, epoch.gst.sigmaLon) : NaN;
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

  // ---- layout mode actions ----
  const onCapture = () => {
    if (averaging) gnssController.cancelCapture();
    else gnssController.capturePoint();
  };

  const captureLabel = averaging
    ? `Averaging ${averaging.collected}/${averaging.target}… tap to cancel`
    : store.activeFeatureId
      ? 'Capture point'
      : `Capture point (new ${store.activeKind})`;

  // ---- scan mode actions ----
  const onReading = (value: number) => {
    const error = gnssController.captureReading(value, 'keypad');
    if (error) showFlash(error, true);
    else showFlash(`${value} recorded`);
  };

  const toggleMic = async () => {
    if (store.voiceActive) {
      await stopVoiceCapture();
    } else {
      const ok = await startVoiceCapture();
      if (!ok) showFlash('Microphone unavailable', true);
    }
  };

  const onGrid = () => {
    const hasGrid = !!project?.grid;
    const calibrating = !!store.gridCalibrationOrigin;
    const point = store.lastPoint;
    const fresh = point && Date.now() - point.receivedAt < 3000;

    if (calibrating) {
      if (!fresh) return showFlash('Need RTK FIX to mark the row point', true);
      const ok = store.finishGridCalibration({ lat: point!.lat, lon: point!.lon });
      showFlash(ok ? 'Grid calibrated' : 'Calibration failed', !ok);
      return;
    }

    Alert.alert('Scan grid', hasGrid ? 'Grid is set.' : 'No grid yet.', [
      {
        text: 'Instant grid (from traced section)',
        onPress: () => {
          const ok = store.instantGridFromSection();
          showFlash(ok ? 'Instant grid set' : 'Trace + close a perimeter first', !ok);
        },
      },
      {
        text: 'Calibrate: mark grid origin (stand on corner)',
        onPress: () => {
          if (!fresh) return showFlash('Need RTK FIX to mark the origin', true);
          store.setGridCalibrationOrigin({ lat: point!.lat, lon: point!.lon });
          showFlash('Origin set — walk along the row, tap Grid again');
        },
      },
      ...(hasGrid
        ? [{ text: 'Clear grid', style: 'destructive' as const, onPress: () => store.setGrid(null) }]
        : []),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  };

  const onFinishScan = () => {
    stopVoiceCapture();
    store.finishActiveScan();
    navigation.navigate('ScanSummary');
  };

  const cellSizeFt = Math.round(mToFt(store.settings.cellSizeM));

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

        {/* Moisture cells under the geometry so section outlines stay visible */}
        <ShapeSource id="moisture-cells" shape={moisture.cells}>
          <FillLayer
            id="moisture-cells-fill"
            style={{
              fillColor: moistureColorExpression() as never,
              fillOpacity: ['case', ['get', 'dry'], 0.12, 0.55] as never,
            }}
          />
          <LineLayer
            id="moisture-cells-outline"
            style={{ lineColor: '#ffffff', lineWidth: 0.8, lineOpacity: 0.7 }}
          />
        </ShapeSource>

        <ShapeSource id="polygons" shape={overlays.polygons}>
          <FillLayer
            id="polygons-fill"
            style={{ fillColor: ['get', 'color'], fillOpacity: 0.12 }}
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

        <ShapeSource id="moisture-readings" shape={moisture.readings}>
          <CircleLayer
            id="moisture-readings-circle"
            style={{
              circleRadius: 6,
              circleColor: moistureColorExpression() as never,
              circleOpacity: ['case', ['get', 'dry'], 0.35, 0.95] as never,
              circleStrokeColor: '#ffffff',
              circleStrokeWidth: 2,
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
        {store.scanMode && (
          <Pill
            label="Readings"
            value={String(project?.readings?.length ?? 0)}
            tone={colors.info}
          />
        )}
      </View>

      {flash && (
        <View style={[styles.flashBanner, flash.startsWith('✕') && styles.flashError]}>
          <Text style={styles.flashText}>{flash}</Text>
        </View>
      )}
      {!flash && gate && !gate.accepted && averaging && (
        <View style={[styles.flashBanner, styles.flashError]}>
          <Text style={styles.flashText}>{gate.rejections.join(' · ')}</Text>
        </View>
      )}
      {store.scanMode && store.voiceActive && store.lastVoiceHeard && (
        <View style={styles.voiceChip}>
          <Text style={styles.voiceText}>🎤 {store.lastVoiceHeard}</Text>
        </View>
      )}

      {/* Stats chip */}
      {stats && stats.grossAreaM2 > 0 && !store.scanMode && (
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
        <SegmentedControl<'layout' | 'scan'>
          options={[
            { value: 'layout', label: 'Layout' },
            { value: 'scan', label: 'Scan moisture', color: colors.info },
          ]}
          value={store.scanMode ? 'scan' : 'layout'}
          onChange={m => store.setScanMode(m === 'scan')}
        />

        {store.scanMode ? (
          <>
            <View style={{ marginTop: spacing(1) }}>
              <SegmentedControl<ReadingMode>
                options={[
                  { value: 'precise', label: 'Precise spot' },
                  { value: 'cell', label: `${cellSizeFt}×${cellSizeFt} ft square` },
                ]}
                value={store.settings.readingMode}
                onChange={v => store.updateSettings({ readingMode: v })}
              />
            </View>
            {store.settings.readingMode === 'cell' && !project?.grid && (
              <Text style={styles.gridHint}>
                No grid set — readings will pin the exact spot until you set one.
              </Text>
            )}
            <View style={{ marginTop: spacing(1) }}>
              <MoistureKeypad
                onValue={onReading}
                onMicToggle={toggleMic}
                micActive={store.voiceActive}
                onUndo={() => {
                  store.undoLastReading();
                  showFlash('Reading removed');
                }}
              />
            </View>
            <View style={styles.buttonRow}>
              <TouchableOpacity style={styles.sideButton} onPress={onGrid}>
                <Text style={styles.sideButtonText}>
                  {store.gridCalibrationOrigin ? 'Grid: mark row →' : 'Grid'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.finishButton} onPress={onFinishScan}>
                <Text style={styles.captureText}>Finish scan</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : (
          <>
            <View style={{ marginTop: spacing(1) }}>
              <SegmentedControl
                options={KIND_OPTIONS}
                value={store.activeKind}
                onChange={k => store.setActiveKind(k)}
              />
            </View>
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
          </>
        )}

        <View style={styles.navRow}>
          <TouchableOpacity onPress={() => navigation.navigate('Connect')}>
            <Text style={styles.navLink}>Receiver</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate('Settings')}>
            <Text style={styles.navLink}>Settings</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate('ScanSummary')}>
            <Text style={styles.navLink}>Summary</Text>
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
  flashBanner: {
    position: 'absolute',
    top: spacing(11),
    alignSelf: 'center',
    backgroundColor: 'rgba(0,229,160,0.92)',
    borderRadius: 8,
    paddingHorizontal: spacing(1.5),
    paddingVertical: spacing(0.5),
    maxWidth: '90%',
  },
  flashError: { backgroundColor: 'rgba(255,107,107,0.92)' },
  flashText: { color: '#06130d', fontWeight: '700', fontSize: 13 },
  voiceChip: {
    position: 'absolute',
    top: spacing(14),
    alignSelf: 'center',
    backgroundColor: 'rgba(11,15,20,0.85)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing(1.5),
    paddingVertical: spacing(0.5),
    maxWidth: '90%',
  },
  voiceText: { color: colors.text, fontSize: 12 },
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
  gridHint: { color: colors.warning, fontSize: 11, marginTop: spacing(0.5) },
  buttonRow: { flexDirection: 'row', marginTop: spacing(1), alignItems: 'stretch' },
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
  finishButton: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: spacing(1.5),
    marginLeft: spacing(1),
    alignItems: 'center',
    justifyContent: 'center',
  },
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
