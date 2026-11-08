import * as THREE from "three/webgpu";
import { expect, test } from "vitest";
import { GravelSpray } from "../../apps/client/src/game/gravel-spray.ts";

function shownStones(spray: GravelSpray): number {
  const stones = spray.root.children.find(
    (child) => child instanceof THREE.InstancedMesh,
  );
  if (!(stones instanceof THREE.InstancedMesh)) throw new Error("no stones");
  const matrix = new THREE.Matrix4();
  let shown = 0;
  for (let i = 0; i < stones.count; i++) {
    stones.getMatrixAt(i, matrix);
    if (matrix.determinant() !== 0) shown += 1;
  }
  return shown;
}

function throwStone(spray: GravelSpray, x: number): void {
  spray.fling({
    x,
    y: 0,
    z: 0.4,
    ground: 0,
    vx: 2,
    vy: 0,
    vz: 3,
    size: 0.01,
    tone: [0.5, 0.5, 0.5],
  });
}

test("a flashback clears the flying stones, so only stones thrown after it show", () => {
  const spray = new GravelSpray();
  for (let k = 0; k < 5; k++) throwStone(spray, k);
  spray.update(10, []);
  spray.update(10.05, []);
  expect(shownStones(spray)).toBe(5);
  spray.clear();
  throwStone(spray, 20);
  spray.update(4, []);
  spray.update(4.05, []);
  expect(shownStones(spray)).toBe(1);
});
