import * as THREE from "three/webgpu";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { type DamageLook, newLook } from "./car-damage.ts";
import type { CornerPlan, StopPlan, WingPlan } from "./pit-service.ts";
import { surface } from "./road.ts";
import { teamOf } from "./teams.ts";
import { type TyreLook, tyreLook } from "./tyre-paint.ts";
import type { TyreMount } from "./tyre-stones.ts";
import { type V3, clamp01, drive, mix, span } from "./crew-motion.ts";

export type { V3 };

export interface CarPose {
  x: number;
  y: number;
  yaw: number;
}

export interface PropState {
  plan: StopPlan | null;
  time: number;
  lift: [number, number];
  release: boolean;
  out: boolean;
}

export interface Carried {
  role: string;
  corner: number;
  hand: THREE.Object3D;
  other: THREE.Object3D;
  spot: CarPose;
  weight: number;
}

export interface GunHold {
  grip: V3;
  front: V3;
  axis: V3;
  tip: V3;
}

export interface Grip {
  at: V3;
  fingers: V3;
  palm: V3;
}

export interface TyreHold {
  plus: Grip;
  minus: Grip;
}

export interface JackHold {
  left: V3;
  right: V3;
  fingers: V3;
  palm: V3;
}

export type Jack = "front" | "rear";

export interface WingParts {
  meshes: { geometry: THREE.BufferGeometry; material: THREE.Material }[];
  frame: THREE.Object3D;
}

export interface WingPose {
  f: number;
  l: number;
  u: number;
  shown: boolean;
  held: boolean;
}

export const wingGrip: V3 = [2.45, 0.97, 0.22];
const carryOut = 1.6;
const setDown = 0.25;
const walkOver = 0.5;
const pickUp = 0.3;
const slideIn = 0.45;
const oldRest: V3 = [1.6, 2.25, -0.03];
const newRest: V3 = [0.75, 2.45, -0.03];
const garageRest: V3 = [-1.6, 7.7, -0.03];
const wingReady: V3 = [0.45, 0, 0.22];
const wingHigh: V3 = [0.75, 0, 0.78];
const wingCarry = 0.55;
const clearAfter = 3.2;
const homeWalk = 1.15;
const reachDown = 0.25;

export function wingHome(duration: number): { pick: number; down: number } {
  const pick = duration + clearAfter;
  const walk =
    Math.hypot(garageRest[0] - oldRest[0], garageRest[1] - oldRest[1]) /
    homeWalk;
  return { pick, down: pick + pickUp + walk + setDown };
}

export function wingPath(
  wing: WingPlan,
  duration: number,
  time: number,
  which: "old" | "new",
): WingPose {
  if (which === "old") {
    const k1 = span(time, wing.unlock, wing.off);
    const raise = span(time, wing.off, wing.off + carryOut * 0.4);
    const away = span(time, wing.off + carryOut * 0.3, wing.off + carryOut);
    const k3 = span(time, wing.off + carryOut, wing.off + carryOut + setDown);
    const home = wingHome(duration);
    const lift = span(time, home.pick, home.pick + pickUp);
    const walk = span(time, home.pick + pickUp, home.down - setDown);
    const drop = span(time, home.down - setDown, home.down);
    const rest = mix(
      mix(mix(wingReady[2] * k1, wingHigh[2], raise), wingCarry, away),
      oldRest[2],
      k3,
    );
    return {
      f: mix(
        mix(mix(wingReady[0] * k1, wingHigh[0], raise), oldRest[0], away),
        garageRest[0],
        walk,
      ),
      l: mix(oldRest[1] * away, garageRest[1], walk),
      u: mix(mix(rest, wingCarry, lift), garageRest[2], drop),
      shown: time >= wing.unlock,
      held:
        (time >= wing.unlock && time < wing.off + carryOut + setDown) ||
        (time >= home.pick - reachDown && time < home.down),
    };
  }
  const pick = wing.off + carryOut + setDown + walkOver;
  const k4 = span(time, pick, pick + pickUp);
  const toward = span(time, pick + pickUp, wing.fit - 0.5);
  const lower = span(time, wing.fit - 0.6, wing.fit);
  const k6 = span(time, wing.fit, wing.fit + slideIn);
  const carried = mix(newRest[2], wingCarry, k4);
  return {
    f: mix(
      mix(mix(newRest[0], wingHigh[0], toward), wingReady[0], lower),
      0,
      k6,
    ),
    l: mix(newRest[1], 0, toward),
    u: mix(mix(mix(carried, wingHigh[2], toward), wingReady[2], lower), 0, k6),
    shown: time < duration + shownAfterStop,
    held: time >= pick && time < wing.done + 0.1,
  };
}

export function wheelsOffAt(plan: StopPlan | null, time: number): boolean[] {
  return [0, 1, 2, 3].map((c) => {
    const work = plan?.service ? plan.corners[c] : undefined;
    return (
      !!work &&
      !!plan &&
      time >= work.nutOff &&
      time < plan.duration + shownAfterStop
    );
  });
}

export function wingOff(plan: StopPlan | null, time: number): boolean {
  if (!plan?.wing) return false;
  return time >= plan.wing.unlock && time < plan.duration + shownAfterStop;
}

export const carShape = {
  groundBelowCar: 0.058,
  hubHeight: 0.36,
  axles: [1.44, 1.44, -1.96, -1.96],
  tracks: [-0.78, 0.78, -0.75, 0.75],
  halfWidths: [0.15, 0.15, 0.19, 0.19],
  noseTip: 2.66,
  rearPoint: -2.74,
  liftHeight: 0.085,
};

export const jackReach: Record<Jack, number> = { front: 1.5, rear: 1.62 };

const pivotAhead = 0.24;
const wheelRadius = 0.06;
const cradleRest: Record<Jack, number> = { front: 0.1, rear: 0.235 };
const handleHeights: Record<Jack, number> = { front: 0.84, rear: 0.92 };
const handleBack = 0.55;
const barHalf = 0.17;
const gunLength = 0.42;
const nutGap = 0.015;
const gunReady = 0.22;
const gunClear = 0.34;
const yankOut = 0.27;
const yankTime = 0.15;
const dropped = { out: 0.68, along: -0.62, turn: 0.35 };
const swingLead = 0.06;
const swingAfter = 0.16;
const landBounce = 0.022;
const freshLateral = 0.72;
const freshAlong = 0.47;
const freshNear = 0.24;
const freshTurn = 0.3;
const heldDrop = 0.03;
const seatLift = 0.012;
const heldBob = 0.004;
const treadHold = 0.985;
const shoulderInset = 0.06;
const shownAfterStop = 0.35;
const rattle = 0.0008;
const rattleRate = 17;
const hoseSegments = 14;
const hoseRadius = 0.019;
const boomAhead = 3.2;
const boomLateral = 0.125;
const boomHeight = 4.25;
const hoseSpan = 2.4;
const hoseFloor = 0.03;
const hoseClear = 1.95;
const cradle = { ahead: 0.087, rise: 0.036 };
const tyrePost = 0.3;
const lampAhead = 3.2;
const lampHeight = 2.5;
const red = new THREE.Color(5, 0.15, 0.08);
const green = new THREE.Color(0.2, 5, 0.6);
const unlit = new THREE.Color(0.02, 0.02, 0.02);

