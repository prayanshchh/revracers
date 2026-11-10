import * as THREE from "three/webgpu";

const draftPelvis = 0.949;
export interface HandGoal {
  at: THREE.Vector3;
  pole: THREE.Vector3;
  fingers: THREE.Vector3 | null;
  palm: THREE.Vector3 | null;
  grip: number;
}

export interface FootGoal {
  ball: THREE.Vector3;
  heel: number;
  yaw: number;
  pole: THREE.Vector3;
}

export interface BodyGoal {
  hips: THREE.Vector3;
  lean: number;
  twist: number;
  side: number;
  hands: [HandGoal, HandGoal];
  feet: [FootGoal, FootGoal];
  look: THREE.Vector3 | null;
}

const spine: [string, number][] = [
  ["pelvis", 0.45],
  ["spine_01", 0.65],
  ["spine_02", 0.85],
  ["spine_03", 1],
];
const fingerNames = ["index", "middle", "ring", "pinky"];
const fingerCurl = [0.95, 1.25, 0.85];
const thumbCurl = [0.35, 0.5, 0.45];
const gripDepth = 0.075;
const gripPalm = 0.03;
const clavicleReach = 0.22;
const clavicleLimit = 0.3;
const lookYaw = 1.2;
const lookPitchUp = 0.6;
const lookPitchDown = 0.9;
const neckShare = 0.4;
const reachSlack = 0.999;
const armSlack = 0.985;
const reachBand = 0.04;
const legSlack = 0.99;
const sides = ["l", "r"] as const;
const up = new THREE.Vector3(0, 1, 0);
const left = new THREE.Vector3(1, 0, 0);
const ahead = new THREE.Vector3(0, 0, 1);
const behind = new THREE.Vector3(0, 0, -1);
const palmDown = new THREE.Vector3(0, -1, 0);

const basisA = new THREE.Matrix4();
const basisB = new THREE.Matrix4();
const third = new THREE.Vector3();
const fixed = new THREE.Vector3();

function basis(
  out: THREE.Matrix4,
  a: THREE.Vector3,
  b: THREE.Vector3,
): THREE.Matrix4 {
  fixed.copy(b).addScaledVector(a, -b.dot(a)).normalize();
  third.crossVectors(a, fixed);
  return out.makeBasis(a, fixed, third);
}

function frameTurn(
  out: THREE.Quaternion,
  from: THREE.Vector3,
  fromSide: THREE.Vector3,
  to: THREE.Vector3,
  toSide: THREE.Vector3,
): THREE.Quaternion {
  basis(basisA, from, fromSide);
  basis(basisB, to, toSide);
  basisA.transpose();
  return out.setFromRotationMatrix(basisB.multiply(basisA));
}

interface Chain {
  upper: number;
  lower: number;
  end: number;
  upperLength: number;
  lowerLength: number;
  upperRest: THREE.Vector3;
  lowerRest: THREE.Vector3;
  hingeRest: THREE.Vector3;
}

function handGoal(): HandGoal {
  return {
    at: new THREE.Vector3(),
    pole: new THREE.Vector3(0, -1, -1),
    fingers: null,
    palm: null,
    grip: 0,
  };
}

function footGoal(): FootGoal {
  return {
    ball: new THREE.Vector3(),
    heel: 0,
    yaw: 0,
    pole: new THREE.Vector3(0, 0, 1),
  };
}

export function bodyGoal(): BodyGoal {
  return {
    hips: new THREE.Vector3(),
    lean: 0,
    twist: 0,
    side: 0,
    hands: [handGoal(), handGoal()],
    feet: [footGoal(), footGoal()],
    look: null,
  };
}

