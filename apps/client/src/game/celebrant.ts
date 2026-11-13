import * as THREE from "three/webgpu";
import { bodyGoal, CrewRig } from "./crew-ik.ts";
import {
  type Build,
  buildOf,
  clamp01,
  type Draft,
  Follow,
  Follow3,
  mix,
  mixV,
  smooth,
  standing,
  type V3,
} from "./crew-motion.ts";
import { gltfToSdWorld } from "./gltf.ts";
import { draftGoal } from "./pit-crew.ts";

export type Routine = (draft: Draft, now: number, body: Celebrant) => void;

interface Footing {
  at: V3;
  from: V3;
  to: V3;
  since: number;
  stepping: boolean;
  raise: number;
}

const stepReach = 0.11;
const stepTurn = 0.4;
const stepTime = 0.24;
const stepLift = 0.08;

const footing = (): Footing => ({
  at: [0, 0, 0],
  from: [0, 0, 0],
  to: [0, 0, 0],
  since: 0,
  stepping: false,
  raise: 0,
});

const turnBetween = (a: number, b: number) =>
  Math.atan2(Math.sin(b - a), Math.cos(b - a));

class Springs {
  readonly hips: Follow3;
  readonly lean: Follow;
  readonly twist: Follow;
  readonly side: Follow;
  readonly hands: [Follow3, Follow3];
  readonly look = new Follow3(2.6, 0.9, 0);

  constructor(tempo: number) {
    this.hips = new Follow3(3.4 * tempo, 0.62, 0);
    this.lean = new Follow(3.2 * tempo, 0.6, 0);
    this.twist = new Follow(2.8 * tempo, 0.7, 0);
    this.side = new Follow(2.8 * tempo, 0.7, 0);
    this.hands = [
      new Follow3(4.6 * tempo, 0.66, 0),
      new Follow3(4.6 * tempo, 0.66, 0),
    ];
  }
}

export class Celebrant {
  readonly root = new THREE.Group();
  readonly at = { x: 0, y: 0, z: 0, yaw: 0 };
  readonly build: Build;
  air = 0;
  flying = false;
  routine: Routine = () => undefined;
  private readonly inner = new THREE.Group();
  private readonly rig: CrewRig;
  private readonly goal = bodyGoal();
  private readonly springs: Springs;
  private readonly feet: [Footing, Footing] = [footing(), footing()];
  private readonly bones = new Map<string, THREE.Object3D>();
  private planted = false;
  private fresh = true;

