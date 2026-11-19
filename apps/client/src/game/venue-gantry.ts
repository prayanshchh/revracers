import {
  box,
  Builder,
  type Station,
  stationAt,
  up,
} from "./training-layout.ts";
import { beam, wallAt } from "./street-layout.ts";
import { boardFill, realBoards } from "./trackside-boards.ts";
import { type Height } from "./trackside-props.ts";
import {
  balustrade,
  basePlate,
  gussets,
  ladder,
  lamps,
  ledBoard,
  treads,
} from "./venue-fittings.ts";

export interface Structure {
  at: number;
  board: string;
  back?: string;
  kind: string;
  leg?: number;
  tip?: number;
  top?: number;
  banner?: number;
  lockups?: number;
  skew?: number;
  lattice?: boolean;
  from?: number;
  to?: number;
  deck?: number;
  tower?: number;
  both?: boolean;
  towers?: string;
  depth?: number;
}

export interface StructureParts {
  faces: Builder;
  steel: Builder;
  dark: Builder;
  concrete: Builder;
}

const legClear = 0.9;
const sink = 1.2;
const legSize = 1.1;
const beamDepth = 1.0;
const cantileverTop = 7.9;
const cantileverBanner = 2.2;
const footing = [0.9, 0.35, 0.9];
const latticeChord = 0.14;
const latticeBrace = 0.07;
const latticeBay = 1.6;
const deckHeight = 7.2;
const deckWidth = 4.2;
const deckSlab = 0.55;
const trussDepth = 3.5;
const bridgeBanner = 2.6;
const pierSize = 1.0;
const towerSize = 4.6;
const towerRise = 6.2;
const rampRun = 16;
const rampWidth = 2.2;
const chord = 0.3;
const post = 0.16;
const rail = 0.06;
const trussBay = 3.2;
const startTop = 9.4;
const startBanner = 2.5;
const startDepth = 1.2;
const startPost = 0.9;
const podWide = 0.56;
const podTall = 1.75;
const podFront = 0.85;
const podBack = 0.3;
const podPitch = 0.64;
const podCount = 5;
const signBox = [1.3, 1.0, 0.3];
const signOffset = 2.4;
const ledHalf: [number, number] = [1.0, 0.5];
const lampHalf: [number, number] = [0.45, 0.45];
const pitTop = 5.6;
const pitPost = 0.35;
const scaffoldBack = 3;
const scaffoldWide = 12;
const scaffoldTop = 12;
const scaffoldDeep = 2.4;
const scaffoldBays = 4;
const scaffoldLift = 2;
const scaffoldTube = 0.08;

interface Frame {
  station: Station;
  axis: number[];
  forward: number[];
  at: (lateral: number, height: number, along: number) => number[];
  axes: number[][];
}

function frameOf(station: Station, skew: number): Frame {
  const turn = (skew * Math.PI) / 180;
  const lateral = [station.lx, 0, station.lz];
  const ahead = [-station.lz, 0, station.lx];
  const axis = lateral.map(
    (v, i) => v * Math.cos(turn) + (ahead[i] ?? 0) * Math.sin(turn),
  );
  const forward = ahead.map(
    (v, i) => v * Math.cos(turn) - (lateral[i] ?? 0) * Math.sin(turn),
  );
  const origin = [station.x, station.y, station.z];
  return {
    station,
    axis,
    forward,
    axes: [axis, up, forward],
    at: (lateral, height, along) =>
      origin.map(
        (v, i) =>
          v +
          (axis[i] ?? 0) * lateral +
          (up[i] ?? 0) * height +
          (forward[i] ?? 0) * along,
      ),
  };
}

function behindWall(station: Station, lateral: number): number {
  const sign = Math.sign(lateral) || 1;
  return sign * Math.max(Math.abs(lateral), wallAt(station, sign) + legClear);
}

function groundAt(frame: Frame, ground: Height, lateral: number): number {
  const [x = 0, , z = 0] = frame.at(lateral, 0, 0);
  return (ground(x, z) ?? frame.station.y) - frame.station.y;
}