export class CrewRig {
  readonly bones: THREE.Bone[] = [];
  private readonly parent: number[] = [];
  private readonly restLocal: THREE.Quaternion[] = [];
  private readonly restModel: THREE.Quaternion[] = [];
  private readonly restPosition: THREE.Vector3[] = [];
  private readonly delta: THREE.Quaternion[] = [];
  private readonly given: boolean[] = [];
  private readonly at: THREE.Vector3[] = [];
  private readonly captured: THREE.Quaternion[] = [];
  private readonly capturedHips = new THREE.Vector3();
  private readonly pelvisParent = new THREE.Matrix4();
  private readonly pelvisBack = new THREE.Matrix4();
  private readonly posed: THREE.Quaternion[] = [];
  private readonly rootTurn: THREE.Quaternion[] = [];
  private readonly armTrees: number[][];
  private readonly arms: Chain[];
  private readonly legs: Chain[];
  private readonly balls: number[];
  private readonly heelReach: THREE.Vector3[];
  private readonly fingers: number[][][];
  private readonly thumbs: number[][];
  private readonly fingerRest: THREE.Vector3[];
  private readonly clavicles: number[];
  private readonly armPaths: number[][];
  private readonly legPaths: number[][];
  private readonly named = new Map<string, number>();
  private readonly pelvis: number;
  readonly stature: number;
  private readonly q = new THREE.Quaternion();
  private readonly q2 = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();
  private readonly v3 = new THREE.Vector3();
  private readonly hinge = new THREE.Vector3();
  private readonly mid = new THREE.Vector3();
  private readonly wrist = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private readonly turn = new THREE.Quaternion();
  private readonly pitchTurn = new THREE.Quaternion();

  constructor(body: THREE.Object3D) {
    body.updateMatrixWorld(true);
    const toBody = body.matrixWorld.clone().invert();
    const model = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    body.traverse((object) => {
      if (!(object instanceof THREE.Bone)) return;
      const index = this.bones.length;
      this.named.set(object.name, index);
      this.bones.push(object as THREE.Bone);
      model.multiplyMatrices(toBody, object.matrixWorld);
      model.decompose(position, rotation, scale);
      this.restModel.push(rotation.clone());
      this.restPosition.push(position.clone());
      this.restLocal.push(object.quaternion.clone());
      this.delta.push(new THREE.Quaternion());
      this.captured.push(object.quaternion.clone());
      this.posed.push(rotation.clone());
      this.rootTurn.push(
        rotation.clone().multiply(object.quaternion.clone().invert()),
      );
      this.given.push(false);
      this.at.push(position.clone());
    });
    for (const bone of this.bones)
      this.parent.push(
        bone.parent instanceof THREE.Bone
          ? (this.named.get(bone.parent.name) ?? -1)
          : -1,
      );
    this.pelvis = this.bone("pelvis");
    const pelvisBone = this.bones[this.pelvis];
    if (pelvisBone?.parent) {
      pelvisBone.parent.updateMatrixWorld(true);
      this.pelvisBack.multiplyMatrices(toBody, pelvisBone.parent.matrixWorld);
      this.pelvisParent.copy(this.pelvisBack).invert();
    }
    this.capturedHips.copy(this.restPosition[this.pelvis] ?? position);
    this.stature = this.capturedHips.y / draftPelvis;
    this.arms = sides.map((s) =>
      this.chain(`upperarm_${s}`, `lowerarm_${s}`, `hand_${s}`, behind),
    );
    this.legs = sides.map((s) =>
      this.chain(`thigh_${s}`, `calf_${s}`, `foot_${s}`, ahead),
    );
    this.balls = sides.map((s) => this.bone(`ball_${s}`));
    this.heelReach = sides.map((s) =>
      this.rest(this.bone(`foot_${s}`))
        .clone()
        .sub(this.rest(this.bone(`ball_${s}`))),
    );
    this.fingers = sides.map((s) =>
      fingerNames.map((f) =>
        [1, 2, 3].map((k) => this.bone(`${f}_0${String(k)}_${s}`)),
      ),
    );
    this.thumbs = sides.map((s) =>
      [1, 2, 3].map((k) => this.bone(`thumb_0${String(k)}_${s}`)),
    );
    this.fingerRest = sides.map((s) =>
      this.rest(this.bone(`middle_01_${s}`))
        .clone()
        .sub(this.rest(this.bone(`hand_${s}`)))
        .normalize(),
    );
    this.clavicles = sides.map((s) => this.bone(`clavicle_${s}`));
    this.armPaths = this.arms.map((arm) => this.pathTo(arm.upper));
    this.armTrees = this.arms.map((arm) =>
      this.bones.flatMap((_, i) => (this.under(i, arm.upper) ? [i] : [])),
    );
    this.legPaths = this.legs.map((leg) => this.pathTo(leg.upper));
  }

