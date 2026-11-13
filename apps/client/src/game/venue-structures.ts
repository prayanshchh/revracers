import * as THREE from "three/webgpu";
import structures from "../../../../content/tracks/hill-country/structures.json";

type Point = [number, number, number];

interface Suite {
  corners: number[][];
  base: number;
  height: number;
}

const storey = 3.4;
const suiteFloors = 3;
const slab = 0.28;
const slabReach = 0.5;
const grow = 0.6;
const plinth = 3;
const enclosed = 0.46;
const postSpacing = 4.6;
const postSize = 0.24;
const railHeight = 1.05;
const railSize = 0.06;
const ridgeRise = 0.16;
const eave = 0.7;
const mullion = 1.5;

class Shape {
  private readonly position: number[] = [];
  private readonly normal: number[] = [];
  private readonly uv: number[] = [];
  private readonly index: number[] = [];

  quad(corners: Point[], uvs: [number, number][] | null = null): void {
    const [a, b, c] = corners;
    if (!a || !b || !c) return;
    const u = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const v = new THREE.Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    const n = u.cross(v).normalize();
    const first = this.position.length / 3;
    corners.forEach(([x, y, z], k) => {
      this.position.push(x, z, -y);
      this.normal.push(n.x, n.z, -n.y);
      const [s = 0, t = 0] = uvs?.[k] ?? [];
      this.uv.push(s, t);
    });
    for (let k = 1; k + 1 < corners.length; k++)
      this.index.push(first, first + k, first + k + 1);
  }

  beam(from: Point, to: Point, size: number): void {
    const a = new THREE.Vector3(...from);
    const b = new THREE.Vector3(...to);
    const axis = b.clone().sub(a);
    if (axis.lengthSq() < 1e-8) return;
    axis.normalize();
    const helper =
      Math.abs(axis.z) < 0.9
        ? new THREE.Vector3(0, 0, 1)
        : new THREE.Vector3(1, 0, 0);
    const u = axis
      .clone()
      .cross(helper)
      .normalize()
      .multiplyScalar(size / 2);
    const v = axis
      .clone()
      .cross(u)
      .normalize()
      .multiplyScalar(size / 2);
    const ring = [
      u.clone().add(v),
      u.clone().sub(v),
      u.clone().negate().sub(v),
      v.clone().sub(u),
    ];
    ring.forEach((offset, k) => {
      const next = ring[(k + 1) % ring.length] ?? offset;
      const corner = (base: THREE.Vector3, by: THREE.Vector3): Point => [
        base.x + by.x,
        base.y + by.y,
        base.z + by.z,
      ];
      this.quad([
        corner(a, offset),
        corner(b, offset),
        corner(b, next),
        corner(a, next),
      ]);
    });
  }

  mesh(name: string, material: THREE.Material): THREE.Mesh {
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
    geometry.setIndex(this.index);
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    return mesh;
  }
}

interface Frame {
  at: (along: number, depth: number, lift: number) => Point;
  length: number;
  depth: number;
}

function frameOf(suite: Suite): Frame | null {
  const [c0, c1, , c3] = suite.corners.map(
    ([x = 0, y = 0]) => new THREE.Vector2(x, y),
  );
  if (!c0 || !c1 || !c3) return null;
  const along = c1.clone().sub(c0);
  const back = c3.clone().sub(c0);
  const length = along.length() + grow * 2;
  const depth = back.length() + grow * 2;
  along.normalize();
  back.normalize();
  const origin = c0
    .clone()
    .addScaledVector(along, -grow)
    .addScaledVector(back, -grow);
  return {
    length,
    depth,
    at: (s, d, lift) => [
      origin.x + along.x * s + back.x * d,
      origin.y + along.y * s + back.y * d,
      suite.base + lift,
    ],
  };
}

