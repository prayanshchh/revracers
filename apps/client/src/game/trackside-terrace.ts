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
import { bannerPanel } from "./trackside-gantry.ts";
import { boardRow, floorHeight, wrapV } from "./trackside-plan.ts";
import type { Zone } from "./trackside-props.ts";

export interface Terrace {
  from: number;
  to: number;
  side: number;
  back: number;
  floors: number;
}

export interface FlagRun {
  from: number;
  to: number;
  side: number;
  every: number;
}

export interface TerraceParts {
  glass: Builder;
  deck: Builder;
  frame: Builder;
  roof: Builder;
  glow: Builder;
}

const bay = 6;
const depth = 8;
const balcony = 1.8;
const slab = 0.28;
const railHeight = 1.05;
const rail = 0.06;
const column = 0.2;
const eave = 0.6;
const roofThick = 0.35;
const litFrom = floorHeight * 3;
const stripDrop = 0.12;
const stripShare = 0.4;
const stripTall = 0.04;
const stripDeep = 0.06;
const margin = 1;
const flagBack = 1.4;
const flagPole = 6.2;
const flagLow = 2.3;
const flagTall = 3.7;
const flagWide = 0.95;
const flagGap = 0.06;
const flagBoard = "revracers 26";
const poleSize = 0.09;

interface Line {
  stations: Station[];
  reach: number;
  base: number;
}

function lineOf(list: Station[], length: number, terrace: Terrace): Line {
  const span = wrap(terrace.to - terrace.from, length);
  const bays = Math.max(1, Math.round(span / bay));
  const stations = Array.from({ length: bays + 1 }, (_, k) =>
    stationAt(list, length, terrace.from + (span * k) / bays),
  );
  const wall = Math.max(...stations.map((s) => wallAt(s, terrace.side)));
  return {
    stations,
    reach: wall + terrace.back + balcony,
    base: Math.min(...stations.map((s) => s.y)),
  };
}

export function terraceZones(
  list: Station[],
  length: number,
  terraces: Terrace[],
): Zone[] {
  return terraces.map((terrace) => {
    const { reach } = lineOf(list, length, terrace);
    return {
      from: terrace.from,
      to: terrace.to,
      side: terrace.side,
      near: reach - balcony - margin,
      far: reach + depth + margin,
      trees: true,
    };
  });
}

function wall(
  glass: Builder,
  corners: [number[], number[]],
  heights: [number, number],
  runs: [number, number],
  normal: number[],
): void {
  const [from, to] = corners;
  const [low, high] = heights;
  const [start, end] = runs;
  const first = glass.count;
  glass.vertex(raised(from, low), normal, [[start, litFrom]]);
  glass.vertex(raised(to, low), normal, [[end, litFrom]]);
  glass.vertex(raised(to, high), normal, [[end, litFrom + high - low]]);
  glass.vertex(raised(from, high), normal, [[start, litFrom + high - low]]);
  glass.quad(first, first + 1, first + 2, first + 3);
}

function shell(
  parts: TerraceParts,
  line: Line,
  terrace: Terrace,
  step: number,
): void {
  const { stations, reach, base } = line;
  const top = base + terrace.floors * floorHeight;
  const spot = (station: Station, back: number) =>
    place(station, terrace.side * (reach + back), 0);
  const inward = (station: Station) => [
    -station.lx * terrace.side,
    0,
    -station.lz * terrace.side,
  ];
  stations.slice(0, -1).forEach((station, k) => {
    const next = stations[k + 1] ?? station;
    const runs: [number, number] = [k * step, (k + 1) * step];
    const heights: [number, number] = [base, top];
    wall(
      parts.glass,
      [spot(station, 0), spot(next, 0)],
      heights,
      runs,
      inward(station),
    );
    wall(
      parts.glass,
      [spot(station, depth), spot(next, depth)],
      heights,
      runs,
      inward(station).map((value) => -value),
    );
  });
  for (const end of [stations[0], stations[stations.length - 1]]) {
    if (!end) continue;
    wall(
      parts.glass,
      [spot(end, 0), spot(end, depth)],
      [base, top],
      [0, depth],
      [-end.lz, 0, end.lx],
    );
  }
}

interface Bay {
  station: Station;
  next: Station;
  side: number;
  step: number;
  axes: number[][];
}

