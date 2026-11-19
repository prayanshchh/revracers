import * as THREE from "three/webgpu";
import {
  attribute,
  float,
  fract,
  fwidth,
  mix,
  mx_fractal_noise_float,
  select,
  smoothstep,
  step,
  vec3,
} from "three/tsl";

interface Tower {
  outline: number[];
  base: number;
  low: number;
  height: number;
  tone: number;
}

interface Tank {
  at: [number, number];
  base: number;
  height: number;
}

interface Line {
  points: number[];
  height: number;
}

export interface SkylinePlan {
  towers: Tower[];
  tanks: Tank[];
  lines: Line[];
  woods: number[];
}

const storey = 3.9;
const stoneRough = 0.75;
const glassRough = 0.18;
const stoneMetal = 0.02;
const glassMetal = 0.55;
const plantFrom = 80;
const plantInset = 0.62;
const plantHeight = [4, 9] as const;
const glassShare = 0.62;
const facades: [number, number, number][] = [
  [0.2, 0.25, 0.31],
  [0.3, 0.33, 0.37],
  [0.52, 0.52, 0.5],
  [0.5, 0.45, 0.37],
  [0.1, 0.12, 0.15],
];
const facadeEdges = [0.3, 0.55, 0.78, 0.9];
const tankWhite: [number, number, number] = [0.62, 0.64, 0.64];
const tankProfile: [number, number][] = [
  [3.2, 0],
  [2.2, 2],
  [1.9, 24],
  [3.5, 29],
  [8.2, 33],
  [9.6, 36.5],
  [8.6, 40],
  [4.5, 41.6],
  [0.6, 42],
];
const tankSides = 18;
const steel: [number, number, number] = [0.46, 0.47, 0.48];
const pylonFoot = 3.2;
const pylonNeck = 0.9;
const pylonLeg = 0.14;
const armSpans = [
  [0.78, 4.2],
  [0.92, 3.0],
];
const sag = 0.035;
const woodStride = 12;
const canopy: [number, number, number] = [0.045, 0.052, 0.03];
const canopyFoot = 0.75;
const crownFloor = 0.55;
const crownDepth = 0.4;
const crownSpan = 6;
const canopyCrown = 1.3;
const canopySpread = 0.3;
const wireSteps = 10;
const wireColour = 0x6a6e73;

class Geometry {
  readonly positions: number[] = [];
  readonly normals: number[] = [];
  readonly colours: number[] = [];
  readonly levels: number[] = [];
  readonly crowns: number[] = [];

  vertex(
    at: [number, number, number],
    normal: [number, number, number],
    colour: [number, number, number],
    level: number,
    crown?: [number, number],
  ): void {
    this.positions.push(...at);
    this.normals.push(...normal);
    this.colours.push(...colour);
    this.levels.push(level);
    this.crowns.push(...(crown ?? [0, -1]));
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
      "facade",
      new THREE.Float32BufferAttribute(this.colours, 3),
    );
    geometry.setAttribute(
      "crown",
      new THREE.Float32BufferAttribute(this.crowns, 2),
    );
    geometry.setAttribute(
      "storey",
      new THREE.Float32BufferAttribute(this.levels, 1),
    );
    geometry.computeBoundingSphere();
    return geometry;
  }
}

function facadeOf(tone: number): [number, number, number] {
  const index = facadeEdges.findIndex((edge) => tone < edge);
  return facades[index < 0 ? facades.length - 1 : index] ?? tankWhite;
}

function ringOf(outline: number[]): THREE.Vector2[] {
  const ring: THREE.Vector2[] = [];
  for (let i = 0; i + 1 < outline.length; i += 2)
    ring.push(new THREE.Vector2(outline[i] ?? 0, outline[i + 1] ?? 0));
  return THREE.ShapeUtils.isClockWise(ring) ? ring : ring.reverse();
}

function plant(geometry: Geometry, tower: Tower): void {
  if (tower.height < plantFrom || tower.low > 0) return;
  const ring = ringOf(tower.outline);
  const middle = ring
    .reduce((sum, p) => sum.add(p), new THREE.Vector2())
    .multiplyScalar(1 / ring.length);
  const inset = ring.map((p) => middle.clone().lerp(p, plantInset));
  const [low, high] = plantHeight;
  const rise = low + (high - low) * ((tower.tone * 7.31) % 1);
  const outline = inset.flatMap((p) => [p.x, p.y]);
  extrude(geometry, {
    outline,
    base: tower.base + tower.height,
    low: 0,
    height: rise,
    tone: 0.7,
  });
}

