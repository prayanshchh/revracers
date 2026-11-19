import {
  type Part,
  place,
  type Station,
  stationAt,
  wrap,
} from "./training-layout.ts";
import { wallAt } from "./street-layout.ts";
import { hash } from "./street-shell.ts";
import {
  looks,
  type StandLine,
  type StandLook,
  type StandParts,
} from "./grandstand.ts";
import { type Height, locate } from "./trackside-props.ts";

export interface BankSpec {
  from: number;
  to: number;
  side: number;
  near: number;
  far: number;
  share: number;
  fade?: number;
}

export interface FootprintStand extends StandLook {
  front: number[][];
  back: number[];
  depth: number;
  base: number;
  roof: boolean;
}

export type Blocked = (x: number, z: number) => boolean;

const fanRow = 0.68;
const fanSpacing = 0.58;
const fanJitter = 0.6;
const clumpScale = 6.5;
const clumpFloor = 0.5;
const clumpGain = 0.75;
const laneScale = 26;
const laneHalf = 0.012;
const laneSoft = 0.02;
const laneFloor = 0.2;
const defaultFade = 0.3;
const bankStep = 0.5;
const footprintCell = 1;
const standingHeadroom = 2.4;
const largest = 120;
const cellProbes = [
  [0.5, 0.5],
  [0, 0],
  [1, 0],
  [0, 1],
  [1, 1],
];

function smooth(x: number, z: number, scale: number, seed: number): number {
  const u = x / scale;
  const v = z / scale;
  const i = Math.floor(u);
  const j = Math.floor(v);
  const fu = u - i;
  const fv = v - j;
  const su = fu * fu * (3 - 2 * fu);
  const sv = fv * fv * (3 - 2 * fv);
  const corner = (a: number, b: number) =>
    hash(seed + (i + a) * 157.31 + (j + b) * 311.7);
  const top = corner(0, 0) * (1 - su) + corner(1, 0) * su;
  const bottom = corner(0, 1) * (1 - su) + corner(1, 1) * su;
  return top * (1 - sv) + bottom * sv;
}

