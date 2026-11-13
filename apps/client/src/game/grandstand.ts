import {
  Builder,
  place,
  type Station,
  stationAt,
  wrap,
} from "./training-layout.ts";
import { beam, spanRows, wallAt } from "./street-layout.ts";
import { hash } from "./street-shell.ts";
import { boardRow, wrapAspect, wrapV } from "./trackside-plan.ts";

export interface StandSpec {
  from: number;
  to: number;
  side: number;
  rows: number;
  roof?: boolean;
  gap?: number;
  board?: string;
  overhang?: number;
  clearance?: number;
}

export interface StandParts {
  deck: Builder;
  aisle: Builder;
  skirt: Builder;
  banner: Builder;
  frame: Builder;
  roof: Builder;
  glow: Builder;
}

export type Ground = (station: Station, lateral: number) => number;

const defaultGap = 3.4;
const rowDepth = 0.8;
const rowRise = 0.45;
const frontRise = 2.3;
const bannerTall = 1.1;
const skirtBury = 1.2;
const walkway = 1.4;
const step = 2;
const aisleEvery = 13;
const aisleWidth = 1.3;
const aisleLift = 0.03;
const seatAt = 0.55;
const seatSpacing = 0.52;
const seatsTaken = 0.93;
const postSpacing = 3.2;
const post = 0.1;
const braceSize = 0.07;
const braceReach = 3.4;
const railRise = 1.1;
const roofLift = 5.2;
const roofFront = 4.5;
const roofBack = 1.2;
const roofRise = 0.7;
const roofThick = 0.35;
const columnSpacing = 9.6;
const columnSize = 0.32;
const lampInset = 1.2;
const lampWidth = 0.3;
const lineSeed = 500;
const lineOverhang = 0.6;
const lineClearance = 4.2;
const minRows = 4;
const maxRows = 46;

interface Shape {
  spec: StandSpec;
  rows: Station[];
  span: number;
  reads: number;
  at: (offset: number) => Station;
  base: (station: Station) => number;
  lift: (station: Station) => number;
  depth: number;
  top: number;
}

export interface StandLine {
  from: number[];
  to: number[];
  depth: number;
  base: number;
  roof: boolean;
  board?: string;
}

export function emptyStand(): StandParts {
  return {
    deck: new Builder(1),
    aisle: new Builder(1),
    skirt: new Builder(1),
    banner: new Builder(1),
    frame: new Builder(1),
    roof: new Builder(1),
    glow: new Builder(1),
  };
}

function shapeOf(
  list: Station[],
  length: number,
  spec: StandSpec,
  ground: Ground | null,
): Shape {
  const span = wrap(spec.to - spec.from, length);
  const base = (station: Station) =>
    wallAt(station, spec.side) + (spec.gap ?? defaultGap);
  return {
    spec,
    rows: spanRows(list, length, spec.from, span, step),
    span,
    reads: spec.side,
    at: (offset) => {
      const s = spec.from + offset;
      return { ...stationAt(list, length, s), s };
    },
    base,
    lift: (station) =>
      ground ? ground(station, spec.side * base(station)) - station.y : 0,
    depth: spec.rows * rowDepth,
    top: frontRise + spec.rows * rowRise,
  };
}

function lineShape(line: StandLine): Shape {
  const [ax = 0, az = 0] = line.from;
  const [bx = 0, bz = 0] = line.to;
  const span = Math.hypot(bx - ax, bz - az) || 1;
  const along = [(bx - ax) / span, (bz - az) / span];
  const at = (offset: number): Station => ({
    s: offset,
    x: ax + (along[0] ?? 0) * offset,
    y: line.base,
    z: az + (along[1] ?? 0) * offset,
    lx: -(along[1] ?? 0),
    lz: along[0] ?? 0,
    half: 0,
    wallLeft: 0,
    wallRight: 0,
    line: 0,
    rubber: 0,
  });
  const rows = Math.max(
    minRows,
    Math.min(maxRows, Math.floor((line.depth - walkway) / rowDepth)),
  );
  const count = Math.max(2, Math.round(span / step) + 1);
  return {
    spec: {
      from: 0,
      to: span,
      side: 1,
      rows,
      roof: line.roof,
      overhang: lineOverhang,
      clearance: lineClearance,
      ...(line.board ? { board: line.board } : {}),
    },
    rows: Array.from({ length: count }, (_, k) => at((span * k) / (count - 1))),
    span,
    reads: -1,
    at,
    base: () => 0,
    lift: () => 0,
    depth: rows * rowDepth,
    top: frontRise + rows * rowRise,
  };
}

