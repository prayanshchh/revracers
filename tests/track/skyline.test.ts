import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import type { SkylinePlan } from "../../apps/client/src/game/skyline.ts";
import { meshGround, type Ground } from "../support/mesh-ground.ts";
import { repoRoot } from "../support/repo.ts";

const directory = path.join(repoRoot, "content/tracks/hill-country");
const plan = JSON.parse(
  readFileSync(path.join(directory, "skyline.json"), "utf8"),
) as SkylinePlan;
const lfsPointer = readFileSync(path.join(directory, "road.glb"))
  .subarray(0, 40)
  .toString()
  .startsWith("version https://git-lfs");
const floatAllowed = 0.5;
const pylonDepth = 8;
const woodFloat = 1.5;
const woodStride = 12;

function towerProblem(
  ground: Ground,
  tower: SkylinePlan["towers"][number],
): string | null {
  const heights: number[] = [];
  for (let i = 0; i + 1 < tower.outline.length; i += 2) {
    const height = ground(tower.outline[i] ?? 0, tower.outline[i + 1] ?? 0);
    if (height !== null) heights.push(height);
  }
  if (heights.length === 0) return "off the horizon";
  if (tower.low === 0 && tower.base > Math.min(...heights) + floatAllowed)
    return "floats";
  return tower.base + tower.height < Math.max(...heights) ? "sunk" : null;
}

describe.skipIf(lfsPointer)("Hill Country skyline", () => {
  test("every downtown building and water tower stands on the horizon ground, none hanging in the air or sunk out of sight", async () => {
    const ground = await meshGround(
      path.join(directory, "road.glb"),
      /^horizon$/,
      400,
    );
    expect(plan.towers.length).toBeGreaterThan(50);
    const offenders: string[] = [];
    plan.towers.forEach((tower, index) => {
      const problem = towerProblem(ground, tower);
      if (problem) offenders.push(`tower ${String(index)} ${problem}`);
    });
    plan.tanks.forEach((tank, index) => {
      const height = ground(...tank.at);
      const off =
        height === null ||
        tank.base > height + floatAllowed ||
        tank.base + tank.height < height;
      if (off) offenders.push(`tank ${String(index)} off the ground`);
    });
    expect(offenders).toEqual([]);
  });

  test("every distant woodland edge stands on the ground", async () => {
    const horizon = await meshGround(
      path.join(directory, "road.glb"),
      /^horizon$/,
      400,
    );
    expect(plan.woods.length).toBeGreaterThan(7000);
    let floating = 0;
    for (let i = 0; i + woodStride <= plan.woods.length; i += woodStride) {
      const [x = 0, y = 0, z = 0] = plan.woods.slice(i, i + 3);
      const height = horizon(x, z);
      if (height !== null && y > height + woodFloat) floating++;
    }
    expect(floating / (plan.woods.length / woodStride)).toBeLessThan(0.01);
  });

  test("every power-line pylon stands on the ground", async () => {
    const file = path.join(directory, "road.glb");
    const terrain = await meshGround(file, /^terrain$/, 60);
    const horizon = await meshGround(file, /^horizon$/, 400);
    expect(plan.lines.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    plan.lines.forEach((line, index) => {
      for (let i = 0; i + 2 < line.points.length; i += 3) {
        const [x = 0, y = 0, z = 0] = line.points.slice(i, i + 3);
        const height = terrain(x, z) ?? horizon(x, z);
        if (
          height === null ||
          y > height + floatAllowed ||
          y < height - pylonDepth
        )
          offenders.push(`line ${String(index)} pylon ${String(i / 3)}`);
      }
    });
    expect(offenders).toEqual([]);
  });
});
