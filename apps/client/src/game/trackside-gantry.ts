import {
  box,
  Builder,
  place,
  type Station,
  stationAt,
  up,
} from "./training-layout.ts";
import { beam } from "./street-layout.ts";
import {
  boardRow,
  type GantrySpec,
  wrapAspect,
  wrapV,
} from "./trackside-plan.ts";

const margin = 2.2;
const sink = 1.5;
const trussClear = 5.8;
const bannerHeight = 4.6;
const towerSize = 1.2;
const chord = 0.16;
const brace = 0.09;
const bay = 2.4;
const bridgeClear = 5.6;
const deckDepth = 4.2;
const deckThick = 0.55;
const parapetDrop = 0.35;
const pierSize = 0.9;
const stairRun = 12;
const stairWidth = 1.7;
const stringer = 0.3;
const handrail = 0.07;
const railHeight = 1.05;
const faceGap = 0.04;
const lockups = 2;
const fillerEdge = 0.012;

export interface GantryParts {
  steel: Builder;
  faces: Builder;
  deck: Builder;
}

interface Frame {
  station: Station;
  forward: number[];
  left: number;
  right: number;
  tall: number;
}

type Spot = (lateral: number, height: number, along: number) => number[];

function spotOf(frame: Frame): Spot {
  return (lateral, height, along) =>
    place(frame.station, lateral, height).map(
      (value, axis) => value + (frame.forward[axis] ?? 0) * along,
    );
}

function tower(steel: Builder, at: Spot, lateral: number, top: number): void {
  const half = towerSize / 2;
  const corners: [number, number][] = [
    [-half, -half],
    [half, -half],
    [half, half],
    [-half, half],
  ];
  for (const [across, along] of corners)
    beam(
      steel,
      at(lateral + across, -sink, along),
      at(lateral + across, top, along),
      chord,
    );
  const levels = Math.max(1, Math.round(top / bay));
  for (let level = 1; level <= levels; level++) {
    const high = (top * level) / levels;
    const low = (top * (level - 1)) / levels;
    corners.forEach(([across, along], index) => {
      const [nextAcross = 0, nextAlong = 0] = corners[(index + 1) % 4] ?? [];
      const far = at(lateral + nextAcross, high, nextAlong);
      beam(steel, at(lateral + across, high, along), far, brace);
      beam(steel, at(lateral + across, low, along), far, brace);
    });
  }
}

function span(steel: Builder, at: Spot, frame: Frame, low: number): void {
  const high = low + frame.tall;
  const half = towerSize / 2;
  const width = frame.left + frame.right;
  const bays = Math.max(2, Math.round(width / bay));
  for (const along of [-half, half]) {
    for (const height of [low, high])
      beam(
        steel,
        at(frame.left, height, along),
        at(-frame.right, height, along),
        chord,
      );
    for (let k = 0; k <= bays; k++) {
      const lateral = frame.left - (width * k) / bays;
      beam(steel, at(lateral, low, along), at(lateral, high, along), brace);
      if (k === bays) continue;
      const next = frame.left - (width * (k + 1)) / bays;
      const rising = k % 2 === 0;
      beam(
        steel,
        at(lateral, rising ? low : high, along),
        at(next, rising ? high : low, along),
        brace,
      );
    }
  }
  for (let k = 0; k <= bays; k += 2) {
    const lateral = frame.left - (width * k) / bays;
    for (const height of [low, high])
      beam(steel, at(lateral, height, -half), at(lateral, height, half), brace);
  }
}

type Column = [number, number];

function bannerColumns(frame: Frame, tall: number): Column[][] {
  const left = frame.left + towerSize / 2;
  const right = frame.right + towerSize / 2;
  const width = left + right;
  const lockup = (tall * wrapAspect) / lockups;
  const shown = Math.min(lockups, Math.max(1, Math.floor(width / lockup)));
  const centre = Math.min(width, shown * lockup);
  const middle = (left - right) / 2;
  const share = shown / lockups;
  return [
    [
      [left, fillerEdge],
      [middle + centre / 2, fillerEdge],
    ],
    [
      [middle + centre / 2, 0],
      [middle - centre / 2, share],
    ],
    [
      [middle - centre / 2, share - fillerEdge],
      [-right, share - fillerEdge],
    ],
  ];
}

export function bannerPanel(
  faces: Builder,
  corners: number[][],
  normal: number[],
  uvs: number[][],
  flipped: boolean,
): void {
  const first = faces.count;
  corners.forEach((corner, k) => {
    faces.vertex(corner, normal, [uvs[k] ?? [0, 0]]);
  });
  if (flipped) faces.quad(first, first + 3, first + 2, first + 1);
  else faces.quad(first, first + 1, first + 2, first + 3);
}

