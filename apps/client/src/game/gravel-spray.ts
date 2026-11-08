import * as THREE from "three/webgpu";
import {
  float,
  instancedBufferAttribute,
  length,
  smoothstep,
  uv,
  vec3,
  vec4,
} from "three/tsl";
import { keepMirrorMask } from "./mirror-mask.ts";

export const grassSurface = 2;
const gravelSurface = 3;

const stoneCapacity = 900;
const dustCapacity = 240;
const gravity = 9.81;
const emitSpeed = 2.5;
const stoneRate = 16;
const stoneRatePerSpeed = 3;
const clippingShare = 0.45;
const clippingScale = 0.45;
const dustRate = 5;
const dustRatePerSpeed = 0.45;
const grassDustShare = 0.3;
const carryLow = 0.2;
const carryHigh = 0.75;
const spinThrowLow = 0.3;
const spinThrowHigh = 0.8;
const sideSpread = 0.8;
const sideSpreadPerSpeed = 0.06;
const liftLow = 1;
const liftHigh = 3.5;
const liftPerSpeed = 0.08;
const stoneSizeLow = 0.008;
const stoneSizeHigh = 0.022;
const bounce = 0.3;
const skid = 0.55;
const settleSpeed = 1.1;
const restSeconds = 7;
const fadeSeconds = 1;
const flightSeconds = 4;
const airDrag = 0.15;
const tumble = 18;
const dustStart = 0.4;
const dustPeakLow = 2.2;
const dustPeakHigh = 3.6;
const dustLifeLow = 1.6;
const dustLifeHigh = 2.8;
const dustCarry = 0.25;
const dustRise = 0.4;
const dustDrift = 0.6;
const dustAlpha = 0.2;
const grassDustAlpha = 0.12;
const contactBehind = 0.2;
const contactSpread = 0.12;

const gravelTones = [
  [0.46, 0.42, 0.36],
  [0.36, 0.33, 0.29],
  [0.55, 0.51, 0.44],
  [0.3, 0.27, 0.23],
  [0.43, 0.38, 0.3],
] as const;
const clippingTones = [
  [0.16, 0.22, 0.06],
  [0.24, 0.27, 0.09],
  [0.3, 0.26, 0.14],
] as const;
const gravelDust = new THREE.Color(0.66, 0.6, 0.5);
const grassDust = new THREE.Color(0.42, 0.39, 0.3);

export interface WheelContact {
  x: number;
  y: number;
  z: number;
  surface: number;
  slip: number;
}

export interface CarMotion {
  vx: number;
  vy: number;
  vz: number;
  fx: number;
  fy: number;
}

const random = (low: number, high: number) =>
  low + Math.random() * (high - low);

function rockGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.IcosahedronGeometry(1, 0);
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  const seen = new Map<string, number>();
  for (let i = 0; i < position.count; i++) {
    const key = [position.getX(i), position.getY(i), position.getZ(i)]
      .map((v) => v.toFixed(3))
      .join(",");
    const scale = seen.get(key) ?? 0.72 + (((i * 7919) % 97) / 97) * 0.5;
    seen.set(key, scale);
    position.setXYZ(
      i,
      position.getX(i) * scale,
      position.getY(i) * scale * 0.7,
      position.getZ(i) * scale,
    );
  }
  geometry.computeVertexNormals();
  return geometry;
}

export function rockMaterial(): THREE.MeshStandardNodeMaterial {
  return new THREE.MeshStandardNodeMaterial({ roughness: 0.82 });
}

export const pebble = rockGeometry();

interface Stone {
  live: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  ground: number;
  size: number;
  age: number;
  rest: number;
  axis: THREE.Vector3;
  turn: number;
}

