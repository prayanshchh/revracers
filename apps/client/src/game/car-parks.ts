import * as THREE from "three/webgpu";
import { attribute, float, mix, vec3 } from "three/tsl";

export const parkedStride = 6;
const regionSize = 800;

interface Body {
  length: number;
  width: number;
  sill: number;
  belt: number;
  roof: number;
  cabin: [number, number];
  taper: number;
}

const sedan: Body = {
  length: 4.6,
  width: 1.84,
  sill: 0.22,
  belt: 0.86,
  roof: 1.44,
  cabin: [-1.05, 0.95],
  taper: 0.16,
};

const bodies: Body[] = [
  sedan,
  {
    length: 5.4,
    width: 2.0,
    sill: 0.3,
    belt: 1.12,
    roof: 1.86,
    cabin: [-0.4, 1.35],
    taper: 0.1,
  },
  {
    length: 12.2,
    width: 2.48,
    sill: 0.35,
    belt: 1.6,
    roof: 3.15,
    cabin: [-6.0, 6.0],
    taper: 0.02,
  },
];

const paints: [number, number, number][] = [
  [0.72, 0.72, 0.7],
  [0.02, 0.022, 0.025],
  [0.2, 0.205, 0.21],
  [0.45, 0.46, 0.47],
  [0.025, 0.045, 0.11],
  [0.22, 0.02, 0.025],
  [0.22, 0.17, 0.11],
  [0.85, 0.52, 0.02],
];

type Corner = [number, number, number];

class Shell {
  readonly positions: number[] = [];
  readonly normals: number[] = [];
  readonly glass: number[] = [];
  readonly index: number[] = [];

  quad(corners: Corner[], tinted: number): void {
    const [a, b, c, d] = corners;
    if (!a || !b || !c || !d) return;
    const u = new THREE.Vector3(...b).sub(new THREE.Vector3(...a));
    const v = new THREE.Vector3(...d).sub(new THREE.Vector3(...a));
    const normal = u.cross(v).normalize();
    const first = this.positions.length / 3;
    for (const p of [a, b, c, d]) {
      this.positions.push(...p);
      this.normals.push(normal.x, normal.y, normal.z);
      this.glass.push(tinted);
    }
    this.index.push(first, first + 1, first + 2, first, first + 2, first + 3);
  }

  box(
    low: number,
    high: number,
    back: number,
    front: number,
    half: number,
    inset: [number, number, number],
    tinted: number,
    top: boolean,
  ): void {
    const [behind, ahead, aside] = inset;
    const ring = (y: number, shrink: number): Corner[] => [
      [back + behind * shrink, y, -half + aside * shrink],
      [front - ahead * shrink, y, -half + aside * shrink],
      [front - ahead * shrink, y, half - aside * shrink],
      [back + behind * shrink, y, half - aside * shrink],
    ];
    const below = ring(low, 0);
    const above = ring(high, 1);
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      const a = below[i];
      const b = below[j];
      const c = above[j];
      const d = above[i];
      if (a && b && c && d) this.quad([a, d, c, b], tinted);
    }
    if (top) this.quad([...above].reverse(), 0);
  }

  build(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(this.positions, 3),
    );
    geometry.setAttribute(
      "normal",
      new THREE.Float32BufferAttribute(this.normals, 3),
    );
    geometry.setAttribute(
      "glazed",
      new THREE.Float32BufferAttribute(this.glass, 1),
    );
    geometry.setIndex(this.index);
    return geometry;
  }
}

function shellOf(body: Body): THREE.BufferGeometry {
  const shell = new Shell();
  const half = body.length / 2;
  const side = body.width / 2;
  shell.box(
    0.02,
    body.sill,
    0.3 - half,
    half - 0.3,
    side - 0.12,
    [0, 0, 0],
    1,
    false,
  );
  shell.box(
    body.sill,
    body.belt,
    -half,
    half,
    side,
    [0.1, 0.25, 0.04],
    0,
    true,
  );
  const [back, front] = body.cabin;
  const slope = body.taper * 4;
  shell.box(
    body.belt,
    body.roof,
    back,
    front,
    side - 0.06,
    [slope * 0.6, slope, body.taper],
    1,
    true,
  );
  return shell.build();
}

