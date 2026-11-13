export interface BoardSpan {
  from: number;
  left: string;
  right: string;
}

export interface GantrySpec {
  at: number;
  board: string;
  kind: string;
  reach?: number;
  height?: number;
  margin?: number;
  left?: number;
  right?: number;
}

export interface Dressing {
  boards: BoardSpan[];
  gantries: GantrySpec[];
}

const boards = [
  "northwind",
  "voltara",
  "aurenne",
  "kestrel",
  "marlowe",
  "torqua",
  "cordave",
  "verdale",
  "albaren",
  "nimbara",
  "maison",
  "halden",
  "boulevard tag",
  "revracers",
  "boulevard prix",
  "revracers 26",
  "hill tag",
  "hill prix",
  "distance",
];
const rowPixels = 268;
const gapPixels = 6;
const panelPixels = 256;
export const wrapAspect = 2048 / panelPixels;
export const floorHeight = 3.6;

export function boardRow(name: string): number {
  return Math.max(0, boards.indexOf(name));
}

export function wrapV(row: number, rise: number): number {
  const top = row * rowPixels + gapPixels;
  return (top + (1 - rise) * panelPixels) / (boards.length * rowPixels);
}

export function boardNameAt(
  spans: BoardSpan[],
  s: number,
  sign: number,
): string {
  let found = spans[spans.length - 1];
  for (const span of spans) {
    if (span.from > s) break;
    found = span;
  }
  if (!found) return boards[0] ?? "";
  return sign > 0 ? found.left : found.right;
}

export function boardAt(spans: BoardSpan[], s: number, sign: number): number {
  return boardRow(boardNameAt(spans, s, sign));
}