  private pathTo(index: number): number[] {
    const path: number[] = [];
    for (let i = index; i >= 0 && i !== this.pelvis; i = this.parent[i] ?? -1)
      path.unshift(i);
    return path;
  }

  private under(index: number, root: number): boolean {
    for (let i = index; i >= 0; i = this.parent[i] ?? -1)
      if (i === root) return true;
    return false;
  }

  private joint(goal: BodyGoal, path: number[]): THREE.Vector3 {
    this.at[this.pelvis]?.copy(goal.hips);
    for (const i of path) {
      this.inherit(i);
      this.place(i);
    }
    return this.at[path.at(-1) ?? this.pelvis] ?? goal.hips;
  }

  private pull(
    goal: BodyGoal,
    path: number[],
    target: THREE.Vector3,
    reach: number,
    weight: number,
  ): void {
    const gap = this.v3.copy(target).sub(this.joint(goal, path));
    const distance = gap.length();
    const over = distance - reach * (1 - reachBand);
    if (over <= 0) return;
    const soft =
      over < reach * reachBand * 2
        ? (over * over) / (reach * reachBand * 4)
        : over - reach * reachBand;
    goal.hips.addScaledVector(gap, (weight * soft) / distance);
  }

  private wristOf(goal: HandGoal, out: THREE.Vector3): THREE.Vector3 {
    out.copy(goal.at);
    if (goal.fingers && goal.palm)
      out
        .addScaledVector(goal.fingers, -gripDepth)
        .addScaledVector(goal.palm, -gripPalm);
    return out;
  }

  private ankle(side: number, goal: FootGoal, out: THREE.Vector3): void {
    this.q.setFromAxisAngle(up, goal.yaw);
    this.q2.setFromAxisAngle(left, goal.heel);
    out
      .copy(this.heelReach[side] ?? out.set(0, 0, 0))
      .applyQuaternion(this.q.multiply(this.q2))
      .add(goal.ball);
  }

  keepReach(goal: BodyGoal, held: readonly number[], planted: number): void {
    this.given.fill(false);
    for (const [name, share] of spine)
      this.give(this.bone(name), this.bodyTurn(this.turn, goal, share));
    for (let pass = 0; pass < 2; pass++) {
      this.legs.forEach((leg, side) => {
        const foot = goal.feet[side];
        if (!foot) return;
        this.ankle(side, foot, this.target);
        this.pull(
          goal,
          this.legPaths[side] ?? [],
          this.target,
          (leg.upperLength + leg.lowerLength) * legSlack,
          planted,
        );
      });
      this.arms.forEach((arm, side) => {
        const hand = goal.hands[side];
        const weight = held[side] ?? 0;
        if (!hand || weight <= 0) return;
        this.pull(
          goal,
          this.armPaths[side] ?? [],
          this.wristOf(hand, this.target),
          (arm.upperLength + arm.lowerLength) * armSlack,
          weight,
        );
      });
    }
  }

  private bone(name: string): number {
    const index = this.named.get(name);
    if (index === undefined) throw new Error(`crew rig has no ${name}`);
    return index;
  }

  private rest(index: number): THREE.Vector3 {
    const position = this.restPosition[index];
    if (!position) throw new Error("crew rig bone out of range");
    return position;
  }

