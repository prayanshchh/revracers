import * as THREE from "three/webgpu";
import { pitKitMaterial } from "./street-materials.ts";
import { Mesh } from "./street-shell.ts";

export interface Entrance {
  x: number;
  y: number;
  z: number;
  facing: number;
  width: number;
  depth: number;
  height: number;
  kind: "portico" | "canopy";
}

type Rgb = [number, number, number];

interface Paint {
  colour: Rgb;
  glow: number;
}

const stone: Paint = { colour: [0.5, 0.45, 0.37], glow: 0.2 };
const stoneLit: Paint = { colour: [0.56, 0.5, 0.4], glow: 0.46 };
const stoneDeep: Paint = { colour: [0.4, 0.35, 0.28], glow: 0.22 };
const metal: Paint = { colour: [0.07, 0.07, 0.08], glow: 0.02 };
const bronze: Paint = { colour: [0.16, 0.11, 0.06], glow: 0.12 };
const soffit: Paint = { colour: [1, 0.9, 0.72], glow: 0.85 };
const doors: Paint = { colour: [1, 0.8, 0.52], glow: 0.62 };
const transom: Paint = { colour: [0.9, 0.7, 0.45], glow: 0.3 };
const trim: Paint = { colour: [1, 0.8, 0.42], glow: 1.9 };
const paving: Paint = { colour: [0.3, 0.29, 0.27], glow: 0.05 };
const carpet: Paint = { colour: [0.42, 0.03, 0.05], glow: 0.35 };
const poolGlow = 0.55;
const poolReach = 7;
const poolLift = 0.1;
const slabDepth = 0.9;
const columnSides = 12;
const columnRadius = 0.5;
const columnPitch = 4.4;
const capital = 0.74;
const stepRise = 0.22;
const pedimentPitch = 0.15;
const lobbyShare = 0.8;
const doorHeight = 2.9;
const mullionPitch = 2.4;
const mullion = 0.07;
const trimSize = 0.28;
const unit: [number, number][] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

class Frame {
  readonly out: THREE.Vector3;
  private readonly origin: THREE.Vector3;
  private readonly side: THREE.Vector3;

  constructor(
    private readonly mesh: Mesh,
    entrance: Entrance,
  ) {
    this.origin = new THREE.Vector3(entrance.x, entrance.y, entrance.z);
    this.out = new THREE.Vector3(
      Math.cos(entrance.facing),
      0,
      -Math.sin(entrance.facing),
    );
    this.side = new THREE.Vector3(this.out.z, 0, -this.out.x);
  }

  at(a: number, b: number, h: number): number[] {
    const p = this.origin
      .clone()
      .addScaledVector(this.side, a)
      .addScaledVector(this.out, b);
    return [p.x, p.y + h, p.z];
  }

  face(corners: number[][], normal: number[], paint: Paint): void {
    const [r, g, b] = paint.colour;
    this.mesh.quad(corners, normal, unit, [r, g], [b, paint.glow]);
  }

  fade(corners: number[][], paint: Paint, glows: number[]): void {
    const [r, g, b] = paint.colour;
    const first = corners.map((corner, k) =>
      this.mesh.vertex(
        corner,
        [0, 1, 0],
        unit[k] ?? [0, 0],
        [r, g],
        [b, glows[k] ?? 0],
      ),
    )[0];
    if (first === undefined) return;
    this.mesh.index.push(
      first,
      first + 1,
      first + 2,
      first,
      first + 2,
      first + 3,
    );
  }

  front(corners: number[][], paint: Paint): void {
    this.face(corners, [this.out.x, 0, this.out.z], paint);
  }