const up = new THREE.Vector3(0, 0, 1);
const noGrip: Grip = { at: [0, 0, 0], fingers: [1, 0, 0], palm: [0, 0, -1] };
const yAxis = new THREE.Vector3(0, 1, 0);
const v3 = (v: THREE.Vector3): V3 => [v.x, v.y, v.z];

function material(
  name: string,
  colour: THREE.ColorRepresentation,
  roughness: number,
  metalness = 0,
): THREE.MeshStandardNodeMaterial {
  return surface(
    new THREE.MeshStandardMaterial({
      name,
      color: colour,
      roughness,
      metalness,
    }),
    1,
  );
}

function painted(
  geometry: THREE.BufferGeometry,
  colour: THREE.ColorRepresentation,
): THREE.BufferGeometry {
  const plain = geometry.index ? geometry.toNonIndexed() : geometry;
  const count = plain.getAttribute("position").count;
  const c = new THREE.Color(colour);
  const colours = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) colours.set([c.r, c.g, c.b], i * 3);
  plain.setAttribute("color", new THREE.BufferAttribute(colours, 3));
  plain.deleteAttribute("uv");
  return plain;
}

function rod(
  from: THREE.Vector3,
  to: THREE.Vector3,
  radius: number,
  sides = 10,
): THREE.BufferGeometry {
  const length = from.distanceTo(to);
  const geometry = new THREE.CylinderGeometry(radius, radius, length, sides);
  const turn = new THREE.Quaternion().setFromUnitVectors(
    yAxis,
    to.clone().sub(from).normalize(),
  );
  return geometry.applyMatrix4(
    new THREE.Matrix4().compose(
      from.clone().add(to).multiplyScalar(0.5),
      turn,
      new THREE.Vector3(1, 1, 1),
    ),
  );
}

function block(
  centre: THREE.Vector3,
  size: THREE.Vector3,
  yaw = 0,
  pitch = 0,
  roll = 0,
): THREE.BufferGeometry {
  return new THREE.BoxGeometry(size.x, size.y, size.z).applyMatrix4(
    new THREE.Matrix4().compose(
      centre,
      new THREE.Quaternion().setFromEuler(
        new THREE.Euler(roll, pitch, yaw, "ZYX"),
      ),
      new THREE.Vector3(1, 1, 1),
    ),
  );
}

function merged(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const plain = parts.map((part) => {
    const flat = part.index ? part.toNonIndexed() : part;
    flat.deleteAttribute("uv");
    return flat;
  });
  const geometry = mergeGeometries(plain);
  if (!(geometry as THREE.BufferGeometry | null))
    throw new Error("pit prop parts cannot be merged");
  return geometry;
}

function gunGeometry(team: THREE.Color): THREE.BufferGeometry {
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const body = 0x1d1f24;
  const metal = 0xa4a9b1;
  return merged([
    painted(rod(v(-0.06, 0, 0), v(0, 0, 0), 0.036, 12), metal),
    painted(rod(v(-0.34, 0, 0), v(-0.06, 0, 0), 0.05, 14), body),
    painted(rod(v(-0.27, 0, 0), v(-0.22, 0, 0), 0.053, 14), team),
    painted(rod(v(-0.42, 0, 0), v(-0.34, 0, 0), 0.024, 10), metal),
    painted(block(v(-0.31, 0, -0.11), v(0.045, 0.04, 0.15), 0, 0.25), body),
    painted(rod(v(-0.2, 0, 0.04), v(-0.2, 0, 0.09), 0.011, 6), metal),
    painted(rod(v(-0.09, 0, 0.04), v(-0.09, 0, 0.09), 0.011, 6), metal),
    painted(rod(v(-0.21, 0, 0.09), v(-0.08, 0, 0.09), 0.016, 8), body),
  ]);
}

function jackParts(which: Jack) {
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const reach = jackReach[which];
  const handleX = reach - handleBack - pivotAhead;
  const handleHeight = handleHeights[which];
  const head = cradleRest[which] - wheelRadius;
  const post = handleX - 0.1;
  const frame =
    which === "front"
      ? [
          rod(v(0, 0, 0.02), v(post, 0, 0.15), 0.03, 12),
          rod(
            v(post, 0, 0.15),
            v(handleX - 0.02, 0, handleHeight + 0.04),
            0.026,
            12,
          ),
          rod(v(post - 0.35, 0, 0.12), v(post, 0, 0.4), 0.016, 8),
        ]
      : [
          rod(v(0, 0, 0.02), v(handleX, 0, handleHeight), 0.027, 12),
          rod(
            v(handleX * 0.35, 0, handleHeight * 0.35 + 0.02),
            v(0.05, 0, 0.12),
            0.016,
            8,
          ),
        ];
  const board = handleHeight - 0.27;
  const chevrons = [0, 1, 2].flatMap((k) => {
    const z = board + 0.12 - k * 0.12;
    return [1, -1].map((side) =>
      block(
        v(post - 0.03, side * 0.065, z + 0.02),
        v(0.012, 0.16, 0.04),
        0,
        0,
        side * 0.55,
      ),
    );
  });
  const lever = [
    ...frame,
    block(v(-pivotAhead / 2, 0, 0), v(pivotAhead + 0.04, 0.07, 0.045)),
    block(v(-pivotAhead, 0, head / 2), v(0.06, 0.06, Math.max(0.03, head))),
    block(v(-pivotAhead + 0.09, 0.075, head), v(0.2, 0.045, 0.035), 0.7),
    block(v(-pivotAhead + 0.09, -0.075, head), v(0.2, 0.045, 0.035), -0.7),
    rod(
      v(handleX, -0.24, handleHeight),
      v(handleX, 0.24, handleHeight),
      0.02,
      10,
    ),
  ];
  const grips = [
    rod(
      v(handleX, barHalf - 0.07, handleHeight),
      v(handleX, barHalf + 0.07, handleHeight),
      0.025,
      10,
    ),
    rod(
      v(handleX, -barHalf - 0.07, handleHeight),
      v(handleX, -barHalf + 0.07, handleHeight),
      0.025,
      10,
    ),
    block(v(-pivotAhead, 0, head + 0.02), v(0.1, 0.12, 0.012)),
    ...(which === "front"
      ? [block(v(post - 0.015, 0, board), v(0.02, 0.36, 0.44))]
      : []),
  ];
  const base = [
    rod(v(0, -0.2, 0), v(0, 0.2, 0), 0.016, 8),
    rod(v(0, -0.24, 0), v(0, -0.19, 0), wheelRadius, 16),
    rod(v(0, 0.19, 0), v(0, 0.24, 0), wheelRadius, 16),
  ];
  return {
    lever: merged(lever),
    grips: merged(grips),
    base: merged(base),
    marker: which === "front" ? merged(chevrons) : null,
  };
}

