import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { keypadTextColor, MOISTURE_COLORS, DRY_COLOR } from '../moistureScale';
import { colors, spacing } from '../theme';

/**
 * Sunlight-readable moisture keypad, phone-pad layout:
 *
 *    1  2  3
 *    4  5  6
 *    7  8  9
 *   mic 0  10
 *
 * Each value key wears its moisture color so the contractor learns the map
 * legend by muscle memory. Keys are large (>= 64 px) for gloved hands.
 */

export function MoistureKeypad(props: {
  onValue: (value: number) => void;
  onMicToggle: () => void;
  micActive: boolean;
  onUndo: () => void;
}) {
  const key = (value: number) => (
    <TouchableOpacity
      key={value}
      style={[styles.key, { backgroundColor: value === 0 ? DRY_COLOR : MOISTURE_COLORS[value] }]}
      onPress={() => props.onValue(value)}>
      <Text style={[styles.keyText, { color: value === 0 ? '#06130d' : keypadTextColor(value) }]}>
        {value}
      </Text>
    </TouchableOpacity>
  );

  return (
    <View>
      <View style={styles.row}>{[1, 2, 3].map(key)}</View>
      <View style={styles.row}>{[4, 5, 6].map(key)}</View>
      <View style={styles.row}>{[7, 8, 9].map(key)}</View>
      <View style={styles.row}>
        <TouchableOpacity
          style={[styles.key, styles.utilityKey, props.micActive && styles.micActive]}
          onPress={props.onMicToggle}>
          <Text style={styles.utilityText}>{props.micActive ? '🎤 ON' : '🎤'}</Text>
        </TouchableOpacity>
        {key(0)}
        {key(10)}
      </View>
      <View style={styles.row}>
        <TouchableOpacity style={[styles.key, styles.undoKey]} onPress={props.onUndo}>
          <Text style={styles.utilityText}>Undo reading</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing(1) },
  key: {
    flex: 1,
    minHeight: 64,
    marginHorizontal: spacing(0.5),
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#ffffff',
  },
  keyText: { fontSize: 26, fontWeight: '800' },
  utilityKey: { backgroundColor: colors.surfaceHigh, borderColor: colors.border },
  micActive: { backgroundColor: colors.warning, borderColor: '#ffffff' },
  undoKey: {
    backgroundColor: colors.surfaceHigh,
    borderColor: colors.border,
    minHeight: 48,
  },
  utilityText: { color: colors.text, fontSize: 16, fontWeight: '700' },
});