  box(
    centre: [number, number, number],
    half: [number, number, number],
    paint: Paint,
    under: Paint = paint,
  ): void {
    const [a, b, h] = centre;
    const [ha, hb, hh] = half;
    const corner = (i: number, j: number, k: number) =>
      this.at(a + i * ha, b + j * hb, h + k * hh);
    const { out, side } = this;
    this.front(
      [corner(-1, 1, -1), corner(1, 1, -1), corner(1, 1, 1), corner(-1, 1, 1)],
      paint,
    );
    this.face(
      [
        corner(1, -1, -1),
        corner(-1, -1, -1),
        corner(-1, -1, 1),
        corner(1, -1, 1),
      ],
      [-out.x, 0, -out.z],
      paint,
    );
    for (const sign of [-1, 1])
      this.face(
        [
          corner(sign, -1, -1),
          corner(sign, 1, -1),
          corner(sign, 1, 1),
          corner(sign, -1, 1),
        ],
        [side.x * sign, 0, side.z * sign],
        paint,
      );
    this.face(
      [corner(-1, -1, 1), corner(1, -1, 1), corner(1, 1, 1), corner(-1, 1, 1)],
      [0, 1, 0],
      paint,
    );
    this.face(
      [
        corner(-1, -1, -1),
        corner(1, -1, -1),
        corner(1, 1, -1),
        corner(-1, 1, -1),
      ],
      [0, -1, 0],
      under,
    );
  }

  column(a: number, b: number, low: number, high: number, paint: Paint): void {
    for (let k = 0; k < columnSides; k++) {
      const t0 = (k / columnSides) * Math.PI * 2;
      const t1 = ((k + 1) / columnSides) * Math.PI * 2;
      const p = (t: number, h: number, r: number) =>
        this.at(a + Math.cos(t) * r, b + Math.sin(t) * r, h);
      const mid = (t0 + t1) / 2;
      const n = this.side
        .clone()
        .multiplyScalar(Math.cos(mid))
        .addScaledVector(this.out, Math.sin(mid));
      const taper = columnRadius * 0.86;
      this.face(
        [
          p(t0, low, columnRadius),
          p(t1, low, columnRadius),
          p(t1, high, taper),
          p(t0, high, taper),
        ],
        [n.x, 0, n.z],
        paint,
      );
    }
  }

  pool(width: number, depth: number, lift: number): void {
    const half = width / 2;
    const far = depth + poolReach;
    const wide = half + poolReach;
    const at = (a: number, b: number) => this.at(a, b, lift);
    this.fade(
      [at(-half, 0.3), at(half, 0.3), at(half, far), at(-half, far)],
      paving,
      [poolGlow, poolGlow, 0, 0],
    );
    for (const sign of [-1, 1])
      this.fade(
        [
          at(sign * half, 0.3),
          at(sign * wide, 0.3),
          at(sign * wide, far),
          at(sign * half, far),
        ],
        paving,
        [poolGlow, 0, 0, 0],
      );
  }
}

function glazing(frame: Frame, entrance: Entrance, floor: number): void {
  const half = (entrance.width * lobbyShare) / 2;
  const top = entrance.height - 0.4;
  const split = Math.min(floor + doorHeight, top - 0.6);
  const pane = (low: number, high: number, paint: Paint) => {
    frame.front(
      [
        frame.at(-half, 0.2, low),
        frame.at(half, 0.2, low),
        frame.at(half, 0.2, high),
        frame.at(-half, 0.2, high),
      ],
      paint,
    );
  };
  pane(floor, split, doors);
  pane(split, top, transom);
  const bays = Math.max(2, Math.round((half * 2) / mullionPitch));
  for (let k = 0; k <= bays; k++)
    frame.box(
      [-half + (k / bays) * half * 2, 0.27, (floor + top) / 2],
      [mullion, mullion, (top - floor) / 2],
      bronze,
    );
  for (const h of [split, top])
    frame.box([0, 0.27, h], [half + mullion, mullion, mullion], bronze);
}

function canopy(frame: Frame, entrance: Entrance): void {
  const { width, depth, height } = entrance;
  frame.pool(width, depth, poolLift);
  frame.box([0, depth / 2, 0.06], [width / 2, depth / 2, 0.06], paving);
  frame.box([0, depth / 2, 0.13], [1.6, depth / 2, 0.01], carpet);
  frame.box(
    [0, depth / 2, height + slabDepth / 2],
    [width / 2, depth / 2, slabDepth / 2],
    metal,
    soffit,
  );
  frame.box(
    [0, depth + trimSize / 2, height + slabDepth / 2],
    [width / 2 + trimSize, trimSize / 2, trimSize / 2],
    trim,
  );
  for (const sign of [-1, 1]) {
    frame.box(
      [sign * (width / 2 + trimSize / 2), depth / 2, height + slabDepth / 2],
      [trimSize / 2, depth / 2, trimSize / 2],
      trim,
    );
    const a = sign * (width / 2 - 1.3);
    frame.box([a, depth - 1.3, height / 2], [0.5, 0.5, height / 2], stoneLit);
    frame.box([a, depth - 1.3, 0.35], [0.62, 0.62, 0.35], stone);
    frame.box([a, depth - 1.3, 1.2], [0.52, 0.52, 0.04], trim);
  }
  glazing(frame, entrance, 0.12);
}