function box(
  shape: Shape,
  frame: Frame,
  along: [number, number],
  depth: [number, number],
  lift: [number, number],
  glazed: Shape | null = null,
): void {
  const [s0, s1] = along;
  const [d0, d1] = depth;
  const [z0, z1] = lift;
  const p = frame.at;
  const face = (target: Shape, corners: Point[], wide: number) => {
    target.quad(corners, [
      [0, 0],
      [wide / mullion, 0],
      [wide / mullion, (z1 - z0) / storey],
      [0, (z1 - z0) / storey],
    ]);
  };
  face(
    glazed ?? shape,
    [p(s0, d0, z0), p(s1, d0, z0), p(s1, d0, z1), p(s0, d0, z1)],
    s1 - s0,
  );
  face(
    shape,
    [p(s1, d1, z0), p(s0, d1, z0), p(s0, d1, z1), p(s1, d1, z1)],
    s1 - s0,
  );
  face(
    shape,
    [p(s0, d1, z0), p(s0, d0, z0), p(s0, d0, z1), p(s0, d1, z1)],
    d1 - d0,
  );
  face(
    shape,
    [p(s1, d0, z0), p(s1, d1, z0), p(s1, d1, z1), p(s1, d0, z1)],
    d1 - d0,
  );
  shape.quad([p(s0, d0, z1), p(s1, d0, z1), p(s1, d1, z1), p(s0, d1, z1)]);
  shape.quad([p(s0, d1, z0), p(s1, d1, z0), p(s1, d0, z0), p(s0, d0, z0)]);
}

function terraces(
  parts: { white: Shape; glass: Shape; steel: Shape },
  frame: Frame,
  floors: number,
): void {
  const { length, depth, at } = frame;
  const posts = Math.max(2, Math.round(length / postSpacing) + 1);
  for (let k = 0; k < posts; k++) {
    const s = (length * k) / (posts - 1);
    parts.white.beam(
      at(s, -slabReach + postSize / 2, 0),
      at(s, -slabReach + postSize / 2, floors * storey),
      postSize,
    );
  }
  for (let floor = 0; floor < floors; floor++) {
    const deck = floor * storey;
    for (const lift of [railHeight, railHeight * 0.5])
      parts.steel.beam(
        at(0, -slabReach + 0.08, deck + lift),
        at(length, -slabReach + 0.08, deck + lift),
        railSize,
      );
    for (const s of [0.04, length - 0.04])
      parts.steel.beam(
        at(s, -slabReach + 0.08, deck + railHeight),
        at(s, depth * enclosed, deck + railHeight),
        railSize,
      );
  }
}

function gable(shape: Shape, frame: Frame, top: number): void {
  const { length, depth, at } = frame;
  const ridge = top + depth * ridgeRise;
  const mid = depth / 2;
  shape.quad([
    at(-eave, -eave, top),
    at(length + eave, -eave, top),
    at(length + eave, mid, ridge),
    at(-eave, mid, ridge),
  ]);
  shape.quad([
    at(length + eave, depth + eave, top),
    at(-eave, depth + eave, top),
    at(-eave, mid, ridge),
    at(length + eave, mid, ridge),
  ]);
  for (const s of [0, length])
    shape.quad([at(s, 0, top), at(s, depth, top), at(s, mid, ridge)]);
}

function suite(
  parts: { white: Shape; glass: Shape; steel: Shape },
  data: Suite,
): void {
  const frame = frameOf(data);
  if (!frame) return;
  const { length, depth } = frame;
  const floors = suiteFloors;
  const top = floors * storey;
  box(parts.white, frame, [0, length], [0, depth], [-plinth, 0]);
  for (let floor = 0; floor <= floors; floor++)
    box(
      parts.white,
      frame,
      [0, length],
      [-slabReach, depth],
      [floor * storey - slab, floor * storey],
    );
  box(
    parts.white,
    frame,
    [0, length],
    [depth * enclosed, depth],
    [0, top - slab],
    parts.glass,
  );
  terraces(parts, frame, floors);
  gable(parts.white, frame, top);
}

export function venueStructures(
  dress: (source: THREE.MeshStandardMaterial) => THREE.Material,
): THREE.Mesh[] {
  const parts = { white: new Shape(), glass: new Shape(), steel: new Shape() };
  for (const data of structures.suites) suite(parts, data);
  const make = (name: string, params: THREE.MeshStandardMaterialParameters) =>
    dress(new THREE.MeshStandardMaterial({ name, ...params }));
  return [
    parts.white.mesh(
      "suite_frame",
      make("track suite white", {
        color: new THREE.Color(0.8, 0.8, 0.78),
        roughness: 0.6,
      }),
    ),
    parts.glass.mesh(
      "suite_glass",
      make("track suite glass", {
        color: new THREE.Color(0.05, 0.065, 0.08),
        roughness: 0.12,
        metalness: 0.5,
      }),
    ),
    parts.steel.mesh(
      "suite_rails",
      make("track suite steel", {
        color: new THREE.Color(0.2, 0.21, 0.22),
        roughness: 0.4,
        metalness: 0.7,
      }),
    ),
  ];
}
