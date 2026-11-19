import { box, type Builder } from "./training-layout.ts";
import { beam } from "./street-layout.ts";
import { realBoards } from "./trackside-boards.ts";

export interface Rig {
  at: (lateral: number, height: number, along: number) => number[];
  axes: number[][];
  forward: number[];
}

const rungPitch = 0.3;
const ladderWide = 0.45;
const ladderRail = 0.05;
const rung = 0.03;
const plateThick = 0.04;
const bolt = [0.04, 0.05, 0.04];
const gusset = [0.32, 0.32, 0.015];
const balusterPitch = 1.5;
const baluster = 0.05;
const handrail = 0.055;
const lampHousing = [0.28, 0.12, 0.2];
const tread = 0.18;
const ledDepth = 0.18;

export function ladder(
  steel: Builder,
  rig: Rig,
  spot: [number, number],
  rise: [number, number],
): void {
  const [lateral, along] = spot;
  const [low, high] = rise;
  for (const side of [-1, 1])
    beam(
      steel,
      rig.at(lateral + (side * ladderWide) / 2, low, along),
      rig.at(lateral + (side * ladderWide) / 2, high, along),
      ladderRail,
    );
  for (let h = low + rungPitch; h < high; h += rungPitch)
    beam(
      steel,
      rig.at(lateral - ladderWide / 2, h, along),
      rig.at(lateral + ladderWide / 2, h, along),
      rung,
    );
}

export function basePlate(
  dark: Builder,
  rig: Rig,
  lateral: number,
  floor: number,
  half: number,
): void {
  box(
    dark,
    rig.at(lateral, floor + 0.45 + plateThick / 2, 0),
    [half + 0.15, plateThick / 2, half + 0.15],
    rig.axes,
  );
  for (const a of [-1, 1])
    for (const c of [-1, 1])
      box(
        dark,
        rig.at(lateral + a * (half + 0.06), floor + 0.5, c * (half + 0.06)),
        bolt,
        rig.axes,
      );
}

export function gussets(
  dark: Builder,
  rig: Rig,
  laterals: number[],
  heights: number[],
  along: number,
): void {
  for (const lateral of laterals)
    for (const height of heights)
      box(dark, rig.at(lateral, height, along), gusset, rig.axes);
}

export function balustrade(
  steel: Builder,
  rig: Rig,
  span: [number, number],
  along: number,
  floor: number,
): void {
  const [from, to] = span;
  const count = Math.max(1, Math.round(Math.abs(to - from) / balusterPitch));
  for (const height of [floor + 1.1, floor + 0.55])
    beam(
      steel,
      rig.at(from, height, along),
      rig.at(to, height, along),
      handrail,
    );
  for (let k = 0; k <= count; k++) {
    const lateral = from + ((to - from) * k) / count;
    beam(
      steel,
      rig.at(lateral, floor, along),
      rig.at(lateral, floor + 1.1, along),
      baluster,
    );
  }
}

export function lamps(
  dark: Builder,
  rig: Rig,
  span: [number, number],
  height: number,
  count: number,
): void {
  const [from, to] = span;
  for (let k = 0; k < count; k++) {
    const lateral = from + ((to - from) * (k + 0.5)) / count;
    box(dark, rig.at(lateral, height, 0), lampHousing, rig.axes);
  }
}

export function treads(
  concrete: Builder,
  rig: Rig,
  run: [number, number],
  rise: [number, number],
  lane: [number, number],
): void {
  const [start, end] = run;
  const [top, floor] = rise;
  const [along, width] = lane;
  const count = Math.max(2, Math.round((top - floor) / tread));
  for (let k = 0; k < count; k++) {
    const share = (k + 0.5) / count;
    const lateral = start + (end - start) * share;
    const height = top + (floor - top) * share;
    box(
      concrete,
      rig.at(lateral, height + 0.05, along),
      [Math.abs(end - start) / count / 2, 0.06, width / 2],
      rig.axes,
    );
  }
}

export function ledBoard(
  parts: { faces: Builder; dark: Builder },
  rig: Rig,
  centre: [number, number, number],
  half: [number, number],
  cell: number,
): void {
  const [lateral, height, along] = centre;
  const [wide, tall] = half;
  box(
    parts.dark,
    rig.at(lateral, height, along + ledDepth / 2),
    [wide + 0.06, tall + 0.06, ledDepth / 2],
    rig.axes,
  );
  const row = realBoards.row("timing");
  const normal = rig.forward.map((value) => -value);
  const first = parts.faces.count;
  const corners: [number, number, number][] = [
    [lateral + wide, height - tall, 0],
    [lateral - wide, height - tall, 1],
    [lateral - wide, height + tall, 1],
    [lateral + wide, height + tall, 0],
  ];
  for (const [x, y, u] of corners)
    parts.faces.vertex(rig.at(x, y, along - 0.01), normal, [
      [(cell + u) / 4, realBoards.v(row, y > height ? 1 : 0)],
    ]);
  parts.faces.quad(first, first + 1, first + 2, first + 3);
}
