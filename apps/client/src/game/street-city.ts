import * as THREE from "three/webgpu";
import type { Landmarks } from "./street-landmarks.ts";
import type { Venue } from "./street-venue.ts";
import {
  float,
  floor,
  fract,
  fwidth,
  max,
  mix,
  mx_fractal_noise_float,
  mx_noise_float,
  positionLocal,
  sin,
  smoothstep,
  step,
  texture,
  time,
  uniform,
  uv,
  vec2,
  vec3,
} from "three/tsl";

interface Building {
  kind: "tower" | "podium" | "parking" | "low";
  base: number;
  height: number;
  ring: number[];
}

interface Ground {
  x: number;
  z: number;
  step: number;
  columns: number;
  rows: number;
  heights: number[];
}

export interface CityData {
  ground: Ground;
  buildings: Building[];
  monorail: number[][];
  monorailColumns: number[];
  trees: number[];
  roads: { width: number; line: number[] }[];
  bridges: { distance: number }[];
  water: number[][];
  streetTrees: number[];
  signs: Sign[];
  venue: Venue;
  landmarks?: Landmarks;
}

interface Sign {
  x: number;
  y: number;
  z: number;
  facing: number;
  width: number;
  height: number;
  lift: number;
  seed: number;
}

export const cityGlow = uniform(0);

const kindCode = { tower: 0, podium: 1, parking: 2, low: 3 } as const;
const roofFlag = 8;
const facadeShade = 0.6;
const windowShade = 0.72;
const monorailWidth = 0.9;
const monorailDepth = 1.7;
const columnHalf = 0.7;
const capDepth = 1.3;
const capHalf = 0.85;
const columnStride = 6;
const palmHeightLow = 9;
const palmHeightHigh = 15;
const palmFronds = 20;
const frondLength = 4.8;
const frondWidth = 1.7;
const frondFold = 0.35;
const trunkSegments = 7;

function hash(value: number): number {
  const x = Math.sin(value * 91.345 + 47.853) * 43758.5453;
  return x - Math.floor(x);
}

class Mesh {
  readonly position: number[] = [];
  readonly normal: number[] = [];
  readonly uv: number[] = [];
  readonly uv1: number[] = [];
  readonly uv2: number[] = [];
  readonly index: number[] = [];

  vertex(
    p: number[],
    n: number[],
    a: [number, number],
    b: [number, number],
    c: [number, number],
  ): number {
    const at = this.position.length / 3;
    this.position.push(p[0] ?? 0, p[1] ?? 0, p[2] ?? 0);
    this.normal.push(n[0] ?? 0, n[1] ?? 0, n[2] ?? 0);
    this.uv.push(...a);
    this.uv1.push(...b);
    this.uv2.push(...c);
    return at;
  }

  geometry(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(this.position, 3),
    );
    geometry.setAttribute(
      "normal",
      new THREE.Float32BufferAttribute(this.normal, 3),
    );
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    geometry.setAttribute("uv1", new THREE.Float32BufferAttribute(this.uv1, 2));
    geometry.setAttribute("uv2", new THREE.Float32BufferAttribute(this.uv2, 2));
    geometry.setIndex(this.index);
    geometry.computeBoundingSphere();
    return geometry;
  }
}

interface Facade {
  low: number;
  high: number;
  tag: [number, number];
  shape: [number, number];
  outward: number;
}

function ringOf(flat: number[]): THREE.Vector2[] {
  const ring: THREE.Vector2[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2)
    ring.push(new THREE.Vector2(Number(flat[i]), Number(flat[i + 1])));
  return ring;
}

function cornerOf(ring: THREE.Vector2[], i: number): THREE.Vector2 {
  return ring[i % ring.length] ?? new THREE.Vector2();
}

function signedArea(ring: THREE.Vector2[]): number {
  let area = 0;
  ring.forEach((a, i) => {
    const b = cornerOf(ring, i + 1);
    area += a.x * b.y - b.x * a.y;
  });
  return area / 2;
}

