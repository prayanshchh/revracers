import * as THREE from "three/webgpu";
import { float, positionWorld, texture, uniform, vec2, vec3 } from "three/tsl";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export interface TrackPoint {
  x: number;
  y: number;
  z: number;
  wallLeft: number;
  wallRight: number;
}

export interface PitSpan {
  entry: number;
  exit: number;
  side?: string;
}

export interface Pole {
  base: THREE.Vector3;
  head: THREE.Vector3;
  aim: THREE.Vector3;
  power: number;
  reach?: number;
}

export interface FloodMap {
  data: Float32Array;
  width: number;
  height: number;
  originX: number;
  originY: number;
  texel: number;
}

export interface MastStyle {
  spacing: number;
  clearance: number;
  farthest: number;
  baseHeight: number;
  heightPerMetre: number;
  tallest: number;
  brightest: number;
  headWidth: number;
  headHeight: number;
  lampColumns: number;
  lampRows: number;
  lampSize: number;
  lampPeak: number;
  metal: number;
  spill: number;
  floor: number;
  wash?: number;
  washNear?: number;
  washFar?: number;
}

export const parkMasts: MastStyle = {
  spacing: 50,
  clearance: 3.5,
  farthest: Infinity,
  baseHeight: 21,
  heightPerMetre: 0.22,
  tallest: 34,
  brightest: 3,
  headWidth: 3.6,
  headHeight: 1.9,
  lampColumns: 4,
  lampRows: 2,
  lampSize: 0.74,
  lampPeak: 60,
  metal: 0x5a5d60,
  spill: 0,
  floor: 0,
};

const buried = 6;
const aimBeyond = 2.5;
const beamInner = Math.cos((40 * Math.PI) / 180);
const beamOuter = Math.cos((78 * Math.PI) / 180);
const reach = 150;
const margin = 160;
const texelTarget = 0.8;
const largestMap = 2048;
const poleRadius = 0.2;
const headDepth = 0.35;
const lampColour = new THREE.Color(1, 0.96, 0.9);
const washTail = 3;

function lengths(points: TrackPoint[]): number[] {
  const along = [0];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (!a || !b) break;
    along.push((along[i - 1] ?? 0) + Math.hypot(b.x - a.x, b.z - a.z));
  }
  return along;
}

function inPit(distance: number, pit: PitSpan | null): boolean {
  if (!pit) return false;
  return pit.entry > pit.exit
    ? distance >= pit.entry || distance <= pit.exit
    : distance >= pit.entry && distance <= pit.exit;
}

function poleAt(
  points: TrackPoint[],
  index: number,
  side: 1 | -1,
  style: MastStyle,
): Pole | null {
  const point = points[index];
  const before = points[Math.max(0, index - 1)];
  const after = points[Math.min(points.length - 1, index + 1)];
  if (!point || !before || !after) return null;
  const tx = after.x - before.x;
  const tz = after.z - before.z;
  const length = Math.hypot(tx, tz);
  if (length === 0) return null;
  const nx = (tz / length) * side;
  const nz = (-tx / length) * side;
  const wall = side === 1 ? point.wallLeft : point.wallRight;
  const lateral = Math.min(wall + style.clearance, style.farthest);
  const height = Math.min(
    style.tallest,
    style.baseHeight + style.heightPerMetre * lateral,
  );
  const x = point.x + nx * lateral;
  const z = point.z + nz * lateral;
  const aim = new THREE.Vector3(
    point.x - nx * aimBeyond,
    point.y,
    point.z - nz * aimBeyond,
  );
  const head = new THREE.Vector3(x, point.y + height, z);
  return {
    base: new THREE.Vector3(x, point.y - buried, z),
    head,
    aim,
    power: head.distanceToSquared(aim),
  };
}

function nearest(along: number[], distance: number): number {
  let low = 0;
  let high = along.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((along[middle] ?? 0) < distance) low = middle + 1;
    else high = middle;
  }
  return low;
}

function sideClearOfPit(
  side: 1 | -1,
  distance: number,
  pit: PitSpan | null,
): 1 | -1 {
  const pitSide = pit?.side === "right" ? -1 : 1;
  if (side !== pitSide || !inPit(distance, pit)) return side;
  return side === 1 ? -1 : 1;
}