function raised(point: number[], height: number): number[] {
  const [x = 0, , z = 0] = point;
  return [x, height, z];
}

function middle(bay: Bay, lateral: number, height: number): number[] {
  const from = place(bay.station, bay.side * lateral, 0);
  const to = place(bay.next, bay.side * lateral, 0);
  return raised(
    from.map((value, axis) => (value + (to[axis] ?? 0)) / 2),
    height,
  );
}

function balconyAt(
  parts: TerraceParts,
  bay: Bay,
  reach: number,
  level: number,
): void {
  box(
    parts.deck,
    middle(bay, reach - balcony / 2, level - slab / 2),
    [bay.step / 2, slab / 2, balcony / 2],
    bay.axes,
  );
  const edge = bay.side * (reach - balcony + rail);
  for (const height of [railHeight, railHeight / 2])
    beam(
      parts.frame,
      raised(place(bay.station, edge, 0), level + height),
      raised(place(bay.next, edge, 0), level + height),
      rail,
    );
}

function decks(
  parts: TerraceParts,
  line: Line,
  terrace: Terrace,
  step: number,
): void {
  const { stations, reach, base } = line;
  const top = base + terrace.floors * floorHeight;
  const front = reach - balcony;
  const cover = depth + balcony + eave;
  stations.forEach((station, k) => {
    const foot = place(station, terrace.side * front, 0);
    beam(parts.frame, raised(foot, base - 0.3), raised(foot, top), column);
    const next = stations[k + 1];
    if (!next) return;
    const bay = {
      station,
      next,
      side: terrace.side,
      step,
      axes: [[-station.lz, 0, station.lx], up, [station.lx, 0, station.lz]],
    };
    for (let floor = 1; floor < terrace.floors; floor++)
      balconyAt(parts, bay, reach, base + floor * floorHeight);
    box(
      parts.roof,
      middle(bay, reach + depth - cover / 2, top + roofThick / 2),
      [step / 2 + 0.02, roofThick / 2, cover / 2],
      bay.axes,
    );
    box(
      parts.glow,
      middle(bay, front + 0.4, top - stripDrop),
      [step * stripShare, stripTall, stripDeep],
      bay.axes,
    );
  });
}

export function terraceParts(
  list: Station[],
  length: number,
  terraces: Terrace[],
): TerraceParts {
  const parts = {
    glass: new Builder(1),
    deck: new Builder(1),
    frame: new Builder(1),
    roof: new Builder(1),
    glow: new Builder(1),
  };
  for (const terrace of terraces) {
    const line = lineOf(list, length, terrace);
    const step =
      wrap(terrace.to - terrace.from, length) / (line.stations.length - 1);
    shell(parts, line, terrace, step);
    decks(parts, line, terrace, step);
  }
  return parts;
}

export function flagParts(
  list: Station[],
  length: number,
  runs: FlagRun[],
): { cloth: Builder; poles: Builder } {
  const cloth = new Builder(1);
  const poles = new Builder(1);
  const row = boardRow(flagBoard);
  for (const run of runs) {
    const count = Math.floor(wrap(run.to - run.from, length) / run.every);
    for (let k = 0; k <= count; k++) {
      const station = stationAt(list, length, run.from + k * run.every);
      const out = wallAt(station, run.side) + flagBack;
      const at = (across: number, height: number) =>
        place(station, run.side * (out + across), height);
      beam(poles, at(0, -0.3), at(0, flagPole), poleSize);
      const ahead = [-station.lz, 0, station.lx];
      const edges = run.side > 0 ? [flagWide, flagGap] : [flagGap, flagWide];
      const corners = [0, 1, 1, 0].map((far, k) => ({
        across: edges[far] ?? 0,
        rise: k < 2 ? 0 : 1,
      }));
      for (const side of [-1, 1]) {
        const free = side * run.side < 0 ? 1 : 0;
        bannerPanel(
          cloth,
          corners.map(({ across, rise }) =>
            at(across, flagLow + rise * flagTall).map(
              (value, axis) => value + (ahead[axis] ?? 0) * side * 0.02,
            ),
          ),
          ahead.map((value) => value * side),
          corners.map(({ across, rise }) => [
            rise * 0.5,
            wrapV(row, across === flagWide ? free : 1 - free),
          ]),
          side < 0,
        );
      }
    }
  }
  return { cloth, poles };
}