function addWall(
  mesh: Mesh,
  a: THREE.Vector2,
  b: THREE.Vector2,
  along: number,
  facade: Facade,
): number {
  const length = a.distanceTo(b);
  if (length < 0.05) return 0;
  const n = [
    ((a.y - b.y) / length) * facade.outward,
    0,
    ((b.x - a.x) / length) * facade.outward,
  ];
  const start = Math.round(along / 2) * 2;
  const height = facade.high - facade.low;
  const corners: [THREE.Vector2, number, number, number][] = [
    [a, facade.low, start, 0],
    [b, facade.low, start + length, 0],
    [b, facade.high, start + length, height],
    [a, facade.high, start, height],
  ];
  const first = mesh.position.length / 3;
  for (const [p, y, u, v] of corners)
    mesh.vertex([p.x, y, p.y], n, [u, v], facade.tag, facade.shape);
  mesh.index.push(first, first + 1, first + 2, first, first + 2, first + 3);
  return length;
}

function addBuilding(mesh: Mesh, building: Building, seed: number): void {
  const ring = ringOf(building.ring);
  if (ring.length < 3) return;
  const code = kindCode[building.kind];
  const facade: Facade = {
    low: building.base,
    high: building.base + building.height,
    tag: [seed, code],
    shape: [building.height, 0],
    outward: signedArea(ring) > 0 ? -1 : 1,
  };
  let along = 0;
  ring.forEach((a, i) => {
    along += addWall(mesh, a, cornerOf(ring, i + 1), along, facade);
  });
  const faces = THREE.ShapeUtils.triangulateShape(ring, []);
  const base = mesh.position.length / 3;
  for (const p of ring)
    mesh.vertex(
      [p.x, facade.high, p.y],
      [0, 1, 0],
      [p.x, p.y],
      [seed, code + roofFlag],
      facade.shape,
    );
  for (const face of faces)
    mesh.index.push(...face.map((corner) => base + corner));
}

function hashNode(p: THREE.Node<"vec2">): THREE.Node<"float"> {
  return fract(sin(p.dot(vec2(127.1, 311.7))).mul(43758.5453));
}

function windowGrid(
  u: THREE.Node<"float">,
  h: THREE.Node<"float">,
  seed: THREE.Node<"float">,
  bay: number,
  storey: number,
  wide: number,
  tall: number,
  room: number,
  share: THREE.Node<"float">,
): {
  lit: THREE.Node<"float">;
  pane: THREE.Node<"float">;
  slab: THREE.Node<"float">;
} {
  const coord = vec2(u.div(bay), h.div(storey));
  const cell = floor(coord);
  const within = fract(coord);
  const sideEdge = (1 - wide) / 2;
  const pane = smoothstep(sideEdge, sideEdge + 0.05, within.x)
    .mul(smoothstep(1 - sideEdge, 1 - sideEdge - 0.05, within.x))
    .mul(smoothstep(0.12, 0.16, within.y))
    .mul(smoothstep(0.12 + tall, 0.08 + tall, within.y));
  const roomCell = vec2(floor(cell.x.div(room)), cell.y);
  const on = step(
    hashNode(roomCell.add(vec2(seed.mul(173.3), seed.mul(41.7)))),
    share,
  );
  const level = hashNode(roomCell.add(vec2(7.3, seed.mul(13.0))))
    .mul(0.7)
    .add(0.55);
  const curtain = smoothstep(0.2, 0.9, hashNode(cell.add(vec2(seed, 2.7))))
    .mul(0.35)
    .add(0.65);
  const blur = smoothstep(0.3, 0.8, max(fwidth(coord.x), fwidth(coord.y)));
  const near = pane.mul(on).mul(level).mul(curtain);
  const far = share.mul(wide * tall).mul(0.62);
  const slab = smoothstep(0.03, 0.0, within.y)
    .add(smoothstep(0.97, 1.0, within.y))
    .min(1);
  return {
    lit: mix(near, far, blur),
    pane: mix(pane, float(wide * tall), blur),
    slab: slab.mul(float(1).sub(blur)),
  };
}

