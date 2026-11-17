import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as THREE from "three";
import { afterAll, describe, expect, test } from "vitest";
import {
  type DesertVenue,
  desertParts,
} from "../../apps/client/src/game/desert-layout.ts";
import type { StreetTrack } from "../../apps/client/src/game/street-layout.ts";
import { circuitOf } from "../../apps/client/src/game/circuits.ts";
import { headed } from "../../apps/client/src/game/map-heading.ts";
import {
  desertMasts,
  type FloodMap,
  floodMap,
  layoutPoles,
  type Pole,
  sampleFlood,
} from "../../apps/client/src/game/floodlights.ts";
import { floating } from "../support/floating.ts";
import { repoRoot, run } from "../support/repo.ts";

const directory = path.join(repoRoot, "content/tracks/dune-bay");
const read = (name: string): unknown =>
  JSON.parse(readFileSync(path.join(directory, name), "utf8"));
const track = read("track.json") as StreetTrack;
const venue = read("venue.json") as DesertVenue;
const points = track.centerline;
const step = track.length / points.length;

function frameAt(s: number) {
  const n = points.length;
  const i = Math.floor(
    (((s % track.length) + track.length) % track.length) / step,
  );
  const a = points[i % n];
  const b = points[(i + 1) % n];
  if (!a || !b) throw new Error("no centreline point");
  const length = Math.hypot(b.x - a.x, b.z - a.z);
  return { point: a, lx: (b.z - a.z) / length, lz: -(b.x - a.x) / length };
}

function lateralOf(x: number, z: number): { s: number; lateral: number } {
  let best = { s: 0, lateral: 0, gap: Infinity };
  points.forEach((p, i) => {
    const gap = Math.hypot(x - p.x, z - p.z);
    if (gap >= best.gap) return;
    const { lx, lz } = frameAt(i * step);
    best = { s: i * step, lateral: (x - p.x) * lx + (z - p.z) * lz, gap };
  });
  return best;
}

