/** Dark, sunlight-friendly field UI palette. */
export const colors = {
  bg: '#0b0f14',
  surface: '#151b23',
  surfaceHigh: '#1e2733',
  border: '#2c3947',
  text: '#e8eef4',
  textDim: '#8fa1b3',
  primary: '#00e5a0',
  primaryDark: '#00b37d',
  danger: '#ff6b6b',
  warning: '#ffd166',
  info: '#4fc3f7',
  fixRtk: '#00e5a0',
  fixFloat: '#ffd166',
  fixNone: '#ff6b6b',
  perimeter: '#00e5a0',
  penetration: '#ff6b6b',
  edge: '#4fc3f7',
  point: '#ffd166',
} as const;

export const spacing = (n: number) => n * 8;
