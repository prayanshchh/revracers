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
import { signAspect, signRow, signV } from "./stand-signs.ts";

export interface StandLook {
  seat?: string;
  sign?: string;
  crest?: string;
  clad?: string;
  cover?: number;
  flags?: number;
  solid?: boolean;
  top?: number;
}

export interface StandSpec extends StandLook {
  from: number;
  to: number;
  side: number;
  rows: number;
  roof?: boolean;
  gap?: number;
  board?: string;
  overhang?: number;
  clearance?: number;
  lateral?: number;
  lift?: number;
}

export interface StandParts {
  deck: Builder;
  aisle: Builder;
  skirt: Builder;
  banner: Builder;
  frame: Builder;
  roof: Builder;
  glow: Builder;
  seats: Map<string, Builder>;
  sign: Builder;
  red: Builder;
  rail: Builder;
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
const seatBack = 0.42;
const seatInset = 0.62;
const signTall = 1.6;
const backTall = 2.6;
const backLift = 1.2;
const cladTall = 4;
const cladLift = 0.42;
const coverClearance = 3.4;
const coverRise = 0.45;
const coverColumns = 12;
const coverColumn = 0.24;
const railPost = 0.04;
const railTube = 0.03;
const railPosts = 2.4;
const aisleRail = 0.9;
const flagPole = 6;
const flagTall = 1.6;
const flagWide = 2.6;
const flagColumns = 6;
const flagWave = 0.22;
const stairWide = 1.3;
const stairGap = 0.2;
const stairRise = 2.2;
const stairReach = 5.5;
const stairPost = 0.09;
const stringer = 0.35;
const underRows = 4;

interface Shape {
  spec: StandSpec;
  rows: Station[];
  span: number;
  reads: number;
  at: (offset: number) => Station;
  base: (station: Station) => number;
  lift: (station: Station) => number;
  depth: number;
  rise: number;
  top: number;
  scaffolded: boolean;
}

export interface StandLine extends StandLook {
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
    seats: new Map(),
    sign: new Builder(1),
    red: new Builder(1),
    rail: new Builder(1),
  };
}

function riseOf(look: StandLook, rows: number): number {
  return look.top ? Math.max(0.2, (look.top - frontRise) / rows) : rowRise;
}

export function looks(line: StandLook): StandLook {
  const kept: StandLook = {};
  if (line.seat) kept.seat = line.seat;
  if (line.sign) kept.sign = line.sign;
  if (line.crest) kept.crest = line.crest;
  if (line.clad) kept.clad = line.clad;
  if (line.cover) kept.cover = line.cover;
  if (line.top) kept.top = line.top;
  if (line.flags) kept.flags = line.flags;
  if (line.solid) kept.solid = line.solid;
  return kept;
}

function shapeOf(
  list: Station[],
  length: number,
  spec: StandSpec,
  ground: Ground | null,
): Shape {
  const span = wrap(spec.to - spec.from, length);
  const base = (station: Station) =>
    spec.lateral ?? wallAt(station, spec.side) + (spec.gap ?? defaultGap);
  const rise = riseOf(spec, spec.rows);
  const raised = (station: Station) =>
    ground ? ground(station, spec.side * base(station)) - station.y : 0;
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
    lift: (station) => spec.lift ?? raised(station),
    depth: spec.rows * rowDepth,
    rise,
    top: frontRise + spec.rows * rise,
    scaffolded: !spec.solid,
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
  const rise = riseOf(line, rows);
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
      ...looks(line),
    },
    rows: Array.from({ length: count }, (_, k) => at((span * k) / (count - 1))),
    span,
    reads: -1,
    at,
    base: () => 0,
    lift: () => 0,
    depth: rows * rowDepth,
    rise,
    top: frontRise + rows * rise,
    scaffolded: false,
  };
}

function sweep(
  builder: Builder,
  shape: Shape,
  rows: Station[],
  profile: [number, number][],
  uv: (station: Station, along: number, rise: number) => number[],
  turned = false,
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
  builder.grid(rows.length, profile.length, first, side < 0 !== turned);
}

function plain(station: Station, along: number): number[] {
  return [station.s, along];
}