describe("dune bay circuit", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "dune-bay-"));
  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  test("dune-bay.xml and sd-frame.json are generated from the current track.json", () => {
    for (const file of ["track.json", "circuit-map.json"])
      copyFileSync(path.join(directory, file), path.join(scratch, file));
    const result = run("node", ["tools/sd-track.mjs", scratch]);
    expect(result.code, result.output).toBe(0);
    for (const file of ["dune-bay.xml", "sd-frame.json"])
      expect(readFileSync(path.join(scratch, file), "utf8")).toBe(
        readFileSync(path.join(directory, file), "utf8"),
      );
  });

  test("the pit wall is on the right, between the track and the pit lane", () => {
    const xml = readFileSync(path.join(directory, "dune-bay.xml"), "utf8");
    const segments = xml
      .split("\n")
      .filter((line) => line.startsWith('<section name="s'));
    const right = segments.filter((line) =>
      /name="Right Border">(?:(?!<\/section>).)*val="wall"/.test(line),
    ).length;
    const left = segments.filter((line) =>
      /name="Left Border">(?:(?!<\/section>).)*val="wall"/.test(line),
    ).length;
    const span =
      ((track.pitLane.wallEnd - track.pitLane.wallStart + track.length) %
        track.length) /
      step;
    expect(right).toBeGreaterThan(span * 0.95);
    expect(left).toBe(0);
  });

  test("the pit lane runs on the right between the track edge and the garages", () => {
    const lane = (
      track.pitLane as unknown as { centerline: { x: number; z: number }[] }
    ).centerline;
    for (const p of lane.filter((_, i) => i % 5 === 0)) {
      const { s, lateral } = lateralOf(p.x, p.z);
      const station = frameAt(s).point;
      expect(lateral).toBeLessThan(-station.width / 2 - 1);
      expect(-lateral).toBeLessThan(station.wallRight);
    }
  });

  function expectOutsideWalls(
    x: number,
    z: number,
    label: string,
    strict = false,
  ): void {
    const { s, lateral } = lateralOf(x, z);
    const station = frameAt(s).point;
    const wall = lateral > 0 ? station.wallLeft : station.wallRight;
    expect(Math.abs(lateral), `${label} at s ${s.toFixed(0)}`).toBeGreaterThan(
      strict ? wall : Math.min(wall, station.width / 2 + 4),
    );
  }

  test("no building, stand, garage, terrace, service prop, car park, road or lawn lies between the walls", () => {
    const { parts } = desertParts(track, null, venue);
    const built = parts.filter((part) =>
      /^(scenery walls|scenery shades|marquee walls|stand concrete|garage front|paddock hall|service white|lot surface|lot cars white|service roads|lawns)$/.test(
        part.name,
      ),
    );
    expect(built.map((part) => part.name).sort()).toEqual([
      "garage front",
      "lawns",
      "lot cars white",
      "lot surface",
      "marquee walls",
      "paddock hall",
      "scenery shades",
      "scenery walls",
      "service roads",
      "service white",
      "stand concrete",
    ]);
    for (const part of built) {
      expect(part.position.length, part.name).toBeGreaterThan(0);
      for (let i = 0; i < part.position.length; i += 3 * 37)
        expectOutsideWalls(
          part.position[i] ?? 0,
          part.position[i + 2] ?? 0,
          part.name,
        );
    }
  });

  test("nothing built around the circuit hangs in the air", () => {
    const { parts } = desertParts(track, null, venue);
    expect(parts.length).toBeGreaterThan(20);
    expect(floating(parts, () => 0)).toEqual([]);
  });

  test("the pit lane, its cushions and bollards stay off the racing surface on the right", () => {
    const { parts } = desertParts(track, null, venue);
    const pit = parts.filter((part) =>
      /^(pit lane|pit cushions red|pit cushions white|pit bollards)$/.test(
        part.name,
      ),
    );
    expect(pit.map((part) => part.name).sort()).toEqual([
      "pit bollards",
      "pit cushions red",
      "pit cushions white",
      "pit lane",
    ]);
    for (const part of pit) {
      expect(part.position.length, part.name).toBeGreaterThan(0);
      for (let i = 0; i < part.position.length; i += 3 * 5) {
        const { s, lateral } = lateralOf(
          part.position[i] ?? 0,
          part.position[i + 2] ?? 0,
        );
        const station = frameAt(s).point;
        expect(lateral, `${part.name} at s ${s.toFixed(0)}`).toBeLessThan(
          -station.width / 2,
        );
      }
    }
  });

  function flat(p: { x: number; y: number; z: number }): THREE.Vector3 {
    return new THREE.Vector3(p.x, -p.z, p.y);
  }

  function nightLights(): { masts: Pole[]; venueLamps: Pole[] } {
    const { lamps } = desertParts(track, null, venue);
    const of = (p: number[]) =>
      flat({ x: p[0] ?? 0, y: p[1] ?? 0, z: p[2] ?? 0 });
    const masts = layoutPoles(points, track.pitLane, desertMasts).map(
      (pole): Pole => ({ ...pole, head: flat(pole.head), aim: flat(pole.aim) }),
    );
    const venueLamps = lamps.map((lamp): Pole => {
      const head = of(lamp.head);
      const aim = of(lamp.aim);
      return {
        base: aim,
        head,
        aim,
        power: lamp.gain * head.distanceToSquared(aim),
        reach: lamp.reach,
      };
    });
    return { masts, venueLamps };
  }

  function nightMap(lights: Pole[]): FloodMap {
    return floodMap(
      points.map(flat),
      lights,
      desertMasts.brightest,
      desertMasts.spill,
      desertMasts.floor,
      {
        level: desertMasts.wash ?? 0,
        near: desertMasts.washNear ?? 0,
        far: desertMasts.washFar ?? 1,
      },
    );
  }

  function openDesert(map: FloodMap, lights: Pole[]): number[] {
    const values: number[] = [];
    const right = map.originX + map.width * map.texel;
    const top = map.originY + map.height * map.texel;
    for (let x = map.originX; x < right; x += 37)
      for (let y = map.originY; y < top; y += 37) {
        const near = lights.some(
          (lamp) => Math.hypot(lamp.head.x - x, lamp.head.y - y) < 60,
        );
        const fromTrack = Math.min(
          ...points.map((p) => Math.hypot(p.x - x, -p.z - y)),
        );
        if (!near && fromTrack > 200) values.push(sampleFlood(map, x, y));
      }
    return values;
  }

  test("at night the open desert is dark and only lit near the track and under venue lamps", () => {
    const { masts, venueLamps } = nightLights();
    const lights = [...masts, ...venueLamps];
    const map = nightMap(lights);
    const pooled = venueLamps.filter(
      (lamp) => sampleFlood(map, lamp.aim.x, lamp.aim.y) > 0.25,
    ).length;
    expect(pooled / venueLamps.length).toBeGreaterThan(0.9);
    for (let s = 0; s < track.length; s += 97)
      for (const side of [1, -1]) {
        const { point, lx, lz } = frameAt(s);
        const beside = flat({
          x: point.x + lx * side * 40,
          y: 0,
          z: point.z + lz * side * 40,
        });
        expect(
          sampleFlood(map, beside.x, beside.y),
          `s ${String(s)} side ${String(side)}`,
        ).toBeGreaterThan(0.45);
      }
    const open = openDesert(map, lights);
    expect(open.length).toBeGreaterThan(200);
    expect(
      open.filter((value) => value < 0.05).length / open.length,
    ).toBeGreaterThan(0.95);
  });

  test("the minimap and the circuit card start heading left like the reference and still turn right into Turn 1", () => {
    const heading = circuitOf("dune-bay").mapHeading;
    const plan = points.map((p): [number, number] => [p.x, p.z]);
    const world = points.map((p): [number, number] => [p.x, -p.z]);
    const turns = read("circuit-map.json") as { turns: { distance: number }[] };
    const turn1 = Math.round(
      ((turns.turns[0]?.distance ?? 0) / track.length) * points.length,
    );
    for (const [shown, yUp] of [
      [headed(plan, heading, false), false],
      [headed(world, heading, true), true],
    ] as const) {
      const screen = shown.map(([x, y]): [number, number] => [x, yUp ? -y : y]);
      const angle = (a: number, b: number) => {
        const p = screen[a] ?? [0, 0];
        const q = screen[b] ?? [0, 0];
        return Math.atan2(q[1] - p[1], q[0] - p[0]);
      };
      expect(Math.abs(Math.cos(angle(0, 2)) + 1)).toBeLessThan(0.01);
      const bend =
        angle(turn1 + 30, turn1 + 33) - angle(turn1 - 60, turn1 - 57);
      expect(Math.sin(bend), yUp ? "minimap" : "card").toBeGreaterThan(0);
    }
  });

  test("every palm and shrub grows outside the walls", () => {
    const bytes = readFileSync(path.join(directory, "trees.bin"));
    const values = new Float32Array(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength / 4,
    );
    const stride = 8;
    expect(values.length / stride).toBeGreaterThan(1000);
    for (let i = 0; i < values.length; i += stride)
      expectOutsideWalls(values[i] ?? 0, -(values[i + 1] ?? 0), "tree", true);
  });
});
