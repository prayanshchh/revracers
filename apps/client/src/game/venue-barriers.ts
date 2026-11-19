import {
  box,
  Builder,
  place,
  type Station,
  stationAt,
  up,
  wrap,
} from "./training-layout.ts";
import { beam, wallAt } from "./street-layout.ts";
import { type Atlas } from "./trackside-plan.ts";
import { type Height } from "./trackside-props.ts";

interface Run {
  from: number;
  to: number;
  side: number;
}

export interface Armco extends Run {
  rails?: number;
}

export interface Hoarding extends Run {
  board: string;
  low?: number;
  tall?: number;
  back?: number;
  repeat?: number;
}

const railStep = 2;
const railPitch = 0.3;
const railFirst = 0.42;
const railHalf = 0.155;
const railProfile: [number, number][] = [
  [0, -1],
  [0.06, -0.52],
  [0.012, 0],
  [0.06, 0.52],
  [0, 1],
];
const railFace = 0.02;
const postBehind = 0.12;
const postSize = 0.12;
const postSink = 0.6;
const spacer = [0.06, 0.1, 0.05];
const boardStep = 2;
const boardInset = 0.06;
const boardLow = 1.1;
const boardTall = 1.3;
const backing = 0.04;
const strutSpacing = 4;
const strutSize = 0.08;
const floorReach = 3;

function stations(list: Station[], length: number, run: Run, step: number) {
  const span = wrap(run.to - run.from, length);
  const count = Math.max(1, Math.round(span / step));
  return Array.from({ length: count + 1 }, (_, k) =>
    stationAt(list, length, run.from + (k * span) / count),
  );
}

interface WallPoint {
  at: (lift: number, toward?: number) => number[];
}

function wallPoints(
  rows: Station[],
  side: number,
  inset: number,
  ground: Height,
): WallPoint[] {
  const laterals = rows.map(
    (station) => side * (wallAt(station, side) + inset),
  );
  const floors = rows.map((station, i) => {
    const [x = 0, , z = 0] = place(station, laterals[i] ?? 0, 0);
    return ground(x, z) ?? station.y;
  });
  return rows.map((station, i) => {
    const near = floors.slice(Math.max(0, i - floorReach), i + floorReach + 1);
    const floor = near.reduce((sum, value) => sum + value, 0) / near.length;
    const lateral = laterals[i] ?? 0;
    return {
      at: (lift, toward = 0) => {
        const [px = 0, , pz = 0] = place(station, lateral - side * toward, 0);
        return [px, floor + lift, pz];
      },
    };
  });
}

export function armcoParts(
  list: Station[],
  length: number,
  runs: Armco[],
  ground: Height,
): { rails: Builder; posts: Builder } {
  const rails = new Builder(1);
  const posts = new Builder(1);
  for (const run of runs) {
    const rows = stations(list, length, run, railStep);
    const points = wallPoints(rows, run.side, -railFace, ground);
    const count = run.rails ?? 3;
    for (let rail = 0; rail < count; rail++) {
      const centre = railFirst + rail * railPitch;
      railProfile.slice(0, -1).forEach(([d0, h0], k) => {
        const [d1 = 0, h1 = 0] = railProfile[k + 1] ?? [];
        for (let i = 0; i + 1 < points.length; i++) {
          const a = points[i];
          const b = points[i + 1];
          const station = rows[i];
          if (!a || !b || !station) continue;
          const rise = (d1 - d0) * 6;
          const size = Math.hypot(1, rise);
          const normal = [
            (-run.side * station.lx) / size,
            rise / size,
            (-run.side * station.lz) / size,
          ];
          const first = rails.count;
          const corners = [
            a.at(centre + h0 * railHalf, d0),
            b.at(centre + h0 * railHalf, d0),
            b.at(centre + h1 * railHalf, d1),
            a.at(centre + h1 * railHalf, d1),
          ];
          for (const corner of corners) rails.vertex(corner, normal, [[0, 0]]);
          if (run.side > 0) rails.quad(first, first + 1, first + 2, first + 3);
          else rails.quad(first, first + 3, first + 2, first + 1);
        }
      });
    }
    const top = railFirst + (count - 1) * railPitch + railHalf;
    points.forEach((point, i) => {
      const station = rows[i];
      if (!station) return;
      const axes = [
        [station.lx, 0, station.lz],
        up,
        [-station.lz, 0, station.lx],
      ];
      beam(
        posts,
        point.at(-postSink, -postBehind),
        point.at(top, -postBehind),
        postSize,
      );
      for (let rail = 0; rail < count; rail++)
        box(
          posts,
          point.at(railFirst + rail * railPitch, -postBehind / 2),
          spacer,
          axes,
        );
    });
  }
  return { rails, posts };
}

interface Sheet {
  side: number;
  row: number;
  low: number;
  tall: number;
  back: number;
}

function sheetOf(run: Hoarding, atlas: Atlas): Sheet {
  return {
    side: run.side,
    row: atlas.row(run.board),
    low: run.low ?? boardLow,
    tall: run.tall ?? boardTall,
    back: run.back ?? 0,
  };
}

function facing(builder: Builder, first: number, side: number): void {
  if (side > 0) builder.quad(first, first + 1, first + 2, first + 3);
  else builder.quad(first, first + 3, first + 2, first + 1);
}

