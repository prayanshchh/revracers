import { ShapeUtils, Vector2 } from "three";
import { ringOf } from "./desert-buildings.ts";
import { inside } from "./street-shell.ts";
import { lampGains, type LampSpot } from "./desert-lamps.ts";
import { box, Builder, type Part, up } from "./training-layout.ts";

export interface Lot {
  ring: number[];
}

interface LotFrame {
  ring: Vector2[];
  centre: Vector2;
  along: Vector2;
  across: Vector2;
}

interface LotParts {
  surface: Builder;
  white: Builder;
  silver: Builder;
  dark: Builder;
  glass: Builder;
  poles: Builder;
  lamps: Builder;
}

export const lotModule = 16;
export const lotBay = 2.7;
const lotLampEvery = 44;
const lotLift = 0.03;
const carRows = [2.6, 13.4];
const carLong = 4.4;
const carWide = 1.8;
const carFill = 0.34;
const carsMost = 3500;
const carEdge = 3;
const lampHeight = 10;
const lotLampReach = 40;
const lampEdge = 6;

function seeded(index: number): number {
  const x = Math.sin(index * 91.17 + 17.3) * 43758.5453;
  return x - Math.floor(x);
}

function frameOf(lot: Lot): LotFrame {
  const ring = ringOf(lot.ring);
  const centre = ring
    .reduce((sum, p) => sum.add(p), new Vector2())
    .multiplyScalar(1 / ring.length);
  let longest = new Vector2(1, 0);
  let reach = 0;
  ring.forEach((a, i) => {
    const b = ring[(i + 1) % ring.length] ?? a;
    const edge = b.clone().sub(a);
    if (edge.length() > reach) {
      reach = edge.length();
      longest = edge.normalize();
    }
  });
  return {
    ring,
    centre,
    along: longest,
    across: new Vector2(-longest.y, longest.x),
  };
}

function local(frame: LotFrame, p: Vector2): [number, number] {
  const d = p.clone().sub(frame.centre);
  return [d.dot(frame.along), d.dot(frame.across)];
}

function world(frame: LotFrame, a: number, c: number): Vector2 {
  return frame.centre
    .clone()
    .addScaledVector(frame.along, a)
    .addScaledVector(frame.across, c);
}

function clear(ring: Vector2[], p: Vector2, margin: number): boolean {
  if (!inside(ring, p)) return false;
  return ring.every((a, i) => {
    const b = ring[(i + 1) % ring.length] ?? a;
    const edge = b.clone().sub(a);
    const t = Math.max(
      0,
      Math.min(1, p.clone().sub(a).dot(edge) / Math.max(1e-6, edge.lengthSq())),
    );
    return a.clone().addScaledVector(edge, t).distanceTo(p) > margin;
  });
}

function surface(parts: LotParts, frame: LotFrame, base: number): void {
  const first = parts.surface.count;
  for (const p of frame.ring)
    parts.surface.vertex([p.x, base + lotLift, p.y], up, [local(frame, p)]);
  for (const [a = 0, b = 0, c = 0] of ShapeUtils.triangulateShape(
    frame.ring,
    [],
  ))
    parts.surface.index.push(first + a, first + c, first + b);
}

function span(frame: LotFrame): [number, number, number, number] {
  const coords = frame.ring.map((p) => local(frame, p));
  const as = coords.map(([a]) => a);
  const cs = coords.map(([, c]) => c);
  return [Math.min(...as), Math.max(...as), Math.min(...cs), Math.max(...cs)];
}

function car(
  parts: LotParts,
  frame: LotFrame,
  at: Vector2,
  base: number,
  seed: number,
): void {
  const axes = [
    [frame.across.x, 0, frame.across.y],
    up,
    [frame.along.x, 0, frame.along.y],
  ];
  const roll = seeded(seed + 5);
  const paint =
    roll < 0.25 ? parts.white : roll < 0.5 ? parts.silver : parts.dark;
  box(paint, [at.x, base + 0.6, at.y], [carLong / 2, 0.34, carWide / 2], axes);
  box(
    parts.glass,
    [at.x, base + 1.15, at.y],
    [carLong * 0.27, 0.22, carWide * 0.45],
    axes,
  );
}

function cars(
  parts: LotParts,
  frame: LotFrame,
  base: number,
  budget: { left: number },
  seed: number,
): void {
  const [a0, a1, c0, c1] = span(frame);
  for (let c = Math.floor(c0 / lotModule) * lotModule; c < c1; c += lotModule)
    for (const row of carRows)
      for (let a = Math.floor(a0 / lotBay) * lotBay; a < a1; a += lotBay) {
        if (budget.left <= 0) return;
        const key =
          seed + Math.round(a / lotBay) * 7.31 + Math.round((c + row) * 3.17);
        if (seeded(key) > carFill) continue;
        const at = world(frame, a + lotBay / 2, c + row);
        if (!clear(frame.ring, at, carEdge)) continue;
        car(parts, frame, at, base, key);
        budget.left -= 1;
      }
}

function lamps(
  parts: LotParts,
  frame: LotFrame,
  base: number,
  spots: LampSpot[],
): void {
  const [a0, a1, c0, c1] = span(frame);
  const start = (v: number) =>
    Math.floor(v / lotLampEvery) * lotLampEvery + lotLampEvery / 2;
  for (let a = start(a0); a < a1; a += lotLampEvery)
    for (let c = start(c0); c < c1; c += lotLampEvery) {
      const at = world(frame, a, c);
      if (!clear(frame.ring, at, lampEdge)) continue;
      const axes = [
        [frame.along.x, 0, frame.along.y],
        up,
        [frame.across.x, 0, frame.across.y],
      ];
      box(
        parts.poles,
        [at.x, base + lampHeight / 2, at.y],
        [0.11, lampHeight / 2, 0.11],
        axes,
      );
      box(
        parts.poles,
        [at.x, base + lampHeight, at.y],
        [0.9, 0.12, 0.25],
        axes,
      );
      box(
        parts.lamps,
        [at.x, base + lampHeight - 0.14, at.y],
        [0.8, 0.03, 0.2],
        axes,
      );
      spots.push({
        head: [at.x, base + lampHeight - 0.2, at.y],
        aim: [at.x + 0.05, base, at.y],
        gain: lampGains.lot,
        reach: lotLampReach,
      });
    }
}

export function lotParts(lots: Lot[], base: number, spots: LampSpot[]): Part[] {
  const parts: LotParts = {
    surface: new Builder(1),
    white: new Builder(1),
    silver: new Builder(1),
    dark: new Builder(1),
    glass: new Builder(1),
    poles: new Builder(1),
    lamps: new Builder(1),
  };
  const budget = { left: carsMost };
  lots.forEach((lot, index) => {
    const frame = frameOf(lot);
    surface(parts, frame, base);
    cars(parts, frame, base, budget, index * 1009);
    lamps(parts, frame, base, spots);
  });
  return [
    parts.surface.part("lot surface", "track lot asphalt"),
    parts.white.part("lot cars white", "track service white"),
    parts.silver.part("lot cars silver", "track pole steel"),
    parts.dark.part("lot cars dark", "track prop dark"),
    parts.glass.part("lot glass", "track service glass"),
    parts.poles.part("lot poles", "track pole steel"),
    parts.lamps.part("lot lamps", "track stand lights"),
  ];
}