function banner(
  faces: Builder,
  frame: Frame,
  span: [number, number],
  rise: [number, number],
  depth: number,
  rows: [number, number],
  lockups: number,
): void {
  const [a, b] = span;
  const [low, high] = rise;
  const tiles = lockups / 2;
  for (const side of [-1, 1]) {
    const row = side < 0 ? rows[0] : rows[1];
    const along = (side * depth) / 2 + side * 0.02;
    const normal = frame.forward.map((v) => v * side);
    const start = side < 0 ? Math.max(a, b) : Math.min(a, b);
    const end = side < 0 ? Math.min(a, b) : Math.max(a, b);
    const first = faces.count;
    const corners: [number, number, number][] = [
      [start, low, 0],
      [end, low, tiles],
      [end, high, tiles],
      [start, high, 0],
    ];
    for (const [lateral, height, u] of corners)
      faces.vertex(frame.at(lateral, height, along), normal, [
        [u, realBoards.v(row, height === high ? 1 : 0)],
      ]);
    if (side < 0) faces.quad(first, first + 1, first + 2, first + 3);
    else faces.quad(first, first + 3, first + 2, first + 1);
  }
}

function clad(
  faces: Builder,
  frame: Frame,
  centre: [number, number, number],
  half: number[],
  row: number,
): void {
  const [lateral, height, along] = centre;
  box(faces, frame.at(lateral, height, along), half, frame.axes, [
    boardFill(row),
  ]);
}

function footingOf(
  parts: StructureParts,
  frame: Frame,
  lateral: number,
  floor: number,
): void {
  box(
    parts.concrete,
    frame.at(lateral, floor + 0.1, 0),
    [footing[0] ?? 0, footing[1] ?? 0, footing[2] ?? 0],
    frame.axes,
  );
}

function latticeLeg(
  steel: Builder,
  frame: Frame,
  lateral: number,
  low: number,
  high: number,
): void {
  const half = legSize / 2 - latticeChord / 2;
  const corners: [number, number][] = [
    [-half, -half],
    [half, -half],
    [half, half],
    [-half, half],
  ];
  for (const [across, along] of corners)
    beam(
      steel,
      frame.at(lateral + across, low, along),
      frame.at(lateral + across, high, along),
      latticeChord,
    );
  const levels = Math.max(1, Math.round((high - low) / latticeBay));
  for (let level = 0; level < levels; level++) {
    const bottom = low + ((high - low) * level) / levels;
    const top = low + ((high - low) * (level + 1)) / levels;
    corners.forEach(([across, along], k) => {
      const [nextAcross = 0, nextAlong = 0] = corners[(k + 1) % 4] ?? [];
      const flip = level % 2 === 0;
      beam(
        steel,
        frame.at(lateral + across, flip ? bottom : top, along),
        frame.at(lateral + nextAcross, flip ? top : bottom, nextAlong),
        latticeBrace,
      );
      beam(
        steel,
        frame.at(lateral + across, top, along),
        frame.at(lateral + nextAcross, top, nextAlong),
        latticeBrace,
      );
    });
  }
}