function leverTurn(which: Jack): number {
  const head = cradleRest[which] - wheelRadius;
  const want = head + carShape.liftHeight;
  let angle = 0.2;
  for (let i = 0; i < 8; i++) {
    const f = pivotAhead * Math.sin(angle) + head * Math.cos(angle) - want;
    const df = pivotAhead * Math.cos(angle) - head * Math.sin(angle);
    angle -= f / df;
  }
  return angle;
}

interface JackRig {
  root: THREE.Group;
  lever: THREE.Group;
  turn: number;
  handleX: number;
  press: number;
  origin: THREE.Vector3;
  back: THREE.Vector3;
}

interface Pose {
  p: THREE.Vector3;
  q: THREE.Quaternion;
  s: THREE.Vector3;
}

const pose = (): Pose => ({
  p: new THREE.Vector3(),
  q: new THREE.Quaternion(),
  s: new THREE.Vector3(1, 1, 1),
});

interface WingRig {
  old: THREE.Group;
  fresh: THREE.Group;
  oldLook: DamageLook;
  rest: THREE.Matrix4;
  offBase: THREE.Matrix4 | null;
}

interface CornerRig {
  old: THREE.Group;
  fresh: THREE.Group;
  oldLook: TyreLook;
  carLook: TyreLook;
  restTurn: THREE.Quaternion;
  restScale: THREE.Vector3;
  radius: number;
  oldAt: Pose;
  freshAt: Pose;
  offBase: Pose | null;
  tip: THREE.Vector3;
  axis: THREE.Vector3;
  engaged: number;
}

function retried(work: CornerPlan, time: number): number {
  let back = 0;
  for (const retry of work.retries)
    back = Math.max(
      back,
      span(time, retry - 0.14, retry) * (1 - span(time, retry, retry + 0.16)),
    );
  return back;
}

function gunTip(
  work: CornerPlan,
  time: number,
  ready: THREE.Vector3,
  nut: THREE.Vector3,
  clear: THREE.Vector3,
  tip: THREE.Vector3,
): boolean {
  if (time < work.nutOff) {
    tip.copy(ready).lerp(nut, span(time, work.gunOn - 0.12, work.gunOn));
    return time >= work.gunOn;
  }
  if (time < work.tyreOn - 0.08) {
    tip.copy(nut).lerp(clear, span(time, work.nutOff, work.nutOff + 0.08));
    return false;
  }
  if (time < work.nutOn) {
    const back = retried(work, time);
    tip
      .copy(clear)
      .lerp(nut, span(time, work.tyreOn - 0.08, work.tyreOn))
      .lerp(clear, back * 0.4);
    return time >= work.tyreOn && back < 0.2;
  }
  clear.z -= 0.14 * span(time, work.nutOn + 0.1, work.nutOn + 0.4);
  tip.copy(nut).lerp(clear, span(time, work.nutOn, work.nutOn + 0.12));
  return false;
}

function copyLook(into: TyreLook, from: TyreLook): void {
  into.compound.copy(from.compound);
  into.tread = from.tread;
  into.wear = from.wear;
  into.flat = from.flat;
  into.flatTurn = from.flatTurn;
  into.shred = from.shred;
  into.dirt = from.dirt;
  into.gravel = from.gravel;
  into.down.copy(from.down);
  into.sag = 0;
  into.blur = 0;
}

function holdable(source: THREE.Object3D, look: TyreLook): THREE.Group {
  const holder = new THREE.Group();
  holder.matrixAutoUpdate = false;
  const copy = source.clone(true);
  copy.position.set(0, 0, 0);
  copy.quaternion.identity();
  copy.scale.set(1, 1, 1);
  const from: THREE.Object3D[] = [];
  const to: THREE.Object3D[] = [];
  source.traverse((part) => from.push(part));
  copy.traverse((part) => to.push(part));
  to.forEach((part, i) => {
    const original = from[i];
    if (!original) return;
    const tyre = (original.userData as { tyre?: TyreLook }).tyre;
    part.userData = tyre
      ? { ...original.userData, tyre: look }
      : { ...original.userData };
    part.visible = true;
    if (part instanceof THREE.Mesh) {
      part.castShadow = true;
      part.frustumCulled = false;
    }
  });
  holder.add(copy);
  holder.visible = false;
  return holder;
}

function topAncestor(object: THREE.Object3D): THREE.Object3D {
  let top = object;
  while (top.parent && !(top.parent as THREE.Scene).isScene) top = top.parent;
  return top;
}

export class PitProps {
  readonly root = new THREE.Group();
  private readonly corners: CornerRig[] = [];
  private wing: WingRig | null = null;
  private readonly guns: THREE.InstancedMesh;
  private readonly hoses: THREE.InstancedMesh;
  private readonly jacks: Record<Jack, JackRig>;
  private readonly lamps: [
    THREE.MeshStandardNodeMaterial,
    THREE.MeshStandardNodeMaterial,
  ];
  private readonly view: CarPose = { x: 0, y: 0, yaw: 0 };
  private car: CarPose = { x: 0, y: 0, yaw: 0 };
  private state: PropState = {
    plan: null,
    time: -Infinity,
    lift: [0, 0],
    release: false,
    out: false,
  };
  private now = 0;
  private lastPose = 0;
  private readonly m = new THREE.Matrix4();
  private readonly m2 = new THREE.Matrix4();
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly c = new THREE.Vector3();
  private readonly d = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly q2 = new THREE.Quaternion();
  private readonly s1 = new THREE.Vector3(1, 1, 1);
  private readonly mid = new THREE.Vector3();
  private readonly actual: Pose[] = [pose(), pose(), pose(), pose()];
  private readonly nominal: Pose[] = [pose(), pose(), pose(), pose()];

