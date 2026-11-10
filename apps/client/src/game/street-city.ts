import * as THREE from "three/webgpu";
import type { Entrance } from "./street-entrances.ts";
import { type Building, buildingMesh } from "./street-facades.ts";
import type { Landmarks } from "./street-landmarks.ts";
import { type Marquee, marqueeMesh } from "./street-marquee.ts";
import {
  type Ground,
  type Street,
  streetMesh,
  waterMesh,
} from "./street-roads.ts";
import { type Sign, signMesh } from "./street-screens.ts";
import { hash } from "./street-shell.ts";
import type { Venue } from "./street-venue.ts";
import {
  float,
  mix,
  mx_noise_float,
  positionLocal,
  smoothstep,
  texture,
  uniform,
  uv,
  vec3,
} from "three/tsl";

export interface CityData {
  ground: Ground;
  buildings: Building[];
  monorail: number[][];
  monorailColumns: number[];
  trees: number[];
  roads: Street[];
  bridges: { distance: number }[];
  water: number[][];
  streetTrees: number[];
  signs: Sign[];
  marquees: Marquee[];
  entrances: Entrance[];
  spectators: number[];
  venue: Venue;
  landmarks?: Landmarks;
}

export const cityGlow = uniform(0);

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
const foliageSaturation = 0.55;
const foliageShade = 0.42;
const foliageFill = 0.06;
const barkFill = 0.1;

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
  material.colorNode = vec3(0.46, 0.46, 0.44);
  material.roughnessNode = float(0.85);
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

function foliageColour(leaf: THREE.Node<"vec3">): THREE.Node<"vec3"> {
  const grey = leaf.dot(vec3(0.3, 0.55, 0.15));
  return mix(vec3(grey), leaf, foliageSaturation).mul(foliageShade);
}

function barkMaterial(
  colour: THREE.Node<"vec3">,
): THREE.MeshStandardNodeMaterial {
  const bark = new THREE.MeshStandardNodeMaterial();
  bark.colorNode = colour;
  bark.roughnessNode = float(0.9);
  bark.emissiveNode = colour.mul(cityGlow.mul(barkFill));
  return bark;
}

function palms(trees: number[], frond: THREE.Texture): THREE.Object3D {
  const count = Math.floor(trees.length / 3);
  const group = new THREE.Group();
  group.name = "city_palms";
  if (count === 0) return group;
  const { trunk, crown } = palmGeometry();
  const bark = barkMaterial(vec3(0.2, 0.17, 0.13));
  const leaves = new THREE.MeshStandardNodeMaterial({
    map: frond,
    side: THREE.DoubleSide,
    alphaTest: 0.4,
  });
  const blade = foliageColour(texture(frond, uv()).rgb);
  leaves.colorNode = blade;
  leaves.opacityNode = texture(frond, uv()).a;
  leaves.roughnessNode = float(0.7);
  leaves.emissiveNode = blade.mul(cityGlow.mul(foliageFill));
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
  const bark = barkMaterial(vec3(0.15, 0.12, 0.09));
  const leaves = new THREE.MeshStandardNodeMaterial({
    map: foliage,
    side: THREE.DoubleSide,
    alphaTest: 0.45,
    alphaToCoverage: true,
  });
  const tone = mx_noise_float(positionLocal.mul(0.9)).mul(0.2).add(1);
  const leaf = foliageColour(texture(foliage, uv()).rgb).mul(tone);
  leaves.colorNode = leaf;
  leaves.opacityNode = texture(foliage, uv()).a;
  leaves.roughnessNode = float(0.85);
  const underlit = smoothstep(0.9, -0.6, positionLocal.y).mul(2).add(1);
  leaves.emissiveNode = leaf.mul(cityGlow.mul(foliageFill)).mul(underlit);
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
  screens: THREE.Texture,
): THREE.Object3D {
  const root = new THREE.Group();
  root.name = "city";
  const planted = splitTrees(city.streetTrees);
  root.add(
    groundMesh(city.ground),
    streetMesh(city.roads, city.ground, cityGlow),
    waterMesh(city.water, city.ground, cityGlow),
    buildingMesh(city.buildings, cityGlow),
    monorailMesh(city.monorail, city.monorailColumns),
    palms([...city.trees, ...planted.palms], frond),
    leafy(planted.leafy, foliage),
    signMesh(city.signs, screens, cityGlow),
    marqueeMesh(city.marquees, cityGlow),
  );
  return root;
}
