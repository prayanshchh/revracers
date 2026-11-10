import {
  Builder,
  type Part,
  place,
  type Station,
  stationAt,
  type TrainingTrack,
  wrap,
} from "./training-layout.ts";
import { facing, spanRows, wallAt } from "./street-layout.ts";
import { type PitEnds, pitKit, teamColour } from "./street-pit.ts";

interface Stand {
  from: number;
  to: number;
  side: number;
  rows: number;
}

interface Paddock {
  from: number;
  to: number;
  front: number;
  bay: number;
  end: number;
  depth: number;
  height: number;
}

export interface Venue {
  stands: Stand[];
  paddock: Paddock | null;
}

const standGap = 3.4;
const rowDepth = 0.85;
const rowRise = 0.46;
const firstRise = 1.6;
const crowdHeight = 0.95;
export const crowdRowSpan = 10;
const roofLift = 4.2;
const roofOverhang = 3;
const roofThickness = 0.6;
const columnSpacing = 18;
const columnSize = 0.5;
const step = 2;
const garageHeight = 8.5;
const doorHeight = 5.6;
const garageCeiling = 6.4;
const pillar = 1.1;
const garageDepth = 12;
const interiorKinds = { front: 0, back: 1, side: 2, ceiling: 3, floor: 4 };
const hallSetback = 4;
const hallEave = 3.5;
const deckOffset = -50;
const roofOffset = -100;

function rowsBetween(
  list: Station[],
  length: number,
  from: number,
  to: number,
): Station[] {
  return spanRows(list, length, from, wrap(to - from, length), step);
}

function sweep(
  builder: Builder,
  rows: Station[],
  profile: [number, number][],
  sign: number,
  base: (station: Station) => number,
  vOffset = 0,
): void {
  const first = builder.count;
  const facing = profile.map((point, index) => {
    const before = profile[index - 1] ?? point;
    const after = profile[index + 1] ?? point;
    const dl = after[0] - before[0];
    const dh = after[1] - before[1];
    const size = Math.hypot(dl, dh) || 1;
    return [-dh / size, dl / size];
  });
  for (const station of rows) {
    let along = 0;
    profile.forEach(([lateral, height], index) => {
      const previous = profile[index - 1];
      if (previous)
        along += Math.hypot(lateral - previous[0], height - previous[1]);
      const p = place(station, sign * (base(station) + lateral), height);
      const [outward = 0, rise = 1] = facing[index] ?? [];
      const normal = [
        station.lx * sign * outward,
        rise,
        station.lz * sign * outward,
      ];
      builder.vertex(p, normal, [[station.s, along + vOffset]]);
    });
  }
  builder.grid(rows.length, profile.length, first, sign < 0);
}

function standProfile(rows: number): {
  seats: [number, number][];
  crowd: [number, number][][];
  top: number;
  depth: number;
} {
  const seats: [number, number][] = [
    [0, 0],
    [0, firstRise],
  ];
  const crowd: [number, number][][] = [];
  for (let k = 0; k < rows; k++) {
    const front = k * rowDepth;
    const height = firstRise + k * rowRise;
    seats.push([front + rowDepth, height]);
    seats.push([front + rowDepth, height + rowRise]);
    crowd.push([
      [front + rowDepth * 0.55, height],
      [front + rowDepth * 0.55, height + crowdHeight],
    ]);
  }
  const depth = rows * rowDepth;
  const top = firstRise + rows * rowRise;
  return { seats, crowd, top, depth };
}

function stand(
  list: Station[],
  track: TrainingTrack,
  item: Stand,
  parts: { concrete: Builder; crowd: Builder; roof: Builder; glow: Builder },
): void {
  const rows = rowsBetween(list, track.length, item.from, item.to);
  const base = (station: Station) => wallAt(station, item.side) + standGap;
  const profile = standProfile(item.rows);
  sweep(
    parts.concrete,
    rows,
    [
      ...profile.seats,
      [profile.depth + 0.4, profile.top],
      [profile.depth + 0.4, 0],
    ],
    item.side,
    base,
  );
  profile.crowd.forEach((pair, row) => {
    sweep(parts.crowd, rows, pair, item.side, base, row * crowdRowSpan);
  });
  const roofTop = profile.top + roofLift;
  sweep(
    parts.roof,
    rows,
    [
      [-roofOverhang, roofTop],
      [profile.depth + 0.6, roofTop + 1.2],
      [profile.depth + 0.6, roofTop + 1.2 + roofThickness],
      [-roofOverhang, roofTop + roofThickness],
      [-roofOverhang, roofTop],
    ],
    item.side,
    base,
  );
  sweep(
    parts.glow,
    rows,
    [
      [-roofOverhang + 0.4, roofTop - 0.05],
      [-roofOverhang + 1.0, roofTop - 0.05],
    ],
    item.side,
    base,
  );
  const span = wrap(item.to - item.from, track.length);
  const columns = Math.max(2, Math.round(span / columnSpacing) + 1);
  for (let k = 0; k < columns; k++) {
    const s = item.from + (span * k) / (columns - 1);
    const station = stationAt(list, track.length, wrap(s, track.length));
    const lateral = item.side * (base(station) - roofOverhang + 0.6);
    const foot = place(station, lateral, 0);
    const forward = [-station.lz, 0, station.lx];
    const left = [station.lx, 0, station.lz];
    column(parts.roof, foot, roofTop, left, forward);
  }
}