function facadeMaterial(): THREE.MeshStandardNodeMaterial {
  const material = new THREE.MeshStandardNodeMaterial({
    side: THREE.DoubleSide,
  });
  const u = uv().x;
  const h = uv().y;
  const seed = uv(1).x;
  const code = uv(1).y;
  const total = uv(2).x;
  const roof = step(roofFlag - 0.5, code);
  const kind = code.sub(roof.mul(roofFlag));
  const tower = step(kind, 0.5);
  const podium = step(0.5, kind).mul(step(kind, 1.5));
  const parking = step(1.5, kind).mul(step(kind, 2.5));
  const low = step(2.5, kind);
  const pick = hashNode(vec2(seed, 9.7));
  const slabStyle = step(pick, 0.45);
  const goldStyle = step(0.45, pick).mul(step(pick, 0.7));
  const glassStyle = step(0.7, pick);
  const share = mix(float(0.3), float(0.65), hashNode(vec2(seed, 3.1)));
  const hotel = windowGrid(u, h, seed, 3.6, 3.1, 0.82, 0.62, 1, share);
  const office = windowGrid(
    u,
    h,
    seed,
    1.6,
    3.6,
    0.86,
    0.72,
    4,
    share.mul(0.7),
  );
  const casino = windowGrid(u, h, seed, 7.5, 5.5, 0.7, 0.5, 2, float(0.35));
  const shop = windowGrid(u, h, seed, 4.5, 3.6, 0.6, 0.55, 2, float(0.3));
  const warm = vec3(1.0, 0.7, 0.4);
  const neutral = vec3(1.0, 0.86, 0.68);
  const cool = vec3(0.75, 0.86, 1.0);
  const top = total.sub(h);
  const crown = smoothstep(2.5, 0.8, top).mul(
    step(0.35, hashNode(vec2(seed, 5.5))),
  );
  const neonHue = hashNode(vec2(seed, 1.1));
  const neon = vec3(
    sin(neonHue.mul(6.28)).mul(0.5).add(0.5),
    sin(neonHue.mul(6.28).add(2.1)).mul(0.5).add(0.5),
    sin(neonHue.mul(6.28).add(4.2)).mul(0.5).add(0.5),
  ).mul(1.3);
  const crownColour = mix(
    vec3(1.0, 0.9, 0.7),
    neon,
    step(0.6, hashNode(vec2(seed, 8.8))),
  );
  const uplight = smoothstep(26, 0, h)
    .mul(0.55)
    .add(smoothstep(8, 0, top).mul(0.3));
  const towerGlow = mix(
    mix(
      warm.mul(hotel.lit).mul(1.05),
      neutral.mul(hotel.lit).mul(0.85),
      goldStyle,
    ),
    cool.mul(office.lit).mul(0.85),
    glassStyle,
  )
    .add(warm.mul(hotel.pane).mul(0.1).mul(float(1).sub(glassStyle)))
    .add(crownColour.mul(crown).mul(2.2))
    .add(
      vec3(1, 0.85, 0.62).mul(uplight).mul(slabStyle.add(goldStyle).mul(0.35)),
    )
    .add(vec3(0.9, 0.6, 0.25).mul(goldStyle).mul(0.05));
  const band = smoothstep(0.0, 0.3, h.sub(total.sub(2.4))).mul(
    smoothstep(0.3, 0.0, h.sub(total.sub(0.9))),
  );
  const cornice = smoothstep(0.0, 0.2, fract(h.div(5.5)).sub(0.86)).mul(0.2);
  const podiumGlow = vec3(1.0, 0.8, 0.58)
    .mul(smoothstep(14, 0, h).mul(0.22).add(0.05).add(cornice))
    .add(neutral.mul(casino.lit).mul(0.9))
    .add(neon.mul(band).mul(2.6));
  const parkingGlow = vec3(0.85, 0.95, 0.88)
    .mul(
      smoothstep(0.8, 0.86, fract(h.div(3.1))).mul(
        smoothstep(0.97, 0.91, fract(h.div(3.1))),
      ),
    )
    .mul(0.45);
  const lowGlow = warm
    .mul(shop.lit)
    .mul(0.9)
    .add(
      vec3(1, 0.8, 0.6)
        .mul(smoothstep(5, 0, h))
        .mul(0.12),
    );
  const glow = mix(
    mix(mix(lowGlow, parkingGlow, parking), podiumGlow, podium),
    towerGlow,
    tower,
  )
    .mul(float(1).sub(roof))
    .mul(windowShade);
  const concrete = vec3(0.23, 0.21, 0.18).mul(
    hashNode(vec2(seed, 6.6)).mul(0.4).add(0.7),
  );
  const glass = vec3(0.035, 0.05, 0.065);
  const gold = vec3(0.32, 0.22, 0.09);
  const window = vec3(0.02, 0.022, 0.03);
  const towerColour = mix(
    mix(
      mix(concrete, window, hotel.pane),
      mix(gold, window, hotel.pane.mul(0.5)),
      goldStyle,
    ),
    mix(glass, glass.mul(0.6), office.slab),
    glassStyle,
  );
  const podiumColour = mix(
    vec3(0.21, 0.18, 0.15),
    window,
    casino.pane.mul(0.6),
  );
  const lowColour = mix(concrete.mul(0.7), window, shop.pane);
  const facade = mix(
    mix(mix(lowColour, concrete.mul(0.6), parking), podiumColour, podium),
    towerColour,
    tower,
  );
  material.colorNode = mix(
    facade.mul(facadeShade),
    vec3(0.07, 0.07, 0.075),
    roof,
  );
  material.roughnessNode = mix(
    float(0.85),
    float(0.2),
    tower.mul(glassStyle.add(goldStyle)).min(1),
  );
  material.metalnessNode = tower.mul(goldStyle).mul(0.6);
  const wash = smoothstep(30, 0, h).mul(0.2).add(0.06).mul(float(1).sub(roof));
  material.emissiveNode = glow
    .add(facade.mul(wash))
    .mul(cityGlow)
    .mul(float(1).sub(low.mul(0.2)));
  return material;
}

