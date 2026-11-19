import { readFileSync } from "node:fs";
import path from "node:path";
import { repoRoot } from "./repo.ts";

interface Point {
  x: number;
  z: number;
  wallLeft: number;
  wallRight: number;
}

export const hillCountry = path.join(repoRoot, "content/tracks/hill-country");

export const hillTrack = JSON.parse(
  readFileSync(path.join(hillCountry, "track.json"), "utf8"),
) as {
  length: number;
  centerline: Point[];
  pitLane: { centerline: { x: number; z: number }[] };
};

const track = hillTrack;

export function nearest(
  x: number,
  north: number,
): { row: number; gap: number } {
  let row = 0;
  let best = Infinity;
  track.centerline.forEach((point, index) => {
    const distance = (point.x - x) ** 2 + (-point.z - north) ** 2;
    if (distance < best) {
      best = distance;
      row = index;
    }
  });
  return { row, gap: Math.sqrt(best) };
}

export function beyondWall(x: number, north: number): number {
  const { row } = nearest(x, north);
  const point = track.centerline[row];
  const next = track.centerline[(row + 1) % track.centerline.length];
  if (!point || !next) return -Infinity;
  const tx = next.x - point.x;
  const tn = -next.z + point.z;
  const lateral =
    ((x - point.x) * -tn + (north + point.z) * tx) / Math.hypot(tx, tn);
  return lateral > 0 ? lateral - point.wallLeft : -lateral - point.wallRight;
}

export function inside(footprint: number[], x: number, z: number): boolean {
  let within = false;
  for (
    let i = 0, j = footprint.length - 2;
    i < footprint.length;
    j = i, i += 2
  ) {
    const [ax = 0, az = 0] = footprint.slice(i, i + 2);
    const [bx = 0, bz = 0] = footprint.slice(j, j + 2);
    if (az > z !== bz > z && x < ((bx - ax) * (z - az)) / (bz - az) + ax)
      within = !within;
  }
  return within;
}

export const solidLandmarks = (
  JSON.parse(
    readFileSync(path.join(hillCountry, "landmarks.json"), "utf8"),
  ) as { name: string; solid: boolean; outline: [number, number][] }[]
)
  .filter((item) => item.solid)
  .map((item) => ({ name: item.name, ring: item.outline.flat() }));

export function inLandmark(x: number, z: number): string | null {
  return solidLandmarks.find((item) => inside(item.ring, x, z))?.name ?? null;
}