function parkedMaterial(): THREE.MeshStandardNodeMaterial {
  const paint = new THREE.MeshStandardNodeMaterial({
    roughness: 0.4,
    metalness: 0.25,
  });
  const tint = attribute("glazed", "float");
  paint.colorNode = mix(vec3(1), vec3(0.06, 0.075, 0.095), tint.mul(0.9));
  paint.roughnessNode = mix(float(0.42), float(0.06), tint);
  paint.metalnessNode = mix(float(0.25), float(0.6), tint);
  return paint;
}

function field(values: Float32Array, at: number): number {
  return values[at] ?? 0;
}

interface Parked {
  at: THREE.Vector3;
  turn: number;
  body: Body;
  kind: number;
  paint: [number, number, number];
}

function parkedAt(values: Float32Array, source: number): Parked {
  const kind = Math.round(field(values, source + 4));
  return {
    at: new THREE.Vector3(
      field(values, source),
      field(values, source + 2),
      -field(values, source + 1),
    ),
    turn: field(values, source + 3),
    body: bodies[kind] ?? sedan,
    kind,
    paint: paints[Math.round(field(values, source + 5))] ?? [0.5, 0.5, 0.5],
  };
}

function keyOf(values: Float32Array, source: number, size: number): string {
  return [
    Math.floor(field(values, source) / size),
    Math.floor(field(values, source + 1) / size),
  ].join("|");
}

function grouped(
  values: Float32Array,
  key: (source: number) => string,
): Map<string, number[]> {
  const groups = new Map<string, number[]>();
  for (let i = 0; i + parkedStride <= values.length; i += parkedStride)
    groups.set(key(i), [...(groups.get(key(i)) ?? []), i]);
  return groups;
}

function centreOf(values: Float32Array, indices: number[]): THREE.Vector3 {
  const sum = new THREE.Vector3();
  for (const source of indices) sum.add(parkedAt(values, source).at);
  return sum.multiplyScalar(1 / Math.max(indices.length, 1));
}

function region(
  values: Float32Array,
  indices: number[],
  shells: THREE.BufferGeometry[],
  shade: THREE.Material,
): THREE.Group {
  const origin = centreOf(values, indices);
  const group = new THREE.Group();
  group.position.copy(origin);
  const byKind = new Map<number, number[]>();
  for (const source of indices) {
    const kind = parkedAt(values, source).kind;
    byKind.set(kind, [...(byKind.get(kind) ?? []), source]);
  }
  const matrix = new THREE.Matrix4();
  const turn = new THREE.Quaternion();
  const yAxis = new THREE.Vector3(0, 1, 0);
  const unit = new THREE.Vector3(1, 1, 1);
  const colour = new THREE.Color();
  for (const [kind, sources] of byKind) {
    const shell = shells[kind] ?? shells[0];
    if (!shell) continue;
    const mesh = new THREE.InstancedMesh(shell, shade, sources.length);
    sources.forEach((source, k) => {
      const car = parkedAt(values, source);
      turn.setFromAxisAngle(yAxis, car.turn);
      mesh.setMatrixAt(
        k,
        matrix.compose(car.at.clone().sub(origin), turn, unit),
      );
      mesh.setColorAt(k, colour.setRGB(...car.paint));
    });
    mesh.computeBoundingSphere();
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.name = "parked cars";
    group.add(mesh);
  }
  return group;
}

export class CarParks {
  readonly root = new THREE.Group();

  private constructor(values: Float32Array) {
    const shells = bodies.map(shellOf);
    const paint = parkedMaterial();
    for (const indices of grouped(values, (i) =>
      keyOf(values, i, regionSize),
    ).values())
      this.root.add(region(values, indices, shells, paint));
  }

  static async load(url: string): Promise<CarParks> {
    const response = await fetch(url);
    return new CarParks(new Float32Array(await response.arrayBuffer()));
  }
}