function buildingMesh(buildings: Building[]): THREE.Mesh {
  const mesh = new Mesh();
  buildings.forEach((building, index) => {
    addBuilding(mesh, building, hash(index + 0.5));
  });
  const result = new THREE.Mesh(mesh.geometry(), facadeMaterial());
  result.name = "city_buildings";
  result.receiveShadow = false;
  result.castShadow = false;
  return result;
}

function groundMesh(ground: Ground): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  const positions: number[] = [];
  const uvs: number[] = [];
  for (let r = 0; r < ground.rows; r++)
    for (let c = 0; c < ground.columns; c++) {
      const x = ground.x + c * ground.step;
      const z = ground.z - r * ground.step;
      positions.push(x, ground.heights[r * ground.columns + c] ?? 0, z);
      uvs.push(x / 6, z / 6);
    }
  const index: number[] = [];
  for (let r = 0; r < ground.rows - 1; r++)
    for (let c = 0; c < ground.columns - 1; c++) {
      const a = r * ground.columns + c;
      const b = a + ground.columns;
      index.push(a, b, b + 1, a, b + 1, a + 1);
    }
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardNodeMaterial({
    side: THREE.DoubleSide,
  });
  material.colorNode = vec3(0.07, 0.068, 0.065);
  material.roughnessNode = float(0.95);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "city_ground";
  mesh.receiveShadow = true;
  return mesh;
}

export class Quads {
  readonly positions: number[] = [];
  readonly normals: number[] = [];
  readonly index: number[] = [];

  add(corners: THREE.Vector3[], n: THREE.Vector3): void {
    const at = this.positions.length / 3;
    for (const c of corners) {
      this.positions.push(c.x, c.y, c.z);
      this.normals.push(n.x, n.y, n.z);
    }
    this.index.push(at, at + 1, at + 2, at, at + 2, at + 3);
  }

  geometry(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(this.positions, 3),
    );
    geometry.setAttribute(
      "normal",
      new THREE.Float32BufferAttribute(this.normals, 3),
    );
    geometry.setIndex(this.index);
    geometry.computeBoundingSphere();
    return geometry;
  }
}

function pointsOf(line: number[]): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  for (let i = 0; i + 2 < line.length; i += 3)
    points.push(
      new THREE.Vector3(
        Number(line[i]),
        Number(line[i + 1]),
        Number(line[i + 2]),
      ),
    );
  return points;
}

function pairs<T>(list: T[]): [T, T][] {
  const out: [T, T][] = [];
  list.forEach((b, i) => {
    const a = list[i - 1];
    if (a !== undefined) out.push([a, b]);
  });
  return out;
}