function cantilever(
  parts: StructureParts,
  frame: Frame,
  spec: Structure,
  ground: Height,
): void {
  const row = realBoards.row(spec.board);
  const leg = behindWall(frame.station, spec.leg ?? frame.station.wallLeft);
  const tip = spec.tip ?? -Math.sign(leg) * frame.station.half;
  const top = spec.top ?? cantileverTop;
  const low = top - (spec.banner ?? cantileverBanner);
  const floor = groundAt(frame, ground, leg);
  const outer = leg + (Math.sign(leg) * legSize) / 2;
  footingOf(parts, frame, leg, floor);
  if (spec.lattice) latticeLeg(parts.steel, frame, leg, floor - sink, top);
  else
    clad(
      parts.faces,
      frame,
      [leg, (floor - sink + top) / 2, 0],
      [legSize / 2, (top - floor + sink) / 2, legSize / 2],
      row,
    );
  clad(
    parts.faces,
    frame,
    [(outer + tip) / 2, top + 0.06, 0],
    [Math.abs(outer - tip) / 2, 0.06, beamDepth / 2],
    row,
  );
  clad(
    parts.faces,
    frame,
    [(outer + tip) / 2, low - 0.06, 0],
    [Math.abs(outer - tip) / 2, 0.06, beamDepth / 2],
    row,
  );
  clad(
    parts.faces,
    frame,
    [tip - Math.sign(leg) * 0.04, (low + top) / 2, 0],
    [0.04, (top - low) / 2 + 0.12, beamDepth / 2],
    row,
  );
  banner(
    parts.faces,
    frame,
    [outer, tip],
    [low, top],
    beamDepth,
    [row, row],
    spec.lockups ?? 2,
  );
  basePlate(parts.dark, frame, leg, floor, legSize / 2);
  ladder(parts.steel, frame, [leg, legSize / 2 + 0.2], [floor + 0.5, top]);
  lamps(parts.dark, frame, [outer, tip], top + 0.24, 3);
}

function truss(
  steel: Builder,
  frame: Frame,
  span: [number, number],
  low: number,
  high: number,
  along: number,
): void {
  const [a, b] = span;
  const bays = Math.max(2, Math.round(Math.abs(b - a) / trussBay));
  beam(steel, frame.at(a, high, along), frame.at(b, high, along), chord);
  beam(steel, frame.at(a, low, along), frame.at(b, low, along), chord);
  for (let k = 0; k <= bays; k++) {
    const lateral = a + ((b - a) * k) / bays;
    beam(
      steel,
      frame.at(lateral, low, along),
      frame.at(lateral, high, along),
      post,
    );
    if (k === bays) continue;
    const next = a + ((b - a) * (k + 1)) / bays;
    const rising = k % 2 === 0;
    beam(
      steel,
      frame.at(lateral, rising ? low : high, along),
      frame.at(next, rising ? high : low, along),
      post,
    );
  }
}

function pier(
  parts: StructureParts,
  frame: Frame,
  lateral: number,
  floor: number,
  top: number,
): void {
  for (const along of [-1, 1])
    box(
      parts.concrete,
      frame.at(
        lateral,
        (floor - sink + top) / 2,
        (along * (deckWidth - pierSize)) / 2,
      ),
      [pierSize / 2, (top - floor + sink) / 2, pierSize / 2],
      frame.axes,
    );
}

function stairTower(
  parts: StructureParts,
  frame: Frame,
  lateral: number,
  rise: [number, number],
  cladding: number | null,
): void {
  const half = towerSize / 2;
  const [floor, top] = rise;
  const centre: [number, number, number] = [
    lateral,
    (floor - sink + top) / 2,
    0,
  ];
  const size = [half, (top - floor + sink) / 2, half];
  if (cladding === null)
    box(parts.concrete, frame.at(...centre), size, frame.axes);
  else clad(parts.faces, frame, centre, size, cladding);
  box(
    parts.dark,
    frame.at(lateral, top + 0.1, 0),
    [half + 0.3, 0.1, half + 0.3],
    frame.axes,
  );
  for (const level of [0.35, 0.65])
    box(
      parts.dark,
      frame.at(lateral, floor + (top - floor) * level, -half - 0.01),
      [half * 0.7, 0.9, 0.02],
      frame.axes,
    );
}