function steps(rows: number, rise: number): [number, number][] {
  const profile: [number, number][] = [[0, frontRise]];
  for (let k = 0; k < rows; k++) {
    profile.push([walkway + k * rowDepth, frontRise + k * rise]);
    profile.push([walkway + k * rowDepth, frontRise + (k + 1) * rise]);
  }
  profile.push([walkway + rows * rowDepth, frontRise + rows * rise]);
  return profile;
}

function signStrip(
  builder: Builder,
  shape: Shape,
  name: string,
  lateral: number,
  from: number,
  tall: number,
  facing: number,
): void {
  const row = signRow(name);
  const tile = tall * signAspect;
  sweep(
    builder,
    shape,
    shape.rows,
    [
      [lateral, from],
      [lateral, from + tall],
    ],
    (station, _, rise) => [
      (facing * shape.reads * (station.s - shape.spec.from)) / tile,
      signV(row, rise),
    ],
  );
}

function front(parts: StandParts, shape: Shape): void {
  const { sign } = shape.spec;
  const tall = sign ? signTall : bannerTall;
  sweep(
    parts.skirt,
    shape,
    shape.rows,
    [
      [0, -skirtBury],
      [0, frontRise - tall],
    ],
    plain,
  );
  if (sign) {
    signStrip(parts.sign, shape, sign, -0.02, frontRise - tall, tall, 1);
    return;
  }
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
  const open = shape.scaffolded && !shape.spec.clad;
  const skin = shape.spec.clad
    ? parts.red
    : shape.scaffolded
      ? parts.frame
      : parts.aisle;
  const strip = (from: number, to: number, height: number, low: number) => {
    const first = skin.count;
    const corners: [number, number][] = [
      [from, low],
      [to, low],
      [to, height],
      [from, height],
    ];
    for (const [lateral, rise] of corners)
      skin.vertex(
        place(station, side * (shape.base(station) + lateral), rise + lift),
        normal,
        [[lateral, rise]],
      );
    skin.quad(first, first + 1, first + 2, first + 3);
  };
  if (!open) strip(0, walkway, frontRise, -skirtBury);
  for (let k = 0; k < shape.spec.rows; k++) {
    const height = frontRise + (k + 1) * shape.rise;
    strip(
      walkway + k * rowDepth,
      walkway + (k + 1) * rowDepth,
      height,
      open ? height - stringer : -skirtBury,
    );
  }
}

function underframe(parts: StandParts, shape: Shape): void {
  for (const at of bays(shape, postSpacing))
    for (let k = 0; k < shape.spec.rows; k += underRows) {
      const lateral = walkway + k * rowDepth;
      const floor = frontRise + k * shape.rise;
      beam(parts.frame, at(lateral, -skirtBury), at(lateral, floor), post);
    }
}

function aisleSpans(shape: Shape): [number, number][] {
  const count = Math.max(1, Math.round(shape.span / aisleEvery));
  return Array.from({ length: count }, (_, k) => {
    const centre = (shape.span * (k + 0.5)) / count;
    return [centre - aisleWidth / 2, centre + aisleWidth / 2];
  });
}

function aisles(parts: StandParts, shape: Shape): void {
  const profile = steps(shape.spec.rows, shape.rise).map(
    ([lateral, height]): [number, number] => [lateral, height + aisleLift],
  );
  for (const [from, to] of aisleSpans(shape))
    sweep(parts.aisle, shape, [shape.at(from), shape.at(to)], profile, plain);
}

type Spot = (lateral: number, height: number) => number[];

function spotAt(shape: Shape, offset: number): Spot {
  const station = shape.at(offset);
  const lift = shape.lift(station);
  return (lateral, height) =>
    place(
      station,
      shape.spec.side * (shape.base(station) + lateral),
      height + lift,
    );
}

