import React from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import { colors, spacing } from './theme';

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

export function Field(props: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'numeric' | 'url' | 'number-pad' | 'decimal-pad';
  secureTextEntry?: boolean;
  autoCapitalize?: 'none' | 'sentences';
}) {
  return (
    <View style={styles.fieldRow}>
      <Text style={styles.fieldLabel}>{props.label}</Text>
      <TextInput
        style={styles.fieldInput}
        value={props.value}
        onChangeText={props.onChangeText}
        placeholder={props.placeholder}
        placeholderTextColor={colors.textDim}
        keyboardType={props.keyboardType ?? 'default'}
        secureTextEntry={props.secureTextEntry}
        autoCapitalize={props.autoCapitalize ?? 'none'}
        autoCorrect={false}
      />
    </View>
  );
}

export function Button(props: {
  title: string;
  onPress: () => void;
  tone?: 'primary' | 'neutral' | 'danger';
  disabled?: boolean;
  busy?: boolean;
  style?: ViewStyle;
}) {
  const tone = props.tone ?? 'primary';
  const bg =
    tone === 'primary' ? colors.primary : tone === 'danger' ? colors.danger : colors.surfaceHigh;
  const fg = tone === 'neutral' ? colors.text : '#06130d';
  return (
    <TouchableOpacity
      style={[
        styles.button,
        { backgroundColor: bg, opacity: props.disabled ? 0.4 : 1 },
        props.style,
      ]}
      onPress={props.onPress}
      disabled={props.disabled || props.busy}>
      {props.busy ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={[styles.buttonText, { color: fg }]}>{props.title}</Text>
      )}
    </TouchableOpacity>
  );
}

export function Pill({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View style={styles.pill}>
      <Text style={styles.pillLabel}>{label}</Text>
      <Text style={[styles.pillValue, tone ? { color: tone } : null]}>{value}</Text>
    </View>
  );
}

export function Row({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.row, style]}>{children}</View>;
}

export function SegmentedControl<T extends string>(props: {
  options: Array<{ value: T; label: string; color?: string }>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.segmented}>
      {props.options.map(opt => {
        const active = opt.value === props.value;
        return (
          <TouchableOpacity
            key={opt.value}
            style={[
              styles.segment,
              active && { backgroundColor: opt.color ?? colors.primary },
            ]}
            onPress={() => props.onChange(opt.value)}>
            <Text
              style={[
                styles.segmentText,
                active && { color: '#06130d', fontWeight: '700' },
              ]}>
              {opt.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export function Toggle(props: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <TouchableOpacity style={styles.toggleRow} onPress={() => props.onChange(!props.value)}>
      <Text style={styles.fieldLabel}>{props.label}</Text>
      <View style={[styles.toggle, props.value && { backgroundColor: colors.primary }]}>
        <View style={[styles.toggleKnob, props.value && { alignSelf: 'flex-end' }]} />
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  section: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing(2),
    marginHorizontal: spacing(2),
    marginTop: spacing(2),
    borderWidth: 1,
    borderColor: colors.border,
  },
  sectionTitle: {
    color: colors.textDim,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: spacing(1),
  },
  fieldRow: { marginBottom: spacing(1.5) },
  fieldLabel: { color: colors.textDim, fontSize: 13, marginBottom: 4 },
  fieldInput: {
    backgroundColor: colors.surfaceHigh,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    paddingHorizontal: spacing(1.5),
    paddingVertical: spacing(1),
    fontSize: 15,
  },
  button: {
    borderRadius: 10,
    paddingVertical: spacing(1.5),
    paddingHorizontal: spacing(2),
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing(1),
  },
  buttonText: { fontSize: 15, fontWeight: '700' },
  pill: {
    backgroundColor: 'rgba(11,15,20,0.85)',
    borderRadius: 8,
    paddingHorizontal: spacing(1),
    paddingVertical: 4,
    marginRight: spacing(1),
    borderWidth: 1,
    borderColor: colors.border,
  },
  pillLabel: { color: colors.textDim, fontSize: 9, textTransform: 'uppercase' },
  pillValue: { color: colors.text, fontSize: 13, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center' },
  segmented: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceHigh,
    borderRadius: 10,
    padding: 3,
    borderWidth: 1,
    borderColor: colors.border,
  },
  segment: {
    flex: 1,
    paddingVertical: spacing(1),
    borderRadius: 8,
    alignItems: 'center',
  },
  segmentText: { color: colors.textDim, fontSize: 12, fontWeight: '600' },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing(1),
  },
  toggle: {
    width: 46,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.surfaceHigh,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 2,
  },
  toggleKnob: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.text,
  },
});