function ramp(from: number, to: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

function crowdDensity(x: number, z: number, seed: number): number {
  const clump = clumpFloor + clumpGain * smooth(x, z, clumpScale, seed);
  const lane = Math.abs(smooth(x, z, laneScale, seed + 71) - 0.5);
  return (
    clump *
    (laneFloor + (1 - laneFloor) * ramp(laneHalf, laneHalf + laneSoft, lane))
  );
}

interface Bank {
  spec: BankSpec;
  index: number;
  rows: number;
  fade: number;
}

function fan(
  bank: Bank,
  at: number[],
  column: number,
  row: number,
): [number, number] | null {
  const { spec, index, rows, fade } = bank;
  const seed = index * 7919 + column * 31 + row * 0.37;
  const x = (at[0] ?? 0) + (hash(seed + 1) - 0.5) * fanJitter * fanSpacing;
  const z = (at[1] ?? 0) + (hash(seed + 2) - 0.5) * fanJitter * fanRow;
  const depth = row / Math.max(1, rows - 1);
  const edge = 1 - ramp(1 - fade, 1, depth) * 0.85;
  const chance = spec.share * edge * crowdDensity(x, z, index * 13);
  return hash(seed) > chance ? null : [x, z];
}

function rowLine(bank: Bank, stations: Station[], row: number): number[][] {
  const { spec } = bank;
  return stations.map((station) => {
    const lateral = wallAt(station, spec.side) + spec.near + row * fanRow;
    const [x = 0, , z = 0] = place(station, spec.side * lateral, 0);
    return [x, z];
  });
}

function along(line: number[][], spacing: number): number[][] {
  const out: number[][] = [];
  let next = spacing / 2;
  let travelled = 0;
  line.forEach((point, k) => {
    const before = line[k - 1];
    if (!before) return;
    const dx = (point[0] ?? 0) - (before[0] ?? 0);
    const dz = (point[1] ?? 0) - (before[1] ?? 0);
    const step = Math.hypot(dx, dz);
    while (travelled + step >= next && step > 0) {
      const t = (next - travelled) / step;
      out.push([(before[0] ?? 0) + dx * t, (before[1] ?? 0) + dz * t]);
      next += spacing;
    }
    travelled += step;
  });
  return out;
}

export function bankSpots(
  list: Station[],
  length: number,
  specs: BankSpec[],
  ground: Height,
  blocked: Blocked = () => false,
): number[] {
  const spots: number[] = [];
  specs.forEach((spec, index) => {
    const span = wrap(spec.to - spec.from, length);
    const count = Math.max(2, Math.ceil(span / bankStep) + 1);
    const stations = Array.from({ length: count }, (_, k) =>
      stationAt(list, length, spec.from + (span * k) / (count - 1)),
    );
    const bank = {
      spec,
      index,
      rows: Math.floor((spec.far - spec.near) / fanRow),
      fade: Math.max(1e-3, spec.fade ?? defaultFade),
    };
    for (let row = 0; row < bank.rows; row++)
      along(rowLine(bank, stations, row), fanSpacing).forEach((at, column) => {
        const spot = fan(bank, at, column, row);
        if (!spot || blocked(spot[0], spot[1])) return;
        const height = ground(spot[0], spot[1]);
        if (height !== null) spots.push(spot[0], height, spot[1]);
      });
  });
  return spots;
}

function cellKey(x: number, z: number): number {
  return Math.floor(x / footprintCell) * 131072 + Math.floor(z / footprintCell);
}

function mark(
  cells: Set<number>,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  inside: (x: number, z: number) => boolean = () => true,
): void {
  if (x1 - x0 > largest || z1 - z0 > largest) return;
  for (let x = Math.floor(x0); x <= Math.ceil(x1); x += footprintCell)
    for (let z = Math.floor(z0); z <= Math.ceil(z1); z += footprintCell)
      if (
        cellProbes.some(([dx, dz]) =>
          inside(x + (dx ?? 0) * footprintCell, z + (dz ?? 0) * footprintCell),
        )
      )
        cells.add(cellKey(x, z));
}

export function footprints(
  parts: Part[],
  ground: Height,
  outlines: number[][][] = [],
  solid: Part[] = [],
): Blocked {
  const cells = new Set<number>();
  for (const part of [...parts, ...solid]) {
    const tall = solid.includes(part);
    const { position, index } = part;
    for (let i = 0; i + 2 < index.length; i += 3) {
      let x0 = Infinity;
      let z0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let z1 = -Infinity;
      for (let k = 0; k < 3; k++) {
        const v = Number(index[i + k]) * 3;
        const x = Number(position[v]);
        const y = Number(position[v + 1]);
        const z = Number(position[v + 2]);
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        z0 = Math.min(z0, z);
        z1 = Math.max(z1, z);
        y0 = Math.min(y0, y);
      }
      const floor = ground((x0 + x1) / 2, (z0 + z1) / 2) ?? y0;
      if (!tall && y0 > floor + standingHeadroom) continue;
      mark(cells, x0, z0, x1, z1);
    }
  }
  for (const outline of outlines) {
    const xs = outline.map((point) => Number(point[0]));
    const zs = outline.map((point) => Number(point[1]));
    mark(
      cells,
      Math.min(...xs),
      Math.min(...zs),
      Math.max(...xs),
      Math.max(...zs),
      (x, z) => insidePolygon(outline, x, z),
    );
  }
  return (x, z) => cells.has(cellKey(x, z));
}

export function insidePolygon(
  outline: number[][],
  x: number,
  z: number,
): boolean {
  let inside = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const [xi = 0, zi = 0] = outline[i] ?? [];
    const [xj = 0, zj = 0] = outline[j] ?? [];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi)
      inside = !inside;
  }
  return inside;
}

export function standOutline(line: StandLine): number[][] {
  const [ax = 0, az = 0] = line.from;
  const [bx = 0, bz = 0] = line.to;
  const span = Math.hypot(bx - ax, bz - az) || 1;
  const nx = -(bz - az) / span;
  const nz = (bx - ax) / span;
  const deep = line.depth;
  return [
    [ax, az],
    [bx, bz],
    [bx + nx * deep, bz + nz * deep],
    [ax + nx * deep, az + nz * deep],
  ];
}

