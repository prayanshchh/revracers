import * as THREE from "three/webgpu";

export const wallPart = 0;
export const roofPart = 1;
export const trimPart = 2;
export const slopePart = 3;
const ledgeTop = 0.7;
const ledgeFace = 0.12;
const ledgeUnder = 0.04;

export function hash(value: number): number {
  const x = Math.sin(value * 91.345 + 47.853) * 43758.5453;
  return x - Math.floor(x);
}

export class Mesh {
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

  quad(
    corners: number[][],
    n: number[],
    uvs: [number, number][],
    b: [number, number],
    c: [number, number],
  ): void {
    const first = this.position.length / 3;
    corners.forEach((corner, k) =>
      this.vertex(corner, n, uvs[k] ?? [0, 0], b, c),
    );
    this.index.push(first, first + 1, first + 2, first, first + 2, first + 3);
  }

  geometry(): THREE.BufferGeometry {
    return geometryOf(
      {
        position: [this.position, 3],
        normal: [this.normal, 3],
        uv: [this.uv, 2],
        uv1: [this.uv1, 2],
        uv2: [this.uv2, 2],
      },
      this.index,
    );
  }
}

export function geometryOf(
  attributes: Record<string, [number[], number]>,
  index: number[],
): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  for (const [name, [values, size]] of Object.entries(attributes))
    geometry.setAttribute(name, new THREE.Float32BufferAttribute(values, size));
  geometry.setIndex(index);
  geometry.computeBoundingSphere();
  return geometry;
}

export interface Shell {
  ring: THREE.Vector2[];
  outward: number;
  seed: number;
  row: number;
  total: number;
  bay: number;
}

export function ringOf(flat: number[]): THREE.Vector2[] {
  const ring: THREE.Vector2[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2)
    ring.push(new THREE.Vector2(Number(flat[i]), Number(flat[i + 1])));
  return ring;
}

export function cornerOf(ring: THREE.Vector2[], i: number): THREE.Vector2 {
  return (
    ring[((i % ring.length) + ring.length) % ring.length] ?? new THREE.Vector2()
  );
}

export function signedArea(ring: THREE.Vector2[]): number {
  let area = 0;
  ring.forEach((a, i) => {
    const b = cornerOf(ring, i + 1);
    area += a.x * b.y - b.x * a.y;
  });
  return area / 2;
}

function edgeNormal(
  a: THREE.Vector2,
  b: THREE.Vector2,
  outward: number,
): THREE.Vector2 {
  const span = a.distanceTo(b) || 1;
  return new THREE.Vector2(
    ((a.y - b.y) / span) * outward,
    ((b.x - a.x) / span) * outward,
  );
}

export function grown(
  ring: THREE.Vector2[],
  outward: number,
  by: number,
): THREE.Vector2[] {
  return ring.map((p, i) => {
    const before = edgeNormal(cornerOf(ring, i - 1), p, outward);
    const after = edgeNormal(p, cornerOf(ring, i + 1), outward);
    const mitre = before.clone().add(after);
    if (mitre.lengthSq() < 1e-6) return p.clone().addScaledVector(after, by);
    mitre.normalize();
    return p
      .clone()
      .addScaledVector(mitre, by / Math.max(0.4, mitre.dot(after)));
  });
}

export function inside(ring: THREE.Vector2[], p: THREE.Vector2): boolean {
  let hit = false;
  ring.forEach((a, i) => {
    const b = cornerOf(ring, i + 1);
    if (
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    )
      hit = !hit;
  });
  return hit;
}

export function centroid(ring: THREE.Vector2[]): THREE.Vector2 {
  const sum = new THREE.Vector2();
  for (const p of ring) sum.add(p);
  return sum.divideScalar(Math.max(1, ring.length));
}

