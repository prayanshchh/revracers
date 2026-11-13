import { readFileSync } from "node:fs";
import path from "node:path";
import { float } from "three/tsl";
import * as THREE from "three/webgpu";
import { describe, expect, test } from "vitest";
import {
  type Ground,
  type Street,
  streetMesh,
  waterMesh,
} from "../../apps/client/src/game/street-roads.ts";
import { standSeats } from "../../apps/client/src/game/grandstand.ts";
import {
  dressed,
  type Venue,
} from "../../apps/client/src/game/street-venue.ts";
import {
  stations,
  type TrainingTrack,
} from "../../apps/client/src/game/training-layout.ts";
import {
  type FlagRun,
  flagParts,
  type Terrace,
  terraceParts,
  terraceZones,
} from "../../apps/client/src/game/trackside-terrace.ts";
import { inZone, outside } from "../../apps/client/src/game/trackside-props.ts";
import { repoRoot } from "../support/repo.ts";

interface Point {
  x: number;
  y: number;
  z: number;
  wallLeft: number;
  wallRight: number;
}

const directory = path.join(repoRoot, "content/tracks/neon-boulevard");
const read = (name: string): unknown =>
  JSON.parse(readFileSync(path.join(directory, name), "utf8"));
const track = read("track.json") as { centerline: Point[] };
const city = read("city.json") as {
  ground: Ground;
  roads: Street[];
  water: number[][];
  monorail: number[][];
  monorailColumns: number[];
  spectators: number[];
  buildings: { ring: number[] }[];
  venue: Venue;
  entrances: {
    x: number;
    z: number;
    facing: number;
    width: number;
    depth: number;
  }[];
};
const plan = read("dressing.json") as {
  terraces: Terrace[];
  flags: FlagRun[];
};
const columnHalf = 0.7;
const beamDepth = 1.7;
const headroom = 6;
const personHalf = 0.5;
const streetLift = 0.08;
const waterLift = 0.05;
const liftSlack = 0.005;

function groundAt(x: number, z: number): number {
  const g = city.ground;
  const column = (x - g.x) / g.step;
  const row = (g.z - z) / g.step;
  const c = Math.min(g.columns - 2, Math.floor(column));
  const r = Math.min(g.rows - 2, Math.floor(row));
  const fc = column - c;
  const fr = row - r;
  const at = (i: number, j: number) => g.heights[i * g.columns + j] ?? 0;
  const a = at(r, c);
  const b = at(r + 1, c);
  const d = at(r + 1, c + 1);
  const e = at(r, c + 1);
  return fr >= fc
    ? a + fr * (b - a) + fc * (d - b)
    : a + fc * (e - a) + fr * (d - e);
}

function sunk(positions: ArrayLike<number>, lift: number): number[][] {
  const off: number[][] = [];
  for (let i = 0; i + 2 < positions.length; i += 3) {
    const x = positions[i] ?? 0;
    const y = positions[i + 1] ?? 0;
    const z = positions[i + 2] ?? 0;
    const above = y - groundAt(x, z);
    if (Math.abs(above - lift) > liftSlack) off.push([x, z, above]);
  }
  return off;
}

function area(mesh: THREE.Mesh): number {
  const position = mesh.geometry.getAttribute("position");
  const index = mesh.geometry.getIndex();
  const triangle = new THREE.Triangle();
  let total = 0;
  for (let i = 0; index && i + 2 < index.count; i += 3) {
    triangle.setFromAttributeAndIndices(
      position,
      index.getX(i),
      index.getX(i + 1),
      index.getX(i + 2),
    );
    total += triangle.getArea();
  }
  return total;
}

function nearest(x: number, z: number) {
  const points = track.centerline;
  let best = 0;
  let gap = Infinity;
  points.forEach((p, i) => {
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < gap) {
      gap = d;
      best = i;
    }
  });
  const count = points.length;
  const at = points[best] ?? points[0];
  const before = points[(best + count - 1) % count] ?? at;
  const after = points[(best + 1) % count] ?? at;
  if (!at || !before || !after) throw new Error("empty centreline");
  const tx = after.x - before.x;
  const tz = after.z - before.z;
  const size = Math.hypot(tx, tz);
  const lateral = ((x - at.x) * tz - (z - at.z) * tx) / size;
  const wall = lateral >= 0 ? at.wallLeft : at.wallRight;
  return { lateral, wall, road: at.y };
}