interface Puff {
  age: number;
  life: number;
  peak: number;
  alpha: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

export interface Fling {
  x: number;
  y: number;
  z: number;
  ground: number;
  vx: number;
  vy: number;
  vz: number;
  size: number;
  tone: readonly number[];
}

interface Source {
  key: string;
  motion: CarMotion;
  wheels: WheelContact[];
}

function newStone(): Stone {
  return {
    live: false,
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    ground: 0,
    size: 0,
    age: 0,
    rest: -1,
    axis: new THREE.Vector3(0, 0, 1),
    turn: 0,
  };
}

function newPuff(): Puff {
  return {
    age: 0,
    life: 0,
    peak: 0,
    alpha: 0,
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
  };
}

function landStone(stone: Stone): void {
  const floor = stone.ground + stone.size * 0.4;
  if (stone.z >= floor) return;
  stone.z = floor;
  if (Math.abs(stone.vz) < settleSpeed) {
    stone.rest = 0;
    stone.vx = 0;
    stone.vy = 0;
    stone.vz = 0;
    return;
  }
  stone.vz = -stone.vz * bounce;
  stone.vx *= skid;
  stone.vy *= skid;
}

function flyStone(stone: Stone, dt: number): void {
  const drag = 1 - airDrag * dt;
  stone.vx *= drag;
  stone.vy *= drag;
  stone.vz -= gravity * dt;
  stone.x += stone.vx * dt;
  stone.y += stone.vy * dt;
  stone.z += stone.vz * dt;
  stone.turn += tumble * dt;
  landStone(stone);
  if (stone.age > flightSeconds && stone.rest < 0) stone.rest = restSeconds;
}

function stoneScale(stone: Stone, dt: number): number {
  stone.age += dt;
  if (stone.rest < 0) return 1;
  stone.rest += dt;
  const left = restSeconds + fadeSeconds - stone.rest;
  if (left <= 0) stone.live = false;
  return Math.max(0, Math.min(1, left / fadeSeconds));
}

function advancePuff(puff: Puff, dt: number): boolean {
  if (puff.age >= puff.life) return false;
  puff.age += dt;
  puff.x += puff.vx * dt;
  puff.y += puff.vy * dt;
  puff.z += puff.vz * dt;
  return true;
}

export class GravelSpray {
  readonly root = new THREE.Group();
  private readonly stones: THREE.InstancedMesh;
  private readonly dust: THREE.Mesh;
  private readonly flying = Array.from({ length: stoneCapacity }, newStone);
  private readonly dustCentre: THREE.InstancedBufferAttribute;
  private readonly dustFade: THREE.InstancedBufferAttribute;
  private readonly dustTint: THREE.InstancedBufferAttribute;
  private readonly puffs = Array.from({ length: dustCapacity }, newPuff);
  private readonly owed = new Map<string, number>();
  private readonly matrix = new THREE.Matrix4();
  private readonly quaternion = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly point = new THREE.Vector3();
  private readonly colour = new THREE.Color();
  private stoneCursor = 0;
  private dustCursor = 0;
  private lastTime: number | null = null;

  constructor() {
    this.stones = new THREE.InstancedMesh(
      pebble,
      rockMaterial(),
      stoneCapacity,
    );
    this.stones.frustumCulled = false;
    this.stones.castShadow = false;
    this.stones.receiveShadow = true;
    this.matrix.makeScale(0, 0, 0);
    for (let i = 0; i < stoneCapacity; i++) {
      this.stones.setMatrixAt(i, this.matrix);
      this.stones.setColorAt(i, this.colour.setRGB(0.6, 0.56, 0.5));
    }
    this.stones.visible = false;
    this.dustCentre = new THREE.InstancedBufferAttribute(
      new Float32Array(dustCapacity * 4),
      4,
    );
    this.dustFade = new THREE.InstancedBufferAttribute(
      new Float32Array(dustCapacity),
      1,
    );
    this.dustTint = new THREE.InstancedBufferAttribute(
      new Float32Array(dustCapacity * 3),
      3,
    );
    const material = new THREE.SpriteNodeMaterial({
      transparent: true,
      depthWrite: false,
    });
    keepMirrorMask(material);
    const centre = instancedBufferAttribute(this.dustCentre, "vec4" as const);
    const fade = instancedBufferAttribute(this.dustFade, "float" as const);
    const tint = instancedBufferAttribute(this.dustTint, "vec3" as const);
    const soft = smoothstep(
      float(0.5),
      float(0.05),
      length(uv().sub(float(0.5))),
    );
    material.positionNode = vec3(centre.x, centre.y, centre.z);
    material.scaleNode = centre.w;
    material.colorNode = vec4(tint, 1);
    material.opacityNode = fade.mul(soft);
    this.dust = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      material,
      dustCapacity,
    );
    this.dust.frustumCulled = false;
    this.dust.renderOrder = 2;
    this.dust.visible = false;
    this.root.add(this.stones, this.dust);
  }