  constructor(team: string) {
    this.root.matrixAutoUpdate = false;
    const brand = new THREE.Color(teamOf(team).brand);
    const gunMaterial = material("pit gun", 0xffffff, 0.42, 0.45);
    gunMaterial.vertexColors = true;
    this.guns = new THREE.InstancedMesh(gunGeometry(brand), gunMaterial, 4);
    this.guns.castShadow = true;
    this.guns.frustumCulled = false;
    this.hoses = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(hoseRadius, hoseRadius, 1, 8, 1, true),
      material("pit hose", 0x101114, 0.72),
      4 * hoseSegments,
    );
    this.hoses.castShadow = true;
    this.hoses.frustumCulled = false;
    this.root.add(this.guns, this.hoses);
    const teamMaterial = material("pit jack", brand, 0.38, 0.2);
    const gripMaterial = material("pit jack grip", 0x18191d, 0.8);
    const steelMaterial = material("pit jack base", 0x2a2c31, 0.5, 0.4);
    const markerMaterial = material("pit jack marker", 0xf0b90b, 0.5);
    this.jacks = {
      front: this.jack(
        "front",
        teamMaterial,
        gripMaterial,
        steelMaterial,
        markerMaterial,
      ),
      rear: this.jack(
        "rear",
        teamMaterial,
        gripMaterial,
        steelMaterial,
        markerMaterial,
      ),
    };
    this.lamps = this.lamp(steelMaterial);
  }

  private jack(
    which: Jack,
    team: THREE.Material,
    grips: THREE.Material,
    steel: THREE.Material,
    marker: THREE.Material,
  ): JackRig {
    const parts = jackParts(which);
    const root = new THREE.Group();
    root.matrixAutoUpdate = false;
    const lever = new THREE.Group();
    lever.position.set(pivotAhead, 0, wheelRadius);
    const shown = [
      new THREE.Mesh(parts.lever, team),
      new THREE.Mesh(parts.grips, grips),
      ...(parts.marker ? [new THREE.Mesh(parts.marker, marker)] : []),
    ];
    lever.add(...shown);
    const base = new THREE.Mesh(parts.base, steel);
    base.position.set(pivotAhead, 0, wheelRadius);
    root.add(lever, base);
    for (const mesh of [...shown, base]) {
      mesh.castShadow = true;
      mesh.frustumCulled = false;
    }
    this.root.add(root);
    return {
      root,
      lever,
      turn: leverTurn(which),
      handleX: jackReach[which] - handleBack - pivotAhead,
      press: 0,
      origin: new THREE.Vector3(),
      back: new THREE.Vector3(1, 0, 0),
    };
  }

  private lamp(
    housing: THREE.Material,
  ): [THREE.MeshStandardNodeMaterial, THREE.MeshStandardNodeMaterial] {
    const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    const frame = new THREE.Mesh(
      merged([
        rod(
          v(lampAhead, boomLateral, boomHeight),
          v(lampAhead, boomLateral, lampHeight + 0.24),
          0.02,
          8,
        ),
        block(v(lampAhead, boomLateral, lampHeight), v(0.12, 0.24, 0.5)),
      ]),
      housing,
    );
    const lens = (z: number) => {
      const glow = new THREE.MeshStandardNodeMaterial({
        color: 0x050505,
        roughness: 0.25,
        emissive: unlit,
      });
      const mesh = new THREE.Mesh(
        rod(
          v(lampAhead - 0.075, boomLateral, z),
          v(lampAhead - 0.055, boomLateral, z),
          0.07,
          20,
        ),
        glow,
      );
      this.root.add(mesh);
      return glow;
    };
    frame.castShadow = true;
    this.root.add(frame);
    return [lens(lampHeight + 0.12), lens(lampHeight - 0.12)];
  }

  fitTyres(mounts: TyreMount[], looks: TyreLook[], fresh: TyreLook): void {
    for (const corner of this.corners) {
      this.root.remove(corner.old, corner.fresh);
    }
    this.corners.length = 0;
    mounts.forEach((mount, i) => {
      const carLook = looks[i] ?? tyreLook();
      const oldLook = tyreLook();
      copyLook(oldLook, carLook);
      const top = topAncestor(mount.spin);
      top.updateMatrixWorld(true);
      this.m
        .copy(top.matrixWorld)
        .invert()
        .multiply(mount.spin.matrixWorld)
        .decompose(this.a, this.q, this.b);
      const rig: CornerRig = {
        old: holdable(mount.spin, oldLook),
        fresh: holdable(mount.spin, fresh),
        oldLook,
        carLook,
        restTurn: this.q.clone(),
        restScale: this.b.clone(),
        radius: mount.radius > 0.2 ? mount.radius : 0.36,
        oldAt: pose(),
        freshAt: pose(),
        offBase: null,
        tip: new THREE.Vector3(),
        axis: new THREE.Vector3(1, 0, 0),
        engaged: 0,
      };
      this.root.add(rig.old, rig.fresh);
      this.corners.push(rig);
    });
  }

  fitWing(parts: WingParts | null): void {
    if (this.wing) this.root.remove(this.wing.old, this.wing.fresh);
    this.wing = null;
    if (!parts) return;
    const oldLook = newLook();
    const holder = (look: DamageLook) => {
      const group = new THREE.Group();
      group.matrixAutoUpdate = false;
      for (const { geometry, material } of parts.meshes) {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.userData = { damage: look };
        mesh.castShadow = true;
        mesh.frustumCulled = false;
        group.add(mesh);
      }
      group.visible = false;
      this.root.add(group);
      return group;
    };
    const top = topAncestor(parts.frame);
    top.updateMatrixWorld(true);
    this.wing = {
      old: holder(oldLook),
      fresh: holder(newLook()),
      oldLook,
      rest: top.matrixWorld.clone().invert().multiply(parts.frame.matrixWorld),
      offBase: null,
    };
  }

  reset(): void {
    for (const corner of this.corners) {
      corner.offBase = null;
      corner.old.visible = false;
      corner.engaged = 0;
    }
    this.view.x = this.view.y = this.view.yaw = 0;
    if (this.wing) {
      this.wing.offBase = null;
      this.wing.old.visible = false;
      this.wing.fresh.visible = false;
    }
  }

  private side(c: number): number {
    return Math.sign(carShape.tracks[c] ?? 1);
  }

  private end(c: number): number {
    return c < 2 ? 1 : -1;
  }

  private direction(
    pose: CarPose,
    f: number,
    l: number,
    out: THREE.Vector3,
  ): THREE.Vector3 {
    const c = Math.cos(pose.yaw);
    const s = Math.sin(pose.yaw);
    return out.set(f * c - l * s, f * s + l * c, 0);
  }

  private point(
    pose: CarPose,
    f: number,
    l: number,
    z: number,
    out: THREE.Vector3,
  ): THREE.Vector3 {
    return this.direction(pose, f, l, out).add(this.a.set(pose.x, pose.y, z));
  }

  pose(
    state: PropState,
    car: CarPose,
    wheels: THREE.Matrix4[],
    jackSpots: Record<Jack, CarPose>,
    wingFrame: THREE.Matrix4 | null,
    carDamage: DamageLook,
    now: number,
  ): void {
    const delta = Math.min(0.1, Math.max(0, now - this.lastPose));
    this.lastPose = now;
    this.now = now;
    this.state = state;
    this.car = car;
    const follow = state.out ? 1 - Math.exp(-delta * 10) : 1;
    this.view.x = mix(this.view.x, car.x, follow);
    this.view.y = mix(this.view.y, car.y, follow);
    this.view.yaw = mix(this.view.yaw, car.yaw, follow);
    this.corners.forEach((corner, c) => {
      this.hubs(corner, c, wheels[c]);
      this.poseFresh(corner, c);
      this.poseOld(corner, c);
      this.poseGun(corner, c);
    });
    this.poseJack(
      "front",
      jackSpots.front,
      state.lift[0] / carShape.liftHeight,
    );
    this.poseJack("rear", jackSpots.rear, state.lift[1] / carShape.liftHeight);
    this.poseWing(wingFrame, carDamage);
    this.poseLamp();
    this.poseHoses();
  }

  private poseWing(frame: THREE.Matrix4 | null, carDamage: DamageLook): void {
    const rig = this.wing;
    if (!rig) return;
    const { plan, time } = this.state;
    if (!plan?.wing || !frame) {
      rig.old.visible = rig.fresh.visible = false;
      rig.offBase = null;
      return;
    }
    const wing = plan.wing;
    const nominal = this.m2
      .makeRotationZ(this.view.yaw)
      .setPosition(this.view.x, this.view.y, carShape.groundBelowCar)
      .multiply(rig.rest);
    if (time < wing.unlock) {
      rig.oldLook.set(carDamage);
      rig.offBase = null;
    } else rig.offBase ??= frame.clone();
    const place = (
      holder: THREE.Group,
      pose: WingPose,
      base: THREE.Matrix4,
    ) => {
      holder.visible = pose.shown;
      if (!pose.shown) return;
      const shift = this.direction(this.car, pose.f, pose.l, this.c);
      holder.matrix.copy(base);
      holder.matrix.elements[12] += shift.x;
      holder.matrix.elements[13] += shift.y;
      holder.matrix.elements[14] += pose.u;
      holder.matrixWorldNeedsUpdate = true;
    };
    place(
      rig.old,
      wingPath(wing, plan.duration, time, "old"),
      rig.offBase ?? frame,
    );
    const fitted = span(time, wing.fit, wing.fit + slideIn);
    this.blendFrames(nominal, frame, fitted, this.m);
    place(rig.fresh, wingPath(wing, plan.duration, time, "new"), this.m);
  }

  private blendFrames(
    a: THREE.Matrix4,
    b: THREE.Matrix4,
    k: number,
    out: THREE.Matrix4,
  ): THREE.Matrix4 {
    a.decompose(this.a, this.q, this.s1);
    b.decompose(this.b, this.q2, this.d);
    this.a.lerp(this.b, k);
    this.q.slerp(this.q2, k);
    out.compose(this.a, this.q, this.s1);
    this.s1.set(1, 1, 1);
    return out;
  }

  private hubs(
    corner: CornerRig,
    c: number,
    wheel: THREE.Matrix4 | undefined,
  ): void {
    const nominal = this.nominal[c];
    const actual = this.actual[c];
    if (!nominal || !actual) return;
    this.point(
      this.view,
      carShape.axles[c] ?? 0,
      carShape.tracks[c] ?? 0,
      carShape.hubHeight,
      nominal.p,
    );
    nominal.q.setFromAxisAngle(up, this.view.yaw).multiply(corner.restTurn);
    nominal.s.copy(corner.restScale);
    if (wheel && this.state.time > -Infinity)
      wheel.decompose(actual.p, actual.q, actual.s);
    else {
      actual.p.copy(nominal.p);
      actual.q.copy(nominal.q);
      actual.s.copy(nominal.s);
    }
  }

  private plan(c: number) {
    const { plan, time } = this.state;
    const corner = plan?.service ? plan.corners[c] : undefined;
    return { plan, time, corner };
  }

  private poseFresh(corner: CornerRig, c: number): void {
    const { plan, time, corner: work } = this.plan(c);
    const s = this.side(c);
    const e = this.end(c);
    const nominal = this.nominal[c];
    const actual = this.actual[c];
    if (!nominal || !actual) return;
    const at = corner.freshAt;
    const approach = work
      ? span(time, work.tyreOff - 0.14, work.tyreOff + 0.06)
      : 0;
    const push = work ? drive(time, work.tyreOff + 0.02, work.tyreOn) : 0;
    const along = mix(e * freshAlong, e * 0.03, approach) * (1 - push);
    const lateral = mix(mix(freshLateral, freshNear, approach), 0, push);
    this.direction(this.view, along, s * lateral, at.p).add(
      this.c.copy(nominal.p).lerp(actual.p, approach),
    );
    const waiting = 1 - approach;
    at.p.z +=
      seatLift * approach * (1 - push) -
      heldDrop * waiting +
      heldBob * waiting * Math.sin(this.now * 1.9 + c * 1.7);
    this.q.setFromAxisAngle(up, s * e * freshTurn * waiting);
    at.q.copy(this.q).multiply(nominal.q).slerp(actual.q, approach);
    at.s.copy(actual.s);
    const shown = !work || !plan || time < plan.duration + shownAfterStop;
    corner.fresh.visible = shown;
    corner.fresh.matrix.compose(at.p, at.q, at.s);
    corner.fresh.matrixWorldNeedsUpdate = true;
  }

  private poseOld(corner: CornerRig, c: number): void {
    const { plan, time, corner: work } = this.plan(c);
    const actual = this.actual[c];
    if (!actual) return;
    if (!work || !plan || time < work.nutOff) {
      copyLook(corner.oldLook, corner.carLook);
      corner.offBase = null;
      corner.old.visible = false;
      corner.oldAt.p.copy(actual.p);
      corner.oldAt.q.copy(actual.q);
      corner.oldAt.s.copy(actual.s);
      return;
    }
    if (!corner.offBase) {
      corner.offBase = pose();
      corner.offBase.p.copy(actual.p);
      corner.offBase.q.copy(actual.q);
      corner.offBase.s.copy(actual.s);
    }
    const base = corner.offBase;
    const s = this.side(c);
    const e = this.end(c);
    const landAt = work.tyreOff + swingAfter;
    const yank = span(time, work.nutOff, work.nutOff + yankTime);
    const swing = span(time, work.nutOff + swingLead, landAt - 0.02);
    const fall = drive(time, work.nutOff + 0.1, landAt);
    const since = time - landAt;
    const bounce =
      since > 0
        ? landBounce * Math.exp(-since * 16) * Math.abs(Math.sin(since * 26))
        : 0;
    const raise = span(time, plan.duration + 0.15, plan.duration + 0.65);
    const at = corner.oldAt;
    this.direction(
      this.car,
      e * dropped.along * swing,
      s * (yankOut * yank + (dropped.out - yankOut) * swing),
      at.p,
    ).add(base.p);
    at.p.z += (corner.radius - base.p.z) * fall + bounce + 0.2 * raise;
    this.q.setFromAxisAngle(up, -s * e * dropped.turn * swing);
    at.q.copy(this.q).multiply(base.q);
    at.s.copy(base.s);
    corner.old.visible = true;
    corner.old.matrix.compose(at.p, at.q, at.s);
    corner.old.matrixWorldNeedsUpdate = true;
  }

  private poseGun(corner: CornerRig, c: number): void {
    const { time, corner: work } = this.plan(c);
    const s = this.side(c);
    const nominal = this.nominal[c];
    const actual = this.actual[c];
    if (!nominal || !actual) return;
    const half = carShape.halfWidths[c] ?? 0.15;
    const outward = this.direction(this.view, 0, s, this.b);
    corner.axis.copy(outward).negate();
    const ready = this.c
      .copy(nominal.p)
      .addScaledVector(outward, half + gunReady);
    ready.z -= 0.05;
    corner.engaged = mix(corner.engaged, 0, 0.3);
    if (!work) {
      corner.tip.copy(ready);
      return;
    }
    const hub =
      time >= work.nutOn && corner.offBase ? corner.offBase.p : actual.p;
    const nut = this.d.copy(hub).addScaledVector(outward, half + nutGap);
    const clear = this.a.copy(hub).addScaledVector(outward, half + gunClear);
    clear.z += 0.03;
    const engaged = gunTip(work, time, ready, nut, clear, corner.tip);
    corner.engaged = mix(corner.engaged, engaged ? 1 : 0, 0.7);
    if (engaged)
      corner.tip.z +=
        rattle * Math.sin(this.now * Math.PI * 2 * rattleRate + c);
  }

  private gunMatrix(corner: CornerRig, out: THREE.Matrix4): THREE.Matrix4 {
    const x = corner.axis;
    const y = this.a.crossVectors(up, x).normalize();
    const z = this.b.crossVectors(x, y);
    out.makeBasis(x, y, z).setPosition(corner.tip);
    return out;
  }

  gun(c: number): GunHold {
    const corner = this.corners[c];
    if (!corner)
      return {
        grip: [0, 0, 0],
        front: [0, 0, 0],
        axis: [1, 0, 0],
        tip: [0, 0, 0],
      };
    const { tip, axis } = corner;
    const grip = tip.clone().addScaledVector(axis, -0.3);
    grip.z -= 0.09;
    const front = tip.clone().addScaledVector(axis, -0.145);
    front.z += 0.095;
    return { grip: v3(grip), front: v3(front), axis: v3(axis), tip: v3(tip) };
  }

  gunEngaged(c: number): number {
    return this.corners[c]?.engaged ?? 0;
  }

  tyreRadius(c: number): number {
    return this.corners[c]?.radius ?? carShape.hubHeight;
  }

  inHand(c: number, which: "old" | "new"): boolean {
    const corner = this.corners[c];
    const { plan, time, corner: work } = this.plan(c);
    if (!corner) return false;
    if (which === "new") return corner.fresh.visible && !work;
    return corner.old.visible && !!plan && time >= plan.duration;
  }

  posts(out: number[], anchor: THREE.Matrix4): void {
    this.corners.forEach((corner, c) => {
      const { plan, time, corner: work } = this.plan(c);
      const landed = !!work && time >= work.tyreOff + swingAfter;
      const tyres = [
        corner.old.visible && landed ? corner.oldAt.p : null,
        corner.fresh.visible && (!plan || !work) ? corner.freshAt.p : null,
      ];
      for (const tyre of tyres) {
        if (!tyre) continue;
        const { x, y } = this.a.copy(tyre).applyMatrix4(anchor);
        out.push(x, y, tyrePost);
      }
    });
  }

  tyreCentre(c: number, which: "old" | "new"): V3 {
    const corner = this.corners[c];
    if (!corner) return [0, 0, 0];
    return v3(which === "old" ? corner.oldAt.p : corner.freshAt.p);
  }

  tyreGrips(c: number, which: "old" | "new", angle: number): TyreHold {
    const corner = this.corners[c];
    const at = which === "old" ? corner?.oldAt : corner?.freshAt;
    if (!corner || !at) return { plus: noGrip, minus: noGrip };
    const axle = this.a.set(1, 0, 0).applyQuaternion(at.q);
    axle.z = 0;
    axle.normalize();
    const outward = this.direction(this.car, 0, this.side(c), this.b);
    if (axle.dot(outward) < 0) axle.negate();
    const across = this.c.crossVectors(up, axle).normalize();
    const shoulder = (carShape.halfWidths[c] ?? 0.15) - shoulderInset;
    const grip = (sign: number): Grip => {
      const radial = this.d
        .copy(up)
        .multiplyScalar(Math.cos(angle))
        .addScaledVector(across, sign * Math.sin(angle));
      const point = at.p
        .clone()
        .addScaledVector(radial, corner.radius * treadHold)
        .addScaledVector(axle, shoulder);
      const fingers = axle
        .clone()
        .negate()
        .addScaledVector(radial, -0.25)
        .normalize();
      return {
        at: v3(point),
        fingers: v3(fingers),
        palm: v3(radial.clone().negate()),
      };
    };
    return { plus: grip(1), minus: grip(-1) };
  }

  jackHandle(which: Jack): JackHold {
    const jack = this.jacks[which];
    const turn = jack.turn * jack.press;
    const height = handleHeights[which];
    const x = jack.handleX * Math.cos(turn) + height * Math.sin(turn);
    const z = -jack.handleX * Math.sin(turn) + height * Math.cos(turn);
    const across = this.a.crossVectors(up, jack.back).normalize();
    const end = this.b
      .copy(jack.origin)
      .addScaledVector(jack.back, pivotAhead + x)
      .setZ(wheelRadius + z);
    const left = end.clone().addScaledVector(across, -barHalf);
    const right = end.clone().addScaledVector(across, barHalf);
    return {
      left: v3(left),
      right: v3(right),
      fingers: [-jack.back.x, -jack.back.y, -0.25],
      palm: [0, 0, -1],
    };
  }

  jackPress(which: Jack): number {
    return this.jacks[which].press;
  }

  private poseJack(which: Jack, spot: CarPose, press: number): void {
    const jack = this.jacks[which];
    jack.press = clamp01(press);
    const reach = jackReach[which];
    const ahead = this.a.set(Math.cos(spot.yaw), Math.sin(spot.yaw), 0);
    jack.origin.set(spot.x, spot.y, 0).addScaledVector(ahead, reach);
    jack.back.copy(ahead).negate();
    const y = this.b.crossVectors(up, jack.back).normalize();
    jack.root.matrix.makeBasis(jack.back, y, up).setPosition(jack.origin);
    jack.root.matrixWorldNeedsUpdate = true;
    jack.lever.rotation.y = jack.turn * jack.press;
  }

  private poseLamp(): void {
    const { plan, time } = this.state;
    const [stop, go] = this.lamps;
    const stopped = !!plan && time >= 0 && time < plan.release;
    const going = !!plan && time >= plan.release && time < plan.duration + 1.5;
    stop.emissive.copy(stopped ? red : unlit);
    go.emissive.copy(going ? green : unlit);
  }

  private poseHoses(): void {
    this.corners.forEach((corner, c) => {
      const s = this.side(c);
      const e = this.end(c);
      this.gunMatrix(corner, this.m);
      this.guns.setMatrixAt(c, this.m);
      const start = this.a.set(
        e * boomAhead,
        boomLateral + s * 0.14,
        boomHeight,
      );
      const end = this.b
        .copy(corner.tip)
        .addScaledVector(corner.axis, -gunLength);
      const reach = Math.hypot(end.x - start.x, end.y - start.y);
      const slack = Math.max(0, reach - hoseSpan);
      const bend = this.c
        .copy(start)
        .lerp(end, Math.min(0.35, slack * 0.08))
        .setZ(Math.max(hoseFloor, start.z - 1.7 - slack * 0.45));
      const tail = this.d.copy(end).addScaledVector(corner.axis, -0.4);
      tail.z = Math.max(hoseFloor, tail.z + 0.5 - slack * 0.3);
      let px = start.x;
      let py = start.y;
      let pz = start.z;
      for (let k = 1; k <= hoseSegments; k++) {
        const t = k / hoseSegments;
        const u = 1 - t;
        const w0 = u * u * u;
        const w1 = 3 * u * u * t;
        const w2 = 3 * u * t * t;
        const w3 = t * t * t;
        const x = w0 * start.x + w1 * bend.x + w2 * tail.x + w3 * end.x;
        const y = w0 * start.y + w1 * bend.y + w2 * tail.y + w3 * end.y;
        const z = w0 * start.z + w1 * bend.z + w2 * tail.z + w3 * end.z;
        const dx = x - px;
        const dy = y - py;
        const dz = z - pz;
        const length = Math.hypot(dx, dy, dz) || 1e-4;
        this.q2.setFromUnitVectors(
          yAxis,
          this.s1.set(dx / length, dy / length, dz / length),
        );
        this.m2.compose(
          this.mid.set((x + px) / 2, (y + py) / 2, (z + pz) / 2),
          this.q2,
          this.s1.set(1, length * 1.06, 1),
        );
        this.s1.set(1, 1, 1);
        this.hoses.setMatrixAt(c * hoseSegments + k - 1, this.m2);
        px = x;
        py = y;
        pz = z;
      }
    });
    this.guns.instanceMatrix.needsUpdate = true;
    this.hoses.instanceMatrix.needsUpdate = true;
  }

  carry(list: Carried[], rootWorld: THREE.Matrix4): void {
    this.m.copy(rootWorld).invert();
    for (const held of list) {
      if (held.weight <= 0.001) continue;
      const corner = this.corners[held.corner];
      if (!corner) continue;
      const hand = this.a
        .setFromMatrixPosition(held.hand.matrixWorld)
        .applyMatrix4(this.m);
      const ahead = this.b.set(
        Math.cos(held.spot.yaw),
        Math.sin(held.spot.yaw),
        0,
      );
      const right = this.c.set(ahead.y, -ahead.x, 0);
      if (held.role === "gunner") {
        const aim = this.d.copy(ahead).multiplyScalar(0.55).setZ(-0.83);
        const tip = this.mid.copy(hand).addScaledVector(aim, 0.3);
        corner.tip.lerp(tip, held.weight);
        corner.axis.lerp(aim, held.weight).normalize();
        continue;
      }
      const which =
        held.role === "tyreOff"
          ? corner.old
          : held.role === "tyreOn"
            ? corner.fresh
            : null;
      const at = held.role === "tyreOff" ? corner.oldAt : corner.freshAt;
      if (!which?.visible) continue;
      this.cradled(held, at, hand, right);
      at.q.slerp(this.q.multiply(corner.restTurn), held.weight);
      which.matrix.compose(at.p, at.q, at.s);
      which.matrixWorldNeedsUpdate = true;
    }
    this.poseHoses();
  }

  private cradled(
    held: Carried,
    at: Pose,
    hand: THREE.Vector3,
    right: THREE.Vector3,
  ): void {
    const other = this.d
      .setFromMatrixPosition(held.other.matrixWorld)
      .applyMatrix4(this.m);
    const across = this.b.copy(other).sub(hand).setZ(0);
    if (across.lengthSq() < 1e-6) across.copy(right).negate();
    across.normalize();
    const ahead = right.set(across.y, -across.x, 0);
    const centre = other.add(hand).multiplyScalar(0.5);
    centre.addScaledVector(ahead, cradle.ahead).z += cradle.rise;
    at.p.lerp(centre, held.weight);
    this.q.setFromAxisAngle(
      up,
      Math.atan2(ahead.y, ahead.x) + (this.side(held.corner) * Math.PI) / 2,
    );
  }

  warm(): void {
    if (this.wing) this.wing.old.visible = this.wing.fresh.visible = true;
    for (const corner of this.corners) {
      corner.old.visible = true;
      corner.fresh.visible = true;
    }
    this.lamps[0].emissive.copy(red);
    this.lamps[1].emissive.copy(green);
  }
}

