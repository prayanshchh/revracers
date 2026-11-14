import {
  box,
  Builder,
  closedRows,
  edgeLines,
  gantry,
  kerbs,
  lamps,
  type LinePath,
  markings,
  type Part,
  place,
  rectangle,
  road,
  type Station,
  stationAt,
  stations,
  strip,
  type TrainingTrack,
  up,
  wrap,
} from "./training-layout.ts";
import {
  boxCentres,
  type CrewSpot,
  crewSpots,
  type GarageCar,
  garageCars,
} from "./street-pit.ts";
import { type TrackProp, trackProps } from "./street-props.ts";
import { type Venue, venueParts } from "./street-venue.ts";
import dressing from "../../../../content/tracks/neon-boulevard/dressing.json";
import { gantryParts } from "./trackside-gantry.ts";
import { boardRow, wrapAspect, wrapV } from "./trackside-plan.ts";
import type { Zone as Plot } from "./trackside-props.ts";
import { flagParts, terraceParts, terraceZones } from "./trackside-terrace.ts";

interface StreetPit {
  entry: number;
  wallStart: number;
  wallEnd: number;
  exit: number;
  pitWall: number;
  garageStart: number;
  garageEnd: number;
  boxLateral: number;
  fastLane: number;
  baySpacing: number;
}

export interface StreetTrack extends TrainingTrack {
  name: string;
  pitLane: StreetPit;
  paintedRunoff: [string, number, number][];
  props?: TrackProp[];
}

interface Run {
  sign: number;
  from: number;
  to: number;
  closed: boolean;
  backed: boolean;
  lateral: (station: Station) => number;
}

export interface StreetPole {
  base: number[];
  head: number[];
  aim: number[];
  arm: number[];
}

const barrierHeight = 1.1;
const barrierThickness = 0.6;
const wrapLength = barrierHeight * wrapAspect;
const crossingBoards = ["boulevard tag", "revracers", "boulevard prix"];
const fenceInset = 0.22;
const fenceKnee = 3.9;
const fenceTop = 4.5;
const fenceLean = 0.55;
const fenceTile = 0.24;
const postSpacing = 4;
const postSize = 0.16;
const railSize = 0.05;
const poleSpacing = 30;
const poleSetback = 2.2;
const poleHeight = 15;
const poleArm = 2.6;
const poleSize = 0.34;
const headLength = 1.5;
const headWidth = 0.55;
const headDepth = 0.18;
const cableHeights = [1.9, 2.7, 3.5];
const cableSize = 0.035;
const lampInset = 0.06;
const runoffTile = 2;
const runoffColumns = 4;
const paintFrom = 3;
const paintFull = 6;
const paintRamp = 30;
const laneWidth = 3.6;
const laneDash = 3;
const laneGap = 9;
const laneLine = 0.11;
const lanesFrom = 760;
const lanesTo = 5990;
const pitLine = 0.2;
const workingLane = 18;
const boxLength = 6;
const boxWidth = 2.6;

export function wallAt(station: Station, sign: number): number {
  return sign > 0 ? station.wallLeft : station.wallRight;
}

function onArc(s: number, from: number, to: number, length: number): boolean {
  return wrap(s - from, length) <= wrap(to - from, length);
}

function wallRuns(track: StreetTrack): Run[] {
  const pit = track.pitLane;
  return [
    {
      sign: -1,
      from: 0,
      to: track.length,
      closed: true,
      backed: false,
      lateral: (station) => station.wallRight,
    },
    {
      sign: 1,
      from: pit.garageEnd,
      to: pit.garageStart,
      closed: false,
      backed: false,
      lateral: (station) => station.wallLeft,
    },
    {
      sign: 1,
      from: pit.wallStart,
      to: pit.wallEnd,
      closed: false,
      backed: true,
      lateral: () => pit.pitWall,
    },
  ];
}

function runSpan(run: Run, length: number): number {
  return run.closed ? length : wrap(run.to - run.from, length);
}

export function spanRows(
  list: Station[],
  length: number,
  from: number,
  span: number,
  step: number,
): Station[] {
  const count = Math.max(2, Math.round(span / step) + 1);
  return Array.from({ length: count }, (_, k) => {
    const s = from + (span * k) / (count - 1);
    return { ...stationAt(list, length, s), s };
  });
}

function runRows(list: Station[], length: number, run: Run): Station[] {
  if (run.closed) return closedRows(list, length);
  return spanRows(
    list,
    length,
    run.from,
    runSpan(run, length),
    length / list.length,
  );
}