  private chain(
    upper: string,
    lower: string,
    end: string,
    bend: THREE.Vector3,
  ): Chain {
    const u = this.bone(upper);
    const l = this.bone(lower);
    const e = this.bone(end);
    const upperRest = this.rest(l).clone().sub(this.rest(u));
    const lowerRest = this.rest(e).clone().sub(this.rest(l));
    const upperLength = upperRest.length();
    const lowerLength = lowerRest.length();
    upperRest.normalize();
    lowerRest.normalize();
    return {
      upper: u,
      lower: l,
      end: e,
      upperLength,
      lowerLength,
      upperRest,
      lowerRest,
      hingeRest: new THREE.Vector3().crossVectors(upperRest, bend).normalize(),
    };
  }

  restHeight(name: string): number {
    return this.rest(this.bone(name)).y;
  }

  capture(): void {
    this.bones.forEach((bone, i) => this.captured[i]?.copy(bone.quaternion));
    this.capturedHips.copy(this.bones[this.pelvis]?.position ?? this.v);
  }

  private give(index: number, value: THREE.Quaternion): void {
    this.delta[index]?.copy(value);
    this.given[index] = true;
  }

  private place(index: number): THREE.Vector3 {
    const p = this.parent[index] ?? -1;
    const here = this.at[index];
    if (!here) throw new Error("crew rig bone out of range");
    if (p < 0) return here.copy(this.rest(index));
    const parentAt = this.at[p] ?? this.v;
    const turn = this.delta[p] ?? this.q;
    return here
      .copy(this.rest(index))
      .sub(this.rest(p))
      .applyQuaternion(turn)
      .add(parentAt);
  }

  private inherit(index: number): void {
    if (this.given[index]) return;
    const p = this.parent[index] ?? -1;
    this.delta[index]?.copy(
      p < 0 ? this.q.identity() : (this.delta[p] ?? this.q),
    );
  }

  private bodyTurn(
    out: THREE.Quaternion,
    goal: BodyGoal,
    share: number,
  ): THREE.Quaternion {
    out.setFromAxisAngle(up, goal.twist * share);
    this.q2.setFromAxisAngle(left, goal.lean * share);
    out.multiply(this.q2);
    this.q2.setFromAxisAngle(ahead, -goal.side * share);
    return out.multiply(this.q2);
  }

  private twoBone(
    chain: Chain,
    target: THREE.Vector3,
    pole: THREE.Vector3,
  ): void {
    const root = this.place(chain.upper);
    const reach = this.v.copy(target).sub(root);
    const most = (chain.upperLength + chain.lowerLength) * reachSlack;
    const least = Math.abs(chain.upperLength - chain.lowerLength) + 0.01;
    const distance = THREE.MathUtils.clamp(reach.length(), least, most);
    const direction = reach.normalize();
    const a = chain.upperLength;
    const b = chain.lowerLength;
    const along = (a * a - b * b + distance * distance) / (2 * distance);
    const height = Math.sqrt(Math.max(0, a * a - along * along));
    const bend = this.v2
      .copy(pole)
      .addScaledVector(direction, -pole.dot(direction));
    if (bend.lengthSq() < 1e-8) bend.set(0, -1, 0);
    bend.normalize();
    this.mid
      .copy(root)
      .addScaledVector(direction, along)
      .addScaledVector(bend, height);
    this.wrist.copy(root).addScaledVector(direction, distance);
    const upperDir = this.v3.copy(this.mid).sub(root).normalize();
    this.hinge.crossVectors(upperDir, bend).normalize();
    if (this.hinge.lengthSq() < 1e-8) this.hinge.copy(chain.hingeRest);
    this.give(
      chain.upper,
      frameTurn(this.q, chain.upperRest, chain.hingeRest, upperDir, this.hinge),
    );
    const lowerDir = this.v3.copy(this.wrist).sub(this.mid).normalize();
    this.give(
      chain.lower,
      frameTurn(this.q, chain.lowerRest, chain.hingeRest, lowerDir, this.hinge),
    );
  }

