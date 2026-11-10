import {
  box,
  Builder,
  type Part,
  place,
  type Station,
  stationAt,
} from "./training-layout.ts";
import { axesOf, drum, type Paint, painted } from "./street-pit.ts";

export interface TrackProp {
  kind: "bollard" | "block";
  distance: number;
  lateral: number;
  turn: number;
}

const orange: Paint = { colour: [1, 0.3, 0.05], glow: 0.35 };
const reflector: Paint = { colour: [0.92, 0.92, 0.9], glow: 0.6 };
const rubber: Paint = { colour: [0.05, 0.05, 0.055], glow: 0 };
const water: Paint = { colour: [0.98, 0.55, 0.06], glow: 0.25 };
const postRadius = 0.15;
const bands: [number, Paint][] = [
  [0.4, orange],
  [0.15, reflector],
  [0.17, orange],
  [0.15, reflector],
  [0.18, orange],
];
const baseHeight = 0.1;
const baseHalf = [0.27, baseHeight / 2, 0.27];
const blockHeight = 0.8;
const blockHalf = [0.9, blockHeight / 2, 0.26];

function bollard(builder: Builder, station: Station, lateral: number): void {
  const axes = axesOf(station);
  const foot = place(station, lateral, 0);
  const [x = 0, y = 0, z = 0] = foot;
  box(builder, [x, y + baseHeight / 2, z], baseHalf, axes, painted(rubber));
  let height = y + baseHeight;
  for (const [size, paint] of bands) {
    drum(builder, [x, height, z], postRadius, size, paint);
    height += size;
  }
}

function waterBlock(
  builder: Builder,
  station: Station,
  lateral: number,
  turn: number,
): void {
  const [forward = [], up = [], left = []] = axesOf(station);
  const c = Math.cos(turn);
  const s = Math.sin(turn);
  const along = forward.map((f, i) => c * f + s * (left[i] ?? 0));
  const across = forward.map((f, i) => -s * f + c * (left[i] ?? 0));
  box(
    builder,
    place(station, lateral, blockHeight / 2),
    blockHalf,
    [along, up, across],
    painted(water),
  );
}

export function trackProps(
  list: Station[],
  length: number,
  props: TrackProp[],
): Part {
  const builder = new Builder(3);
  for (const prop of props) {
    const station = stationAt(list, length, prop.distance);
    if (prop.kind === "bollard") bollard(builder, station, prop.lateral);
    else waterBlock(builder, station, prop.lateral, prop.turn);
  }
  return builder.part("track props", "track pit kit");
}