function laneDashes(list: Station[], track: TrainingTrack): Part {
  const builder = new Builder(1);
  for (let s = lanesFrom; s < lanesTo; s += laneDash + laneGap) {
    const a = stationAt(list, track.length, s);
    const b = stationAt(list, track.length, s + laneDash);
    const lanes = Math.floor((2 * a.half) / laneWidth);
    for (let k = 1; k < lanes; k++) {
      const offset = -a.half + (2 * a.half * k) / lanes;
      const first = builder.count;
      for (const station of [a, b])
        for (const l of [offset - laneLine / 2, offset + laneLine / 2])
          builder.vertex(place(station, l, 0.004), up, [[l, station.s]]);
      builder.quad(first, first + 2, first + 3, first + 1);
    }
  }
  return builder.part("lane dashes", "track lane road paint");
}

function paintedAt(track: StreetTrack, s: number, sign: number): boolean {
  return track.paintedRunoff.some(
    ([side, from, to]) =>
      (side === "left" ? 1 : -1) === sign &&
      onArc(s, from - paintRamp, to + paintRamp, track.length),
  );
}

function runoff(list: Station[], track: StreetTrack): Part {
  const builder = new Builder(2);
  const rows = closedRows(list, track.length);
  for (const sign of [1, -1]) {
    const first = builder.count;
    for (const station of rows) {
      const edge = station.half + track.runoff;
      const wall = wallAt(station, sign);
      const columns = Array.from(
        { length: runoffColumns },
        (_, k) => edge + ((wall - edge) * k) / (runoffColumns - 1),
      );
      const ordered = sign > 0 ? columns : [...columns].reverse();
      const painted = paintedAt(track, station.s, sign)
        ? Math.min(
            Math.max((wall - edge - paintFrom) / (paintFull - paintFrom), 0),
            1,
          )
        : 0;
      for (const distance of ordered) {
        const lateral = sign * distance;
        builder.vertex(place(station, lateral, -0.002), up, [
          [lateral / runoffTile, station.s / runoffTile],
          [painted, 0],
        ]);
      }
    }
    builder.grid(rows.length, runoffColumns, first);
  }
  return builder.part("runoff", "track runoff asphalt");
}

interface Zone {
  from: number;
  to: number;
  row: number;
  start: number;
}

function wrapZones(length: number, side: number): Zone[] {
  const spans = dressing.boards;
  return spans.map((span, index) => ({
    from: span.from,
    to: spans[index + 1]?.from ?? length,
    row: boardRow(side > 0 ? span.left : span.right),
    start: span.from,
  }));
}

function runZones(run: Run, length: number): Zone[] {
  const zones = wrapZones(length, run.sign);
  if (run.closed) return zones;
  const to = run.from + runSpan(run, length);
  return [0, length].flatMap((offset) =>
    zones.flatMap((zone) => {
      const from = Math.max(zone.from + offset, run.from);
      const end = Math.min(zone.to + offset, to);
      return end - from > 1
        ? [{ from, to: end, row: zone.row, start: zone.start + offset }]
        : [];
    }),
  );
}

function zoneRows(
  list: Station[],
  length: number,
  zone: Zone,
): { station: Station; s: number }[] {
  const n = list.length;
  const spacing = length / n;
  const count = Math.max(2, Math.round((zone.to - zone.from) / spacing) + 1);
  return Array.from({ length: count }, (_, k) => {
    const s = zone.from + ((zone.to - zone.from) * k) / (count - 1);
    return { station: stationAt(list, length, s), s };
  });
}

function barrierFaces(
  list: Station[],
  track: TrainingTrack,
  runs: Run[],
): Part {
  const builder = new Builder(1);
  for (const run of runs)
    for (const back of run.backed ? [false, true] : [false]) {
      const facing = back ? -run.sign : run.sign;
      for (const zone of runZones(run, track.length)) {
        const first = builder.count;
        const rows = zoneRows(list, track.length, zone);
        for (const { station, s } of rows) {
          const wall = run.lateral(station) + (back ? barrierThickness : 0);
          const normal = [-station.lx * facing, 0, -station.lz * facing];
          const u = (facing > 0 ? s - zone.start : zone.to - s) / wrapLength;
          for (const height of [0, barrierHeight])
            builder.vertex(place(station, run.sign * wall, height), normal, [
              [u, wrapV(zone.row, height / barrierHeight)],
            ]);
        }
        builder.grid(rows.length, 2, first, facing < 0);
      }
    }
  return builder.part("wall wraps", "track wall wraps");
}

