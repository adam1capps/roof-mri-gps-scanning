import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useState } from 'react';
import {
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { moistureStats } from '../../core/capture/moisture';
import { projectStats } from '../../core/capture/session';
import { m2ToSqFt, m2ToSquares, mToFt } from '../../core/geo/measure';
import { capturePhoto } from '../../services/photos';
import { submitReportRequest } from '../../services/report';
import { activeProject, useAppStore } from '../../state/useAppStore';
import { Button, Row, Section } from '../components';
import { moistureColor } from '../moistureScale';
import { colors, spacing } from '../theme';
import type { RootStackParamList } from '../navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'ScanSummary'>;

function formatDuration(s: number): string {
  if (!Number.isFinite(s)) return '—';
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m} min`;
}

export function ScanSummaryScreen({ navigation }: Props) {
  const store = useAppStore();
  const project = activeProject(store);
  const [busy, setBusy] = useState(false);

  if (!project) {
    return (
      <ScrollView style={styles.container}>
        <Section title="Scan summary">
          <Text style={styles.dim}>No active roof.</Text>
        </Section>
      </ScrollView>
    );
  }

  const geo = projectStats(project);
  const m = moistureStats(project);
  const ft = store.settings.units === 'ft';
  const photos = project.photos ?? [];
  const maxBar = Math.max(1, ...m.histogram.slice(1));

  const takePhoto = async (kind: 'photo' | 'core-sample') => {
    const photo = await capturePhoto(kind);
    if (!photo) Alert.alert('Camera', 'No photo captured.');
  };

  const submit = async () => {
    setBusy(true);
    try {
      const result = await submitReportRequest(project);
      const webhookNote = store.settings.reportWebhookUrl.trim()
        ? result.webhookDelivered
          ? 'Delivered to the report team intake.'
          : `Webhook failed (${result.webhookError}) — package shared instead; files are saved on this device.`
        : 'Share the package with the report team (webhook not configured).';
      Alert.alert('Report request submitted', webhookNote, [
        { text: 'OK', onPress: () => navigation.navigate('Projects') },
      ]);
    } catch (e) {
      Alert.alert('Submission failed', String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: spacing(4) }}>
      <Section title={`Preview — ${project.name}`}>
        <Text style={styles.stat}>
          Net roof area:{' '}
          {ft
            ? `${m2ToSqFt(geo.netAreaM2).toFixed(0)} ft² (${m2ToSquares(geo.netAreaM2).toFixed(1)} squares)`
            : `${geo.netAreaM2.toFixed(1)} m²`}
        </Text>
        <Text style={styles.stat}>
          Perimeter: {ft ? `${mToFt(geo.perimeterM).toFixed(0)} ft` : `${geo.perimeterM.toFixed(1)} m`}
        </Text>
        <Text style={styles.stat}>
          Moisture readings: {m.totalReadings} ({m.wetReadings} wet, max {m.maxValue}/10)
        </Text>
        {m.wetCells > 0 && (
          <Text style={[styles.stat, { color: colors.warning }]}>
            Wet area: {m.wetCells} squares ·{' '}
            {ft ? `${m2ToSqFt(m.wetCellAreaM2).toFixed(0)} ft²` : `${m.wetCellAreaM2.toFixed(1)} m²`}
          </Text>
        )}
        <Text style={styles.stat}>
          Scan time: {formatDuration(m.scanDurationS)}
          {Number.isFinite(m.readingsPerHour) ? ` · ${m.readingsPerHour.toFixed(0)} readings/hr` : ''}
        </Text>
        {project.reportSubmittedAt && (
          <Text style={[styles.dim, { color: colors.primary }]}>
            Report request already submitted {new Date(project.reportSubmittedAt).toLocaleString()}
          </Text>
        )}
      </Section>

      {m.totalReadings > 0 && (
        <Section title="Moisture distribution">
          {m.histogram.map((count, value) =>
            value === 0 ? null : (
              <Row key={value} style={{ marginBottom: 4 }}>
                <Text style={styles.histLabel}>{value}</Text>
                <View style={styles.histTrack}>
                  <View
                    style={[
                      styles.histBar,
                      {
                        backgroundColor: moistureColor(value),
                        width: `${Math.max(2, (count / maxBar) * 100)}%` as never,
                        opacity: count === 0 ? 0.15 : 1,
                      },
                    ]}
                  />
                </View>
                <Text style={styles.histCount}>{count}</Text>
              </Row>
            ),
          )}
          {m.histogram[0] > 0 && (
            <Text style={styles.dim}>{m.histogram[0]} verified-dry readings (0)</Text>
          )}
        </Section>
      )}

      <Section title={`Photos (${photos.length})`}>
        <Row>
          <Button
            title="Add roof photo"
            tone="neutral"
            onPress={() => takePhoto('photo')}
            style={{ flex: 1, marginRight: spacing(1) }}
          />
          <Button
            title="Add core sample"
            tone="neutral"
            onPress={() => takePhoto('core-sample')}
            style={{ flex: 1 }}
          />
        </Row>
        <View style={styles.photoGrid}>
          {photos.map(p => (
            <TouchableOpacity
              key={p.id}
              style={styles.photoCell}
              onLongPress={() =>
                Alert.alert('Remove photo?', undefined, [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Remove', style: 'destructive', onPress: () => store.removePhoto(p.id) },
                ])
              }>
              <Image source={{ uri: `file://${p.path}` }} style={styles.photoImg} />
              {p.kind === 'core-sample' && <Text style={styles.coreTag}>CORE</Text>}
            </TouchableOpacity>
          ))}
        </View>
      </Section>

      <Section title="Notes for the report team">
        <TextInput
          style={styles.notes}
          multiline
          value={project.notes ?? ''}
          onChangeText={t => store.setProjectNotes(t)}
          placeholder="Deck type, membrane, access notes, suspected sources…"
          placeholderTextColor={colors.textDim}
        />
      </Section>

      <Section title="Finalize">
        <Button
          title={project.reportSubmittedAt ? 'Resubmit report request' : 'Submit report request'}
          busy={busy}
          onPress={submit}
        />
        <Text style={styles.dim}>
          Sends the manifest to the Report Creation Team intake
          {store.settings.reportWebhookUrl.trim() ? '' : ' (webhook not set — Settings)'} and opens
          the share sheet with the full package (data + photos) for{' '}
          {store.settings.reportEmail || 'your report team'}.
        </Text>
      </Section>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  stat: { color: colors.text, fontSize: 15, fontWeight: '600', marginBottom: 4 },
  dim: { color: colors.textDim, fontSize: 12, marginTop: 4 },
  histLabel: { color: colors.text, width: 22, fontSize: 13, fontWeight: '700' },
  histTrack: { flex: 1, height: 16, borderRadius: 4, overflow: 'hidden' },
  histBar: { height: 16, borderRadius: 4 },
  histCount: { color: colors.textDim, width: 34, fontSize: 12, textAlign: 'right' },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing(1) },
  photoCell: { width: '31%', aspectRatio: 1, margin: '1%', borderRadius: 8, overflow: 'hidden' },
  photoImg: { width: '100%', height: '100%' },
  coreTag: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    backgroundColor: colors.warning,
    color: '#06130d',
    fontSize: 9,
    fontWeight: '800',
    paddingHorizontal: 4,
    borderRadius: 3,
  },
  notes: {
    backgroundColor: colors.surfaceHigh,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    padding: spacing(1.5),
    minHeight: 90,
    textAlignVertical: 'top',
  },
});