function monorailBeam(quads: Quads, a: THREE.Vector3, b: THREE.Vector3): void {
  const side = new THREE.Vector3(a.z - b.z, 0, b.x - a.x).normalize();
  const half = side.clone().multiplyScalar(monorailWidth / 2);
  const top = (p: THREE.Vector3, s: number) =>
    p.clone().addScaledVector(half, s);
  const bottom = (p: THREE.Vector3, s: number) =>
    top(p, s).setY(p.y - monorailDepth);
  quads.add(
    [top(a, 1), top(b, 1), top(b, -1), top(a, -1)],
    new THREE.Vector3(0, 1, 0),
  );
  quads.add(
    [bottom(a, -1), bottom(b, -1), bottom(b, 1), bottom(a, 1)],
    new THREE.Vector3(0, -1, 0),
  );
  for (const s of [1, -1])
    quads.add(
      [bottom(a, s), bottom(b, s), top(b, s), top(a, s)],
      side.clone().multiplyScalar(s),
    );
}

function cuboid(
  quads: Quads,
  centre: THREE.Vector3,
  half: [number, number, number],
  along: THREE.Vector3,
  side: THREE.Vector3,
): void {
  const up = new THREE.Vector3(0, 1, 0);
  const axes = [along, up, side];
  const corner = (a: number, b: number, c: number) =>
    centre
      .clone()
      .addScaledVector(along, a * half[0])
      .addScaledVector(up, b * half[1])
      .addScaledVector(side, c * half[2]);
  for (let axis = 0; axis < 3; axis++) {
    const normal = axes[axis] ?? up;
    const u = axes[(axis + 1) % 3] ?? up;
    const v = axes[(axis + 2) % 3] ?? up;
    for (const sign of [1, -1]) {
      const at = (a: number, b: number) => {
        const k = [0, 0, 0];
        k[axis] = sign;
        k[(axis + 1) % 3] = a;
        k[(axis + 2) % 3] = b;
        return corner(k[0] ?? 0, k[1] ?? 0, k[2] ?? 0);
      };
      const facing = normal.clone().multiplyScalar(sign);
      const corners = [at(-1, -1), at(1, -1), at(1, 1), at(-1, 1)];
      const turn = u.clone().cross(v).dot(facing) > 0;
      quads.add(turn ? corners : corners.reverse(), facing);
    }
  }
}

function monorailColumns(quads: Quads, columns: number[]): void {
  for (let i = 0; i + columnStride <= columns.length; i += columnStride) {
    const [x = 0, ground = 0, z = 0, top = 0, heading = 0, arm = 0] =
      columns.slice(i, i + columnStride);
    const along = new THREE.Vector3(Math.cos(heading), 0, Math.sin(heading));
    const side = new THREE.Vector3(-along.z, 0, along.x);
    const shaftTop = top - capDepth;
    const shaftBottom = ground - 1;
    cuboid(
      quads,
      new THREE.Vector3(x, (shaftTop + shaftBottom) / 2, z),
      [columnHalf, (shaftTop - shaftBottom) / 2, columnHalf],
      along,
      side,
    );
    cuboid(
      quads,
      new THREE.Vector3(x, top - capDepth / 2, z),
      [capHalf, capDepth / 2, Math.max(arm / 2, columnHalf + 0.2)],
      along,
      side,
    );
  }
}

function monorailLine(quads: Quads, points: THREE.Vector3[]): void {
  for (const [a, b] of pairs(points))
    if (Math.hypot(b.x - a.x, b.z - a.z) >= 0.1) monorailBeam(quads, a, b);
}

function monorailMesh(lines: number[][], columns: number[]): THREE.Mesh {
  const quads = new Quads();
  for (const line of lines) monorailLine(quads, pointsOf(line));
  monorailColumns(quads, columns);
  const geometry = quads.geometry();
  const material = new THREE.MeshStandardNodeMaterial({
    side: THREE.DoubleSide,
  });
  material.colorNode = vec3(0.8, 0.8, 0.78);
  material.roughnessNode = float(0.8);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "city_monorail";
  return mesh;
}

