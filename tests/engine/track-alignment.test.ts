import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { repoRoot } from "../support/repo.ts";
import {
  type SpeedDreams,
  startCircuit,
  wasm,
} from "../support/speed-dreams.ts";

type Point = [number, number];

interface Centre {
  x: number;
  z: number;
}

interface Pit {
  wallStart: number;
  wallEnd: number;
  shift: number;
  ramp: number;
}

interface Frame {
  origin: [number, number, number];
  heading: number;
  pit: Pit | null;
}

const sampleStep = 5;
const searchReach = 40;
const tolerance = 0.35;
const circuits = ["hill-country", "neon-boulevard"];

function read(file: string): unknown {
  return JSON.parse(readFileSync(path.join(repoRoot, file), "utf8"));
}

function pitShift(pit: Pit | null, length: number, distance: number): number {
  if (!pit) return 0;
  const lap = (value: number) => ((value % length) + length) % length;
  if (lap(distance - pit.wallStart) <= lap(pit.wallEnd - pit.wallStart))
    return pit.shift;
  const ramp = Math.max(
    1 - lap(pit.wallStart - distance) / pit.ramp,
    1 - lap(distance - pit.wallEnd) / pit.ramp,
    0,
  );
  return pit.shift * ramp * ramp * (3 - 2 * ramp);
}

function physicsPoint(m: SpeedDreams, distance: number, lateral = 0): Point {
  const pointer = m._malloc(12);
  m._sdTrackLocal2Global(distance, lateral, pointer);
  const [x = 0, y = 0] = new Float32Array(m.HEAPF32.buffer, pointer, 2);
  return [x, y];
}

function drawnLine(centre: Centre[], frame: Frame, start: Point): Point[] {
  const [ox, , oz] = frame.origin;
  const c = Math.cos(frame.heading);
  const s = Math.sin(frame.heading);
  return centre.map((p) => {
    const x = p.x - ox;
    const y = oz - p.z;
    return [start[0] + c * x + s * y, start[1] - s * x + c * y];
  });
}

function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const along = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy);
  const t = Math.min(Math.max(along, 0), 1);
  return Math.hypot(a[0] + dx * t - p[0], a[1] + dy * t - p[1]);
}

function offRoad(line: Point[], p: Point, hint: number): number {
  const n = line.length;
  const at = (k: number) => line[((k % n) + n) % n] ?? p;
  let best = Infinity;
  for (let k = hint - searchReach; k <= hint + searchReach; k++)
    best = Math.min(best, segmentDistance(p, at(k), at(k + 1)));
  return best;
}

describe.runIf(existsSync(wasm))("physics track follows the drawn road", () => {
  test.each(circuits)(
    "%s physics centreline stays on the drawn centreline all lap",
    async (id) => {
      const m = await startCircuit(undefined, id);
      const track = read(`content/tracks/${id}/track.json`) as {
        length: number;
        centerline: Centre[];
      };
      const frame = read(`content/tracks/${id}/sd-frame.json`) as Frame;
      const line = drawnLine(track.centerline, frame, physicsPoint(m, 0));
      let worst = 0;
      for (let d = 0; d < track.length; d += sampleStep) {
        const hint = Math.round((d / track.length) * line.length);
        const centre = physicsPoint(
          m,
          d,
          -pitShift(frame.pit, track.length, d),
        );
        worst = Math.max(worst, offRoad(line, centre, hint));
      }
      expect(worst).toBeLessThan(tolerance);
    },
    120000,
  );
});
