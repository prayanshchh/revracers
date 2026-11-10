import * as THREE from "three/webgpu";
import { expect, test, vi } from "vitest";

vi.stubGlobal("document", { querySelector: () => null });
const { newLook } = await import("../../apps/client/src/game/car-damage.ts");
const { tyreLook } = await import("../../apps/client/src/game/tyre-paint.ts");
const { carShape, PitProps } =
  await import("../../apps/client/src/game/pit-props.ts");

function hoseChains(): THREE.Vector3[][] {
  const props = new PitProps("");
  const car = new THREE.Group();
  const mounts = carShape.axles.map((ahead, c) => {
    const spin = new THREE.Mesh(
      new THREE.CylinderGeometry(0.36, 0.36, 0.3),
      new THREE.MeshStandardNodeMaterial(),
    );
    spin.position.set(ahead, carShape.tracks[c] ?? 0, carShape.hubHeight);
    car.add(spin);
    return { spin, radius: 0.36, width: 0.3 };
  });
  props.fitTyres(
    mounts,
    mounts.map(() => tyreLook()),
    tyreLook(),
  );
  const box = { x: 0, y: 0, yaw: 0 };
  props.pose(
    { plan: null, time: -Infinity, lift: [0, 0], release: false, out: true },
    box,
    [],
    { front: box, rear: box },
    null,
    newLook(),
    1,
  );
  const hoses = props.root.children.find(
    (child): child is THREE.InstancedMesh =>
      child instanceof THREE.InstancedMesh && child.count > 4,
  );
  if (!hoses) return [];
  const segments = hoses.count / 4;
  const at = new THREE.Matrix4();
  return mounts.map((_, c) =>
    Array.from({ length: segments }, (_, k) => {
      hoses.getMatrixAt(c * segments + k, at);
      return new THREE.Vector3().setFromMatrixPosition(at);
    }),
  );
}

test("wheel gun hoses hang in one piece from the gantry down to each gun", () => {
  const chains = hoseChains();
  expect(chains).toHaveLength(4);
  chains.forEach((chain, c) => {
    const top = chain[0] ?? new THREE.Vector3();
    const gun = chain.at(-1) ?? new THREE.Vector3();
    expect(top.z).toBeGreaterThan(3);
    expect(gun.z).toBeLessThan(1.5);
    expect(Math.abs(gun.y - (carShape.tracks[c] ?? 0))).toBeLessThan(1);
    const gaps = chain.slice(1).map((p, k) => p.distanceTo(chain[k] ?? p));
    expect(Math.max(...gaps)).toBeLessThan(0.6);
  });
});
