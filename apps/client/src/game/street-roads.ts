import * as THREE from "three/webgpu";
import {
  abs,
  clamp,
  exp,
  float,
  floor,
  fract,
  fwidth,
  max,
  min,
  mix,
  mx_noise_float,
  smoothstep,
  step,
  time,
  uv,
  vec3,
} from "three/tsl";
import { geometryOf } from "./street-shell.ts";

export interface Ground {
  x: number;
  z: number;
  step: number;
  columns: number;
  rows: number;
  heights: number[];
}

export interface Street {
  width: number;
  line: number[];
}

interface Corner {
  x: number;
  z: number;
  u: number;
  v: number;
}

type Vertex = [number, number, number];

const streetLift = 0.08;
const depthPull = 2;
const waterLift = 0.05;
const pieceLength = 60;
const laneWidth = 3.5;
const dashPeriod = 12;
const dashShare = 0.25;
const dashHalf = 0.07;
const edgeHalf = 0.08;
const edgeInset = 0.45;
const edgeMin = 6.9;
const endClear = 6;
const endFade = 8;
const asphaltTone = 0.04;
const paintTone = 0.5;
const wearShade = 0.12;
const wearReach = 0.45;
const lampGap = 36;
const lampReach = 9;
const poolGain = 1;
const fillGain = 0.25;
const paintPool = 0.35;
const paintFill = 0.06;
const lampTint = vec3(1, 0.86, 0.66);
const waterColour = vec3(0.004, 0.007, 0.011);
const waterGlint = 0.16;
const waterFill = vec3(0.008, 0.016, 0.026);

function cross(ax: number, az: number, bx: number, bz: number): number {
  return ax * bz - az * bx;
}

function between(a: Corner, b: Corner, t: number): Corner {
  return {
    x: a.x + (b.x - a.x) * t,
    z: a.z + (b.z - a.z) * t,
    u: a.u + (b.u - a.u) * t,
    v: a.v + (b.v - a.v) * t,
  };
}

function clipEdge(
  polygon: Corner[],
  from: Vertex,
  to: Vertex,
  sign: number,
): Corner[] {
  const side = (p: Corner) =>
    sign *
    cross(to[0] - from[0], to[2] - from[2], p.x - from[0], p.z - from[2]);
  const out: Corner[] = [];
  polygon.forEach((current, i) => {
    const previous = polygon[(i + polygon.length - 1) % polygon.length];
    if (!previous) return;
    const now = side(current);
    const before = side(previous);
    if (now >= 0 !== before >= 0)
      out.push(between(previous, current, before / (before - now)));
    if (now >= 0) out.push(current);
  });
  return out;
}

function twice(polygon: Corner[]): number {
  return polygon.reduce((sum, a, i) => {
    const b = polygon[(i + 1) % polygon.length] ?? a;
    return sum + cross(a.x, a.z, b.x, b.z);
  }, 0);
}

function convex(polygon: Corner[]): boolean {
  const turns = polygon.map((a, i) => {
    const b = polygon[(i + 1) % polygon.length] ?? a;
    const c = polygon[(i + 2) % polygon.length] ?? a;
    return Math.sign(cross(b.x - a.x, b.z - a.z, c.x - b.x, c.z - b.z));
  });
  return turns.every((turn) => turn >= 0) || turns.every((turn) => turn <= 0);
}

function upward(polygon: Corner[]): Corner[] {
  return twice(polygon) <= 0 ? polygon : [...polygon].reverse();
}

class Drape {
  readonly position: number[] = [];
  readonly normal: number[] = [];
  readonly uv: number[] = [];
  readonly uv1: number[] = [];
  readonly index: number[] = [];

  constructor(
    private readonly ground: Ground,
    private readonly lift: number,
  ) {}