  update(time: number, sources: readonly Source[]): void {
    const dt =
      this.lastTime === null
        ? 0
        : Math.max(0, Math.min(0.1, time - this.lastTime));
    this.lastTime = time;
    if (dt <= 0) return;
    for (const source of sources) this.emit(source, dt);
    this.advanceStones(dt);
    this.advanceDust(dt);
  }

  clear(): void {
    this.flying.forEach((stone, i) => {
      stone.live = false;
      this.stones.setMatrixAt(i, this.matrix.makeScale(0, 0, 0));
    });
    for (const puff of this.puffs) puff.life = 0;
    this.owed.clear();
    this.lastTime = null;
    this.advanceStones(0);
    this.advanceDust(0);
  }

  fling(throw_: Fling): void {
    const i = this.stoneCursor;
    this.stoneCursor = (this.stoneCursor + 1) % stoneCapacity;
    const stone = this.flying[i];
    if (!stone) return;
    Object.assign(stone, {
      live: true,
      x: throw_.x,
      y: throw_.y,
      z: throw_.z,
      vx: throw_.vx,
      vy: throw_.vy,
      vz: throw_.vz,
      ground: throw_.ground,
      size: throw_.size,
      age: 0,
      rest: -1,
      turn: Math.random() * Math.PI * 2,
    });
    stone.axis.randomDirection();
    const [r = 0.6, g = 0.56, b = 0.5] = throw_.tone;
    this.stones.setColorAt(i, this.colour.setRGB(r, g, b));
    if (this.stones.instanceColor) this.stones.instanceColor.needsUpdate = true;
  }

  private owe(key: string, rate: number, dt: number): number {
    const owed = (this.owed.get(key) ?? 0) + rate * dt;
    const count = Math.floor(owed);
    this.owed.set(key, owed - count);
    return count;
  }

  private emit(source: Source, dt: number): void {
    const { motion } = source;
    const speed = Math.hypot(motion.vx, motion.vy);
    if (speed < emitSpeed) return;
    source.wheels.forEach((wheel, w) => {
      const gravel = wheel.surface === gravelSurface;
      if (!gravel && wheel.surface !== grassSurface) return;
      const key = `${source.key}:${String(w)}`;
      const share = gravel ? 1 : clippingShare;
      const stones = this.owe(
        key,
        (stoneRate + stoneRatePerSpeed * speed) * share,
        dt,
      );
      for (let k = 0; k < stones; k++)
        this.fling(throwFrom(wheel, motion, speed, gravel));
      const dust = this.owe(
        `${key}:dust`,
        (dustRate + dustRatePerSpeed * speed) * (gravel ? 1 : grassDustShare),
        dt,
      );
      for (let k = 0; k < dust; k++) this.puff(wheel, motion, gravel);
    });
  }

