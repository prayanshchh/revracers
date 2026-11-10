import {
  box,
  Builder,
  type Part,
  place,
  type Station,
  stationAt,
  wrap,
} from "./training-layout.ts";
import { type Team, teams } from "./weekend.ts";

export interface PitSide {
  from: number;
  to: number;
  front: number;
  bay: number;
  wall: number;
}

export interface PitEnds {
  entry: number;
  wallStart: number;
  wallEnd: number;
}

export interface GarageCar {
  s: number;
  lateral: number;
  team: string;
}

export interface CrewSpot {
  s: number;
  garage: boolean;
  position: number[];
  heading: number;
  team: string;
  pose: string;
}

export interface Paint {
  colour: number[];
  glow: number;
}

const firstTeamBay = 2;
const emptyGarage = [0.3, 0.31, 0.33];

const wallBack = 0.6;
const standLength = 7.4;
const standDepth = 1.9;
const standFloor = 0.9;
const standRoof = 3.3;
const monitors = 5;
const chairs = 4;
const boomHeight = 4.9;
const boomReach = 3.9;
const boomSize = 0.18;
const boomSpread = 2.7;
const tyreRadius = 0.37;
const tyreWidth = 0.33;
const tyreSides = 14;
const garageDepth = 12;
const carInGarage = 5.6;
const signCells = 3;
const signSize = 1.1;
const signLift = 1.9;
const poses = ["arms_folded", "hands_hips", "talking", "interact"];

const dark: Paint = { colour: [0.07, 0.075, 0.085], glow: 0 };
const steel: Paint = { colour: [0.5, 0.52, 0.55], glow: 0.05 };
const white: Paint = { colour: [0.86, 0.87, 0.88], glow: 0.08 };
const blanket: Paint = { colour: [0.11, 0.11, 0.12], glow: 0 };
const screen: Paint = { colour: [0.3, 0.55, 0.95], glow: 1.8 };
const lampRed: Paint = { colour: [1, 0.08, 0.05], glow: 3 };
const lampGreen: Paint = { colour: [0.08, 1, 0.3], glow: 3 };
const compounds: Paint[] = [
  { colour: [0.9, 0.08, 0.08], glow: 0.2 },
  { colour: [0.95, 0.78, 0.08], glow: 0.2 },
  { colour: [0.92, 0.92, 0.92], glow: 0.2 },
];