export function facing(
  builder: Builder,
  corners: number[][],
  normal: number[],
  uvs: number[][][] = corners.map(() => [[0, 0]]),
): void {
  const [a, b, c] = corners.map(vec3Of);
  const turn: Vec3 = a && b && c ? cross(minus(b, a), minus(c, a)) : [0, 1, 0];
  const n = vec3Of(normal);
  const forward = turn[0] * n[0] + turn[1] * n[1] + turn[2] * n[2] > 0;
  const first = builder.count;
  for (const k of forward ? [0, 1, 2, 3] : [3, 2, 1, 0])
    builder.vertex(corners[k] ?? [], normal, uvs[k] ?? [[0, 0]]);
  builder.quad(first, first + 1, first + 2, first + 3);
}

function runEnds(builder: Builder, rows: Station[], run: Run): void {
  const ends = [
    { station: rows[0], ahead: -1 },
    { station: rows[rows.length - 1], ahead: 1 },
  ];
  for (const { station, ahead } of ends) {
    if (!station) continue;
    const wall = run.lateral(station);
    const forward = [-station.lz * ahead, 0, station.lx * ahead];
    const near = run.sign * wall;
    const far = run.sign * (wall + barrierThickness);
    facing(
      builder,
      [
        place(station, near, 0),
        place(station, far, 0),
        place(station, far, barrierHeight),
        place(station, near, barrierHeight),
      ],
      forward,
    );
  }
}

function barrierBody(list: Station[], track: TrainingTrack, runs: Run[]): Part {
  const builder = new Builder(1);
  for (const run of runs) {
    const { sign } = run;
    const rows = runRows(list, track.length, run);
    if (!run.closed) runEnds(builder, rows, run);
    const faces = [
      {
        from: 0,
        to: barrierThickness,
        low: barrierHeight,
        high: barrierHeight,
        n: 0,
      },
      {
        from: barrierThickness,
        to: barrierThickness,
        low: barrierHeight,
        high: 0,
        n: 1,
      },
    ];
    for (const face of run.backed ? faces.slice(0, 1) : faces) {
      const first = builder.count;
      for (const station of rows) {
        const wall = run.lateral(station);
        const normal =
          face.n === 0 ? up : [station.lx * sign, 0, station.lz * sign];
        for (const [distance, height] of [
          [wall + face.from, face.low],
          [wall + face.to, face.high],
        ] as const)
          builder.vertex(place(station, sign * distance, height), normal, [
            [station.s / 2, (distance - wall + height) / 2],
          ]);
      }
      builder.grid(rows.length, 2, first, sign < 0);
    }
  }
  return builder.part("wall concrete", "track wall concrete");
}

function fenceMesh(list: Station[], track: TrainingTrack, runs: Run[]): Part {
  const builder = new Builder(1);
  const slant = Math.hypot(fenceLean, fenceTop - fenceKnee);
  for (const run of runs) {
    const { sign } = run;
    const rows = runRows(list, track.length, run);
    const first = builder.count;
    for (const station of rows) {
      const wall = run.lateral(station) + fenceInset;
      const normal = [-station.lx * sign, 0, -station.lz * sign];
      const points: [number, number, number][] = [
        [wall, barrierHeight, barrierHeight / fenceTile],
        [wall, fenceKnee, fenceKnee / fenceTile],
        [wall - fenceLean, fenceTop, (fenceKnee + slant) / fenceTile],
      ];
      for (const [distance, height, v] of points)
        builder.vertex(place(station, sign * distance, height), normal, [
          [station.s / fenceTile, v],
        ]);
    }
    builder.grid(rows.length, 3, first, sign < 0);
  }
  return builder.part("debris fence", "track mesh fence");
}

type Vec3 = [number, number, number];

