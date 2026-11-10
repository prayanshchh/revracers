import * as THREE from "three/webgpu";
import {
  abs,
  asin,
  atan,
  clamp,
  cos,
  exp,
  float,
  floor,
  fract,
  fwidth,
  length,
  max,
  mix,
  mx_noise_float,
  normalize,
  positionLocal,
  sin,
  smoothstep,
  sqrt,
  step,
  time,
  vec2,
  vec3,
} from "three/tsl";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { cityGlow, Quads } from "./street-city.ts";
import { slide } from "./street-screens.ts";

interface Spot {
  x: number;
  y: number;
  z: number;
}

interface GlobeSpot extends Spot {
  radius: number;
  height: number;
  facing: number;
}

interface TowerSpot extends Spot {
  height: number;
  base: number;
  turn: number;
}

interface WheelSpot extends Spot {
  diameter: number;
  height: number;
  turn: number;
}

interface BalloonSpot extends Spot {
  height: number;
}

export interface Landmarks {
  globe?: GlobeSpot;
  tower?: TowerSpot;
  wheel?: WheelSpot;
  balloon?: BalloonSpot;
}

type Node = THREE.Node<"float">;
type Node3 = THREE.Node<"vec3">;

const sceneTime = 11;
const sceneCount = 4;
const fade = 0.09;
const broadcastPanels = 3;
const broadcastBand = 0.42;
const broadcastLift = 0.17;
const broadcastSeconds = 5.5;
const ledColumns = 1100;
const ledRows = 520;
const wheelCabins = 28;
const wheelSegments = 96;
const wheelTurn = (2 * Math.PI) / 240;
const wheelGauge = 2.1;
const wheelFlange = 5;
const wheelHub = 1.8;
const wheelStance = 8;
const wheelBraces = [0.44, 0.64];
const towerSegments = 22;
const towerDeckShares = [0.175, 0.35, 0.84];
const towerGlowLow = 0.26;
const towerGlowHigh = 0.12;
const towerFlare = 0.4;
const up = new THREE.Vector3(0, 1, 0);