function ramp(
  parts: StructureParts,
  frame: Frame,
  start: number,
  ground: Height,
  deck: number,
): void {
  const sign = Math.sign(start) || 1;
  const end = start + sign * rampRun;
  const floor = groundAt(frame, ground, end);
  const along = deckWidth / 2 - rampWidth / 2;
  for (const edge of [-1, 1]) {
    const offset = along + (edge * rampWidth) / 2;
    beam(
      parts.steel,
      frame.at(start, deck, offset),
      frame.at(end, floor, offset),
      chord,
    );
    beam(
      parts.steel,
      frame.at(start, deck + 1.1, offset),
      frame.at(end, floor + 1.1, offset),
      rail,
    );
    for (let k = 1; k < 6; k++) {
      const share = k / 6;
      const lateral = start + (end - start) * share;
      const height = deck + (floor - deck) * share;
      beam(
        parts.steel,
        frame.at(lateral, height, offset),
        frame.at(lateral, height + 1.1, offset),
        rail,
      );
    }
  }
  const middle = (start + end) / 2;
  const height = (deck + floor) / 2;
  const slope = Math.atan2(deck - floor, Math.abs(end - start));
  const tilt = [
    frame.axis.map(
      (v, i) => v * Math.cos(slope) * sign + (up[i] ?? 0) * -Math.sin(slope),
    ),
    frame.axis.map(
      (v, i) => v * Math.sin(slope) * sign + (up[i] ?? 0) * Math.cos(slope),
    ),
    frame.forward,
  ];
  box(
    parts.concrete,
    frame.at(middle, height - 0.2, along),
    [Math.hypot(end - start, deck - floor) / 2, 0.2, rampWidth / 2],
    tilt,
  );
  treads(
    parts.concrete,
    frame,
    [start, end],
    [deck, floor],
    [along, rampWidth],
  );
  for (const k of [0.33, 0.66]) {
    const lateral = start + (end - start) * k;
    const top = deck + (floor - deck) * k;
    const base = groundAt(frame, ground, lateral);
    box(
      parts.concrete,
      frame.at(lateral, (base - sink + top) / 2, along),
      [0.35, (top - base + sink) / 2, 0.35],
      frame.axes,
    );
  }
}

interface Span {
  left: number;
  right: number;
  deck: number;
  row: number;
  width: number;
}

function spanOf(frame: Frame, spec: Structure): Span {
  return {
    left: behindWall(frame.station, spec.from ?? frame.station.wallLeft),
    right: behindWall(frame.station, spec.to ?? -frame.station.wallRight),
    deck: spec.deck ?? deckHeight,
    row: realBoards.row(spec.board),
    width: spec.depth ?? deckWidth,
  };
}

function walkway(parts: StructureParts, frame: Frame, span: Span): void {
  const { left, right, deck, row, width } = span;
  const top = deck + trussDepth;
  const middle = (left + right) / 2;
  const half = Math.abs(left - right) / 2;
  box(
    parts.dark,
    frame.at(middle, deck - deckSlab / 2, 0),
    [half + pierSize, deckSlab / 2, width / 2],
    frame.axes,
  );
  clad(
    parts.faces,
    frame,
    [middle, deck - deckSlab - 0.03, 0],
    [half + pierSize, 0.03, width / 2],
    row,
  );
  const bays = Math.max(2, Math.round((half * 2) / trussBay));
  const nodes = Array.from(
    { length: bays + 1 },
    (_, k) => left + ((right - left) * k) / bays,
  );
  for (const along of [-width / 2, width / 2]) {
    truss(parts.steel, frame, [left, right], deck, top, along * 0.92);
    balustrade(parts.steel, frame, [left, right], along * 0.8, deck);
    gussets(
      parts.dark,
      frame,
      nodes,
      [deck, top],
      along * 0.92 + Math.sign(along) * 0.13,
    );
  }
  lamps(parts.dark, frame, [left, right], deck - deckSlab - 0.15, bays);
  for (let k = 0; k <= bays; k += 2) {
    const lateral = left + ((right - left) * k) / bays;
    beam(
      parts.steel,
      frame.at(lateral, top, (-width / 2) * 0.92),
      frame.at(lateral, top, (width / 2) * 0.92),
      post,
    );
  }
  box(
    parts.steel,
    frame.at(middle, top + 0.12, 0),
    [half, 0.04, width / 2 + 0.3],
    frame.axes,
  );
}