function column(
  builder: Builder,
  foot: number[],
  height: number,
  left: number[],
  forward: number[],
): void {
  const h = columnSize / 2;
  const corner = (a: number, b: number, y: number) =>
    [0, 1, 2].map(
      (i) =>
        (foot[i] ?? 0) +
        (left[i] ?? 0) * a * h +
        (forward[i] ?? 0) * b * h +
        (i === 1 ? y : 0),
    );
  const faces: [number, number, number, number][] = [
    [1, -1, 1, 1],
    [-1, 1, -1, -1],
    [1, 1, -1, 1],
    [-1, -1, 1, -1],
  ];
  for (const [a0, b0, a1, b1] of faces) {
    const first = builder.count;
    const n = [0, 1, 2].map(
      (i) =>
        (left[i] ?? 0) * (a0 + a1) * 0.5 + (forward[i] ?? 0) * (b0 + b1) * 0.5,
    );
    builder.vertex(corner(a0, b0, 0), n, [[0, 0]]);
    builder.vertex(corner(a1, b1, 0), n, [[1, 0]]);
    builder.vertex(corner(a1, b1, height), n, [[1, height]]);
    builder.vertex(corner(a0, b0, height), n, [[0, height]]);
    builder.quad(first, first + 1, first + 2, first + 3);
  }
}

function garagePanel(
  builder: Builder,
  corners: number[][],
  normal: number[],
  local: number[][],
  colour: number[],
  kind: number,
): void {
  const [r = 0, g = 0, b = 0] = colour;
  facing(
    builder,
    corners,
    normal,
    local.map((p) => [p, [r, g], [b, kind]]),
  );
}

function garageBay(
  list: Station[],
  length: number,
  paddock: Paddock,
  bay: number,
  parts: { garage: Builder; interior: Builder },
): void {
  const s0 = paddock.from + bay * paddock.bay;
  const s1 = s0 + paddock.bay;
  const colour = teamColour(bay);
  const at = (s: number) => stationAt(list, length, wrap(s, length));
  const front = paddock.front;
  const inward = (station: Station) => [-station.lx, 0, -station.lz];
  const frame = (from: number, to: number, low: number, high: number) => {
    const a = at(from);
    const b = at(to);
    garagePanel(
      parts.garage,
      [
        place(a, front, low),
        place(b, front, low),
        place(b, front, high),
        place(a, front, high),
      ],
      inward(a),
      [
        [from, low],
        [to, low],
        [to, high],
        [from, high],
      ],
      colour,
      interiorKinds.front,
    );
  };
  frame(s0, s0 + pillar, 0, doorHeight);
  frame(s1 - pillar, s1, 0, doorHeight);
  frame(s0, s1, doorHeight, garageHeight);
  const a = at(s0 + pillar);
  const b = at(s1 - pillar);
  const width = paddock.bay - 2 * pillar;
  const back = front + garageDepth;
  const box = (station: Station, lateral: number, height: number) =>
    place(station, lateral, height);
  const panel = (
    corners: number[][],
    normal: number[],
    local: number[][],
    kind: number,
  ) => {
    garagePanel(parts.interior, corners, normal, local, colour, kind);
  };
  panel(
    [
      box(a, back, 0),
      box(b, back, 0),
      box(b, back, garageCeiling),
      box(a, back, garageCeiling),
    ],
    inward(b),
    [
      [0, 0],
      [width, 0],
      [width, garageCeiling],
      [0, garageCeiling],
    ],
    interiorKinds.back,
  );
  for (const [station, ahead] of [
    [a, 1],
    [b, -1],
  ] as const)
    panel(
      [
        box(station, front, 0),
        box(station, back, 0),
        box(station, back, garageCeiling),
        box(station, front, garageCeiling),
      ],
      [-station.lz * ahead, 0, station.lx * ahead],
      [
        [0, 0],
        [garageDepth, 0],
        [garageDepth, garageCeiling],
        [0, garageCeiling],
      ],
      interiorKinds.side,
    );
  for (const [height, kind, normal] of [
    [garageCeiling, interiorKinds.ceiling, [0, -1, 0]],
    [0.01, interiorKinds.floor, [0, 1, 0]],
  ] as const)
    panel(
      [
        box(a, front, height),
        box(b, front, height),
        box(b, back, height),
        box(a, back, height),
      ],
      [...normal],
      [
        [0, 0],
        [width, 0],
        [width, garageDepth],
        [0, garageDepth],
      ],
      kind,
    );
}