export const desertMasts: MastStyle = {
  spacing: 26,
  clearance: 4,
  farthest: 30,
  baseHeight: 25,
  heightPerMetre: 0.1,
  tallest: 30,
  brightest: 1.8,
  headWidth: 5.2,
  headHeight: 0.9,
  lampColumns: 7,
  lampRows: 1,
  lampSize: 0.5,
  lampPeak: 24,
  metal: 0xb4b8bc,
  spill: 0.4,
  floor: 0.012,
  wash: 0.8,
  washNear: 38,
  washFar: 190,
};

export function layoutPoles(
  points: TrackPoint[],
  pit: PitSpan | null,
  style: MastStyle = parkMasts,
): Pole[] {
  const along = lengths(points);
  const lap = along[along.length - 1] ?? 0;
  const count = Math.max(1, Math.round(lap / style.spacing));
  const step = lap / count;
  const poles: Pole[] = [];
  for (let k = 0; k < count; k++)
    for (const side of [1, -1] as const) {
      const distance = (k + (side === 1 ? 0 : 0.5)) * step;
      const placed = sideClearOfPit(side, distance, pit);
      const pole = poleAt(points, nearest(along, distance), placed, style);
      if (pole) poles.push(pole);
    }
  return poles;
}

function beam(cosine: number): number {
  const t = Math.min(
    1,
    Math.max(0, (cosine - beamOuter) / (beamInner - beamOuter)),
  );
  return t * t * (3 - 2 * t);
}

export function inWorld(poles: Pole[], toWorld: THREE.Matrix4): Pole[] {
  return poles.map((pole) => ({
    base: pole.base.clone().applyMatrix4(toWorld),
    head: pole.head.clone().applyMatrix4(toWorld),
    aim: pole.aim.clone().applyMatrix4(toWorld),
    power: pole.power,
    ...(pole.reach === undefined ? {} : { reach: pole.reach }),
  }));
}

export function sampleFlood(map: FloodMap, x: number, y: number): number {
  const column = Math.floor((x - map.originX) / map.texel);
  const row = Math.floor((y - map.originY) / map.texel);
  if (column < 0 || row < 0 || column >= map.width || row >= map.height)
    return 0;
  return map.data[row * map.width + column] ?? 0;
}

interface Wash {
  level: number;
  near: number;
  far: number;
}

