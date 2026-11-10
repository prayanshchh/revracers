export type V3 = [number, number, number];

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export const smooth = (x: number) => {
  const c = clamp01(x);
  return c * c * (3 - 2 * c);
};
export const span = (t: number, from: number, to: number) =>
  smooth((t - from) / Math.max(1e-6, to - from));
export const drive = (t: number, from: number, to: number) => {
  const c = clamp01((t - from) / Math.max(1e-6, to - from));
  return c * c * (0.4 + 0.6 * c);
};
export const mix = (a: number, b: number, k: number) => a + (b - a) * k;
export const mixV = (a: V3, b: V3, k: number): V3 => [
  mix(a[0], b[0], k),
  mix(a[1], b[1], k),
  mix(a[2], b[2], k),
];

function noise(seed: number, k: number): number {
  const s = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

export function wander(time: number, seed: number, rate: number): number {
  return (
    0.6 * Math.sin(time * rate + seed * 3.1) +
    0.4 * Math.sin(time * rate * 2.3 + seed * 7.7)
  );
}

export function calmed(draft: Draft, calm: Draft, k: number): void {
  if (k >= 1) return;
  pose(draft, calm, 1 - k);
  draft.hands = [
    blendHand(calm.hands[0], draft.hands[0], k, 0),
    blendHand(calm.hands[1], draft.hands[1], k, 1),
  ];
}

export class Follow {
  private y = 0;
  private v = 0;
  private x = 0;
  private live = false;
  private readonly k1: number;
  private readonly k2: number;
  private readonly k3: number;

  constructor(frequency: number, damping: number, response: number) {
    const w = 2 * Math.PI * frequency;
    this.k1 = damping / (Math.PI * frequency);
    this.k2 = 1 / (w * w);
    this.k3 = (response * damping) / w;
  }

  reset(x: number): number {
    this.y = this.x = x;
    this.v = 0;
    this.live = true;
    return x;
  }

  step(x: number, dt: number): number {
    if (!this.live || dt <= 0) return this.live ? this.y : this.reset(x);
    const rate = (x - this.x) / dt;
    this.x = x;
    const stable = Math.max(
      this.k2,
      (dt * dt) / 2 + (dt * this.k1) / 2,
      dt * this.k1,
    );
    this.y += dt * this.v;
    this.v += (dt * (x + this.k3 * rate - this.y - this.k1 * this.v)) / stable;
    return this.y;
  }
}

export class Follow3 {
  private readonly axes: [Follow, Follow, Follow];

  constructor(frequency: number, damping: number, response: number) {
    this.axes = [
      new Follow(frequency, damping, response),
      new Follow(frequency, damping, response),
      new Follow(frequency, damping, response),
    ];
  }

  reset(x: V3): V3 {
    return this.each(x, (axis, value) => axis.reset(value));
  }

  step(x: V3, dt: number): V3 {
    return this.each(x, (axis, value) => axis.step(value, dt));
  }

  private each(x: V3, run: (axis: Follow, value: number) => number): V3 {
    const [a, b, c] = this.axes;
    return [run(a, x[0]), run(b, x[1]), run(c, x[2])];
  }
}

export interface HandDraft {
  at: V3;
  pole: V3;
  fingers: V3 | null;
  palm: V3 | null;
  grip: number;
  hold?: number;
}

export interface FootDraft {
  ball: [number, number];
  heel: number;
  yaw: number;
  pole: V3;
}

export interface Draft {
  hips: V3;
  lean: number;
  twist: number;
  side: number;
  hands: [HandDraft, HandDraft];
  feet: [FootDraft, FootDraft];
  look: V3 | null;
}

export const relaxedFingers: V3 = [0.3, 0, -1];
export const relaxedPalms: [V3, V3] = [
  [0, -1, 0],
  [0, 1, 0],
];

export function blendHand(
  a: HandDraft,
  b: HandDraft,
  k: number,
  side: number,
): HandDraft {
  const palm = relaxedPalms[side] ?? relaxedFingers;
  return {
    at: mixV(a.at, b.at, k),
    pole: mixV(a.pole, b.pole, k),
    fingers: mixV(a.fingers ?? relaxedFingers, b.fingers ?? relaxedFingers, k),
    palm: mixV(a.palm ?? palm, b.palm ?? palm, k),
    grip: mix(a.grip, b.grip, k),
    hold: mix(a.hold ?? 0, b.hold ?? 0, k),
  };
}

export function blendFoot(a: FootDraft, b: FootDraft, k: number): FootDraft {
  return {
    ball: [mix(a.ball[0], b.ball[0], k), mix(a.ball[1], b.ball[1], k)],
    heel: mix(a.heel, b.heel, k),
    yaw: mix(a.yaw, b.yaw, k),
    pole: mixV(a.pole, b.pole, k),
  };
}

export function hand(at: V3, pole: V3, grip = 0.25): HandDraft {
  return { at, pole, fingers: null, palm: null, grip };
}

export function foot(
  ball: [number, number],
  pole: V3,
  heel = 0,
  yaw = 0,
): FootDraft {
  return { ball, heel, yaw, pole };
}

export interface Stance {
  hips: V3;
  lean: number;
  twist: number;
  side: number;
  feet: [FootDraft, FootDraft];
}

type Step = [number, number, number, number];

export function stance(
  hips: V3,
  lean: number,
  twist: number,
  left: Step,
  right: Step,
): Stance {
  const knee = (heel: number, side: number): V3 =>
    heel > 0.3 ? [1, side * 0.25, -0.15] : [1, side * 0.45, 0.1];
  return {
    hips,
    lean,
    twist,
    side: 0,
    feet: [
      foot([left[0], left[1]], knee(left[3], 1), left[3], left[2]),
      foot([right[0], right[1]], knee(right[3], -1), right[3], right[2]),
    ],
  };
}

export function blendStance(a: Stance, b: Stance, k: number): Stance {
  return {
    hips: mixV(a.hips, b.hips, k),
    lean: mix(a.lean, b.lean, k),
    twist: mix(a.twist, b.twist, k),
    side: mix(a.side, b.side, k),
    feet: [
      blendFoot(a.feet[0], b.feet[0], k),
      blendFoot(a.feet[1], b.feet[1], k),
    ],
  };
}

export function pose(draft: Draft, stance: Stance, k = 1): void {
  const from: Stance = {
    hips: draft.hips,
    lean: draft.lean,
    twist: draft.twist,
    side: draft.side,
    feet: draft.feet,
  };
  Object.assign(draft, blendStance(from, stance, k));
}

function flipV(v: V3): V3 {
  return [v[0], -v[1], v[2]];
}

function flipHand(h: HandDraft): HandDraft {
  return {
    ...h,
    at: flipV(h.at),
    pole: flipV(h.pole),
    fingers: h.fingers ? flipV(h.fingers) : null,
    palm: h.palm ? flipV(h.palm) : null,
  };
}

function flipFoot(f: FootDraft): FootDraft {
  return {
    ball: [f.ball[0], -f.ball[1]],
    heel: f.heel,
    yaw: -f.yaw,
    pole: flipV(f.pole),
  };
}

export function flip(draft: Draft): void {
  draft.hips = flipV(draft.hips);
  draft.twist = -draft.twist;
  draft.side = -draft.side;
  draft.hands = [flipHand(draft.hands[1]), flipHand(draft.hands[0])];
  draft.feet = [flipFoot(draft.feet[1]), flipFoot(draft.feet[0])];
}

export interface Build {
  depth: number;
  wide: number;
  hunch: number;
  tempo: number;
  lazy: number;
}

export function buildOf(seed: number): Build {
  return {
    depth: 0.92 + 0.16 * noise(seed, 1),
    wide: -0.025 + 0.05 * noise(seed, 2),
    hunch: -0.05 + 0.1 * noise(seed, 3),
    tempo: 0.9 + 0.2 * noise(seed, 4),
    lazy: noise(seed, 5),
  };
}

export function standing(build: Build, time: number, seed: number): Draft {
  const shift = wander(time, seed, 0.45);
  const weight = 0.03 * shift;
  const open = 0.15 + build.wide;
  const habit = Math.floor(noise(seed, 7) * 4);
  const lead = noise(seed, 8) > 0.5 ? 1 : -1;
  const loose = (side: number) =>
    hand(
      [0.13, side * (0.21 + build.wide), 0.86],
      [-1, side * 0.5, -0.1],
      0.45,
    );
  const onHip = (side: number) =>
    hand([0.02, side * 0.25, 1], [-0.45, side, 0.1], 0.5);
  return {
    hips: [0.01, weight, 0.925 - 0.014 * Math.abs(shift)],
    lean: 0.07 + build.hunch * 0.4,
    twist: 0.05 * lead,
    side: -0.04 * shift,
    hands: [
      habit >= 2 ? onHip(1) : loose(1),
      habit === 2 ? onHip(-1) : loose(-1),
    ],
    feet: [
      foot([0.05 * lead, open], [1, 0.25, 0], 0, 0.24),
      foot([-0.05 * lead, -open], [1, -0.25, 0], 0, -0.2),
    ],
    look: null,
  };
}

export const garageFront = 7.1;
const doorHalf = 2.25;
const doorLine = garageFront - 1.15;
const doorPast = 1.4;

export function throughDoor(
  at: [number, number],
  goal: [number, number],
): [number, number] {
  const from = at[1] - doorLine;
  const to = goal[1] - doorLine;
  if (from * to >= 0) return goal;
  const cross = at[0] + ((goal[0] - at[0]) * from) / (from - to);
  const gate = Math.max(-doorHalf, Math.min(doorHalf, cross));
  if (gate === cross) return goal;
  const dx = gate - at[0];
  const dy = doorLine - at[1];
  const reach = Math.max(1e-3, Math.hypot(dx, dy));
  return [gate + (dx / reach) * doorPast, doorLine + (dy / reach) * doorPast];
}

const homeArea = { half: 2.15, near: 0.9, far: 4.5, apart: 0.78 };

function radical(index: number, base: number): number {
  let scale = 1;
  let value = 0;
  for (let i = index; i > 0; i = Math.floor(i / base)) {
    scale /= base;
    value += scale * (i % base);
  }
  return value;
}

export function homeSpots(count: number): [number, number][] {
  const spots: [number, number][] = [];
  for (let i = 1; spots.length < count && i < 4000; i++) {
    const x = (radical(i, 2) * 2 - 1) * homeArea.half;
    const y =
      garageFront +
      homeArea.near +
      radical(i, 3) * (homeArea.far - homeArea.near);
    if (spots.every(([sx, sy]) => Math.hypot(sx - x, sy - y) >= homeArea.apart))
      spots.push([x, y]);
  }
  return spots.sort((a, b) => a[1] - b[1]);
}

export interface Hull {
  x: number;
  y: number;
  yaw: number;
  front: number;
  rear: number;
  half: number;
  open: boolean;
  soft: boolean;
  hold: boolean;
}

type Point = [number, number];

const cornerRoom = 0.12;
const skin = 0.01;

function crosses(a: Point, b: Point, x0: number, x1: number, w: number) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const edges: Point[] = [
    [-dx, a[0] - x0],
    [dx, x1 - a[0]],
    [-dy, a[1] + w],
    [dy, w - a[1]],
  ];
  let from = 0;
  let to = 1;
  for (const [p, q] of edges) {
    if (Math.abs(p) < 1e-9) {
      if (q <= 0) return false;
      continue;
    }
    if (p < 0) from = Math.max(from, q / p);
    else to = Math.min(to, q / p);
  }
  return to - from > 1e-6;
}