function vec3Of(p: number[]): Vec3 {
  return [Number(p[0]), Number(p[1]), Number(p[2])];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function minus(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function unit(v: Vec3): Vec3 {
  const length = Math.hypot(...v) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}

export function beam(
  builder: Builder,
  from: number[],
  to: number[],
  size: number,
): void {
  const a = vec3Of(from);
  const b = vec3Of(to);
  const d: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const length = Math.hypot(...d);
  if (length < 1e-6) return;
  const axis: Vec3 = [d[0] / length, d[1] / length, d[2] / length];
  const helper: Vec3 = Math.abs(axis[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const side = unit(cross(axis, helper));
  const other = unit(cross(side, axis));
  const centre = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  box(builder, centre, [size / 2, length / 2, size / 2], [side, axis, other]);
}

function fencePosts(list: Station[], track: TrainingTrack, runs: Run[]): Part {
  const builder = new Builder(1);
  for (const run of runs) {
    const { sign } = run;
    const span = runSpan(run, track.length);
    const count = Math.max(1, Math.round(span / postSpacing));
    let previousTip: number[] | null = null;
    let firstTip: number[] | null = null;
    for (let k = 0; k < count + (run.closed ? 0 : 1); k++) {
      const station = stationAt(
        list,
        track.length,
        run.from + (k * span) / count,
      );
      const wall = run.lateral(station) + fenceInset;
      const foot = place(station, sign * wall, barrierHeight);
      const knee = place(station, sign * wall, fenceKnee);
      const tip = place(station, sign * (wall - fenceLean), fenceTop);
      beam(builder, foot, knee, postSize);
      beam(builder, knee, tip, postSize);
      if (previousTip) beam(builder, previousTip, tip, railSize);
      previousTip = tip;
      firstTip ??= tip;
    }
    if (run.closed && previousTip && firstTip)
      beam(builder, previousTip, firstTip, railSize);
    cables(builder, list, track, run);
  }
  return builder.part("fence steel", "track fence steel");
}

function cables(
  builder: Builder,
  list: Station[],
  track: TrainingTrack,
  run: Run,
): void {
  const { sign } = run;
  const rows = runRows(list, track.length, run).filter(
    (_, i, all) => i % 4 === 0 || i === all.length - 1,
  );
  for (const height of cableHeights) {
    const first = builder.count;
    for (const station of rows) {
      const wall = run.lateral(station) + fenceInset - 0.03;
      const normal = [-station.lx * sign, 0, -station.lz * sign];
      for (const h of [height - cableSize / 2, height + cableSize / 2])
        builder.vertex(place(station, sign * wall, h), normal, [[0, 0]]);
    }
    builder.grid(rows.length, 2, first, sign < 0);
  }
}

function poleLateral(
  station: Station,
  sign: number,
  track: StreetTrack,
): number {
  const pit = track.pitLane;
  if (sign > 0 && onArc(station.s, pit.wallStart, pit.wallEnd, track.length))
    return pit.pitWall + barrierThickness / 2;
  return wallAt(station, sign) + poleSetback;
}

function streetPoles(list: Station[], track: StreetTrack): StreetPole[] {
  const count = Math.max(1, Math.round(track.length / poleSpacing));
  const poles: StreetPole[] = [];
  for (const sign of [1, -1])
    for (let k = 0; k < count; k++) {
      const s = ((k + (sign > 0 ? 0 : 0.5)) * track.length) / count;
      const station = stationAt(list, track.length, s);
      const lateral = poleLateral(station, sign, track);
      const reach = Math.min(poleArm, lateral - station.half + 1.5);
      const base = place(station, sign * lateral, 0);
      const head = place(station, sign * (lateral - reach), poleHeight);
      const aim = place(station, sign * (lateral - reach - 6), 0);
      poles.push({
        base,
        head,
        aim,
        arm: place(station, sign * lateral, poleHeight),
      });
    }
  return poles;
}

function poleSteel(poles: StreetPole[]): Part {
  const builder = new Builder(1);
  for (const pole of poles) {
    beam(builder, pole.base, pole.arm, poleSize);
    beam(builder, pole.arm, pole.head, poleSize * 0.55);
    const dx = (pole.head[0] ?? 0) - (pole.arm[0] ?? 0);
    const dz = (pole.head[2] ?? 0) - (pole.arm[2] ?? 0);
    const l = Math.hypot(dx, dz) || 1;
    const across = [dx / l, 0, dz / l];
    const along = [-(across[2] ?? 0), 0, across[0] ?? 0];
    box(
      builder,
      pole.head,
      [headWidth / 2, headDepth / 2, headLength / 2],
      [across, up, along],
    );
  }
  return builder.part("pole steel", "track pole steel");
}

const lampCorners = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
] as const;

function lampFace(builder: Builder, head: Vec3, arm: Vec3): void {
  const dx = head[0] - arm[0];
  const dz = head[2] - arm[2];
  const l = Math.hypot(dx, dz) || 1;
  const across: Vec3 = [dx / l, 0, dz / l];
  const along: Vec3 = [-across[2], 0, across[0]];
  const y = head[1] - headDepth / 2 - 0.01;
  const first = builder.count;
  for (const [a, b] of lampCorners) {
    const wide = a * (headWidth / 2 - lampInset);
    const long = b * (headLength / 2 - lampInset);
    builder.vertex(
      [
        head[0] + across[0] * wide + along[0] * long,
        y,
        head[2] + across[2] * wide + along[2] * long,
      ],
      [0, -1, 0],
      [[(a + 1) / 2, (b + 1) / 2]],
    );
  }
  builder.quad(first, first + 3, first + 2, first + 1);
}

function poleLamps(poles: StreetPole[]): Part {
  const builder = new Builder(1);
  for (const pole of poles)
    lampFace(builder, vec3Of(pole.head), vec3Of(pole.arm));
  return builder.part("pole lamps", "track pole lamps");
}

function overheads(
  list: Station[],
  track: TrainingTrack,
  bridges: number[],
): Part[] {
  const crossings = bridges.map((at, index) => ({
    at,
    board: crossingBoards[index % crossingBoards.length] ?? "revracers",
    kind: "bridge",
  }));
  const built = gantryParts(list, track.length, [
    ...crossings,
    ...dressing.gantries,
  ]);
  return [
    built.steel.part("overhead steel", "track gantry steel"),
    built.faces.part("banner wraps", "track wall wraps"),
    built.deck.part("overhead deck", "track stand concrete"),
  ];
}

function pitMarkings(list: Station[], track: StreetTrack): Part {
  const builder = new Builder(1);
  const pit = track.pitLane;
  const { length } = track;
  const step = length / list.length;
  const diagonal = (from: number, to: number, inward: boolean) => {
    const span = wrap(to - from, length);
    const lateral = (station: Station) => {
      const t = wrap(station.s - from, length) / span;
      return station.half + (pit.pitWall - station.half) * (inward ? t : 1 - t);
    };
    strip(
      builder,
      spanRows(list, length, from, span, step),
      lateral,
      (station) => lateral(station) + pitLine,
      0.004,
    );
  };
  diagonal(pit.entry, pit.wallStart, true);
  diagonal(pit.wallEnd, pit.exit, false);
  const garageSpan = wrap(pit.garageEnd - pit.garageStart, length);
  strip(
    builder,
    spanRows(list, length, pit.garageStart, garageSpan, step),
    () => workingLane - pitLine / 2,
    () => workingLane + pitLine / 2,
    0.004,
  );
  const bays = Math.round(garageSpan / pit.baySpacing);
  const near = pit.boxLateral - boxWidth / 2;
  const far = pit.boxLateral + boxWidth / 2;
  for (const centre of boxCentres(pit.garageStart, pit.baySpacing, bays)) {
    const back = centre - boxLength / 2;
    const front = centre + boxLength / 2;
    rectangle(builder, list, length, [back, back + pitLine], [near, far]);
    rectangle(builder, list, length, [front - pitLine, front], [near, far]);
    rectangle(builder, list, length, [back, front], [near, near + pitLine]);
    rectangle(builder, list, length, [back, front], [far - pitLine, far]);
  }
  return builder.part("pit markings", "track lane road paint");
}

export function terraced(list: Station[], length: number): Plot[] {
  return terraceZones(list, length, dressing.terraces);
}

function hospitality(list: Station[], length: number): Part[] {
  const built = terraceParts(list, length, dressing.terraces);
  const flags = flagParts(list, length, dressing.flags);
  return [
    built.glass.part("terrace glazing", "track paddock hall"),
    built.deck.part("terrace decks", "track stand concrete"),
    built.frame.part("terrace frame", "track pole steel"),
    built.roof.part("terrace roof", "track stand roof"),
    built.glow.part("terrace lights", "track stand lights"),
    flags.cloth.part("flag cloth", "track wall wraps"),
    flags.poles.part("flag poles", "track pole steel"),
  ];
}

export function streetParts(
  track: StreetTrack,
  line: LinePath | null,
  bridges: number[],
  venue: Venue,
): {
  parts: Part[];
  poles: StreetPole[];
  crew: CrewSpot[];
  cars: GarageCar[];
} {
  const list = stations(track, line);
  const side = venue.paddock
    ? { ...venue.paddock, wall: track.pitLane.pitWall }
    : null;
  const poles = streetPoles(list, track);
  const over = overheads(list, track, bridges);
  const runs = wallRuns(track);
  return {
    parts: [
      road(list, track),
      edgeLines(list, track),
      markings(list, track),
      laneDashes(list, track),
      pitMarkings(list, track),
      kerbs(list, track),
      runoff(list, track),
      barrierFaces(list, track, runs),
      barrierBody(list, track, runs),
      fenceMesh(list, track, runs),
      fencePosts(list, track, runs),
      poleSteel(poles),
      poleLamps(poles),
      ...over,
      gantry(list, track),
      lamps(list, track),
      trackProps(list, track.length, track.props ?? []),
      ...venueParts(list, track, venue, track.pitLane),
      ...hospitality(list, track.length),
    ],
    poles,
    crew: side ? crewSpots(list, track.length, side) : [],
    cars: side ? garageCars(side, track.length) : [],
  };
}
