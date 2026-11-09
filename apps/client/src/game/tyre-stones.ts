import * as THREE from "three/webgpu";
import {
  type CarMotion,
  type GravelSpray,
  pebble,
  rockMaterial,
} from "./gravel-spray.ts";

const slotsPerTyre = 48;
const stoneLow = 0.004;
const stoneHigh = 0.011;
const treadShare = 0.86;
const embed = 0.55;
const visibleSpin = 45;
const flingOut = 0.6;
const tones = [
  [0.42, 0.39, 0.34],
  [0.32, 0.3, 0.27],
  [0.5, 0.46, 0.4],
  [0.27, 0.24, 0.21],
] as const;

export interface TyreMount {
  spin: THREE.Object3D;
  radius: number;
  width: number;
}

interface Slot {
  local: THREE.Vector3;
  tangent: THREE.Vector3;
  size: number;
  threshold: number;
  tone: readonly number[];
}

interface Tyre {
  mount: TyreMount;
  mesh: THREE.InstancedMesh;
  slots: Slot[];
  shown: boolean[];
}

export class TyreStones {
  private readonly tyres: Tyre[];
  private readonly matrix = new THREE.Matrix4();
  private readonly rotation = new THREE.Quaternion();
  private readonly euler = new THREE.Euler();
  private readonly scale = new THREE.Vector3();
  private readonly world = new THREE.Vector3();
  private readonly velocity = new THREE.Vector3();
  private readonly colour = new THREE.Color();

  constructor(mounts: TyreMount[]) {
    const material = rockMaterial();
    this.tyres = mounts.map((mount) => {
      const slots = Array.from({ length: slotsPerTyre }, (_, k): Slot => {
        const angle = Math.random() * Math.PI * 2;
        const across = (Math.random() - 0.5) * mount.width * treadShare;
        const size = stoneLow + Math.random() * (stoneHigh - stoneLow);
        const reach = mount.radius + size * (1 - embed);
        return {
          local: new THREE.Vector3(
            across,
            reach * Math.cos(angle),
            reach * Math.sin(angle),
          ),
          tangent: new THREE.Vector3(
            0,
            -reach * Math.sin(angle),
            reach * Math.cos(angle),
          ),
          size,
          threshold: (k + Math.random()) / slotsPerTyre,
          tone: tones[k % tones.length] ?? tones[0],
        };
      });
      const mesh = new THREE.InstancedMesh(pebble, material, slotsPerTyre);
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.visible = false;
      slots.forEach((slot, i) => {
        mesh.setColorAt(
          i,
          this.colour.setRGB(
            slot.tone[0] ?? 0.6,
            slot.tone[1] ?? 0.56,
            slot.tone[2] ?? 0.5,
          ),
        );
        mesh.setMatrixAt(i, this.matrix.makeScale(0, 0, 0));
      });
      mount.spin.add(mesh);
      return { mount, mesh, slots, shown: slots.map(() => false) };
    });
  }

  get meshes(): THREE.InstancedMesh[] {
    return this.tyres.map((tyre) => tyre.mesh);
  }

  update(
    loads: readonly number[],
    spins: readonly number[],
    motion: CarMotion,
    spray: GravelSpray,
  ): void {
    this.tyres.forEach((tyre, w) => {
      const load = THREE.MathUtils.clamp(loads[w] ?? 0, 0, 1);
      const spin = spins[w] ?? 0;
      let changed = false;
      for (let i = 0; i < tyre.slots.length; i++) {
        const slot = tyre.slots[i];
        const want = slot !== undefined && load > slot.threshold;
        if (!slot || want === tyre.shown[i]) continue;
        changed = true;
        tyre.shown[i] = want;
        if (want) this.place(tyre.mesh, i, slot);
        else {
          tyre.mesh.setMatrixAt(i, this.matrix.makeScale(0, 0, 0));
          this.shed(tyre, slot, spin, motion, spray);
        }
      }
      if (changed) tyre.mesh.instanceMatrix.needsUpdate = true;
      tyre.mesh.visible =
        tyre.shown.includes(true) && Math.abs(spin) < visibleSpin;
    });
  }

  clear(): void {
    for (const tyre of this.tyres) {
      tyre.shown.fill(false);
      tyre.slots.forEach((_, i) =>
        tyre.mesh.setMatrixAt(i, this.matrix.makeScale(0, 0, 0)),
      );
      tyre.mesh.instanceMatrix.needsUpdate = true;
      tyre.mesh.visible = false;
    }
  }

  private place(mesh: THREE.InstancedMesh, i: number, slot: Slot): void {
    this.euler.set(
      slot.threshold * 31,
      slot.threshold * 17,
      slot.threshold * 7,
    );
    this.rotation.setFromEuler(this.euler);
    this.matrix.compose(
      slot.local,
      this.rotation,
      this.scale.set(slot.size, slot.size, slot.size),
    );
    mesh.setMatrixAt(i, this.matrix);
  }

  private shed(
    tyre: Tyre,
    slot: Slot,
    spin: number,
    motion: CarMotion,
    spray: GravelSpray,
  ): void {
    const spinObject = tyre.mount.spin;
    this.world.copy(slot.local).applyMatrix4(spinObject.matrixWorld);
    this.velocity
      .copy(slot.tangent)
      .multiplyScalar(spin)
      .transformDirection(spinObject.matrixWorld)
      .multiplyScalar(Math.abs(spin) * slot.local.length() + flingOut);
    spray.fling({
      x: this.world.x,
      y: this.world.y,
      z: this.world.z,
      ground: this.world.z - tyre.mount.radius,
      vx: motion.vx + this.velocity.x,
      vy: motion.vy + this.velocity.y,
      vz: Math.max(0, this.velocity.z) + 0.5,
      size: slot.size,
      tone: slot.tone,
    });
  }
}