function extrude(geometry: Geometry, tower: Tower): void {
  const ring = ringOf(tower.outline);
  const bottom = tower.base + tower.low;
  const top = tower.base + tower.height;
  const colour = facadeOf(tower.tone);
  const glazed = tower.tone < glassShare ? 1 : 0;
  ring.forEach((a, i) => {
    const b = ring[(i + 1) % ring.length] ?? a;
    const edge = b.clone().sub(a);
    const length = edge.length();
    if (length < 1e-3) return;
    const normal: [number, number, number] = [
      -edge.y / length,
      0,
      edge.x / length,
    ];
    const corners: [THREE.Vector2, number][] = [
      [a, bottom],
      [b, bottom],
      [b, top],
      [a, bottom],
      [b, top],
      [a, top],
    ];
    for (const [p, y] of corners)
      geometry.vertex(
        [p.x, y, p.y],
        normal,
        colour,
        glazed ? y - tower.base : -1,
      );
  });
  const roof = colour.map((c) => c * 0.8) as [number, number, number];
  for (const corners of THREE.ShapeUtils.triangulateShape(ring, [])) {
    const [a, b, c] = corners.map(
      (index) => ring[index] ?? new THREE.Vector2(),
    );
    if (!a || !b || !c) continue;
    const turn = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    for (const p of turn < 0 ? [a, b, c] : [a, c, b])
      geometry.vertex([p.x, top, p.y], [0, 1, 0], roof, -1);
  }
}

function tank(geometry: Geometry, spot: Tank): void {
  const [x, z] = spot.at;
  const scale = spot.height / 42;
  const ring = (radius: number, rise: number, turn: number) => {
    const angle = (turn / tankSides) * Math.PI * 2;
    return {
      at: [
        x + Math.cos(angle) * radius * scale,
        spot.base + rise * scale,
        z + Math.sin(angle) * radius * scale,
      ] as [number, number, number],
      angle,
    };
  };
  for (let k = 0; k + 1 < tankProfile.length; k++) {
    const [r0 = 0, h0 = 0] = tankProfile[k] ?? [];
    const [r1 = 0, h1 = 0] = tankProfile[k + 1] ?? [];
    const slope = Math.atan2(r0 - r1, h1 - h0);
    for (let turn = 0; turn < tankSides; turn++) {
      const quad = [
        ring(r0, h0, turn),
        ring(r1, h1, turn + 1),
        ring(r1, h1, turn),
        ring(r0, h0, turn),
        ring(r0, h0, turn + 1),
        ring(r1, h1, turn + 1),
      ];
      for (const { at, angle } of quad)
        geometry.vertex(
          at,
          [
            Math.cos(angle) * Math.cos(slope),
            Math.sin(slope),
            Math.sin(angle) * Math.cos(slope),
          ],
          tankWhite,
          -1,
        );
    }
  }
}

type Vec = [number, number, number];

function beam(geometry: Geometry, from: Vec, to: Vec, width: number): void {
  const a = new THREE.Vector3(...from);
  const b = new THREE.Vector3(...to);
  const along = b.clone().sub(a).normalize();
  const side = new THREE.Vector3(0, 1, 0).cross(along);
  if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
  side.normalize().multiplyScalar(width / 2);
  const lift = along
    .clone()
    .cross(side)
    .normalize()
    .multiplyScalar(width / 2);
  const ring = [side, lift, side.clone().negate(), lift.clone().negate()];
  ring.forEach((offset, i) => {
    const next = ring[(i + 1) % ring.length] ?? offset;
    const normal = offset.clone().add(next).normalize();
    const corners = [
      a.clone().add(offset),
      b.clone().add(offset),
      b.clone().add(next),
      a.clone().add(offset),
      b.clone().add(next),
      a.clone().add(next),
    ];
    for (const p of corners)
      geometry.vertex(
        [p.x, p.y, p.z],
        [normal.x, normal.y, normal.z],
        steel,
        -1,
      );
  });
}

function pointsOf(line: Line): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  for (let i = 0; i + 2 < line.points.length; i += 3)
    points.push(
      new THREE.Vector3(
        line.points[i] ?? 0,
        line.points[i + 1] ?? 0,
        line.points[i + 2] ?? 0,
      ),
    );
  return points;
}

function crossingAt(points: THREE.Vector3[], index: number): THREE.Vector3 {
  const before = points[Math.max(0, index - 1)] ?? new THREE.Vector3();
  const after =
    points[Math.min(points.length - 1, index + 1)] ?? new THREE.Vector3();
  const along = after.clone().sub(before).setY(0).normalize();
  return new THREE.Vector3(-along.z, 0, along.x);
}

function pylon(
  geometry: Geometry,
  base: THREE.Vector3,
  across: THREE.Vector3,
  height: number,
): THREE.Vector3[] {
  const along = new THREE.Vector3(-across.z, 0, across.x);
  const corner = (share: number, a: number, b: number) =>
    base
      .clone()
      .addScaledVector(across, a * share)
      .addScaledVector(along, b * share);
  const top = base.clone().setY(base.y + height);
  const legs: [number, number][] = [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ];
  for (const [a, b] of legs) {
    const foot = corner(pylonFoot / 2, a, b);
    const neck = corner(pylonNeck / 2, a, b).setY(top.y);
    beam(
      geometry,
      [foot.x, foot.y, foot.z],
      [neck.x, neck.y, neck.z],
      pylonLeg,
    );
  }
  const hooks: THREE.Vector3[] = [];
  for (const [rise = 0, reach = 0] of armSpans) {
    const y = base.y + height * rise;
    const left = base.clone().addScaledVector(across, reach).setY(y);
    const right = base.clone().addScaledVector(across, -reach).setY(y);
    beam(geometry, [left.x, y, left.z], [right.x, y, right.z], pylonLeg);
    hooks.push(left, right);
  }
  return hooks.slice(0, 3);
}