function sweep(
  builder: Builder,
  shape: Shape,
  rows: Station[],
  profile: [number, number][],
  uv: (station: Station, along: number, rise: number) => number[],
): void {
  const first = builder.count;
  const { side } = shape.spec;
  const slopes = profile.map((point, index) => {
    const before = profile[index - 1] ?? point;
    const after = profile[index + 1] ?? point;
    const size = Math.hypot(after[0] - before[0], after[1] - before[1]) || 1;
    return [-(after[1] - before[1]) / size, (after[0] - before[0]) / size];
  });
  for (const station of rows) {
    let along = 0;
    profile.forEach(([lateral, height], index) => {
      const before = profile[index - 1];
      if (before) along += Math.hypot(lateral - before[0], height - before[1]);
      const [outward = 0, rise = 1] = slopes[index] ?? [];
      builder.vertex(
        place(
          station,
          side * (shape.base(station) + lateral),
          height + shape.lift(station),
        ),
        [station.lx * side * outward, rise, station.lz * side * outward],
        [uv(station, along, index / Math.max(1, profile.length - 1))],
      );
    });
  }
  builder.grid(rows.length, profile.length, first, side < 0);
}

function plain(station: Station, along: number): number[] {
  return [station.s, along];
}

function steps(rows: number): [number, number][] {
  const profile: [number, number][] = [[0, frontRise]];
  for (let k = 0; k < rows; k++) {
    profile.push([walkway + k * rowDepth, frontRise + k * rowRise]);
    profile.push([walkway + k * rowDepth, frontRise + (k + 1) * rowRise]);
  }
  profile.push([walkway + rows * rowDepth, frontRise + rows * rowRise]);
  return profile;
}

function front(parts: StandParts, shape: Shape): void {
  sweep(
    parts.skirt,
    shape,
    shape.rows,
    [
      [0, -skirtBury],
      [0, frontRise - bannerTall],
    ],
    plain,
  );
  const row = boardRow(shape.spec.board ?? "revracers");
  const tile = bannerTall * wrapAspect;
  sweep(
    parts.banner,
    shape,
    shape.rows,
    [
      [-0.02, frontRise - bannerTall],
      [-0.02, frontRise],
    ],
    (station, _, rise) => [
      (shape.reads * (station.s - shape.spec.from)) / tile,
      wrapV(row, rise),
    ],
  );
}

function end(parts: StandParts, shape: Shape, station: Station): void {
  const { side } = shape.spec;
  const outward = station === shape.rows[0] ? -1 : 1;
  const normal = [-station.lz * outward, 0, station.lx * outward];
  const lift = shape.lift(station);
  const strip = (from: number, to: number, height: number) => {
    const first = parts.skirt.count;
    const corners: [number, number][] = [
      [from, -skirtBury],
      [to, -skirtBury],
      [to, height],
      [from, height],
    ];
    for (const [lateral, rise] of corners)
      parts.skirt.vertex(
        place(station, side * (shape.base(station) + lateral), rise + lift),
        normal,
        [[lateral, rise]],
      );
    parts.skirt.quad(first, first + 1, first + 2, first + 3);
  };
  strip(0, walkway, frontRise);
  for (let k = 0; k < shape.spec.rows; k++)
    strip(
      walkway + k * rowDepth,
      walkway + (k + 1) * rowDepth,
      frontRise + (k + 1) * rowRise,
    );
}

function aisleSpans(shape: Shape): [number, number][] {
  const count = Math.max(1, Math.round(shape.span / aisleEvery));
  return Array.from({ length: count }, (_, k) => {
    const centre = (shape.span * (k + 0.5)) / count;
    return [centre - aisleWidth / 2, centre + aisleWidth / 2];
  });
}

function aisles(parts: StandParts, shape: Shape): void {
  const profile = steps(shape.spec.rows).map(
    ([lateral, height]): [number, number] => [lateral, height + aisleLift],
  );
  for (const [from, to] of aisleSpans(shape))
    sweep(parts.aisle, shape, [shape.at(from), shape.at(to)], profile, plain);
}

type Spot = (lateral: number, height: number) => number[];

function bays(shape: Shape, spacing: number): Spot[] {
  const count = Math.max(2, Math.round(shape.span / spacing) + 1);
  return Array.from({ length: count }, (_, k) => {
    const station = shape.at((shape.span * k) / (count - 1));
    const lift = shape.lift(station);
    return (lateral, height) =>
      place(
        station,
        shape.spec.side * (shape.base(station) + lateral),
        height + lift,
      );
  });
}

