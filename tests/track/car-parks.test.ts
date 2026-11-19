import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { parkedStride } from "../../apps/client/src/game/car-parks.ts";
import { meshGround } from "../support/mesh-ground.ts";
import { beyondWall, inLandmark, inside } from "../support/hill-country.ts";
import { repoRoot } from "../support/repo.ts";

const directory = path.join(repoRoot, "content/tracks/hill-country");
const map = JSON.parse(
  readFileSync(path.join(directory, "circuit-map.json"), "utf8"),
) as { buildings: { footprint: number[] }[] };
const lfsPointer = readFileSync(path.join(directory, "road.glb"))
  .subarray(0, 40)
  .toString()
  .startsWith("version https://git-lfs");
const floatAllowed = 0.35;
const buriedAllowed = 0.6;
const closest = 1.9;

function parked(): Float32Array {
  const bytes = readFileSync(path.join(directory, "cars.bin"));
  return new Float32Array(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength / Float32Array.BYTES_PER_ELEMENT,
  );
}

function cellKey(x: number, z: number): string {
  return `${String(Math.floor(x / 4))}|${String(Math.floor(z / 4))}`;
}

function crowded(
  values: Float32Array,
  cells: Map<string, number[]>,
  i: number,
): number {
  const [x = 0, z = 0] = values.subarray(i, i + 2);
  const around = [-4, 0, 4].flatMap((dx) =>
    [-4, 0, 4].flatMap((dz) => cells.get(cellKey(x + dx, z + dz)) ?? []),
  );
  return around.filter((j) => {
    const [jx = 0, jz = 0] = values.subarray(j, j + 2);
    return j > i && Math.hypot(jx - x, jz - z) < closest;
  }).length;
}

describe("Hill Country car parks", () => {
  const values = parked();
  const count = values.length / parkedStride;

  test("parked cars and buses stay behind the barriers and out of the buildings", () => {
    expect(values.length % parkedStride).toBe(0);
    expect(count).toBeGreaterThan(10000);
    const offenders: number[] = [];
    for (let i = 0; i < values.length; i += parkedStride) {
      const [x = 0, north = 0] = values.subarray(i, i + 2);
      if (beyondWall(x, north) < 5) offenders.push(i / parkedStride);
      else if (map.buildings.some((b) => inside(b.footprint, x, -north)))
        offenders.push(i / parkedStride);
      else if (inLandmark(x, -north)) offenders.push(i / parkedStride);
    }
    expect(offenders).toEqual([]);
  });

  test("no two parked vehicles stand inside each other", () => {
    const cells = new Map<string, number[]>();
    for (let i = 0; i < values.length; i += parkedStride) {
      const key = cellKey(values[i] ?? 0, values[i + 1] ?? 0);
      cells.set(key, [...(cells.get(key) ?? []), i]);
    }
    let overlapping = 0;
    for (let i = 0; i < values.length; i += parkedStride)
      overlapping += crowded(values, cells, i);
    expect(overlapping).toBe(0);
  });

  test.skipIf(lfsPointer)(
    "every parked vehicle stands on the ground, none hanging in the air or sunk into it",
    async () => {
      const ground = await meshGround(
        path.join(directory, "road.glb"),
        /^terrain$/,
        60,
      );
      const offenders: number[] = [];
      let grounded = 0;
      for (let i = 0; i < values.length; i += parkedStride) {
        const [x = 0, north = 0, up = 0] = values.subarray(i, i + 3);
        const height = ground(x, -north);
        if (height === null) continue;
        grounded++;
        if (up > height + floatAllowed || up < height - buriedAllowed)
          offenders.push(i / parkedStride);
      }
      expect(grounded / count).toBeGreaterThan(0.95);
      expect(offenders.length / count).toBeLessThan(0.002);
    },
  );
});