class Boxes extends Quads {
  beam(a: THREE.Vector3, b: THREE.Vector3, size: number): void {
    const along = b.clone().sub(a);
    if (along.lengthSq() < 1e-6) return;
    along.normalize();
    const helper = Math.abs(along.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : up;
    const side = new THREE.Vector3().crossVectors(along, helper).normalize();
    const lift = new THREE.Vector3().crossVectors(side, along).normalize();
    const h = size / 2;
    const offsets = [
      side.clone().multiplyScalar(h).addScaledVector(lift, h),
      side.clone().multiplyScalar(-h).addScaledVector(lift, h),
      side.clone().multiplyScalar(-h).addScaledVector(lift, -h),
      side.clone().multiplyScalar(h).addScaledVector(lift, -h),
    ];
    for (let k = 0; k < 4; k++) {
      const p = offsets[k] ?? side;
      const q = offsets[(k + 1) % 4] ?? side;
      const normal = p.clone().add(q).normalize();
      this.add(
        [
          a.clone().add(q),
          a.clone().add(p),
          b.clone().add(p),
          b.clone().add(q),
        ],
        normal,
      );
    }
  }
}

function sceneWeight(index: number): Node {
  const phase = fract(time.div(sceneTime * sceneCount));
  const start = index / sceneCount;
  const end = (index + 1) / sceneCount;
  const rise = smoothstep(start - fade / sceneCount, start, phase);
  const fall = smoothstep(end - fade / sceneCount, end, phase);
  const wrapRise =
    index === 0 ? smoothstep(1 - fade / sceneCount, 1, phase) : float(0);
  return clamp(rise.sub(fall).add(wrapRise), 0, 1);
}

function planet(p: Node, q: Node): Node3 {
  const drift = p.add(time.mul(0.004));
  const swirl = mx_noise_float(vec2(drift.mul(3), q.mul(7))).mul(0.55);
  const bands = sin(q.mul(19).add(swirl.mul(3)));
  const cream = vec3(0.98, 0.86, 0.66);
  const rust = vec3(0.78, 0.36, 0.14);
  const deep = vec3(0.32, 0.12, 0.05);
  const banded = mix(
    mix(deep, rust, smoothstep(-1, 0, bands)),
    cream,
    smoothstep(0.1, 1, bands),
  );
  const spot = length(vec2(p.sub(0.12).mul(2.2), q.add(0.22).mul(4)));
  const storm = vec3(0.86, 0.22, 0.1);
  return mix(banded, storm, smoothstep(0.42, 0.3, spot));
}

function aurora(p: Node, q: Node): Node3 {
  const flow = mx_noise_float(
    vec3(p.mul(2.4).add(time.mul(0.03)), q.mul(1.6), time.mul(0.05)),
  );
  const veil = mx_noise_float(
    vec3(p.mul(6).sub(time.mul(0.02)), q.mul(3.5).add(flow), time.mul(0.04)),
  );
  const deep = vec3(0.02, 0.03, 0.12);
  const teal = vec3(0.05, 0.6, 0.62);
  const rose = vec3(0.85, 0.12, 0.5);
  const ribbon = smoothstep(-0.2, 0.7, veil.add(flow.mul(0.6)));
  return mix(deep, mix(teal, rose, smoothstep(-0.5, 0.6, flow)), ribbon);
}

function lights(p: Node, q: Node): Node3 {
  const cycle = fract(time.div(7)).mul(7);
  const lit = floor(cycle);
  const out = step(5.6, cycle);
  const back = mix(
    vec3(0.02, 0.02, 0.03),
    vec3(0.08, 0.08, 0.1),
    smoothstep(0.32, 0.3, abs(q.sub(0.08))),
  );
  let colour: Node3 = back;
  for (let k = 0; k < 5; k++) {
    const centre = vec2((k - 2) * 0.13, 0.08);
    const d = length(vec2(p, q).sub(centre).mul(vec2(1, 2)));
    const ring = smoothstep(0.055, 0.045, d);
    const on = step(k + 0.5, lit).mul(float(1).sub(out));
    const glow = smoothstep(0.12, 0.0, d).mul(on).mul(0.6);
    const lamp = mix(vec3(0.15, 0.02, 0.02), vec3(1, 0.05, 0.03), on);
    colour = mix(colour, lamp, ring).add(vec3(1, 0.1, 0.05).mul(glow));
  }
  return colour;
}

function broadcast(p: Node, q: Node, atlas: THREE.Texture): Node3 {
  const around = p.mul(broadcastPanels / 2).add(0.5);
  const u = fract(around);
  const height = q.sub(broadcastLift);
  const v = clamp(height.div(broadcastBand).mul(0.5).add(0.5), 0, 1);
  const index = floor(around)
    .mul(5)
    .add(floor(time.div(broadcastSeconds)).mul(3))
    .add(64)
    .mod(16);
  const framed = step(abs(height), broadcastBand)
    .mul(smoothstep(0, 0.012, u))
    .mul(smoothstep(1, 0.988, u));
  const backdrop = mix(
    vec3(0.22, 0.1, 0.42),
    vec3(0.55, 0.12, 0.5),
    smoothstep(broadcastBand, 1, abs(height)),
  );
  return mix(backdrop, sqrt(slide(atlas, vec2(u, v), index)), framed);
}

function globeMaterial(atlas: THREE.Texture): THREE.MeshBasicNodeMaterial {
  const material = new THREE.MeshBasicNodeMaterial();
  const dir = normalize(positionLocal);
  const p = atan(dir.z.negate(), dir.x).div(Math.PI);
  const q = asin(clamp(dir.y, -1, 1)).div(Math.PI / 2);
  const content = planet(p, q)
    .mul(sceneWeight(0))
    .add(aurora(p, q).mul(sceneWeight(1)))
    .add(lights(p, q).mul(sceneWeight(2)))
    .add(broadcast(p, q, atlas).mul(sceneWeight(3)));
  const cell = vec2(p.mul(ledColumns), q.mul(ledRows));
  const dot = smoothstep(0.5, 0.25, length(fract(cell).sub(0.5)));
  const blur = clamp(max(fwidth(cell.x), fwidth(cell.y)).mul(0.9), 0, 1);
  const led = mix(dot.mul(1.5).add(0.2), float(1), blur);
  material.colorNode = content
    .mul(content)
    .mul(led)
    .mul(cityGlow.mul(1.25).add(0.35));
  return material;
}

function ledGlobe(spot: GlobeSpot, atlas: THREE.Texture): THREE.Object3D {
  const centreY = spot.y + spot.height - spot.radius;
  const cut = Math.acos(
    Math.max(-1, Math.min(1, (spot.y - 1 - centreY) / spot.radius)),
  );
  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(spot.radius, 160, 96, 0, Math.PI * 2, 0, cut),
    globeMaterial(atlas),
  );
  shell.position.set(spot.x, centreY, spot.z);
  shell.rotation.y = -spot.facing;
  shell.name = "landmark_globe";
  const footing = Math.sqrt(
    Math.max(0, spot.radius ** 2 - (spot.y - centreY) ** 2),
  );
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(footing * 0.86, footing * 0.9, 9, 64, 1, true),
    darkMaterial(0.16),
  );
  base.position.set(spot.x, spot.y + 4.5, spot.z);
  const group = new THREE.Group();
  group.add(shell, base);
  return group;
}

