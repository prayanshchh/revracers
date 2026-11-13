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
import { speciesIndex } from "./scenery-trees.ts";
import { hash } from "./street-shell.ts";
import type { Venue } from "./street-venue.ts";
import { float, uniform, vec3 } from "three/tsl";

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
const palmHeights = [11, 17] as const;
const leafyHeights = [7.5, 11.5] as const;
const treeStride = 8;

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

export type Clear = (values: number[], stride: number) => number[];

function planted(list: number[], stride: number, palm: number): number[][] {
  const leafy = speciesIndex("elm");
  const rows: number[][] = [];
  for (let i = 0; i + stride <= list.length; i += stride)
    rows.push([
      Number(list[i]),
      Number(list[i + 1]),
      Number(list[i + 2]),
      stride < 4 || Number(list[i + 3]) < 0.5 ? palm : leafy,
    ]);
  return rows;
}

export function cityTrees(city: CityData, cleared: Clear): Float32Array {
  const palm = speciesIndex("palm");
  const rows = [
    ...planted(city.trees, 3, palm),
    ...planted(cleared(city.streetTrees, 4), 4, palm),
  ];
  const values = new Float32Array(rows.length * treeStride);
  rows.forEach(([x = 0, y = 0, z = 0, kind = 0], i) => {
    const [low, high] = kind === palm ? palmHeights : leafyHeights;
    const height = low + (high - low) * hash(i * 1.7);
    values.set([x, -z, y, height, kind, hash(i * 3.1 + 0.4)], i * treeStride);
  });
  return values;
}

export function buildCity(
  city: CityData,
  screens: THREE.Texture,
): THREE.Object3D {
  const root = new THREE.Group();
  root.name = "city";
  root.add(
    groundMesh(city.ground),
    streetMesh(city.roads, city.ground, cityGlow),
    waterMesh(city.water, city.ground, cityGlow),
    buildingMesh(city.buildings, cityGlow),
    monorailMesh(city.monorail, city.monorailColumns),
    signMesh(city.signs, screens, cityGlow),
    marqueeMesh(city.marquees, cityGlow),
  );
  return root;
}
