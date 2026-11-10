import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  seasonOf,
  type Season,
} from "../../apps/client/src/game/scenery-look.ts";
import { repoRoot } from "../support/repo.ts";

interface Point {
  x: number;
  z: number;
  wallLeft: number;
  wallRight: number;
}

const directory = path.join(repoRoot, "content/tracks/hill-country");
const track = JSON.parse(
  readFileSync(path.join(directory, "track.json"), "utf8"),
) as {
  centerline: Point[];
  pitLane: { centerline: { x: number; z: number }[] };
};
const map = JSON.parse(
  readFileSync(path.join(directory, "circuit-map.json"), "utf8"),
) as { buildings: { footprint: number[] }[] };
const table = JSON.parse(
  readFileSync(path.join(repoRoot, "content/scenery/trees/trees.json"), "utf8"),
) as { species: Record<string, { spread: number }> };
const config = JSON.parse(
  readFileSync(path.join(directory, "source/scenery.json"), "utf8"),
) as { trees: { shadowReach: number; clearance: { crownShare: number } } };
const stride = 8;
const speciesCount = Object.keys(table.species).length;

function trees(): Float32Array {
  const bytes = readFileSync(path.join(directory, "trees.bin"));
  return new Float32Array(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength / Float32Array.BYTES_PER_ELEMENT,
  );
}

function nearest(x: number, north: number): { row: number; gap: number } {
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

function beyondWall(x: number, north: number): number {
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

function inside(footprint: number[], x: number, z: number): boolean {
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

describe("Hill Country trees", () => {
  const values = trees();

  test("every tree stands clear of the barriers by its crown, and off the pit lane", () => {
    expect(values.length % stride).toBe(0);
    expect(values.length / stride).toBeGreaterThan(5000);
    const offenders: number[] = [];
    for (let i = 0; i < values.length; i += stride) {
      const [x = 0, north = 0, , height = 0] = values.subarray(i, i + 4);
      const crown = height * config.trees.clearance.crownShare;
      const pitGap = Math.min(
        ...track.pitLane.centerline.map((p) =>
          Math.hypot(p.x - x, -p.z - north),
        ),
      );
      if (beyondWall(x, north) < crown + 3 || pitGap < 40)
        offenders.push(i / stride);
    }
    expect(offenders).toEqual([]);
  });

  test("no tree grows through a building or grandstand", () => {
    const offenders: number[] = [];
    for (let i = 0; i < values.length; i += stride) {
      const [x = 0, north = 0] = values.subarray(i, i + 2);
      if (nearest(x, north).gap > 900) continue;
      if (map.buildings.some((b) => inside(b.footprint, x, -north)))
        offenders.push(i / stride);
    }
    expect(offenders).toEqual([]);
  });

  test("trees use real species, sane heights, and only trackside ones cast shadows", () => {
    for (let i = 0; i < values.length; i += stride) {
      const [x = 0, north = 0, , height = 0, kind = -1, , casts = 0] =
        values.subarray(i, i + 7);
      expect(Number.isInteger(kind) && kind >= 0 && kind < speciesCount).toBe(
        true,
      );
      expect(height).toBeGreaterThan(1.5);
      expect(height).toBeLessThan(22);
      if (casts > 0.5)
        expect(nearest(x, north).gap).toBeLessThan(config.trees.shadowReach);
    }
  });
});

describe("season choice", () => {
  const venue: Season = "autumn";

  test("a chosen season wins, the circuit's own season is used otherwise", () => {
    expect(seasonOf("winter", venue, 6)).toBe("winter");
    expect(seasonOf("from track", venue, 6)).toBe("autumn");
  });

  test("'now' follows the calendar, flipped south of the equator", () => {
    expect(seasonOf("now", venue, 0)).toBe("winter");
    expect(seasonOf("now", venue, 6)).toBe("summer");
    expect(seasonOf("now", venue, 9)).toBe("autumn");
    expect(seasonOf("now", venue, 0, true)).toBe("summer");
    expect(seasonOf("now", venue, 9, true)).toBe("spring");
  });
});