export interface ParkedBox {
  distance: number;
  team: string;
  matrix: THREE.Matrix4;
}

const parkedGunAt = (
  c: number,
): { tip: THREE.Vector3; axis: THREE.Vector3 } => {
  const e = c < 2 ? 1 : -1;
  const near = c % 2 === 1 ? 1 : 0;
  return {
    tip: new THREE.Vector3(e * (1.9 + 0.5 * near), 2.5 + 0.7 * near, 0.045),
    axis: new THREE.Vector3(-0.3 * e, -1, 0).normalize(),
  };
};

function parkedHose(c: number): THREE.BufferGeometry {
  const e = c < 2 ? 1 : -1;
  const s = c % 2 === 1 ? 1 : -1;
  const { tip, axis } = parkedGunAt(c);
  const tail = tip.clone().addScaledVector(axis, -gunLength);
  const floor = hoseRadius;
  const drop = hoseClear + s * 0.12;
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(e * boomAhead, boomLateral + s * 0.14, boomHeight),
    new THREE.Vector3(e * boomAhead, 0.9 + s * 0.1, boomHeight - 0.16),
    new THREE.Vector3(e * (boomAhead - 0.04), drop - 0.15, boomHeight - 0.4),
    new THREE.Vector3(e * (boomAhead - 0.1), drop, 2.6),
    new THREE.Vector3(e * (boomAhead - 0.2), drop + 0.05, 0.7),
    new THREE.Vector3(e * (boomAhead - 0.4), drop + 0.35, floor),
    tail.clone().addScaledVector(axis, -0.5).setZ(floor),
    tail.setZ(Math.max(floor, tail.z)),
  ]);
  return new THREE.TubeGeometry(curve, 48, hoseRadius, 6, false);
}