function bridgeEnds(
  parts: StructureParts,
  frame: Frame,
  spec: Structure,
  span: Span,
  ground: Height,
): void {
  const { left, right, deck } = span;
  for (const lateral of [left, right])
    pier(
      parts,
      frame,
      lateral,
      groundAt(frame, ground, lateral),
      deck - deckSlab,
    );
  const tower = spec.tower ?? left;
  const other = Math.sign(tower) > 0 ? right : left;
  const towers = spec.both ? [tower, other] : [tower];
  const cladding =
    spec.towers === undefined ? null : realBoards.row(spec.towers);
  for (const end of towers) {
    const at = end + Math.sign(end) * (towerSize / 2 + pierSize / 2);
    const floor = groundAt(frame, ground, at);
    stairTower(parts, frame, at, [floor, deck + towerRise], cladding);
  }
  if (!spec.both)
    ramp(parts, frame, other + Math.sign(other) * pierSize, ground, deck);
}

function footbridge(
  parts: StructureParts,
  frame: Frame,
  spec: Structure,
  ground: Height,
): void {
  const span = spanOf(frame, spec);
  walkway(parts, frame, span);
  const low = span.deck - deckSlab;
  banner(
    parts.faces,
    frame,
    [span.left, span.right],
    [low, low + (spec.banner ?? bridgeBanner)],
    span.width * 0.92 + 0.3,
    [span.row, span.row],
    spec.lockups ?? 4,
  );
  bridgeEnds(parts, frame, spec, span, ground);
}

function lightPods(parts: StructureParts, frame: Frame, low: number): void {
  const pods = (podCount - 1) / 2;
  for (let k = 0; k < podCount; k++) {
    const lateral = (k - pods) * podPitch;
    box(
      parts.dark,
      frame.at(lateral, low - podTall / 2, -(podFront + podBack) / 2),
      [podWide / 2, podTall / 2, (podFront - podBack) / 2],
      frame.axes,
    );
    beam(
      parts.steel,
      frame.at(lateral, low - podTall, -podBack),
      frame.at(lateral, low, -podBack),
      0.05,
    );
  }
  beam(
    parts.steel,
    frame.at(-pods * podPitch - podWide, low - 0.08, -podBack),
    frame.at(pods * podPitch + podWide, low - 0.08, -podBack),
    0.12,
  );
  const [wide = 0, tall = 0, deep = 0] = signBox;
  box(
    parts.dark,
    frame.at(pods * podPitch + signOffset, low - tall / 2, -podFront / 2),
    [wide / 2, tall / 2, deep / 2],
    frame.axes,
  );
}

function startGantry(
  parts: StructureParts,
  frame: Frame,
  spec: Structure,
  ground: Height,
): void {
  const { right, row } = spanOf(frame, spec);
  const left = spec.from ?? frame.station.wallLeft;
  const top = spec.top ?? startTop;
  const low = top - (spec.banner ?? startBanner);
  for (const lateral of [left, right]) {
    const floor = groundAt(frame, ground, lateral);
    footingOf(parts, frame, lateral, floor);
    box(
      parts.steel,
      frame.at(lateral, (floor - sink + top) / 2, 0),
      [startPost / 2, (top - floor + sink) / 2, startPost / 2],
      frame.axes,
    );
  }
  box(
    parts.dark,
    frame.at((left + right) / 2, (low + top) / 2, 0),
    [
      Math.abs(left - right) / 2 + startPost / 2,
      (top - low) / 2,
      startDepth / 2,
    ],
    frame.axes,
  );
  banner(
    parts.faces,
    frame,
    [left + startPost / 2, right - startPost / 2],
    [low + 0.12, top - 0.12],
    startDepth,
    [row, realBoards.row(spec.back ?? spec.board)],
    spec.lockups ?? 4,
  );
  lightPods(parts, frame, low);
  const board = left + startPost / 2 + ledHalf[0] + 0.1;
  const heights = [low - ledHalf[1] - 0.2, low - 3 * ledHalf[1] - 0.35];
  heights.forEach((height, cell) => {
    ledBoard(parts, frame, [board, height, -startDepth / 2], ledHalf, cell);
  });
  beam(
    parts.steel,
    frame.at(left, low - 0.1, 0),
    frame.at(board + ledHalf[0], low - 0.1, 0),
    0.14,
  );
  for (const lateral of [left, right])
    basePlate(
      parts.dark,
      frame,
      lateral,
      groundAt(frame, ground, lateral),
      startPost / 2,
    );
}