export function standLine(
  stand: FootprintStand,
  cleared: (x: number, z: number) => boolean,
  boardFor: (x: number, z: number) => string,
): StandLine | null {
  const [first, last] = stand.front.map((point) => [
    Number(point[0]),
    -Number(point[1]),
  ]);
  if (!first || !last) return null;
  const x = (Number(first[0]) + Number(last[0])) / 2;
  const z = (Number(first[1]) + Number(last[1])) / 2;
  if (cleared(x, z)) return null;
  const run = [
    Number(last[0]) - Number(first[0]),
    Number(last[1]) - Number(first[1]),
  ];
  const flipped =
    -Number(run[1]) * Number(stand.back[0]) -
      Number(run[0]) * Number(stand.back[1]) <
    0;
  return {
    from: flipped ? last : first,
    to: flipped ? first : last,
    depth: stand.depth,
    base: stand.base,
    roof: stand.roof,
    board: boardFor(x, z),
    ...looks(stand),
  };
}

interface SeatRow {
  radius: number;
  height: number;
  from: number;
  to: number;
}

export interface Landmark {
  name: string;
  solid: boolean;
  outline: number[][];
  focus?: number[];
  rows?: SeatRow[];
}

const bowlSeat = 0.55;
const bowlTaken = 0.62;

export function bowlSeats(landmarks: Landmark[]): number[] {
  const spots: number[] = [];
  landmarks.forEach((landmark, index) => {
    const [fx = 0, fz = 0] = landmark.focus ?? [];
    for (const [row, line] of (landmark.rows ?? []).entries()) {
      const count = Math.floor(
        ((line.to - line.from) * line.radius) / bowlSeat,
      );
      for (let k = 0; k < count; k++) {
        const angle = line.from + ((k + 0.5) / count) * (line.to - line.from);
        const x = fx + line.radius * Math.cos(angle);
        const z = fz - line.radius * Math.sin(angle);
        const chance = bowlTaken * crowdDensity(x, z, index);
        if (hash(index * 4111 + row * 97 + k * 0.731) < chance)
          spots.push(x, line.height, z);
      }
    }
  });
  return spots;
}

export function solidOutlines(landmarks: Landmark[]): number[][][] {
  return landmarks
    .filter((landmark) => landmark.solid)
    .map((landmark) => landmark.outline);
}

export function standDecks(pieces: { part: Part; look: string }[]): Part[] {
  return pieces
    .filter(({ look }) => look === "seats" || look === "skirt")
    .map(({ part }) => part);
}

export function standPieces(parts: StandParts): { part: Part; look: string }[] {
  return [
    { part: parts.deck.part("stand deck", "track stand deck"), look: "seats" },
    {
      part: parts.aisle.part("stand aisles", "track stand aisle"),
      look: "aisle",
    },
    {
      part: parts.skirt.part("stand skirt", "track stand skirt"),
      look: "skirt",
    },
    {
      part: parts.banner.part("stand banner", "track wall boards"),
      look: "boards",
    },
    {
      part: parts.frame.part("stand scaffold", "track stand frame"),
      look: "frame",
    },
    {
      part: parts.roof.part("stand canopy", "track stand canopy"),
      look: "roof",
    },
    { part: parts.sign.part("stand signs", "track stand signs"), look: "sign" },
    {
      part: parts.red.part("stand cladding", "track stand cladding"),
      look: "red",
    },
    { part: parts.rail.part("stand rails", "track stand rails"), look: "rail" },
    ...[...parts.seats].map(([colour, builder]) => ({
      part: builder.part(`stand seats ${colour}`, "track stand seats"),
      look: `seat:${colour}`,
    })),
  ].filter(({ part }) => part.index.length > 0);
}

export interface Stage {
  focus: number[];
  outline: number[][];
}

function toward(x: number, z: number, tx: number, tz: number): number[] {
  const length = Math.hypot(tx - x, tz - z) || 1;
  return [(tx - x) / length, (tz - z) / length];
}

export function trackAim(
  list: Station[],
  stages: Stage[],
): (x: number, z: number) => number[] | null {
  return (x, z) => {
    const stage = stages.find((item) => insidePolygon(item.outline, x, z));
    if (stage) return toward(x, z, stage.focus[0] ?? 0, stage.focus[1] ?? 0);
    const found = locate(list, x, z);
    return found ? toward(x, z, found.station.x, found.station.z) : null;
  };
}

const crowdStride = 8;

export function aimed(
  values: Float32Array,
  aim: (x: number, z: number) => number[] | null,
): void {
  for (let i = 0; i < values.length; i += crowdStride) {
    const [fx = 0, fz = 0] = aim(values[i] ?? 0, -(values[i + 1] ?? 0)) ?? [];
    values[i + 5] = fx;
    values[i + 6] = -fz;
  }
}
