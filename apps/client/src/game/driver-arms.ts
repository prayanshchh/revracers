import * as THREE from "three/webgpu";

const sleeveMaterial = "suit";
const endSlice = 0.02;
const elbowFollow = 0.34;
const sleeveReach = 1.04;
const shoulderBack = 0.045;
const shoulderIn = 0.028;
const shoulderUp = 0.14;
const upperGirth = 1.18;
const jointGirth = 1.12;
const shoulderGirth = 1.5;
const along = new THREE.Vector3(0, 0, 1);

interface Arm {
  mesh: THREE.Mesh;
  upper: THREE.Mesh;
  joint: THREE.Mesh;
  cap: THREE.Mesh;
  wrist: THREE.Vector3;
  elbow: THREE.Vector3;
  shoulder: THREE.Vector3;
  length: number;
}

function girthOf(geometry: THREE.BufferGeometry): number {
  const position = geometry.getAttribute("position");
  let sum = 0;
  for (let i = 0; i < position.count; i++)
    sum += Math.hypot(position.getX(i), position.getY(i));
  return sum / Math.max(1, position.count);
}

function shoulderOf(
  wrist: THREE.Vector3,
  elbow: THREE.Vector3,
  across: number,
): THREE.Vector3 {
  const reach = elbow.clone().sub(wrist);
  const rise = 1 - across;
  const shoulder = elbow.clone();
  shoulder.setComponent(
    across,
    elbow.getComponent(across) -
      Math.sign(wrist.getComponent(across)) * shoulderIn,
  );
  shoulder.setComponent(
    rise,
    elbow.getComponent(rise) - Math.sign(reach.getComponent(rise)) * shoulderUp,
  );
  shoulder.z += Math.sign(reach.z) * shoulderBack;
  return shoulder;
}

function endOf(
  position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  nearWheel: boolean,
): THREE.Vector3 {
  let low = Infinity;
  let high = -Infinity;
  for (let i = 0; i < position.count; i++) {
    low = Math.min(low, position.getZ(i));
    high = Math.max(high, position.getZ(i));
  }
  const wheelEnd = Math.abs(high) < Math.abs(low) ? high : low;
  const target = nearWheel ? wheelEnd : low + high - wheelEnd;
  const sum = new THREE.Vector3();
  const point = new THREE.Vector3();
  let count = 0;
  for (let i = 0; i < position.count; i++) {
    point.fromBufferAttribute(position, i);
    if (Math.abs(point.z - target) > endSlice) continue;
    sum.add(point);
    count++;
  }
  return sum.divideScalar(Math.max(1, count));
}

function acrossOf(source: THREE.BufferGeometry): number {
  const box = new THREE.Box3().setFromBufferAttribute(
    source.getAttribute("position") as THREE.BufferAttribute,
  );
  const size = box.getSize(new THREE.Vector3());
  return size.x > size.y ? 0 : 1;
}

function sideOf(
  source: THREE.BufferGeometry,
  across: number,
  sign: number,
): number[] {
  const position = source.getAttribute("position");
  const kept: number[] = [];
  for (let i = 0; i + 2 < position.count; i += 3)
    if (position.getComponent(i, across) * sign > 0) kept.push(i, i + 1, i + 2);
  return kept;
}

function picked(
  source: THREE.BufferGeometry,
  vertices: number[],
): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(source.attributes)) {
    const size = attribute.itemSize;
    const values = new Float32Array(vertices.length * size);
    vertices.forEach((vertex, k) => {
      for (let c = 0; c < size; c++)
        values[k * size + c] = attribute.getComponent(vertex, c);
    });
    geometry.setAttribute(name, new THREE.BufferAttribute(values, size));
  }
  return geometry;
}

