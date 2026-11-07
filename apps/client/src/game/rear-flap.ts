import * as THREE from "three/webgpu";

const openAngle = -0.38;
const hinge = new THREE.Vector3(0, 0.795, -2.168);
const flapName = "rear-flap";

const toHinge = new THREE.Matrix4();
const turn = new THREE.Matrix4();

export class RearFlap {
  private shown = -1;

  private constructor(private readonly node: THREE.Object3D) {
    node.matrixAutoUpdate = false;
  }

  static find(model: THREE.Object3D): RearFlap | null {
    const node = model.getObjectByName(flapName);
    return node ? new RearFlap(node) : null;
  }

  update(opening: number): void {
    const open = THREE.MathUtils.clamp(opening, 0, 1);
    if (open === this.shown) return;
    this.shown = open;
    const eased = open * open * (3 - 2 * open);
    this.node.matrix
      .makeTranslation(hinge)
      .multiply(turn.makeRotationX(openAngle * eased))
      .multiply(toHinge.makeTranslation(-hinge.x, -hinge.y, -hinge.z));
    this.node.matrixWorldNeedsUpdate = true;
  }
}
