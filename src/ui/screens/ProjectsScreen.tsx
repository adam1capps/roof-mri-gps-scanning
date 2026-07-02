import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useState } from 'react';
import {
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { projectStats } from '../../core/capture/session';
import { m2ToSqFt } from '../../core/geo/measure';
import { useAppStore } from '../../state/useAppStore';
import { Button } from '../components';
import { colors, spacing } from '../theme';
import type { RootStackParamList } from '../navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'Projects'>;

export function ProjectsScreen({ navigation }: Props) {
  const store = useAppStore();
  const [name, setName] = useState('');

  const create = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    store.createNewProject(trimmed);
    setName('');
    navigation.navigate('Capture');
  };

  const open = (id: string) => {
    store.setActiveProject(id);
    navigation.navigate('Capture');
  };

  const remove = (id: string, projectName: string) => {
    Alert.alert('Delete roof?', `"${projectName}" and all captured points will be removed.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => store.removeProject(id) },
    ]);
  };

  return (
    <View style={styles.container}>
      <View style={styles.newRow}>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="New roof name (e.g. Walmart DC #4521)"
          placeholderTextColor={colors.textDim}
          onSubmitEditing={create}
          returnKeyType="go"
        />
        <Button title="Start" onPress={create} disabled={!name.trim()} style={styles.startBtn} />
      </View>

      <FlatList
        data={store.projects}
        keyExtractor={p => p.id}
        contentContainerStyle={{ padding: spacing(2) }}
        ListEmptyComponent={
          <Text style={styles.empty}>
            No roofs yet. Name one above and start capturing.{'\n\n'}
            Checklist: ① connect the RX2 (Receiver tab) ② corrections streaming (Emlid Flow
            or NTRIP) ③ wait for RTK FIX ④ walk the roof.
          </Text>
        }
        renderItem={({ item }) => {
          const stats = projectStats(item);
          const ft = store.settings.units === 'ft';
          return (
            <TouchableOpacity
              style={styles.card}
              onPress={() => open(item.id)}
              onLongPress={() => remove(item.id, item.name)}>
              <Text style={styles.cardTitle}>{item.name}</Text>
              <Text style={styles.cardSub}>
                {item.features.length} features ·{' '}
                {stats.netAreaM2 > 0
                  ? ft
                    ? `${m2ToSqFt(stats.netAreaM2).toFixed(0)} ft² net`
                    : `${stats.netAreaM2.toFixed(1)} m² net`
                  : 'no area yet'}
              </Text>
              <Text style={styles.cardDate}>
                {new Date(item.updatedAt).toLocaleString()} · long-press to delete
              </Text>
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  newRow: {
    flexDirection: 'row',
    padding: spacing(2),
    alignItems: 'center',
  },
  input: {
    flex: 1,
    backgroundColor: colors.surfaceHigh,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    paddingHorizontal: spacing(1.5),
    paddingVertical: spacing(1.25),
    fontSize: 15,
    marginRight: spacing(1),
  },
  startBtn: { marginTop: 0, paddingHorizontal: spacing(2.5) },
  empty: { color: colors.textDim, textAlign: 'center', marginTop: spacing(6), lineHeight: 20 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing(2),
    marginBottom: spacing(1.5),
  },
  cardTitle: { color: colors.text, fontSize: 17, fontWeight: '700' },
  cardSub: { color: colors.primary, fontSize: 13, fontWeight: '600', marginTop: 4 },
  cardDate: { color: colors.textDim, fontSize: 11, marginTop: 4 },
});