function wires(spans: THREE.Vector3[][], positions: number[]): void {
  for (let k = 0; k + 1 < spans.length; k++) {
    const here = spans[k] ?? [];
    const next = spans[k + 1] ?? [];
    here.forEach((a, wire) => {
      const b = next[wire];
      if (!b) return;
      const drop = a.distanceTo(b) * sag;
      for (let step = 0; step < wireSteps; step++) {
        for (const t of [step / wireSteps, (step + 1) / wireSteps]) {
          const p = a.clone().lerp(b, t);
          positions.push(p.x, p.y - 4 * drop * t * (1 - t), p.z);
        }
      }
    });
  }
}

function gridLine(geometry: Geometry, line: Line, positions: number[]): void {
  const points = pointsOf(line);
  const hooks = points.map((base, index) =>
    pylon(geometry, base, crossingAt(points, index), line.height),
  );
  wires(hooks, positions);
}

function conductors(positions: number[]): THREE.LineSegments {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.computeBoundingSphere();
  return new THREE.LineSegments(
    geometry,
    new THREE.LineBasicNodeMaterial({ color: wireColour }),
  );
}

function wall(geometry: Geometry, values: number[], seed: number): void {
  const at = (k: number) => values[k] ?? 0;
  const feet: Vec[] = [0, 3, 6].map((k) => [at(k), at(k + 1), at(k + 2)]);
  const rises = [at(9), at(10), at(11)];
  const shade = 1 + (((seed * 0.6180339) % 1) - 0.5) * canopySpread;
  const low = canopy.map((c) => c * shade * canopyFoot) as Vec;
  const high = canopy.map((c) => c * shade * canopyCrown) as Vec;
  for (let k = 0; k < 2; k++) {
    const [ax, ay, az] = feet[k] ?? [0, 0, 0];
    const [bx, by, bz] = feet[k + 1] ?? [0, 0, 0];
    const run = Math.hypot(bx - ax, bz - az) || 1;
    const normal: Vec = [(bz - az) / run, 0, -(bx - ax) / run];
    const ah = ay + (rises[k] ?? 0);
    const bh = by + (rises[k + 1] ?? 0);
    const from = seed * 13.1 + k * run;
    const points: [Vec, Vec, [number, number]][] = [
      [[ax, ay, az], low, [from, 0]],
      [[bx, by, bz], low, [from + run, 0]],
      [[bx, bh, bz], high, [from + run, 1]],
      [[ax, ay, az], low, [from, 0]],
      [[bx, bh, bz], high, [from + run, 1]],
      [[ax, ah, az], high, [from, 1]],
    ];
    for (const [p, colour, crown] of points)
      geometry.vertex(p, normal, colour, -1, crown);
  }
}

function woods(geometry: Geometry, walls: number[]): void {
  for (let i = 0; i + woodStride <= walls.length; i += woodStride)
    wall(geometry, walls.slice(i, i + woodStride), i);
}

function material(): THREE.MeshStandardNodeMaterial {
  const shade = new THREE.MeshStandardNodeMaterial({
    roughness: 0.45,
    metalness: 0.3,
    side: THREE.DoubleSide,
  });
  const level = attribute("storey", "float");
  const floors = level.div(storey);
  const band = smoothstep(0.62, 0.72, fract(floors));
  const seen = float(1).sub(smoothstep(0.25, 0.6, fwidth(floors)));
  const spandrel = mix(float(1), mix(float(0.78), float(1.12), band), seen);
  const facade = attribute("facade", "vec3");
  const glass = step(0, level);
  shade.colorNode = select(
    level.lessThan(0),
    facade,
    facade.mul(vec3(spandrel)),
  );
  const crown = attribute("crown", "vec2");
  const edge = float(crownFloor).add(
    mx_fractal_noise_float(vec3(crown.x.div(crownSpan), 0, 0), 3)
      .mul(crownDepth)
      .add(crownDepth / 2),
  );
  shade.opacityNode = select(crown.y.greaterThan(edge), float(0), float(1));
  shade.alphaTest = 0.5;
  shade.roughnessNode = mix(float(stoneRough), float(glassRough), glass);
  shade.metalnessNode = mix(float(stoneMetal), float(glassMetal), glass);
  return shade;
}

export class Skyline {
  readonly root = new THREE.Group();

  private constructor(plan: SkylinePlan) {
    const geometry = new Geometry();
    for (const tower of plan.towers) {
      extrude(geometry, tower);
      plant(geometry, tower);
    }
    for (const spot of plan.tanks) tank(geometry, spot);
    woods(geometry, plan.woods);
    const strung: number[] = [];
    for (const line of plan.lines) gridLine(geometry, line, strung);
    const mesh = new THREE.Mesh(geometry.build(), material());
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.name = "skyline";
    this.root.add(mesh, conductors(strung));
  }

  static async load(url: string): Promise<Skyline> {
    const response = await fetch(url);
    return new Skyline((await response.json()) as SkylinePlan);
  }
}