function scaffold(parts: StandParts, shape: Shape): void {
  const back = walkway + shape.depth;
  let before: number[] | null = null;
  for (const at of bays(shape, postSpacing)) {
    const rail = at(back, shape.top + railRise);
    beam(parts.frame, at(back, -skirtBury), rail, post);
    beam(
      parts.frame,
      at(back, shape.top),
      at(back + braceReach, -skirtBury),
      braceSize,
    );
    beam(
      parts.frame,
      at(back + braceReach, -skirtBury),
      at(back + braceReach, shape.top * 0.55),
      post,
    );
    beam(
      parts.frame,
      at(back, shape.top * 0.55),
      at(back + braceReach, shape.top * 0.55),
      braceSize,
    );
    if (before) beam(parts.frame, before, rail, braceSize);
    before = rail;
  }
}

function canopy(parts: StandParts, shape: Shape): void {
  const back = walkway + shape.depth + roofBack;
  const reach = shape.spec.overhang ?? roofFront;
  const low = shape.top + (shape.spec.clearance ?? roofLift);
  const high = low + roofRise;
  sweep(
    parts.roof,
    shape,
    shape.rows,
    [
      [-reach, high],
      [back, low],
      [back, low + roofThick],
      [-reach, high + roofThick],
      [-reach, high],
    ],
    plain,
  );
  sweep(
    parts.glow,
    shape,
    shape.rows,
    [
      [-reach + lampInset, high - 0.04],
      [-reach + lampInset + lampWidth, high - 0.04],
    ],
    plain,
  );
  for (const at of bays(shape, columnSpacing)) {
    beam(parts.frame, at(-0.3, -skirtBury), at(-0.3, high), columnSize);
    beam(
      parts.frame,
      at(back - 0.3, -skirtBury),
      at(back - 0.3, low),
      columnSize,
    );
    beam(
      parts.frame,
      at(-reach, high - 0.2),
      at(back, low - 0.2),
      columnSize * 0.8,
    );
  }
}

function build(parts: StandParts, shape: Shape): void {
  sweep(parts.deck, shape, shape.rows, steps(shape.spec.rows), plain);
  front(parts, shape);
  const first = shape.rows[0];
  const last = shape.rows[shape.rows.length - 1];
  if (first) end(parts, shape, first);
  if (last) end(parts, shape, last);
  aisles(parts, shape);
  scaffold(parts, shape);
  if (shape.spec.roof) canopy(parts, shape);
}

export function standParts(
  list: Station[],
  length: number,
  specs: StandSpec[],
  parts: StandParts,
  ground: Ground | null = null,
): void {
  for (const spec of specs) build(parts, shapeOf(list, length, spec, ground));
}

export function lineStandParts(lines: StandLine[], parts: StandParts): void {
  for (const line of lines) build(parts, lineShape(line));
}

function seatRow(
  shape: Shape,
  row: number,
  gaps: [number, number][],
  taken: (seat: number) => boolean,
  spots: number[],
): void {
  const { spec } = shape;
  const lateral = walkway + (row + seatAt) * rowDepth;
  const height = frontRise + row * rowRise;
  const at = (station: Station) =>
    place(
      station,
      spec.side * (shape.base(station) + lateral),
      height + shape.lift(station),
    );
  let seat = 0;
  shape.rows.slice(1).forEach((station, index) => {
    const before = shape.rows[index] ?? station;
    const near = at(before);
    const far = at(station);
    const count = Math.max(1, Math.round(gapBetween(near, far) / seatSpacing));
    for (let n = 0; n < count; n++) {
      seat += 1;
      const t = (n + 0.5) / count;
      const along = before.s + (station.s - before.s) * t - spec.from;
      if (gaps.some(([from, to]) => along > from && along < to)) continue;
      if (taken(seat))
        spots.push(...near.map((v, k) => v + ((far[k] ?? v) - v) * t));
    }
  });
}

function gapBetween(a: number[], b: number[]): number {
  return Math.hypot((b[0] ?? 0) - (a[0] ?? 0), (b[2] ?? 0) - (a[2] ?? 0));
}

function seated(shape: Shape, index: number, spots: number[]): void {
  const gaps = aisleSpans(shape);
  for (let row = 0; row < shape.spec.rows; row++)
    seatRow(
      shape,
      row,
      gaps,
      (seat) => hash(index * 977 + row * 131 + seat * 0.618) < seatsTaken,
      spots,
    );
}

export function standSeats(
  list: Station[],
  length: number,
  specs: StandSpec[],
  ground: Ground | null = null,
): number[] {
  const spots: number[] = [];
  specs.forEach((spec, index) => {
    seated(shapeOf(list, length, spec, ground), index, spots);
  });
  return spots;
}

export function lineStandSeats(lines: StandLine[]): number[] {
  const spots: number[] = [];
  lines.forEach((line, index) => {
    seated(lineShape(line), index + lineSeed, spots);
  });
  return spots;
}