function darkMaterial(shade: number): THREE.MeshStandardNodeMaterial {
  const material = new THREE.MeshStandardNodeMaterial({
    side: THREE.DoubleSide,
  });
  material.colorNode = vec3(shade, shade, shade * 1.05);
  material.roughnessNode = float(0.7);
  return material;
}

function towerProfile(level: number, base: number): number {
  const half = base / 2;
  return half * Math.exp(-3.1 * level) + half * 0.035;
}

interface TowerFrame {
  spot: TowerSpot;
  at: (a: number, b: number, h: number) => THREE.Vector3;
  deck: number;
}

function towerFrame(found: TowerSpot): TowerFrame {
  const spot = {
    ...found,
    base: Math.max(found.base, found.height * towerFlare),
  };
  const along = new THREE.Vector3(Math.cos(spot.turn), 0, Math.sin(spot.turn));
  const side = new THREE.Vector3(-along.z, 0, along.x);
  return {
    spot,
    deck: spot.height * 0.84,
    at: (a, b, h) =>
      new THREE.Vector3(spot.x, spot.y + h, spot.z)
        .addScaledVector(along, a)
        .addScaledVector(side, b),
  };
}

function legGap(frame: TowerFrame, h: number): number {
  return Math.max(0, 1 - h / (frame.spot.height * 0.36)) * 0.62;
}

function square(frame: TowerFrame, h: number, w: number): THREE.Vector3[] {
  return [
    frame.at(w, w, h),
    frame.at(-w, w, h),
    frame.at(-w, -w, h),
    frame.at(w, -w, h),
  ];
}

function legCorners(frame: TowerFrame, h: number): THREE.Vector3[][] {
  const { spot } = frame;
  const gap = legGap(frame, h);
  return square(frame, h, towerProfile(h / spot.height, spot.base)).map((c) => {
    const inward = new THREE.Vector3(spot.x, c.y, spot.z).sub(c);
    return [c, c.clone().addScaledVector(inward, gap)];
  });
}

function legSegment(
  boxes: Boxes,
  lower: THREE.Vector3[],
  upper: THREE.Vector3[],
  size: number,
): void {
  const [outer0, inner0] = lower;
  const [outer1, inner1] = upper;
  if (!outer0 || !inner0 || !outer1 || !inner1) return;
  boxes.beam(outer0, outer1, size);
  boxes.beam(inner0, inner1, size * 0.8);
  boxes.beam(outer0, inner1, size * 0.45);
  boxes.beam(inner0, outer1, size * 0.45);
}

