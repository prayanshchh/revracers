import * as THREE from "three/webgpu";
import {
  attribute,
  cameraPosition,
  float,
  mix,
  modelWorldMatrix,
  positionLocal,
  select,
  vec3,
  vec4,
} from "three/tsl";

export const parkedStride = 6;
const tileSize = 400;
const regionSize = 1600;
const nearReach = 320;
const tileReach = nearReach + tileSize * 0.75;
const farGlass: [number, number, number] = [0.2, 0.25, 0.32];
const farSide = 0.72;

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

  quad(corners: Corner[], tinted: number): void {
    const [a, b, c, d] = corners;
    if (!a || !b || !c || !d) return;
    const u = new THREE.Vector3(...b).sub(new THREE.Vector3(...a));
    const v = new THREE.Vector3(...d).sub(new THREE.Vector3(...a));
    const normal = u.cross(v).normalize();
    for (const p of [a, b, c, a, c, d]) {
      this.positions.push(...p);
      this.normals.push(normal.x, normal.y, normal.z);
      this.glass.push(tinted);
    }
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

function shown(centre: THREE.Node<"vec3">, near: boolean): THREE.Node<"vec3"> {
  const world = modelWorldMatrix.mul(vec4(centre, 1)).xyz;
  const close = world.distance(cameraPosition).lessThan(nearReach);
  const hide = near ? close.not() : close;
  return select(hide, vec3(0), positionLocal);
}

function nearMaterial(): THREE.MeshStandardNodeMaterial {
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

function farMaterial(): THREE.MeshStandardNodeMaterial {
  const paint = new THREE.MeshStandardNodeMaterial({
    roughness: 0.35,
    metalness: 0.3,
    vertexColors: true,
  });
  paint.positionNode = shown(attribute("centre", "vec3"), false);
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

class Crosses {
  readonly positions: number[] = [];
  readonly colours: number[] = [];
  readonly centres: number[] = [];
  readonly index: number[] = [];

  add(car: Parked, origin: THREE.Vector3): void {
    const along = new THREE.Vector3(Math.cos(car.turn), 0, -Math.sin(car.turn));
    const across = new THREE.Vector3(Math.sin(car.turn), 0, Math.cos(car.turn));
    const centre = car.at.clone().sub(origin);
    const { length, width, sill, roof } = car.body;
    const side = car.paint.map((c) => c * farSide) as [number, number, number];
    const corner = (a: number, c: number, y: number) =>
      centre
        .clone()
        .addScaledVector(along, a)
        .addScaledVector(across, c)
        .setY(centre.y + y);
    const quads: [THREE.Vector3[], [number, number, number][]][] = [
      [
        [
          corner(-length / 2, -width / 2, roof),
          corner(length / 2, -width / 2, roof),
          corner(length / 2, width / 2, roof),
          corner(-length / 2, width / 2, roof),
        ],
        [car.paint, car.paint, car.paint, car.paint],
      ],
      [
        [
          corner(-length / 2, 0, sill),
          corner(length / 2, 0, sill),
          corner(length / 2, 0, roof),
          corner(-length / 2, 0, roof),
        ],
        [side, side, farGlass, farGlass],
      ],
      [
        [
          corner(0, -width / 2, sill),
          corner(0, width / 2, sill),
          corner(0, width / 2, roof),
          corner(0, -width / 2, roof),
        ],
        [side, side, farGlass, farGlass],
      ],
    ];
    for (const [corners, tints] of quads) {
      const first = this.positions.length / 3;
      corners.forEach((p, k) => {
        this.positions.push(p.x, p.y, p.z);
        this.colours.push(...(tints[k] ?? car.paint));
        this.centres.push(centre.x, centre.y, centre.z);
      });
      this.index.push(first, first + 1, first + 2, first, first + 2, first + 3);
    }
  }

  build(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(this.positions, 3),
    );
    geometry.setAttribute(
      "color",
      new THREE.Float32BufferAttribute(this.colours, 3),
    );
    geometry.setAttribute(
      "centre",
      new THREE.Float32BufferAttribute(this.centres, 3),
    );
    geometry.setIndex(this.index);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
  }
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

function farRegion(
  values: Float32Array,
  indices: number[],
  shade: THREE.Material,
): THREE.Mesh {
  const origin = centreOf(values, indices);
  const crosses = new Crosses();
  for (const source of indices) crosses.add(parkedAt(values, source), origin);
  const mesh = new THREE.Mesh(crosses.build(), shade);
  mesh.position.copy(origin);
  mesh.name = "parked cars far";
  return mesh;
}

function nearTile(
  values: Float32Array,
  indices: number[],
  shells: THREE.BufferGeometry[],
  shade: THREE.Material,
): THREE.LOD {
  const origin = centreOf(values, indices);
  const levels = new THREE.LOD();
  levels.position.copy(origin);
  const byKind = new Map<number, number[]>();
  for (const source of indices) {
    const kind = parkedAt(values, source).kind;
    byKind.set(kind, [...(byKind.get(kind) ?? []), source]);
  }
  const group = new THREE.Group();
  const matrix = new THREE.Matrix4();
  const turn = new THREE.Quaternion();
  const yAxis = new THREE.Vector3(0, 1, 0);
  const colour = new THREE.Color();
  for (const [kind, sources] of byKind) {
    const shell = shells[kind] ?? shells[0];
    if (!shell) continue;
    const mesh = new THREE.InstancedMesh(shell, shade, sources.length);
    const centres = new Float32Array(sources.length * 3);
    sources.forEach((source, k) => {
      const car = parkedAt(values, source);
      const at = car.at.clone().sub(origin);
      turn.setFromAxisAngle(yAxis, car.turn);
      mesh.setMatrixAt(k, matrix.compose(at, turn, new THREE.Vector3(1, 1, 1)));
      mesh.setColorAt(k, colour.setRGB(...car.paint));
      centres.set([at.x, at.y, at.z], k * 3);
    });
    mesh.geometry = shell.clone();
    mesh.geometry.setAttribute(
      "centre",
      new THREE.InstancedBufferAttribute(centres, 3),
    );
    mesh.computeBoundingSphere();
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.name = "parked cars near";
    group.add(mesh);
  }
  levels.addLevel(group, 0);
  levels.addLevel(new THREE.Object3D(), tileReach);
  return levels;
}

export class CarParks {
  readonly root = new THREE.Group();

  private constructor(values: Float32Array) {
    const shells = bodies.map(shellOf);
    const near = nearMaterial();
    near.positionNode = shown(attribute("centre", "vec3"), true);
    const far = farMaterial();
    for (const indices of grouped(values, (i) =>
      keyOf(values, i, regionSize),
    ).values())
      this.root.add(farRegion(values, indices, far));
    for (const indices of grouped(values, (i) =>
      keyOf(values, i, tileSize),
    ).values())
      this.root.add(nearTile(values, indices, shells, near));
  }

  static async load(url: string): Promise<CarParks> {
    const response = await fetch(url);
    return new CarParks(new Float32Array(await response.arrayBuffer()));
  }
}
