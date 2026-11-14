import { ShapeUtils, Vector2, Vector3 } from "three";
import { beam } from "./street-layout.ts";
import { inside } from "./street-shell.ts";
import { lampGains, type LampSpot } from "./desert-lamps.ts";
import { box, Builder, type Part, up } from "./training-layout.ts";

export interface Footprint {
  height: number;
  ring: number[];
  kind?: string;
}

interface BuildingParts {
  spots: LampSpot[];
  cloth: Builder;
  canvas: Builder;
  facade: Builder;
  trim: Builder;
  roof: Builder;
  plant: Builder;
  shade: Builder;
  steel: Builder;
}

export function ringOf(flatRing: number[]): Vector2[] {
  const out: Vector2[] = [];
  for (let i = 0; i + 1 < flatRing.length; i += 2)
    out.push(new Vector2(flatRing[i] ?? 0, flatRing[i + 1] ?? 0));
  return ShapeUtils.isClockWise(out) ? out.reverse() : out;
}

const groundSink = 0.5;
const wallLightHeight = 5;
const wallLightEdge = 9;
const wallLightEvery = 16;
const wallLightThrow = 7;
const wallLightReach = 22;
const shadeLightReach = 20;
const parapet = 0.9;
const shadeHeight = 3.1;
const shadeThick = 0.18;
const postEvery = 6;
const postSize = 0.16;
const plantArea = 420;
const plantMost = 9;
const plantSize = [0.75, 0.55, 0.6];
const ridgeShare = 0.2;
const ridgeMost = 6;