function towerLegs(boxes: Boxes, frame: TowerFrame): void {
  for (let k = 0; k < towerSegments; k++) {
    const h0 = (frame.deck * k) / towerSegments;
    const h1 = (frame.deck * (k + 1)) / towerSegments;
    const lower = legCorners(frame, h0);
    const upper = legCorners(frame, h1);
    const size = 1.1 * (1 - h0 / frame.spot.height) + 0.4;
    const joined = legGap(frame, h0) === 0;
    lower.forEach((low, c) => {
      const high = upper[c] ?? [];
      legSegment(boxes, low, high, size);
      const next0 = lower[(c + 1) % 4]?.[0];
      const next1 = upper[(c + 1) % 4]?.[0];
      const [outer0] = low;
      const [outer1] = high;
      if (!joined || !next0 || !next1 || !outer0 || !outer1) return;
      boxes.beam(outer0, next1, size * 0.4);
      boxes.beam(next0, outer1, size * 0.4);
    });
  }
}

function loop(boxes: Boxes, points: THREE.Vector3[], size: number): void {
  points.forEach((a, k) => {
    const b = points[(k + 1) % points.length];
    if (b) boxes.beam(a, b, size);
  });
}

function towerDecks(boxes: Boxes, frame: TowerFrame): void {
  for (const share of towerDeckShares) {
    const w = towerProfile(share, frame.spot.base) * 1.12;
    loop(
      boxes,
      square(frame, frame.spot.height * share, w),
      share < 0.5 ? 2.6 : 1.6,
    );
  }
  boxes.beam(
    frame.at(0, 0, frame.deck),
    frame.at(0, 0, frame.spot.height),
    1.4,
  );
}

function towerArches(boxes: Boxes, frame: TowerFrame): void {
  const { spot } = frame;
  const rise = spot.height * 0.13;
  const w = towerProfile(0.06, spot.base);
  for (let c = 0; c < 4; c++) {
    const angle = (c * Math.PI) / 2;
    const points = Array.from({ length: 11 }, (_, k) => {
      const t = k / 10;
      const lateral = (t * 2 - 1) * w;
      return frame.at(
        Math.cos(angle) * w - Math.sin(angle) * lateral,
        Math.sin(angle) * w + Math.cos(angle) * lateral,
        rise * Math.sin(Math.PI * t) + spot.height * 0.03,
      );
    });
    points.slice(1).forEach((b, k) => {
      const a = points[k];
      if (a) boxes.beam(a, b, 0.9);
    });
  }
}

function towerMaterial(spot: TowerSpot): THREE.MeshStandardNodeMaterial {
  const material = new THREE.MeshStandardNodeMaterial();
  material.colorNode = vec3(0.12, 0.085, 0.055);
  material.roughnessNode = float(0.7);
  const height = positionLocal.y.sub(spot.y).div(spot.height);
  const sparkle = step(
    0.993,
    fract(
      sin(
        floor(positionLocal.x.mul(0.9))
          .add(floor(positionLocal.y.mul(0.9)).mul(13.1))
          .add(floor(time.mul(5)))
          .mul(91.7),
      ).mul(43758.5),
    ),
  );
  let decks: Node = float(0);
  for (const share of towerDeckShares)
    decks = decks.add(exp(abs(height.sub(share)).mul(-70)));
  const lit = vec3(0.8, 0.5, 0.22).mul(
    mix(float(towerGlowLow), float(towerGlowHigh), height).add(decks.mul(0.5)),
  );
  material.emissiveNode = lit
    .add(vec3(1, 0.9, 0.7).mul(sparkle).mul(1.6))
    .mul(cityGlow);
  return material;
}

function towerMesh(found: TowerSpot): THREE.Object3D {
  const frame = towerFrame(found);
  const boxes = new Boxes();
  towerLegs(boxes, frame);
  towerDecks(boxes, frame);
  towerArches(boxes, frame);
  const mesh = new THREE.Mesh(boxes.geometry(), towerMaterial(frame.spot));
  mesh.name = "landmark_tower";
  return mesh;
}

function spun(centre: THREE.Vector3, axle: THREE.Vector3): THREE.Node<"vec3"> {
  const origin = vec3(centre.x, centre.y, centre.z);
  const axis = vec3(axle.x, axle.y, axle.z);
  const arm = positionLocal.sub(origin);
  const angle = time.mul(wheelTurn);
  return origin
    .add(arm.mul(cos(angle)))
    .add(axis.cross(arm).mul(sin(angle)))
    .add(axis.mul(axis.dot(arm)).mul(float(1).sub(cos(angle))));
}

