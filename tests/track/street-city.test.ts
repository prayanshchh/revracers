import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
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