  lay(polygon: Corner[], extra: [number, number]): void {
    const [a, b, c, d] = polygon;
    if (a && b && c && d && !convex(polygon)) {
      this.lay([a, b, c], extra);
      this.lay([a, c, d], extra);
      return;
    }
    const g = this.ground;
    const xs = polygon.map((p) => p.x);
    const zs = polygon.map((p) => p.z);
    const c0 = Math.max(0, Math.floor((Math.min(...xs) - g.x) / g.step));
    const c1 = Math.min(
      g.columns - 2,
      Math.floor((Math.max(...xs) - g.x) / g.step),
    );
    const r0 = Math.max(0, Math.floor((g.z - Math.max(...zs)) / g.step));
    const r1 = Math.min(
      g.rows - 2,
      Math.floor((g.z - Math.min(...zs)) / g.step),
    );
    const facing = upward(polygon);
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        const a = this.corner(r, c);
        const b = this.corner(r + 1, c);
        const d = this.corner(r + 1, c + 1);
        const e = this.corner(r, c + 1);
        this.piece(facing, [a, b, d], extra);
        this.piece(facing, [a, d, e], extra);
      }
  }

  geometry(): THREE.BufferGeometry {
    return geometryOf(
      {
        position: [this.position, 3],
        normal: [this.normal, 3],
        uv: [this.uv, 2],
        uv1: [this.uv1, 2],
      },
      this.index,
    );
  }

  private corner(r: number, c: number): Vertex {
    const g = this.ground;
    return [
      g.x + c * g.step,
      g.heights[r * g.columns + c] ?? 0,
      g.z - r * g.step,
    ];
  }

  private piece(
    shape: Corner[],
    plane: [Vertex, Vertex, Vertex],
    extra: [number, number],
  ): void {
    const [p, q, s] = plane;
    const sign = Math.sign(
      cross(q[0] - p[0], q[2] - p[2], s[0] - p[0], s[2] - p[2]),
    );
    let polygon = shape;
    for (let k = 0; k < 3 && polygon.length > 0; k++)
      polygon = clipEdge(polygon, plane[k] ?? p, plane[(k + 1) % 3] ?? p, sign);
    if (polygon.length < 3) return;
    const ux = q[0] - p[0];
    const uy = q[1] - p[1];
    const uz = q[2] - p[2];
    const vx = s[0] - p[0];
    const vy = s[1] - p[1];
    const vz = s[2] - p[2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const first = this.position.length / 3;
    for (const corner of polygon) {
      const y =
        p[1] - (nx * (corner.x - p[0]) + nz * (corner.z - p[2])) / (ny || 1);
      this.position.push(corner.x, y + this.lift, corner.z);
      this.normal.push(0, 1, 0);
      this.uv.push(corner.u, corner.v);
      this.uv1.push(...extra);
    }
    for (let k = 1; k + 1 < polygon.length; k++)
      this.index.push(first, first + k, first + k + 1);
  }
}

function pointsOf(line: number[]): THREE.Vector2[] {
  const points: THREE.Vector2[] = [];
  for (let i = 0; i + 1 < line.length; i += 2) {
    const next = new THREE.Vector2(line[i] ?? 0, line[i + 1] ?? 0);
    const last = points[points.length - 1];
    if (!last) {
      points.push(next);
      continue;
    }
    const pieces = Math.ceil(last.distanceTo(next) / pieceLength);
    if (pieces < 1) continue;
    for (let k = 1; k <= pieces; k++)
      points.push(last.clone().lerp(next, k / pieces));
  }
  return points;
}

function layStreet(drape: Drape, street: Street): void {
  const points = pointsOf(street.line);
  if (points.length < 2) return;
  const along = [0];
  points.forEach((p, i) => {
    const before = points[i - 1];
    if (before) along.push((along[i - 1] ?? 0) + before.distanceTo(p));
  });
  const total = along[along.length - 1] ?? 0;
  const half = street.width / 2;
  const sides = points.map((p, i) => {
    const before = points[Math.max(0, i - 1)] ?? p;
    const after = points[Math.min(points.length - 1, i + 1)] ?? p;
    const tx = after.x - before.x;
    const tz = after.y - before.y;
    const size = Math.hypot(tx, tz) || 1;
    const nx = -tz / size;
    const nz = tx / size;
    const v = along[i] ?? 0;
    return {
      left: { x: p.x + nx * half, z: p.y + nz * half, u: half, v },
      right: { x: p.x - nx * half, z: p.y - nz * half, u: -half, v },
    };
  });
  const extra: [number, number] = [street.width, total];
  sides.forEach((a, i) => {
    const b = sides[i + 1];
    if (!b) return;
    drape.lay([a.right, a.left, b.left, b.right], extra);
  });
}

function paintCover(
  distance: THREE.Node<"float">,
  half: number,
  blur: THREE.Node<"float">,
): THREE.Node<"float"> {
  return smoothstep(
    blur.add(half),
    max(float(half).sub(blur), 0),
    distance,
  ).mul(min(float(1), float(half * 2).div(blur)));
}