function wheelPaint(
  colour: [number, number, number],
  shine: number,
  turning: THREE.Node<"vec3"> | null,
): THREE.MeshBasicNodeMaterial {
  const material = new THREE.MeshBasicNodeMaterial();
  material.colorNode = vec3(...colour).mul(cityGlow.mul(shine).add(0.03));
  if (turning) material.positionNode = turning;
  return material;
}

function wheelMesh(spot: WheelSpot): THREE.Object3D {
  const radius = spot.diameter / 2;
  const centre = new THREE.Vector3(
    spot.x,
    spot.y + spot.height - radius,
    spot.z,
  );
  const plane = new THREE.Vector3(Math.cos(spot.turn), 0, Math.sin(spot.turn));
  const axle = new THREE.Vector3(-plane.z, 0, plane.x);
  const point = (angle: number, r: number, offset: number) =>
    centre
      .clone()
      .addScaledVector(plane, Math.cos(angle) * r)
      .addScaledVector(up, Math.sin(angle) * r)
      .addScaledVector(axle, offset);
  const rim = new Boxes();
  const cables = new Boxes();
  const leds = new Boxes();
  for (let k = 0; k < wheelSegments; k++) {
    const a0 = (k / wheelSegments) * Math.PI * 2;
    const a1 = ((k + 1) / wheelSegments) * Math.PI * 2;
    for (const offset of [-wheelGauge, wheelGauge])
      rim.beam(point(a0, radius, offset), point(a1, radius, offset), 0.6);
    leds.beam(point(a0, radius + 0.7, 0), point(a1, radius + 0.7, 0), 0.5);
    for (const share of wheelBraces)
      cables.beam(
        point(a0, radius * share, 0),
        point(a1, radius * share, 0),
        0.28,
      );
    if (k % 2 === 0)
      rim.beam(
        point(a0, radius, -wheelGauge),
        point(a0, radius, wheelGauge),
        0.45,
      );
  }
  for (let k = 0; k < wheelCabins * 2; k++) {
    const angle = (k / (wheelCabins * 2)) * Math.PI * 2;
    const flange = k % 2 === 0 ? wheelFlange : -wheelFlange;
    cables.beam(
      point(angle + 0.5, wheelHub, flange),
      point(angle, radius, -Math.sign(flange) * wheelGauge),
      0.2,
    );
  }
  rim.beam(point(0, 0, -wheelFlange), point(0, 0, wheelFlange), wheelHub * 2);
  const frame = new Boxes();
  frame.beam(point(0, 0, -wheelStance), point(0, 0, wheelStance), 2.4);
  for (const side of [-1, 1])
    for (const lean of [-1, 1]) {
      const foot = centre
        .clone()
        .addScaledVector(plane, lean * radius * 0.4)
        .addScaledVector(axle, side * (wheelStance + 9));
      foot.y = spot.y;
      frame.beam(foot, point(0, 0, side * wheelStance), 1.5);
    }
  const turning = spun(centre, axle);
  const basis = new THREE.Matrix4().makeBasis(plane, up, axle);
  const pods = Array.from({ length: wheelCabins }, (_, k) =>
    new THREE.SphereGeometry(1, 10, 6).applyMatrix4(
      basis
        .clone()
        .scale(new THREE.Vector3(2.7, 1.9, 2.2))
        .setPosition(point((k / wheelCabins) * Math.PI * 2, radius + 3.6, 0)),
    ),
  );
  const cabins = new THREE.Mesh(
    mergeGeometries(pods),
    wheelPaint([0.9, 0.93, 1], 0.3, turning),
  );
  const sweep = atan(
    positionLocal.y.sub(centre.y),
    positionLocal.x
      .sub(centre.x)
      .mul(plane.x)
      .add(positionLocal.z.sub(centre.z).mul(plane.z)),
  ).div(Math.PI * 2);
  const chase = sin(sweep.mul(Math.PI * 2 * 3).sub(time.mul(0.6)))
    .mul(0.5)
    .add(0.5);
  const led = new THREE.MeshBasicNodeMaterial();
  led.colorNode = mix(vec3(0.55, 0.7, 1), vec3(0.95, 0.97, 1), chase).mul(
    cityGlow.mul(0.5).add(0.03),
  );
  led.positionNode = turning;
  const steel = new THREE.MeshBasicNodeMaterial();
  const lift = smoothstep(spot.y + spot.height, spot.y, positionLocal.y);
  steel.colorNode = vec3(0.56, 0.63, 0.74).mul(
    cityGlow.mul(lift.mul(0.16).add(0.07)).add(0.02),
  );
  const group = new THREE.Group();
  group.name = "landmark_wheel";
  const parts = [
    new THREE.Mesh(
      rim.geometry(),
      wheelPaint([0.62, 0.7, 0.84], 0.17, turning),
    ),
    new THREE.Mesh(
      cables.geometry(),
      wheelPaint([0.6, 0.65, 0.74], 0.1, turning),
    ),
    new THREE.Mesh(leds.geometry(), led),
    cabins,
    new THREE.Mesh(frame.geometry(), steel),
  ];
  group.add(...parts);
  return group;
}