const forwardSteps: [number, number, number][] = [
  [0, -1, 1],
  [-1, 0, 1],
  [-1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
];
const backwardSteps: [number, number, number][] = forwardSteps.map(
  ([dr, dc, cost]) => [-dr, -dc, cost],
);

function seeded(track: THREE.Vector3[], grid: Grid): Float32Array {
  const { width, height, originX, originY, texel } = grid;
  const field = new Float32Array(width * height).fill(Infinity);
  for (const p of track) {
    const column = Math.floor((p.x - originX) / texel);
    const row = Math.floor((p.y - originY) / texel);
    if (column >= 0 && row >= 0 && column < width && row < height)
      field[row * width + column] = 0;
  }
  return field;
}

function chamfer(
  field: Float32Array,
  grid: Grid,
  steps: [number, number, number][],
  reverse: boolean,
): void {
  const { width } = grid;
  const total = width * grid.height;
  for (let k = 0; k < total; k++) {
    const index = reverse ? total - 1 - k : k;
    const row = Math.floor(index / width);
    const column = index - row * width;
    for (const [dr, dc, cost] of steps)
      relax(field, grid, index, row + dr, column + dc, cost);
  }
}

function relax(
  field: Float32Array,
  grid: Grid,
  index: number,
  row: number,
  column: number,
  cost: number,
): void {
  if (row < 0 || column < 0 || row >= grid.height || column >= grid.width)
    return;
  const through = (field[row * grid.width + column] ?? Infinity) + cost;
  if (through < (field[index] ?? Infinity)) field[index] = through;
}

function distances(track: THREE.Vector3[], grid: Grid): Float32Array {
  const field = seeded(track, grid);
  chamfer(field, grid, forwardSteps, false);
  chamfer(field, grid, backwardSteps, true);
  for (let i = 0; i < field.length; i++)
    field[i] = (field[i] ?? 0) * grid.texel;
  return field;
}

function washed(
  data: Float32Array,
  track: THREE.Vector3[],
  grid: Grid,
  wash: Wash,
): void {
  const field = distances(track, grid);
  const decay = (wash.far - wash.near) / washTail;
  for (let i = 0; i < data.length; i++) {
    const beyond = Math.max(0, (field[i] ?? Infinity) - wash.near);
    const level = wash.level * Math.exp(-beyond / decay);
    if (level > (data[i] ?? 0)) data[i] = level;
  }
}

export function floodMap(
  track: THREE.Vector3[],
  lamps: Pole[],
  brightest = parkMasts.brightest,
  spill = parkMasts.spill,
  floor = parkMasts.floor,
  wash: Wash | null = null,
): FloodMap {
  const local = lamps.filter((lamp) => lamp.reach !== undefined);
  const lows = (axis: "x" | "y") => [
    Math.min(...track.map((p) => p[axis])) - margin,
    ...local.map((lamp) => lamp.head[axis] - (lamp.reach ?? 0)),
  ];
  const highs = (axis: "x" | "y") => [
    Math.max(...track.map((p) => p[axis])) + margin,
    ...local.map((lamp) => lamp.head[axis] + (lamp.reach ?? 0)),
  ];
  const originX = Math.min(...lows("x"));
  const originY = Math.min(...lows("y"));
  const spanX = Math.max(...highs("x")) - originX;
  const spanY = Math.max(...highs("y")) - originY;
  const texel = Math.max(texelTarget, Math.max(spanX, spanY) / largestMap);
  const width = Math.ceil(spanX / texel);
  const height = Math.ceil(spanY / texel);
  const data = new Float32Array(width * height);
  const levels = track
    .filter((_, i) => i % 5 === 0)
    .map((p) => worldLight(lamps, p.x, p.y, p.z, spill))
    .sort((a, b) => a - b);
  const median = levels[Math.floor(levels.length / 2)] ?? 1;
  for (const lamp of lamps)
    addLamp(data, lamp, { width, height, originX, originY, texel }, spill);
  for (let i = 0; i < data.length; i++)
    data[i] = Math.min(brightest, Math.max(floor, (data[i] ?? 0) / median));
  const grid = { width, height, originX, originY, texel };
  if (wash) washed(data, track, grid, wash);
  return { data, ...grid };
}

interface Grid {
  width: number;
  height: number;
  originX: number;
  originY: number;
  texel: number;
}

function rangeOf(lamp: Pole): number {
  return lamp.reach ?? reach;
}

function addLamp(
  data: Float32Array,
  lamp: Pole,
  grid: Grid,
  spill: number,
): void {
  const { width, height, originX, originY, texel } = grid;
  const hx = lamp.head.x;
  const hy = lamp.head.y;
  const dz = lamp.aim.z - lamp.head.z;
  if (dz >= 0) return;
  const ax = lamp.aim.x - hx;
  const ay = lamp.aim.y - hy;
  const axis = Math.sqrt(ax * ax + ay * ay + dz * dz);
  const ux = ax / axis;
  const uy = ay / axis;
  const uz = dz / axis;
  const power = lamp.power;
  const span = beamInner - beamOuter;
  const range = rangeOf(lamp);
  const fromRow = Math.max(0, Math.floor((hy - range - originY) / texel));
  const toRow = Math.min(height - 1, Math.ceil((hy + range - originY) / texel));
  for (let row = fromRow; row <= toRow; row++) {
    const dy = originY + (row + 0.5) * texel - hy;
    const left = range * range - dy * dy - dz * dz;
    if (left <= 0) continue;
    const across = Math.sqrt(left);
    const fromColumn = Math.max(0, Math.floor((hx - across - originX) / texel));
    const toColumn = Math.min(
      width - 1,
      Math.ceil((hx + across - originX) / texel),
    );
    const rowBase = row * width;
    const partial = dy * dy + dz * dz;
    const facingY = dy * uy + dz * uz;
    for (let column = fromColumn; column <= toColumn; column++) {
      const dx = originX + (column + 0.5) * texel - hx;
      const squared = dx * dx + partial;
      const distance = Math.sqrt(squared);
      const t = ((dx * ux + facingY) / distance - beamOuter) / span;
      if (t <= 0 && spill <= 0) continue;
      const b = Math.max(spill, t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
      data[rowBase + column] =
        (data[rowBase + column] ?? 0) +
        (power * (-dz / distance) * b) / squared;
    }
  }
}

function worldLight(
  poles: Pole[],
  x: number,
  y: number,
  z: number,
  spill: number,
): number {
  return poles.reduce((sum, pole) => sum + worldLamp(pole, x, y, z, spill), 0);
}

function worldLamp(
  pole: Pole,
  x: number,
  y: number,
  z: number,
  spill: number,
): number {
  const dx = x - pole.head.x;
  const dy = y - pole.head.y;
  const dz = z - pole.head.z;
  const squared = dx * dx + dy * dy + dz * dz;
  const range = rangeOf(pole);
  if (squared > range * range || dz >= 0) return 0;
  const distance = Math.sqrt(squared);
  const ax = pole.aim.x - pole.head.x;
  const ay = pole.aim.y - pole.head.y;
  const az = pole.aim.z - pole.head.z;
  const axis = Math.hypot(ax, ay, az);
  const facing = (dx * ax + dy * ay + dz * az) / (distance * axis);
  return (
    (pole.power * (-dz / distance) * Math.max(spill, beam(facing))) / squared
  );
}

function lampGeometry(style: MastStyle): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const { lampColumns, lampRows, headWidth, headHeight, lampSize } = style;
  for (let row = 0; row < lampRows; row++)
    for (let column = 0; column < lampColumns; column++) {
      const plane = new THREE.PlaneGeometry(lampSize, lampSize);
      plane.translate(
        (column - (lampColumns - 1) / 2) * (headWidth / lampColumns),
        (row - (lampRows - 1) / 2) * (headHeight / lampRows),
        headDepth / 2 + 0.01,
      );
      parts.push(plane);
    }
  return mergeGeometries(parts);
}

export class Floodlights {
  readonly root = new THREE.Group();
  placed: THREE.Object3D | null = null;
  readonly glow = uniform(0);
  readonly cover: THREE.Node<"float">;
  private readonly map: THREE.DataTexture;

  constructor(
    poles: Pole[],
    flood: FloodMap,
    private readonly style: MastStyle = parkMasts,
  ) {
    const half = new Uint16Array(flood.data.length);
    for (let i = 0; i < half.length; i++)
      half[i] = THREE.DataUtils.toHalfFloat(flood.data[i] ?? 0);
    this.map = new THREE.DataTexture(
      half,
      flood.width,
      flood.height,
      THREE.RedFormat,
      THREE.HalfFloatType,
    );
    this.map.minFilter = THREE.LinearFilter;
    this.map.magFilter = THREE.LinearFilter;
    this.map.generateMipmaps = false;
    this.map.needsUpdate = true;
    const size = vec2(flood.width * flood.texel, flood.height * flood.texel);
    const at = positionWorld.xy
      .sub(vec2(flood.originX, flood.originY))
      .div(size);
    this.cover = texture(this.map, at).r;
    this.root.add(...this.meshes(poles));
  }

  private meshes(poles: Pole[]): THREE.Mesh[] {
    const { style } = this;
    const metal = new THREE.MeshStandardNodeMaterial({
      color: style.metal,
      roughness: 0.55,
      metalness: 0.7,
    });
    const lamp = new THREE.MeshBasicNodeMaterial();
    lamp.colorNode = vec3(lampColour.r, lampColour.g, lampColour.b).mul(
      float(style.lampPeak).mul(this.glow).add(0.04),
    );
    const pole = new THREE.CylinderGeometry(poleRadius, poleRadius * 1.5, 1, 8);
    pole.translate(0, 0.5, 0);
    const head = new THREE.BoxGeometry(
      style.headWidth,
      style.headHeight,
      headDepth,
    );
    const poleMesh = new THREE.InstancedMesh(pole, metal, poles.length);
    const headMesh = new THREE.InstancedMesh(head, metal, poles.length);
    const lampMesh = new THREE.InstancedMesh(
      lampGeometry(style),
      lamp,
      poles.length,
    );
    const matrix = new THREE.Matrix4();
    const look = new THREE.Matrix4();
    const up = new THREE.Vector3(0, 1, 0);
    poles.forEach((p, i) => {
      matrix.makeScale(1, p.head.y - p.base.y, 1).setPosition(p.base);
      poleMesh.setMatrixAt(i, matrix);
      look.lookAt(p.aim, p.head, up).setPosition(p.head);
      headMesh.setMatrixAt(i, look);
      lampMesh.setMatrixAt(i, look);
    });
    for (const mesh of [poleMesh, headMesh, lampMesh]) {
      mesh.computeBoundingSphere();
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
    }
    return [poleMesh, headMesh, lampMesh];
  }
}
