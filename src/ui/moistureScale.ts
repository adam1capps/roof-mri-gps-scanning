/**
 * Moisture value → color, 0–10.
 *
 * Sequential single-hue blue ramp (validated palette, ordinal band): step 250
 * is the lightest allowed for discrete marks so a "1" still reads over bright
 * rooftop imagery; 700 is the darkest for a "10". White strokes keep marks
 * legible in direct sunlight. 0 = surveyed-dry, rendered as a neutral outline.
 */

export const MOISTURE_COLORS: Record<number, string> = {
  1: '#86b6ef',
  2: '#6da7ec',
  3: '#5598e7',
  4: '#3987e5',
  5: '#2a78d6',
  6: '#256abf',
  7: '#1c5cab',
  8: '#184f95',
  9: '#104281',
  10: '#0d366b',
};

export const DRY_COLOR = '#9aa5ad';

export function moistureColor(value: number): string {
  return MOISTURE_COLORS[Math.max(0, Math.min(10, Math.round(value)))] ?? DRY_COLOR;
}

/** MapLibre match expression mapping the `value` property to its color. */
export function moistureColorExpression(): unknown[] {
  const pairs: Array<number | string> = [];
  for (let v = 1; v <= 10; v++) pairs.push(v, MOISTURE_COLORS[v]);
  return ['match', ['get', 'value'], ...pairs, DRY_COLOR];
}

/** Values ≥ 6 use white keypad text; lighter steps use dark text. */
export function keypadTextColor(value: number): string {
  return value >= 6 ? '#ffffff' : '#06130d';
}