export function addWalls(
  mesh: Mesh,
  shell: Shell,
  low: number,
  high: number,
  trim: number | null,
  lift = 0,
): void {
  const { ring, outward, seed, row, total, bay } = shell;
  let along = 0;
  ring.forEach((a, i) => {
    const b = cornerOf(ring, i + 1);
    const span = a.distanceTo(b);
    if (span < 0.05) return;
    const n = edgeNormal(a, b, outward);
    const start = Math.round(along / bay) * bay;
    const end = start + Math.round(span / bay) * bay;
    along += span;
    mesh.quad(
      [
        [a.x, low, a.y],
        [b.x, low, b.y],
        [b.x, high, b.y],
        [a.x, high, a.y],
      ],
      [n.x, 0, n.y],
      trim === null
        ? [
            [start, lift],
            [end, lift],
            [end, lift + high - low],
            [start, lift + high - low],
          ]
        : [
            [trim, 0],
            [trim, 0],
            [trim, 0],
            [trim, 0],
          ],
      [seed, trim === null ? wallPart : trimPart],
      [total, row],
    );
  });
}

export function addCap(
  mesh: Mesh,
  shell: Shell,
  ring: THREE.Vector2[],
  y: number,
): void {
  const faces = THREE.ShapeUtils.triangulateShape(ring, []);
  const first = mesh.position.length / 3;
  for (const p of ring)
    mesh.vertex(
      [p.x, y, p.y],
      [0, 1, 0],
      [0, 0],
      [shell.seed, roofPart],
      [shell.total, shell.row],
    );
  for (const face of faces)
    mesh.index.push(...face.map((corner) => first + corner));
}

function addBand(
  mesh: Mesh,
  shell: Shell,
  outer: THREE.Vector2[],
  y: number,
  up: number,
  light: number,
): void {
  shell.ring.forEach((a, i) => {
    const b = cornerOf(shell.ring, i + 1);
    const c = cornerOf(outer, i + 1);
    const d = cornerOf(outer, i);
    mesh.quad(
      [
        [a.x, y, a.y],
        [b.x, y, b.y],
        [c.x, y, c.y],
        [d.x, y, d.y],
      ],
      [0, up, 0],
      [
        [light, 0],
        [light, 0],
        [light, 0],
        [light, 0],
      ],
      [shell.seed, trimPart],
      [shell.total, shell.row],
    );
  });
}

export function addLedge(
  mesh: Mesh,
  shell: Shell,
  y: number,
  by: number,
  depth: number,
): void {
  const lip = grown(shell.ring, shell.outward, by);
  addBand(mesh, shell, lip, y - depth, -1, ledgeUnder);
  addWalls(mesh, { ...shell, ring: lip }, y - depth, y, ledgeFace);
  addBand(mesh, shell, lip, y, 1, ledgeTop);
}

export function addPiers(
  mesh: Mesh,
  shell: Shell,
  low: number,
  high: number,
  lift: number,
  width: number,
  depth: number,
): void {
  const { ring, outward, seed, row, total, bay } = shell;
  let along = 0;
  ring.forEach((a, i) => {
    const b = cornerOf(ring, i + 1);
    const span = a.distanceTo(b);
    if (span < 0.05) return;
    const start = Math.round(along / bay);
    const bays = Math.round(span / bay);
    along += span;
    if (bays < 1) return;
    const n = edgeNormal(a, b, outward);
    const e = b.clone().sub(a).divideScalar(span);
    const half = Math.min(width, span / (bays + 1)) / 2;
    for (let k = 0; k <= bays; k++) {
      const centre = THREE.MathUtils.clamp(
        (k / bays) * span,
        half,
        span - half,
      );
      const u = (start + k) * bay;
      const left = a.clone().addScaledVector(e, centre - half);
      const right = a.clone().addScaledVector(e, centre + half);
      const leftOut = left.clone().addScaledVector(n, depth);
      const rightOut = right.clone().addScaledVector(n, depth);
      const faces: [THREE.Vector2, THREE.Vector2, number[], number, number][] =
        [
          [leftOut, rightOut, [n.x, 0, n.y], u - half, u + half],
          [left, leftOut, [-e.x, 0, -e.y], u - half, u - half],
          [rightOut, right, [e.x, 0, e.y], u + half, u + half],
        ];
      for (const [p, q, normal, from, to] of faces)
        mesh.quad(
          [
            [p.x, low, p.y],
            [q.x, low, q.y],
            [q.x, high, q.y],
            [p.x, high, p.y],
          ],
          normal,
          [
            [from, lift],
            [to, lift],
            [to, lift + high - low],
            [from, lift + high - low],
          ],
          [seed, wallPart],
          [total, row],
        );
    }
  });
}