  constructor(
    body: THREE.Object3D,
    readonly seed: number,
  ) {
    this.build = buildOf(seed);
    this.springs = new Springs(this.build.tempo);
    this.inner.matrixAutoUpdate = false;
    this.inner.matrix.copy(gltfToSdWorld);
    this.inner.add(body);
    this.root.add(this.inner);
    body.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.frustumCulled = false;
      }
      if (object instanceof THREE.Bone) this.bones.set(object.name, object);
    });
    this.root.updateMatrixWorld(true);
    this.rig = new CrewRig(body);
  }

  place(x: number, y: number, z: number, yaw: number): void {
    Object.assign(this.at, { x, y, z, yaw });
    this.planted = false;
    this.fresh = true;
  }

  local(p: V3): V3 {
    const dx = p[0] - this.at.x;
    const dy = p[1] - this.at.y;
    const c = Math.cos(this.at.yaw);
    const s = Math.sin(this.at.yaw);
    return [dx * c + dy * s, -dx * s + dy * c, p[2] - this.at.z - this.air];
  }

  stage(p: V3): V3 {
    const c = Math.cos(this.at.yaw);
    const s = Math.sin(this.at.yaw);
    return [
      this.at.x + p[0] * c - p[1] * s,
      this.at.y + p[0] * s + p[1] * c,
      p[2] + this.at.z + this.air,
    ];
  }

  turnIn(d: V3): V3 {
    const c = Math.cos(this.at.yaw);
    const s = Math.sin(this.at.yaw);
    return [d[0] * c + d[1] * s, -d[0] * s + d[1] * c, d[2]];
  }

  turnOut(d: V3): V3 {
    const c = Math.cos(this.at.yaw);
    const s = Math.sin(this.at.yaw);
    return [d[0] * c - d[1] * s, d[0] * s + d[1] * c, d[2]];
  }

  point(bone: string, toStage: THREE.Matrix4, out: THREE.Vector3): V3 {
    const found = this.bones.get(bone);
    if (!found) return this.stage([0, 0, 1.6]);
    found.getWorldPosition(out).applyMatrix4(toStage);
    return [out.x, out.y, out.z];
  }

  update(now: number, dt: number): void {
    this.air = 0;
    this.flying = false;
    const draft = standing(this.build, now, this.seed);
    this.routine(draft, now, this);
    this.root.position.set(this.at.x, this.at.y, this.at.z + this.air);
    this.root.rotation.set(0, 0, this.at.yaw + Math.PI / 2);
    this.root.updateWorldMatrix(false, false);
    this.inner.updateWorldMatrix(false, false, true);
    this.plant(draft, now);
    const look = this.settle(draft, dt);
    this.solve(draft, look);
  }

  private plant(draft: Draft, now: number): void {
    const loose = this.flying || !this.planted;
    draft.feet.forEach((wanted, i) => {
      const foot = this.feet[i];
      const other = this.feet[1 - i];
      if (!foot || !other) return;
      const goal = this.stage([wanted.ball[0], wanted.ball[1], 0]);
      goal[2] = this.at.yaw + wanted.yaw;
      if (loose) {
        Object.assign(foot, { at: goal, to: goal, stepping: false, raise: 0 });
      } else this.stepToward(foot, other, goal, now);
      const back = this.turnIn([
        foot.at[0] - this.at.x,
        foot.at[1] - this.at.y,
        0,
      ]);
      wanted.ball = [back[0], back[1]];
      wanted.yaw = turnBetween(this.at.yaw, foot.at[2]);
      wanted.heel += foot.raise * 2.5;
    });
    this.planted = true;
  }

  private stepToward(
    foot: Footing,
    other: Footing,
    goal: V3,
    now: number,
  ): void {
    if (foot.stepping) foot.to = goal;
    else if (
      !other.stepping &&
      (Math.hypot(goal[0] - foot.at[0], goal[1] - foot.at[1]) > stepReach ||
        Math.abs(turnBetween(foot.at[2], goal[2])) > stepTurn)
    )
      Object.assign(foot, {
        from: foot.at,
        to: goal,
        since: now,
        stepping: true,
      });
    foot.raise = 0;
    if (!foot.stepping) return;
    const k = clamp01((now - foot.since) / stepTime);
    const e = smooth(k);
    foot.at = [
      mix(foot.from[0], foot.to[0], e),
      mix(foot.from[1], foot.to[1], e),
      foot.from[2] + turnBetween(foot.from[2], foot.to[2]) * e,
    ];
    foot.raise = stepLift * Math.sin(Math.PI * k);
    if (k >= 1) foot.stepping = false;
  }

  private settle(draft: Draft, dt: number): V3 | null {
    const s = this.springs;
    const fresh = this.fresh;
    this.fresh = false;
    const one = (f: Follow, x: number) => (fresh ? f.reset(x) : f.step(x, dt));
    const three = (f: Follow3, x: V3) => (fresh ? f.reset(x) : f.step(x, dt));
    draft.hips = three(s.hips, draft.hips);
    draft.lean = one(s.lean, draft.lean);
    draft.twist = one(s.twist, draft.twist);
    draft.side = one(s.side, draft.side);
    draft.hands.forEach((wanted, i) => {
      const spring = s.hands[i];
      if (spring)
        wanted.at = mixV(
          three(spring, wanted.at),
          wanted.at,
          smooth(wanted.hold ?? 0),
        );
    });
    return draft.look ? three(s.look, this.local(draft.look)) : null;
  }

  private solve(draft: Draft, look: V3 | null): void {
    const { goal, rig } = this;
    draftGoal(
      draft,
      goal,
      rig.stature,
      this.feet.map((foot) => foot.raise),
      look,
    );
    rig.keepReach(
      goal,
      [draft.hands[0].hold ?? 0, draft.hands[1].hold ?? 0],
      this.flying ? 0 : 1,
    );
    rig.solve(goal, 1);
  }
}
