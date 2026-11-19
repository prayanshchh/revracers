const standSigns = [
  "main",
  "turn1",
  "turn4",
  "turn9",
  "turn12",
  "turn15",
  "turn19",
  "flag",
];

const signWidth = 4096;
const rowPixels = 256;
const gapPixels = 16;
const panelPixels = rowPixels - 2 * gapPixels;

export const signAspect = signWidth / panelPixels;

export function signRow(name: string): number {
  return Math.max(0, standSigns.indexOf(name));
}

export function signV(row: number, rise: number): number {
  const top = row * rowPixels + gapPixels;
  return (top + (1 - rise) * panelPixels) / (standSigns.length * rowPixels);
}
