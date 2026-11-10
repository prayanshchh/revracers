import * as THREE from "three/webgpu";
import { clone as cloneRig } from "three/examples/jsm/utils/SkeletonUtils.js";
import { bodyGoal, CrewRig, type BodyGoal, type HandGoal } from "./crew-ik.ts";
import {
  type Build,
  type Draft,
  type FootDraft,
  type HandDraft,
  type Hull,
  type Stance,
  type V3,
  around,
  blendFoot,
  blendHand,
  blendStance,
  buildOf,
  calmed,
  clamp01,
  flip,
  Follow,
  Follow3,
  foot,
  garageFront,
  homeSpots,
  hand,
  mix,
  mixV,
  pose as strike,
  relaxedFingers,
  relaxedPalms,
  smooth,
  span,
  stance,
  standing,
  throughDoor,
  wander,
} from "./crew-motion.ts";
import { carField, carStride } from "./frame-layout.ts";
import { gltfToSdWorld } from "./gltf.ts";
import { gltfLoader } from "./gltf-loader.ts";
import { type DamageLook, newLook } from "./car-damage.ts";
import {
  type Carried,
  type CarPose,
  carShape,
  type Grip,
  jackReach,
  PitProps,
  type WingParts,
  wingGrip,
  wingHome,
  wingOff,
  wingPath,
  type WingPose,
} from "./pit-props.ts";
import { type CornerPlan, liftTimes, type StopPlan } from "./pit-service.ts";
import type { PitPhase } from "./pitstop.ts";
import { releaseOnceUploaded } from "./preload.ts";
import { surface } from "./road.ts";
import { carFile } from "./teams.ts";
import { type TyreLook, treadOf, tyreLook } from "./tyre-paint.ts";
import type { TyreMount } from "./tyre-stones.ts";
import { compounds } from "./tyres.ts";

const kitMaterials = new Set(["crew suit", "crew shell"]);
const gaitClips = ["ready", "walk", "run"];
const memberCentre = new THREE.Vector3(0, 0, 1);
const memberReach = 2.5;
const { axles, tracks, halfWidths, noseTip, rearPoint, liftHeight } = carShape;
const noseLow = 0.11;
const rearLow = 0.25;
const cradleInset = { front: 0.08, rear: -0.05 };
const runSpeed = 3.6;
const jogSpeed = 2.9;
const rearSwingAt = -0.4;
const asideAhead = 0.75;
const spareSpot: [number, number] = [2.75, 2.3];
const chiefSpot: [number, number] = [4.2, 2.6];
const chiefFacing = -2.53;
const asideOut = 1.45;
const sidepodTop = 0.74;
const wingTop = 0.26;
const walkSpeedFallback = 1.25;
const runSpeedFallback = 3.8;
const turnRate = 7;
const ikBlend = 0.3;
const clipBlend = 5;
const jogBrake = 3.5;
const swingBrake = 9;
const jogPush = 6;
const swingPush = 14;
const reachIk = 1;
const holdIk = 0.25;
const stepDistance = 0.08;
const leadLimit = 4;
const crabReach = 1.2;
const stepTurn = 0.35;
const stepTime = 0.2;
const stepLift = 0.07;
const ballHeight = 0.015;
const homeRow = 5;
const homeAfter = 1.7;
const homeSpread = 3;
const homeOrder: Record<Role, number> = {
  tyreOn: 0,
  tyreOff: 0.9,
  stabiliser: 1.2,
  wing: 1.6,
  gunner: 2,
  rearJack: 2.6,
  frontJack: 3,
  spare: 3.4,
  chief: 4.2,
};
const strollSpread = 0.44;
const carryTime = 0.3;
const carryHold = {
  ahead: 0.37,
  rise: 0.07,
  tuck: 0.03,
  low: 0.06,
  wide: 0.97,
};
const trafficDepth = 4;
const outboundPace = 1.35;
const sprintSpeed = 4.4;
const laneSpeed = 22;
const boxRun = 34;
const boxBrake = 7;
const outEarly = 2.2;
const outSettle = 0.9;
const carHalf = 0.98;
const bodyRoom = 0.2;
const sweepRoom = 0.42;
const hullRange = 30;
const corridorTime = 1.7;
const corridorLead = 7;
const sweepTime = 0.4;
const launchLead = 0.12;
const launchRoom = 3.2;
const launchTime = 0.8;
const trafficTime = 0.6;
const stillSpeed = 0.3;
const rollTime = 0.6;
const hurryTime = 0.45;
const jumpLimit = 3;
const readyOut = 1.62;
const bodyRadius = 0.2;
const clearOut = 1.72;
const clearBack = 0.3;
const homeApproach = 1.4;
const homeLetGo = 0.45;
const outSpread = 1.4;
const animatedRange = 400;
const cameraHide = 0.5;
const cameraShow = 0.65;
const cameraHeight = 2;
const gunnerGap = 0.56;
const tyreReach = { near: 0.72, lean: 0.94, off: 1.26, on: 1.08 };
const offLine: [number, number] = [0.643, -0.766];
const onLine: [number, number] = [0.661, 0.751];
const closeAt = -1.6;
const wingPost: [number, number] = [0.42, 0.12];
const jackWait = 0.3;
const jackLead = 0.07;
const gunBack = 0.2;
const gunTravel = 0.34;
const offGrip = 0.95;
const hoverBack = 0.36;
const hoverRise = 0.14;
const onGrip = 0.8;
const lookRange = 2.5;
const headFree = 0.65;
const headShare = 0.55;
const headTurn = 0.5;
const eyeRise = 0.62;
const settleTime = 0.45;
const adjustTurn = 0.018;
const adjustRate = 9;
const strayed = 0.8;
const leaveRate = 1.6;

const kneelStance = stance(
  [-0.08, -0.02, 0.455],
  0.62,
  0,
  [0.26, 0.16, 0.15, 0],
  [-0.48, -0.15, -0.05, 1.2],
);
kneelStance.feet[0].pole = [1, 0.25, 0.4];
kneelStance.feet[1].pole = [0.35, -0.1, -1];
const offStances = {
  wait: stance(
    [-0.08, 0, 0.75],
    0.5,
    0,
    [0.12, 0.26, 0.3, 0],
    [-0.12, -0.26, -0.3, 0.05],
  ),
  reach: stance(
    [0.12, 0, 0.6],
    1.15,
    -0.08,
    [0.29, 0.24, 0.15, 0],
    [-0.36, -0.2, -0.15, 0.5],
  ),
  pulled: stance(
    [-0.06, 0.03, 0.62],
    0.95,
    0.12,
    [0.1, 0.3, 0.35, 0],
    [-0.2, -0.27, -0.2, 0.1],
  ),
  rest: stance(
    [-0.08, 0.03, 0.72],
    0.62,
    0.1,
    [0.1, 0.3, 0.35, 0],
    [-0.2, -0.27, -0.2, 0.05],
  ),
};
const offLean = blendStance(offStances.wait, offStances.reach, 0.5);
const onStances = {
  wait: stance(
    [-0.14, 0, 0.62],
    0.9,
    0,
    [0.14, 0.27, 0.3, 0],
    [-0.16, -0.26, -0.3, 0.1],
  ),
  push: stance(
    [0.14, 0, 0.6],
    1.12,
    0,
    [0.38, 0.2, 0.15, 0],
    [-0.36, -0.2, -0.15, 0.55],
  ),
  clear: stance(
    [-0.2, 0, 0.72],
    0.92,
    0,
    [0.12, 0.26, 0.3, 0],
    [-0.12, -0.26, -0.3, 0],
  ),
};
const jackStances = {
  high: stance(
    [-0.14, 0, 0.79],
    0.6,
    0,
    [0.08, 0.34, 0.45, 0],
    [-0.3, -0.3, -0.4, 0.1],
  ),
  low: stance(
    [-0.3, 0, 0.55],
    0.98,
    0,
    [0.08, 0.34, 0.45, 0],
    [-0.3, -0.3, -0.4, 0.1],
  ),
  rest: stance(
    [0.3, 0, 0.9],
    0.32,
    0,
    [0.24, 0.2, 0.25, 0],
    [0.02, -0.18, -0.2, 0],
  ),
};
const guardHands: [HandDraft, HandDraft] = [
  hand([0.36, 0.2, 0.7], [-0.5, 0.9, -0.5], 0.25),
  hand([0.36, -0.2, 0.7], [-0.5, -0.9, -0.5], 0.25),
];
const kneeHands: [HandDraft, HandDraft] = [
  hand([0.17, 0.25, 0.56], [-0.2, 1, 0.3], 0.5),
  hand([0.15, -0.25, 0.56], [-0.2, -1, 0.3], 0.5),
];
const gunCarry = hand([0.14, -0.27, 0.74], [-1, -0.5, -0.2], 0.9);

type Role =
  | "gunner"
  | "tyreOff"
  | "tyreOn"
  | "frontJack"
  | "rearJack"
  | "stabiliser"
  | "wing"
  | "spare"
  | "chief";

type Spot = CarPose;

interface Motion {
  hips: Follow3;
  lean: Follow;
  twist: Follow;
  side: Follow;
  hands: [Follow3, Follow3];
  look: Follow3;
}

function motionOf(build: Build): Motion {
  const k = build.tempo;
  return {
    hips: new Follow3(2.7 * k, 0.74, 0),
    lean: new Follow(3 * k, 0.68, 0),
    twist: new Follow(2.8 * k, 0.72, 0),
    side: new Follow(2.8 * k, 0.72, 0),
    hands: [new Follow3(4 * k, 0.78, 0), new Follow3(4 * k, 0.78, 0)],
    look: new Follow3(3.3 * k, 0.85, 0),
  };
}

interface Planted {
  x: number;
  y: number;
  yaw: number;
  fromX: number;
  fromY: number;
  fromYaw: number;
  toX: number;
  toY: number;
  toYaw: number;
  since: number;
  stepping: boolean;
}

