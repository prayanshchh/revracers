import { readFileSync } from "node:fs";
import path from "node:path";
import * as THREE from "three/webgpu";
import { describe, expect, test } from "vitest";
import { repoRoot } from "../support/repo.ts";

const directory = path.join(repoRoot, "content/tracks/hill-country");
const structures = JSON.parse(
  readFileSync(path.join(directory, "structures.json"), "utf8"),
) as { suites: { corners: number[][] }[]; bays: number[][][] };
const pointerPrefix = "version https://git-lfs";
const crowdStride = 8;
const treeStride = 8;
const canopy = 2;

function floats(name: string): Float32Array | null {
  const bytes = readFileSync(path.join(directory, name));
  if (
    bytes.subarray(0, pointerPrefix.length).toString("latin1") === pointerPrefix
  )
    return null;
  return new Float32Array(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
}

function within(corners: number[][], x: number, y: number, margin: number) {
  const [a, b, , d] = corners.map(
    ([cx = 0, cy = 0]) => new THREE.Vector2(cx, cy),
  );
  if (!a || !b || !d) return false;
  const along = b.clone().sub(a);
  const back = d.clone().sub(a);
  const at = new THREE.Vector2(x, y).sub(a);
  const s = at.dot(along) / along.length();
  const t = at.dot(back) / back.length();
  const inRun = s > -margin && s < along.length() + margin;
  const inDepth = t > -margin && t < back.length() + margin;
  return inRun && inDepth;
}

describe("venue structures", () => {
  test("no spectator is seated inside a hospitality suite", () => {
    const crowd = floats("crowd.bin");
    if (!crowd) return;
    let inside = 0;
    for (let i = 0; i < crowd.length; i += crowdStride)
      for (const suite of structures.suites)
        if (within(suite.corners, crowd[i] ?? 0, crowd[i + 1] ?? 0, 0))
          inside++;
    expect(inside).toBe(0);
  });

  test("no tree grows through a hospitality suite", () => {
    const trees = floats("trees.bin");
    if (!trees) return;
    let inside = 0;
    for (let i = 0; i < trees.length; i += treeStride)
      for (const suite of structures.suites)
        if (within(suite.corners, trees[i] ?? 0, trees[i + 1] ?? 0, canopy))
          inside++;
    expect(inside).toBe(0);
  });
});