function colonnade(frame: Frame, entrance: Entrance, floor: number): void {
  const { width, depth, height } = entrance;
  const count = Math.max(4, Math.round(width / columnPitch) + 1);
  for (let k = 0; k < count; k++) {
    const a = (k / (count - 1) - 0.5) * (width - 1.6);
    const b = depth - 1.1;
    frame.box([a, b, floor + 0.18], [capital, capital, 0.18], stone);
    frame.column(a, b, floor + 0.36, height - 0.36, stoneLit);
    frame.box(
      [a, b, height - 0.24],
      [capital * 0.86, capital * 0.86, 0.06],
      stoneLit,
    );
    frame.box([a, b, height - 0.09], [capital, capital, 0.09], stoneLit);
  }
}

function pediment(frame: Frame, entrance: Entrance, eave: number): void {
  const { width, depth } = entrance;
  const half = width / 2 + 0.45;
  const peak = eave + width * pedimentPitch;
  frame.front(
    [
      frame.at(-half, depth + 0.3, eave),
      frame.at(half, depth + 0.3, eave),
      frame.at(0, depth + 0.3, peak),
      frame.at(0, depth + 0.3, peak),
    ],
    stoneLit,
  );
  const inset = half - 1.5;
  frame.front(
    [
      frame.at(-inset, depth + 0.32, eave + 0.3),
      frame.at(inset, depth + 0.32, eave + 0.3),
      frame.at(0, depth + 0.32, eave + 0.3 + inset * 2 * pedimentPitch * 0.86),
      frame.at(0, depth + 0.32, eave + 0.3 + inset * 2 * pedimentPitch * 0.86),
    ],
    stoneDeep,
  );
  for (const sign of [-1, 1])
    frame.face(
      [
        frame.at(sign * half, depth + 0.3, eave),
        frame.at(0, depth + 0.3, peak),
        frame.at(0, 0, peak),
        frame.at(sign * half, 0, eave),
      ],
      [0, 1, 0],
      stoneDeep,
    );
}

function portico(frame: Frame, entrance: Entrance): void {
  const { width, depth, height } = entrance;
  const floor = stepRise * 3;
  frame.pool(width + 3, depth + 1.5, poolLift);
  for (let k = 0; k < 3; k++) {
    const grow = (2 - k) * 0.55;
    frame.box(
      [0, (depth + grow) / 2, stepRise * (k + 0.5)],
      [width / 2 + 0.4 + grow, (depth + grow) / 2, stepRise / 2],
      k === 2 ? stoneLit : stone,
    );
  }
  frame.box(
    [0, depth / 2 + 0.8, floor + 0.01],
    [1.5, depth / 2 + 0.8, 0.01],
    carpet,
  );
  colonnade(frame, entrance, floor);
  const beam = 0.42;
  frame.box(
    [0, depth / 2, height + beam],
    [width / 2 + 0.2, depth / 2 + 0.05, beam],
    stone,
    soffit,
  );
  frame.box(
    [0, depth / 2, height + beam * 2 + 0.3],
    [width / 2 + 0.26, depth / 2 + 0.1, 0.3],
    stoneLit,
  );
  const eave = height + beam * 2 + 0.6;
  frame.box(
    [0, depth / 2 + 0.1, eave + 0.13],
    [width / 2 + 0.5, depth / 2 + 0.3, 0.13],
    stoneLit,
  );
  pediment(frame, entrance, eave + 0.26);
  glazing(frame, entrance, floor);
}

export function entranceMesh(entrances: Entrance[]): THREE.Mesh {
  const mesh = new Mesh();
  for (const entrance of entrances) {
    const frame = new Frame(mesh, entrance);
    if (entrance.kind === "portico") portico(frame, entrance);
    else canopy(frame, entrance);
  }
  const material = pitKitMaterial();
  material.side = THREE.DoubleSide;
  const result = new THREE.Mesh(mesh.geometry(), material);
  result.name = "city_entrances";
  result.castShadow = false;
  return result;
}