interface Member {
  role: Role;
  corner: number;
  side: number;
  root: THREE.Group;
  inner: THREE.Group;
  body: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  actions: Map<string, THREE.AnimationAction>;
  rig: CrewRig;
  goal: BodyGoal;
  spot: Spot;
  home: Spot;
  ik: number;
  vx: number;
  vy: number;
  gait: number;
  blend: [number, number, number];
  resting: boolean;
  leaveAt: number;
  startAt: number;
  feet: [Planted, Planted];
  feetReady: boolean;
  seed: number;
  build: Build;
  motion: Motion;
  settled: boolean;
  dwell: number;
  mirror: number;
  plusLeft: boolean;
  lift: number;
  grab: [number, number];
  crab: boolean;
  pressed: boolean;
  hurry: number;
  carry: number;
  carryGoal: [HandGoal, HandGoal];
  led: { x: number; y: number };
  handRight: THREE.Object3D;
  handLeft: THREE.Object3D;
}

interface StopState {
  plan: StopPlan | null;
  time: number;
  lift: [number, number];
  release: boolean;
  out: boolean;
}

const angleTo = (a: number, b: number) => {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return Math.abs(d) > Math.PI - 0.05 ? Math.PI : d;
};

function planted(): Planted {
  return {
    x: 0,
    y: 0,
    yaw: 0,
    fromX: 0,
    fromY: 0,
    fromYaw: 0,
    toX: 0,
    toY: 0,
    toYaw: 0,
    since: 0,
    stepping: false,
  };
}

function shareSkeleton(meshes: THREE.SkinnedMesh[]): void {
  const [first, ...rest] = meshes;
  if (!first) return;
  const { bones, boneInverses } = first.skeleton;
  for (const mesh of rest) {
    const other = mesh.skeleton;
    const same =
      other.bones.length === bones.length &&
      other.bones.every((bone, i) => bone === bones[i]) &&
      other.boneInverses.every((inverse, i) =>
        inverse.equals(boneInverses[i] ?? inverse),
      );
    if (same) mesh.bind(first.skeleton, mesh.bindMatrix);
  }
}

function memberBounds(mesh: THREE.Mesh): THREE.Sphere {
  const toMesh = mesh.matrixWorld.clone().invert();
  return new THREE.Sphere(
    memberCentre.clone().applyMatrix4(toMesh),
    memberReach / mesh.matrixWorld.getMaxScaleOnAxis(),
  );
}

function footSpeeds(
  body: THREE.Object3D,
  mixer: THREE.AnimationMixer,
  action: THREE.AnimationAction,
  feet: [THREE.Object3D, THREE.Object3D],
): number[] {
  const samples = 48;
  const step = action.getClip().duration / samples;
  const speeds: number[] = [];
  const inverse = new THREE.Matrix4();
  const now = [new THREE.Vector3(), new THREE.Vector3()];
  const was = [new THREE.Vector3(), new THREE.Vector3()];
  action.setEffectiveWeight(1);
  for (let i = 0; i <= samples; i++) {
    action.time = i * step;
    mixer.update(0);
    body.updateMatrixWorld(true);
    inverse.copy(body.matrixWorld).invert();
    feet.forEach((foot, k) =>
      foot
        .getWorldPosition(now[k] ?? new THREE.Vector3())
        .applyMatrix4(inverse),
    );
    const [a, b] = now as [THREE.Vector3, THREE.Vector3];
    const low = a.y < b.y ? 0 : 1;
    if (i > 0) speeds.push(((was[low]?.z ?? 0) - (now[low]?.z ?? 0)) / step);
    was.forEach((v, k) => v.copy(now[k] ?? v));
  }
  action.setEffectiveWeight(0);
  return speeds.sort((x, y) => x - y);
}

function clipSpeed(
  body: THREE.Object3D,
  mixer: THREE.AnimationMixer,
  action: THREE.AnimationAction | undefined,
  fallback: number,
): number {
  const left = body.getObjectByName("foot_l");
  const right = body.getObjectByName("foot_r");
  if (!action || !left || !right) return fallback;
  const speeds = footSpeeds(body, mixer, action, [left, right]);
  const middle = speeds[Math.floor(speeds.length / 2)] ?? fallback;
  return middle > fallback * 0.4 && middle < fallback * 2.5 ? middle : fallback;
}

function fittedLook(spin: THREE.Object3D): TyreLook {
  const found: TyreLook[] = [];
  spin.traverse((part) => {
    const look = (part.userData as { tyre?: TyreLook }).tyre;
    if (look) found.push(look);
  });
  return found[0] ?? tyreLook();
}

interface Gait {
  walkRate: number;
  runRate: number;
  walkCycle: number;
  runCycle: number;
}

export async function crewKit(
  team: string,
  anisotropy: number,
): Promise<THREE.Texture> {
  const kit = await new THREE.TextureLoader().loadAsync(
    carFile(team, "crew.jpg"),
  );
  kit.flipY = false;
  kit.colorSpace = THREE.SRGBColorSpace;
  kit.anisotropy = anisotropy;
  releaseOnceUploaded(kit);
  return kit;
}

function measureGait(member: Member | undefined): Gait {
  const walk = member?.actions.get("walk");
  const run = member?.actions.get("run");
  if (!member)
    return {
      walkRate: walkSpeedFallback,
      runRate: runSpeedFallback,
      walkCycle: 1,
      runCycle: 0.7,
    };
  return {
    walkRate: clipSpeed(member.body, member.mixer, walk, walkSpeedFallback),
    runRate: clipSpeed(member.body, member.mixer, run, runSpeedFallback),
    walkCycle: walk?.getClip().duration ?? 1,
    runCycle: run?.getClip().duration ?? 0.7,
  };
}

function handOut(wanted: HandDraft, out: HandGoal, side: number): void {
  out.at.set(wanted.at[1], wanted.at[2], wanted.at[0]);
  out.pole.set(wanted.pole[1], wanted.pole[2], wanted.pole[0]).normalize();
  out.grip = wanted.grip;
  const fingers = wanted.fingers ?? relaxedFingers;
  const palm = wanted.palm ?? relaxedPalms[side] ?? relaxedFingers;
  out.fingers = (out.fingers ?? new THREE.Vector3())
    .set(fingers[1], fingers[2], fingers[0])
    .normalize();
  out.palm = (out.palm ?? new THREE.Vector3()).set(palm[1], palm[2], palm[0]);
  out.palm.addScaledVector(out.fingers, -out.palm.dot(out.fingers));
  if (out.palm.lengthSq() < 1e-6) out.palm.set(0, -1, 0).cross(out.fingers);
  out.palm.normalize();
}

export class PitCrew {
  readonly root = new THREE.Group();
  private readonly members: Member[] = [];
  private readonly kits: THREE.MeshStandardNodeMaterial[] = [];
  private readonly props: PitProps;
  private readonly anchor = new THREE.Matrix4();
  private readonly anchorInverse = new THREE.Matrix4();
  private readonly car = { x: 0, y: 0, yaw: 0 };
  private readonly live = { x: -Infinity, y: 0, yaw: 0 };
  private readonly before = { x: -Infinity, y: 0 };
  private readonly traffic: CarPose[] = [];
  private readonly trafficBefore: { x: number; y: number }[] = [];
  private readonly trafficSpeed: number[] = [];
  private readonly hulls: Hull[] = [];
  private speed = 0;
  private readonly fresh = tyreLook();
  private wheels: THREE.Object3D[] = [];
  private readonly wheelMatrices: THREE.Matrix4[] = [];
  private wingObject: THREE.Object3D | null = null;
  private readonly wingMatrix = new THREE.Matrix4();
  private carDamage: DamageLook = newLook();
  private readonly rootInverse = new THREE.Matrix4();
  private readonly gait: Gait;
  private state: StopState = {
    plan: null,
    time: -Infinity,
    lift: [0, 0],
    release: false,
    out: false,
  };
  private stopAt: number | null = null;
  private lastTime = 0;
  private now = 0;
  private delta = 0;
  private garage = false;
  private pending = false;
  private readonly v = new THREE.Vector3();
  private readonly carMatrix = new THREE.Matrix4();
  private readonly otherMatrix = new THREE.Matrix4();