function armOf(
  source: THREE.BufferGeometry,
  sign: number,
  material: THREE.Material,
): Arm | null {
  const across = acrossOf(source);
  const vertices = sideOf(source, across, sign);
  if (vertices.length === 0) return null;
  const geometry = picked(source, vertices);
  const position = geometry.getAttribute("position");
  const wrist = endOf(position, true);
  const elbow = endOf(position, false);
  const reach = elbow.clone().sub(wrist);
  const length = reach.length();
  if (length < 1e-4) return null;
  const upright = new THREE.Quaternion().setFromUnitVectors(
    reach.clone().divideScalar(length),
    along,
  );
  geometry.translate(-wrist.x, -wrist.y, -wrist.z);
  geometry.applyQuaternion(upright);
  geometry.computeBoundingSphere();
  const girth = girthOf(geometry);
  const ball = new THREE.SphereGeometry(girth * jointGirth, 14, 10);
  const parts = [geometry, geometry, ball, ball].map((shape) => {
    const part = new THREE.Mesh(shape, material);
    part.receiveShadow = true;
    part.frustumCulled = false;
    return part;
  });
  const [mesh, upper, joint, cap] = parts;
  if (!mesh || !upper || !joint || !cap) return null;
  mesh.name = "forearm";
  upper.name = "upper-arm";
  joint.name = "elbow";
  cap.name = "shoulder";
  const shoulder = shoulderOf(wrist, elbow, across);
  cap.position.copy(shoulder);
  cap.scale.setScalar(shoulderGirth);
  return { mesh, upper, joint, cap, wrist, elbow, shoulder, length };
}

export class DriverArms {
  readonly root = new THREE.Group();
  private readonly arms: Arm[] = [];
  private readonly wrist = new THREE.Vector3();
  private readonly elbow = new THREE.Vector3();
  private readonly reach = new THREE.Vector3();

  static take(wheel: THREE.Object3D): DriverArms | null {
    let sleeve: THREE.Mesh | null = null;
    wheel.traverse((object) => {
      if (
        object instanceof THREE.Mesh &&
        (object.material as THREE.Material).name === sleeveMaterial
      )
        sleeve = object as THREE.Mesh;
    });
    const found = sleeve as THREE.Mesh | null;
    if (!found) return null;
    wheel.updateMatrixWorld(true);
    const toWheel = new THREE.Matrix4()
      .copy(wheel.matrixWorld)
      .invert()
      .multiply(found.matrixWorld);
    const source = found.geometry.toNonIndexed().applyMatrix4(toWheel);
    const arms = new DriverArms();
    for (const sign of [1, -1]) {
      const arm = armOf(source, sign, found.material as THREE.Material);
      if (!arm) continue;
      arms.arms.push(arm);
      arms.root.add(arm.mesh, arm.upper, arm.joint, arm.cap);
    }
    source.dispose();
    found.removeFromParent();
    found.geometry.dispose();
    arms.root.name = "driver-arms";
    arms.root.position.copy(wheel.position);
    arms.root.scale.copy(wheel.scale);
    arms.pose(0);
    return arms;
  }

  pose(angle: number): void {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    for (const arm of this.arms) {
      const { wrist, elbow } = this;
      wrist.set(
        arm.wrist.x * cos - arm.wrist.y * sin,
        arm.wrist.x * sin + arm.wrist.y * cos,
        arm.wrist.z,
      );
      elbow
        .copy(wrist)
        .sub(arm.wrist)
        .multiplyScalar(elbowFollow)
        .add(arm.elbow);
      arm.joint.position.copy(elbow);
      arm.upper.position.copy(elbow);
      const { reach } = this;
      const lift = reach.copy(arm.shoulder).sub(elbow).length();
      arm.upper.quaternion.setFromUnitVectors(along, reach.divideScalar(lift));
      arm.upper.scale.set(upperGirth, upperGirth, lift / arm.length);
      const length = reach.copy(elbow).sub(wrist).length();
      arm.mesh.position.copy(wrist);
      arm.mesh.quaternion.setFromUnitVectors(along, reach.divideScalar(length));
      arm.mesh.scale.set(1, 1, (length / arm.length) * sleeveReach);
    }
  }
}