  private clavicle(side: number, target: THREE.Vector3): void {
    const index = this.clavicles[side] ?? 0;
    const chest = this.delta[this.parent[index] ?? 0] ?? this.q;
    const base = this.place(index);
    const arm = this.arms[side];
    if (!arm) return;
    const restReach = this.v
      .copy(this.rest(arm.upper))
      .sub(this.rest(index))
      .applyQuaternion(chest)
      .normalize();
    const wanted = this.v2.copy(target).sub(base).normalize();
    const angle = Math.min(
      clavicleLimit,
      restReach.angleTo(wanted) * clavicleReach,
    );
    const axis = this.v3.crossVectors(restReach, wanted);
    if (axis.lengthSq() < 1e-8) {
      this.give(index, chest);
      return;
    }
    this.q.setFromAxisAngle(axis.normalize(), angle).multiply(chest);
    this.give(index, this.q);
  }

  private hand(side: number, goal: HandGoal): void {
    const arm = this.arms[side];
    if (!arm) return;
    const target = this.wristOf(goal, this.target);
    this.clavicle(side, target);
    this.grasp(side, arm, goal, target);
  }

  private grasp(
    side: number,
    arm: Chain,
    goal: HandGoal,
    target: THREE.Vector3,
  ): void {
    this.twoBone(arm, target, goal.pole);
    if (goal.fingers && goal.palm) {
      const restFingers = this.fingerRest[side] ?? left;
      this.give(
        arm.end,
        frameTurn(this.q, restFingers, palmDown, goal.fingers, goal.palm),
      );
    } else this.give(arm.end, this.delta[arm.lower] ?? this.q);
    this.curl(side, goal.grip);
  }

  private curl(side: number, grip: number): void {
    const arm = this.arms[side];
    const restFingers = this.fingerRest[side];
    if (!arm || !restFingers) return;
    const handTurn = this.delta[arm.end] ?? this.q;
    const axis = this.v.crossVectors(restFingers, palmDown).normalize();
    for (const finger of this.fingers[side] ?? []) {
      let angle = 0;
      finger.forEach((index, k) => {
        angle += (fingerCurl[k] ?? 0) * grip;
        this.q2.setFromAxisAngle(axis, angle);
        this.give(index, this.q.copy(handTurn).multiply(this.q2));
      });
    }
    let angle = 0;
    (this.thumbs[side] ?? []).forEach((index, k) => {
      angle += (thumbCurl[k] ?? 0) * grip;
      this.q2.setFromAxisAngle(restFingers, angle * (side === 0 ? 1 : -1));
      this.give(index, this.q.copy(handTurn).multiply(this.q2));
    });
  }

  private foot(side: number, goal: FootGoal): void {
    const leg = this.legs[side];
    const ball = this.balls[side];
    const reach = this.heelReach[side];
    if (!leg || ball === undefined || !reach) return;
    this.q.setFromAxisAngle(up, goal.yaw);
    this.give(ball, this.q);
    this.q2.setFromAxisAngle(left, goal.heel);
    this.turn.copy(this.q).multiply(this.q2);
    this.target.copy(reach).applyQuaternion(this.turn).add(goal.ball);
    this.twoBone(leg, this.target, goal.pole);
    this.give(leg.end, this.turn);
  }

  private look(target: THREE.Vector3 | null): void {
    const neck = this.bone("neck_01");
    const head = this.bone("Head");
    const chest = this.delta[this.parent[neck] ?? 0] ?? this.q;
    if (!target) {
      this.give(neck, chest);
      this.give(head, chest);
      return;
    }
    const from = this.place(head);
    const wanted = this.v
      .copy(target)
      .sub(from)
      .applyQuaternion(this.q2.copy(chest).invert())
      .normalize();
    const yaw = THREE.MathUtils.clamp(
      Math.atan2(wanted.x, wanted.z),
      -lookYaw,
      lookYaw,
    );
    const pitch = THREE.MathUtils.clamp(
      -Math.asin(THREE.MathUtils.clamp(wanted.y, -1, 1)),
      -lookPitchUp,
      lookPitchDown,
    );
    const turn = (share: number) =>
      this.turn
        .copy(chest)
        .multiply(this.q2.setFromAxisAngle(up, yaw * share))
        .multiply(this.pitchTurn.setFromAxisAngle(left, pitch * share));
    this.give(neck, turn(neckShare));
    this.give(head, turn(1));
  }