  static async load(
    url: string,
    anisotropy: number,
    team: string,
    spares = 0,
  ): Promise<PitCrew[]> {
    const [gltf, kit] = await Promise.all([
      gltfLoader().loadAsync(url),
      crewKit(team, anisotropy),
    ]);
    const kitSources = new Map<string, THREE.MeshStandardMaterial>();
    gltf.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const source = object.material as THREE.MeshStandardMaterial;
      if (kitMaterials.has(source.name)) {
        source.map = kit;
        kitSources.set(source.name, source);
      }
      object.material = surface(source, anisotropy);
    });
    const ownKit = () => {
      const model = cloneRig(gltf.scene);
      const made = new Map<string, THREE.Material>();
      model.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const name = (object.material as THREE.Material).name;
        const source = kitSources.get(name);
        if (!source) return;
        const material = made.get(name) ?? surface(source, anisotropy);
        made.set(name, material);
        object.material = material;
      });
      return model;
    };
    return [
      new PitCrew(gltf.scene, gltf.animations, team),
      ...Array.from(
        { length: spares },
        () => new PitCrew(ownKit(), gltf.animations, team),
      ),
    ];
  }

  useTeam(team: string, kit: THREE.Texture): void {
    for (const material of this.kits) material.map = kit;
    this.props.paint(team);
  }

  private constructor(
    private readonly model: THREE.Object3D,
    private readonly clips: THREE.AnimationClip[],
    team: string,
  ) {
    this.root.matrixAutoUpdate = false;
    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const material = object.material as THREE.MeshStandardNodeMaterial;
      if (kitMaterials.has(material.name) && !this.kits.includes(material))
        this.kits.push(material);
    });
    this.props = new PitProps(team);
    this.root.add(this.props.root);
    for (let corner = 0; corner < 4; corner++) {
      const side = Math.sign(tracks[corner] ?? 1);
      this.addMember("gunner", corner, side);
      this.addMember("tyreOff", corner, side);
      this.addMember("tyreOn", corner, side);
    }
    this.addMember("frontJack", 0, 1);
    this.addMember("rearJack", 0, 1);
    for (const side of [-1, 1]) {
      this.addMember("stabiliser", 0, side);
      this.addMember("wing", 0, side);
    }
    this.addMember("spare", 0, 1);
    this.addMember("chief", 0, 1);
    this.arrange();
    this.gait = measureGait(this.members[0]);
    this.root.visible = false;
  }

  private arrange(): void {
    const spots = homeSpots(this.members.length);
    const order = this.members
      .map((member) => ({
        member,
        work: this.workSpot(member.role, member.corner, member.side),
      }))
      .sort((a, b) => a.work.y - b.work.y);
    for (let from = 0; from < order.length; from += homeRow) {
      const row = order
        .slice(from, from + homeRow)
        .sort((a, b) => a.work.x - b.work.x);
      const places = spots
        .slice(from, from + homeRow)
        .sort((a, b) => a[0] - b[0]);
      row.forEach(({ member }, i) => {
        const [x, y] = places[i] ?? [0, garageFront + 1];
        member.home.x = x;
        member.home.y = y;
        member.home.yaw = -Math.PI / 2 + 0.5 * Math.sin(member.seed * 3.1);
        member.spot = { ...member.home };
        member.led = { x, y };
      });
    }
  }

  private addMember(role: Role, corner: number, side: number): void {
    const root = new THREE.Group();
    const inner = new THREE.Group();
    inner.matrixAutoUpdate = false;
    inner.matrix.copy(gltfToSdWorld);
    const body = cloneRig(this.model);
    const skinned: THREE.SkinnedMesh[] = [];
    body.traverse((object) => {
      if (object instanceof THREE.Mesh) object.castShadow = true;
      if (object instanceof THREE.SkinnedMesh)
        skinned.push(object as THREE.SkinnedMesh);
    });
    inner.add(body);
    root.add(inner);
    root.updateMatrixWorld(true);
    shareSkeleton(skinned);
    for (const mesh of skinned) mesh.boundingSphere = memberBounds(mesh);
    this.root.add(root);
    const mixer = new THREE.AnimationMixer(body);
    const actions = new Map<string, THREE.AnimationAction>();
    for (const clip of this.clips) {
      const action = mixer.clipAction(clip);
      action.play();
      action.paused = true;
      action.setEffectiveWeight(0);
      actions.set(clip.name, action);
    }
    const handLeft = body.getObjectByName("hand_l");
    const handRight = body.getObjectByName("hand_r");
    if (!handLeft || !handRight) throw new Error("crew rig has no hands");
    const index = this.members.length;
    const work = this.workSpot(role, corner, side);
    const gunner = this.wheelSpot("gunner", corner, side);
    const build = buildOf(index * 1.7);
    const home: Spot = { x: 0, y: garageFront + 1, yaw: -Math.PI / 2 };
    this.members.push({
      role,
      corner,
      side,
      root,
      inner,
      body,
      mixer,
      actions,
      rig: new CrewRig(body),
      goal: bodyGoal(),
      spot: { ...home },
      home,
      ik: 1,
      vx: 0,
      vy: 0,
      gait: 0,
      blend: [1, 0, 0],
      resting: true,
      leaveAt: (index * 0.61) % 1,
      startAt: 0,
      feet: [planted(), planted()],
      feetReady: false,
      seed: index * 1.7,
      build,
      motion: motionOf(build),
      settled: false,
      dwell: 0,
      mirror:
        (gunner.y - work.y) * Math.cos(work.yaw) -
          (gunner.x - work.x) * Math.sin(work.yaw) <
        0
          ? 1
          : -1,
      plusLeft: side * Math.sin(work.yaw) > 0,
      lift: 0,
      grab: [0, 0],
      crab: false,
      pressed: false,
      hurry: 0,
      carry: 0,
      carryGoal: [bodyGoal().hands[0], bodyGoal().hands[1]],
      led: { x: home.x, y: home.y },
      handLeft,
      handRight,
    });
  }

  attachCar(
    mounts: TyreMount[],
    wing: WingParts | null,
    damage: DamageLook,
  ): void {
    this.wingObject = wing?.frame ?? null;
    this.carDamage = damage;
    this.props.fitWing(wing);
    this.wheels = mounts.map((mount) => mount.spin);
    this.wheelMatrices.length = 0;
    this.wheelMatrices.push(...mounts.map(() => new THREE.Matrix4()));
    this.props.fitTyres(
      mounts,
      mounts.map((mount) => fittedLook(mount.spin)),
      this.fresh,
    );
  }

  setCompounds(fresh: number): void {
    this.fresh.compound.set((compounds[fresh] ?? compounds[1]).colour);
    this.fresh.tread = treadOf(fresh);
    this.fresh.wear = 0;
  }

  setAnchor(x: number, y: number, z: number, heading: number): void {
    this.anchor.makeRotationZ(heading).setPosition(x, y, z);
    this.anchorInverse.copy(this.anchor).invert();
    this.root.matrix.copy(this.anchor);
    this.root.matrixWorldNeedsUpdate = true;
  }

  private carPoint(x: number, y: number, z: number): V3 {
    const { x: cx, y: cy, yaw } = this.car;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    return [cx + x * c - y * s, cy + x * s + y * c, z];
  }

  private at(x: number, y: number, yaw: number): Spot {
    const [px, py] = this.carPoint(x, y, 0);
    return { x: px, y: py, yaw: yaw + this.car.yaw };
  }

  private wheelSpot(
    role: Role,
    corner: number,
    side: number,
    reach = tyreReach.near,
  ): Spot {
    const ax = axles[corner] ?? 0;
    const face = Math.abs(tracks[corner] ?? 0) + (halfWidths[corner] ?? 0.15);
    const end = corner < 2 ? 1 : -1;
    if (role === "gunner")
      return this.at(ax, side * (face + gunnerGap), -side * (Math.PI / 2));
    const [out, along] = role === "tyreOff" ? offLine : onLine;
    return this.at(
      ax + end * along * reach,
      side * (face + out * reach),
      Math.atan2(-side * out, -end * along),
    );
  }

  private wingSpot(side: number, f: number, l: number): Spot {
    return this.at(
      wingGrip[0] + wingPost[0] + f,
      side * (wingGrip[1] + wingPost[1]) + l,
      Math.atan2(-side * wingPost[1], -wingPost[0]),
    );
  }

  private workSpot(role: Role, corner: number, side: number): Spot {
    const toCar = side > 0 ? -Math.PI / 2 : Math.PI / 2;
    switch (role) {
      case "frontJack":
        return this.frontJackSpot();
      case "rearJack":
        return this.at(rearPoint + cradleInset.rear - jackReach.rear, 0, 0);
      case "stabiliser":
        return this.at(-0.2, side * 1.22, toCar);
      case "wing":
        return this.wingSpot(side, 0, 0);
      case "spare":
        return this.at(spareSpot[0], spareSpot[1], toCar + 0.5);
      case "chief":
        return this.at(chiefSpot[0], chiefSpot[1], chiefFacing);
      default:
        return this.wheelSpot(role, corner, side);
    }
  }

  private closing(): boolean {
    if (this.stopAt !== null) return true;
    return Math.abs(this.live.y) < 1 && this.live.x > closeAt;
  }

  private nearing(): number {
    if (this.stopAt !== null) return 1;
    if (Math.abs(this.live.y - this.car.y) >= 1) return 0;
    return span(this.live.x - this.car.x, -0.34, -0.03);
  }

  private onReach(work: CornerPlan | undefined, time: number): number {
    return work && time > work.tyreOff - 0.2 && time < work.tyreOn + 0.2
      ? tyreReach.near
      : tyreReach.on;
  }

  private tyreReach(member: Member): number {
    const { plan, time } = this.state;
    const work = plan?.service ? plan.corners[member.corner] : undefined;
    if (member.role === "tyreOn") return this.onReach(work, time);
    const waiting = plan?.service !== false && this.closing();
    return waiting && (!work || time < work.nutOff + 0.02)
      ? mix(tyreReach.lean, tyreReach.near, this.nearing())
      : tyreReach.off;
  }

  private tyreSpot(member: Member): Spot {
    return this.wheelSpot(
      member.role,
      member.corner,
      member.side,
      this.tyreReach(member),
    );
  }

  private shuffling(member: Member): boolean {
    if (member.role === "wing") return !!this.carriedWing() || this.clearing();
    if (member.role === "stabiliser") return this.clearing();
    if (member.role !== "tyreOff" && member.role !== "tyreOn") return false;
    return this.closing();
  }

  private frontJackSpot(): Spot {
    const lined = Math.abs(this.live.y) < 1;
    const meet =
      this.stopAt === null
        ? jackWait * (1 - (lined ? span(this.live.x, -1.5, -0.3) : 0))
        : 0;
    const ahead = noseTip - cradleInset.front + jackReach.front + meet;
    const pushed =
      this.stopAt === null &&
      Math.abs(this.live.y) < 1 &&
      this.live.x > this.car.x;
    const car = pushed ? this.live : this.car;
    const c = Math.cos(car.yaw);
    const s = Math.sin(car.yaw);
    return {
      x: car.x + ahead * c,
      y: car.y + ahead * s,
      yaw: car.yaw + Math.PI,
    };
  }

  private readySpot(member: Member): Spot {
    if (member.role === "rearJack") {
      const [x, y] = this.carPoint(rearPoint - 0.55, readyOut, 0);
      return { x, y, yaw: this.car.yaw + Math.PI };
    }
    return (
      this.moving(member) ??
      this.workSpot(member.role, member.corner, member.side)
    );
  }

  private clearing(): boolean {
    const { plan, time } = this.state;
    if (this.garage) return true;
    if (!plan) return false;
    return time >= (plan.service ? plan.frontDown : plan.release - 0.6);
  }

  private rearSwing(): boolean {
    if (this.stopAt !== null) return true;
    return Math.abs(this.live.y) < 1 && this.live.x - this.car.x > rearSwingAt;
  }

  update(
    phase: PitPhase,
    plan: StopPlan | null,
    serviceTime: number,
    carMatrix: THREE.Matrix4,
    eye: THREE.Vector3,
    now: number,
    cars: ArrayLike<number> | null = null,
    own = -1,
  ): { heave: number; pitch: number; off: boolean[]; wingOff: boolean } {
    const delta = Math.min(0.1, Math.max(0, now - this.lastTime));
    this.lastTime = now;
    this.now = now;
    this.delta = delta;
    this.carMatrix.copy(carMatrix);
    this.v.setFromMatrixPosition(this.anchor);
    const near = this.v.distanceTo(eye) <= animatedRange;
    this.locate(this.carMatrix, this.live);
    this.speed = this.pace(this.live, this.before, this.speed, delta);
    this.observe(cars, own, delta);
    this.track(phase, plan, serviceTime, now);
    this.fence();
    for (const member of this.members) this.move(member, delta);
    this.clearView(eye);
    this.pending = near && this.state.out;
    const lift = this.state.lift;
    const front = lift[0];
    const rear = lift[1];
    const pitch = Math.atan2(front - rear, noseTip - rearPoint);
    const heave = front - Math.tan(pitch) * noseTip;
    return {
      heave,
      pitch,
      off: this.props.wheelsOff(),
      wingOff: wingOff(this.state.plan, this.state.time),
    };
  }

  private pace(
    pose: CarPose,
    before: { x: number; y: number },
    was: number,
    delta: number,
  ): number {
    const dx = pose.x - before.x;
    const dy = pose.y - before.y;
    before.x = pose.x;
    before.y = pose.y;
    if (delta <= 0) return was;
    if (!Number.isFinite(dx) || Math.hypot(dx, dy) > jumpLimit) return 0;
    const forward = dx * Math.cos(pose.yaw) + dy * Math.sin(pose.yaw);
    return mix(was, forward / delta, 0.5);
  }

  private observe(
    cars: ArrayLike<number> | null,
    own: number,
    delta: number,
  ): void {
    const count = cars ? Math.floor(cars.length / carStride) : 0;
    this.traffic.length = count;
    for (let i = 0; i < count; i++) {
      const pose = (this.traffic[i] ??= { x: Infinity, y: 0, yaw: 0 });
      const before = (this.trafficBefore[i] ??= { x: -Infinity, y: 0 });
      if (!cars || i === own || !cars[i * carStride + carField.visible]) {
        pose.x = Infinity;
        continue;
      }
      this.locate(this.otherMatrix.fromArray(cars, i * carStride), pose);
      const was = this.trafficSpeed[i] ?? 0;
      this.trafficSpeed[i] = this.pace(pose, before, was, delta);
    }
  }

  private hull(pose: CarPose, ahead: number, room: number): Hull {
    return {
      x: pose.x,
      y: pose.y,
      yaw: pose.yaw,
      front: noseTip + ahead + room,
      rear: room - rearPoint,
      half: carHalf + room,
      open: false,
      soft: false,
      hold: false,
    };
  }

  private parked(pose: CarPose): Hull {
    return {
      ...this.hull(pose, 0, bodyRoom),
      front: noseTip + bodyRoom / 2,
      open: true,
    };
  }

  private fenceTraffic(): void {
    this.traffic.forEach((pose, i) => {
      if (!(Math.hypot(pose.x, pose.y) < hullRange)) return;
      if (pose.y > trafficDepth) return;
      const speed = this.trafficSpeed[i] ?? 0;
      this.hulls.push(
        Math.abs(speed) > stillSpeed
          ? this.hull(pose, Math.max(0, speed) * trafficTime, sweepRoom)
          : this.parked(pose),
      );
    });
  }

  private fenceArrival(): void {
    const { live, car, hulls } = this;
    const gap = car.x - live.x;
    const speed = Math.max(0, this.speed);
    const near =
      gap > 0 &&
      (gap < corridorLead || this.eta() < corridorTime) &&
      Math.abs(live.y - car.y) < 3;
    hulls.push({
      ...this.hull(car, 0, sweepRoom),
      rear: (near ? gap : 0) - rearPoint + sweepRoom,
      soft: !near,
      hold: true,
    });
    if (!(Math.hypot(gap, live.y - car.y) < hullRange)) return;
    const ahead = Math.min(speed * sweepTime, Math.max(0, gap));
    hulls.push(this.hull(live, ahead, sweepRoom));
  }

  private fence(): void {
    const { live, car, hulls } = this;
    hulls.length = 0;
    if (!this.state.out) return;
    this.fenceTraffic();
    const { plan, time, release } = this.state;
    if (this.stopAt === null && !this.garage) {
      this.fenceArrival();
      return;
    }
    const away = Math.hypot(live.x - car.x, live.y - car.y);
    if (!(away < hullRange)) return;
    const going = plan ? time >= plan.release - launchLead : release;
    hulls.push(
      going
        ? this.hull(
            live,
            Math.max(launchRoom, this.speed * launchTime),
            sweepRoom,
          )
        : this.parked(live),
    );
  }

  private eta(): number {
    const gap = this.car.x - this.live.x;
    if (!(gap > 0)) return 0;
    const braking = Math.sqrt((2 * Math.min(gap, boxRun)) / boxBrake);
    return Math.max(0, gap - boxRun) / laneSpeed + braking;
  }

  private standDown(): void {
    this.state = {
      plan: null,
      time: -Infinity,
      lift: [0, 0],
      release: false,
      out: false,
    };
    this.stopAt = null;
    this.garage = false;
    this.car.x = this.car.y = this.car.yaw = 0;
    for (const member of this.members) this.sendHome(member);
    this.props.reset();
  }

  private turnOut(phase: PitPhase, plan: StopPlan | null, now: number): void {
    this.garage = phase === "service" && plan === null;
    const eta = this.eta();
    for (const member of this.members) {
      const spot = this.readySpot(member);
      const walk = Math.hypot(spot.x - member.home.x, spot.y - member.home.y);
      const slack = eta - outEarly - outSettle - walk / jogSpeed;
      member.leaveAt = (member.seed * 0.37) % 1;
      const wait = spot.y < 0 ? 0 : member.leaveAt * outSpread;
      member.startAt = now + Math.min(wait, slack);
      if (this.garage || slack < 0) this.placeAt(member, spot);
    }
  }

  private clearView(eye: THREE.Vector3): void {
    const at = this.v.copy(eye).applyMatrix4(this.anchorInverse);
    const level = at.z > 0 && at.z < cameraHeight;
    for (const member of this.members) {
      const gap = Math.hypot(at.x - member.spot.x, at.y - member.spot.y);
      const limit = member.root.visible ? cameraHide : cameraShow;
      member.root.visible = !level || gap > limit;
    }
  }

  private track(
    phase: PitPhase,
    plan: StopPlan | null,
    serviceTime: number,
    now: number,
  ): void {
    if (phase === "track") {
      this.standDown();
      return;
    }
    if (!this.state.out) this.turnOut(phase, plan, now);
    if (phase === "service" && plan) this.park(now, serviceTime);
    const time = this.stopAt === null ? -Infinity : now - this.stopAt;
    const current = plan ?? this.state.plan;
    this.state = {
      plan: current,
      time,
      lift: this.lift(current, time),
      release:
        phase === "release" || (phase === "lane" && this.stopAt !== null),
      out: true,
    };
  }

  private park(now: number, serviceTime: number): void {
    const rolling =
      this.stopAt !== null &&
      now - this.stopAt < rollTime &&
      Math.abs(this.speed) > stillSpeed / 10;
    if (this.stopAt !== null && !rolling) return;
    this.stopAt ??= now - serviceTime;
    Object.assign(this.car, this.live);
  }

  private locate(matrix: THREE.Matrix4, out: CarPose): void {
    const local = this.v.setFromMatrixPosition(matrix);
    local.applyMatrix4(this.anchorInverse);
    const e = matrix.elements;
    const a = this.anchorInverse.elements;
    const fx = a[0] * e[0] + a[4] * e[1];
    const fy = a[1] * e[0] + a[5] * e[1];
    out.x = local.x;
    out.y = local.y;
    out.yaw = Math.atan2(fy, fx);
  }

  private lift(plan: StopPlan | null, time: number): [number, number] {
    if (!plan?.service) return [0, 0];
    const front =
      span(time, plan.frontUp, plan.frontUp + liftTimes.front) *
      (1 - span(time, plan.frontDown, plan.frontDown + liftTimes.drop));
    const rear =
      span(time, plan.rearUp, plan.rearUp + liftTimes.rear) *
      (1 - span(time, plan.rearDown, plan.rearDown + liftTimes.drop));
    return [front * liftHeight, rear * liftHeight];
  }

  private placeAt(member: Member, spot: Spot): void {
    member.spot = { ...spot };
    member.led = { x: spot.x, y: spot.y };
    member.vx = member.vy = 0;
    member.blend = [1, 0, 0];
    member.ik = 1;
    member.dwell = settleTime;
    member.feetReady = member.settled = false;
  }

  private sendHome(member: Member): void {
    this.placeAt(member, member.home);
    member.ik = 0;
  }

  private homeward(member: Member): boolean {
    const { plan, time, release } = this.state;
    if (!this.garage && this.now < member.startAt) return true;
    if (!release || !plan) return false;
    if (
      member.role === "wing" &&
      plan.wing &&
      time < wingHome(plan.duration).down + homeLetGo
    )
      return false;
    return (
      time >
      plan.duration +
        homeAfter +
        homeOrder[member.role] +
        member.leaveAt * homeSpread
    );
  }

  private jackMove(member: Member): Spot | null {
    if (member.role === "frontJack")
      return this.clearing()
        ? this.at(noseTip + asideAhead, asideOut, Math.PI / 2)
        : null;
    if (member.role !== "rearJack" || this.state.plan?.service === false)
      return null;
    return this.rearSwing()
      ? this.workSpot("rearJack", 0, 1)
      : this.readySpot(member);
  }

  private standClear(member: Member): Spot | null {
    if (!this.clearing()) return null;
    if (member.role === "wing")
      return this.wingSpot(
        member.side,
        -clearBack,
        member.side * (clearOut - wingGrip[1] - wingPost[1]),
      );
    return this.at(
      -0.2,
      member.side * clearOut,
      member.side > 0 ? -Math.PI / 2 : Math.PI / 2,
    );
  }

  private moving(member: Member): Spot | null {
    if (member.role === "tyreOff" || member.role === "tyreOn")
      return this.tyreSpot(member);
    if (member.role === "stabiliser") return this.standClear(member);
    if (member.role !== "wing") return this.jackMove(member);
    const carried = this.carriedWing();
    return carried ? this.wingStand(member, carried) : this.standClear(member);
  }

  private target(member: Member): Spot {
    member.resting = this.homeward(member);
    if (member.resting) return member.home;
    return this.moving(member) ?? this.readySpot(member);
  }

  private outbound(distance: number, stroll: number): number {
    if (this.stopAt !== null) return jogSpeed;
    const walk = this.gait.walkRate * outboundPace * stroll;
    const needed = distance / Math.max(0.2, this.eta() - outEarly);
    return Math.max(walk, Math.min(sprintSpeed, needed));
  }

  private steer(
    member: Member,
    goal: Spot,
    reach: number,
    distance: number,
    delta: number,
  ): void {
    const swinging = this.swinging(member);
    const stroll =
      1 - strollSpread / 2 + strollSpread * ((member.seed * 0.53) % 1);
    const cruise = swinging
      ? runSpeed
      : member.resting
        ? this.gait.walkRate * stroll
        : this.outbound(distance, stroll);
    const wanted = Math.min(
      cruise,
      Math.sqrt(2 * (swinging ? swingBrake : jogBrake) * distance),
    );
    const scale = reach > 1e-4 ? wanted / reach : 0;
    const [leadX, leadY] = this.lead(member, goal, delta);
    const ax = leadX + (goal.x - member.spot.x) * scale - member.vx;
    const ay = leadY + (goal.y - member.spot.y) * scale - member.vy;
    const push = (swinging || member.crab ? swingPush : jogPush) * delta;
    const k = Math.min(1, push / Math.max(1e-6, Math.hypot(ax, ay)));
    member.vx += ax * k;
    member.vy += ay * k;
    member.spot.x += member.vx * delta;
    member.spot.y += member.vy * delta;
  }

  private swinging(member: Member): boolean {
    if (member.pressed) return true;
    if (member.resting) return false;
    if (member.role === "rearJack") return this.rearSwing();
    if (member.role === "frontJack") return this.clearing();
    return this.shuffling(member);
  }

  private lead(member: Member, goal: Spot, delta: number): [number, number] {
    const { led } = member;
    const dx = goal.x - led.x;
    const dy = goal.y - led.y;
    led.x = goal.x;
    led.y = goal.y;
    if (delta <= 0 || Math.hypot(dx, dy) > leadLimit * delta) return [0, 0];
    return [dx / delta, dy / delta];
  }

  private stride(
    member: Member,
    goal: Spot,
    holding: number,
    delta: number,
  ): void {
    const speed = Math.hypot(member.vx, member.vy);
    const stride = smooth((speed - 0.12) / 0.5) * (1 - holding);
    const dx = goal.x - member.spot.x;
    const dy = goal.y - member.spot.y;
    const away = smooth((Math.hypot(dx, dy) - 0.4) / 0.8) * (1 - holding);
    const heading =
      speed > 0.05 ? Math.atan2(member.vy, member.vx) : Math.atan2(dy, dx);
    const reach = member.crab
      ? smooth((Math.hypot(dx, dy) - crabReach) / 0.6)
      : 1;
    const turn = Math.max(stride, away) * reach;
    const fx = Math.cos(goal.yaw) * (1 - turn) + Math.cos(heading) * turn;
    const fy = Math.sin(goal.yaw) * (1 - turn) + Math.sin(heading) * turn;
    const facing =
      Math.hypot(fx, fy) > 0.2 ? Math.atan2(fy, fx) : member.spot.yaw;
    member.spot.yaw +=
      angleTo(member.spot.yaw, facing) * Math.min(1, turnRate * delta);
    const sprint = smooth((speed - 1.6) / 1.1);
    const aim = [1 - stride, stride * (1 - sprint), stride * sprint];
    const fade = Math.min(1, clipBlend * delta);
    member.blend = member.blend.map((w, i) => mix(w, aim[i] ?? 0, fade)) as [
      number,
      number,
      number,
    ];
    const { walkRate, walkCycle, runRate, runCycle } = this.gait;
    const cycle = mix(walkRate * walkCycle, runRate * runCycle, sprint);
    member.gait = (member.gait + (speed * delta) / Math.max(0.1, cycle)) % 1;
  }

  private route(member: Member, goal: Spot): { way: Spot; rest: number } {
    const at: [number, number] = [member.spot.x, member.spot.y];
    let to: [number, number] = [goal.x, goal.y];
    let rest = 0;
    const meeting = member.role === "frontJack" && this.stopAt === null;
    for (const hull of meeting ? [] : this.hulls) {
      const turn = around(at, to, hull);
      if (turn.inside) member.hurry = this.now + hurryTime;
      rest += turn.rest;
      to = turn.way;
    }
    member.pressed = this.now < member.hurry;
    if (!member.crab && !member.pressed) {
      const door = throughDoor(at, to);
      rest += Math.hypot(door[0] - to[0], door[1] - to[1]);
      to = door;
    }
    return { way: { x: to[0], y: to[1], yaw: goal.yaw }, rest };
  }

  private carrying(member: Member): boolean {
    if (member.role === "tyreOn")
      return this.props.inHand(member.corner, "new");
    return member.role === "tyreOff" && this.props.inHand(member.corner, "old");
  }

  private carryHands(member: Member, hips: V3): [HandDraft, HandDraft] {
    const reach = this.props.tyreRadius(member.corner) * carryHold.wide;
    const ahead = hips[0] + carryHold.ahead - carryHold.tuck;
    const height =
      hips[2] * member.rig.stature + carryHold.rise - carryHold.low;
    const grip = (side: number): HandDraft => ({
      at: [ahead, hips[1] + side * reach, height],
      pole: [-0.35, side, -0.45],
      fingers: [0.85, -side * 0.3, -0.35],
      palm: [0, -side, 0],
      grip: 0.55,
      hold: 1,
    });
    return [grip(1), grip(-1)];
  }

  private cradle(member: Member, draft: Draft): void {
    const k = member.lift * smooth(member.carry);
    if (k <= 0.001) return;
    const hold = this.carryHands(member, draft.hips);
    draft.hands = [
      blendHand(draft.hands[0], hold[0], k, 0),
      blendHand(draft.hands[1], hold[1], k, 1),
    ];
  }

  private hug(member: Member): void {
    const k = smooth(member.carry);
    if (k <= 0.001) return;
    const { rig } = member;
    const hips = rig.hips(this.v);
    const hold = this.carryHands(member, [
      hips.z,
      hips.x,
      hips.y / rig.stature,
    ]);
    hold.forEach((wanted, i) => {
      const out = member.carryGoal[i];
      if (out) handOut(wanted, out, i);
    });
    rig.hold(member.carryGoal, k);
  }

  private move(member: Member, delta: number): void {
    const held = this.carrying(member) ? 1 : -1;
    member.carry = clamp01(member.carry + (held * delta) / carryTime);
    const { way: goal, rest } = this.route(member, this.target(member));
    member.crab = member.pressed || (!member.resting && this.shuffling(member));
    const reach = Math.hypot(goal.x - member.spot.x, goal.y - member.spot.y);
    const distance = reach + rest;
    this.steer(member, goal, reach, distance, delta);
    const holding = member.resting
      ? 0
      : member.crab
        ? span(-distance, -crabReach - 0.2, -crabReach + 0.2)
        : span(-distance, -reachIk, -holdIk);
    this.stride(member, goal, holding, delta);
    const change = holding - member.ik;
    member.ik +=
      Math.sign(change) * Math.min(Math.abs(change), delta / ikBlend);
    if (member.ik < 0.05) member.feetReady = member.settled = false;
    member.dwell =
      member.resting || distance > strayed
        ? Math.max(0, member.dwell - delta * leaveRate)
        : Math.min(settleTime, member.dwell + delta);
  }

  prepare(): void {
    if (!this.pending) return;
    this.pending = false;
    this.root.updateWorldMatrix(true, false);
    this.props.root.updateWorldMatrix(false, false, true);
    this.rootInverse.copy(this.root.matrixWorld).invert();
    this.wheels.forEach((wheel, i) =>
      this.wheelMatrices[i]?.multiplyMatrices(
        this.rootInverse,
        wheel.matrixWorld,
      ),
    );
    const wing = this.wingObject
      ? this.wingMatrix.multiplyMatrices(
          this.rootInverse,
          this.wingObject.matrixWorld,
        )
      : null;
    this.props.pose(
      this.state,
      this.car,
      this.wheelMatrices,
      { front: this.jackSpot("frontJack"), rear: this.jackSpot("rearJack") },
      wing,
      this.carDamage,
      this.now,
    );
    for (const member of this.members) this.pose(member);
    const carried: Carried[] = [];
    for (const member of this.members) {
      const weight = Math.max(1 - smooth(member.ik), member.lift);
      if (weight <= 0.001) continue;
      if (
        member.role !== "gunner" &&
        member.role !== "tyreOff" &&
        member.role !== "tyreOn"
      )
        continue;
      member.handRight.updateWorldMatrix(true, false);
      member.handLeft.updateWorldMatrix(true, false);
      carried.push({
        role: member.role,
        corner: member.corner,
        hand: member.handRight,
        other: member.handLeft,
        spot: member.spot,
        weight,
      });
    }
    this.props.carry(carried, this.root.matrixWorld);
  }

  private jackSpot(role: Role): Spot {
    return (
      this.members.find((member) => member.role === role)?.spot ?? this.car
    );
  }

  private pose(member: Member): void {
    const { root, spot } = member;
    root.position.set(spot.x, spot.y, 0);
    root.rotation.set(0, 0, spot.yaw + Math.PI / 2);
    root.updateWorldMatrix(false, false);
    member.inner.updateWorldMatrix(false, false, true);
    const weight = smooth(member.ik);
    if (weight < 0.999) this.animate(member);
    member.lift = 0;
    if (member.ik <= 0.001) return;
    const draft = this.draft(member);
    this.plant(member, draft);
    this.toGoal(member, draft);
    member.rig.solve(member.goal, weight);
  }

  private animate(member: Member): void {
    for (const action of member.actions.values()) action.setEffectiveWeight(0);
    gaitClips.forEach((name, i) => {
      const action = member.actions.get(name);
      const weight = member.blend[i] ?? 0;
      if (!action || weight < 1e-3) return;
      action.setEffectiveWeight(weight);
      const duration = action.getClip().duration;
      action.time =
        i === 0
          ? (this.now * 0.8 + member.seed) % duration
          : member.gait * duration;
    });
    member.mixer.update(0);
    this.hug(member);
    member.rig.capture();
  }

  private plant(member: Member, draft: Draft): void {
    const { spot } = member;
    const c = Math.cos(spot.yaw);
    const s = Math.sin(spot.yaw);
    draft.feet.forEach((wanted, i) => {
      const [f, l] = wanted.ball;
      const x = spot.x + f * c - l * s;
      const y = spot.y + f * s + l * c;
      const yaw = spot.yaw + wanted.yaw;
      const foot = member.feet[i];
      const other = member.feet[1 - i];
      if (!foot || !other) return;
      if (!member.feetReady) {
        Object.assign(foot, {
          x,
          y,
          yaw,
          toX: x,
          toY: y,
          toYaw: yaw,
          stepping: false,
        });
        return;
      }
      if (foot.stepping) {
        foot.toX = x;
        foot.toY = y;
        foot.toYaw = yaw;
      } else if (
        !other.stepping &&
        (Math.hypot(x - foot.x, y - foot.y) > stepDistance ||
          Math.abs(angleTo(foot.yaw, yaw)) > stepTurn)
      ) {
        Object.assign(foot, {
          fromX: foot.x,
          fromY: foot.y,
          fromYaw: foot.yaw,
          toX: x,
          toY: y,
          toYaw: yaw,
          since: this.now,
          stepping: true,
        });
      }
      let raise = 0;
      if (foot.stepping) {
        const k = clamp01((this.now - foot.since) / stepTime);
        const e = smooth(k);
        foot.x = mix(foot.fromX, foot.toX, e);
        foot.y = mix(foot.fromY, foot.toY, e);
        foot.yaw = foot.fromYaw + angleTo(foot.fromYaw, foot.toYaw) * e;
        raise = stepLift * Math.sin(Math.PI * k);
        if (k >= 1) foot.stepping = false;
      }
      const dx = foot.x - spot.x;
      const dy = foot.y - spot.y;
      wanted.ball = [dx * c + dy * s, -dx * s + dy * c];
      wanted.yaw = angleTo(spot.yaw, foot.yaw);
      wanted.heel += raise * 2.5;
      (wanted as FootDraft & { raise?: number }).raise = raise;
    });
    member.feetReady = true;
  }

  private sight(member: Member, draft: Draft): V3 | null {
    if (!draft.look) return null;
    const [f, l, u] = this.local(member, draft.look);
    const eye = draft.hips[2] + eyeRise;
    const far = Math.hypot(f, l, u - eye);
    const k = Math.min(1, lookRange / Math.max(1e-3, far));
    const yaw = Math.atan2(l, f);
    const over = Math.max(0, Math.abs(yaw) - headFree);
    draft.twist += Math.sign(yaw) * Math.min(headTurn, over * headShare);
    return [f * k, l * k, eye + (u - eye) * k];
  }

  private settle(member: Member, draft: Draft): V3 | null {
    const { motion } = member;
    const fresh = !member.settled;
    const dt = this.delta;
    const look = this.sight(member, draft);
    const ease = (follow: Follow, x: number) =>
      fresh ? follow.reset(x) : follow.step(x, dt);
    const ease3 = (follow: Follow3, x: V3) =>
      fresh ? follow.reset(x) : follow.step(x, dt);
    draft.hips = ease3(motion.hips, draft.hips);
    draft.lean = ease(motion.lean, draft.lean);
    draft.twist = ease(motion.twist, draft.twist);
    draft.side = ease(motion.side, draft.side);
    draft.hands.forEach((wanted, i) => {
      const follow = motion.hands[i];
      if (!follow) return;
      wanted.at = mixV(
        ease3(follow, wanted.at),
        wanted.at,
        smooth(wanted.hold ?? 0),
      );
    });
    member.settled = true;
    return look ? ease3(motion.look, look) : null;
  }

  private toGoal(member: Member, draft: Draft): void {
    const look = this.settle(member, draft);
    const { goal } = member;
    const [hf, hl, hu] = draft.hips;
    goal.hips.set(hl, hu * member.rig.stature, hf);
    goal.lean = draft.lean;
    goal.twist = draft.twist;
    goal.side = draft.side;
    draft.hands.forEach((wanted, i) => {
      const out = goal.hands[i];
      if (out) handOut(wanted, out, i);
    });
    draft.feet.forEach((wanted, i) => {
      const out = goal.feet[i];
      if (!out) return;
      const raise = (wanted as FootDraft & { raise?: number }).raise ?? 0;
      out.ball.set(wanted.ball[1], ballHeight + raise, wanted.ball[0]);
      out.heel = wanted.heel;
      out.yaw = wanted.yaw;
      out.pole.set(wanted.pole[1], wanted.pole[2], wanted.pole[0]).normalize();
    });
    goal.look = look
      ? (goal.look ?? new THREE.Vector3()).set(look[1], look[2], look[0])
      : null;
    member.rig.keepReach(
      goal,
      [draft.hands[0].hold ?? 0, draft.hands[1].hold ?? 0],
      span(member.dwell, 0, settleTime),
    );
  }

  private local(member: Member, p: V3): V3 {
    const { spot } = member;
    const dx = p[0] - spot.x;
    const dy = p[1] - spot.y;
    const c = Math.cos(spot.yaw);
    const s = Math.sin(spot.yaw);
    return [dx * c + dy * s, -dx * s + dy * c, p[2]];
  }

  private localDir(member: Member, d: V3): V3 {
    const c = Math.cos(member.spot.yaw);
    const s = Math.sin(member.spot.yaw);
    return [d[0] * c + d[1] * s, -d[0] * s + d[1] * c, d[2]];
  }

  private seen(x: number, y: number, z: number): V3 {
    const pose =
      this.stopAt === null && Number.isFinite(this.live.x)
        ? this.live
        : this.car;
    const c = Math.cos(pose.yaw);
    const s = Math.sin(pose.yaw);
    return [pose.x + x * c - y * s, pose.y + x * s + y * c, z];
  }

  private hub(corner: number): V3 {
    return this.seen(axles[corner] ?? 0, tracks[corner] ?? 0, 0.38);
  }

  private draft(member: Member): Draft {
    const draft = standing(member.build, this.now, member.seed);
    const { time, plan } = this.state;
    const here = span(member.dwell, 0, settleTime);
    this.act(member, draft, time, plan);
    calmed(draft, standing(member.build, this.now, member.seed), here);
    member.lift = Math.max(member.lift, 1 - here);
    this.cradle(member, draft);
    this.breathe(member, draft, time, plan);
    draft.look = this.watch(member, draft.look, plan, time);
    return draft;
  }

  private act(
    member: Member,
    draft: Draft,
    time: number,
    plan: StopPlan | null,
  ): void {
    switch (member.role) {
      case "gunner":
        this.gunner(member, draft, time, plan);
        break;
      case "tyreOff":
        this.tyreOff(member, draft, time, plan);
        break;
      case "tyreOn":
        this.tyreOn(member, draft, time, plan);
        break;
      case "frontJack":
        this.frontJack(member, draft, time, plan);
        break;
      case "rearJack":
        this.rearJack(member, draft, time, plan);
        break;
      case "stabiliser":
        this.stabiliser(member, draft, time, plan);
        break;
      case "wing":
        this.wing(member, draft, time, plan);
        break;
      case "spare":
        this.spare(member, draft, time, plan);
        break;
      case "chief":
        this.chief(member, draft, time, plan);
        break;
    }
  }

  private breathe(
    member: Member,
    draft: Draft,
    time: number,
    plan: StopPlan | null,
  ): void {
    const spent = plan
      ? span(time, plan.release - 0.2, plan.release + 0.6) *
        (1 - span(time, plan.duration + 3, plan.duration + 9))
      : 0;
    const calm = Math.sin(this.now * 1.6 * member.build.tempo + member.seed);
    const hard = Math.sin(this.now * 2.9 * member.build.tempo + member.seed);
    const wave = mix(calm, hard, spent);
    draft.lean += mix(0.012, 0.032, spent) * wave;
    draft.hips[2] += mix(0.003, 0.009, spent) * wave;
  }

  private watch(
    member: Member,
    look: V3 | null,
    plan: StopPlan | null,
    time: number,
  ): V3 {
    const gone =
      !!plan &&
      this.state.release &&
      time > plan.duration + 0.15 + member.leaveAt * 0.4;
    const [x, y, z] = gone
      ? [this.live.x, this.live.y, 0.75]
      : (look ?? this.seen(1, 0, 0.5));
    return [
      x + 0.05 * wander(this.now, member.seed, 0.7),
      y + 0.05 * wander(this.now, member.seed + 5, 0.6),
      z,
    ];
  }

  private standUp(plan: StopPlan | null, time: number, member: Member): number {
    if (!plan) return 0;
    const after = plan.duration + 0.35 + member.leaveAt * 1.1;
    return span(time, after, after + 0.9);
  }

  private kneel(draft: Draft, depth: number): void {
    const [lead, rear] = draft.feet;
    strike(draft, kneelStance, depth);
    draft.feet = [
      blendFoot(lead, kneelStance.feet[0], smooth(depth * 1.6)),
      blendFoot(rear, kneelStance.feet[1], smooth(depth * 1.6 - 0.6)),
    ];
  }

  private take(
    free: HandDraft,
    grip: HandDraft,
    on: number,
    side: number,
  ): HandDraft {
    if (on <= 0) return free;
    return { ...blendHand(free, grip, on, side), hold: on };
  }

  private gunner(
    member: Member,
    draft: Draft,
    time: number,
    plan: StopPlan | null,
  ): void {
    const c = member.corner;
    const work = plan?.service ? plan.corners[c] : undefined;
    const up = this.standUp(plan, time, member);
    const down = 1 - up;
    const [calm] = draft.hands;
    this.kneel(draft, down);
    const gun = this.props.gun(c);
    const reach = clamp01(
      (this.local(member, gun.tip)[0] - gunBack) / gunTravel,
    );
    draft.hips[0] += mix(-0.07, 0.07, reach) * down;
    draft.hips[2] += mix(0.035, -0.02, reach) * down;
    draft.lean += (mix(0, 0.3, reach) + member.build.hunch) * down;
    draft.twist -= 0.12 * down;
    const axis = this.localDir(member, gun.axis);
    const trigger: HandDraft = {
      at: this.local(member, gun.grip),
      pole: [-0.2, -1, -0.6],
      fingers: [axis[0] * 0.3, -0.9, -0.3],
      palm: [0.2, 0.2, 0.9],
      grip: 0.9,
    };
    const support: HandDraft = {
      at: this.local(member, gun.front),
      pole: [-0.2, 1, -0.7],
      fingers: [axis[0], 0.2, -0.4],
      palm: [0, -0.3, -0.95],
      grip: 0.7,
      hold: 1,
    };
    member.lift = smooth(up);
    draft.hands[1] = this.take(gunCarry, trigger, 1 - smooth(up), 1);
    draft.hands[0] = blendHand(
      this.signal(support, work, plan, time),
      calm,
      up,
      0,
    );
    draft.look =
      work && time >= work.nutOff && time < work.tyreOn - 0.05
        ? this.props.tyreCentre(c, "new")
        : this.hub(c);
  }

  private signal(
    support: HandDraft,
    work: CornerPlan | undefined,
    plan: StopPlan | null,
    time: number,
  ): HandDraft {
    if (!work || !plan || time <= work.done) return support;
    const raise = span(time, work.done, work.done + 0.24);
    const lower = span(time, plan.release + 0.15, plan.release + 0.6);
    const raised: HandDraft = {
      at: [0.1, 0.3, 1.38],
      pole: [-0.3, 1, -0.3],
      fingers: [0.1, 0.1, 1],
      palm: [1, 0, 0],
      grip: 0.05,
    };
    return blendHand(
      blendHand(support, raised, raise, 0),
      kneeHands[0],
      lower,
      0,
    );
  }

  private tyreHands(
    member: Member,
    which: "old" | "new",
    angle: number,
  ): [HandDraft, HandDraft] {
    const hold = this.props.tyreGrips(member.corner, which, angle);
    const grip = (from: Grip, side: number): HandDraft => ({
      at: this.local(member, from.at),
      pole: [-0.35, side, -0.45],
      fingers: this.localDir(member, from.fingers),
      palm: this.localDir(member, from.palm),
      grip: 0.7,
    });
    return member.plusLeft
      ? [grip(hold.plus, 1), grip(hold.minus, -1)]
      : [grip(hold.minus, 1), grip(hold.plus, -1)];
  }

  private idleHands(
    draft: Draft,
    low: [HandDraft, HandDraft],
    up: number,
  ): void {
    draft.hands = [
      blendHand(low[0], draft.hands[0], up, 0),
      blendHand(low[1], draft.hands[1], up, 1),
    ];
  }

  private offStance(
    work: CornerPlan | undefined,
    plan: StopPlan | null,
    time: number,
  ): Stance {
    if (!work)
      return plan?.service !== false && this.closing()
        ? blendStance(offLean, offStances.reach, this.nearing())
        : offStances.wait;
    const pulled = span(time, work.nutOff, work.tyreOff + 0.06);
    const rest = span(time, work.tyreOff + 0.45, work.tyreOff + 0.9);
    return blendStance(
      blendStance(offStances.reach, offStances.pulled, pulled),
      offStances.rest,
      rest,
    );
  }

  private offPhases(
    work: CornerPlan | undefined,
    plan: StopPlan | null,
    time: number,
  ): { grab: number; rest: number; lift: number } {
    if (!work || !plan) return { grab: 0, rest: 0, lift: 0 };
    return {
      grab: span(time, work.gunOn - 0.12, work.gunOn + 0.04),
      rest: span(time, work.tyreOff + 0.45, work.tyreOff + 0.8),
      lift: span(time, plan.duration + 0.02, plan.duration + 0.2),
    };
  }

  private offHands(
    member: Member,
    draft: Draft,
    hover: boolean,
    phases: { grab: number; rest: number; lift: number },
  ): void {
    const spare = member.mirror > 0 ? 1 : 0;
    const grips = this.tyreHands(member, "old", offGrip);
    const freed = phases.rest * (1 - phases.lift);
    const close = this.nearing();
    draft.hands = draft.hands.map((free, i) => {
      const grip = grips[i] ?? free;
      const open: HandDraft = {
        ...grip,
        at: [
          grip.at[0] - mix(hoverBack, 0.1, close),
          grip.at[1],
          grip.at[2] + mix(hoverRise, 0.04, close),
        ],
        grip: 0.15,
      };
      const on = phases.grab * (i === spare ? 1 - freed : 1);
      return this.take(hover ? open : free, grip, on, i);
    }) as [HandDraft, HandDraft];
  }

  private tyreOff(
    member: Member,
    draft: Draft,
    time: number,
    plan: StopPlan | null,
  ): void {
    const c = member.corner;
    const work = plan?.service ? plan.corners[c] : undefined;
    const up = this.standUp(plan, time, member);
    const phases = this.offPhases(work, plan, time);
    strike(draft, this.offStance(work, plan, time), 1 - up);
    draft.lean += member.build.hunch * (1 - up);
    this.idleHands(draft, phases.rest > 0.5 ? kneeHands : guardHands, up);
    if (member.mirror < 0) flip(draft);
    this.offHands(member, draft, !!work || this.reaching(plan, up), phases);
    if (this.carrying(member)) member.lift = smooth(up);
    draft.look = this.offLook(c, work, time, phases.rest);
  }

  private reaching(plan: StopPlan | null, up: number): boolean {
    return plan?.service !== false && this.closing() && up <= 0;
  }

  private offLook(
    c: number,
    work: CornerPlan | undefined,
    time: number,
    rest: number,
  ): V3 {
    const carrying = !!work && time >= work.nutOff && rest < 0.5;
    return carrying ? this.props.tyreCentre(c, "old") : this.hub(c);
  }

  private tyreOn(
    member: Member,
    draft: Draft,
    time: number,
    plan: StopPlan | null,
  ): void {
    const c = member.corner;
    const work = plan?.service ? plan.corners[c] : undefined;
    const lunge = work
      ? span(time, work.tyreOff - 0.14, work.tyreOn - 0.02)
      : 0;
    const clear = work ? span(time, work.tyreOn + 0.16, work.tyreOn + 0.55) : 0;
    const letGo = work ? span(time, work.tyreOn + 0.1, work.tyreOn + 0.26) : 0;
    const up = letGo < 1 ? 0 : this.standUp(plan, time, member);
    strike(
      draft,
      blendStance(
        blendStance(onStances.wait, onStances.push, lunge),
        onStances.clear,
        clear,
      ),
      1 - up,
    );
    draft.lean += member.build.hunch * (1 - up);
    this.idleHands(draft, clear > 0.7 ? kneeHands : guardHands, up);
    if (member.mirror < 0) flip(draft);
    const grips = this.tyreHands(member, "new", onGrip);
    draft.hands = draft.hands.map((free, i) =>
      this.take(free, grips[i] ?? free, 1 - letGo, i),
    ) as [HandDraft, HandDraft];
    draft.look = letGo > 0.5 ? this.props.gun(c).tip : this.hub(c);
  }

  private jackHands(
    member: Member,
    which: "front" | "rear",
  ): [HandDraft, HandDraft] {
    const handle = this.props.jackHandle(which);
    const fingers = this.localDir(member, handle.fingers);
    const palm = this.localDir(member, handle.palm);
    return [
      {
        at: this.local(member, handle.left),
        pole: [-0.4, 1, -0.5],
        fingers,
        palm,
        grip: 0.85,
        hold: 1,
      },
      {
        at: this.local(member, handle.right),
        pole: [-0.4, -1, -0.5],
        fingers,
        palm,
        grip: 0.85,
        hold: 1,
      },
    ];
  }

  private pressed(
    which: "front" | "rear",
    time: number,
    plan: StopPlan | null,
  ): number {
    const press = this.props.jackPress(which);
    if (!plan?.service) return press;
    const soon = this.lift(plan, time + jackLead)[which === "front" ? 0 : 1];
    return Math.max(press, soon / liftHeight);
  }

  private eased(
    which: "front" | "rear",
    time: number,
    plan: StopPlan | null,
  ): number {
    if (!plan?.service) return 0;
    const down = which === "front" ? plan.frontDown : plan.rearDown;
    return span(time, down + 0.6, down + 1.3);
  }

  private heave(
    member: Member,
    draft: Draft,
    which: "front" | "rear",
    time: number,
    plan: StopPlan | null,
  ): void {
    strike(
      draft,
      blendStance(
        blendStance(
          jackStances.high,
          jackStances.low,
          this.pressed(which, time, plan),
        ),
        jackStances.rest,
        this.eased(which, time, plan),
      ),
    );
    draft.lean += member.build.hunch;
    draft.hands = this.jackHands(member, which);
  }

  private frontJack(
    member: Member,
    draft: Draft,
    time: number,
    plan: StopPlan | null,
  ): void {
    this.heave(member, draft, "front", time, plan);
    draft.look = this.seen(noseTip, 0, noseLow);
    if (!plan?.service) return;
    if (time > 0.3 && time < plan.frontDown)
      draft.look = this.hub(Math.floor(time / 0.45) % 2);
    if (this.state.release && time > plan.release)
      draft.look = this.carPoint(noseTip + 6, -2, 0.4);
  }

  private spare(
    member: Member,
    draft: Draft,
    time: number,
    plan: StopPlan | null,
  ): void {
    const up = this.standUp(plan, time, member);
    strike(draft, onStances.clear, 1 - up);
    this.idleHands(draft, kneeHands, up);
    draft.look = this.seen(noseTip, 0.4, noseLow);
  }

  private chief(
    member: Member,
    draft: Draft,
    time: number,
    plan: StopPlan | null,
  ): void {
    draft.lean += 0.1;
    draft.hands = [
      hand([0.03, 0.25, 1], [-0.45, 1, 0.1], 0.5),
      hand([0.03, -0.25, 1], [-0.45, -1, 0.1], 0.5),
    ];
    const busy = !!plan?.service && time > 0.1 && time < plan.release;
    draft.look = busy
      ? this.hub(Math.floor(time / 0.42 + member.seed) % 4)
      : this.seen(0.5, 0, 0.6);
  }

  private rearJack(
    member: Member,
    draft: Draft,
    time: number,
    plan: StopPlan | null,
  ): void {
    this.heave(member, draft, "rear", time, plan);
    draft.look =
      !plan?.service || time === -Infinity
        ? this.seen(rearPoint, 0, rearLow + 0.3)
        : this.carPoint(rearPoint, 0, rearLow);
  }

  private stabiliser(
    member: Member,
    draft: Draft,
    time: number,
    plan: StopPlan | null,
  ): void {
    const hold = plan?.service
      ? span(
          time,
          plan.hold + plan.settle + 0.02,
          plan.hold + plan.settle + 0.25,
        ) *
        (1 - span(time, plan.rearDown - 0.06, plan.rearDown + 0.14))
      : 0;
    const lift = Math.max(...this.state.lift);
    const near = this.carPoint(-0.25, member.side * 0.6, sidepodTop + lift);
    const far = this.carPoint(
      -0.75,
      member.side * 0.58,
      sidepodTop - 0.02 + lift,
    );
    const nearL = this.local(member, near);
    const farL = this.local(member, far);
    const ready: [HandDraft, HandDraft] = [
      hand([0.25, 0.2, 1.05], [-0.4, 1, -0.6], 0.2),
      hand([0.25, -0.2, 1.05], [-0.4, -1, -0.6], 0.2),
    ];
    const onCar: [HandDraft, HandDraft] =
      member.side > 0
        ? [
            {
              at: nearL,
              pole: [-0.3, 1, -0.5],
              fingers: [1, 0, -0.3],
              palm: [0, 0, -1],
              grip: 0.3,
            },
            {
              at: farL,
              pole: [-0.3, -1, -0.5],
              fingers: [1, 0, -0.3],
              palm: [0, 0, -1],
              grip: 0.3,
            },
          ]
        : [
            {
              at: farL,
              pole: [-0.3, 1, -0.5],
              fingers: [1, 0, -0.3],
              palm: [0, 0, -1],
              grip: 0.3,
            },
            {
              at: nearL,
              pole: [-0.3, -1, -0.5],
              fingers: [1, 0, -0.3],
              palm: [0, 0, -1],
              grip: 0.3,
            },
          ];
    draft.hands = [0, 1].map((i) => {
      const a = ready[i] ?? ready[0];
      const b = onCar[i] ?? onCar[0];
      return blendHand(a, b, hold, i);
    }) as [HandDraft, HandDraft];
    draft.hips = [mix(-0.04, -0.1, hold), 0, mix(0.86, 0.77, hold)];
    draft.lean = mix(0.25, 0.82, hold);
    draft.feet = [
      foot([0.2, 0.2], [1, 0.35, 0.1], 0, 0.2),
      foot(
        [mix(-0.3, -0.5, hold), -0.16],
        [1, -0.2, 0],
        mix(0.15, 0.55, hold),
        -0.12,
      ),
    ];
    draft.look = this.carPoint(0.4, 0, 0.9);
  }

  private carriedWing(): WingPose | null {
    const { plan, time } = this.state;
    if (!plan?.wing) return null;
    const wing = plan.wing;
    const home = wingHome(plan.duration);
    if (time >= home.pick - homeApproach && time < home.down + homeLetGo)
      return wingPath(wing, plan.duration, time, "old");
    if (time < wing.unlock - 0.3 || time > wing.done + 0.1) return null;
    const old = wingPath(wing, plan.duration, time, "old");
    return old.held || time < wing.unlock
      ? old
      : wingPath(wing, plan.duration, time, "new");
  }

  private wingPoint(
    pose: WingPose,
    side: number,
    f: number,
    l: number,
    u: number,
  ): V3 {
    const [x, y] = this.carPoint(pose.f + f, pose.l + side * l, 0);
    return [x, y, pose.u + u];
  }

  private wingStand(member: Member, pose: WingPose): Spot {
    return this.wingSpot(member.side, pose.f, pose.l);
  }

  private wingHands(member: Member, pose: WingPose): [HandDraft, HandDraft] {
    const s = member.side;
    const top = this.local(
      member,
      this.wingPoint(pose, s, wingGrip[0], wingGrip[1], wingGrip[2]),
    );
    const low = this.local(
      member,
      this.wingPoint(pose, s, wingGrip[0] + 0.2, wingGrip[1] - 0.04, 0.1),
    );
    const inward = this.localDir(member, [
      Math.sin(this.car.yaw) * s,
      -Math.cos(this.car.yaw) * s,
      0,
    ]);
    const grip = (at: V3, pole: V3): HandDraft => ({
      at,
      pole,
      fingers: [0, 0, -1],
      palm: inward,
      grip: 0.6,
    });
    return s > 0
      ? [grip(low, [-0.2, 1, -0.6]), grip(top, [-0.2, -1, -0.6])]
      : [grip(top, [-0.2, 1, -0.6]), grip(low, [-0.2, -1, -0.6])];
  }

  private wingWork(
    member: Member,
    draft: Draft,
    carried: WingPose,
    plan: StopPlan,
    steadyHands: [HandDraft, HandDraft],
  ): void {
    const wing = plan.wing;
    if (!wing) return;
    const time = this.state.time;
    const home = wingHome(plan.duration);
    const homing = time >= home.pick - homeApproach;
    const kneeling = homing
      ? 0
      : clamp01(
          1 -
            span(time, wing.off - 0.15, wing.off + 0.1) +
            span(time, wing.fit - 0.1, wing.fit + 0.2),
        );
    const engage = homing
      ? span(time, home.pick - 0.45, home.pick) *
        (1 - span(time, home.down, home.down + homeLetGo))
      : 1;
    const low = clamp01((0.75 - carried.u) / 0.6);
    const squat: [FootDraft, FootDraft] = [
      foot([0.04, 0.3], [1, 0.7, 0.1], 0, 0.4),
      foot([-0.04, -0.3], [1, -0.7, 0.1], 0.1, -0.4),
    ];
    draft.hips = mixV(
      draft.hips,
      [mix(-0.06, -0.2, low), 0, mix(0.74, 0.6, low)],
      engage,
    );
    draft.lean = mix(draft.lean, mix(0.3, 0.85, low), engage);
    draft.feet = [
      blendFoot(draft.feet[0], squat[0], engage),
      blendFoot(draft.feet[1], squat[1], engage),
    ];
    this.kneel(draft, kneeling);
    const poses = [
      wingPath(wing, plan.duration, time, "old"),
      wingPath(wing, plan.duration, time, "new"),
    ];
    const rate = Math.min(1, this.delta * 10);
    member.grab = member.grab.map((g, k) =>
      mix(g, poses[k]?.held ? 1 : 0, rate),
    ) as [number, number];
    draft.hands = [0, 1].map((i) => {
      const side = i === 0 ? 1 : -1;
      const free = hand([0.3, side * 0.2, 0.7], [-1, side * 0.4, -0.3], 0.2);
      let held = blendHand(
        steadyHands[i] ?? free,
        free,
        span(time, wing.unlock - 0.25, wing.unlock),
        i,
      );
      poses.forEach((pose, k) => {
        const on = this.wingHands(member, pose)[i];
        if (on) held = blendHand(held, on, smooth(member.grab[k] ?? 0), i);
      });
      return held;
    }) as [HandDraft, HandDraft];
    draft.look = this.wingPoint(carried, 0, wingGrip[0], 0, 0.15);
  }

  private steadyHands(
    member: Member,
    time: number,
    plan: StopPlan | null,
  ): [HandDraft, HandDraft] {
    const lift = this.state.lift[0];
    const steady = plan?.service
      ? span(
          time,
          plan.hold + plan.settle + 0.05,
          plan.hold + plan.settle + 0.3,
        ) *
        (1 - span(time, plan.frontDown, plan.frontDown + 0.2))
      : 0;
    const turn = steady * adjustTurn;
    const phase = this.now * adjustRate + member.seed;
    const plate = this.local(
      member,
      this.carPoint(2.42, member.side * 0.95, wingTop + lift),
    );
    const flap = this.local(
      member,
      this.carPoint(
        2.34 + turn * Math.cos(phase),
        member.side * 0.76,
        wingTop + 0.03 + lift + turn * Math.sin(phase),
      ),
    );
    const rest = (p: V3, side: number): HandDraft => ({
      at: mixV([p[0] - 0.12, p[1], p[2] + 0.06], p, steady),
      pole: [-0.2, side, -0.6],
      fingers: [1, 0, -0.35],
      palm: [0, 0, -1],
      grip: 0.5,
      hold: steady,
    });
    return member.side > 0
      ? [rest(flap, 1), rest(plate, -1)]
      : [rest(plate, 1), rest(flap, -1)];
  }

  private wing(
    member: Member,
    draft: Draft,
    time: number,
    plan: StopPlan | null,
  ): void {
    const steadyHands = this.steadyHands(member, time, plan);
    const carried = this.carriedWing();
    if (carried && plan) {
      this.wingWork(member, draft, carried, plan, steadyHands);
      return;
    }
    member.grab = [0, 0];
    const up = plan
      ? span(time, plan.release - 0.5, plan.release + 0.1)
      : this.garage
        ? 1
        : 0;
    const [left, right] = draft.hands;
    this.kneel(draft, 1 - up);
    draft.lean += (0.18 + member.build.hunch) * (1 - up);
    const back = plan?.wing
      ? span(time, plan.wing.done + 0.1, plan.wing.done + 0.5)
      : 1;
    draft.hands = [
      blendHand(steadyHands[0], left, up, 0),
      blendHand(steadyHands[1], right, up, 1),
    ];
    for (const held of draft.hands) held.hold = (held.hold ?? 0) * back;
    draft.look = this.seen(2.36, member.side * 0.8, wingTop);
  }

  warm(): void {
    this.root.visible = true;
    this.props.warm();
    for (const member of this.members) {
      this.placeAt(member, this.readySpot(member));
      this.pending = true;
    }
    this.state.out = true;
    this.prepare();
  }

  get out(): boolean {
    return this.state.out;
  }

  posts(out: number[]): void {
    if (!this.state.out) return;
    for (const { spot } of this.members) {
      const { x, y } = this.v.set(spot.x, spot.y, 0).applyMatrix4(this.anchor);
      out.push(x, y, bodyRadius);
    }
    this.props.posts(out, this.anchor);
  }
}
