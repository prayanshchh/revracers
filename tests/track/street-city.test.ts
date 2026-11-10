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
  entrances: {
    x: number;
    z: number;
    facing: number;
    width: number;
    depth: number;
  }[];
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

describe("street city around the circuit", () => {
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
