import {
  box,
  Builder,
  type Part,
  place,
  type Station,
  stationAt,
  up,
  wrap,
} from "./training-layout.ts";
import { pitSign, spanRows, type StreetTrack } from "./street-layout.ts";

interface PitPath {
  centerline?: { x: number; z: number }[];
  garageFront?: number;
}

export type LaneEdges = (s: number) => [number, number] | null;

const laneHalf = 3.6;
const laneLift = 0.012;
const lineWidth = 0.2;
const lineLift = 0.016;
const blend = 30;
const mouth = 22;
const wallBack = 0.35;
const step = 2;
const chevronEvery = 5;
const chevronRun = 3.5;
const chevronWidth = 0.45;
const chevronMargin = 0.35;
const goreMinimum = 1.4;
const cushionLength = 6.3;
const cushionBlock = 0.9;
const cushionWide = 1.3;
const cushionNarrow = 0.75;
const cushionHeight = 1.05;
const exitCushion = 2.7;
const bollardEvery = 3.5;
const bollardCount = 9;
const bollardHeight = 0.95;
const bollardSize = 0.09;
const exitTrail = 90;
const speedLine = 0.5;

function ramp(value: number, from: number, to: number): number {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

function valueAt(values: number[], k: number): number {
  return values[k] ?? 0;
}

function stationOf(list: Station[], k: number): Station | undefined {
  return list[((k % list.length) + list.length) % list.length];
}

function nearest(
  list: Station[],
  p: { x: number; z: number },
  from: number,
  to: number,
): number {
  let found = from;
  let near = Infinity;
  for (let k = from; k <= to; k++) {
    const station = stationOf(list, k);
    const gap = station ? Math.hypot(p.x - station.x, p.z - station.z) : near;
    if (gap < near) {
      near = gap;
      found = k;
    }
  }
  return found;
}

function interpolate(us: number[], ls: number[], u: number): number {
  let k = 0;
  while (k + 1 < us.length && valueAt(us, k + 1) < u) k++;
  const u0 = valueAt(us, k);
  const u1 = k + 1 < us.length ? valueAt(us, k + 1) : u0;
  const t = u1 > u0 ? Math.min(1, Math.max(0, (u - u0) / (u1 - u0))) : 0;
  const l0 = valueAt(ls, k);
  const l1 = k + 1 < ls.length ? valueAt(ls, k + 1) : l0;
  return l0 + (l1 - l0) * t;
}

function guide(list: Station[], track: StreetTrack): (s: number) => number {
  const pit = track.pitLane as StreetTrack["pitLane"] & PitPath;
  const points = pit.centerline ?? [];
  const sign = pitSign(track);
  const { length } = track;
  const samples: [number, number][] = [];
  const start = points[0];
  let index = start ? nearest(list, start, 0, list.length - 1) : 0;
  for (const p of points) {
    index = nearest(list, p, index - 4, index + 12);
    const station = stationOf(list, index);
    if (!station) continue;
    const lateral =
      (p.x - station.x) * station.lx + (p.z - station.z) * station.lz;
    samples.push([wrap(station.s - pit.entry, length), lateral * sign]);
  }
  samples.sort((a, b) => a[0] - b[0]);
  const us = samples.map(([u]) => u);
  const ls = samples.map(([, l]) => l);
  return (s) => interpolate(us, ls, wrap(s - pit.entry, length));
}

export function laneEdges(list: Station[], track: StreetTrack): LaneEdges {
  const pit = track.pitLane as StreetTrack["pitLane"] & PitPath;
  const { length } = track;
  const centre = guide(list, track);
  const span = wrap(pit.exit - pit.entry, length);
  const open = wrap(pit.wallStart - pit.entry, length);
  const close = wrap(pit.wallEnd - pit.entry, length);
  const front = pit.garageFront ?? pit.pitWall + 14;
  return (s) => {
    const u = wrap(s - pit.entry, length);
    if (u > span) return null;
    const half = stationAt(list, length, s).half;
    const middle = centre(s);
    const zone =
      ramp(u, open - blend, open) * (1 - ramp(u, close, close + blend));
    const inner = Math.max(
      half + 0.05,
      middle - laneHalf + (pit.pitWall + wallBack - middle + laneHalf) * zone,
    );
    const outer = middle + laneHalf + (front - middle - laneHalf) * zone;
    const taper = ramp(u, 0, mouth) * ramp(span - u, 0, mouth);
    return [inner, Math.max(inner, inner + (outer - inner) * taper)];
  };
}

function ribbon(
  builder: Builder,
  rows: Station[],
  sign: number,
  edges: (station: Station) => [number, number] | null,
  lift: number,
): void {
  const kept = rows.filter((station) => edges(station) !== null);
  if (kept.length < 2) return;
  const first = builder.count;
  for (const station of kept) {
    const [a, b] = edges(station) ?? [0, 0];
    for (const distance of sign > 0 ? [a, b] : [b, a]) {
      const lateral = sign * distance;
      builder.vertex(place(station, lateral, lift), up, [
        [lateral / 2, station.s / 2],
        [0, 0],
      ]);
    }
  }
  builder.grid(kept.length, 2, first);
}

interface Zones {
  rows: Station[];
  entryRows: Station[];
  exitRows: Station[];
  trailRows: Station[];
}

function zones(list: Station[], track: StreetTrack): Zones {
  const pit = track.pitLane;
  const { length } = track;
  const rows = (from: number, to: number) =>
    spanRows(list, length, from, wrap(to - from, length), step);
  return {
    rows: rows(pit.entry, pit.exit),
    entryRows: rows(pit.entry, pit.wallStart),
    exitRows: rows(pit.wallEnd, pit.exit),
    trailRows: rows(pit.exit - mouth, pit.exit + exitTrail),
  };
}

function lines(
  paint: Builder,
  sign: number,
  edges: LaneEdges,
  zone: Zones,
): void {
  const parted = (station: Station) => {
    const found = edges(station.s);
    return found && found[0] > station.half + 0.3 ? found : null;
  };
  for (const rows of [zone.entryRows, zone.exitRows]) {
    ribbon(
      paint,
      rows,
      sign,
      (station) => {
        const found = parted(station);
        return found ? [found[0], found[0] + lineWidth] : null;
      },
      lineLift,
    );
    ribbon(
      paint,
      rows,
      sign,
      (station) => {
        const found = edges(station.s);
        return found && found[1] - found[0] > 2
          ? [found[1] - lineWidth, found[1]]
          : null;
      },
      lineLift,
    );
  }
  ribbon(
    paint,
    zone.trailRows,
    sign,
    (station) => {
      const found = edges(station.s);
      if (found && found[0] > station.half + 0.3) return null;
      return [station.half + 0.25, station.half + 0.25 + lineWidth];
    },
    lineLift,
  );
}

function across(
  paint: Builder,
  list: Station[],
  length: number,
  sign: number,
  edges: LaneEdges,
  s: number,
): void {
  const found = edges(s);
  if (!found) return;
  const first = paint.count;
  for (const at of [s, s + speedLine]) {
    const station = stationAt(list, length, at);
    for (const distance of sign > 0 ? found : [found[1], found[0]])
      paint.vertex(place(station, sign * distance, lineLift), up, [
        [distance / 2, at / 2],
      ]);
  }
  paint.quad(first, first + 2, first + 3, first + 1);
}

function chevron(
  list: Station[],
  length: number,
  sign: number,
  edges: LaneEdges,
  from: number,
): number[][] | null {
  const to = from + chevronRun;
  const near = stationAt(list, length, from);
  const nearEdge = edges(from);
  const farEdge = edges(to);
  if (!nearEdge || !farEdge) return null;
  const low = near.half + 0.25 + chevronMargin;
  const high = farEdge[0] - chevronMargin;
  if (nearEdge[0] - near.half < goreMinimum || high - low < 0.6) return null;
  return [
    place(near, sign * low, lineLift),
    place(stationAt(list, length, from + chevronWidth), sign * low, lineLift),
    place(stationAt(list, length, to + chevronWidth), sign * high, lineLift),
    place(stationAt(list, length, to), sign * high, lineLift),
  ];
}

function chevrons(
  paint: Builder,
  list: Station[],
  length: number,
  sign: number,
  edges: LaneEdges,
  rows: Station[],
): void {
  const first = rows[0]?.s ?? 0;
  const last = rows[rows.length - 1]?.s ?? first;
  const span = wrap(last - first, length);
  for (let u = 0; u + chevronRun + chevronWidth < span; u += chevronEvery) {
    const corners = chevron(list, length, sign, edges, first + u);
    if (!corners) continue;
    painted(paint, corners, sign);
  }
}

function painted(paint: Builder, corners: number[][], sign: number): void {
  const start = paint.count;
  for (const [x = 0, y = 0, z = 0] of corners)
    paint.vertex([x, y, z], up, [[x / 2, z / 2]]);
  if (sign < 0) paint.quad(start, start + 3, start + 2, start + 1);
  else paint.quad(start, start + 1, start + 2, start + 3);
}

interface Kit {
  red: Builder;
  white: Builder;
  orange: Builder;
}

function cushion(
  kit: Kit,
  list: Station[],
  length: number,
  sign: number,
  lateral: number,
  [from, to]: [number, number],
  noseAtStart: boolean,
): void {
  const blocks = Math.max(1, Math.round((to - from) / cushionBlock));
  for (let k = 0; k < blocks; k++) {
    const s = from + ((k + 0.5) * (to - from)) / blocks;
    const station = stationAt(list, length, s);
    const t = noseAtStart ? k / blocks : 1 - k / blocks;
    const width = cushionNarrow + (cushionWide - cushionNarrow) * t;
    const axes = [
      [station.lx, 0, station.lz],
      up,
      [-station.lz, 0, station.lx],
    ];
    box(
      k % 2 === 0 ? kit.red : kit.white,
      place(station, sign * lateral, cushionHeight / 2),
      [width / 2, cushionHeight / 2, ((to - from) / blocks) * 0.48],
      axes,
    );
  }
}

function bollard(kit: Kit, station: Station, lateral: number): void {
  const axes = [[station.lx, 0, station.lz], up, [-station.lz, 0, station.lx]];
  const [x = 0, y = 0, z = 0] = place(station, lateral, 0);
  box(
    kit.orange,
    [x, y + bollardHeight / 2, z],
    [bollardSize, bollardHeight / 2, bollardSize],
    axes,
  );
  box(
    kit.white,
    [x, y + bollardHeight * 0.78, z],
    [bollardSize + 0.01, 0.07, bollardSize + 0.01],
    axes,
  );
}

function bollards(
  kit: Kit,
  list: Station[],
  length: number,
  sign: number,
  edges: LaneEdges,
  rows: Station[],
): void {
  const opened = rows.find((row) => {
    const found = edges(row.s);
    return found !== null && found[0] - row.half >= 0.9;
  });
  if (!opened) return;
  for (let k = 0; k < bollardCount; k++) {
    const s = opened.s + k * bollardEvery;
    const edge = edges(s);
    if (!edge) return;
    bollard(kit, stationAt(list, length, s), sign * (edge[0] - 0.25));
  }
}

export function pitLaneParts(
  list: Station[],
  track: StreetTrack,
  edges: LaneEdges,
): Part[] {
  const pit = track.pitLane;
  const { length } = track;
  const sign = pitSign(track);
  const zone = zones(list, track);
  const surface = new Builder(2);
  ribbon(surface, zone.rows, sign, (station) => edges(station.s), laneLift);
  const paint = new Builder(1);
  lines(paint, sign, edges, zone);
  across(paint, list, length, sign, edges, pit.wallStart);
  across(paint, list, length, sign, edges, pit.wallEnd - speedLine);
  chevrons(paint, list, length, sign, edges, zone.entryRows);
  chevrons(paint, list, length, sign, edges, zone.exitRows);
  const kit = {
    red: new Builder(1),
    white: new Builder(1),
    orange: new Builder(1),
  };
  cushion(
    kit,
    list,
    length,
    sign,
    pit.pitWall,
    [pit.wallStart - cushionLength, pit.wallStart],
    true,
  );
  cushion(
    kit,
    list,
    length,
    sign,
    pit.pitWall,
    [pit.wallEnd, pit.wallEnd + exitCushion],
    false,
  );
  bollards(kit, list, length, sign, edges, zone.entryRows);
  return [
    surface.part("pit lane", "track runoff asphalt"),
    paint.part("pit lane lines", "track road paint"),
    kit.red.part("pit cushions red", "track marquee red"),
    kit.white.part("pit cushions white", "track service white"),
    kit.orange.part("pit bollards", "track bollard orange"),
  ];
}
