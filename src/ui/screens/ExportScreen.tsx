import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text } from 'react-native';
import { projectStats } from '../../core/capture/session';
import { m2ToSqFt, m2ToSquares, mToFt } from '../../core/geo/measure';
import { exportProject, shareFiles } from '../../services/exporter';
import { activeProject, useAppStore } from '../../state/useAppStore';
import { Button, SegmentedControl, Section, Toggle } from '../components';
import { colors, spacing } from '../theme';
import type { RootStackParamList } from '../navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'Export'>;

export function ExportScreen(_props: Props) {
  const store = useAppStore();
  const project = activeProject(store);
  const [csv, setCsv] = useState(true);
  const [geojson, setGeojson] = useState(true);
  const [dxf, setDxf] = useState(true);
  const [shp, setShp] = useState(false);
  const [dxfCrs, setDxfCrs] = useState<'local' | 'utm'>('local');
  const [dxfUnits, setDxfUnits] = useState<'m' | 'ft'>(store.settings.units === 'ft' ? 'ft' : 'm');
  const [busy, setBusy] = useState(false);

  if (!project) {
    return (
      <ScrollView style={styles.container}>
        <Section title="Export">
          <Text style={styles.dim}>No active project. Open a roof first.</Text>
        </Section>
      </ScrollView>
    );
  }

  const stats = projectStats(project);
  const ft = store.settings.units === 'ft';

  const run = async () => {
    setBusy(true);
    try {
      const result = await exportProject(project, {
        csv,
        geojson,
        dxf,
        shp,
        dxfOptions: { crs: dxfCrs, units: dxfUnits },
      });
      if (result.files.length === 0) {
        Alert.alert('Nothing selected', 'Pick at least one format.');
        return;
      }
      await shareFiles(result.files);
    } catch (e) {
      Alert.alert('Export failed', String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: spacing(4) }}>
      <Section title={`Summary — ${project.name}`}>
        <Text style={styles.stat}>
          Gross area: {ft ? `${m2ToSqFt(stats.grossAreaM2).toFixed(0)} ft²` : `${stats.grossAreaM2.toFixed(1)} m²`}
        </Text>
        <Text style={styles.stat}>
          Penetrations: −{ft ? `${m2ToSqFt(stats.penetrationAreaM2).toFixed(0)} ft²` : `${stats.penetrationAreaM2.toFixed(1)} m²`}
        </Text>
        <Text style={[styles.stat, { color: colors.primary }]}>
          Net area: {ft
            ? `${m2ToSqFt(stats.netAreaM2).toFixed(0)} ft²  (${m2ToSquares(stats.netAreaM2).toFixed(1)} squares)`
            : `${stats.netAreaM2.toFixed(1)} m²`}
        </Text>
        <Text style={styles.stat}>
          Perimeter: {ft ? `${mToFt(stats.perimeterM).toFixed(1)} ft` : `${stats.perimeterM.toFixed(1)} m`}
        </Text>
        {stats.features.map(f => (
          <Text key={f.featureId} style={styles.dim}>
            {f.name}: {f.vertexCount} pts
            {f.areaM2 > 0 ? ` · ${ft ? `${m2ToSqFt(f.areaM2).toFixed(0)} ft²` : `${f.areaM2.toFixed(1)} m²`}` : ''}
            {f.lengthM > 0 ? ` · ${ft ? `${mToFt(f.lengthM).toFixed(1)} ft` : `${f.lengthM.toFixed(1)} m`}` : ''}
            {f.worstAccuracyM > 0 ? ` · worst ±${(f.worstAccuracyM * 100).toFixed(1)} cm` : ''}
          </Text>
        ))}
      </Section>

      <Section title="Formats">
        <Toggle label="CSV (points: lat/lon/accuracy/time)" value={csv} onChange={setCsv} />
        <Toggle label="GeoJSON (WGS84)" value={geojson} onChange={setGeojson} />
        <Toggle label="DXF (CAD)" value={dxf} onChange={setDxf} />
        <Toggle label="Shapefile (SHP/SHX/DBF/PRJ)" value={shp} onChange={setShp} />
      </Section>

      {dxf && (
        <Section title="DXF options">
          <Text style={styles.dim}>Coordinate system</Text>
          <SegmentedControl<'local' | 'utm'>
            options={[
              { value: 'local', label: 'Local (site) meters' },
              { value: 'utm', label: 'UTM georeferenced' },
            ]}
            value={dxfCrs}
            onChange={setDxfCrs}
          />
          <Text style={[styles.dim, { marginTop: spacing(1) }]}>Units</Text>
          <SegmentedControl<'m' | 'ft'>
            options={[
              { value: 'm', label: 'Meters' },
              { value: 'ft', label: 'Feet' },
            ]}
            value={dxfUnits}
            onChange={setDxfUnits}
          />
        </Section>
      )}

      <Section title="Export">
        <Button title="Generate & share" busy={busy} onPress={run} />
        <Text style={styles.dim}>
          Files are written to the app documents folder and offered via the share sheet
          (AirDrop, Drive, email…).
        </Text>
      </Section>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  stat: { color: colors.text, fontSize: 15, fontWeight: '600', marginBottom: 4 },
  dim: { color: colors.textDim, fontSize: 12, marginTop: 4 },
});