function hallEnd(
  builder: Builder,
  station: Station,
  ahead: number,
  paddock: Paddock,
): void {
  const near = paddock.front;
  const far = paddock.front + paddock.depth;
  facing(
    builder,
    [
      place(station, near, 0),
      place(station, far, 0),
      place(station, far, paddock.height),
      place(station, near, paddock.height),
    ],
    [-station.lz * ahead, 0, station.lx * ahead],
    [
      [[0, garageHeight]],
      [[paddock.depth, garageHeight]],
      [[paddock.depth, garageHeight + paddock.height]],
      [[0, garageHeight + paddock.height]],
    ],
  );
}

function pitBuildings(
  list: Station[],
  track: TrainingTrack,
  paddock: Paddock,
  parts: { garage: Builder; interior: Builder; hall: Builder; glow: Builder },
): void {
  const garages = rowsBetween(list, track.length, paddock.from, paddock.to);
  const whole = rowsBetween(list, track.length, paddock.from, paddock.end);
  const tail = rowsBetween(list, track.length, paddock.to, paddock.end);
  const base = () => paddock.front;
  const top = paddock.height;
  const bays = Math.round(
    wrap(paddock.to - paddock.from, track.length) / paddock.bay,
  );
  for (let bay = 0; bay < bays; bay++)
    garageBay(list, track.length, paddock, bay, parts);
  sweep(
    parts.hall,
    garages,
    [
      [0, garageHeight],
      [hallSetback, garageHeight],
    ],
    1,
    base,
    deckOffset,
  );
  sweep(
    parts.hall,
    garages,
    [
      [hallSetback, garageHeight],
      [hallSetback, top],
    ],
    1,
    base,
    garageHeight,
  );
  if (tail.length > 1)
    sweep(
      parts.hall,
      tail,
      [
        [0, 0],
        [0, top],
      ],
      1,
      base,
      garageHeight,
    );
  sweep(
    parts.hall,
    whole,
    [
      [paddock.depth, top],
      [paddock.depth, 0],
    ],
    1,
    base,
    garageHeight,
  );
  sweep(
    parts.hall,
    whole,
    [
      [hallSetback - hallEave, top],
      [paddock.depth, top + 1],
    ],
    1,
    base,
    roofOffset,
  );
  sweep(
    parts.glow,
    whole,
    [
      [hallSetback - hallEave, top - 0.02],
      [hallSetback - hallEave, top - 0.9],
    ],
    1,
    base,
  );
  const first = whole[0];
  const last = whole[whole.length - 1];
  if (first) hallEnd(parts.hall, first, -1, paddock);
  if (last) hallEnd(parts.hall, last, 1, paddock);
}

export function venueParts(
  list: Station[],
  track: TrainingTrack,
  venue: Venue,
  pitLane: PitEnds & { pitWall: number },
): Part[] {
  const { stands, paddock } = venue;
  const concrete = new Builder(1);
  const crowd = new Builder(1);
  const roof = new Builder(1);
  const glow = new Builder(1);
  for (const item of stands)
    stand(list, track, item, { concrete, crowd, roof, glow });
  const garage = new Builder(3);
  const interior = new Builder(3);
  const hall = new Builder(1);
  if (paddock)
    pitBuildings(list, track, paddock, { garage, interior, hall, glow });
  return [
    concrete.part("stand concrete", "track stand concrete"),
    crowd.part("stand crowd", "track stand crowd"),
    roof.part("stand roof", "track stand roof"),
    glow.part("stand lights", "track stand lights"),
    garage.part("garage front", "track garage front"),
    interior.part("garage interior", "track garage interior"),
    hall.part("paddock hall", "track paddock hall"),
    ...(paddock
      ? pitKit(
          list,
          track.length,
          { ...paddock, wall: pitLane.pitWall },
          pitLane,
        )
      : []),
  ];
}