const sideOf = (y: number, other: number) =>
  Math.abs(y) > 1e-3 ? Math.sign(y) : Math.sign(other) || 1;

const gap = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function around(
  at: Point,
  goal: Point,
  hull: Hull,
): { way: Point; rest: number; inside: boolean } {
  const c = Math.cos(hull.yaw);
  const s = Math.sin(hull.yaw);
  const local = ([px, py]: Point): Point => {
    const dx = px - hull.x;
    const dy = py - hull.y;
    return [dx * c + dy * s, -dx * s + dy * c];
  };
  const world = ([lx, ly]: Point): Point => [
    hull.x + lx * c - ly * s,
    hull.y + lx * s + ly * c,
  ];
  const a = local(at);
  let g = local(goal);
  const x0 = -hull.rear;
  const x1 = hull.front;
  const w = hull.half;
  const within = (p: Point) => p[0] > x0 && p[0] < x1 && Math.abs(p[1]) < w;
  if (within(g)) g = [g[0], sideOf(g[1], a[1]) * w];
  if (hull.soft) return { way: world(g), rest: 0, inside: false };
  if (within(a)) {
    const out: Point = [a[0], sideOf(a[1], g[1]) * w];
    return { way: world(out), rest: gap(out, g), inside: true };
  }
  if (!crosses(a, g, x0 + skin, x1 - skin, w - skin))
    return { way: world(g), rest: 0, inside: false };
  const sa = sideOf(a[1], g[1]);
  if (hull.hold) {
    const stay: Point = [a[0], sa * Math.max(Math.abs(a[1]), w)];
    return { way: world(stay), rest: gap(stay, g), inside: false };
  }
  const out = w + cornerRoom;
  const sg = sideOf(g[1], a[1]);
  const across = sa === sg ? 0 : 2 * out;
  const round = (edge: number, beyond: boolean) => {
    const near: Point = [edge, sa * out];
    const far: Point = [edge, sg * out];
    const way = beyond ? far : near;
    const rest = (beyond ? 0 : across) + gap(far, g);
    return { way, rest, cost: gap(a, way) + rest };
  };
  const behind = round(x0 - cornerRoom, a[0] <= x0);
  const ahead = round(x1 + cornerRoom, a[0] >= x1);
  const pick = hull.open && ahead.cost < behind.cost ? ahead : behind;
  return { way: world(pick.way), rest: pick.rest, inside: false };
}