function panel(
  parts: { faces: Builder; frame: Builder },
  sheet: Sheet,
  ends: [WallPoint, WallPoint],
  station: Station,
  u: [number, number],
  atlas: Atlas,
): void {
  const [a, b] = ends;
  const [u0, u1] = u;
  const { low, tall, row, side } = sheet;
  const normal = [-side * station.lx, 0, -side * station.lz];
  const first = parts.faces.count;
  parts.faces.vertex(a.at(low), normal, [[u0, atlas.v(row, 0)]]);
  parts.faces.vertex(b.at(low), normal, [[u1, atlas.v(row, 0)]]);
  parts.faces.vertex(b.at(low + tall), normal, [[u1, atlas.v(row, 1)]]);
  parts.faces.vertex(a.at(low + tall), normal, [[u0, atlas.v(row, 1)]]);
  facing(parts.faces, first, side);
  const back = parts.frame.count;
  const away = normal.map((v) => -v);
  for (const corner of [
    a.at(low - 0.03, -backing),
    b.at(low - 0.03, -backing),
    b.at(low + tall + 0.03, -backing),
    a.at(low + tall + 0.03, -backing),
  ])
    parts.frame.vertex(corner, away, [[0, 0]]);
  facing(parts.frame, back, -side);
}

function struts(
  frame: Builder,
  sheet: Sheet,
  points: WallPoint[],
  along: number,
): void {
  const count = Math.max(1, Math.round(along / strutSpacing));
  for (let k = 0; k <= count; k++) {
    const point = points[Math.round((k * (points.length - 1)) / count)];
    if (!point) continue;
    beam(
      frame,
      point.at(-0.3, -backing * 2),
      point.at(sheet.low + sheet.tall, -backing * 2),
      strutSize,
    );
    if (sheet.back > 0.5)
      beam(
        frame,
        point.at(-0.3, -backing * 2 - sheet.back * 0.8),
        point.at(sheet.low + sheet.tall * 0.6, -backing * 2),
        strutSize * 0.7,
      );
  }
}

function spacing(a: WallPoint, b: WallPoint): number {
  const [ax = 0, , az = 0] = a.at(0);
  const [bx = 0, , bz = 0] = b.at(0);
  return Math.hypot(bx - ax, bz - az);
}

export function hoardingParts(
  list: Station[],
  length: number,
  runs: Hoarding[],
  ground: Height,
  atlas: Atlas,
): { faces: Builder; frame: Builder } {
  const parts = { faces: new Builder(1), frame: new Builder(1) };
  for (const run of runs) {
    const sheet = sheetOf(run, atlas);
    const rows = stations(list, length, run, boardStep);
    const points = wallPoints(rows, run.side, sheet.back + boardInset, ground);
    const tile =
      (sheet.tall * atlas.aspect) /
      (run.repeat ?? 1) /
      Math.sign(run.side || 1);
    let along = 0;
    for (let i = 0; i + 1 < points.length; i++) {
      const a = points[i];
      const b = points[i + 1];
      const station = rows[i];
      if (!a || !b || !station) continue;
      const step = spacing(a, b);
      panel(
        parts,
        sheet,
        [a, b],
        station,
        [along / tile, (along + step) / tile],
        atlas,
      );
      along += step;
    }
    struts(parts.frame, sheet, points, along);
  }
  return parts;
}

export interface Billboard {
  at: number;
  lateral: number;
  board: string;
  wide: number;
  tall: number;
  low: number;
  turn?: number;
}

const billboardTurn = 0.9;
const billboardLeg = 0.12;
const billboardDepth = 0.1;

function billboard(
  parts: { faces: Builder; frame: Builder },
  station: Station,
  sign: Billboard,
  ground: Height,
  atlas: Atlas,
): void {
  const side = Math.sign(sign.lateral) || 1;
  const forward = [-station.lz, 0, station.lx];
  const inward = [-side * station.lx, 0, -side * station.lz];
  const turn = sign.turn ?? billboardTurn;
  const normal = forward.map(
    (v, i) => -v * Math.cos(turn) + (inward[i] ?? 0) * Math.sin(turn),
  );
  const right = [normal[2] ?? 0, 0, -(normal[0] ?? 0)];
  const [x = 0, , z = 0] = place(station, sign.lateral, 0);
  const floor = ground(x, z) ?? station.y;
  const at = (a: number, b: number, c: number) =>
    [x, floor, z].map(
      (v, i) =>
        v + (right[i] ?? 0) * a + (up[i] ?? 0) * b + (normal[i] ?? 0) * c,
    );
  const half = sign.wide / 2;
  const middle = sign.low + sign.tall / 2;
  box(
    parts.frame,
    at(0, middle, -billboardDepth),
    [half + 0.05, sign.tall / 2 + 0.05, billboardDepth],
    [right, up, normal],
  );
  for (const a of [-0.7, 0.7])
    beam(
      parts.frame,
      at(a * half, -0.4, -billboardDepth),
      at(a * half, sign.low, -billboardDepth),
      billboardLeg,
    );
  const row = atlas.row(sign.board);
  const first = parts.faces.count;
  const corners: [number, number, number][] = [
    [-1, 0, 0],
    [1, 0, 1],
    [1, 1, 1],
    [-1, 1, 0],
  ];
  for (const [a, b, u] of corners)
    parts.faces.vertex(at(a * half, sign.low + b * sign.tall, 0.01), normal, [
      [u, atlas.v(row, b)],
    ]);
  parts.faces.quad(first, first + 1, first + 2, first + 3);
}

export function billboardParts(
  list: Station[],
  length: number,
  signs: Billboard[],
  ground: Height,
  atlas: Atlas,
): { faces: Builder; frame: Builder } {
  const parts = { faces: new Builder(1), frame: new Builder(1) };
  for (const sign of signs)
    billboard(parts, stationAt(list, length, sign.at), sign, ground, atlas);
  return parts;
}