  solve(goal: BodyGoal, weight: number): void {
    this.given.fill(false);
    for (const [name, share] of spine)
      this.give(this.bone(name), this.bodyTurn(this.q, goal, share));
    this.at[this.pelvis]?.copy(goal.hips);
    for (let i = 0; i < this.bones.length; i++) {
      if (i === this.pelvis) continue;
      this.inherit(i);
      if ((this.parent[i] ?? -1) >= 0) this.place(i);
    }
    this.at[this.pelvis]?.copy(goal.hips);
    this.foot(0, goal.feet[0]);
    this.foot(1, goal.feet[1]);
    this.hand(0, goal.hands[0]);
    this.hand(1, goal.hands[1]);
    this.look(goal.look);
    for (let i = 0; i < this.bones.length; i++) this.inherit(i);
    this.write(goal.hips, weight);
  }

  private local(index: number): THREE.Quaternion {
    const p = this.parent[index] ?? -1;
    const restLocal = this.restLocal[index] ?? this.q.identity();
    if (p < 0) return this.q.copy(restLocal);
    const parentRest = this.restModel[p] ?? this.q;
    const parentTurn = this.delta[p] ?? this.q;
    const own = this.delta[index] ?? this.q;
    this.q2.copy(parentTurn).invert();
    return this.q
      .copy(parentRest)
      .invert()
      .multiply(this.q2)
      .multiply(own)
      .multiply(parentRest)
      .multiply(restLocal);
  }

  private read(): void {
    this.bones.forEach((bone, i) => {
      const p = this.parent[i] ?? -1;
      const posed = this.posed[i];
      const rest = this.restModel[i];
      const base = p < 0 ? this.rootTurn[i] : this.posed[p];
      if (!posed || !rest || !base) return;
      posed.copy(base).multiply(bone.quaternion);
      this.delta[i]?.copy(posed).multiply(this.q.copy(rest).invert());
      this.given[i] = true;
    });
    this.hips(this.at[this.pelvis] ?? this.v);
    for (let i = 0; i < this.bones.length; i++)
      if (i !== this.pelvis && (this.parent[i] ?? -1) >= 0) this.place(i);
  }

  hips(out: THREE.Vector3): THREE.Vector3 {
    const pelvis = this.bones[this.pelvis];
    if (!pelvis) return out.set(0, 0, 0);
    return out.copy(pelvis.position).applyMatrix4(this.pelvisBack);
  }

  hold(hands: readonly HandGoal[], weight: number): void {
    if (weight <= 0) return;
    this.read();
    this.arms.forEach((arm, side) => {
      const goal = hands[side];
      const tree = this.armTrees[side];
      if (!goal || !tree) return;
      for (const i of tree) this.given[i] = false;
      this.grasp(side, arm, goal, this.wristOf(goal, this.target));
      for (const i of tree) {
        this.inherit(i);
        this.bones[i]?.quaternion.slerp(this.local(i), weight);
      }
    });
  }

  private write(hips: THREE.Vector3, weight: number): void {
    this.bones.forEach((bone, i) => {
      const captured = this.captured[i];
      if (!captured) return;
      bone.quaternion.copy(captured).slerp(this.local(i), weight);
    });
    const pelvisBone = this.bones[this.pelvis];
    if (pelvisBone)
      pelvisBone.position
        .copy(this.capturedHips)
        .lerp(this.v.copy(hips).applyMatrix4(this.pelvisParent), weight);
  }
}
