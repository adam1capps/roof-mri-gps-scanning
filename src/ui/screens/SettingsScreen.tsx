import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { TiltMode } from '../../core/gnss/gate';
import { clearTileSession } from '../../services/tileService';
import { useAppStore } from '../../state/useAppStore';
import { Field, SegmentedControl, Section, Toggle } from '../components';
import { colors, spacing } from '../theme';
import type { RootStackParamList } from '../navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'Settings'>;

function NumberField(props: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  decimals?: number;
}) {
  const [text, setText] = React.useState(String(props.value));
  React.useEffect(() => setText(String(props.value)), [props.value]);
  return (
    <Field
      label={props.label}
      value={text}
      keyboardType="decimal-pad"
      onChangeText={t => {
        setText(t);
        const v = parseFloat(t);
        if (Number.isFinite(v)) props.onChange(v);
      }}
    />
  );
}

export function SettingsScreen(_props: Props) {
  const store = useAppStore();
  const s = store.settings;

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: spacing(4) }}>
      <Section title="Point quality gate">
        <Text style={styles.hint}>
          Points are recorded only at RTK FIX with total 2D accuracy (GST sigma + tilt term)
          under this limit.
        </Text>
        <NumberField
          label="Max accuracy (m) — e.g. 0.03"
          value={s.maxHorizontalSigmaM}
          onChange={v => store.updateSettings({ maxHorizontalSigmaM: v })}
        />
        <NumberField
          label="Epochs averaged per point (1 = instant, 5 Hz)"
          value={s.averagingEpochs}
          onChange={v => store.updateSettings({ averagingEpochs: Math.max(1, Math.round(v)) })}
        />
        <Toggle
          label="Reject fast-motion epochs"
          value={s.rejectFastMotion}
          onChange={v => store.updateSettings({ rejectFastMotion: v })}
        />
      </Section>

      <Section title="Tilt compensation">
        <Text style={styles.hint}>
          Auto: apply compensation when the RX2 tilt engine reports Compensating (state 30);
          pass through when tilt is off. Require: reject points unless compensating.
          Level pole: always use the raw antenna position.
        </Text>
        <SegmentedControl<TiltMode>
          options={[
            { value: 'auto', label: 'Auto' },
            { value: 'require-compensated', label: 'Require' },
            { value: 'level-pole', label: 'Level pole' },
          ]}
          value={s.tiltMode}
          onChange={v => store.updateSettings({ tiltMode: v })}
        />
        <Text style={styles.hint} />
        <NumberField
          label="Pole height, tip → receiver bottom (m)"
          value={s.poleHeightM}
          onChange={v => store.updateSettings({ poleHeightM: v })}
        />
        <Text style={styles.hint}>
          +0.145 m bottom-to-antenna offset for the RX2 is added automatically.
        </Text>
      </Section>

      <Section title="Capture">
        <NumberField
          label="Snap-to-close radius (m)"
          value={s.snapRadiusM}
          onChange={v => store.updateSettings({ snapRadiusM: v })}
        />
        <SegmentedControl<'ft' | 'm'>
          options={[
            { value: 'ft', label: 'Feet / squares' },
            { value: 'm', label: 'Meters' },
          ]}
          value={s.units}
          onChange={v => store.updateSettings({ units: v })}
        />
      </Section>

      <Section title="Aerial basemap (Google Map Tiles API)">
        <Text style={styles.hint}>
          Create an API key in Google Cloud Console with “Map Tiles API” enabled. Tiles are
          loaded live and never cached offline; imagery is for visualization only — all
          measurements come from the RX2.
        </Text>
        <Field
          label="Google Maps API key"
          value={s.googleApiKey}
          onChangeText={v => {
            store.updateSettings({ googleApiKey: v.trim() });
            clearTileSession();
          }}
          placeholder="AIza…"
        />
      </Section>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  hint: { color: colors.textDim, fontSize: 12, marginBottom: spacing(1) },
});