function balloonMesh(spot: BalloonSpot): THREE.Object3D {
  const radius = spot.height * 0.3;
  const profile: THREE.Vector2[] = [];
  for (let k = 0; k <= 24; k++) {
    const t = k / 24;
    const angle = -Math.PI / 2 + t * Math.PI;
    const r =
      Math.cos(angle) *
      radius *
      (angle < 0 ? 0.75 + 0.25 * (1 + Math.sin(angle)) : 1);
    profile.push(
      new THREE.Vector2(
        Math.max(0.01, r),
        Math.sin(angle) * radius * (angle < 0 ? 1.35 : 1),
      ),
    );
  }
  const envelope = new THREE.Mesh(
    new THREE.LatheGeometry(profile, 48),
    balloonMaterial(),
  );
  envelope.position.set(spot.x, spot.y + spot.height - radius, spot.z);
  const basket = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.22, radius * 0.18, radius * 0.3, 16),
    darkMaterial(0.35),
  );
  basket.position.set(spot.x, spot.y + spot.height - radius * 2.6, spot.z);
  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(1.2, 1.6, spot.height - radius * 2.6, 12),
    darkMaterial(0.3),
  );
  mast.position.set(spot.x, spot.y + (spot.height - radius * 2.6) / 2, spot.z);
  const group = new THREE.Group();
  group.name = "landmark_balloon";
  group.add(envelope, basket, mast);
  return group;
}

function balloonMaterial(): THREE.MeshStandardNodeMaterial {
  const material = new THREE.MeshStandardNodeMaterial();
  const around = atan(positionLocal.z, positionLocal.x)
    .div(Math.PI * 2)
    .add(0.5);
  const rib = smoothstep(0.06, 0.02, abs(fract(around.mul(16)).sub(0.5)));
  const band = smoothstep(0.08, 0.06, abs(positionLocal.y.div(20).sub(0.05)));
  const colour = mix(
    mix(vec3(0.03, 0.08, 0.32), vec3(0.9, 0.72, 0.36), rib),
    vec3(0.95, 0.85, 0.5),
    band,
  );
  material.colorNode = colour;
  material.roughnessNode = float(0.5);
  material.emissiveNode = colour.mul(cityGlow.mul(0.55));
  return material;
}

export function buildLandmarks(
  landmarks: Landmarks | undefined,
  screens: THREE.Texture,
): THREE.Object3D {
  const group = new THREE.Group();
  group.name = "landmarks";
  if (!landmarks) return group;
  if (landmarks.globe) group.add(ledGlobe(landmarks.globe, screens));
  if (landmarks.tower) group.add(towerMesh(landmarks.tower));
  if (landmarks.wheel) group.add(wheelMesh(landmarks.wheel));
  if (landmarks.balloon) group.add(balloonMesh(landmarks.balloon));
  return group;
}