function palmGeometry(): {
  trunk: THREE.BufferGeometry;
  crown: THREE.BufferGeometry;
} {
  const trunk = new THREE.CylinderGeometry(
    0.17,
    0.26,
    1,
    trunkSegments,
    1,
    true,
  );
  trunk.translate(0, 0.5, 0);
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const index: number[] = [];
  for (let f = 0; f < palmFronds; f++) {
    const angle = (f / palmFronds) * Math.PI * 2 + hash(f) * 0.4;
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    const droop = (f % 2 === 0 ? 0.15 : 0.6) + hash(f + 7) * 0.4;
    const segments = 4;
    const at = positions.length / 3;
    for (let k = 0; k <= segments; k++) {
      const t = k / segments;
      const reach = t * frondLength;
      const y = Math.sin(t * Math.PI * 0.6) * 0.8 - t * t * droop * 3.2;
      for (const side of [-1, 1]) {
        const w =
          frondWidth * 0.5 * Math.sin(Math.PI * Math.min(1, t * 1.1 + 0.05));
        positions.push(
          dx * reach - dz * w * side,
          y - w * frondFold,
          dz * reach + dx * w * side,
        );
        normals.push(0, 1, 0);
        uvs.push(t, side < 0 ? 0 : 1);
      }
    }
    for (let k = 0; k < segments; k++) {
      const a = at + k * 2;
      index.push(a, a + 2, a + 3, a, a + 3, a + 1);
    }
  }
  const crown = new THREE.BufferGeometry();
  crown.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  crown.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  crown.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  crown.setIndex(index);
  return { trunk, crown };
}

function palms(trees: number[], frond: THREE.Texture): THREE.Object3D {
  const count = Math.floor(trees.length / 3);
  const group = new THREE.Group();
  group.name = "city_palms";
  if (count === 0) return group;
  const { trunk, crown } = palmGeometry();
  const bark = new THREE.MeshStandardNodeMaterial();
  bark.colorNode = vec3(0.24, 0.2, 0.15);
  bark.roughnessNode = float(0.9);
  const leaves = new THREE.MeshStandardNodeMaterial({
    map: frond,
    side: THREE.DoubleSide,
    alphaTest: 0.4,
  });
  leaves.roughnessNode = float(0.75);
  leaves.emissiveNode = texture(frond, uv()).rgb.mul(cityGlow.mul(0.6));
  const trunks = new THREE.InstancedMesh(trunk, bark, count);
  const crowns = new THREE.InstancedMesh(crown, leaves, count);
  const matrix = new THREE.Matrix4();
  const lean = new THREE.Matrix4();
  for (let i = 0; i < count; i++) {
    const x = trees[i * 3] ?? 0;
    const y = trees[i * 3 + 1] ?? 0;
    const z = trees[i * 3 + 2] ?? 0;
    const height =
      palmHeightLow + (palmHeightHigh - palmHeightLow) * hash(i * 1.7);
    const tilt = (hash(i * 3.1) - 0.5) * 0.12;
    lean.makeRotationZ(tilt);
    matrix.makeScale(1, height, 1).premultiply(lean).setPosition(x, y, z);
    trunks.setMatrixAt(i, matrix);
    const scale = 0.85 + hash(i * 5.3) * 0.35;
    matrix
      .makeRotationY(hash(i * 2.9) * Math.PI * 2)
      .scale(new THREE.Vector3(scale, scale, scale))
      .setPosition(x - Math.sin(tilt) * height, y + height * Math.cos(tilt), z);
    crowns.setMatrixAt(i, matrix);
  }
  for (const mesh of [trunks, crowns]) {
    mesh.computeBoundingSphere();
    mesh.castShadow = false;
    mesh.receiveShadow = false;
  }
  group.add(trunks, crowns);
  return group;
}

const leafCards = 56;
const leafBend = 0.85;
const cardCorners: [number, number][] = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];

function leafyGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const index: number[] = [];
  for (let k = 0; k < leafCards; k++) {
    const r = Math.cbrt(hash(k * 3.1 + 0.2)) * 0.82;
    const theta = hash(k * 5.7 + 0.4) * Math.PI * 2;
    const phi = Math.acos(hash(k * 7.9 + 0.6) * 2 - 1);
    const centre = new THREE.Vector3(
      r * Math.sin(phi) * Math.cos(theta),
      r * Math.cos(phi) * 0.75,
      r * Math.sin(phi) * Math.sin(theta),
    );
    const yaw = hash(k * 2.3 + 0.8) * Math.PI;
    const tilt = (hash(k * 4.4 + 0.1) - 0.5) * 1.6;
    const ax = new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw));
    const ay = new THREE.Vector3(
      -Math.sin(yaw) * Math.sin(tilt),
      Math.cos(tilt),
      Math.cos(yaw) * Math.sin(tilt),
    );
    const outward = centre.clone().setY(centre.y + 0.3);
    const facing = ax.clone().cross(ay);
    if (facing.dot(outward) < 0) facing.negate();
    const bent = facing
      .multiplyScalar(1 - leafBend)
      .addScaledVector(outward, leafBend);
    const size = 0.42 + hash(k * 9.1) * 0.22;
    const at = positions.length / 3;
    for (const [a, b] of cardCorners) {
      const p = centre
        .clone()
        .addScaledVector(ax, a * size)
        .addScaledVector(ay, b * size);
      positions.push(p.x, p.y, p.z);
      normals.push(bent.x, bent.y, bent.z);
      uvs.push((a + 1) / 2, (b + 1) / 2);
    }
    index.push(at, at + 1, at + 2, at, at + 2, at + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(index);
  geometry.normalizeNormals();
  return geometry;
}