  private puff(wheel: WheelContact, motion: CarMotion, gravel: boolean): void {
    const i = this.dustCursor;
    this.dustCursor = (this.dustCursor + 1) % dustCapacity;
    const puff = this.puffs[i];
    if (!puff) return;
    Object.assign(puff, {
      age: 0,
      life: random(dustLifeLow, dustLifeHigh),
      peak: random(dustPeakLow, dustPeakHigh) * (gravel ? 1 : 0.7),
      alpha: gravel ? dustAlpha : grassDustAlpha,
      x: wheel.x,
      y: wheel.y,
      z: wheel.z + 0.15,
      vx: motion.vx * dustCarry + random(-dustDrift, dustDrift),
      vy: motion.vy * dustCarry + random(-dustDrift, dustDrift),
      vz: dustRise * random(0.5, 1.5),
    });
    const tint = gravel ? gravelDust : grassDust;
    this.dustTint.setXYZ(i, tint.r, tint.g, tint.b);
    this.dustTint.needsUpdate = true;
  }

  private advanceStones(dt: number): void {
    let alive = 0;
    this.flying.forEach((stone, i) => {
      if (!stone.live) return;
      const shrink = stoneScale(stone, dt);
      if (stone.rest < 0) flyStone(stone, dt);
      if (shrink <= 0) {
        this.stones.setMatrixAt(i, this.matrix.makeScale(0, 0, 0));
        return;
      }
      alive += 1;
      const size = stone.size * shrink;
      this.quaternion.setFromAxisAngle(stone.axis, stone.turn);
      this.matrix.compose(
        this.point.set(stone.x, stone.y, stone.z),
        this.quaternion,
        this.scale.set(size, size, size),
      );
      this.stones.setMatrixAt(i, this.matrix);
    });
    this.stones.visible = alive > 0;
    this.stones.instanceMatrix.needsUpdate = true;
  }

  private advanceDust(dt: number): void {
    const centre = this.dustCentre.array as Float32Array;
    const fade = this.dustFade.array as Float32Array;
    let alive = 0;
    this.puffs.forEach((puff, i) => {
      if (!advancePuff(puff, dt)) {
        centre[i * 4 + 3] = 0;
        fade[i] = 0;
        return;
      }
      alive += 1;
      const t = Math.min(1, puff.age / puff.life);
      const size = dustStart + (puff.peak - dustStart) * Math.sqrt(t);
      centre.set([puff.x, puff.y, puff.z, size], i * 4);
      fade[i] = puff.alpha * (1 - t) * Math.min(1, t * 10);
    });
    this.dust.visible = alive > 0;
    this.dustCentre.needsUpdate = alive > 0;
    this.dustFade.needsUpdate = alive > 0;
  }
}

function throwFrom(
  wheel: WheelContact,
  motion: CarMotion,
  speed: number,
  gravel: boolean,
): Fling {
  const sideX = -motion.fy;
  const sideY = motion.fx;
  const behind = random(0, contactBehind);
  const across = random(-contactSpread, contactSpread);
  const carry = random(carryLow, carryHigh);
  const thrown = Math.max(0, wheel.slip) * random(spinThrowLow, spinThrowHigh);
  const spread = random(-1, 1) * (sideSpread + sideSpreadPerSpeed * speed);
  const lift =
    random(liftLow, liftHigh) + liftPerSpeed * speed * Math.random() ** 2;
  const tones = gravel ? gravelTones : clippingTones;
  return {
    x: wheel.x - motion.fx * behind + sideX * across,
    y: wheel.y - motion.fy * behind + sideY * across,
    z: wheel.z + 0.02,
    ground: wheel.z,
    vx: motion.vx * carry - motion.fx * thrown + sideX * spread,
    vy: motion.vy * carry - motion.fy * thrown + sideY * spread,
    vz: lift * (gravel ? 1 : 0.6),
    size: random(stoneSizeLow, stoneSizeHigh) * (gravel ? 1 : clippingScale),
    tone: tones[Math.floor(Math.random() * tones.length)] ?? tones[0],
  };
}