function footprint(ring: number[]) {
  const xs = ring.filter((_, i) => i % 2 === 0);
  const zs = ring.filter((_, i) => i % 2 === 1);
  return {
    ring,
    left: Math.min(...xs),
    right: Math.max(...xs),
    near: Math.min(...zs),
    far: Math.max(...zs),
  };
}

function crossings(ring: number[], x: number, z: number): number {
  let count = 0;
  for (let i = 0; i < ring.length; i += 2) {
    const j = (i + ring.length - 2) % ring.length;
    const ax = Number(ring[i]);
    const az = Number(ring[i + 1]);
    const bx = Number(ring[j]);
    const bz = Number(ring[j + 1]);
    if (az > z !== bz > z && x < ((bx - ax) * (z - az)) / (bz - az) + ax)
      count += 1;
  }
  return count;
}

function covers(
  shape: ReturnType<typeof footprint>,
  x: number,
  z: number,
): boolean {
  const boxed =
    x >= shape.left && x <= shape.right && z >= shape.near && z <= shape.far;
  return boxed && crossings(shape.ring, x, z) % 2 === 1;
}

function clothArea(part: { position: number[]; index: number[] }): number {
  const corner = (k: number) =>
    new THREE.Vector3().fromArray(part.position, (part.index[k] ?? 0) * 3);
  let total = 0;
  for (let i = 0; i < part.index.length; i += 3)
    total += new THREE.Triangle(
      corner(i),
      corner(i + 1),
      corner(i + 2),
    ).getArea();
  return total;
}