function banner(
  faces: Builder,
  at: Spot,
  frame: Frame,
  row: number,
  shape: { low: number; high: number; depth: number },
): void {
  const tall = shape.high - shape.low;
  const columns = bannerColumns(frame, tall);
  const share = columns[1]?.[1]?.[1] ?? 1;
  for (const side of [-1, 1]) {
    const along = side * (shape.depth / 2 + faceGap);
    const normal = frame.forward.map((value) => value * side);
    for (const [near, far] of columns) {
      if (!near || !far) continue;
      const order: [Column, number][] = [
        [near, 0],
        [far, 0],
        [far, 1],
        [near, 1],
      ];
      bannerPanel(
        faces,
        order.map(([[lateral], rise]) =>
          at(lateral, shape.low + rise * tall, along),
        ),
        normal,
        order.map(([[, u], rise]) => [
          side > 0 ? share - u : u,
          wrapV(row, rise),
        ]),
        side < 0,
      );
    }
  }
}

function stairs(steel: Builder, at: Spot, lateral: number, top: number): void {
  const reach = stairWidth / 2;
  for (const across of [-reach, reach]) {
    beam(
      steel,
      at(lateral + across, top, deckDepth / 2),
      at(lateral + across, -0.2, deckDepth / 2 + stairRun),
      stringer,
    );
    beam(
      steel,
      at(lateral + across, top + railHeight, deckDepth / 2),
      at(lateral + across, railHeight - 0.2, deckDepth / 2 + stairRun),
      handrail,
    );
    for (let k = 0; k <= 4; k++) {
      const share = k / 4;
      const along = deckDepth / 2 + stairRun * share;
      const height = top * (1 - share) - 0.2 * share;
      beam(
        steel,
        at(lateral + across, height, along),
        at(lateral + across, height + railHeight, along),
        handrail,
      );
    }
  }
}

function truss(parts: GantryParts, frame: Frame, row: number): void {
  const at = spotOf(frame);
  const top = trussClear + frame.tall;
  tower(parts.steel, at, frame.left, top);
  tower(parts.steel, at, -frame.right, top);
  span(parts.steel, at, frame, trussClear);
  banner(parts.faces, at, frame, row, {
    low: trussClear,
    high: top,
    depth: towerSize,
  });
}

function bridge(
  parts: GantryParts,
  frame: Frame,
  row: number,
  stepped: boolean,
): void {
  const at = spotOf(frame);
  const middle = (frame.left - frame.right) / 2;
  const half = (frame.left + frame.right) / 2 + towerSize / 2;
  const axes = [[frame.station.lx, 0, frame.station.lz], up, frame.forward];
  box(
    parts.deck,
    at(middle, bridgeClear + deckThick / 2, 0),
    [half, deckThick / 2, deckDepth / 2],
    axes,
  );
  const pierTop = bridgeClear + sink;
  for (const lateral of [frame.left, -frame.right])
    for (const along of [-1, 1])
      box(
        parts.deck,
        at(
          lateral,
          (bridgeClear - sink) / 2,
          (along * (deckDepth - pierSize)) / 2,
        ),
        [pierSize / 2, pierTop / 2, pierSize / 2],
        axes,
      );
  banner(parts.faces, at, frame, row, {
    low: bridgeClear - parapetDrop,
    high: bridgeClear - parapetDrop + frame.tall,
    depth: deckDepth,
  });
  if (!stepped) return;
  const landing = bridgeClear + deckThick;
  stairs(parts.steel, at, frame.left + stairWidth, landing);
  stairs(parts.steel, at, -frame.right - stairWidth, landing);
}

function frameOf(station: Station, spec: GantrySpec): Frame {
  const reach = spec.reach ? station.half + spec.reach : null;
  const room = spec.margin ?? margin;
  return {
    station,
    forward: [-station.lz, 0, station.lx],
    left: spec.left ?? reach ?? station.wallLeft + room,
    right: spec.right ?? reach ?? station.wallRight + room,
    tall: spec.height ?? bannerHeight,
  };
}

export function gantryParts(
  list: Station[],
  length: number,
  specs: GantrySpec[],
): GantryParts {
  const parts = {
    steel: new Builder(1),
    faces: new Builder(1),
    deck: new Builder(1),
  };
  for (const spec of specs) {
    const frame = frameOf(stationAt(list, length, spec.at), spec);
    const row = boardRow(spec.board);
    if (spec.kind === "truss") truss(parts, frame, row);
    else bridge(parts, frame, row, spec.kind === "bridge");
  }
  return parts;
}