function parkedJackAt(which: Jack): THREE.Matrix4 {
  const back = new THREE.Vector3(0, 1, 0);
  const y = new THREE.Vector3().crossVectors(up, back).normalize();
  return new THREE.Matrix4()
    .makeBasis(back, y, up)
    .setPosition(which === "front" ? 3.6 : -3.9, 4.4, 0);
}

function placed(
  geometry: THREE.BufferGeometry,
  matrix: THREE.Matrix4,
): THREE.BufferGeometry {
  return geometry.clone().applyMatrix4(matrix);
}

function parkedGuns(): THREE.BufferGeometry {
  const gun = gunGeometry(new THREE.Color(0x3a3d44));
  return mergeGeometries(
    [0, 1, 2, 3].map((c) => {
      const { tip, axis } = parkedGunAt(c);
      const y = new THREE.Vector3().crossVectors(up, axis).normalize();
      const z = new THREE.Vector3().crossVectors(axis, y);
      return placed(
        gun,
        new THREE.Matrix4().makeBasis(axis, y, z).setPosition(tip),
      );
    }),
  );
}

function parkedJacks(): {
  levers: THREE.BufferGeometry;
  rest: THREE.BufferGeometry;
} {
  const levers: THREE.BufferGeometry[] = [];
  const rest: THREE.BufferGeometry[] = [];
  for (const which of ["front", "rear"] as const) {
    const parts = jackParts(which);
    const at = parkedJackAt(which);
    const pivot = new THREE.Matrix4().makeTranslation(
      pivotAhead,
      0,
      wheelRadius,
    );
    const local = at.clone().multiply(pivot);
    levers.push(placed(painted(parts.lever, 0xffffff), local));
    rest.push(placed(painted(parts.grips, 0x18191d), local));
    rest.push(placed(painted(parts.base, 0x2a2c31), local));
    if (parts.marker) rest.push(placed(painted(parts.marker, 0xf0b90b), local));
  }
  return { levers: mergeGeometries(levers), rest: mergeGeometries(rest) };
}