function bays(shape: Shape, spacing: number): Spot[] {
  const count = Math.max(2, Math.round(shape.span / spacing) + 1);
  return Array.from({ length: count }, (_, k) =>
    spotAt(shape, (shape.span * k) / (count - 1)),
  );
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

function backWall(parts: StandParts, shape: Shape): void {
  const back = walkway + shape.depth;
  sweep(
    parts.aisle,
    shape,
    shape.rows,
    [
      [back, shape.top + railRise],
      [back, -skirtBury],
    ],
    plain,
  );
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

function treadAt(shape: Shape, lateral: number): number {
  const row = Math.min(
    shape.spec.rows,
    Math.max(0, Math.floor((lateral - walkway) / rowDepth) + 1),
  );
  return frontRise + row * shape.rise;
}

function cover(parts: StandParts, shape: Shape, share: number): void {
  const back = walkway + shape.depth + roofBack * 0.5;
  const edge = walkway + shape.depth * (1 - share);
  const low = shape.top + coverClearance;
  const high = low + coverRise;
  const fascia = 0.6;
  const faces: [number, number][][] = [
    [
      [edge, high + roofThick],
      [back, low + roofThick],
    ],
    [
      [back, low],
      [edge, high],
    ],
    [
      [edge - 0.02, high - fascia],
      [edge - 0.02, high + roofThick],
    ],
    [
      [back, low + roofThick],
      [back, low],
    ],
  ];
  for (const face of faces)
    sweep(
      parts.roof,
      shape,
      shape.rows,
      face,
      plain,
      shape.reads !== shape.spec.side,
    );
  const inner = edge + 1.2;
  for (const at of bays(shape, coverColumns)) {
    beam(
      parts.frame,
      at(back - 0.25, -skirtBury),
      at(back - 0.25, low),
      coverColumn,
    );
    beam(
      parts.frame,
      at(inner, treadAt(shape, inner)),
      at(inner, high - 0.08),
      coverColumn * 0.75,
    );
    beam(
      parts.frame,
      at(edge, high - 0.15),
      at(back, low - 0.15),
      coverColumn * 0.7,
    );
  }
}

function seatBacks(parts: StandParts, shape: Shape, colour: string): void {
  const builder = parts.seats.get(colour) ?? new Builder(1);
  parts.seats.set(colour, builder);
  const gaps = aisleSpans(shape);
  const open: [number, number][] = [];
  let start = 0;
  for (const [from, to] of gaps) {
    open.push([start, from]);
    start = to;
  }
  open.push([start, shape.span]);
  for (const [from, to] of open) {
    if (to - from < 1) continue;
    const count = Math.max(2, Math.round((to - from) / step) + 1);
    const rows = Array.from({ length: count }, (_, k) =>
      shape.at(from + ((to - from) * k) / (count - 1)),
    );
    for (let k = 0; k < shape.spec.rows; k++) {
      const lateral = walkway + k * rowDepth + seatInset;
      const height = frontRise + k * shape.rise;
      sweep(
        builder,
        shape,
        rows,
        [
          [lateral, height + seatBack],
          [lateral + 0.04, height + 0.05],
        ],
        (station, _, rise) => [
          (station.s - shape.spec.from) / seatSpacing,
          rise,
        ],
      );
    }
  }
}

function rails(parts: StandParts, shape: Shape): void {
  const posts = bays(shape, railPosts);
  let before: number[] | null = null;
  for (const at of posts) {
    const top = at(0.12, frontRise + railRise);
    beam(parts.rail, at(0.12, frontRise), top, railPost);
    if (before) beam(parts.rail, before, top, railTube);
    before = top;
  }
  const back = walkway + shape.depth;
  for (const [from, to] of aisleSpans(shape))
    for (const offset of [from, to]) {
      const at = spotAt(shape, offset);
      const bottom = at(walkway, frontRise + aisleRail);
      const top = at(back, shape.top + aisleRail);
      beam(parts.rail, bottom, top, railTube);
      for (let k = 0; k <= shape.spec.rows; k += 4) {
        const lateral = walkway + k * rowDepth;
        const floor = frontRise + k * shape.rise;
        beam(
          parts.rail,
          at(lateral, floor),
          at(lateral, floor + aisleRail),
          railPost,
        );
      }
    }
}

function stairTower(parts: StandParts, shape: Shape, outward: number): void {
  const back = walkway + shape.depth;
  const front = back - stairReach;
  const edge = outward < 0 ? -0.4 : shape.span + 0.4;
  const lanes = [0, stairWide + stairGap].map((k) => edge + outward * k);
  const flights = Math.max(1, Math.ceil(shape.top / stairRise));
  const rise = shape.top / flights;
  const spot = (offset: number) => spotAt(shape, offset);
  for (let k = 0; k < flights; k++) {
    const lane = lanes[k % 2] ?? edge;
    const near = spot(lane);
    const far = spot(lane + outward * stairWide);
    const [from, to] = k % 2 === 0 ? [front, back] : [back, front];
    const first = parts.aisle.count;
    for (const [at, lateral, height] of [
      [near, from, k * rise],
      [far, from, k * rise],
      [far, to, (k + 1) * rise],
      [near, to, (k + 1) * rise],
    ] as const)
      parts.aisle.vertex(at(lateral, height), [0, 1, 0], [[lateral, height]]);
    parts.aisle.quad(first, first + 1, first + 2, first + 3);
    beam(
      parts.rail,
      near(from, k * rise + aisleRail),
      near(to, (k + 1) * rise + aisleRail),
      railTube,
    );
  }
  const far = lanes[1] ?? edge;
  for (const offset of [edge, far + outward * stairWide])
    for (const lateral of [front, back])
      beam(
        parts.frame,
        spot(offset)(lateral, -skirtBury),
        spot(offset)(lateral, shape.top + railRise),
        stairPost,
      );
}

function crestFlags(parts: StandParts, shape: Shape, spacing: number): void {
  const back = walkway + shape.depth + 0.3;
  const row = signRow("flag");
  const count = Math.max(1, Math.floor(shape.span / spacing));
  const share = flagWide / flagTall / signAspect;
  const normal = [shape.spec.side, 0, 0];
  for (let k = 0; k < count; k++) {
    const offset = (shape.span * (k + 0.5)) / count;
    const pole = spotAt(shape, offset);
    beam(
      parts.rail,
      pole(back, shape.top),
      pole(back, shape.top + flagPole),
      0.08,
    );
    const first = parts.sign.count;
    for (let c = 0; c <= flagColumns; c++) {
      const u = c / flagColumns;
      const spot = spotAt(shape, Math.min(shape.span, offset + u * flagWide));
      const wave = Math.sin(u * Math.PI * 1.6 + k * 1.7) * flagWave * u;
      for (const rise of [0, 1])
        parts.sign.vertex(
          spot(back + wave, shape.top + flagPole - flagTall * (1 - rise)),
          normal,
          [[u * share, signV(row, rise)]],
        );
    }
    for (let c = 0; c < flagColumns; c++) {
      const a = first + c * 2;
      parts.sign.quad(a, a + 2, a + 3, a + 1);
    }
  }
}

function crestPanel(parts: StandParts, shape: Shape, name: string): void {
  const back = walkway + shape.depth + 0.15;
  const from = shape.top + backLift;
  signStrip(parts.sign, shape, name, back, from, backTall, 1);
  for (const at of bays(shape, postSpacing))
    beam(
      parts.frame,
      at(back + 0.12, shape.top),
      at(back + 0.12, from + backTall),
      post,
    );
}

function cladding(parts: StandParts, shape: Shape, name: string): void {
  const back = walkway + shape.depth + braceReach + 0.2;
  const band = Math.min(cladTall, shape.top * 0.45);
  const from = shape.top * cladLift;
  sweep(
    parts.red,
    shape,
    shape.rows,
    [
      [back, -skirtBury],
      [back, from],
    ],
    plain,
  );
  sweep(
    parts.red,
    shape,
    shape.rows,
    [
      [back, from + band],
      [back, shape.top + railRise],
    ],
    plain,
  );
  signStrip(parts.sign, shape, name, back + 0.01, from, band, -1);
}

function build(parts: StandParts, shape: Shape): void {
  const { spec } = shape;
  sweep(parts.deck, shape, shape.rows, steps(spec.rows, shape.rise), plain);
  front(parts, shape);
  const first = shape.rows[0];
  const last = shape.rows[shape.rows.length - 1];
  if (first) end(parts, shape, first);
  if (last) end(parts, shape, last);
  aisles(parts, shape);
  if (spec.solid) backWall(parts, shape);
  else {
    scaffold(parts, shape);
    underframe(parts, shape);
  }
  if (spec.roof) canopy(parts, shape);
  dressed(parts, shape);
}

function dressed(parts: StandParts, shape: Shape): void {
  const { spec } = shape;
  if (spec.cover) cover(parts, shape, spec.cover);
  if (spec.seat) {
    seatBacks(parts, shape, spec.seat);
    rails(parts, shape);
    if (shape.scaffolded) {
      stairTower(parts, shape, -1);
      stairTower(parts, shape, 1);
    }
  }
  if (spec.crest) crestPanel(parts, shape, spec.crest);
  if (spec.clad) cladding(parts, shape, spec.clad);
  if (spec.flags) crestFlags(parts, shape, spec.flags);
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
  const height = frontRise + row * shape.rise;
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