function seeded(index: number): number {
  const x = Math.sin(index * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function areaOf(ring: Vector2[]): number {
  return Math.abs(ShapeUtils.area(ring));
}

function wall(
  builder: Builder,
  ring: Vector2[],
  low: number,
  high: number,
  lift: number,
): void {
  let along = 0;
  ring.forEach((a, i) => {
    const b = ring[(i + 1) % ring.length] ?? a;
    const span = a.distanceTo(b);
    if (span < 0.01) return;
    const normal = [(b.y - a.y) / span, 0, -(b.x - a.x) / span];
    const first = builder.count;
    for (const [p, u] of [
      [a, along],
      [b, along + span],
    ] as const)
      for (const h of [low, high])
        builder.vertex([p.x, lift + h, p.y], normal, [[u, h]]);
    builder.quad(first, first + 2, first + 3, first + 1);
    along += span;
  });
}

function cap(
  builder: Builder,
  ring: Vector2[],
  height: number,
  facing: number,
): void {
  const first = builder.count;
  for (const p of ring)
    builder.vertex([p.x, height, p.y], facing > 0 ? up : [0, -1, 0], [
      [p.x / 4, p.y / 4],
    ]);
  for (const [a = 0, b = 0, c = 0] of ShapeUtils.triangulateShape(ring, []))
    if (facing > 0) builder.index.push(first + a, first + c, first + b);
    else builder.index.push(first + a, first + b, first + c);
}

function wallLights(
  parts: BuildingParts,
  ring: Vector2[],
  base: number,
  height: number,
): void {
  const mount = Math.min(height - 0.6, wallLightHeight);
  ring.forEach((a, i) => {
    const b = ring[(i + 1) % ring.length] ?? a;
    const span = a.distanceTo(b);
    if (span < wallLightEdge) return;
    const out = new Vector2(b.y - a.y, -(b.x - a.x)).divideScalar(span);
    const count = Math.floor(span / wallLightEvery) + 1;
    for (let k = 0; k < count; k++) {
      const p = a.clone().lerp(b, (k + 0.5) / count);
      const lamp = p.clone().addScaledVector(out, 0.25);
      const ground = p.clone().addScaledVector(out, wallLightThrow);
      box(
        parts.trim,
        [lamp.x, base + mount, lamp.y],
        [0.18, 0.1, 0.18],
        [[out.x, 0, out.y], up, [-out.y, 0, out.x]],
      );
      parts.spots.push({
        head: [lamp.x, base + mount, lamp.y],
        aim: [ground.x, base, ground.y],
        gain: lampGains.wall,
        reach: wallLightReach,
      });
    }
  });
}

function shadeLight(parts: BuildingParts, ring: Vector2[], base: number): void {
  const centre = ring
    .reduce((sum, p) => sum.add(p), new Vector2())
    .divideScalar(ring.length);
  parts.spots.push({
    head: [centre.x, base + shadeHeight - 0.3, centre.y],
    aim: [centre.x + 0.05, base, centre.y],
    gain: lampGains.shade,
    reach: shadeLightReach,
  });
}

function shade(parts: BuildingParts, ring: Vector2[], base: number): void {
  shadeLight(parts, ring, base);
  const top = base + shadeHeight;
  cap(parts.shade, ring, top, 1);
  cap(parts.shade, ring, top - shadeThick, -1);
  wall(parts.shade, ring, shadeHeight - shadeThick, shadeHeight, base);
  ring.forEach((a, i) => {
    const b = ring[(i + 1) % ring.length] ?? a;
    const posts = Math.max(1, Math.round(a.distanceTo(b) / postEvery));
    for (let k = 0; k < posts; k++) {
      const p = a.clone().lerp(b, k / posts);
      beam(
        parts.steel,
        [p.x, base - 0.1, p.y],
        [p.x, top - shadeThick, p.y],
        postSize,
      );
    }
  });
}

function plant(
  parts: BuildingParts,
  ring: Vector2[],
  top: number,
  seed: number,
): void {
  const count = Math.min(plantMost, Math.floor(areaOf(ring) / plantArea));
  const xs = ring.map((p) => p.x);
  const zs = ring.map((p) => p.y);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const [z0, z1] = [Math.min(...zs), Math.max(...zs)];
  for (let k = 0, tries = 0; k < count && tries < count * 6; tries++) {
    const x = x0 + (x1 - x0) * seeded(seed + tries * 2);
    const z = z0 + (z1 - z0) * seeded(seed + tries * 2 + 1);
    if (!inside(ring, new Vector2(x, z))) continue;
    const turn = seeded(seed + tries * 3) * Math.PI;
    box(parts.plant, [x, top + (plantSize[1] ?? 0.5), z], plantSize, [
      [Math.cos(turn), 0, Math.sin(turn)],
      up,
      [-Math.sin(turn), 0, Math.cos(turn)],
    ]);
    k++;
  }
}

function block(
  parts: BuildingParts,
  footprint: Footprint,
  ring: Vector2[],
  base: number,
  seed: number,
): void {
  const { height } = footprint;
  wall(parts.facade, ring, -groundSink, height, base);
  wall(parts.trim, ring, height, height + parapet, base);
  cap(parts.roof, ring, base + height, 1);
  plant(parts, ring, base + height, seed);
  wallLights(parts, ring, base, height);
}

function facingUp(quad: number[][]): { normal: number[]; flipped: boolean } {
  const [a, b, c] = quad.map((p) => new Vector3().fromArray(p));
  if (!a || !b || !c) return { normal: up, flipped: false };
  const n = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
  const flipped = n.y < 0;
  if (flipped) n.negate();
  return { normal: n.toArray(), flipped };
}

function marquee(
  parts: BuildingParts,
  footprint: Footprint,
  ring: Vector2[],
  base: number,
): void {
  const eave = footprint.height;
  wall(parts.canvas, ring, -0.2, eave, base);
  const [a, b, c, d] = ring;
  if (!a || !b || !c || !d) return;
  const long = a.distanceTo(b) >= b.distanceTo(c);
  const [p0, p1, p2, p3] = long ? [a, b, c, d] : [b, c, d, a];
  const rise = Math.min(ridgeMost, ridgeShare * p1.distanceTo(p2));
  const top = base + eave;
  const ridge0 = p0.clone().lerp(p3, 0.5);
  const ridge1 = p1.clone().lerp(p2, 0.5);
  const at = (p: Vector2, h: number) => [p.x, h, p.y];
  const slope = (e0: Vector2, e1: Vector2) => {
    const first = parts.cloth.count;
    const quad = [
      at(e0, top),
      at(e1, top),
      at(ridge1, top + rise),
      at(ridge0, top + rise),
    ];
    const n = facingUp(quad);
    quad.forEach((p, k) => {
      parts.cloth.vertex(p, n.normal, [[k % 3 === 0 ? 0 : 1, k < 2 ? 0 : 1]]);
    });
    if (n.flipped) parts.cloth.quad(first, first + 3, first + 2, first + 1);
    else parts.cloth.quad(first, first + 1, first + 2, first + 3);
  };
  slope(p0, p1);
  slope(p2, p3);
  for (const [e0, e1, r] of [
    [p3, p0, ridge0],
    [p1, p2, ridge1],
  ] as const) {
    const first = parts.cloth.count;
    for (const p of [at(e0, top), at(e1, top), at(r, top + rise)])
      parts.cloth.vertex(p, up, [[0, 0]]);
    parts.cloth.index.push(first, first + 1, first + 2);
  }
}

export function buildingParts(
  buildings: Footprint[],
  base: number,
  spots: LampSpot[],
): Part[] {
  const parts: BuildingParts = {
    spots,
    cloth: new Builder(1),
    canvas: new Builder(1),
    facade: new Builder(1),
    trim: new Builder(1),
    roof: new Builder(1),
    plant: new Builder(1),
    shade: new Builder(1),
    steel: new Builder(1),
  };
  buildings.forEach((footprint, index) => {
    const ring = ringOf(footprint.ring);
    if (footprint.kind === "carport") shade(parts, ring, base);
    else if (footprint.kind === "marquee")
      marquee(parts, footprint, ring, base);
    else block(parts, footprint, ring, base, index * 17);
  });
  return [
    parts.cloth.part("marquee roofs", "track marquee red"),
    parts.canvas.part("marquee walls", "track stand canopy"),
    parts.facade.part("scenery walls", "track scenery facade"),
    parts.trim.part("scenery parapets", "track stand concrete"),
    parts.roof.part("scenery roofs", "track stand concrete"),
    parts.plant.part("scenery plant", "track pole steel"),
    parts.shade.part("scenery shades", "track stand canopy"),
    parts.steel.part("scenery posts", "track pole steel"),
  ];
}
