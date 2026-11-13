import * as THREE from "three/webgpu";
import { describe, expect, test } from "vitest";
import { DriverArms } from "../../apps/client/src/game/driver-arms.ts";

const fullLock = 2;
const wristAt = [0.16, -0.09, -0.18] as const;
const elbowAt = [0.24, -0.18, -0.5] as const;

function sleeve(side: number): THREE.BufferGeometry {
  const from = new THREE.Vector3(wristAt[0] * side, wristAt[1], wristAt[2]);
  const to = new THREE.Vector3(elbowAt[0] * side, elbowAt[1], elbowAt[2]);
  const tube = new THREE.CylinderGeometry(0.03, 0.03, from.distanceTo(to), 12);
  tube.applyQuaternion(
    new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      to.clone().sub(from).normalize(),
    ),
  );
  const middle = from.clone().add(to).multiplyScalar(0.5);
  return tube.translate(middle.x, middle.y, middle.z);
}

function wheel(): THREE.Group {
  const group = new THREE.Group();
  const suit = new THREE.MeshBasicMaterial({ name: "suit" });
  const rim = new THREE.MeshBasicMaterial({ name: "grip" });
  const both = sleeve(1).toNonIndexed();
  const other = sleeve(-1).toNonIndexed();
  const merged = new THREE.BufferGeometry();
  for (const name of ["position", "normal", "uv"]) {
    const a = both.getAttribute(name);
    const b = other.getAttribute(name);
    const values = new Float32Array(a.array.length + b.array.length);
    values.set(a.array);
    values.set(b.array, a.array.length);
    merged.setAttribute(name, new THREE.BufferAttribute(values, a.itemSize));
  }
  group.add(new THREE.Mesh(merged, suit));
  group.add(new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.015), rim));
  return group;
}

function parts(arms: DriverArms, name: string): THREE.Vector3[] {
  return arms.root.children
    .filter((child) => child.name === name)
    .map((child) => child.position.clone());
}

describe("driver arms", () => {
  test("the sleeves leave the steering wheel so they stop spinning with it", () => {
    const steering = wheel();
    const arms = DriverArms.take(steering);
    expect(arms).not.toBeNull();
    const left = steering.children.filter(
      (child) =>
        ((child as THREE.Mesh).material as THREE.Material).name === "suit",
    );
    expect(left).toHaveLength(0);
  });

  test("at full lock the hands travel round the wheel while the elbows stay by the driver", () => {
    const arms = DriverArms.take(wheel());
    if (!arms) throw new Error("no arms");
    arms.pose(0);
    const wristsBefore = parts(arms, "forearm");
    const elbowsBefore = parts(arms, "elbow");
    arms.pose(fullLock);
    const wrists = parts(arms, "forearm");
    const elbows = parts(arms, "elbow");
    expect(wrists).toHaveLength(2);
    wrists.forEach((wrist, k) => {
      const before = wristsBefore[k] ?? wrist;
      const rigid = before
        .clone()
        .applyAxisAngle(new THREE.Vector3(0, 0, 1), fullLock);
      expect(wrist.distanceTo(rigid)).toBeLessThan(1e-6);
      expect(wrist.distanceTo(before)).toBeGreaterThan(0.2);
    });
    elbows.forEach((elbow, k) => {
      const before = elbowsBefore[k] ?? elbow;
      const swung = before
        .clone()
        .applyAxisAngle(new THREE.Vector3(0, 0, 1), fullLock);
      expect(elbow.distanceTo(before)).toBeLessThan(0.15);
      expect(swung.distanceTo(before)).toBeGreaterThan(0.4);
    });
  });

  test("each sleeve still reaches from the hand to the elbow at every steering angle", () => {
    const arms = DriverArms.take(wheel());
    if (!arms) throw new Error("no arms");
    for (const angle of [-fullLock, -1, 0, 0.7, fullLock]) {
      arms.pose(angle);
      const forearms = arms.root.children.filter(
        (child) => child.name === "forearm",
      ) as THREE.Mesh[];
      const elbows = parts(arms, "elbow");
      forearms.forEach((forearm, k) => {
        const box = new THREE.Box3().setFromBufferAttribute(
          forearm.geometry.getAttribute("position") as THREE.BufferAttribute,
        );
        const tip = new THREE.Vector3(0, 0, box.max.z * forearm.scale.z)
          .applyQuaternion(forearm.quaternion)
          .add(forearm.position);
        expect(tip.distanceTo(elbows[k] ?? tip)).toBeLessThan(0.05);
      });
    }
  });
});