function hash(value: number): number {
  const x = Math.sin(value * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function teamOfBay(bay: number): Team | null {
  if (bay < firstTeamBay) return null;
  const index = Math.floor((bay - firstTeamBay) / 2);
  return teams.find((t) => t.index === index) ?? null;
}

export function teamColour(bay: number): number[] {
  const team = teamOfBay(bay);
  if (!team) return emptyGarage;
  const value = Number.parseInt(team.colour.slice(1), 16);
  return [16, 8, 0].map((shift) => ((value >> shift) & 255) / 255);
}

export function painted(paint: Paint): number[][] {
  const [r = 0, g = 0, b = 0] = paint.colour;
  return [
    [0, 0],
    [r, g],
    [b, paint.glow],
  ];
}

export function axesOf(station: Station): number[][] {
  return [
    [-station.lz, 0, station.lx],
    [0, 1, 0],
    [station.lx, 0, station.lz],
  ];
}

function block(
  builder: Builder,
  station: Station,
  lateral: number,
  low: number,
  size: [number, number, number],
  paint: Paint,
): void {
  const [along, height, across] = size;
  box(
    builder,
    place(station, lateral, low + height / 2),
    [along / 2, height / 2, across / 2],
    axesOf(station),
    painted(paint),
  );
}

export function drum(
  builder: Builder,
  centre: number[],
  radius: number,
  height: number,
  paint: Paint,
): void {
  const uvs = painted(paint);
  const [x = 0, y = 0, z = 0] = centre;
  const ring = (k: number) => {
    const angle = (k / tyreSides) * Math.PI * 2;
    return [Math.cos(angle), Math.sin(angle)];
  };
  for (let k = 0; k < tyreSides; k++) {
    const [ax = 0, az = 0] = ring(k);
    const [bx = 0, bz = 0] = ring(k + 1);
    const first = builder.count;
    const mid = [(ax + bx) / 2, 0, (az + bz) / 2];
    builder.vertex([x + ax * radius, y, z + az * radius], mid, uvs);
    builder.vertex([x + bx * radius, y, z + bz * radius], mid, uvs);
    builder.vertex([x + bx * radius, y + height, z + bz * radius], mid, uvs);
    builder.vertex([x + ax * radius, y + height, z + az * radius], mid, uvs);
    builder.quad(first, first + 3, first + 2, first + 1);
    const cap = builder.count;
    builder.vertex([x, y + height, z], [0, 1, 0], uvs);
    builder.vertex(
      [x + bx * radius, y + height, z + bz * radius],
      [0, 1, 0],
      uvs,
    );
    builder.vertex(
      [x + ax * radius, y + height, z + az * radius],
      [0, 1, 0],
      uvs,
    );
    builder.quad(cap, cap + 1, cap + 2, cap + 2);
  }
}

function tyreStack(
  builder: Builder,
  station: Station,
  lateral: number,
  count: number,
  compound: Paint,
): void {
  const base = place(station, lateral, 0.02);
  drum(builder, base, tyreRadius, count * tyreWidth, blanket);
  for (let k = 0; k < count; k++) {
    const [x = 0, y = 0, z = 0] = base;
    drum(
      builder,
      [x, y + k * tyreWidth + tyreWidth * 0.42, z],
      tyreRadius + 0.006,
      0.06,
      compound,
    );
  }
}

function boom(
  builder: Builder,
  station: Station,
  front: number,
  team: Paint,
  light: boolean,
): void {
  block(
    builder,
    station,
    front - 0.15,
    0,
    [boomSize, boomHeight, boomSize],
    team,
  );
  block(
    builder,
    station,
    front - 0.15 - boomReach / 2,
    boomHeight - boomSize,
    [boomSize, boomSize, boomReach],
    team,
  );
  block(
    builder,
    station,
    front - 0.15 - boomReach,
    boomHeight - 0.8,
    [0.08, 0.8, 0.08],
    dark,
  );
  if (!light) return;
  const tip = front - 0.15 - boomReach;
  block(builder, station, tip, boomHeight - 1.55, [0.36, 0.7, 0.16], dark);
  block(
    builder,
    station,
    tip - 0.09,
    boomHeight - 1.08,
    [0.2, 0.2, 0.03],
    lampRed,
  );
  block(
    builder,
    station,
    tip - 0.09,
    boomHeight - 1.42,
    [0.2, 0.2, 0.03],
    lampGreen,
  );
}

function gunCart(
  builder: Builder,
  station: Station,
  lateral: number,
  team: Paint,
): void {
  block(builder, station, lateral, 0.1, [0.5, 0.66, 0.4], dark);
  block(builder, station, lateral, 0.76, [0.52, 0.05, 0.42], team);
  block(builder, station, lateral, 0.8, [0.1, 0.22, 0.1], steel);
}

function frontJack(
  builder: Builder,
  station: Station,
  lateral: number,
  team: Paint,
): void {
  block(builder, station, lateral, 0.05, [0.5, 0.16, 0.45], team);
  block(builder, station, lateral, 0.21, [0.07, 1.25, 0.07], steel);
  block(builder, station, lateral, 1.42, [0.5, 0.06, 0.06], dark);
}

function bayKit(
  builder: Builder,
  at: (s: number) => Station,
  side: PitSide,
  bay: number,
): void {
  const s0 = side.from + bay * side.bay;
  const middle = s0 + side.bay / 2;
  const team: Paint = { colour: teamColour(bay), glow: 0.35 };
  const front = side.front;
  boom(builder, at(middle - boomSpread), front, team, false);
  boom(builder, at(middle + boomSpread), front, team, true);
  for (let k = 0; k < 4; k++) {
    const compound =
      compounds[(bay + Math.floor(k / 2)) % compounds.length] ?? white;
    tyreStack(
      builder,
      at(s0 + 1.0 + (k % 2) * 0.82),
      front - 0.55 - Math.floor(k / 2) * 0.82,
      4,
      compound,
    );
  }
  for (let k = 0; k < 4; k++)
    gunCart(builder, at(s0 + side.bay - 4.2 + k * 0.68), front - 0.4, team);
  frontJack(builder, at(s0 + side.bay - 1.4), front - 0.5, team);
  const deep = front + garageDepth;
  for (const edge of [s0 + 1.6, s0 + side.bay - 1.6])
    for (let k = 0; k < 4; k++)
      tyreStack(
        builder,
        at(edge),
        front + 3.6 + k * 0.85,
        4,
        compounds[k % compounds.length] ?? white,
      );
  const desk = at(middle);
  block(builder, desk, deep - 1.2, 0, [3.6, 0.92, 0.75], dark);
  block(builder, desk, deep - 1.2, 0.92, [3.62, 0.05, 0.77], team);
  for (let k = 0; k < 3; k++) {
    const monitor = at(middle - 1.15 + k * 1.15);
    block(builder, monitor, deep - 1.45, 1.0, [0.95, 0.58, 0.05], dark);
    block(builder, monitor, deep - 1.48, 1.03, [0.88, 0.52, 0.02], screen);
  }
}

function pitStand(
  builder: Builder,
  at: (s: number) => Station,
  side: PitSide,
  centre: number,
  bay: number,
): void {
  const team: Paint = { colour: teamColour(bay), glow: 0.35 };
  const deep: Paint = {
    colour: teamColour(bay).map((v) => v * 0.45),
    glow: 0.1,
  };
  const l0 = side.wall + wallBack + 0.05;
  const l1 = l0 + standDepth;
  const middle = at(centre);
  block(
    builder,
    middle,
    (l0 + l1) / 2,
    0,
    [standLength, standFloor, standDepth],
    dark,
  );
  block(builder, middle, l0 + 0.35, standFloor, [standLength, 0.95, 0.6], deep);
  block(
    builder,
    middle,
    l0 + 0.35,
    standFloor + 0.95,
    [standLength + 0.04, 0.05, 0.64],
    team,
  );
  for (let row = 0; row < 2; row++)
    for (let k = 0; k < monitors; k++) {
      const s = centre - standLength / 2 + (k + 0.5) * (standLength / monitors);
      const lift = standFloor + 1.05 + row * 0.5;
      block(
        builder,
        at(s),
        l0 + 0.42 - row * 0.05,
        lift,
        [1.35, 0.44, 0.05],
        dark,
      );
      block(
        builder,
        at(s),
        l0 + 0.45 - row * 0.05,
        lift + 0.03,
        [1.27, 0.38, 0.02],
        screen,
      );
    }
  for (let k = 0; k < chairs; k++) {
    const s = centre - standLength / 2 + (k + 0.5) * (standLength / chairs);
    block(builder, at(s), l0 + 1.25, standFloor, [0.06, 0.62, 0.06], steel);
    block(
      builder,
      at(s),
      l0 + 1.25,
      standFloor + 0.62,
      [0.48, 0.08, 0.46],
      dark,
    );
    block(builder, at(s), l0 + 1.5, standFloor + 0.62, [0.46, 0.6, 0.06], team);
  }
  for (const s of [
    centre - standLength / 2 + 0.1,
    centre,
    centre + standLength / 2 - 0.1,
  ])
    for (const l of [l0 + 0.1, l1 - 0.1])
      block(
        builder,
        at(s),
        l,
        standFloor,
        [0.09, standRoof - standFloor, 0.09],
        steel,
      );
  block(
    builder,
    middle,
    (l0 + l1) / 2 + 0.1,
    standRoof,
    [standLength + 0.9, 0.16, standDepth + 1.0],
    deep,
  );
  block(
    builder,
    middle,
    l1 + 0.58,
    standRoof - 0.25,
    [standLength + 0.92, 0.42, 0.04],
    team,
  );
  block(
    builder,
    middle,
    l0 - 0.38,
    standRoof - 0.25,
    [standLength + 0.92, 0.42, 0.04],
    team,
  );
  block(
    builder,
    middle,
    l0 + 0.25,
    standRoof - 0.04,
    [standLength - 0.4, 0.03, 0.22],
    white,
  );
  block(
    builder,
    at(centre + standLength / 2),
    l1,
    standRoof + 0.16,
    [0.06, 2.4, 0.06],
    steel,
  );
}

function teamBays(side: PitSide, length: number): number[] {
  const count = Math.round(wrap(side.to - side.from, length) / side.bay);
  return Array.from({ length: count }, (_, bay) => bay).filter(
    (bay) => teamOfBay(bay) !== null,
  );
}

function board(
  faces: Builder,
  station: Station,
  lateral: number,
  low: number,
  cell: number,
): void {
  const half = signSize / 2;
  const normal = [station.lz, 0, -station.lx];
  const first = faces.count;
  const u0 = cell / signCells;
  const u1 = (cell + 1) / signCells;
  const ahead = [-station.lz * -0.06, 0, station.lx * -0.06];
  const corner = (side: number, height: number) =>
    place(station, lateral + side, low + height).map(
      (v, i) => v + (ahead[i] ?? 0),
    );
  faces.vertex(corner(half, 0), normal, [[u0, 0]]);
  faces.vertex(corner(-half, 0), normal, [[u1, 0]]);
  faces.vertex(corner(-half, signSize), normal, [[u1, 1]]);
  faces.vertex(corner(half, signSize), normal, [[u0, 1]]);
  faces.quad(first, first + 1, first + 2, first + 3);
}

function signPost(
  kit: Builder,
  faces: Builder,
  station: Station,
  lateral: number,
  cell: number,
): void {
  block(kit, station, lateral, 0, [0.08, signLift, 0.08], steel);
  block(
    kit,
    station,
    lateral,
    signLift,
    [0.06, signSize + 0.04, signSize + 0.04],
    white,
  );
  board(faces, station, lateral, signLift + 0.02, cell);
}

function exitLight(kit: Builder, station: Station, lateral: number): void {
  block(kit, station, lateral, 0, [0.12, 2.4, 0.12], steel);
  block(kit, station, lateral, 2.4, [0.22, 0.75, 0.36], dark);
  block(kit, station, lateral, 2.83, [0.03, 0.22, 0.22], {
    colour: [0.25, 0.03, 0.03],
    glow: 0.2,
  });
  block(kit, station, lateral, 2.5, [0.03, 0.22, 0.22], lampGreen);
}

function pitSigns(
  kit: Builder,
  faces: Builder,
  at: (s: number) => Station,
  side: PitSide,
  ends: PitEnds,
): void {
  const lane = side.wall + wallBack + 0.4;
  const garage = side.front - 0.6;
  for (const lateral of [lane, garage])
    signPost(kit, faces, at(ends.wallStart + 2), lateral, 0);
  for (const lateral of [lane, garage])
    signPost(kit, faces, at(ends.wallEnd - 6), lateral, 1);
  const mouth = at(ends.entry - 30);
  signPost(kit, faces, mouth, mouth.wallLeft + 0.5, 2);
  exitLight(kit, at(ends.wallEnd - 2), lane);
}

export function pitKit(
  list: Station[],
  length: number,
  side: PitSide,
  ends: PitEnds,
): Part[] {
  const builder = new Builder(3);
  const faces = new Builder(1);
  const at = (s: number) => stationAt(list, length, wrap(s, length));
  const bays = teamBays(side, length);
  for (const bay of bays) {
    bayKit(builder, at, side, bay);
    if ((bay - firstTeamBay) % 2 === 0)
      pitStand(builder, at, side, side.from + (bay + 1) * side.bay, bay);
  }
  pitSigns(builder, faces, at, side, ends);
  return [
    builder.part("pit kit", "track pit kit"),
    faces.part("pit signs", "track pit signs"),
  ];
}

function spot(
  station: Station,
  lateral: number,
  lift: number,
  facing: number,
  team: string,
  seed: number,
  garage = true,
): CrewSpot {
  const toward = [-station.lx, -station.lz];
  const forward = [-station.lz, station.lx];
  const angle = facing + (hash(seed) - 0.5) * 1.4;
  const dx =
    (toward[0] ?? 0) * Math.cos(angle) + (forward[0] ?? 0) * Math.sin(angle);
  const dz =
    (toward[1] ?? 0) * Math.cos(angle) + (forward[1] ?? 0) * Math.sin(angle);
  return {
    s: station.s,
    garage,
    position: place(station, lateral, lift),
    heading: Math.atan2(dx, dz),
    team,
    pose: poses[Math.floor(hash(seed + 7) * poses.length)] ?? "arms_folded",
  };
}

export function crewSpots(
  list: Station[],
  length: number,
  side: PitSide,
): CrewSpot[] {
  const at = (s: number) => stationAt(list, length, wrap(s, length));
  const out: CrewSpot[] = [];
  for (const bay of teamBays(side, length)) {
    const team = teamOfBay(bay);
    if (!team) continue;
    const s0 = side.from + bay * side.bay;
    for (let k = 0; k < 3; k++) {
      const seed = bay * 31 + k;
      const s = s0 + 2.6 + hash(seed + 3) * (side.bay - 5.2);
      out.push(
        spot(
          at(s),
          side.front + 2.2 + hash(seed + 5) * 5.5,
          0.02,
          0,
          team.car,
          seed,
        ),
      );
    }
    out.push(
      spot(
        at(s0 + side.bay / 2 + 4.4),
        side.front - 1.3,
        0.02,
        0,
        team.car,
        bay * 31 + 9,
      ),
    );
    if ((bay - firstTeamBay) % 2 !== 0) continue;
    const centre = side.from + (bay + 1) * side.bay;
    for (let k = 0; k < 3; k++)
      out.push(
        spot(
          at(centre - 2.4 + k * 2.4),
          side.wall + wallBack + 1.45,
          standFloor,
          0,
          team.car,
          bay * 31 + 20 + k,
          false,
        ),
      );
  }
  return out;
}

export function garageCars(side: PitSide, length: number): GarageCar[] {
  return teamBays(side, length).flatMap((bay) => {
    const team = teamOfBay(bay);
    if (!team) return [];
    return [
      {
        s: wrap(side.from + (bay + 0.5) * side.bay, length),
        lateral: side.front + carInGarage,
        team: team.car,
      },
    ];
  });
}