function streetMaterial(
  glow: THREE.Node<"float">,
): THREE.MeshStandardNodeMaterial {
  const material = new THREE.MeshStandardNodeMaterial({
    polygonOffset: true,
    polygonOffsetFactor: depthPull,
    polygonOffsetUnits: depthPull * 4,
  });
  const across = uv().x;
  const along = uv().y;
  const width = uv(1).x;
  const total = uv(1).y;
  const half = width.mul(0.5);
  const lanes = max(float(1), floor(width.div(laneWidth).add(0.5)));
  const lane = width.div(lanes);
  const k = across.add(half).div(lane);
  const blur = fwidth(across).max(0.001);
  const boundary = abs(fract(k.add(0.5)).sub(0.5)).mul(lane);
  const inner = step(0.5, k).mul(step(k, lanes.sub(0.5)));
  const dash = step(fract(along.div(dashPeriod)), dashShare);
  const edge = abs(abs(across).sub(half.sub(edgeInset)));
  const ends = smoothstep(
    endClear,
    endClear + endFade,
    min(along, total.sub(along)),
  );
  const paint = max(
    paintCover(boundary, dashHalf, blur).mul(inner).mul(dash),
    paintCover(edge, edgeHalf, blur).mul(step(edgeMin, width)),
  ).mul(ends);
  const position = fract(k).mul(lane);
  const wear = exp(
    position.sub(lane.mul(0.3)).div(wearReach).pow(2).negate(),
  ).add(exp(position.sub(lane.mul(0.7)).div(wearReach).pow(2).negate()));
  const grain = mx_noise_float(
    vec3(across.mul(0.8), along.mul(0.08), total.mul(0.013)),
  );
  const asphalt = float(asphaltTone)
    .mul(grain.mul(0.18).add(1))
    .mul(float(1).sub(wear.mul(wearShade)));
  const colour = mix(vec3(asphalt), vec3(paintTone), paint);
  const lamp = fract(along.add(total.mul(0.37)).div(lampGap))
    .sub(0.5)
    .mul(lampGap / lampReach);
  const pool = exp(lamp.mul(lamp).mul(-0.5));
  material.colorNode = colour;
  material.roughnessNode = mix(float(0.9), float(0.6), paint);
  const lit = mix(
    asphalt.mul(pool.mul(poolGain).add(fillGain)),
    float(paintTone).mul(pool.mul(paintPool).add(paintFill)),
    paint,
  );
  material.emissiveNode = lampTint.mul(lit).mul(glow);
  return material;
}

export function streetMesh(
  streets: Street[],
  ground: Ground,
  glow: THREE.Node<"float">,
): THREE.Mesh {
  const drape = new Drape(ground, streetLift);
  for (const street of streets) layStreet(drape, street);
  const mesh = new THREE.Mesh(drape.geometry(), streetMaterial(glow));
  mesh.name = "city_streets";
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  return mesh;
}

function waterMaterial(glow: THREE.Node<"float">): THREE.MeshBasicNodeMaterial {
  const material = new THREE.MeshBasicNodeMaterial({
    polygonOffset: true,
    polygonOffsetFactor: depthPull,
    polygonOffsetUnits: depthPull * 4,
  });
  const ripple = mx_noise_float(
    vec3(uv().x.mul(0.35), uv().y.mul(0.35), time.mul(0.15)),
  );
  const glint = smoothstep(0.45, 0.85, ripple);
  material.colorNode = waterColour.add(
    lampTint
      .mul(glint.mul(waterGlint))
      .add(waterFill)
      .mul(clamp(glow, 0, 1)),
  );
  return material;
}

export function waterMesh(
  ponds: number[][],
  ground: Ground,
  glow: THREE.Node<"float">,
): THREE.Mesh {
  const drape = new Drape(ground, waterLift);
  for (const ring of ponds) {
    const contour: THREE.Vector2[] = [];
    for (let i = 0; i + 1 < ring.length; i += 2)
      contour.push(new THREE.Vector2(ring[i] ?? 0, ring[i + 1] ?? 0));
    if (contour.length < 3) continue;
    const corner = (p: THREE.Vector2): Corner => ({
      x: p.x,
      z: p.y,
      u: p.x,
      v: p.y,
    });
    for (const face of THREE.ShapeUtils.triangulateShape(contour, [])) {
      const triangle = face.map((k) => contour[k]);
      if (triangle.some((p) => !p)) continue;
      drape.lay(
        triangle.map((p) => corner(p ?? new THREE.Vector2())),
        [0, 0],
      );
    }
  }
  const mesh = new THREE.Mesh(drape.geometry(), waterMaterial(glow));
  mesh.name = "city_water";
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  return mesh;
}