describe("street city around the circuit", () => {
  test("no grandstand seat is inside a building", () => {
    const layout = read("track.json") as TrainingTrack;
    const seats = standSeats(
      stations(layout, null),
      layout.length,
      city.venue.stands.map(dressed),
    );
    const shapes = city.buildings.map((building) => footprint(building.ring));
    const blocked: number[] = [];
    for (let i = 0; i < seats.length; i += 3) {
      const [x = 0, , z = 0] = seats.slice(i, i + 3);
      if (shapes.some((shape) => covers(shape, x, z))) blocked.push(i / 3);
    }
    expect(seats.length / 3).toBeGreaterThan(30000);
    expect(blocked).toEqual([]);
  });

  test("hospitality terraces and flags stand behind the wall and outside every building", () => {
    const layout = read("track.json") as TrainingTrack;
    const list = stations(layout, null);
    const built = terraceParts(list, layout.length, plan.terraces);
    const flags = flagParts(list, layout.length, plan.flags);
    const shapes = city.buildings.map((building) => footprint(building.ring));
    const inside: number[][] = [];
    const blocked: number[][] = [];
    for (const part of [built.glass, built.deck, built.roof, flags.cloth])
      for (let i = 0; i < part.position.length; i += 3) {
        const [x = 0, , z = 0] = part.position.slice(i, i + 3);
        const { lateral, wall } = nearest(x, z);
        if (Math.abs(lateral) < wall + 0.3) inside.push([x, z, lateral]);
        if (shapes.some((shape) => covers(shape, x, z))) blocked.push([x, z]);
      }
    const flagCount = plan.flags.reduce(
      (sum, run) => sum + Math.floor((run.to - run.from) / run.every) + 1,
      0,
    );
    expect(built.glass.position.length).toBeGreaterThan(0);
    expect(clothArea(flags.cloth)).toBeGreaterThan(flagCount * 2 * 3);
    expect(inside).toEqual([]);
    expect(blocked).toEqual([]);
  });

  test("nothing else is left standing where a terrace is built", () => {
    const layout = read("track.json") as TrainingTrack;
    const list = stations(layout, null);
    const zones = terraceZones(list, layout.length, plan.terraces);
    const taken = (values: number[], stride: number) => {
      const found: number[][] = [];
      for (let i = 0; i + stride <= values.length; i += stride) {
        const [x = 0, , z = 0] = values.slice(i, i + 3);
        if (inZone(zones, list, layout.length, x, z)) found.push([x, z]);
      }
      return found;
    };
    const seats = standSeats(
      list,
      layout.length,
      city.venue.stands.map(dressed),
    );
    const people = outside(city.spectators, 3, zones, list, layout.length);
    expect(taken(seats, 3)).toEqual([]);
    expect(taken(city.monorailColumns, 6)).toEqual([]);
    expect(taken(people, 3)).toEqual([]);
    expect(people.length).toBeGreaterThan(city.spectators.length * 0.8);
  });

  test("no monorail column stands between the walls", () => {
    const inside: number[][] = [];
    for (let i = 0; i + 6 <= city.monorailColumns.length; i += 6) {
      const [x = 0, , z = 0] = city.monorailColumns.slice(i, i + 3);
      const { lateral, wall } = nearest(x, z);
      if (Math.abs(lateral) < wall + columnHalf) inside.push([x, z, lateral]);
    }
    expect(city.monorailColumns.length).toBeGreaterThan(0);
    expect(inside).toEqual([]);
  });

  test("no spectator stands between the walls", () => {
    const inside: number[][] = [];
    for (let i = 0; i + 3 <= city.spectators.length; i += 3) {
      const [x = 0, , z = 0] = city.spectators.slice(i, i + 3);
      const { lateral, wall } = nearest(x, z);
      if (Math.abs(lateral) < wall + personHalf) inside.push([x, z, lateral]);
    }
    expect(city.spectators.length).toBeGreaterThan(0);
    expect(inside).toEqual([]);
  });

  test("no hotel entrance reaches over the walls", () => {
    const inside: number[][] = [];
    for (const entrance of city.entrances) {
      const out = [Math.cos(entrance.facing), -Math.sin(entrance.facing)];
      for (const side of [-1, 0, 1]) {
        const x =
          entrance.x +
          (out[0] ?? 0) * entrance.depth +
          ((out[1] ?? 0) * side * entrance.width) / 2;
        const z =
          entrance.z +
          (out[1] ?? 0) * entrance.depth -
          ((out[0] ?? 0) * side * entrance.width) / 2;
        const { lateral, wall } = nearest(x, z);
        if (Math.abs(lateral) < wall) inside.push([x, z, lateral]);
      }
    }
    expect(city.entrances.length).toBeGreaterThan(0);
    expect(inside).toEqual([]);
  });

  test("streets and ponds lie on the ground instead of sinking into it", () => {
    const streets = streetMesh(city.roads, city.ground, float(1));
    const ponds = waterMesh(city.water, city.ground, float(1));
    const expected = city.roads.reduce((sum, street) => {
      let length = 0;
      for (let i = 2; i + 1 < street.line.length; i += 2)
        length += Math.hypot(
          (street.line[i] ?? 0) - (street.line[i - 2] ?? 0),
          (street.line[i + 1] ?? 0) - (street.line[i - 1] ?? 0),
        );
      return sum + length * street.width;
    }, 0);
    expect(area(streets)).toBeGreaterThan(expected * 0.9);
    expect(area(ponds)).toBeGreaterThan(0);
    expect(
      sunk(streets.geometry.attributes["position"]?.array ?? [], streetLift),
    ).toEqual([]);
    expect(
      sunk(ponds.geometry.attributes["position"]?.array ?? [], waterLift),
    ).toEqual([]);
  });

  test("the monorail beam clears the cars where it passes over the track", () => {
    const low: number[][] = [];
    for (const line of city.monorail)
      for (let i = 0; i + 3 <= line.length; i += 3) {
        const [x = 0, y = 0, z = 0] = line.slice(i, i + 3);
        const { lateral, wall, road } = nearest(x, z);
        if (Math.abs(lateral) < wall && y - beamDepth - road < headroom)
          low.push([x, z, y - beamDepth - road]);
      }
    expect(low).toEqual([]);
  });
});