function leafy(trees: number[], foliage: THREE.Texture): THREE.Object3D {
  const group = new THREE.Group();
  group.name = "city_trees";
  const count = trees.length / 3;
  if (count === 0) return group;
  const trunk = new THREE.CylinderGeometry(0.16, 0.26, 1, 6, 1, true);
  trunk.translate(0, 0.5, 0);
  const bark = new THREE.MeshStandardNodeMaterial();
  bark.colorNode = vec3(0.16, 0.12, 0.09);
  bark.roughnessNode = float(0.9);
  const leaves = new THREE.MeshStandardNodeMaterial({
    map: foliage,
    side: THREE.DoubleSide,
    alphaTest: 0.45,
    alphaToCoverage: true,
  });
  const tone = mx_noise_float(positionLocal.mul(0.9)).mul(0.15).add(1);
  leaves.colorNode = texture(foliage, uv()).rgb.mul(tone);
  leaves.opacityNode = texture(foliage, uv()).a;
  leaves.roughnessNode = float(0.85);
  const underlit = smoothstep(0.9, -0.6, positionLocal.y).mul(0.75).add(0.25);
  leaves.emissiveNode = texture(foliage, uv()).rgb.mul(cityGlow.mul(underlit));
  const trunks = new THREE.InstancedMesh(trunk, bark, count);
  const crowns = new THREE.InstancedMesh(leafyGeometry(), leaves, count);
  const matrix = new THREE.Matrix4();
  for (let i = 0; i < count; i++) {
    const x = trees[i * 3] ?? 0;
    const y = trees[i * 3 + 1] ?? 0;
    const z = trees[i * 3 + 2] ?? 0;
    const height = 4.5 + hash(i * 2.3) * 3;
    const radius = 3.0 + hash(i * 4.1) * 2.0;
    matrix.makeScale(1, height, 1).setPosition(x, y, z);
    trunks.setMatrixAt(i, matrix);
    matrix
      .makeRotationY(hash(i * 1.3) * 6.28)
      .scale(new THREE.Vector3(radius, radius * 0.9, radius))
      .setPosition(x, y + height + radius * 0.35, z);
    crowns.setMatrixAt(i, matrix);
  }
  for (const mesh of [trunks, crowns]) {
    mesh.computeBoundingSphere();
    mesh.castShadow = false;
    mesh.receiveShadow = false;
  }
  group.add(trunks, crowns);
  return group;
}

function screenMaterial(): THREE.MeshBasicNodeMaterial {
  const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  const seed = uv(1).x;
  const at = uv();
  const front = uv(1).y;
  const t = time.mul(0.25);
  const style = floor(seed.mul(4));
  const hue = (shift: THREE.Node<"float">) =>
    vec3(
      sin(shift.mul(6.28)).mul(0.5).add(0.5),
      sin(shift.mul(6.28).add(2.1)).mul(0.5).add(0.5),
      sin(shift.mul(6.28).add(4.2)).mul(0.5).add(0.5),
    );
  const waves = hue(at.x.mul(0.6).add(at.y.mul(0.3)).add(t).add(seed));
  const flame = mx_fractal_noise_float(
    vec3(at.x.mul(3), at.y.mul(2).sub(t.mul(6)), seed.mul(9)),
    3,
  );
  const fire = mix(
    vec3(0.9, 0.18, 0.02),
    vec3(1, 0.75, 0.25),
    smoothstep(-0.1, 0.5, flame),
  ).mul(smoothstep(1.05, 0.2, at.y.add(flame.mul(0.4))));
  const bands = step(0.5, fract(at.y.mul(3).add(t.mul(0.5))))
    .mul(0.6)
    .add(0.4);
  const panel = hue(seed.add(floor(t.mul(0.5)).mul(0.37))).mul(bands);
  const sparkle = step(
    0.82,
    fract(
      sin(floor(at.mul(vec2(40, 20))).dot(vec2(12.9, 78.2)))
        .mul(43758.5)
        .add(t.mul(0.2)),
    ),
  );
  const dots = mix(vec3(0.1, 0.02, 0.18), vec3(1, 0.85, 0.4), sparkle);
  const picture = mix(
    mix(waves, fire, step(0.5, style)),
    mix(panel, dots, step(2.5, style)),
    step(1.5, style),
  );
  const edge = smoothstep(0.0, 0.02, at.x)
    .mul(smoothstep(1.0, 0.98, at.x))
    .mul(smoothstep(0.0, 0.03, at.y))
    .mul(smoothstep(1.0, 0.97, at.y));
  material.colorNode = mix(
    vec3(0.02),
    picture.mul(edge).mul(cityGlow.mul(4.2).add(0.6)),
    front,
  );
  return material;
}

