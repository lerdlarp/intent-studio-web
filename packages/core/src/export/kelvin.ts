// Kelvin → sRGB table (2700–6500 K) shared by the lit preview and the glTF export. Anchors are the widely used
// blackbody-in-sRGB values; intermediate temperatures interpolate linearly. Purely visual.

/** [kelvin, r, g, b] with channels 0..255 (sRGB), ascending kelvin. */
export const KELVIN_TABLE: readonly (readonly [number, number, number, number])[] = [
  [2700, 255, 169, 87],
  [3000, 255, 180, 107],
  [3500, 255, 196, 137],
  [4000, 255, 209, 163],
  [4500, 255, 219, 186],
  [5000, 255, 228, 206],
  [5500, 255, 236, 224],
  [6000, 255, 243, 239],
  [6500, 255, 249, 253],
];

export const KELVIN_MIN = 2700;
export const KELVIN_MAX = 6500;

/** sRGB channels 0..255 (rounded) for a colour temperature; clamped to 2700–6500 K. */
export function kelvinToRgb(kelvin: number): [number, number, number] {
  const k = Math.min(KELVIN_MAX, Math.max(KELVIN_MIN, Number.isFinite(kelvin) ? kelvin : 3500));
  let i = 0;
  while (i < KELVIN_TABLE.length - 2 && k > KELVIN_TABLE[i + 1]![0]) i++;
  const a = KELVIN_TABLE[i]!;
  const b = KELVIN_TABLE[i + 1]!;
  const t = (k - a[0]) / (b[0] - a[0]);
  const ch = (n: 1 | 2 | 3) => Math.round(a[n] + (b[n] - a[n]) * t);
  return [ch(1), ch(2), ch(3)];
}

/** sRGB channels 0..1. */
export function kelvinToRgbUnit(kelvin: number): [number, number, number] {
  const [r, g, b] = kelvinToRgb(kelvin);
  return [r / 255, g / 255, b / 255];
}

/** `#rrggbb`. */
export function kelvinToHex(kelvin: number): string {
  return '#' + kelvinToRgb(kelvin).map((c) => c.toString(16).padStart(2, '0')).join('');
}