function pitLights(
  parts: StructureParts,
  frame: Frame,
  spec: Structure,
  ground: Height,
): void {
  const left = spec.from ?? frame.station.half + 2;
  const right = spec.to ?? left + 8;
  const top = spec.top ?? pitTop;
  for (const lateral of [left, right]) {
    const floor = groundAt(frame, ground, lateral);
    box(
      parts.steel,
      frame.at(lateral, (floor - sink + top) / 2, 0),
      [pitPost / 2, (top - floor + sink) / 2, pitPost / 2],
      frame.axes,
    );
    basePlate(parts.dark, frame, lateral, floor, pitPost / 2);
  }
  box(
    parts.steel,
    frame.at((left + right) / 2, top - 0.2, 0),
    [Math.abs(left - right) / 2 + pitPost / 2, 0.2, 0.25],
    frame.axes,
  );
  const middle = (left + right) / 2;
  for (const [offset, cell] of [
    [-0.55, 2],
    [0.55, 3],
  ] as const)
    ledBoard(parts, frame, [middle + offset, top - 0.85, -0.3], lampHalf, cell);
}

interface Tower {
  centre: number;
  half: number;
  top: number;
  deep: number;
}

function towerOf(frame: Frame, spec: Structure): Tower {
  return {
    centre: spec.leg ?? frame.station.wallLeft + scaffoldBack,
    half: (spec.tip ?? scaffoldWide) / 2,
    top: spec.top ?? scaffoldTop,
    deep: spec.depth ?? scaffoldDeep,
  };
}

function scaffold(
  parts: StructureParts,
  frame: Frame,
  spec: Structure,
  ground: Height,
): void {
  const { centre, half, top, deep } = towerOf(frame, spec);
  const across = (k: number) => centre - half + (2 * half * k) / scaffoldBays;
  for (let k = 0; k <= scaffoldBays; k++)
    for (const along of [0, deep]) {
      const lateral = across(k);
      const floor = groundAt(frame, ground, lateral);
      beam(
        parts.steel,
        frame.at(lateral, floor - 0.3, along),
        frame.at(lateral, top, along),
        scaffoldTube,
      );
    }
  const floor = groundAt(frame, ground, centre);
  for (let h = floor + scaffoldLift; h <= top; h += scaffoldLift)
    for (const along of [0, deep])
      beam(
        parts.steel,
        frame.at(centre - half, h, along),
        frame.at(centre + half, h, along),
        scaffoldTube * 0.8,
      );
  for (let k = 0; k < scaffoldBays; k++)
    beam(
      parts.steel,
      frame.at(across(k), floor, deep),
      frame.at(across(k + 1), top, deep),
      scaffoldTube * 0.7,
    );
  box(
    parts.dark,
    frame.at(centre, floor + 0.2, deep / 2),
    [half + 0.3, 0.2, deep / 2 + 0.3],
    frame.axes,
  );
}

export function structureParts(
  list: Station[],
  length: number,
  specs: Structure[],
  ground: Height,
): StructureParts {
  const parts: StructureParts = {
    faces: new Builder(1),
    steel: new Builder(1),
    dark: new Builder(1),
    concrete: new Builder(1),
  };
  for (const spec of specs) {
    const frame = frameOf(stationAt(list, length, spec.at), spec.skew ?? 0);
    if (spec.kind === "footbridge") footbridge(parts, frame, spec, ground);
    else if (spec.kind === "start") startGantry(parts, frame, spec, ground);
    else if (spec.kind === "pit") pitLights(parts, frame, spec, ground);
    else if (spec.kind === "scaffold") scaffold(parts, frame, spec, ground);
    else cantilever(parts, frame, spec, ground);
  }
  return parts;
}