function signMesh(signs: Sign[]): THREE.Mesh {
  const mesh = new Mesh();
  signs.forEach((sign) => {
    const dx = Math.cos(sign.facing);
    const dz = -Math.sin(sign.facing);
    const ax = -dz;
    const az = dx;
    const half = sign.width / 2;
    const depth = 0.8;
    const bottom = sign.y + sign.lift;
    const top = bottom + sign.height;
    const corner = (a: number, b: number, y: number) => [
      sign.x + ax * a + dx * b,
      y,
      sign.z + az * a + dz * b,
    ];
    const face = (
      corners: number[][],
      n: number[],
      front: number,
      uvs: [number, number][],
    ) => {
      const first = mesh.position.length / 3;
      corners.forEach((c, k) =>
        mesh.vertex(c, n, uvs[k] ?? [0, 0], [sign.seed, front], [0, 0]),
      );
      mesh.index.push(first, first + 1, first + 2, first, first + 2, first + 3);
    };
    const square: [number, number][] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    face(
      [
        corner(-half, depth / 2, bottom),
        corner(half, depth / 2, bottom),
        corner(half, depth / 2, top),
        corner(-half, depth / 2, top),
      ],
      [dx, 0, dz],
      1,
      square,
    );
    face(
      [
        corner(half, -depth / 2, bottom),
        corner(-half, -depth / 2, bottom),
        corner(-half, -depth / 2, top),
        corner(half, -depth / 2, top),
      ],
      [-dx, 0, -dz],
      0,
      square,
    );
    const post = 0.7;
    for (const [a0, b0, a1, b1, n] of [
      [-post, post, post, post, [dx, 0, dz]],
      [post, -post, -post, -post, [-dx, 0, -dz]],
      [post, post, post, -post, [ax, 0, az]],
      [-post, -post, -post, post, [-ax, 0, -az]],
    ] as [number, number, number, number, number[]][])
      face(
        [
          corner(a0, b0, sign.y),
          corner(a1, b1, sign.y),
          corner(a1, b1, bottom),
          corner(a0, b0, bottom),
        ],
        n,
        0,
        square,
      );
  });
  const result = new THREE.Mesh(mesh.geometry(), screenMaterial());
  result.name = "city_signs";
  return result;
}

function splitTrees(trees: number[]): { palms: number[]; leafy: number[] } {
  const palm: number[] = [];
  const leaf: number[] = [];
  for (let i = 0; i + 3 < trees.length + 1; i += 4) {
    const target = (trees[i + 3] ?? 0) < 0.5 ? palm : leaf;
    target.push(trees[i] ?? 0, trees[i + 1] ?? 0, trees[i + 2] ?? 0);
  }
  return { palms: palm, leafy: leaf };
}

export function buildCity(
  city: CityData,
  frond: THREE.Texture,
  foliage: THREE.Texture,
): THREE.Object3D {
  const root = new THREE.Group();
  root.name = "city";
  const planted = splitTrees(city.streetTrees);
  root.add(
    groundMesh(city.ground),
    buildingMesh(city.buildings),
    monorailMesh(city.monorail, city.monorailColumns),
    palms([...city.trees, ...planted.palms], frond),
    leafy(planted.leafy, foliage),
    signMesh(city.signs),
  );
  return root;
}