const hidden = new THREE.Matrix4().makeScale(0, 0, 0);

export class ParkedBoxes {
  readonly root = new THREE.Group();
  private readonly meshes: THREE.InstancedMesh[];

  constructor(private readonly boxes: ParkedBox[]) {
    this.root.matrixAutoUpdate = false;
    const count = boxes.length;
    const hoses = new THREE.InstancedMesh(
      mergeGeometries([0, 1, 2, 3].map(parkedHose)),
      material("pit hose", 0x101114, 0.72),
      count,
    );
    const gunMaterial = material("pit gun", 0xffffff, 0.42, 0.45);
    gunMaterial.vertexColors = true;
    const guns = new THREE.InstancedMesh(parkedGuns(), gunMaterial, count);
    const jacks = parkedJacks();
    const levers = new THREE.InstancedMesh(
      jacks.levers,
      material("pit jack", 0xffffff, 0.38, 0.2),
      count,
    );
    const restMaterial = material("pit jack base", 0xffffff, 0.6, 0.3);
    restMaterial.vertexColors = true;
    const rest = new THREE.InstancedMesh(jacks.rest, restMaterial, count);
    this.meshes = [hoses, guns, levers, rest];
    boxes.forEach((box, i) => {
      for (const mesh of this.meshes) mesh.setMatrixAt(i, box.matrix);
      levers.setColorAt(i, new THREE.Color(teamOf(box.team).brand));
    });
    for (const mesh of this.meshes) {
      mesh.castShadow = true;
      mesh.computeBoundingSphere();
      this.root.add(mesh);
    }
  }

  show(distance: number, shown: boolean): void {
    const i = this.boxes.findIndex(
      (box) => Math.abs(box.distance - distance) < 1,
    );
    const box = this.boxes[i];
    if (!box) return;
    for (const mesh of this.meshes) {
      mesh.setMatrixAt(i, shown ? box.matrix : hidden);
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
