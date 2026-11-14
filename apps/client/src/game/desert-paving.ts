import { ShapeUtils, Vector2 } from "three";
import { ringOf } from "./desert-buildings.ts";
import { lampGains, type LampSpot } from "./desert-lamps.ts";
import { box, Builder, type Part, up } from "./training-layout.ts";

export interface Road {
  width: number;
  line: number[];
}

export interface Lawn {
  ring: number[];
}

const roadLampEvery = 38;
const roadLift = 0.03;
const lawnLift = 0.018;
const lampFrom = 7;
const lampHeight = 9;
const lampArm = 1.6;
const lampPost = 0.1;
const roadLampReach = 34;
const plazaRings = [1.12, 1.3, 1.46];
const plazaEvery = 12;
const plazaHeight = 10;
const plazaReach = 38;

function pointsOf(line: number[]): Vector2[] {
  const out: Vector2[] = [];
  for (let i = 0; i + 1 < line.length; i += 2)
    out.push(new Vector2(line[i] ?? 0, line[i + 1] ?? 0));
  return out;
}

function sideAt(points: Vector2[], k: number): Vector2 {
  const before = points[Math.max(0, k - 1)] ?? new Vector2();
  const after = points[Math.min(points.length - 1, k + 1)] ?? before;
  const along = after.clone().sub(before).normalize();
  return new Vector2(-along.y, along.x);
}

function ribbon(builder: Builder, road: Road, base: number): void {
  const points = pointsOf(road.line);
  const half = road.width / 2;
  const first = builder.count;
  let along = 0;
  points.forEach((p, k) => {
    if (k > 0) along += p.distanceTo(points[k - 1] ?? p);
    const side = sideAt(points, k);
    for (const across of [-1, 1]) {
      const at = p.clone().addScaledVector(side, across * half);
      builder.vertex([at.x, base + roadLift, at.y], up, [[along, across]]);
    }
  });
  builder.grid(points.length, 2, first);
}

interface Lighting {
  poles: Builder;
  heads: Builder;
  spots: LampSpot[];
}

function post(
  light: Lighting,
  foot: Vector2,
  tip: Vector2,
  base: number,
  height: number,
): void {
  const side = tip.clone().sub(foot);
  const reach = side.length();
  const dir = reach > 0 ? side.clone().divideScalar(reach) : new Vector2(1, 0);
  const axes = [[dir.x, 0, dir.y], up, [-dir.y, 0, dir.x]];
  box(
    light.poles,
    [foot.x, base + height / 2, foot.y],
    [lampPost, height / 2, lampPost],
    axes,
  );
  if (reach > 0)
    box(
      light.poles,
      [(foot.x + tip.x) / 2, base + height, (foot.y + tip.y) / 2],
      [reach / 2, 0.06, 0.08],
      axes,
    );
  box(
    light.heads,
    [tip.x, base + height - 0.1, tip.y],
    [0.35, 0.05, 0.16],
    axes,
  );
}

function lamps(light: Lighting, road: Road, base: number): void {
  if (road.width < lampFrom) return;
  const points = pointsOf(road.line);
  let along = 0;
  let next = roadLampEvery / 2;
  points.forEach((p, k) => {
    if (k > 0) along += p.distanceTo(points[k - 1] ?? p);
    if (along < next) return;
    next += roadLampEvery;
    const side = sideAt(points, k);
    const foot = p.clone().addScaledVector(side, road.width / 2 + 0.8);
    const tip = foot.clone().addScaledVector(side, -lampArm);
    post(light, foot, tip, base, lampHeight);
    light.spots.push({
      head: [tip.x, base + lampHeight - 0.2, tip.y],
      aim: [p.x, base, p.y],
      gain: lampGains.road,
      reach: roadLampReach,
    });
  });
}

function plaza(light: Lighting, ring: number[], base: number): void {
  const outline = ringOf(ring);
  if (outline.length < 3) return;
  const centre = outline
    .reduce((sum, p) => sum.add(p), new Vector2())
    .divideScalar(outline.length);
  for (const share of plazaRings) {
    const scaled = outline.map((p) =>
      centre.clone().add(p.clone().sub(centre).multiplyScalar(share)),
    );
    let along = 0;
    let next = 0;
    scaled.forEach((p, k) => {
      if (k > 0) along += p.distanceTo(scaled[k - 1] ?? p);
      if (along < next) return;
      next += plazaEvery;
      post(light, p, p, base, plazaHeight);
      light.spots.push({
        head: [p.x, base + plazaHeight - 0.2, p.y],
        aim: [p.x + 0.05, base, p.y],
        gain: lampGains.plaza,
        reach: plazaReach,
      });
    });
  }
}

function lawn(builder: Builder, patch: Lawn, base: number): void {
  const ring = ringOf(patch.ring);
  if (ring.length < 3) return;
  const first = builder.count;
  for (const p of ring)
    builder.vertex([p.x, base + lawnLift, p.y], up, [[p.x / 3, p.y / 3]]);
  for (const [a = 0, b = 0, c = 0] of ShapeUtils.triangulateShape(ring, []))
    builder.index.push(first + a, first + c, first + b);
}

export function pavingParts(
  roads: Road[],
  lawns: Lawn[],
  base: number,
  spots: LampSpot[],
  arena: number[] | null,
): Part[] {
  const surface = new Builder(1);
  const light = { poles: new Builder(1), heads: new Builder(1), spots };
  const grass = new Builder(1);
  for (const road of roads) {
    ribbon(surface, road, base);
    lamps(light, road, base);
  }
  if (arena) plaza(light, arena, base);
  for (const patch of lawns) lawn(grass, patch, base);
  return [
    surface.part("service roads", "track service road"),
    light.poles.part("road lamp posts", "track pole steel"),
    light.heads.part("road lamps", "track stand lights"),
    grass.part("lawns", "track desert lawn"),
  ];
}
